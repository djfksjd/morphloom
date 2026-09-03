import type {
  SemanticSilhouetteAttributionReport,
  SilhouetteGroupAttribution,
  SilhouettePixelRegion,
} from './silhouette-component-attribution';
import type {
  SilhouetteResidualComponent,
  SilhouetteResidualLocalizationReport,
} from './silhouette-residual-localization';

export interface SilhouetteRepairCameraEvidence {
  viewId: string;
  azimuthDegrees: number;
  projection: 'orthographic' | 'perspective';
  absolutePoseVerified: boolean;
  intrinsicsVerified: boolean;
  /** Verified orthographic scale. Required before normalized pixels become millimetres. */
  pixelsPerWorldUnit?: number;
}

export interface SilhouetteRepairScreenMatch {
  viewId: string;
  sourceExcessPixels: number;
  targetMissingComponentId: string;
  targetMissingPixels: number;
  sourceCentroid: { x: number; y: number };
  targetCentroid: { x: number; y: number };
  screenDeltaNormalized: { x: number; y: number };
  normalizedDistance: number;
  areaCompatibility: number;
  correctionPurity: number;
  confidence: number;
}

export interface SilhouetteSemanticRepairHint {
  groupId: string;
  recommendation: SilhouetteGroupAttribution['recommendation'];
  candidateOperation: 'shrink' | 'relocate-or-reshape' | 'preserve-or-expand' | 'inspect';
  confidence: number;
  automatic3dTrialEligible: boolean;
  evidenceViewIds: string[];
  screenMatches: SilhouetteRepairScreenMatch[];
  worldTranslationMm?: [number, number, number];
  worldFitRmsNormalizedError?: number;
  blockers: string[];
}

export interface SilhouetteSemanticRepairReport {
  schema: 'morphloom.silhouette-semantic-repair/0.1';
  hints: SilhouetteSemanticRepairHint[];
  actionableGroupIds: string[];
  blockedGroupIds: string[];
  limitation: string;
}

const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,95}$/;

function distance(
  left: { x: number; y: number },
  right: { x: number; y: number },
): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function bestMissingMatch(
  source: SilhouettePixelRegion,
  components: SilhouetteResidualComponent[],
  correctionPurity: number,
  minimumAreaCompatibility: number,
  maximumNormalizedDistance: number,
): Omit<SilhouetteRepairScreenMatch, 'viewId'> | undefined {
  const candidates = components.filter((component) => component.kind === 'missing').map((component) => {
    const areaCompatibility = Math.min(source.pixels, component.pixels)
      / Math.max(source.pixels, component.pixels);
    const normalizedDistance = distance(source.normalizedCentroid, component.normalizedCentroid);
    const proximity = Math.max(0, 1 - normalizedDistance / Math.SQRT2);
    return {
      component,
      areaCompatibility,
      normalizedDistance,
      confidence: correctionPurity * Math.sqrt(areaCompatibility) * proximity,
    };
  }).filter((candidate) => candidate.areaCompatibility >= minimumAreaCompatibility
    && candidate.normalizedDistance <= maximumNormalizedDistance)
    .sort((left, right) => right.confidence - left.confidence
      || right.component.pixels - left.component.pixels
      || left.component.id.localeCompare(right.component.id));
  const selected = candidates[0];
  if (!selected) return undefined;
  return {
    sourceExcessPixels: source.pixels,
    targetMissingComponentId: selected.component.id,
    targetMissingPixels: selected.component.pixels,
    sourceCentroid: source.normalizedCentroid,
    targetCentroid: selected.component.normalizedCentroid,
    screenDeltaNormalized: {
      x: selected.component.normalizedCentroid.x - source.normalizedCentroid.x,
      y: selected.component.normalizedCentroid.y - source.normalizedCentroid.y,
    },
    normalizedDistance: selected.normalizedDistance,
    areaCompatibility: selected.areaCompatibility,
    correctionPurity,
    confidence: selected.confidence,
  };
}

function hasUsefulAngularBaseline(cameras: SilhouetteRepairCameraEvidence[]): boolean {
  for (let left = 0; left < cameras.length; left += 1) for (let right = left + 1; right < cameras.length; right += 1) {
    const raw = Math.abs(cameras[left]!.azimuthDegrees - cameras[right]!.azimuthDegrees) % 360;
    const separation = Math.min(raw, 360 - raw);
    if (separation >= 30 && separation <= 150) return true;
  }
  return false;
}

