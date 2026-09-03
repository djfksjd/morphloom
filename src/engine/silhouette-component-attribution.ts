export interface SilhouetteAblationGroup {
  groupId: string;
  candidateWithoutGroupMask: Uint8Array;
}

export interface SilhouetteAttributionViewInput {
  id: string;
  width: number;
  height: number;
  referenceMask: Uint8Array;
  candidateMask: Uint8Array;
  weight?: number;
  groups: SilhouetteAblationGroup[];
}

export interface SilhouetteGroupViewAttribution {
  viewId: string;
  baselineIoU: number;
  ablatedIoU: number;
  deltaIoU: number;
  removedExcessPixels: number;
  removedOverlapPixels: number;
  revealedOverlapPixels: number;
  revealedExcessPixels: number;
}

export interface SilhouetteGroupAttribution {
  groupId: string;
  weightedMeanDeltaIoU: number;
  minimumDeltaIoU: number;
  maximumDeltaIoU: number;
  netCorrectionRatio: number;
  recommendation: 'shrink-or-relocate' | 'preserve-or-expand' | 'inspect';
  views: SilhouetteGroupViewAttribution[];
}

export interface SemanticSilhouetteAttributionReport {
  schema: 'morphloom.semantic-silhouette-attribution/0.1';
  groups: SilhouetteGroupAttribution[];
  shrinkOrRelocateGroupIds: string[];
  preserveOrExpandGroupIds: string[];
  limitation: string;
}

const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,95}$/;
const MAX_PIXELS = 16_777_216;
const MAX_VIEWS = 24;
const MAX_GROUPS = 2_048;

function iou(reference: Uint8Array, candidate: Uint8Array): number {
  let intersection = 0;
  let union = 0;
  for (let index = 0; index < reference.length; index += 1) {
    const left = reference[index]! !== 0;
    const right = candidate[index]! !== 0;
    intersection += Number(left && right);
    union += Number(left || right);
  }
  return union === 0 ? 1 : intersection / union;
}

/**
 * Attributes multi-view silhouette error by semantic ablation. A group is
 * virtually removed while every camera and all other geometry remain locked.
 * The report distinguishes removed excess from lost true-positive coverage and
 * also records geometry revealed from behind the ablated group.
 */
