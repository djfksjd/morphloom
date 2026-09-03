export interface ArticulationStateCandidate {
  stateId: string;
  jointDegrees: number;
  gateMargin: number;
  wholeIoU: number;
  primaryMassIoU: number;
  thinFeatureScore: number;
}

export interface ArticulationStateView {
  id: string;
  neutralStateId: string;
  evidenceStatus: 'measured' | 'estimated' | 'inferred';
  candidates: ArticulationStateCandidate[];
}

export interface ArticulationStateFitReport {
  schema: 'morphloom.articulation-state-fit/0.1';
  pass: boolean;
  views: Array<{
    id: string;
    evidenceStatus: ArticulationStateView['evidenceStatus'];
    neutral: ArticulationStateCandidate;
    selected: ArticulationStateCandidate;
    improvement: number;
  }>;
  minimumGateMargin: number;
  inferredStateRequired: boolean;
  deliveryClaimAllowed: boolean;
  blockers: string[];
  limitation: string;
}

const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,95}$/;
const MAX_VIEWS = 24;
const MAX_CANDIDATES = 128;

/**
 * Selects a bounded articulation state for each independently captured view.
 * Neutral remains preferred unless another state produces a material verified
 * gain. This separates camera motion from product joint motion without baking
 * view-specific deformation into the delivered neutral mesh.
 */
export function fitBoundedPerViewArticulationStates(
  views: ArticulationStateView[],
  options: {
    minimumGateImprovement?: number;
    maximumAbsoluteJointDegrees?: number;
    requirePositiveMargin?: boolean;
  } = {},
): ArticulationStateFitReport {
  const minimumGateImprovement = options.minimumGateImprovement ?? 0.01;
  const maximumAbsoluteJointDegrees = options.maximumAbsoluteJointDegrees ?? 120;
  if (!Array.isArray(views) || views.length < 2 || views.length > MAX_VIEWS
    || !Number.isFinite(minimumGateImprovement) || minimumGateImprovement < 0 || minimumGateImprovement > 0.5
    || !Number.isFinite(maximumAbsoluteJointDegrees) || maximumAbsoluteJointDegrees <= 0
    || maximumAbsoluteJointDegrees > 180) {
    throw new Error('Articulation-state fit configuration is unsafe.');
  }
  const viewIds = new Set<string>();
  const selectedViews = views.map((view) => {
    if (!SAFE_ID.test(view?.id ?? '') || viewIds.has(view.id)
      || !SAFE_ID.test(view?.neutralStateId ?? '')
      || !['measured', 'estimated', 'inferred'].includes(view?.evidenceStatus)
      || !Array.isArray(view.candidates) || view.candidates.length < 1
      || view.candidates.length > MAX_CANDIDATES) {
      throw new Error('Articulation-state views are invalid.');
    }
    viewIds.add(view.id);
    const stateIds = new Set<string>();
    const candidates = view.candidates.map((candidate) => {
      if (!SAFE_ID.test(candidate?.stateId ?? '') || stateIds.has(candidate.stateId)
        || ![candidate.jointDegrees, candidate.gateMargin, candidate.wholeIoU,
          candidate.primaryMassIoU, candidate.thinFeatureScore].every(Number.isFinite)
        || Math.abs(candidate.jointDegrees) > maximumAbsoluteJointDegrees
        || [candidate.wholeIoU, candidate.primaryMassIoU, candidate.thinFeatureScore]
          .some((score) => score < 0 || score > 1)) {
        throw new Error(`Invalid articulation candidate in ${view.id}.`);
      }
      stateIds.add(candidate.stateId);
      return candidate;
    });
    const neutral = candidates.find((candidate) => candidate.stateId === view.neutralStateId);
    if (!neutral) throw new Error(`${view.id} is missing its neutral articulation state.`);
    const ranked = [...candidates].sort((left, right) => right.gateMargin - left.gateMargin
      || (right.wholeIoU + right.primaryMassIoU + right.thinFeatureScore)
        - (left.wholeIoU + left.primaryMassIoU + left.thinFeatureScore)
      || Math.abs(left.jointDegrees) - Math.abs(right.jointDegrees)
      || left.stateId.localeCompare(right.stateId));
    const winner = ranked[0]!;
    const selected = winner.gateMargin >= neutral.gateMargin + minimumGateImprovement
      ? winner : neutral;
    return {
      id: view.id, evidenceStatus: view.evidenceStatus, neutral, selected,
      improvement: selected.gateMargin - neutral.gateMargin,
    };
  });
  const minimumGateMargin = Math.min(...selectedViews.map((view) => view.selected.gateMargin));
  const blockers = options.requirePositiveMargin !== false && minimumGateMargin < 0
    ? [`Worst articulated-view gate margin ${minimumGateMargin.toFixed(3)} is below zero.`] : [];
  const inferredStateRequired = selectedViews.some((view) => (
    view.selected.stateId !== view.neutral.stateId && view.evidenceStatus !== 'measured'
  ));
  return {
    schema: 'morphloom.articulation-state-fit/0.1', pass: blockers.length === 0,
    views: selectedViews, minimumGateMargin, inferredStateRequired,
    deliveryClaimAllowed: !inferredStateRequired && selectedViews.every((view) => view.evidenceStatus === 'measured'),
    blockers,
    limitation: 'Per-view state fitting separates articulated capture states from the neutral asset; estimated or inferred joint angles are diagnostic and do not prove measured articulation limits.',
  };
}