function solveOrthographicWorldTranslation(
  matches: SilhouetteRepairScreenMatch[],
  cameras: Map<string, SilhouetteRepairCameraEvidence>,
  residualViews: Map<string, SilhouetteResidualLocalizationReport['views'][number]>,
): { translationMm: [number, number, number]; rmsNormalizedError: number } | undefined {
  let aa = 0; let ab = 0; let bb = 0; let au = 0; let bu = 0;
  let weightedY = 0; let yWeight = 0;
  for (const match of matches) {
    const camera = cameras.get(match.viewId)!;
    const view = residualViews.get(match.viewId)!;
    const scale = camera.pixelsPerWorldUnit!;
    const radians = camera.azimuthDegrees * Math.PI / 180;
    const a = Math.cos(radians);
    const b = -Math.sin(radians);
    const horizontalWorld = match.screenDeltaNormalized.x * view.width / scale;
    const verticalWorld = -match.screenDeltaNormalized.y * view.height / scale;
    const weight = Math.max(1e-6, match.confidence);
    aa += weight * a * a;
    ab += weight * a * b;
    bb += weight * b * b;
    au += weight * a * horizontalWorld;
    bu += weight * b * horizontalWorld;
    weightedY += weight * verticalWorld;
    yWeight += weight;
  }
  const determinant = aa * bb - ab * ab;
  if (determinant <= 1e-9 || yWeight <= 0) return undefined;
  const x = (au * bb - bu * ab) / determinant;
  const z = (bu * aa - au * ab) / determinant;
  const y = weightedY / yWeight;
  let squared = 0;
  let count = 0;
  for (const match of matches) {
    const camera = cameras.get(match.viewId)!;
    const view = residualViews.get(match.viewId)!;
    const scale = camera.pixelsPerWorldUnit!;
    const radians = camera.azimuthDegrees * Math.PI / 180;
    const predictedX = scale * (x * Math.cos(radians) - z * Math.sin(radians)) / view.width;
    const predictedY = -scale * y / view.height;
    squared += (predictedX - match.screenDeltaNormalized.x) ** 2
      + (predictedY - match.screenDeltaNormalized.y) ** 2;
    count += 2;
  }
  if (![x, y, z, squared].every(Number.isFinite)) return undefined;
  return { translationMm: [x, y, z], rmsNormalizedError: Math.sqrt(squared / count) };
}

/**
 * Pairs semantic-group excess pixels with nearby missing-reference components
 * in the same locked views. A 3D trial is allowed only when at least two
 * calibrated orthographic views support the pairing. A least-squares world
 * translation is emitted only when a verified pixel scale makes that solve
 * metric; the downstream bounded search must still render and re-check every
 * protected gate before accepting an edit.
 */
