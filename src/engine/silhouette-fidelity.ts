export interface SilhouetteEvidenceView {
  id: string;
  referenceDensity: number;
  wholeIoU: number;
  primaryMassIoU: number;
  thinFeatureScore: number;
}

export interface MultiviewSilhouetteAudit {
  pass: boolean;
  mode: 'dense-silhouette' | 'hybrid-structure' | 'sparse-structure';
  thresholds: {
    maximumSparseDensity: number;
    maximumHybridDensity: number;
    wholeIoU: number;
    hybridWholeIoU: number;
    primaryMassIoU: number;
    thinFeatureScore: number;
  };
  minimumWholeIoU: number;
  minimumPrimaryMassIoU: number;
  minimumThinFeatureScore: number;
  blockers: string[];
}

const MAXIMUM_VIEWS = 24;

function validUnit(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

/**
 * Uses area IoU for dense objects, a fail-closed mass + line metric for sparse
 * assemblies, and all three gates for mixed objects such as fans or spoked
 * wheels. One-pixel members make raw area IoU unstable, while a line metric
 * alone could hide a missing body; no cross-view average can hide a failed view.
 */
export function auditMultiviewSilhouetteFidelity(
  views: SilhouetteEvidenceView[],
  thresholds: Partial<MultiviewSilhouetteAudit['thresholds']> = {},
): MultiviewSilhouetteAudit {
  if (!Array.isArray(views) || views.length < 2 || views.length > MAXIMUM_VIEWS) {
    throw new Error(`Silhouette fidelity requires 2–${MAXIMUM_VIEWS} views.`);
  }
  const resolved = {
    maximumSparseDensity: thresholds.maximumSparseDensity ?? 0.12,
    maximumHybridDensity: thresholds.maximumHybridDensity ?? 0.25,
    wholeIoU: thresholds.wholeIoU ?? 0.75,
    hybridWholeIoU: thresholds.hybridWholeIoU ?? 0.7,
    primaryMassIoU: thresholds.primaryMassIoU ?? 0.7,
    thinFeatureScore: thresholds.thinFeatureScore ?? 0.8,
  };
  if (Object.values(resolved).some((value) => !validUnit(value))) {
    throw new Error('Silhouette fidelity thresholds must be within [0, 1].');
  }
  if (resolved.maximumHybridDensity < resolved.maximumSparseDensity
    || resolved.hybridWholeIoU > resolved.wholeIoU) {
    throw new Error('Silhouette fidelity hybrid thresholds are inconsistent.');
  }
  const ids = new Set<string>();
  for (const view of views) {
    if (typeof view.id !== 'string' || !view.id.trim() || view.id.length > 96 || ids.has(view.id)) {
      throw new Error('Silhouette fidelity view ids must be unique and bounded.');
    }
    ids.add(view.id);
    if (![view.referenceDensity, view.wholeIoU, view.primaryMassIoU, view.thinFeatureScore].every(validUnit)) {
      throw new Error(`Silhouette fidelity metrics are invalid in ${view.id}.`);
    }
  }

  const maximumReferenceDensity = Math.max(...views.map((view) => view.referenceDensity));
  const mode = maximumReferenceDensity <= resolved.maximumSparseDensity
    ? 'sparse-structure'
    : maximumReferenceDensity <= resolved.maximumHybridDensity ? 'hybrid-structure' : 'dense-silhouette';
  const minimumWholeIoU = Math.min(...views.map((view) => view.wholeIoU));
  const minimumPrimaryMassIoU = Math.min(...views.map((view) => view.primaryMassIoU));
  const minimumThinFeatureScore = Math.min(...views.map((view) => view.thinFeatureScore));
  const blockers: string[] = [];
  if (mode === 'dense-silhouette') {
    for (const view of views) if (view.wholeIoU < resolved.wholeIoU) {
      blockers.push(`${view.id}: whole silhouette IoU ${view.wholeIoU.toFixed(3)} < ${resolved.wholeIoU.toFixed(3)}`);
    }
  } else {
    for (const view of views) {
      if (mode === 'hybrid-structure' && view.wholeIoU < resolved.hybridWholeIoU) {
        blockers.push(`${view.id}: hybrid whole silhouette IoU ${view.wholeIoU.toFixed(3)} < ${resolved.hybridWholeIoU.toFixed(3)}`);
      }
      if (view.primaryMassIoU < resolved.primaryMassIoU) {
        blockers.push(`${view.id}: primary mass IoU ${view.primaryMassIoU.toFixed(3)} < ${resolved.primaryMassIoU.toFixed(3)}`);
      }
      if (view.thinFeatureScore < resolved.thinFeatureScore) {
        blockers.push(`${view.id}: thin feature score ${view.thinFeatureScore.toFixed(3)} < ${resolved.thinFeatureScore.toFixed(3)}`);
      }
    }
  }
  return {
    pass: blockers.length === 0,
    mode,
    thresholds: resolved,
    minimumWholeIoU,
    minimumPrimaryMassIoU,
    minimumThinFeatureScore,
    blockers,
  };
}
