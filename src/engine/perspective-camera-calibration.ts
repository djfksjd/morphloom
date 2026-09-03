import type { OrthographicCameraAnchor } from './orthographic-camera-calibration';

export interface PerspectiveCameraCalibration {
  status: 'calibrated' | 'blocked';
  /** Row-major 3×4 projection matrix in normalized world/image coordinates. */
  projectionMatrix: [number, number, number, number, number, number, number, number, number, number, number, number];
  worldCenter: [number, number, number];
  worldScale: number;
  imageCenter: [number, number];
  imageScale: number;
  rmsReprojectionErrorPixels: number;
  maximumReprojectionErrorPixels: number;
  anchorCount: number;
  blockers: string[];
}

const MINIMUM_ANCHORS = 6;
const MAXIMUM_ANCHORS = 512;
const MAXIMUM_COORDINATE = 1e9;
const MINIMUM_SPREAD = 1e-9;
const MINIMUM_PIVOT = 1e-10;
const MINIMUM_DEPTH = 1e-7;

function finiteBounded(value: number): boolean {
  return Number.isFinite(value) && Math.abs(value) <= MAXIMUM_COORDINATE;
}

function solveLinearSystem(matrix: number[][], right: number[]): number[] | undefined {
  const size = right.length;
  const augmented = matrix.map((row, index) => [...row, right[index]!]);
  for (let column = 0; column < size; column += 1) {
    let pivotRow = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row]![column]!) > Math.abs(augmented[pivotRow]![column]!)) pivotRow = row;
    }
    const pivot = augmented[pivotRow]![column]!;
    if (!Number.isFinite(pivot) || Math.abs(pivot) <= MINIMUM_PIVOT) return undefined;
    [augmented[column], augmented[pivotRow]] = [augmented[pivotRow]!, augmented[column]!];
    for (let index = column; index <= size; index += 1) augmented[column]![index] /= pivot;
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = augmented[row]![column]!;
      if (factor === 0) continue;
      for (let index = column; index <= size; index += 1) {
        augmented[row]![index] -= factor * augmented[column]![index]!;
      }
    }
  }
  const solution = augmented.map((row) => row[size]!);
  return solution.every(Number.isFinite) ? solution : undefined;
}

function weightedCenter(
  anchors: OrthographicCameraAnchor[],
  select: (anchor: OrthographicCameraAnchor) => readonly number[],
): number[] {
  const dimensions = select(anchors[0]!).length;
  const result = Array.from({ length: dimensions }, () => 0);
  let weightSum = 0;
  for (const anchor of anchors) {
    const weight = anchor.confidence ?? 1;
    const values = select(anchor);
    for (let index = 0; index < dimensions; index += 1) result[index] += weight * values[index]!;
    weightSum += weight;
  }
  return result.map((value) => value / weightSum);
}

function weightedScale(
  anchors: OrthographicCameraAnchor[],
  center: readonly number[],
  select: (anchor: OrthographicCameraAnchor) => readonly number[],
): number {
  let squared = 0;
  let weightSum = 0;
  for (const anchor of anchors) {
    const weight = anchor.confidence ?? 1;
    const values = select(anchor);
    squared += weight * values.reduce((sum, value, index) => sum + (value - center[index]!) ** 2, 0);
    weightSum += weight;
  }
  return Math.sqrt(squared / weightSum);
}

export function projectWithPerspectiveCamera(
  calibration: Pick<PerspectiveCameraCalibration, 'projectionMatrix' | 'worldCenter' | 'worldScale' | 'imageCenter' | 'imageScale'>,
  world: readonly [number, number, number],
): [number, number] | undefined {
  if (!world.every(finiteBounded) || !Number.isFinite(calibration.worldScale) || calibration.worldScale <= 0
    || !Number.isFinite(calibration.imageScale) || calibration.imageScale <= 0) return undefined;
  const x = (world[0] - calibration.worldCenter[0]) / calibration.worldScale;
  const y = (world[1] - calibration.worldCenter[1]) / calibration.worldScale;
  const z = (world[2] - calibration.worldCenter[2]) / calibration.worldScale;
  const matrix = calibration.projectionMatrix;
  const depth = matrix[8] * x + matrix[9] * y + matrix[10] * z + matrix[11];
  if (!Number.isFinite(depth) || depth <= MINIMUM_DEPTH) return undefined;
  const normalizedU = (matrix[0] * x + matrix[1] * y + matrix[2] * z + matrix[3]) / depth;
  const normalizedV = (matrix[4] * x + matrix[5] * y + matrix[6] * z + matrix[7]) / depth;
  const projected: [number, number] = [
    calibration.imageCenter[0] + normalizedU * calibration.imageScale,
    calibration.imageCenter[1] + normalizedV * calibration.imageScale,
  ];
  return projected.every(Number.isFinite) ? projected : undefined;
}

/**
 * Reconstructs a bounded pinhole projection from non-coplanar 3D↔2D anchors.
 * The normalized DLT fixes the denominator at the weighted 3D centroid, then
 * verifies positive projective depth and the supplied pixel-error ceiling.
 */
