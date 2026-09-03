export interface OrthographicLandmark {
  id: string;
  position: [number, number, number];
}

export interface OrthographicLandmarkObservation {
  u: number;
  v: number;
  confidence?: number;
}

export interface OrthographicLandmarkView {
  id: string;
  azimuthDegrees: number;
  projectedBounds: {
    minimumU: number;
    maximumU: number;
    minimumY: number;
    maximumY: number;
  };
  observations: OrthographicLandmarkObservation[];
}

export interface OrthographicLandmarkAssignment {
  viewId: string;
  landmarkId: string;
  observationIndex: number;
  normalizedError: number;
}

export interface OrthographicLandmarkReconstruction {
  status: 'reconstructed' | 'blocked';
  landmarks: OrthographicLandmark[];
  assignments: OrthographicLandmarkAssignment[];
  iterations: number;
  rmsNormalizedError: number;
  maximumNormalizedError: number;
  blockers: string[];
}

export interface OrthographicLandmarkReconstructionOptions {
  maximumIterations?: number;
  maximumRmsNormalizedError?: number;
  maximumNormalizedError?: number;
  preserveInputY?: boolean;
}

const MAX_LANDMARKS = 10;
const MAX_VIEWS = 16;
const MAX_ABSOLUTE_COORDINATE = 1e9;
const MIN_DETERMINANT = 1e-8;

function finiteBounded(value: number): boolean {
  return Number.isFinite(value) && Math.abs(value) <= MAX_ABSOLUTE_COORDINATE;
}

function normalizeDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}

function projectNormalized(
  point: [number, number, number],
  view: OrthographicLandmarkView,
): [number, number] {
  const angle = normalizeDegrees(view.azimuthDegrees) * Math.PI / 180;
  const projectedU = point[0] * Math.cos(angle) - point[2] * Math.sin(angle);
  const bounds = view.projectedBounds;
  return [
    (projectedU - bounds.minimumU) / (bounds.maximumU - bounds.minimumU),
    (bounds.maximumY - point[1]) / (bounds.maximumY - bounds.minimumY),
  ];
}

function minimumAssignment(cost: number[][]): { mapping: number[]; cost: number } {
  const size = cost.length;
  const stateCount = 1 << size;
  const totals = new Float64Array(stateCount);
  totals.fill(Number.POSITIVE_INFINITY);
  totals[0] = 0;
  const previousMask = new Int32Array(stateCount);
  const selectedObservation = new Int16Array(stateCount);
  previousMask.fill(-1);
  selectedObservation.fill(-1);

  for (let mask = 0; mask < stateCount; mask += 1) {
    const base = totals[mask]!;
    if (!Number.isFinite(base)) continue;
    let landmarkIndex = 0;
    for (let bits = mask; bits > 0; bits &= bits - 1) landmarkIndex += 1;
    if (landmarkIndex >= size) continue;
    for (let observationIndex = 0; observationIndex < size; observationIndex += 1) {
      const bit = 1 << observationIndex;
      if ((mask & bit) !== 0) continue;
      const nextMask = mask | bit;
      const nextCost = base + cost[landmarkIndex]![observationIndex]!;
      if (nextCost + Number.EPSILON < totals[nextMask]!) {
        totals[nextMask] = nextCost;
        previousMask[nextMask] = mask;
        selectedObservation[nextMask] = observationIndex;
      }
    }
  }

  const mapping = new Array<number>(size);
  let mask = stateCount - 1;
  for (let landmarkIndex = size - 1; landmarkIndex >= 0; landmarkIndex -= 1) {
    const observationIndex = selectedObservation[mask]!;
    if (observationIndex < 0) throw new Error('Landmark assignment did not resolve a complete matching.');
    mapping[landmarkIndex] = observationIndex;
    mask = previousMask[mask]!;
  }
  return { mapping, cost: totals[stateCount - 1]! };
}

