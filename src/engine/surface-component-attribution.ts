import type { SurfacePoint3 } from './surface-geometry-fidelity';
import { fingerprintJson } from './delivery-validation';

export interface SurfaceComponentPointSet {
  componentId: string;
  points: SurfacePoint3[];
}

export interface SurfaceComponentAttribution {
  componentId: string;
  candidateSamples: number;
  candidateCoverage: number;
  candidateMeanDistance: number;
  candidateP95Distance: number;
  assignedReferenceSamples: number;
  assignedReferenceCoverage: number;
  assignedReferenceMeanDistance: number;
  assignedReferenceP95Distance: number;
  missingResponsibility: number;
  outlierCandidateSamples: number;
  missingReferenceSamples: number;
  recommendation: 'preserve' | 'relocate-or-reshape' | 'shrink-excess' | 'expand-or-add-detail' | 'inspect';
  suggestedTranslationCandidateUnits?: SurfacePoint3;
}

export interface SurfaceComponentAttributionReport {
  schema: 'morphloom.surface-component-attribution/0.1';
  evidenceFingerprint: string;
  selectedYawDegrees: number;
  distanceThreshold: number;
  candidateUniformScale: number;
  components: SurfaceComponentAttribution[];
  relocateOrReshapeComponentIds: string[];
  shrinkExcessComponentIds: string[];
  expandOrAddDetailComponentIds: string[];
  limitation: string;
}

const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/;
const MAX_COMPONENTS = 512;
const MAX_POINTS = 65_536;
const MAX_COORDINATE = 1e9;

interface TaggedPoint {
  point: SurfacePoint3;
  componentIndex: number;
}

interface KdNode {
  value: TaggedPoint;
  axis: 0 | 1 | 2;
  left?: KdNode;
  right?: KdNode;
}

function finitePoint(point: SurfacePoint3): boolean {
  return Array.isArray(point) && point.length === 3
    && point.every((value) => Number.isFinite(value) && Math.abs(value) <= MAX_COORDINATE);
}

function bounds(points: SurfacePoint3[]): { minimum: SurfacePoint3; maximum: SurfacePoint3; size: SurfacePoint3 } {
  const minimum: SurfacePoint3 = [Infinity, Infinity, Infinity];
  const maximum: SurfacePoint3 = [-Infinity, -Infinity, -Infinity];
  for (const point of points) for (let axis = 0; axis < 3; axis += 1) {
    minimum[axis] = Math.min(minimum[axis], point[axis]);
    maximum[axis] = Math.max(maximum[axis], point[axis]);
  }
  const size = minimum.map((value, axis) => maximum[axis]! - value) as SurfacePoint3;
  if (size.some((value) => !Number.isFinite(value) || value <= Number.EPSILON)) {
    throw new Error('Surface component attribution requires non-degenerate point-cloud bounds.');
  }
  return { minimum, maximum, size };
}

function normalized(
  point: SurfacePoint3,
  measured: ReturnType<typeof bounds>,
): SurfacePoint3 {
  const scale = Math.max(...measured.size);
  return point.map((value, axis) => (
    (value - (measured.minimum[axis]! + measured.maximum[axis]!) / 2) / scale
  )) as SurfacePoint3;
}

function rotateYaw(point: SurfacePoint3, degrees: number): SurfacePoint3 {
  const radians = degrees * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return [point[0] * cosine - point[2] * sine, point[1], point[0] * sine + point[2] * cosine];
}

function inverseRotateYaw(point: SurfacePoint3, degrees: number): SurfacePoint3 {
  return rotateYaw(point, -degrees);
}

function buildTree(values: TaggedPoint[], depth = 0): KdNode | undefined {
  if (values.length === 0) return undefined;
  const axis = (depth % 3) as 0 | 1 | 2;
  values.sort((left, right) => left.point[axis] - right.point[axis]
    || left.componentIndex - right.componentIndex);
  const middle = values.length >>> 1;
  return {
    value: values[middle]!, axis,
    left: buildTree(values.slice(0, middle), depth + 1),
    right: buildTree(values.slice(middle + 1), depth + 1),
  };
}

