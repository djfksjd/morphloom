export interface OrthographicCameraAnchor {
  id: string;
  world: [number, number, number];
  image: [number, number];
  confidence?: number;
}

export interface OrthographicYawCameraCalibration {
  status: 'calibrated' | 'blocked';
  azimuthDegrees: number;
  pixelsPerWorldUnit: number;
  offsetPixels: [number, number];
  rmsReprojectionErrorPixels: number;
  maximumReprojectionErrorPixels: number;
  anchorCount: number;
  blockers: string[];
}

const MAXIMUM_ANCHORS = 512;
const MAXIMUM_COORDINATE = 1e9;
const MINIMUM_DETERMINANT = 1e-9;

function finiteBounded(value: number): boolean {
  return Number.isFinite(value) && Math.abs(value) <= MAXIMUM_COORDINATE;
}

function solveSymmetric3(
  matrix: [[number, number, number], [number, number, number], [number, number, number]],
  right: [number, number, number],
): [number, number, number] | undefined {
  const [a, b, c] = matrix[0];
  const [, d, e] = matrix[1];
  const [, , f] = matrix[2];
  const determinant = a * (d * f - e * e) - b * (b * f - c * e) + c * (b * e - c * d);
  if (!Number.isFinite(determinant) || Math.abs(determinant) <= MINIMUM_DETERMINANT) return undefined;
  const inverse: [[number, number, number], [number, number, number], [number, number, number]] = [
    [(d * f - e * e) / determinant, (c * e - b * f) / determinant, (b * e - c * d) / determinant],
    [(c * e - b * f) / determinant, (a * f - c * c) / determinant, (b * c - a * e) / determinant],
    [(b * e - c * d) / determinant, (b * c - a * e) / determinant, (a * d - b * b) / determinant],
  ];
  return inverse.map((row) => row[0] * right[0] + row[1] * right[1] + row[2] * right[2]) as [number, number, number];
}

export function projectWithOrthographicYawCamera(
  calibration: Pick<OrthographicYawCameraCalibration, 'azimuthDegrees' | 'pixelsPerWorldUnit' | 'offsetPixels'>,
  world: readonly [number, number, number],
): [number, number] {
  const angle = calibration.azimuthDegrees * Math.PI / 180;
  return [
    calibration.offsetPixels[0] + calibration.pixelsPerWorldUnit * (world[0] * Math.cos(angle) - world[2] * Math.sin(angle)),
    calibration.offsetPixels[1] - calibration.pixelsPerWorldUnit * world[1],
  ];
}

/**
 * Calibrates a level orthographic camera from actual 3D↔2D correspondences.
 * It solves horizontal yaw/scale/offset, then verifies that the same scale also
 * explains vertical image coordinates. Perspective or tilted sources fail on
 * reprojection instead of being silently normalized into a good-looking score.
 */
export function calibrateOrthographicYawCamera(
  anchors: OrthographicCameraAnchor[],
  maximumRmsReprojectionErrorPixels = 3,
): OrthographicYawCameraCalibration {
  if (!Array.isArray(anchors) || anchors.length < 4 || anchors.length > MAXIMUM_ANCHORS) {
    throw new Error(`Orthographic camera calibration requires 4–${MAXIMUM_ANCHORS} anchors.`);
  }
  if (!Number.isFinite(maximumRmsReprojectionErrorPixels)
    || maximumRmsReprojectionErrorPixels <= 0 || maximumRmsReprojectionErrorPixels > 1000) {
    throw new Error('Orthographic camera reprojection threshold is invalid.');
  }
  const ids = new Set<string>();
  let xx = 0; let xz = 0; let x1 = 0;
  let zz = 0; let z1 = 0; let one = 0;
  let xu = 0; let zu = 0; let u1 = 0;
  let weightSum = 0;
  for (const anchor of anchors) {
    if (typeof anchor.id !== 'string' || !anchor.id.trim() || anchor.id.length > 96 || ids.has(anchor.id)) {
      throw new Error('Camera calibration anchor ids must be unique and bounded.');
    }
    ids.add(anchor.id);
    if (!Array.isArray(anchor.world) || anchor.world.length !== 3 || !anchor.world.every(finiteBounded)
      || !Array.isArray(anchor.image) || anchor.image.length !== 2 || !anchor.image.every(finiteBounded)) {
      throw new Error(`Camera calibration anchor ${anchor.id} has invalid coordinates.`);
    }
    const confidence = anchor.confidence ?? 1;
    if (!Number.isFinite(confidence) || confidence <= 0 || confidence > 1) {
      throw new Error(`Camera calibration anchor ${anchor.id} confidence must be in (0, 1].`);
    }
    const [x, , z] = anchor.world;
    const [u] = anchor.image;
    xx += confidence * x * x; xz += confidence * x * z; x1 += confidence * x;
    zz += confidence * z * z; z1 += confidence * z; one += confidence;
    xu += confidence * x * u; zu += confidence * z * u; u1 += confidence * u;
    weightSum += confidence;
  }
  const horizontal = solveSymmetric3(
    [[xx, xz, x1], [xz, zz, z1], [x1, z1, one]],
    [xu, zu, u1],
  );
  const blockers: string[] = [];
  if (!horizontal) blockers.push('anchor geometry does not constrain yaw, scale, and horizontal offset');
  const horizontalX = horizontal?.[0] ?? 0;
  const horizontalZ = horizontal?.[1] ?? 0;
  const pixelsPerWorldUnit = Math.hypot(horizontalX, horizontalZ);
  if (!Number.isFinite(pixelsPerWorldUnit) || pixelsPerWorldUnit <= 0) blockers.push('calibrated camera scale is not positive and finite');
  const azimuthDegrees = ((Math.atan2(-horizontalZ, horizontalX) * 180 / Math.PI) % 360 + 360) % 360;
  const offsetX = horizontal?.[2] ?? 0;
  const offsetY = anchors.reduce((sum, anchor) => (
    sum + (anchor.confidence ?? 1) * (anchor.image[1] + pixelsPerWorldUnit * anchor.world[1])
  ), 0) / weightSum;

  let squared = 0;
  let maximum = 0;
  if (blockers.length === 0) for (const anchor of anchors) {
    const predicted = projectWithOrthographicYawCamera({ azimuthDegrees, pixelsPerWorldUnit, offsetPixels: [offsetX, offsetY] }, anchor.world);
    const error = Math.hypot(predicted[0] - anchor.image[0], predicted[1] - anchor.image[1]);
    squared += (anchor.confidence ?? 1) * error * error;
    maximum = Math.max(maximum, error);
  }
  const rms = blockers.length === 0 ? Math.sqrt(squared / weightSum) : Number.POSITIVE_INFINITY;
  if (rms > maximumRmsReprojectionErrorPixels) {
    blockers.push(`camera reprojection RMS ${rms.toFixed(3)} px exceeds ${maximumRmsReprojectionErrorPixels.toFixed(3)} px`);
  }
  return {
    status: blockers.length === 0 ? 'calibrated' : 'blocked',
    azimuthDegrees,
    pixelsPerWorldUnit,
    offsetPixels: [offsetX, offsetY],
    rmsReprojectionErrorPixels: rms,
    maximumReprojectionErrorPixels: maximum,
    anchorCount: anchors.length,
    blockers,
  };
}