export function calibratePerspectiveCamera(
  anchors: OrthographicCameraAnchor[],
  maximumRmsReprojectionErrorPixels = 3,
): PerspectiveCameraCalibration {
  if (!Array.isArray(anchors) || anchors.length < MINIMUM_ANCHORS || anchors.length > MAXIMUM_ANCHORS) {
    throw new Error(`Perspective camera calibration requires ${MINIMUM_ANCHORS}–${MAXIMUM_ANCHORS} anchors.`);
  }
  if (!Number.isFinite(maximumRmsReprojectionErrorPixels)
    || maximumRmsReprojectionErrorPixels <= 0 || maximumRmsReprojectionErrorPixels > 1_000) {
    throw new Error('Perspective camera reprojection threshold is invalid.');
  }
  const ids = new Set<string>();
  for (const anchor of anchors) {
    if (typeof anchor.id !== 'string' || !anchor.id.trim() || anchor.id.length > 96 || ids.has(anchor.id)) {
      throw new Error('Perspective camera anchor ids must be unique and bounded.');
    }
    ids.add(anchor.id);
    if (!Array.isArray(anchor.world) || anchor.world.length !== 3 || !anchor.world.every(finiteBounded)
      || !Array.isArray(anchor.image) || anchor.image.length !== 2 || !anchor.image.every(finiteBounded)) {
      throw new Error(`Perspective camera anchor ${anchor.id} has invalid coordinates.`);
    }
    const confidence = anchor.confidence ?? 1;
    if (!Number.isFinite(confidence) || confidence <= 0 || confidence > 1) {
      throw new Error(`Perspective camera anchor ${anchor.id} confidence must be in (0, 1].`);
    }
  }

  const worldCenter = weightedCenter(anchors, (anchor) => anchor.world) as [number, number, number];
  const imageCenter = weightedCenter(anchors, (anchor) => anchor.image) as [number, number];
  const worldScale = weightedScale(anchors, worldCenter, (anchor) => anchor.world);
  const imageScale = weightedScale(anchors, imageCenter, (anchor) => anchor.image);
  const blockers: string[] = [];
  if (!Number.isFinite(worldScale) || worldScale <= MINIMUM_SPREAD) blockers.push('3D anchors have insufficient spatial spread');
  if (!Number.isFinite(imageScale) || imageScale <= MINIMUM_SPREAD) blockers.push('2D anchors have insufficient image spread');

  const size = 11;
  const normal = Array.from({ length: size }, () => Array.from({ length: size }, () => 0));
  const right = Array.from({ length: size }, () => 0);
  if (blockers.length === 0) for (const anchor of anchors) {
    const x = (anchor.world[0] - worldCenter[0]) / worldScale;
    const y = (anchor.world[1] - worldCenter[1]) / worldScale;
    const z = (anchor.world[2] - worldCenter[2]) / worldScale;
    const u = (anchor.image[0] - imageCenter[0]) / imageScale;
    const v = (anchor.image[1] - imageCenter[1]) / imageScale;
    const rows = [
      { coefficients: [x, y, z, 1, 0, 0, 0, 0, -u * x, -u * y, -u * z], value: u },
      { coefficients: [0, 0, 0, 0, x, y, z, 1, -v * x, -v * y, -v * z], value: v },
    ];
    const weight = anchor.confidence ?? 1;
    for (const row of rows) for (let left = 0; left < size; left += 1) {
      right[left] += weight * row.coefficients[left]! * row.value;
      for (let column = 0; column < size; column += 1) {
        normal[left]![column] += weight * row.coefficients[left]! * row.coefficients[column]!;
      }
    }
  }
  const solution = blockers.length === 0 ? solveLinearSystem(normal, right) : undefined;
  if (!solution) blockers.push('anchor geometry does not constrain a non-coplanar perspective camera');
  const projectionMatrix = [
    ...(solution?.slice(0, 8) ?? Array.from({ length: 8 }, () => 0)),
    ...(solution?.slice(8, 11) ?? Array.from({ length: 3 }, () => 0)),
    1,
  ] as PerspectiveCameraCalibration['projectionMatrix'];

  let squaredError = 0;
  let maximumError = 0;
  let weightSum = 0;
  if (solution) for (const anchor of anchors) {
    const projected = projectWithPerspectiveCamera({ projectionMatrix, worldCenter, worldScale, imageCenter, imageScale }, anchor.world);
    if (!projected) {
      blockers.push(`anchor ${anchor.id} has non-positive or unstable projective depth`);
      continue;
    }
    const error = Math.hypot(projected[0] - anchor.image[0], projected[1] - anchor.image[1]);
    const weight = anchor.confidence ?? 1;
    squaredError += weight * error * error;
    weightSum += weight;
    maximumError = Math.max(maximumError, error);
  }
  const rms = solution && weightSum > 0 ? Math.sqrt(squaredError / weightSum) : Number.POSITIVE_INFINITY;
  if (rms > maximumRmsReprojectionErrorPixels) {
    blockers.push(`camera reprojection RMS ${rms.toFixed(3)} px exceeds ${maximumRmsReprojectionErrorPixels.toFixed(3)} px`);
  }
  return {
    status: blockers.length === 0 ? 'calibrated' : 'blocked',
    projectionMatrix,
    worldCenter,
    worldScale,
    imageCenter,
    imageScale,
    rmsReprojectionErrorPixels: rms,
    maximumReprojectionErrorPixels: maximumError,
    anchorCount: anchors.length,
    blockers: [...new Set(blockers)],
  };
}
