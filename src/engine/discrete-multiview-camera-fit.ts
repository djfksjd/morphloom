import {
  auditCameraPoseEvidence,
  type CameraPoseEvidenceAudit,
  type CameraPoseEvidenceContract,
} from './camera-pose-evidence';

export interface CameraFitCandidate {
  azimuthDegrees: number;
  gateMargin: number;
  wholeIoU: number;
  primaryMassIoU: number;
  thinFeatureScore: number;
  /** Stable identifier for projection, elevation, distance, and lens settings. */
  cameraModelId?: string;
}

export interface CameraFitView {
  id: string;
  candidates: CameraFitCandidate[];
}

export interface DiscreteMultiviewCameraFit {
  pass: boolean;
  views: Array<{ id: string; candidate: CameraFitCandidate }>;
  minimumGateMargin: number;
  meanGateMargin: number;
  stepDegrees: number[];
  selectedCameraModelId?: string;
  poseEvidenceAudit?: CameraPoseEvidenceAudit;
  /** Candidate-scored fitting is diagnostic and cannot calibrate its own comparison camera. */
  sameCameraVisualClaimAllowed: false;
  blockers: string[];
}

const MAX_VIEWS = 12;
const MAX_CANDIDATES = 360;
const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,95}$/;

const normalized = (degrees: number): number => ((degrees % 360) + 360) % 360;
const forwardDelta = (from: number, to: number): number => normalized(to - from);

function better(
  left: { minimum: number; sum: number } | undefined,
  right: { minimum: number; sum: number },
): boolean {
  return !left || right.minimum > left.minimum + 1e-12
    || (Math.abs(right.minimum - left.minimum) <= 1e-12 && right.sum > left.sum);
}

/**
 * Fits independently captured turntable views without assuming exact 90 degree
 * camera spacing. The dynamic program only permits a forward cyclic ordering,
 * bounded adjacent rotation, and a closed final step, preventing mirrored or
 * arbitrarily reordered views from winning on silhouette score alone.
 */