function validateInputs(
  landmarks: OrthographicLandmark[],
  views: OrthographicLandmarkView[],
  options: Required<OrthographicLandmarkReconstructionOptions>,
): void {
  if (!Array.isArray(landmarks) || landmarks.length < 1 || landmarks.length > MAX_LANDMARKS
    || !Array.isArray(views) || views.length < 2 || views.length > MAX_VIEWS) {
    throw new Error(`Landmark reconstruction requires 1-${MAX_LANDMARKS} landmarks and 2-${MAX_VIEWS} views.`);
  }
  if (!Number.isInteger(options.maximumIterations) || options.maximumIterations < 1 || options.maximumIterations > 12
    || !Number.isFinite(options.maximumRmsNormalizedError) || options.maximumRmsNormalizedError <= 0 || options.maximumRmsNormalizedError > 1
    || !Number.isFinite(options.maximumNormalizedError) || options.maximumNormalizedError <= 0 || options.maximumNormalizedError > 2) {
    throw new Error('Landmark reconstruction options are outside their safe bounds.');
  }
  const landmarkIds = new Set<string>();
  for (const landmark of landmarks) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,95}$/.test(landmark.id) || landmarkIds.has(landmark.id)
      || landmark.position.length !== 3 || !landmark.position.every(finiteBounded)) {
      throw new Error(`Landmark ${landmark.id || '<empty>'} is unsafe, duplicate, or non-finite.`);
    }
    landmarkIds.add(landmark.id);
  }
  const viewIds = new Set<string>();
  for (const view of views) {
    const bounds = view.projectedBounds;
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,95}$/.test(view.id) || viewIds.has(view.id)
      || !finiteBounded(view.azimuthDegrees)
      || ![bounds.minimumU, bounds.maximumU, bounds.minimumY, bounds.maximumY].every(finiteBounded)
      || bounds.maximumU <= bounds.minimumU || bounds.maximumY <= bounds.minimumY
      || !Array.isArray(view.observations) || view.observations.length !== landmarks.length) {
      throw new Error(`Landmark view ${view.id || '<empty>'} is unsafe or incomplete.`);
    }
    viewIds.add(view.id);
    for (const observation of view.observations) {
      const confidence = observation.confidence ?? 1;
      if (!Number.isFinite(observation.u) || observation.u < -0.25 || observation.u > 1.25
        || !Number.isFinite(observation.v) || observation.v < -0.25 || observation.v > 1.25
        || !Number.isFinite(confidence) || confidence <= 0 || confidence > 1) {
        throw new Error(`Landmark view ${view.id} contains an unsafe observation.`);
      }
    }
  }
}

