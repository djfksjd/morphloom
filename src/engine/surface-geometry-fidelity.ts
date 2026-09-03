export type SurfacePoint3 = [number, number, number];

export interface SurfaceTriangle3 {
  a: SurfacePoint3;
  b: SurfacePoint3;
  c: SurfacePoint3;
}

export interface SurfaceSampleReceipt {
  points: SurfacePoint3[];
  requestedSamples: number;
  sampledTriangles: number;
  sourceTriangles: number;
  surfaceArea: number;
}

export interface SurfaceGeometryFidelityOptions {
  yawStepDegrees?: number;
  distanceThreshold?: number;
  maximumDimensionRelativeError?: number;
  maximumRmsChamfer?: number;
  maximumP95Distance?: number;
  minimumCoverage?: number;
}

export interface SurfaceGeometryFidelityReport {
  schema: 'morphloom.surface-geometry-fidelity/0.1';
  pass: boolean;
  dimensionPass: boolean;
  shapePass: boolean;
  selectedYawDegrees: number;
  referenceBounds: { minimum: SurfacePoint3; maximum: SurfacePoint3; size: SurfacePoint3 };
  candidateInputBounds: { minimum: SurfacePoint3; maximum: SurfacePoint3; size: SurfacePoint3 };
  candidateBounds: { minimum: SurfacePoint3; maximum: SurfacePoint3; size: SurfacePoint3 };
  dimensionRelativeErrors: SurfacePoint3;
  maximumDimensionRelativeError: number;
  symmetricRmsChamfer: number;
  referenceP95Distance: number;
  candidateP95Distance: number;
  minimumCoverage: number;
  referenceCoverage: number;
  candidateCoverage: number;
  spatialCoverage: {
    reference: SurfaceSpatialBandCoverage[];
    candidate: SurfaceSpatialBandCoverage[];
    worstBand: SurfaceSpatialBandCoverage;
    referenceCells: SurfaceSpatialCellCoverage[];
    candidateCells: SurfaceSpatialCellCoverage[];
    worstCell: SurfaceSpatialCellCoverage;
    /** Bounds after uniform normalization and selected-yaw alignment, used to localize component edits. */
    candidateAlignedNormalizedBounds: { minimum: SurfacePoint3; maximum: SurfacePoint3; size: SurfacePoint3 };
  };
  thresholds: Required<SurfaceGeometryFidelityOptions>;
  blockers: string[];
  limitation: string;
}

export interface SurfaceSpatialBandCoverage {
  id: string;
  side: 'reference' | 'candidate';
  axis: 'x' | 'y' | 'z';
  band: 'low' | 'middle' | 'high';
  samples: number;
  coverage: number;
  meanDistance: number;
  p95Distance: number;
}

export interface SurfaceSpatialCellCoverage {
  id: string;
  side: 'reference' | 'candidate';
  bands: { x: 'low' | 'middle' | 'high'; y: 'low' | 'middle' | 'high'; z: 'low' | 'middle' | 'high' };
  samples: number;
  coverage: number;
  meanDistance: number;
  p95Distance: number;
}

const MAX_TRIANGLES = 500_000;
const MAX_SAMPLES = 4_096;
const MIN_SAMPLES = 16;
const MAX_ABSOLUTE_COORDINATE = 1e9;
const MAX_NEAREST_QUERIES = 1_000_000;

function finitePoint(point: SurfacePoint3): boolean {
  return point.length === 3 && point.every((value) => Number.isFinite(value) && Math.abs(value) <= MAX_ABSOLUTE_COORDINATE);
}

function triangleArea(triangle: SurfaceTriangle3): number {
  const abx = triangle.b[0] - triangle.a[0];
  const aby = triangle.b[1] - triangle.a[1];
  const abz = triangle.b[2] - triangle.a[2];
  const acx = triangle.c[0] - triangle.a[0];
  const acy = triangle.c[1] - triangle.a[1];
  const acz = triangle.c[2] - triangle.a[2];
  const cx = aby * acz - abz * acy;
  const cy = abz * acx - abx * acz;
  const cz = abx * acy - aby * acx;
  return 0.5 * Math.hypot(cx, cy, cz);
}

function radicalInverse(index: number, base: number): number {
  let value = 0;
  let denominator = 1;
  for (let remaining = index; remaining > 0; remaining = Math.floor(remaining / base)) {
    denominator *= base;
    value += (remaining % base) / denominator;
  }
  return value;
}