function nearest(
  point: SurfacePoint3,
  node: KdNode | undefined,
  best?: { squared: number; componentIndex: number },
): { squared: number; componentIndex: number } {
  if (!node) return best ?? { squared: Infinity, componentIndex: -1 };
  const dx = point[0] - node.value.point[0];
  const dy = point[1] - node.value.point[1];
  const dz = point[2] - node.value.point[2];
  const squared = dx * dx + dy * dy + dz * dz;
  let winner = !best || squared < best.squared - Number.EPSILON
    || (Math.abs(squared - best.squared) <= Number.EPSILON
      && node.value.componentIndex < best.componentIndex)
    ? { squared, componentIndex: node.value.componentIndex } : best;
  const delta = point[node.axis] - node.value.point[node.axis];
  const near = delta <= 0 ? node.left : node.right;
  const far = delta <= 0 ? node.right : node.left;
  winner = nearest(point, near, winner);
  if (delta * delta <= winner.squared) winner = nearest(point, far, winner);
  return winner;
}

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))]!;
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function centroid(points: SurfacePoint3[]): SurfacePoint3 | undefined {
  if (points.length === 0) return undefined;
  const sum = points.reduce<SurfacePoint3>((total, point) => [
    total[0] + point[0], total[1] + point[1], total[2] + point[2],
  ], [0, 0, 0]);
  return sum.map((value) => value / points.length) as SurfacePoint3;
}

/**
 * Attributes symmetric surface residuals to independently editable candidate
 * components after applying the same whole-object normalization and yaw used
 * by the global geometry audit. Reference points are assigned by nearest
 * candidate surface, never by unverified names in a merged ground-truth mesh.
 */
