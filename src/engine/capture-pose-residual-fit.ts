export interface CapturePoseResidualCandidate {
  stateId: string;
  residualDegrees: number;
  gateMargin: number;
  wholeIoU: number;
  primaryMassIoU: number;
  thinFeatureScore: number;
}

export interface CapturePoseResidualView {
  id: string;
  lockedStateId: string;
  evidenceStatus: 'measured' | 'estimated' | 'inferred';
  candidates: CapturePoseResidualCandidate[];
}

export interface CapturePoseResidualFitReport {
  schema: 'morphloom.capture-pose-residual-fit/0.1';
  pass: boolean;
  views: Array<{
    id: string;
    evidenceStatus: CapturePoseResidualView['evidenceStatus'];
    locked: CapturePoseResidualCandidate;
    selected: CapturePoseResidualCandidate;
    improvement: number;
  }>;
  minimumGateMargin: number;
  maximumAbsoluteSelectedResidualDegrees: number;
  unverifiedResidualRequired: boolean;
  deliveryClaimAllowed: boolean;
  blockers: string[];
  limitation: string;
}

const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,95}$/;
const MAX_VIEWS = 24;
const MAX_CANDIDATES = 128;

/**
 * Fits a bounded whole-capture yaw residual while leaving the delivered asset
 * untouched. This is intentionally distinct from articulation fitting: every
 * component must receive the same rigid diagnostic transform. A residual
 * inferred from candidate pixels can improve diagnosis, but cannot validate
 * the camera that judges the same candidate.
 */
export function fitBoundedPerViewCapturePoseResiduals(
  views: CapturePoseResidualView[],
  options: {
    minimumGateImprovement?: number;
    maximumAbsoluteResidualDegrees?: number;
    requirePositiveMargin?: boolean;
  } = {},
): CapturePoseResidualFitReport {
  const minimumGateImprovement = options.minimumGateImprovement ?? 0.01;
  const maximumAbsoluteResidualDegrees = options.maximumAbsoluteResidualDegrees ?? 90;
  if (!Array.isArray(views) || views.length < 2 || views.length > MAX_VIEWS
    || !Number.isFinite(minimumGateImprovement) || minimumGateImprovement < 0
    || minimumGateImprovement > 0.5
    || !Number.isFinite(maximumAbsoluteResidualDegrees)
    || maximumAbsoluteResidualDegrees <= 0 || maximumAbsoluteResidualDegrees > 90) {
    throw new Error('Capture-pose residual fit configuration is unsafe.');
  }

  const viewIds = new Set<string>();
  const selectedViews = views.map((view) => {
    if (!SAFE_ID.test(view?.id ?? '') || viewIds.has(view.id)
      || !SAFE_ID.test(view?.lockedStateId ?? '')
      || !['measured', 'estimated', 'inferred'].includes(view?.evidenceStatus)
      || !Array.isArray(view.candidates) || view.candidates.length < 1
      || view.candidates.length > MAX_CANDIDATES) {
      throw new Error('Capture-pose residual views are invalid.');
    }
    viewIds.add(view.id);
    const stateIds = new Set<string>();
    const candidates = view.candidates.map((candidate) => {
      if (!SAFE_ID.test(candidate?.stateId ?? '') || stateIds.has(candidate.stateId)
        || ![candidate.residualDegrees, candidate.gateMargin, candidate.wholeIoU,
          candidate.primaryMassIoU, candidate.thinFeatureScore].every(Number.isFinite)
        || Math.abs(candidate.residualDegrees) > maximumAbsoluteResidualDegrees
        || [candidate.wholeIoU, candidate.primaryMassIoU, candidate.thinFeatureScore]
          .some((score) => score < 0 || score > 1)) {
        throw new Error(`Invalid capture-pose residual candidate in ${view.id}.`);
      }
      stateIds.add(candidate.stateId);
      return candidate;
    });
    const locked = candidates.find((candidate) => candidate.stateId === view.lockedStateId);
    if (!locked || Math.abs(locked.residualDegrees) > 1e-9) {
      throw new Error(`${view.id} is missing its zero-residual locked pose.`);
    }
    const ranked = [...candidates].sort((left, right) => right.gateMargin - left.gateMargin
      || (right.wholeIoU + right.primaryMassIoU + right.thinFeatureScore)
        - (left.wholeIoU + left.primaryMassIoU + left.thinFeatureScore)
      || Math.abs(left.residualDegrees) - Math.abs(right.residualDegrees)
      || left.stateId.localeCompare(right.stateId));
    const winner = ranked[0]!;
    const selected = winner.gateMargin >= locked.gateMargin + minimumGateImprovement
      ? winner : locked;
    return {
      id: view.id, evidenceStatus: view.evidenceStatus, locked, selected,
      improvement: selected.gateMargin - locked.gateMargin,
    };
  });

  const minimumGateMargin = Math.min(...selectedViews.map((view) => view.selected.gateMargin));
  const maximumAbsoluteSelectedResidualDegrees = Math.max(...selectedViews.map((view) => (
    Math.abs(view.selected.residualDegrees)
  )));
  const blockers = options.requirePositiveMargin !== false && minimumGateMargin < 0
    ? [`Worst residual-corrected view gate margin ${minimumGateMargin.toFixed(3)} is below zero.`] : [];
  const unverifiedResidualRequired = selectedViews.some((view) => (
    Math.abs(view.selected.residualDegrees) > 1e-9 && view.evidenceStatus !== 'measured'
  ));
  return {
    schema: 'morphloom.capture-pose-residual-fit/0.1', pass: blockers.length === 0,
    views: selectedViews, minimumGateMargin, maximumAbsoluteSelectedResidualDegrees,
    unverifiedResidualRequired,
    deliveryClaimAllowed: !unverifiedResidualRequired
      && selectedViews.every((view) => view.evidenceStatus === 'measured'),
    blockers,
    limitation: 'Candidate-scored pose residuals are diagnostic only unless independently measured; they cannot calibrate the same comparison that they are used to improve.',
  };
}