export function reconstructUnorderedOrthographicLandmarks(
  inputLandmarks: OrthographicLandmark[],
  views: OrthographicLandmarkView[],
  inputOptions: OrthographicLandmarkReconstructionOptions = {},
): OrthographicLandmarkReconstruction {
  const options: Required<OrthographicLandmarkReconstructionOptions> = {
    maximumIterations: inputOptions.maximumIterations ?? 5,
    maximumRmsNormalizedError: inputOptions.maximumRmsNormalizedError ?? 0.04,
    maximumNormalizedError: inputOptions.maximumNormalizedError ?? 0.1,
    preserveInputY: inputOptions.preserveInputY ?? false,
  };
  validateInputs(inputLandmarks, views, options);
  let landmarks = inputLandmarks.map((landmark) => ({ ...landmark, position: [...landmark.position] as [number, number, number] }));
  let assignments: OrthographicLandmarkAssignment[] = [];
  let previousSignature = '';
  let iterations = 0;
  const blockers: string[] = [];

  for (let iteration = 0; iteration < options.maximumIterations; iteration += 1) {
    iterations = iteration + 1;
    const viewMappings = views.map((view) => {
      const projected = landmarks.map((landmark) => projectNormalized(landmark.position, view));
      const costs = projected.map(([u, v]) => view.observations.map((observation) => {
        const du = u - observation.u;
        const dv = v - observation.v;
        return (du * du + dv * dv) * (observation.confidence ?? 1);
      }));
      return minimumAssignment(costs).mapping;
    });
    const signature = viewMappings.map((mapping) => mapping.join(',')).join('|');
    const next = landmarks.map((landmark, landmarkIndex): OrthographicLandmark => {
      let aa = 0; let ab = 0; let bb = 0; let au = 0; let bu = 0;
      let ySum = 0; let yWeight = 0;
      for (let viewIndex = 0; viewIndex < views.length; viewIndex += 1) {
        const view = views[viewIndex]!;
        const observation = view.observations[viewMappings[viewIndex]![landmarkIndex]!]!;
        const weight = observation.confidence ?? 1;
        const angle = normalizeDegrees(view.azimuthDegrees) * Math.PI / 180;
        const a = Math.cos(angle);
        const b = -Math.sin(angle);
        const bounds = view.projectedBounds;
        const worldU = bounds.minimumU + observation.u * (bounds.maximumU - bounds.minimumU);
        const worldY = bounds.maximumY - observation.v * (bounds.maximumY - bounds.minimumY);
        aa += weight * a * a; ab += weight * a * b; bb += weight * b * b;
        au += weight * a * worldU; bu += weight * b * worldU;
        ySum += weight * worldY; yWeight += weight;
      }
      const determinant = aa * bb - ab * ab;
      if (determinant <= MIN_DETERMINANT || yWeight <= 0) return landmark;
      const x = (au * bb - bu * ab) / determinant;
      const z = (bu * aa - au * ab) / determinant;
      const y = options.preserveInputY ? landmark.position[1] : ySum / yWeight;
      return { id: landmark.id, position: [x, y, z] };
    });
    landmarks = next;
    if (signature === previousSignature) break;
    previousSignature = signature;
  }

  let squaredError = 0;
  let errorCount = 0;
  let maximumNormalizedError = 0;
  assignments = [];
  let normalAa = 0; let normalAb = 0; let normalBb = 0;
  for (const view of views) {
    const angle = normalizeDegrees(view.azimuthDegrees) * Math.PI / 180;
    const a = Math.cos(angle); const b = -Math.sin(angle);
    normalAa += a * a; normalAb += a * b; normalBb += b * b;
    const projected = landmarks.map((landmark) => projectNormalized(landmark.position, view));
    const costs = projected.map(([u, v]) => view.observations.map((observation) => {
      const du = u - observation.u;
      const dv = v - observation.v;
      return du * du + dv * dv;
    }));
    const mapping = minimumAssignment(costs).mapping;
    for (let landmarkIndex = 0; landmarkIndex < landmarks.length; landmarkIndex += 1) {
      const observationIndex = mapping[landmarkIndex]!;
      const error = Math.sqrt(costs[landmarkIndex]![observationIndex]!);
      squaredError += error * error;
      errorCount += 1;
      maximumNormalizedError = Math.max(maximumNormalizedError, error);
      assignments.push({ viewId: view.id, landmarkId: landmarks[landmarkIndex]!.id, observationIndex, normalizedError: error });
    }
  }
  if (normalAa * normalBb - normalAb * normalAb <= MIN_DETERMINANT) {
    blockers.push('View azimuths do not constrain both horizontal world axes.');
  }
  const rmsNormalizedError = Math.sqrt(squaredError / Math.max(errorCount, 1));
  if (rmsNormalizedError > options.maximumRmsNormalizedError) {
    blockers.push(`RMS normalized reprojection error ${rmsNormalizedError.toFixed(4)} exceeds ${options.maximumRmsNormalizedError.toFixed(4)}.`);
  }
  if (maximumNormalizedError > options.maximumNormalizedError) {
    blockers.push(`Maximum normalized reprojection error ${maximumNormalizedError.toFixed(4)} exceeds ${options.maximumNormalizedError.toFixed(4)}.`);
  }
  if (landmarks.some((landmark) => !landmark.position.every(finiteBounded))) {
    blockers.push('Reconstructed landmark coordinates are non-finite or outside the safe range.');
  }

  return {
    status: blockers.length === 0 ? 'reconstructed' : 'blocked',
    landmarks,
    assignments,
    iterations,
    rmsNormalizedError,
    maximumNormalizedError,
    blockers,
  };
}
