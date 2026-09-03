import { fingerprintJson } from './delivery-validation';
import type { EvidenceStatusIR } from './assembly-ir';
import type {
  SurfaceGeometryFidelityReport,
  SurfaceSpatialBandCoverage,
  SurfaceSpatialCellCoverage,
} from './surface-geometry-fidelity';
import { auditVisualPlan, type VisualPlanningContract } from './visual-plan-audit';

export interface ComponentSpatialObservation {
  componentId: string;
  normalizedBounds: {
    minimum: [number, number, number];
    maximum: [number, number, number];
  };
  evidenceStatus: EvidenceStatusIR;
}

export type GeometryRecoveryOperation =
  | 'expand-or-reshape-existing-units'
  | 'relocate-or-reshape-extraneous-units'
  | 'request-region-evidence';

export interface GeometryRecoveryAction {
  id: string;
  causeBandId: string;
  causeBandIds: string[];
  priority: number;
  operation: GeometryRecoveryOperation;
  targetComponentIds: string[];
  candidateComponentCount: number;
  spatialConstraintIds: string[];
  targetingMode: 'spatial-cell-overlap' | 'semantic-feature-overlap' | 'surface-nearest-attribution' | 'cross-axis-intersection' | 'single-axis-overlap' | 'unmapped-or-ambiguous';
  semanticFeatureId?: string;
  surfaceAttributionComponentId?: string;
  evidenceViewIds: string[];
  requiredComponentIds: string[];
  prohibitedOperations: Array<'delete-required-component' | 'lower-locked-feature-count' | 'change-source-evidence'>;
  verificationGates: Array<'surface-geometry-fidelity' | 'visual-plan-revision' | 'topology-integrity' | 'multiview-silhouette'>;
  reason: string;
}

export interface GeometryRecoveryPlan {
  schema: 'morphloom.geometry-recovery-plan/0.1';
  pass: boolean;
  actionable: boolean;
  sourceGeometryAuditFingerprint: string;
  sourceVisualPlanFingerprint: string;
  actions: GeometryRecoveryAction[];
  blockers: string[];
  warnings: string[];
}

const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,95}$/;
const MAX_COMPONENTS = 2_048;
const AXIS_INDEX = { x: 0, y: 1, z: 2 } as const;
const BAND_RANGE = {
  low: [0, 1 / 3], middle: [1 / 3, 2 / 3], high: [2 / 3, 1],
} as const;

export function observeAlignedComponentBounds(
  componentId: string,
  worldBounds: { minimum: [number, number, number]; maximum: [number, number, number] },
  evidenceStatus: EvidenceStatusIR,
  geometryAudit: SurfaceGeometryFidelityReport,
): ComponentSpatialObservation {
  if (!SAFE_ID.test(componentId) || !worldBounds?.minimum || !worldBounds?.maximum
    || worldBounds.minimum.some((value, axis) => !Number.isFinite(value) || value > worldBounds.maximum[axis]!)
    || worldBounds.maximum.some((value) => !Number.isFinite(value))) {
    throw new Error(`Cannot normalize unsafe component bounds: ${componentId || 'missing'}.`);
  }
  const input = geometryAudit?.candidateInputBounds;
  const aligned = geometryAudit?.spatialCoverage?.candidateAlignedNormalizedBounds;
  if (!input || !aligned || input.size.some((value) => !Number.isFinite(value) || value <= 0)
    || aligned.size.some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new Error('Cannot normalize component bounds without a complete geometry alignment receipt.');
  }
  const center = input.minimum.map((value, axis) => (value + input.maximum[axis]!) / 2) as [number, number, number];
  const scale = Math.max(...input.size);
  const radians = geometryAudit.selectedYawDegrees * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const corners: Array<[number, number, number]> = [];
  for (const x of [worldBounds.minimum[0], worldBounds.maximum[0]]) {
    for (const y of [worldBounds.minimum[1], worldBounds.maximum[1]]) {
      for (const z of [worldBounds.minimum[2], worldBounds.maximum[2]]) {
        const normalizedX = (x - center[0]) / scale;
        const normalizedY = (y - center[1]) / scale;
        const normalizedZ = (z - center[2]) / scale;
        corners.push([
          normalizedX * cosine - normalizedZ * sine,
          normalizedY,
          normalizedX * sine + normalizedZ * cosine,
        ]);
      }
    }
  }
  const minimum = [0, 1, 2].map((axis) => Math.min(...corners.map((corner) => corner[axis]!)));
  const maximum = [0, 1, 2].map((axis) => Math.max(...corners.map((corner) => corner[axis]!)));
  const toUnit = (value: number, axis: number): number => Math.max(0, Math.min(1,
    (value - aligned.minimum[axis]!) / aligned.size[axis]!,
  ));
  return {
    componentId,
    normalizedBounds: {
      minimum: minimum.map(toUnit) as [number, number, number],
      maximum: maximum.map(toUnit) as [number, number, number],
    },
    evidenceStatus,
  };
}