export function planSilhouetteSemanticRepairs(
  attribution: SemanticSilhouetteAttributionReport,
  residual: SilhouetteResidualLocalizationReport,
  cameras: SilhouetteRepairCameraEvidence[],
  options: {
    minimumAreaCompatibility?: number;
    maximumNormalizedDistance?: number;
    minimumConfidence?: number;
    maximumTranslationMm?: number;
    maximumWorldFitRmsNormalizedError?: number;
  } = {},
): SilhouetteSemanticRepairReport {
  const minimumAreaCompatibility = options.minimumAreaCompatibility ?? 0.1;
  const maximumNormalizedDistance = options.maximumNormalizedDistance ?? 0.75;
  const minimumConfidence = options.minimumConfidence ?? 0.2;
  const maximumTranslationMm = options.maximumTranslationMm ?? 1_000;
  const maximumWorldFitRmsNormalizedError = options.maximumWorldFitRmsNormalizedError ?? 0.03;
  if (attribution?.schema !== 'morphloom.semantic-silhouette-attribution/0.1'
    || residual?.schema !== 'morphloom.silhouette-residual-localization/0.1'
    || !Array.isArray(cameras) || cameras.length < 1 || cameras.length > 24
    || !Number.isFinite(minimumAreaCompatibility) || minimumAreaCompatibility < 0.01
    || minimumAreaCompatibility > 1
    || !Number.isFinite(maximumNormalizedDistance) || maximumNormalizedDistance <= 0
    || maximumNormalizedDistance > Math.SQRT2
    || !Number.isFinite(minimumConfidence) || minimumConfidence < 0.01 || minimumConfidence > 1) {
    throw new Error('Silhouette semantic repair configuration is unsafe.');
  }
  if (!Number.isFinite(maximumTranslationMm) || maximumTranslationMm <= 0 || maximumTranslationMm > 100_000
    || !Number.isFinite(maximumWorldFitRmsNormalizedError)
    || maximumWorldFitRmsNormalizedError <= 0 || maximumWorldFitRmsNormalizedError > 0.5) {
    throw new Error('Silhouette semantic repair world-solve bounds are unsafe.');
  }
  const cameraIds = cameras.map((camera) => camera.viewId);
  if (new Set(cameraIds).size !== cameraIds.length || cameras.some((camera) => (
    !SAFE_ID.test(camera.viewId) || !Number.isFinite(camera.azimuthDegrees)
    || Math.abs(camera.azimuthDegrees) > 1_000_000
    || !['orthographic', 'perspective'].includes(camera.projection)
    || typeof camera.absolutePoseVerified !== 'boolean' || typeof camera.intrinsicsVerified !== 'boolean'
    || (camera.pixelsPerWorldUnit !== undefined
      && (!Number.isFinite(camera.pixelsPerWorldUnit) || camera.pixelsPerWorldUnit <= 0
        || camera.pixelsPerWorldUnit > 1_000_000))
  ))) throw new Error('Silhouette semantic repair camera evidence is unsafe.');
  const residualByView = new Map(residual.views.map((view) => [view.id, view]));
  if (attribution.groups.some((group) => group.views.some((view) => !residualByView.has(view.viewId)))) {
    throw new Error('Silhouette semantic repair reports do not share the same views.');
  }
  const cameraByView = new Map(cameras.map((camera) => [camera.viewId, camera]));

  const hints = attribution.groups.map((group): SilhouetteSemanticRepairHint => {
    const screenMatches = group.views.flatMap((view): SilhouetteRepairScreenMatch[] => {
      if (!view.removedExcessRegion) return [];
      const changed = view.removedExcessPixels + view.removedOverlapPixels;
      const correctionPurity = changed === 0 ? 0 : view.removedExcessPixels / changed;
      const match = bestMissingMatch(
        view.removedExcessRegion,
        residualByView.get(view.viewId)!.components,
        correctionPurity,
        minimumAreaCompatibility,
        maximumNormalizedDistance,
      );
      return match ? [{ viewId: view.viewId, ...match }] : [];
    }).sort((left, right) => right.confidence - left.confidence || left.viewId.localeCompare(right.viewId));
    const confidence = screenMatches.length === 0 ? 0
      : screenMatches.reduce((sum, match) => sum + match.confidence, 0) / screenMatches.length;
    const blockers: string[] = [];
    if (group.recommendation !== 'shrink-or-relocate') {
      blockers.push('semantic ablation does not support shrinking or relocating this group');
    }
    if (screenMatches.length < 2) blockers.push('fewer than two views contain compatible excess-to-missing regions');
    const matchedCameras = screenMatches.flatMap((match) => {
      const camera = cameraByView.get(match.viewId);
      return camera ? [camera] : [];
    });
    if (matchedCameras.length !== screenMatches.length) blockers.push('camera evidence is missing for one or more matched views');
    if (matchedCameras.some((camera) => camera.projection !== 'orthographic')) {
      blockers.push('perspective screen residual requires a depth-aware calibrated solver');
    }
    if (matchedCameras.some((camera) => !camera.absolutePoseVerified)) {
      blockers.push('absolute camera pose is not verified');
    }
    if (matchedCameras.some((camera) => !camera.intrinsicsVerified)) {
      blockers.push('camera intrinsics are not verified');
    }
    if (matchedCameras.some((camera) => camera.pixelsPerWorldUnit === undefined)) {
      blockers.push('orthographic pixel scale is not verified');
    }
    if (matchedCameras.length >= 2 && !hasUsefulAngularBaseline(matchedCameras)) {
      blockers.push('matched views do not provide a useful angular baseline');
    }
    if (confidence < minimumConfidence) blockers.push('regional correspondence confidence is below threshold');
    const canSolveWorld = matchedCameras.length === screenMatches.length && matchedCameras.length >= 2
      && matchedCameras.every((camera) => camera.projection === 'orthographic'
        && camera.absolutePoseVerified && camera.intrinsicsVerified
        && camera.pixelsPerWorldUnit !== undefined)
      && hasUsefulAngularBaseline(matchedCameras);
    const worldSolution = canSolveWorld
      ? solveOrthographicWorldTranslation(screenMatches, cameraByView, residualByView)
      : undefined;
    if (canSolveWorld && !worldSolution) blockers.push('orthographic view equations do not constrain a unique world translation');
    if (worldSolution && Math.hypot(...worldSolution.translationMm) > maximumTranslationMm) {
      blockers.push('world translation exceeds the bounded edit limit');
    }
    if (worldSolution && worldSolution.rmsNormalizedError > maximumWorldFitRmsNormalizedError) {
      blockers.push('world translation reprojection error exceeds threshold');
    }
    const maximumDelta = Math.max(0, ...screenMatches.map((match) => match.normalizedDistance));
    const candidateOperation = group.recommendation === 'preserve-or-expand'
      ? 'preserve-or-expand' as const
      : group.recommendation === 'inspect' ? 'inspect' as const
        : maximumDelta <= 0.025 ? 'shrink' as const : 'relocate-or-reshape' as const;
    return {
      groupId: group.groupId,
      recommendation: group.recommendation,
      candidateOperation,
      confidence,
      automatic3dTrialEligible: blockers.length === 0,
      evidenceViewIds: screenMatches.map((match) => match.viewId),
      screenMatches,
      worldTranslationMm: worldSolution?.translationMm,
      worldFitRmsNormalizedError: worldSolution?.rmsNormalizedError,
      blockers,
    };
  }).sort((left, right) => Number(right.automatic3dTrialEligible) - Number(left.automatic3dTrialEligible)
    || right.confidence - left.confidence || left.groupId.localeCompare(right.groupId));
  return {
    schema: 'morphloom.silhouette-semantic-repair/0.1',
    hints,
    actionableGroupIds: hints.filter((hint) => hint.automatic3dTrialEligible).map((hint) => hint.groupId),
    blockedGroupIds: hints.filter((hint) => !hint.automatic3dTrialEligible).map((hint) => hint.groupId),
    limitation: 'Screen-space pairing is a bounded repair hypothesis, not semantic identity or 3D truth. Every generated edit still requires immutable-source trial rendering, geometry checks, and zero-regression protected gates.',
  };
}