export function auditSemanticSilhouetteAttribution(
  views: SilhouetteAttributionViewInput[],
  options: { minimumActionableDeltaIoU?: number } = {},
): SemanticSilhouetteAttributionReport {
  const minimumActionableDeltaIoU = options.minimumActionableDeltaIoU ?? 0.002;
  if (!Array.isArray(views) || views.length < 2 || views.length > MAX_VIEWS
    || !Number.isFinite(minimumActionableDeltaIoU)
    || minimumActionableDeltaIoU < 0.0001 || minimumActionableDeltaIoU > 0.25) {
    throw new Error('Semantic silhouette attribution configuration is unsafe.');
  }
  const viewIds = new Set<string>();
  let expectedGroupIds: string[] | undefined;
  for (const view of views) {
    const pixels = view.width * view.height;
    const groupIds = view.groups?.map((group) => group.groupId) ?? [];
    if (!SAFE_ID.test(view.id) || viewIds.has(view.id)
      || !Number.isInteger(view.width) || !Number.isInteger(view.height)
      || view.width < 1 || view.height < 1 || pixels > MAX_PIXELS
      || view.referenceMask?.length !== pixels || view.candidateMask?.length !== pixels
      || !Number.isFinite(view.weight ?? 1) || (view.weight ?? 1) <= 0 || (view.weight ?? 1) > 1_000
      || groupIds.length < 1 || groupIds.length > MAX_GROUPS
      || new Set(groupIds).size !== groupIds.length || groupIds.some((id) => !SAFE_ID.test(id))
      || view.groups.some((group) => group.candidateWithoutGroupMask?.length !== pixels)) {
      throw new Error(`Invalid semantic silhouette attribution view: ${view?.id ?? 'missing'}.`);
    }
    viewIds.add(view.id);
    const sortedIds = [...groupIds].sort();
    if (expectedGroupIds && (sortedIds.length !== expectedGroupIds.length
      || sortedIds.some((id, index) => id !== expectedGroupIds![index]))) {
      throw new Error('Every attribution view must contain the same semantic groups.');
    }
    expectedGroupIds = sortedIds;
  }

  const groups = expectedGroupIds!.map((groupId): SilhouetteGroupAttribution => {
    const perView = views.map((view): SilhouetteGroupViewAttribution => {
      const without = view.groups.find((group) => group.groupId === groupId)!.candidateWithoutGroupMask;
      const baselineIoU = iou(view.referenceMask, view.candidateMask);
      const ablatedIoU = iou(view.referenceMask, without);
      let removedExcessPixels = 0;
      let removedOverlapPixels = 0;
      let revealedOverlapPixels = 0;
      let revealedExcessPixels = 0;
      for (let pixel = 0; pixel < view.referenceMask.length; pixel += 1) {
        const reference = view.referenceMask[pixel]! !== 0;
        const candidate = view.candidateMask[pixel]! !== 0;
        const ablated = without[pixel]! !== 0;
        if (candidate && !ablated) {
          if (reference) removedOverlapPixels += 1;
          else removedExcessPixels += 1;
        } else if (!candidate && ablated) {
          if (reference) revealedOverlapPixels += 1;
          else revealedExcessPixels += 1;
        }
      }
      return {
        viewId: view.id, baselineIoU, ablatedIoU, deltaIoU: ablatedIoU - baselineIoU,
        removedExcessPixels, removedOverlapPixels, revealedOverlapPixels, revealedExcessPixels,
      };
    });
    const totalWeight = views.reduce((sum, view) => sum + (view.weight ?? 1), 0);
    const weightedMeanDeltaIoU = perView.reduce((sum, view, index) => (
      sum + view.deltaIoU * (views[index]!.weight ?? 1)
    ), 0) / totalWeight;
    const corrections = perView.reduce((sum, view) => (
      sum + view.removedExcessPixels + view.revealedOverlapPixels
    ), 0);
    const damage = perView.reduce((sum, view) => (
      sum + view.removedOverlapPixels + view.revealedExcessPixels
    ), 0);
    const changed = corrections + damage;
    const netCorrectionRatio = changed === 0 ? 0 : (corrections - damage) / changed;
    const recommendation = weightedMeanDeltaIoU >= minimumActionableDeltaIoU && netCorrectionRatio > 0
      ? 'shrink-or-relocate' as const
      : weightedMeanDeltaIoU <= -minimumActionableDeltaIoU
        ? 'preserve-or-expand' as const : 'inspect' as const;
    return {
      groupId, weightedMeanDeltaIoU,
      minimumDeltaIoU: Math.min(...perView.map((view) => view.deltaIoU)),
      maximumDeltaIoU: Math.max(...perView.map((view) => view.deltaIoU)),
      netCorrectionRatio, recommendation, views: perView,
    };
  }).sort((left, right) => right.weightedMeanDeltaIoU - left.weightedMeanDeltaIoU
    || right.netCorrectionRatio - left.netCorrectionRatio || left.groupId.localeCompare(right.groupId));
  return {
    schema: 'morphloom.semantic-silhouette-attribution/0.1', groups,
    shrinkOrRelocateGroupIds: groups.filter((group) => group.recommendation === 'shrink-or-relocate')
      .map((group) => group.groupId),
    preserveOrExpandGroupIds: groups.filter((group) => group.recommendation === 'preserve-or-expand')
      .sort((left, right) => left.weightedMeanDeltaIoU - right.weightedMeanDeltaIoU)
      .map((group) => group.groupId),
    limitation: 'Ablation attribution proves marginal 2D silhouette influence under locked cameras; occlusion can reveal other geometry, and the report does not by itself prove the correct 3D edit.',
  };
}