export function fitDiscreteMultiviewCameras(
  views: CameraFitView[],
  options: {
    minimumStepDegrees?: number;
    maximumStepDegrees?: number;
    requirePositiveMargin?: boolean;
    /** Known capture rotation between each ordered view, including the closing step. */
    expectedStepDegrees?: number | number[];
    maximumStepDeviationDegrees?: number;
    requireSharedCameraModel?: boolean;
    poseEvidence?: {
      contract: CameraPoseEvidenceContract;
      expectedSourceFingerprints: Readonly<Record<string, string>>;
    };
  } = {},
): DiscreteMultiviewCameraFit {
  if (!Array.isArray(views) || views.length < 3 || views.length > MAX_VIEWS) {
    throw new Error(`Camera fitting requires 3–${MAX_VIEWS} ordered views.`);
  }
  const minimumStepDegrees = options.minimumStepDegrees ?? 40;
  const maximumStepDegrees = options.maximumStepDegrees ?? 140;
  if (!Number.isFinite(minimumStepDegrees) || !Number.isFinite(maximumStepDegrees)
    || minimumStepDegrees <= 0 || maximumStepDegrees >= 180 || minimumStepDegrees >= maximumStepDegrees) {
    throw new Error('Camera fitting step bounds are invalid.');
  }
  const poseEvidenceAudit = options.poseEvidence === undefined
    ? undefined
    : auditCameraPoseEvidence(options.poseEvidence.contract, options.poseEvidence.expectedSourceFingerprints);
  if (poseEvidenceAudit && !poseEvidenceAudit.pass) {
    throw new Error(`Camera-pose evidence is invalid: ${poseEvidenceAudit.blockers.join('; ')}`);
  }
  const evidenceSteps = poseEvidenceAudit?.relativePoseVerified ? poseEvidenceAudit.expectedStepDegrees : undefined;
  const declaredExpectedSteps = options.expectedStepDegrees === undefined
    ? undefined
    : Array.isArray(options.expectedStepDegrees)
      ? options.expectedStepDegrees
      : Array.from({ length: views.length }, () => options.expectedStepDegrees as number);
  if (evidenceSteps && declaredExpectedSteps
    && evidenceSteps.some((step, index) => Math.abs(step - declaredExpectedSteps[index]!) > 1e-6)) {
    throw new Error('Explicit camera steps disagree with bound pose evidence.');
  }
  const expectedSteps = evidenceSteps ?? declaredExpectedSteps;
  const maximumStepDeviationDegrees = options.maximumStepDeviationDegrees ?? 20;
  if (expectedSteps && (expectedSteps.length !== views.length
    || expectedSteps.some((step) => !Number.isFinite(step) || step <= 0 || step >= 180)
    || !Number.isFinite(maximumStepDeviationDegrees) || maximumStepDeviationDegrees < 0
    || maximumStepDeviationDegrees >= 90)) {
    throw new Error('Expected camera-fit rotation steps are invalid.');
  }
  const acceptsStep = (step: number, index: number): boolean => step >= minimumStepDegrees && step <= maximumStepDegrees
    && (!expectedSteps || Math.abs(step - expectedSteps[index]!) <= maximumStepDeviationDegrees);
  const ids = new Set<string>();
  const sanitized = views.map((view) => {
    if (!view.id?.trim() || view.id.length > 96 || ids.has(view.id)) throw new Error('Camera fit view ids must be unique and bounded.');
    ids.add(view.id);
    if (!Array.isArray(view.candidates) || view.candidates.length < 1 || view.candidates.length > MAX_CANDIDATES) {
      throw new Error(`${view.id} camera candidates must contain 1–${MAX_CANDIDATES} entries.`);
    }
    const angleAndCameraModels = new Set<string>();
    const candidates = view.candidates.map((candidate) => {
      if (![candidate.azimuthDegrees, candidate.gateMargin, candidate.wholeIoU,
        candidate.primaryMassIoU, candidate.thinFeatureScore].every(Number.isFinite)) {
        throw new Error(`${view.id} contains a non-finite camera score.`);
      }
      if ([candidate.wholeIoU, candidate.primaryMassIoU, candidate.thinFeatureScore]
        .some((value) => value < 0 || value > 1)) throw new Error(`${view.id} contains an invalid fidelity score.`);
      if (candidate.cameraModelId !== undefined && !SAFE_ID.test(candidate.cameraModelId)) {
        throw new Error(`${view.id} contains an invalid camera model id.`);
      }
      if (options.requireSharedCameraModel && candidate.cameraModelId === undefined) {
        throw new Error(`${view.id} camera candidates require a shared camera model id.`);
      }
      const azimuthDegrees = normalized(candidate.azimuthDegrees);
      const key = `${Math.round(azimuthDegrees * 1e6)}|${candidate.cameraModelId ?? ''}`;
      if (angleAndCameraModels.has(key)) throw new Error(`${view.id} contains duplicate camera angle/model pairs.`);
      angleAndCameraModels.add(key);
      return { ...candidate, azimuthDegrees };
    }).sort((left, right) => left.azimuthDegrees - right.azimuthDegrees);
    return { id: view.id, candidates };
  });

  type State = { minimum: number; sum: number; path: number[] };
  let winner: State | undefined;
  for (let firstIndex = 0; firstIndex < sanitized[0]!.candidates.length; firstIndex += 1) {
    const first = sanitized[0]!.candidates[firstIndex]!;
    let states = new Map<number, State>([[firstIndex, {
      minimum: first.gateMargin, sum: first.gateMargin, path: [firstIndex],
    }]]);
    for (let viewIndex = 1; viewIndex < sanitized.length; viewIndex += 1) {
      const priorCandidates = sanitized[viewIndex - 1]!.candidates;
      const candidates = sanitized[viewIndex]!.candidates;
      const next = new Map<number, State>();
      for (const [priorIndex, state] of states) {
        for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
          const step = forwardDelta(priorCandidates[priorIndex]!.azimuthDegrees, candidates[candidateIndex]!.azimuthDegrees);
          if (!acceptsStep(step, viewIndex - 1)) continue;
          const candidate = candidates[candidateIndex]!;
          if (options.requireSharedCameraModel && candidate.cameraModelId !== first.cameraModelId) continue;
          const proposed = {
            minimum: Math.min(state.minimum, candidate.gateMargin),
            sum: state.sum + candidate.gateMargin,
            path: [...state.path, candidateIndex],
          };
          if (better(next.get(candidateIndex), proposed)) next.set(candidateIndex, proposed);
        }
      }
      states = next;
      if (states.size === 0) break;
    }
    for (const [lastIndex, state] of states) {
      const last = sanitized.at(-1)!.candidates[lastIndex]!;
      const closure = forwardDelta(last.azimuthDegrees, first.azimuthDegrees);
      if (!acceptsStep(closure, sanitized.length - 1)) continue;
      if (better(winner, state)) winner = state;
    }
  }

  if (!winner) return {
    pass: false, views: [], minimumGateMargin: Number.NEGATIVE_INFINITY,
    meanGateMargin: Number.NEGATIVE_INFINITY, stepDegrees: [],
    poseEvidenceAudit,
    sameCameraVisualClaimAllowed: false,
    blockers: ['No ordered cyclic camera solution satisfies the rotation-step bounds.'],
  };
  const selected = winner.path.map((candidateIndex, viewIndex) => ({
    id: sanitized[viewIndex]!.id,
    candidate: sanitized[viewIndex]!.candidates[candidateIndex]!,
  }));
  const stepDegrees = selected.map((entry, index) => forwardDelta(
    entry.candidate.azimuthDegrees,
    selected[(index + 1) % selected.length]!.candidate.azimuthDegrees,
  ));
  const blockers = options.requirePositiveMargin !== false && winner.minimum < 0
    ? [`Worst-view gate margin ${winner.minimum.toFixed(3)} is below zero.`] : [];
  return {
    pass: blockers.length === 0,
    views: selected,
    minimumGateMargin: winner.minimum,
    meanGateMargin: winner.sum / selected.length,
    stepDegrees,
    selectedCameraModelId: options.requireSharedCameraModel ? selected[0]!.candidate.cameraModelId : undefined,
    poseEvidenceAudit,
    sameCameraVisualClaimAllowed: false,
    blockers,
  };
}
