export interface ThinFeatureEndpointObservation {
  viewId: string;
  azimuthDegrees: number;
  /** Orthographic horizontal coordinate in millimetres relative to the calibrated object centre. */
  horizontalMm: number;
  /** Orthographic vertical coordinate in millimetres relative to the calibrated object centre. */
  verticalMm: number;
  confidence: number;
}

export interface ThinFeatureSegmentEvidence {
  id: string;
  radiusMm: number;
  start: ThinFeatureEndpointObservation[];
  end: ThinFeatureEndpointObservation[];
  maximumResidualMm?: number;
}

export interface ReconstructedThinFeature {
  id: string;
  status: 'reconstructed' | 'blocked';
  start?: [number, number, number];
  end?: [number, number, number];
  radiusMm: number;
  maximumResidualMm: number;
  confidence: number;
  blockers: string[];
  geometry?: {
    op: 'tube';
    points: Array<[number, number, number]>;
    radius: number;
    tubularSegments: number;
    radialSegments: number;
  };
}

const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,95}$/;
const MAX_OBSERVATIONS = 24;

function solveEndpoint(
  observations: ThinFeatureEndpointObservation[],
  maximumResidualMm: number,
): { point?: [number, number, number]; residual: number; confidence: number; blockers: string[] } {
  const blockers: string[] = [];
  if (!Array.isArray(observations) || observations.length < 2 || observations.length > MAX_OBSERVATIONS) {
    return { residual: Number.POSITIVE_INFINITY, confidence: 0, blockers: ['endpoint requires 2–24 calibrated observations'] };
  }
  const viewIds = new Set<string>();
  let aa = 0;
  let ab = 0;
  let bb = 0;
  let au = 0;
  let bu = 0;
  let vertical = 0;
  let weightSum = 0;
  for (const observation of observations) {
    if (!SAFE_ID.test(observation.viewId) || viewIds.has(observation.viewId)
      || !Number.isFinite(observation.azimuthDegrees) || observation.azimuthDegrees < 0 || observation.azimuthDegrees >= 360
      || !Number.isFinite(observation.horizontalMm) || !Number.isFinite(observation.verticalMm)
      || !Number.isFinite(observation.confidence) || observation.confidence <= 0 || observation.confidence > 1) {
      blockers.push('endpoint observations contain invalid or duplicate calibrated evidence');
      continue;
    }
    viewIds.add(observation.viewId);
    const angle = observation.azimuthDegrees * Math.PI / 180;
    const a = Math.cos(angle);
    const b = -Math.sin(angle);
    const weight = observation.confidence;
    aa += weight * a * a;
    ab += weight * a * b;
    bb += weight * b * b;
    au += weight * a * observation.horizontalMm;
    bu += weight * b * observation.horizontalMm;
    vertical += weight * observation.verticalMm;
    weightSum += weight;
  }
  if (blockers.length > 0 || viewIds.size !== observations.length) return { residual: Number.POSITIVE_INFINITY, confidence: 0, blockers };
  const determinant = aa * bb - ab * ab;
  if (!Number.isFinite(determinant) || determinant <= Math.max(1e-9, aa * bb * 1e-6)) {
    return { residual: Number.POSITIVE_INFINITY, confidence: 0, blockers: ['endpoint views do not constrain both horizontal axes'] };
  }
  const x = (au * bb - bu * ab) / determinant;
  const z = (aa * bu - ab * au) / determinant;
  const y = vertical / weightSum;
  let residualSum = 0;
  let maximumObservedResidual = 0;
  for (const observation of observations) {
    const angle = observation.azimuthDegrees * Math.PI / 180;
    const predictedHorizontal = x * Math.cos(angle) - z * Math.sin(angle);
    const horizontalResidual = predictedHorizontal - observation.horizontalMm;
    const verticalResidual = y - observation.verticalMm;
    const residual = Math.hypot(horizontalResidual, verticalResidual);
    residualSum += observation.confidence * residual * residual;
    maximumObservedResidual = Math.max(maximumObservedResidual, residual);
  }
  const rms = Math.sqrt(residualSum / weightSum);
  if (!Number.isFinite(rms) || maximumObservedResidual > maximumResidualMm) {
    return {
      residual: maximumObservedResidual,
      confidence: 0,
      blockers: [`endpoint reprojection residual ${maximumObservedResidual.toFixed(3)} mm exceeds ${maximumResidualMm.toFixed(3)} mm`],
    };
  }
  const evidenceConfidence = observations.reduce((sum, observation) => sum + observation.confidence, 0) / observations.length;
  const confidence = Math.max(0, Math.min(1, evidenceConfidence * (1 - rms / Math.max(maximumResidualMm, 1e-9))));
  return { point: [x, y, z], residual: maximumObservedResidual, confidence, blockers: [] };
}

export function reconstructThinFeature(evidence: ThinFeatureSegmentEvidence): ReconstructedThinFeature {
  const maximumResidualMm = evidence.maximumResidualMm ?? Math.max(1, evidence.radiusMm * 1.5);
  if (!SAFE_ID.test(evidence.id) || !Number.isFinite(evidence.radiusMm) || evidence.radiusMm <= 0 || evidence.radiusMm > 10_000
    || !Number.isFinite(maximumResidualMm) || maximumResidualMm <= 0 || maximumResidualMm > 100_000) {
    throw new Error('Thin-feature reconstruction evidence is unsafe.');
  }
  const start = solveEndpoint(evidence.start, maximumResidualMm);
  const end = solveEndpoint(evidence.end, maximumResidualMm);
  const blockers = [...start.blockers.map((item) => `start: ${item}`), ...end.blockers.map((item) => `end: ${item}`)];
  if (!start.point || !end.point || blockers.length > 0) return {
    id: evidence.id,
    status: 'blocked',
    radiusMm: evidence.radiusMm,
    maximumResidualMm: Math.max(start.residual, end.residual),
    confidence: 0,
    blockers,
  };
  const length = Math.hypot(
    end.point[0] - start.point[0],
    end.point[1] - start.point[1],
    end.point[2] - start.point[2],
  );
  if (!Number.isFinite(length) || length <= evidence.radiusMm * 2) blockers.push('reconstructed thin feature is shorter than its diameter');
  if (blockers.length > 0) return {
    id: evidence.id,
    status: 'blocked',
    start: start.point,
    end: end.point,
    radiusMm: evidence.radiusMm,
    maximumResidualMm: Math.max(start.residual, end.residual),
    confidence: 0,
    blockers,
  };
  const confidence = Math.min(start.confidence, end.confidence);
  return {
    id: evidence.id,
    status: 'reconstructed',
    start: start.point,
    end: end.point,
    radiusMm: evidence.radiusMm,
    maximumResidualMm: Math.max(start.residual, end.residual),
    confidence,
    blockers: [],
    geometry: {
      op: 'tube', points: [start.point, end.point], radius: evidence.radiusMm,
      tubularSegments: Math.max(8, Math.min(96, Math.ceil(length / Math.max(evidence.radiusMm * 4, 1)))),
      radialSegments: 12,
    },
  };
}