function finiteUnit(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function validBand(band: SurfaceSpatialBandCoverage): boolean {
  return (band.side === 'reference' || band.side === 'candidate')
    && ['x', 'y', 'z'].includes(band.axis)
    && ['low', 'middle', 'high'].includes(band.band)
    && band.id === `${band.side}:${band.axis}-${band.band}`
    && Number.isInteger(band.samples) && band.samples >= 0 && band.samples <= 1_000_000
    && finiteUnit(band.coverage)
    && Number.isFinite(band.meanDistance) && band.meanDistance >= 0
    && Number.isFinite(band.p95Distance) && band.p95Distance >= 0;
}

function overlapsBand(observation: ComponentSpatialObservation, band: SurfaceSpatialBandCoverage): boolean {
  const axis = AXIS_INDEX[band.axis];
  const [bandMinimum, bandMaximum] = BAND_RANGE[band.band];
  return observation.normalizedBounds.maximum[axis] >= bandMinimum
    && observation.normalizedBounds.minimum[axis] <= bandMaximum;
}

function validCell(cell: SurfaceSpatialCellCoverage): boolean {
  const bands = ['low', 'middle', 'high'];
  return (cell.side === 'reference' || cell.side === 'candidate')
    && bands.includes(cell.bands?.x) && bands.includes(cell.bands?.y) && bands.includes(cell.bands?.z)
    && cell.id === `${cell.side}:cell:x-${cell.bands.x}:y-${cell.bands.y}:z-${cell.bands.z}`
    && Number.isInteger(cell.samples) && cell.samples >= 0 && cell.samples <= 1_000_000
    && finiteUnit(cell.coverage)
    && Number.isFinite(cell.meanDistance) && cell.meanDistance >= 0
    && Number.isFinite(cell.p95Distance) && cell.p95Distance >= 0;
}

function overlapsCell(observation: ComponentSpatialObservation, cell: SurfaceSpatialCellCoverage): boolean {
  return (['x', 'y', 'z'] as const).every((axis) => {
    const axisIndex = AXIS_INDEX[axis];
    const [minimum, maximum] = BAND_RANGE[cell.bands[axis]];
    return observation.normalizedBounds.maximum[axisIndex] >= minimum
      && observation.normalizedBounds.minimum[axisIndex] <= maximum;
  });
}

/**
 * Converts localized surface failures into bounded, evidence-addressable edit
 * work. It intentionally never emits a delete operation: a retry must preserve
 * locked requirements and prove improvement through the dependent gates.
 */
export function createGeometryRecoveryPlan(
  geometryAudit: SurfaceGeometryFidelityReport,
  visualPlan: VisualPlanningContract,
  componentObservations: ComponentSpatialObservation[],
  options: {
    maximumActions?: number;
    coverageTrigger?: number;
    maximumTargetsPerAction?: number;
    minimumCellSamples?: number;
  } = {},
): GeometryRecoveryPlan {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const maximumActions = options.maximumActions ?? 4;
  const maximumTargetsPerAction = options.maximumTargetsPerAction ?? 24;
  const minimumCellSamples = options.minimumCellSamples ?? 8;
  const coverageTrigger = options.coverageTrigger ?? geometryAudit?.thresholds?.minimumCoverage ?? 0.9;
  if (geometryAudit?.schema !== 'morphloom.surface-geometry-fidelity/0.1'
    || !Array.isArray(geometryAudit?.spatialCoverage?.reference)
    || !Array.isArray(geometryAudit?.spatialCoverage?.candidate)) {
    throw new Error('Geometry recovery requires a complete surface-fidelity audit.');
  }
  if (!Number.isInteger(maximumActions) || maximumActions < 1 || maximumActions > 12
    || !Number.isInteger(maximumTargetsPerAction) || maximumTargetsPerAction < 1 || maximumTargetsPerAction > 128
    || !Number.isInteger(minimumCellSamples) || minimumCellSamples < 1 || minimumCellSamples > 4_096
    || !Number.isFinite(coverageTrigger) || coverageTrigger <= 0 || coverageTrigger > 1) {
    throw new Error('Geometry recovery options are outside safe bounds.');
  }
  const visualAudit = auditVisualPlan(visualPlan);
  if (!visualAudit.pass) blockers.push(...visualAudit.blockers.map((blocker) => `visual plan: ${blocker}`));
  if (!Array.isArray(componentObservations) || componentObservations.length < 1
    || componentObservations.length > MAX_COMPONENTS) {
    throw new Error(`Geometry recovery requires 1-${MAX_COMPONENTS} component observations.`);
  }
  const observationIds = new Set<string>();
  for (const observation of componentObservations) {
    const minimum = observation?.normalizedBounds?.minimum;
    const maximum = observation?.normalizedBounds?.maximum;
    if (!SAFE_ID.test(observation?.componentId ?? '') || observationIds.has(observation.componentId)
      || !Array.isArray(minimum) || minimum.length !== 3 || !Array.isArray(maximum) || maximum.length !== 3
      || minimum.some((value, axis) => !finiteUnit(value) || value > maximum[axis]!)
      || maximum.some((value) => !finiteUnit(value))
      || !['measured', 'datasheet', 'estimated', 'inferred'].includes(observation.evidenceStatus)) {
      throw new Error(`Invalid component spatial observation: ${observation?.componentId ?? 'missing'}.`);
    }
    observationIds.add(observation.componentId);
  }
  const bands = [...geometryAudit.spatialCoverage.reference, ...geometryAudit.spatialCoverage.candidate];
  if (bands.length < 2 || bands.length > 64 || bands.some((band) => !validBand(band))) {
    throw new Error('Geometry recovery received malformed spatial coverage bands.');
  }

  const componentFeatures = new Map<string, typeof visualPlan.features>();
  for (const feature of visualPlan.features) for (const componentId of feature.componentIds) {
    const features = componentFeatures.get(componentId) ?? [];
    features.push(feature);
    componentFeatures.set(componentId, features);
  }
  const cells = [
    ...(geometryAudit.spatialCoverage.referenceCells ?? []),
    ...(geometryAudit.spatialCoverage.candidateCells ?? []),
  ];
  if (cells.length > 0 && (cells.length !== 54 || cells.some((cell) => !validCell(cell)))) {
    throw new Error('Geometry recovery received malformed spatial coverage cells.');
  }
  const selectedCells = cells
    .filter((cell) => cell.samples >= minimumCellSamples && cell.coverage < coverageTrigger)
    .sort((left, right) => left.coverage - right.coverage
      || right.p95Distance - left.p95Distance || right.samples - left.samples || left.id.localeCompare(right.id))
    .slice(0, maximumActions);
  const cellActions = selectedCells.map((cell, index): GeometryRecoveryAction => {
    const constrained = componentObservations.filter((observation) => overlapsCell(observation, cell));
    const ambiguous = constrained.length > maximumTargetsPerAction;
    const targets = ambiguous ? [] : constrained;
    const targetComponentIds = targets.map((target) => target.componentId).sort();
    const features = targetComponentIds.flatMap((componentId) => componentFeatures.get(componentId) ?? []);
    const requiredComponentIds = targetComponentIds.filter((componentId) => (
      componentFeatures.get(componentId) ?? []
    ).some((feature) => feature.required)).sort();
    const evidenceViewIds = [...new Set(features.flatMap((feature) => feature.sourceViewIds))].sort();
    const spatialConstraintIds = (['x', 'y', 'z'] as const).map((axis) => (
      `${cell.side}:${axis}-${cell.bands[axis]}`
    ));
    const operation: GeometryRecoveryOperation = targets.length === 0 || evidenceViewIds.length === 0
      ? 'request-region-evidence'
      : cell.side === 'reference'
        ? 'expand-or-reshape-existing-units'
        : 'relocate-or-reshape-extraneous-units';
    return {
      id: `recover-${cell.side}-cell-${index + 1}`,
      causeBandId: cell.id,
      causeBandIds: [cell.id],
      priority: index + 1,
      operation,
      targetComponentIds,
      candidateComponentCount: constrained.length,
      spatialConstraintIds,
      targetingMode: operation === 'request-region-evidence' ? 'unmapped-or-ambiguous' : 'spatial-cell-overlap',
      evidenceViewIds,
      requiredComponentIds,
      prohibitedOperations: ['delete-required-component', 'lower-locked-feature-count', 'change-source-evidence'],
      verificationGates: ['surface-geometry-fidelity', 'visual-plan-revision', 'topology-integrity', 'multiview-silhouette'],
      reason: operation === 'request-region-evidence'
        ? ambiguous
          ? `${cell.id} coverage ${(cell.coverage * 100).toFixed(1)}% maps to ${constrained.length} components, above the safe limit of ${maximumTargetsPerAction}; acquire a finer region mask or component correspondence before changing geometry.`
          : `${cell.id} coverage ${(cell.coverage * 100).toFixed(1)}% has no evidence-addressable edit unit; acquire or map evidence before changing geometry.`
        : `${cell.id} coverage ${(cell.coverage * 100).toFixed(1)}% maps directly to ${targetComponentIds.length} edit units in one measured 3D cell; revise only those units and rerun every dependent gate.`,
    };
  });
  const selectedBands: SurfaceSpatialBandCoverage[] = [];
  const seenAxisSides = new Set<string>();
  for (const band of [...bands]
    .filter((candidate) => candidate.samples > 0 && candidate.coverage < coverageTrigger)
    .sort((left, right) => left.coverage - right.coverage
      || right.p95Distance - left.p95Distance || left.id.localeCompare(right.id))) {
    const key = `${band.side}:${band.axis}`;
    // When cell evidence exists, retain multiple failed bands on the same axis:
    // low and middle depth failures commonly describe different assemblies.
    if (selectedCells.length === 0) {
      if (seenAxisSides.has(key)) continue;
      seenAxisSides.add(key);
    }
    selectedBands.push(band);
    if (selectedBands.length >= maximumActions) break;
  }

  const bandActions = selectedBands.map((band, index): GeometryRecoveryAction => {
    const primaryCandidates = componentObservations.filter((observation) => overlapsBand(observation, band));
    const featureKindPriority = (kind: VisualPlanningContract['features'][number]['kind']): number => ({
      'primary-mass': 8, 'layered-stack': 7, 'optical-stack': 6, interface: 5,
      articulation: 5, opening: 4, fastener: 3, 'repeated-array': 2,
      'surface-relief': 2, 'thin-feature': 1, 'routed-element': 1,
    })[kind];
    const primaryIds = new Set(primaryCandidates.map((candidate) => candidate.componentId));
    const semanticFeature = selectedCells.length > 0 ? [...visualPlan.features]
      .map((feature) => ({
        feature,
        targetIds: feature.componentIds.filter((componentId) => primaryIds.has(componentId)),
      }))
      .filter((candidate) => candidate.targetIds.length > 0
        && candidate.targetIds.length <= maximumTargetsPerAction)
      .sort((left, right) => right.targetIds.length / right.feature.componentIds.length
          - left.targetIds.length / left.feature.componentIds.length
        || featureKindPriority(right.feature.kind) - featureKindPriority(left.feature.kind)
        || left.targetIds.length - right.targetIds.length
        || left.feature.id.localeCompare(right.feature.id))[0] : undefined;
    const supportingBands = semanticFeature ? [] : selectedBands.filter((candidate) => (
      candidate.side === band.side && candidate.axis !== band.axis
    ));
    const scoredCandidates = primaryCandidates.map((observation) => ({
      observation,
      supportingConstraintIds: supportingBands
        .filter((supportingBand) => overlapsBand(observation, supportingBand))
        .map((supportingBand) => supportingBand.id)
        .sort(),
    }));
    const maximumSupportingConstraints = Math.max(0, ...scoredCandidates.map((candidate) => (
      candidate.supportingConstraintIds.length
    )));
    const spatiallyConstrained = supportingBands.length > 0 && maximumSupportingConstraints > 0
      ? scoredCandidates.filter((candidate) => (
        candidate.supportingConstraintIds.length === maximumSupportingConstraints
      ))
      : scoredCandidates;
    const semanticTargets = semanticFeature
      ? componentObservations.filter((observation) => semanticFeature.targetIds.includes(observation.componentId))
      : undefined;
    const candidateTargets = semanticTargets ?? spatiallyConstrained.map((candidate) => candidate.observation);
    const ambiguous = candidateTargets.length > maximumTargetsPerAction;
    const targets = ambiguous ? [] : candidateTargets;
    const targetComponentIds = targets.map((target) => target.componentId).sort();
    const spatialConstraintIds = [band.id, ...new Set((semanticFeature ? [] : spatiallyConstrained).flatMap((candidate) => (
      candidate.supportingConstraintIds
    )))].sort();
    const features = targetComponentIds.flatMap((componentId) => componentFeatures.get(componentId) ?? []);
    const requiredComponentIds = targetComponentIds.filter((componentId) => (
      componentFeatures.get(componentId) ?? []
    ).some((feature) => feature.required)).sort();
    const evidenceViewIds = [...new Set(features.flatMap((feature) => feature.sourceViewIds))].sort();
    const operation: GeometryRecoveryOperation = targets.length === 0 || evidenceViewIds.length === 0
      ? 'request-region-evidence'
      : band.side === 'reference'
        ? 'expand-or-reshape-existing-units'
        : 'relocate-or-reshape-extraneous-units';
    return {
      id: `recover-${band.side}-${band.axis}-${band.band}`,
      causeBandId: band.id,
      causeBandIds: [band.id],
      priority: index + 1,
      operation,
      targetComponentIds,
      candidateComponentCount: spatiallyConstrained.length,
      spatialConstraintIds,
      targetingMode: operation === 'request-region-evidence'
        ? 'unmapped-or-ambiguous'
        : semanticFeature
          ? 'semantic-feature-overlap'
          : supportingBands.length > 0 && maximumSupportingConstraints > 0
          ? 'cross-axis-intersection'
          : 'single-axis-overlap',
      ...(semanticFeature ? { semanticFeatureId: semanticFeature.feature.id } : {}),
      evidenceViewIds,
      requiredComponentIds,
      prohibitedOperations: ['delete-required-component', 'lower-locked-feature-count', 'change-source-evidence'],
      verificationGates: ['surface-geometry-fidelity', 'visual-plan-revision', 'topology-integrity', 'multiview-silhouette'],
      reason: operation === 'request-region-evidence'
        ? ambiguous
          ? `${band.id} coverage ${(band.coverage * 100).toFixed(1)}% still maps to ${spatiallyConstrained.length} equally constrained edit units, above the safe limit of ${maximumTargetsPerAction}; acquire a finer region mask or component correspondence before changing geometry.`
          : `${band.id} coverage ${(band.coverage * 100).toFixed(1)}% has no evidence-addressable edit unit; acquire or map evidence before changing geometry.`
        : semanticFeature
          ? `${band.id} coverage ${(band.coverage * 100).toFixed(1)}% maps to the evidence-locked ${semanticFeature.feature.id} feature and ${targetComponentIds.length} bounded edit units; revise that semantic assembly as one candidate and require all dependent gates to improve.`
          : `${band.id} coverage ${(band.coverage * 100).toFixed(1)}% maps through ${spatialConstraintIds.length} spatial constraints to ${targetComponentIds.length} bounded edit units; revise only those units and require all dependent gates to improve.`,
    };
  });
  // Preserve both resolutions. A dense failing cell is useful for pinpointing
  // small hardware, but it must not suppress a coarse axis band that exposes a
  // whole-profile error (for example an over-deep motor housing in side view).
  // Interleaving also keeps a small downstream trial budget representative of
  // both local and global failure modes.
  const rawActions: GeometryRecoveryAction[] = [];
  const actionDepth = Math.max(cellActions.length, Math.ceil(bandActions.length / 2));
  for (let index = 0; index < actionDepth; index += 1) {
    if (bandActions[index * 2]) rawActions.push(bandActions[index * 2]!);
    if (cellActions[index]) rawActions.push(cellActions[index]!);
    if (bandActions[index * 2 + 1]) rawActions.push(bandActions[index * 2 + 1]!);
  }
  const groupedActions = new Map<string, GeometryRecoveryAction>();
  for (const action of rawActions) {
    const groupingKey = [
      action.operation,
      action.targetingMode,
      action.targetComponentIds.join(','),
      action.spatialConstraintIds.join(','),
    ].join('|');
    const existing = groupedActions.get(groupingKey);
    if (!existing) {
      groupedActions.set(groupingKey, action);
      continue;
    }
    existing.causeBandIds = [...new Set([...existing.causeBandIds, ...action.causeBandIds])].sort();
    existing.evidenceViewIds = [...new Set([...existing.evidenceViewIds, ...action.evidenceViewIds])].sort();
    existing.requiredComponentIds = [...new Set([
      ...existing.requiredComponentIds, ...action.requiredComponentIds,
    ])].sort();
  }
  const actions = [...groupedActions.values()].slice(0, maximumActions).map((action, index) => ({
    ...action,
    id: action.causeBandIds.length > 1
      ? `recover-${action.causeBandIds[0]!.split(':')[0]}-intersection-${index + 1}`
      : action.id,
    priority: index + 1,
    reason: action.causeBandIds.length > 1
      ? action.operation === 'request-region-evidence'
        ? `${action.causeBandIds.join(', ')} converge on ${action.candidateComponentCount} unresolved candidates through ${action.spatialConstraintIds.length} spatial constraints; acquire a finer region mask or component correspondence before changing geometry.`
        : `${action.causeBandIds.join(', ')} converge on ${action.targetComponentIds.length} bounded edit candidates through ${action.spatialConstraintIds.length} spatial constraints; execute one consolidated recovery and rerun every dependent gate.`
      : action.reason,
  }));
  if (geometryAudit.pass) warnings.push('surface geometry already passes; no corrective edit is required');
  if (!geometryAudit.pass && actions.length === 0) blockers.push('surface geometry failed but no localized recovery action could be derived');
  if (actions.some((action) => action.operation === 'request-region-evidence')) {
    warnings.push('one or more failed regions are unmapped; geometry synthesis is blocked there until evidence is attached');
  }
  return {
    schema: 'morphloom.geometry-recovery-plan/0.1',
    pass: blockers.length === 0,
    actionable: blockers.length === 0 && actions.some((action) => action.operation !== 'request-region-evidence'),
    sourceGeometryAuditFingerprint: fingerprintJson(geometryAudit),
    sourceVisualPlanFingerprint: visualAudit.fingerprint,
    actions,
    blockers: [...new Set(blockers)],
    warnings: [...new Set(warnings)],
  };
}