export function sampleTriangleSurface(triangles: SurfaceTriangle3[], sampleCount = 512): SurfaceSampleReceipt {
  if (!Array.isArray(triangles) || triangles.length < 1 || triangles.length > MAX_TRIANGLES
    || !Number.isInteger(sampleCount) || sampleCount < MIN_SAMPLES || sampleCount > MAX_SAMPLES) {
    throw new Error(`Surface sampling requires 1-${MAX_TRIANGLES} triangles and ${MIN_SAMPLES}-${MAX_SAMPLES} samples.`);
  }
  const validTriangles: SurfaceTriangle3[] = [];
  const cumulativeAreas: number[] = [];
  const extremePoints = new Array<SurfacePoint3>(6);
  let totalArea = 0;
  for (const triangle of triangles) {
    if (!triangle || !finitePoint(triangle.a) || !finitePoint(triangle.b) || !finitePoint(triangle.c)) {
      throw new Error('Surface sampling received a non-finite or unsafe triangle.');
    }
    const area = triangleArea(triangle);
    if (area <= Number.EPSILON) continue;
    totalArea += area;
    validTriangles.push(triangle);
    cumulativeAreas.push(totalArea);
    for (const point of [triangle.a, triangle.b, triangle.c]) for (let axis = 0; axis < 3; axis += 1) {
      const minimumIndex = axis * 2;
      const maximumIndex = minimumIndex + 1;
      if (!extremePoints[minimumIndex] || point[axis] < extremePoints[minimumIndex]![axis]) extremePoints[minimumIndex] = [...point];
      if (!extremePoints[maximumIndex] || point[axis] > extremePoints[maximumIndex]![axis]) extremePoints[maximumIndex] = [...point];
    }
  }
  if (!Number.isFinite(totalArea) || totalArea <= Number.EPSILON || validTriangles.length === 0) {
    throw new Error('Surface sampling requires at least one finite non-degenerate triangle.');
  }
  const points = extremePoints.map((point) => [...point] as SurfacePoint3);
  const areaSampleCount = sampleCount - points.length;
  for (let sampleIndex = 0; sampleIndex < areaSampleCount; sampleIndex += 1) {
    const targetArea = (sampleIndex + 0.5) / areaSampleCount * totalArea;
    let low = 0;
    let high = cumulativeAreas.length - 1;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (cumulativeAreas[middle]! < targetArea) low = middle + 1;
      else high = middle;
    }
    const triangle = validTriangles[low]!;
    const r1 = radicalInverse(sampleIndex + 1, 2);
    const r2 = radicalInverse(sampleIndex + 1, 3);
    const root = Math.sqrt(r1);
    const wa = 1 - root;
    const wb = root * (1 - r2);
    const wc = root * r2;
    points.push([
      triangle.a[0] * wa + triangle.b[0] * wb + triangle.c[0] * wc,
      triangle.a[1] * wa + triangle.b[1] * wb + triangle.c[1] * wc,
      triangle.a[2] * wa + triangle.b[2] * wb + triangle.c[2] * wc,
    ]);
  }
  return { points, requestedSamples: sampleCount, sampledTriangles: validTriangles.length, sourceTriangles: triangles.length, surfaceArea: totalArea };
}

function bounds(points: SurfacePoint3[]) {
  const minimum: SurfacePoint3 = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const maximum: SurfacePoint3 = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (const point of points) for (let axis = 0; axis < 3; axis += 1) {
    minimum[axis] = Math.min(minimum[axis], point[axis]);
    maximum[axis] = Math.max(maximum[axis], point[axis]);
  }
  const size: SurfacePoint3 = [maximum[0] - minimum[0], maximum[1] - minimum[1], maximum[2] - minimum[2]];
  if (size.some((value) => !Number.isFinite(value) || value <= Number.EPSILON)) {
    throw new Error('Surface point cloud has an empty or degenerate axis.');
  }
  return { minimum, maximum, size };
}

function normalizePoints(points: SurfacePoint3[], measuredBounds: ReturnType<typeof bounds>): SurfacePoint3[] {
  const center: SurfacePoint3 = [
    (measuredBounds.minimum[0] + measuredBounds.maximum[0]) / 2,
    (measuredBounds.minimum[1] + measuredBounds.maximum[1]) / 2,
    (measuredBounds.minimum[2] + measuredBounds.maximum[2]) / 2,
  ];
  const uniformScale = Math.max(...measuredBounds.size);
  return points.map((point) => [
    (point[0] - center[0]) / uniformScale,
    (point[1] - center[1]) / uniformScale,
    (point[2] - center[2]) / uniformScale,
  ]);
}