export function auditSurfaceComponentAttribution(
  referencePoints: SurfacePoint3[],
  componentPointSets: SurfaceComponentPointSet[],
  options: {
    selectedYawDegrees: number;
    distanceThreshold?: number;
    minimumMissingResponsibility?: number;
    minimumCandidateCoverage?: number;
  },
): SurfaceComponentAttributionReport {
  const distanceThreshold = options.distanceThreshold ?? 0.04;
  const minimumMissingResponsibility = options.minimumMissingResponsibility ?? 0.02;
  const minimumCandidateCoverage = options.minimumCandidateCoverage ?? 0.7;
  const totalCandidatePoints = componentPointSets?.reduce((sum, component) => sum + (component.points?.length ?? 0), 0);
  if (!Array.isArray(referencePoints) || referencePoints.length < 16 || referencePoints.length > MAX_POINTS
    || referencePoints.some((point) => !finitePoint(point))
    || !Array.isArray(componentPointSets) || componentPointSets.length < 1
    || componentPointSets.length > MAX_COMPONENTS
    || !Number.isSafeInteger(totalCandidatePoints) || totalCandidatePoints < 16 || totalCandidatePoints > MAX_POINTS
    || !Number.isFinite(options.selectedYawDegrees) || Math.abs(options.selectedYawDegrees) > 1_000_000
    || !Number.isFinite(distanceThreshold) || distanceThreshold <= 0 || distanceThreshold > 1
    || !Number.isFinite(minimumMissingResponsibility) || minimumMissingResponsibility <= 0
    || minimumMissingResponsibility > 1
    || !Number.isFinite(minimumCandidateCoverage) || minimumCandidateCoverage <= 0
    || minimumCandidateCoverage > 1) {
    throw new Error('Surface component attribution configuration is unsafe.');
  }
  const ids = componentPointSets.map((component) => component.componentId);
  if (new Set(ids).size !== ids.length || componentPointSets.some((component) => (
    !SAFE_ID.test(component.componentId) || !Array.isArray(component.points) || component.points.length < 1
    || component.points.length > 4_096 || component.points.some((point) => !finitePoint(point))
  ))) throw new Error('Surface component attribution component inventory is unsafe.');

  const candidatePoints = componentPointSets.flatMap((component) => component.points);
  const referenceBounds = bounds(referencePoints);
  const candidateBounds = bounds(candidatePoints);
  const candidateUniformScale = Math.max(...candidateBounds.size);
  const normalizedReference = referencePoints.map((point) => normalized(point, referenceBounds));
  const normalizedComponents = componentPointSets.map((component) => ({
    componentId: component.componentId,
    points: component.points.map((point) => rotateYaw(normalized(point, candidateBounds), options.selectedYawDegrees)),
  }));
  const referenceTree = buildTree(normalizedReference.map((point) => ({ point, componentIndex: 0 })))!;
  const candidateTree = buildTree(normalizedComponents.flatMap((component, componentIndex) => (
    component.points.map((point) => ({ point, componentIndex }))
  )))!;
  const candidateDistances = normalizedComponents.map((component) => component.points.map((point) => (
    Math.sqrt(nearest(point, referenceTree).squared)
  )));
  const assignedReference: Array<Array<{ point: SurfacePoint3; distance: number }>>
    = normalizedComponents.map(() => []);
  for (const point of normalizedReference) {
    const match = nearest(point, candidateTree);
    assignedReference[match.componentIndex]!.push({ point, distance: Math.sqrt(match.squared) });
  }
  const totalMissingReference = assignedReference.reduce((sum, values) => (
    sum + values.filter((value) => value.distance > distanceThreshold).length
  ), 0);

  const components = normalizedComponents.map((component, componentIndex): SurfaceComponentAttribution => {
    const distances = candidateDistances[componentIndex]!;
    const assigned = assignedReference[componentIndex]!;
    const outlierCandidatePoints = component.points.filter((_, index) => distances[index]! > distanceThreshold);
    const missingReferencePoints = assigned.filter((value) => value.distance > distanceThreshold).map((value) => value.point);
    const candidateCoverage = distances.filter((value) => value <= distanceThreshold).length / distances.length;
    const assignedReferenceCoverage = assigned.length === 0 ? 0
      : assigned.filter((value) => value.distance <= distanceThreshold).length / assigned.length;
    const missingResponsibility = totalMissingReference === 0 ? 0
      : missingReferencePoints.length / totalMissingReference;
    const sourceCentroid = centroid(outlierCandidatePoints);
    const targetCentroid = centroid(missingReferencePoints);
    const suggestedTranslationCandidateUnits = sourceCentroid && targetCentroid
      ? inverseRotateYaw(targetCentroid.map((value, axis) => (
        (value - sourceCentroid[axis]!) * candidateUniformScale
      )) as SurfacePoint3, options.selectedYawDegrees)
      : undefined;
    const candidateNeedsRepair = candidateCoverage < minimumCandidateCoverage;
    const referenceNeedsRepair = missingResponsibility >= minimumMissingResponsibility
      && assignedReferenceCoverage < minimumCandidateCoverage;
    const recommendation = candidateNeedsRepair && referenceNeedsRepair
      ? 'relocate-or-reshape' as const
      : candidateNeedsRepair ? 'shrink-excess' as const
        : referenceNeedsRepair ? 'expand-or-add-detail' as const
          : candidateCoverage >= 0.9 && (assigned.length === 0 || assignedReferenceCoverage >= 0.9)
            ? 'preserve' as const : 'inspect' as const;
    return {
      componentId: component.componentId,
      candidateSamples: distances.length,
      candidateCoverage,
      candidateMeanDistance: mean(distances),
      candidateP95Distance: percentile(distances, 0.95),
      assignedReferenceSamples: assigned.length,
      assignedReferenceCoverage,
      assignedReferenceMeanDistance: mean(assigned.map((value) => value.distance)),
      assignedReferenceP95Distance: percentile(assigned.map((value) => value.distance), 0.95),
      missingResponsibility,
      outlierCandidateSamples: outlierCandidatePoints.length,
      missingReferenceSamples: missingReferencePoints.length,
      recommendation,
      suggestedTranslationCandidateUnits,
    };
  }).sort((left, right) => right.missingResponsibility - left.missingResponsibility
    || left.candidateCoverage - right.candidateCoverage || left.componentId.localeCompare(right.componentId));
  return {
    schema: 'morphloom.surface-component-attribution/0.1',
    evidenceFingerprint: fingerprintJson({
      referencePoints,
      componentPointSets,
      selectedYawDegrees: options.selectedYawDegrees,
      distanceThreshold,
      minimumMissingResponsibility,
      minimumCandidateCoverage,
    }),
    selectedYawDegrees: options.selectedYawDegrees,
    distanceThreshold,
    candidateUniformScale,
    components,
    relocateOrReshapeComponentIds: components.filter((component) => component.recommendation === 'relocate-or-reshape')
      .map((component) => component.componentId),
    shrinkExcessComponentIds: components.filter((component) => component.recommendation === 'shrink-excess')
      .map((component) => component.componentId),
    expandOrAddDetailComponentIds: components.filter((component) => component.recommendation === 'expand-or-add-detail')
      .map((component) => component.componentId),
    limitation: 'Nearest-surface attribution localizes geometric responsibility after whole-object alignment; it does not prove ground-truth semantic identity, part boundaries, articulation state, or that a centroid translation is the correct repair.',
  };
}
