export interface OrthographicExtentObservation {
  id: string;
  azimuthDegrees: number;
  projectedWidth: number;
  confidence?: number;
}

export interface OrthographicPlanExtentAudit {
  status: 'inferred' | 'blocked';
  xExtent: number;
  zExtent: number;
  rmsResidual: number;
  normalizedRmsResidual: number;
  maximumResidual: number;
  observations: number;
  blockers: string[];
}

export interface ForegroundBandBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
  pixels: number;
}

const MAXIMUM_OBSERVATIONS = 24;
const MAXIMUM_MASK_PIXELS = 16_777_216;
const MINIMUM_NORMAL_DETERMINANT = 1e-6;

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

/**
 * Infers a rigid object's plan extents from calibrated orthographic widths.
 * For azimuth θ, the silhouette width of an axis-aligned X×Z envelope is
 * |cos θ|X + |sin θ|Z. The bounded weighted least-squares solve is useful for
 * blockout dimensions; concavities and perspective still require stronger evidence.
 */
export function inferOrthographicPlanExtents(
  observations: OrthographicExtentObservation[],
  maximumNormalizedRmsResidual = 0.12,
): OrthographicPlanExtentAudit {
  if (!Array.isArray(observations) || observations.length < 2 || observations.length > MAXIMUM_OBSERVATIONS) {
    throw new Error(`Orthographic extent inference requires 2–${MAXIMUM_OBSERVATIONS} observations.`);
  }
  if (!Number.isFinite(maximumNormalizedRmsResidual)
    || maximumNormalizedRmsResidual <= 0 || maximumNormalizedRmsResidual > 1) {
    throw new Error('Orthographic extent residual threshold must be in (0, 1].');
  }

  const ids = new Set<string>();
  let aa = 0;
  let ab = 0;
  let bb = 0;
  let aw = 0;
  let bw = 0;
  let weightSum = 0;
  for (const observation of observations) {
    if (typeof observation.id !== 'string' || !observation.id.trim() || observation.id.length > 96
      || ids.has(observation.id)) throw new Error('Orthographic extent observation ids must be unique and bounded.');
    ids.add(observation.id);
    if (!Number.isFinite(observation.azimuthDegrees) || Math.abs(observation.azimuthDegrees) > 1_000_000
      || !finitePositive(observation.projectedWidth)) {
      throw new Error(`Orthographic extent observation ${observation.id} is invalid.`);
    }
    const confidence = observation.confidence ?? 1;
    if (!finitePositive(confidence) || confidence > 1) {
      throw new Error(`Orthographic extent confidence ${observation.id} must be in (0, 1].`);
    }
    const angle = observation.azimuthDegrees * Math.PI / 180;
    const a = Math.abs(Math.cos(angle));
    const b = Math.abs(Math.sin(angle));
    aa += confidence * a * a;
    ab += confidence * a * b;
    bb += confidence * b * b;
    aw += confidence * a * observation.projectedWidth;
    bw += confidence * b * observation.projectedWidth;
    weightSum += confidence;
  }

  const determinant = aa * bb - ab * ab;
  const blockers: string[] = [];
  if (determinant <= MINIMUM_NORMAL_DETERMINANT) blockers.push('view azimuths do not constrain both X and Z extents');
  const xExtent = determinant > MINIMUM_NORMAL_DETERMINANT ? (aw * bb - bw * ab) / determinant : 0;
  const zExtent = determinant > MINIMUM_NORMAL_DETERMINANT ? (bw * aa - aw * ab) / determinant : 0;
  if (!finitePositive(xExtent) || !finitePositive(zExtent)) blockers.push('inferred plan extents are not positive and finite');

  let squaredResidual = 0;
  let maximumResidual = 0;
  let weightedWidth = 0;
  if (blockers.length === 0) {
    for (const observation of observations) {
      const confidence = observation.confidence ?? 1;
      const angle = observation.azimuthDegrees * Math.PI / 180;
      const predicted = Math.abs(Math.cos(angle)) * xExtent + Math.abs(Math.sin(angle)) * zExtent;
      const residual = Math.abs(predicted - observation.projectedWidth);
      squaredResidual += confidence * residual * residual;
      maximumResidual = Math.max(maximumResidual, residual);
      weightedWidth += confidence * observation.projectedWidth;
    }
  }
  const rmsResidual = blockers.length === 0 ? Math.sqrt(squaredResidual / weightSum) : Number.POSITIVE_INFINITY;
  const meanWidth = weightedWidth / Math.max(weightSum, Number.EPSILON);
  const normalizedRmsResidual = blockers.length === 0 ? rmsResidual / Math.max(meanWidth, Number.EPSILON) : Number.POSITIVE_INFINITY;
  if (normalizedRmsResidual > maximumNormalizedRmsResidual) {
    blockers.push(`orthographic width residual ${(normalizedRmsResidual * 100).toFixed(2)}% exceeds ${(maximumNormalizedRmsResidual * 100).toFixed(2)}%`);
  }

  return {
    status: blockers.length === 0 ? 'inferred' : 'blocked',
    xExtent: blockers.length === 0 ? xExtent : 0,
    zExtent: blockers.length === 0 ? zExtent : 0,
    rmsResidual,
    normalizedRmsResidual,
    maximumResidual,
    observations: observations.length,
    blockers,
  };
}

/** Measures foreground only inside a bounded horizontal image band. */
export function measureForegroundBand(
  mask: Uint8Array,
  width: number,
  height: number,
  startFraction: number,
  endFraction: number,
): ForegroundBandBounds | undefined {
  if (!(mask instanceof Uint8Array) || !Number.isInteger(width) || !Number.isInteger(height)
    || width < 1 || height < 1 || width * height > MAXIMUM_MASK_PIXELS || mask.length !== width * height) {
    throw new Error('Foreground band mask dimensions are invalid or unsafe.');
  }
  if (!Number.isFinite(startFraction) || !Number.isFinite(endFraction)
    || startFraction < 0 || endFraction > 1 || startFraction >= endFraction) {
    throw new Error('Foreground band fractions must satisfy 0 <= start < end <= 1.');
  }
  const startY = Math.max(0, Math.floor(height * startFraction));
  const endY = Math.min(height, Math.ceil(height * endFraction));
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let pixels = 0;
  for (let y = startY; y < endY; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      if (mask[row + x] !== 1) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      pixels += 1;
    }
  }
  if (pixels === 0) return undefined;
  return { minX, minY, maxX, maxY, width: maxX - minX + 1, height: maxY - minY + 1, pixels };
}