function rotatedYaw(points: SurfacePoint3[], degrees: number): SurfacePoint3[] {
  const angle = degrees * Math.PI / 180;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return points.map(([x, y, z]) => [x * cosine - z * sine, y, x * sine + z * cosine]);
}

interface KdNode {
  point: SurfacePoint3;
  axis: 0 | 1 | 2;
  left?: KdNode;
  right?: KdNode;
}

function buildKdTree(points: SurfacePoint3[], depth = 0): KdNode | undefined {
  if (points.length === 0) return undefined;
  const axis = (depth % 3) as 0 | 1 | 2;
  points.sort((left, right) => left[axis] - right[axis]
    || left[(axis + 1) % 3]! - right[(axis + 1) % 3]!
    || left[(axis + 2) % 3]! - right[(axis + 2) % 3]!);
  const middle = points.length >>> 1;
  return {
    point: points[middle]!, axis,
    left: buildKdTree(points.slice(0, middle), depth + 1),
    right: buildKdTree(points.slice(middle + 1), depth + 1),
  };
}

function nearestSquared(point: SurfacePoint3, node: KdNode | undefined, best = Number.POSITIVE_INFINITY): number {
  if (!node) return best;
  const dx = point[0] - node.point[0];
  const dy = point[1] - node.point[1];
  const dz = point[2] - node.point[2];
  let nearest = Math.min(best, dx * dx + dy * dy + dz * dz);
  const delta = point[node.axis] - node.point[node.axis];
  const near = delta <= 0 ? node.left : node.right;
  const far = delta <= 0 ? node.right : node.left;
  nearest = nearestSquared(point, near, nearest);
  if (delta * delta < nearest) nearest = nearestSquared(point, far, nearest);
  return nearest;
}

function nearestDistances(source: SurfacePoint3[], targetTree: KdNode): number[] {
  return source.map((point) => Math.sqrt(nearestSquared(point, targetTree)));
}

function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))]!;
}

function validatePointCloud(points: SurfacePoint3[], label: string): void {
  if (!Array.isArray(points) || points.length < MIN_SAMPLES || points.length > MAX_SAMPLES
    || points.some((point) => !finitePoint(point))) {
    throw new Error(`${label} point cloud requires ${MIN_SAMPLES}-${MAX_SAMPLES} finite bounded points.`);
  }
}

function spatialBands(
  side: SurfaceSpatialBandCoverage['side'],
  points: SurfacePoint3[],
  distances: number[],
  distanceThreshold: number,
): SurfaceSpatialBandCoverage[] {
  const measured = bounds(points);
  const axes = ['x', 'y', 'z'] as const;
  const bandNames = ['low', 'middle', 'high'] as const;
  return axes.flatMap((axis, axisIndex) => {
    const minimum = measured.minimum[axisIndex];
    const span = measured.size[axisIndex];
    return bandNames.map((band, bandIndex) => {
      const indices = points.flatMap((point, index) => {
        const fraction = (point[axisIndex] - minimum) / span;
        const pointBand = Math.min(2, Math.floor(Math.max(0, fraction) * 3));
        return pointBand === bandIndex ? [index] : [];
      });
      const selected = indices.map((index) => distances[index]!);
      const samples = selected.length;
      return {
        id: `${side}:${axis}-${band}`,
        side,
        axis,
        band,
        samples,
        coverage: samples === 0 ? 0 : selected.filter((value) => value <= distanceThreshold).length / samples,
        meanDistance: samples === 0 ? 0 : selected.reduce((sum, value) => sum + value, 0) / samples,
        p95Distance: samples === 0 ? 0 : percentile(selected, 0.95),
      };
    });
  });
}

function spatialCells(
  side: SurfaceSpatialCellCoverage['side'],
  points: SurfacePoint3[],
  distances: number[],
  distanceThreshold: number,
): SurfaceSpatialCellCoverage[] {
  const measured = bounds(points);
  const bandNames = ['low', 'middle', 'high'] as const;
  const cellDistances = new Map<string, number[]>();
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index]!;
    const bands = point.map((value, axis) => {
      const fraction = (value - measured.minimum[axis]!) / measured.size[axis]!;
      return bandNames[Math.min(2, Math.floor(Math.max(0, fraction) * 3))]!;
    }) as [typeof bandNames[number], typeof bandNames[number], typeof bandNames[number]];
    const key = bands.join('|');
    const values = cellDistances.get(key) ?? [];
    values.push(distances[index]!);
    cellDistances.set(key, values);
  }
  return bandNames.flatMap((x) => bandNames.flatMap((y) => bandNames.map((z) => {
    const selected = cellDistances.get(`${x}|${y}|${z}`) ?? [];
    const samples = selected.length;
    return {
      id: `${side}:cell:x-${x}:y-${y}:z-${z}`,
      side,
      bands: { x, y, z },
      samples,
      coverage: samples === 0 ? 0 : selected.filter((value) => value <= distanceThreshold).length / samples,
      meanDistance: samples === 0 ? 0 : selected.reduce((sum, value) => sum + value, 0) / samples,
      p95Distance: samples === 0 ? 0 : percentile(selected, 0.95),
    };
  })));
}

