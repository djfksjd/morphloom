export interface AzimuthSilhouetteObservation {
  id: string;
  azimuthDegrees: number;
  aspectWidthOverHeight: number;
  confidence: number;
}

export interface MultiViewScaleEstimate {
  schema: 'morphloom.multiview-scale/0.1';
  status: 'measured' | 'blocked';
  widthMm: number;
  heightMm: number;
  depthMm: number;
  normalizedRmsResidual: number;
  maximumNormalizedResidual: number;
  confidence: number;
  observations: Array<AzimuthSilhouetteObservation & {
    predictedAspectWidthOverHeight: number;
    normalizedResidual: number;
  }>;
  blockers: string[];
  limitations: string[];
}

const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,95}$/;

function median(values: number[]): number {
  const sorted = values.slice().sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}

function coefficients(azimuthDegrees: number): [number, number] {
  const radians = azimuthDegrees * Math.PI / 180;
  return [Math.abs(Math.cos(radians)), Math.abs(Math.sin(radians))];
}

function solve(
  observations: AzimuthSilhouetteObservation[],
  weights: number[],
  heightMm: number,
): { widthMm: number; depthMm: number; determinant: number } {
  let matrix00 = 0;
  let matrix01 = 0;
  let matrix11 = 0;
  let target0 = 0;
  let target1 = 0;
  observations.forEach((observation, index) => {
    const [widthCoefficient, depthCoefficient] = coefficients(observation.azimuthDegrees);
    const weight = weights[index]!;
    const observedWidthMm = observation.aspectWidthOverHeight * heightMm;
    matrix00 += weight * widthCoefficient * widthCoefficient;
    matrix01 += weight * widthCoefficient * depthCoefficient;
    matrix11 += weight * depthCoefficient * depthCoefficient;
    target0 += weight * widthCoefficient * observedWidthMm;
    target1 += weight * depthCoefficient * observedWidthMm;
  });
  const determinant = matrix00 * matrix11 - matrix01 * matrix01;
  if (determinant <= 1e-9) return { widthMm: Number.NaN, depthMm: Number.NaN, determinant };
  return {
    widthMm: (target0 * matrix11 - target1 * matrix01) / determinant,
    depthMm: (matrix00 * target1 - matrix01 * target0) / determinant,
    determinant,
  };
}

/**
 * Recovers two horizontal dimensions from upright multi-view silhouettes and
 * one trusted height. Each azimuth contributes the orthographic envelope
 * equation |cos(yaw)|·width + |sin(yaw)|·depth. A bounded Huber reweighting
 * prevents one segmentation/camera outlier from dominating the dimensions.
 */
export function inferScaleFromAzimuthSilhouettes(
  observations: AzimuthSilhouetteObservation[],
  knownHeightMm: number,
): MultiViewScaleEstimate {
  if (!Array.isArray(observations) || observations.length < 3 || observations.length > 24
    || !Number.isFinite(knownHeightMm) || knownHeightMm <= 0 || knownHeightMm > 1_000_000) {
    throw new Error('Multi-view scale inputs are unsafe or insufficient.');
  }
  const ids = new Set<string>();
  for (const observation of observations) {
    if (!SAFE_ID.test(observation.id) || ids.has(observation.id)
      || !Number.isFinite(observation.azimuthDegrees) || observation.azimuthDegrees < 0 || observation.azimuthDegrees >= 360
      || !Number.isFinite(observation.aspectWidthOverHeight) || observation.aspectWidthOverHeight <= 0 || observation.aspectWidthOverHeight > 100
      || !Number.isFinite(observation.confidence) || observation.confidence <= 0 || observation.confidence > 1) {
      throw new Error(`Multi-view scale observation ${observation.id} is unsafe.`);
    }
    ids.add(observation.id);
  }
  let weights = observations.map((observation) => observation.confidence);
  let estimate = solve(observations, weights, knownHeightMm);
  for (let iteration = 0; iteration < 3 && Number.isFinite(estimate.widthMm) && Number.isFinite(estimate.depthMm); iteration += 1) {
    const residuals = observations.map((observation) => {
      const [widthCoefficient, depthCoefficient] = coefficients(observation.azimuthDegrees);
      return Math.abs(
        widthCoefficient * estimate.widthMm + depthCoefficient * estimate.depthMm
          - observation.aspectWidthOverHeight * knownHeightMm,
      );
    });
    const robustScale = Math.max(knownHeightMm * 0.005, median(residuals) * 1.4826);
    const huber = robustScale * 1.5;
    weights = observations.map((observation, index) => observation.confidence * Math.min(1, huber / Math.max(huber, residuals[index]!)));
    estimate = solve(observations, weights, knownHeightMm);
  }
  const blockers: string[] = [];
  if (!Number.isFinite(estimate.determinant) || estimate.determinant <= 0.05) blockers.push('view azimuths do not independently constrain width and depth');
  if (!Number.isFinite(estimate.widthMm) || estimate.widthMm <= 0) blockers.push('width could not be recovered from silhouettes');
  if (!Number.isFinite(estimate.depthMm) || estimate.depthMm <= 0) blockers.push('depth could not be recovered from silhouettes');
  const inspected = observations.map((observation) => {
    const [widthCoefficient, depthCoefficient] = coefficients(observation.azimuthDegrees);
    const predicted = (widthCoefficient * estimate.widthMm + depthCoefficient * estimate.depthMm) / knownHeightMm;
    return {
      ...observation,
      predictedAspectWidthOverHeight: predicted,
      normalizedResidual: Math.abs(predicted - observation.aspectWidthOverHeight) / Math.max(1e-9, observation.aspectWidthOverHeight),
    };
  });
  const normalizedRmsResidual = Math.sqrt(inspected.reduce(
    (sum, observation) => sum + observation.normalizedResidual ** 2,
    0,
  ) / inspected.length);
  const maximumNormalizedResidual = Math.max(...inspected.map((observation) => observation.normalizedResidual));
  if (!Number.isFinite(normalizedRmsResidual) || normalizedRmsResidual > 0.12) blockers.push('multi-view silhouette scale residual exceeds 12% RMS');
  if (!Number.isFinite(maximumNormalizedResidual) || maximumNormalizedResidual > 0.25) blockers.push('one or more silhouette views exceed 25% scale residual');
  const meanConfidence = observations.reduce((sum, observation) => sum + observation.confidence, 0) / observations.length;
  const confidence = Math.max(0, Math.min(1, meanConfidence * (1 - Math.min(1, normalizedRmsResidual / 0.2))));
  return {
    schema: 'morphloom.multiview-scale/0.1',
    status: blockers.length === 0 ? 'measured' : 'blocked',
    widthMm: estimate.widthMm,
    heightMm: knownHeightMm,
    depthMm: estimate.depthMm,
    normalizedRmsResidual,
    maximumNormalizedResidual,
    confidence,
    observations: inspected,
    blockers,
    limitations: [
      'The estimate assumes an upright object, an orthographic or long-lens spin, and a trustworthy height anchor.',
      'Concavity, self-occlusion, camera tilt, and independently cropped views still require calibrated-camera verification.',
    ],
  };
}