export function compareSurfaceGeometry(
  referencePoints: SurfacePoint3[],
  candidatePoints: SurfacePoint3[],
  inputOptions: SurfaceGeometryFidelityOptions = {},
): SurfaceGeometryFidelityReport {
  validatePointCloud(referencePoints, 'Reference');
  validatePointCloud(candidatePoints, 'Candidate');
  const options: Required<SurfaceGeometryFidelityOptions> = {
    yawStepDegrees: inputOptions.yawStepDegrees ?? 10,
    distanceThreshold: inputOptions.distanceThreshold ?? 0.04,
    maximumDimensionRelativeError: inputOptions.maximumDimensionRelativeError ?? 0.05,
    maximumRmsChamfer: inputOptions.maximumRmsChamfer ?? 0.05,
    maximumP95Distance: inputOptions.maximumP95Distance ?? 0.1,
    minimumCoverage: inputOptions.minimumCoverage ?? 0.9,
  };
  if (!Number.isInteger(options.yawStepDegrees) || options.yawStepDegrees < 1 || options.yawStepDegrees > 90
    || 360 % options.yawStepDegrees !== 0
    || !Number.isFinite(options.distanceThreshold) || options.distanceThreshold <= 0 || options.distanceThreshold > 1
    || !Number.isFinite(options.maximumDimensionRelativeError) || options.maximumDimensionRelativeError <= 0 || options.maximumDimensionRelativeError > 1
    || !Number.isFinite(options.maximumRmsChamfer) || options.maximumRmsChamfer <= 0 || options.maximumRmsChamfer > 1
    || !Number.isFinite(options.maximumP95Distance) || options.maximumP95Distance <= 0 || options.maximumP95Distance > 1
    || !Number.isFinite(options.minimumCoverage) || options.minimumCoverage <= 0 || options.minimumCoverage > 1) {
    throw new Error('Surface geometry fidelity options are outside their safe bounds.');
  }
  const yawCount = 360 / options.yawStepDegrees;
  const nearestQueries = (referencePoints.length + candidatePoints.length) * yawCount;
  if (!Number.isSafeInteger(nearestQueries) || nearestQueries > MAX_NEAREST_QUERIES) {
    throw new Error(`Surface comparison budget ${nearestQueries} exceeds ${MAX_NEAREST_QUERIES}.`);
  }

  const referenceBounds = bounds(referencePoints);
  const candidateInputBounds = bounds(candidatePoints);
  const normalizedReference = normalizePoints(referencePoints, referenceBounds);
  const normalizedCandidate = normalizePoints(candidatePoints, candidateInputBounds);
  const referenceTree = buildKdTree([...normalizedReference])!;
  let selectedYawDegrees = 0;
  let selectedReferenceDistances: number[] = [];
  let selectedCandidateDistances: number[] = [];
  let selectedRms = Number.POSITIVE_INFINITY;
  for (let yawDegrees = 0; yawDegrees < 360; yawDegrees += options.yawStepDegrees) {
    const candidate = rotatedYaw(normalizedCandidate, yawDegrees);
    const candidateTree = buildKdTree([...candidate])!;
    const referenceDistances = nearestDistances(normalizedReference, candidateTree);
    const candidateDistances = nearestDistances(candidate, referenceTree);
    const meanSquared = (
      referenceDistances.reduce((sum, value) => sum + value * value, 0)
      + candidateDistances.reduce((sum, value) => sum + value * value, 0)
    ) / (referenceDistances.length + candidateDistances.length);
    const rms = Math.sqrt(meanSquared);
    if (rms + Number.EPSILON < selectedRms) {
      selectedRms = rms;
      selectedYawDegrees = yawDegrees;
      selectedReferenceDistances = referenceDistances;
      selectedCandidateDistances = candidateDistances;
    }
  }
  const referenceP95Distance = percentile(selectedReferenceDistances, 0.95);
  const candidateP95Distance = percentile(selectedCandidateDistances, 0.95);
  const candidateBounds = bounds(rotatedYaw(candidatePoints, selectedYawDegrees));
  const dimensionRelativeErrors = referenceBounds.size.map((value, axis) => (
    Math.abs(candidateBounds.size[axis]! - value) / value
  )) as SurfacePoint3;
  const maximumDimensionRelativeError = Math.max(...dimensionRelativeErrors);
  const referenceCoverage = selectedReferenceDistances.filter((value) => value <= options.distanceThreshold).length
    / selectedReferenceDistances.length;
  const candidateCoverage = selectedCandidateDistances.filter((value) => value <= options.distanceThreshold).length
    / selectedCandidateDistances.length;
  const minimumCoverage = Math.min(referenceCoverage, candidateCoverage);
  const alignedCandidate = rotatedYaw(normalizedCandidate, selectedYawDegrees);
  const candidateAlignedNormalizedBounds = bounds(alignedCandidate);
  const referenceSpatialCoverage = spatialBands('reference', normalizedReference, selectedReferenceDistances, options.distanceThreshold);
  const candidateSpatialCoverage = spatialBands('candidate', alignedCandidate, selectedCandidateDistances, options.distanceThreshold);
  const referenceSpatialCells = spatialCells('reference', normalizedReference, selectedReferenceDistances, options.distanceThreshold);
  const candidateSpatialCells = spatialCells('candidate', alignedCandidate, selectedCandidateDistances, options.distanceThreshold);
  const worstBand = [...referenceSpatialCoverage, ...candidateSpatialCoverage]
    .filter((band) => band.samples > 0)
    .sort((left, right) => left.coverage - right.coverage
      || right.meanDistance - left.meanDistance || left.id.localeCompare(right.id))[0]!;
  const populatedCells = [...referenceSpatialCells, ...candidateSpatialCells].filter((cell) => cell.samples > 0);
  const worstCell = populatedCells.sort((left, right) => left.coverage - right.coverage
    || right.meanDistance - left.meanDistance || right.samples - left.samples || left.id.localeCompare(right.id))[0]!;
  const dimensionPass = maximumDimensionRelativeError <= options.maximumDimensionRelativeError;
  const shapePass = selectedRms <= options.maximumRmsChamfer
    && Math.max(referenceP95Distance, candidateP95Distance) <= options.maximumP95Distance
    && minimumCoverage >= options.minimumCoverage;
  const blockers: string[] = [];
  if (!dimensionPass) blockers.push(`Maximum dimension error ${(maximumDimensionRelativeError * 100).toFixed(2)}% exceeds ${(options.maximumDimensionRelativeError * 100).toFixed(2)}%.`);
  if (selectedRms > options.maximumRmsChamfer) blockers.push(`Symmetric RMS Chamfer ${selectedRms.toFixed(4)} exceeds ${options.maximumRmsChamfer.toFixed(4)}.`);
  if (Math.max(referenceP95Distance, candidateP95Distance) > options.maximumP95Distance) blockers.push(`P95 surface distance exceeds ${options.maximumP95Distance.toFixed(4)}.`);
  if (minimumCoverage < options.minimumCoverage) blockers.push(`Minimum surface coverage ${(minimumCoverage * 100).toFixed(1)}% is below ${(options.minimumCoverage * 100).toFixed(1)}%.`);
  return {
    schema: 'morphloom.surface-geometry-fidelity/0.1',
    pass: dimensionPass && shapePass,
    dimensionPass,
    shapePass,
    selectedYawDegrees,
    referenceBounds,
    candidateInputBounds,
    candidateBounds,
    dimensionRelativeErrors,
    maximumDimensionRelativeError,
    symmetricRmsChamfer: selectedRms,
    referenceP95Distance,
    candidateP95Distance,
    minimumCoverage,
    referenceCoverage,
    candidateCoverage,
    spatialCoverage: {
      reference: referenceSpatialCoverage,
      candidate: candidateSpatialCoverage,
      worstBand,
      referenceCells: referenceSpatialCells,
      candidateCells: candidateSpatialCells,
      worstCell,
      candidateAlignedNormalizedBounds,
    },
    thresholds: options,
    blockers,
    limitation: 'Uniform translation, scale, and bounded yaw are removed only for shape distance; raw axis dimensions remain an independent blocking gate. Surface sampling does not prove semantic part identity, hidden interfaces, or material fidelity.',
  };
}
