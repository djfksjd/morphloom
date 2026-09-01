import { compareMaterialFrames, type MaterialExpectation } from './material-comparison';
import {
  compareReferenceFrames,
  type ComparisonFrame,
  type ComparisonRegion,
  type ReferenceComparisonResult,
} from './reference-comparison';

export type VisualBenchmarkDomain = 'industrial-design' | 'architecture' | 'character' | 'surface';
export type VisualCandidateId = 'morphloom' | 'img2threejs';

export interface VisualBenchmarkView {
  viewId: string;
  cameraFingerprint: string;
  referenceSha256: string;
  renderSha256: string;
  sceneFingerprint: string;
  referenceOrigin: 'admitted-local-reference' | 'redistributable-reference';
  renderOrigin: 'browser-webgl-canvas';
  reference: ComparisonFrame;
  render: ComparisonFrame;
  regions: ComparisonRegion[];
  materialExpectation?: MaterialExpectation;
}

export interface VisualBenchmarkCandidate {
  id: VisualCandidateId;
  rendererVersion: string;
  inputFingerprint: string;
  views: VisualBenchmarkView[];
}

export interface BlindVisualRating {
  raterFingerprint: string;
  presentationOrder: 'morphloom-first' | 'img2threejs-first';
  preferred: VisualCandidateId | 'tie';
}

export interface SameInputVisualBenchmark {
  id: string;
  domain: VisualBenchmarkDomain;
  lockedInputFingerprint: string;
  candidates: [VisualBenchmarkCandidate, VisualBenchmarkCandidate];
  blindRatings?: BlindVisualRating[];
}

export interface CandidateVisualScore {
  id: VisualCandidateId;
  score: number;
  silhouetteIoU: number;
  interiorSimilarity: number;
  materialSimilarity: number;
  surfaceScaleSimilarity: number;
  irregularitySimilarity: number;
  minimumFeatureScore: number;
  views: Array<{
    viewId: string;
    reference: ReferenceComparisonResult;
    materialSimilarity: number;
    surfaceScaleSimilarity: number;
    irregularitySimilarity: number;
  }>;
}

export interface SameInputVisualBenchmarkReport {
  schema: 'morphloom.same-input-visual-audit/0.1';
  id: string;
  domain: VisualBenchmarkDomain;
  status: 'unproven' | 'comparable' | 'automatic-morphloom-lead' | 'automatic-img2threejs-lead' | 'morphloom-winner' | 'img2threejs-winner';
  claimAllowed: boolean;
  scores: Record<VisualCandidateId, CandidateVisualScore>;
  blind: {
    eligible: boolean;
    ratings: number;
    morphloomShare: number;
    img2threejsShare: number;
    tieShare: number;
  };
  blockers: string[];
  limitation: string;
}

const DOMAIN_MINIMUM_VIEWS: Record<VisualBenchmarkDomain, number> = {
  'industrial-design': 2,
  architecture: 3,
  character: 3,
  surface: 3,
};

const ID = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,95}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const FINGERPRINT = /^[a-f0-9]{8,128}$/;

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function validateCandidate(benchmark: SameInputVisualBenchmark, candidate: VisualBenchmarkCandidate, blockers: string[]): void {
  if (candidate.inputFingerprint !== benchmark.lockedInputFingerprint) blockers.push(`${candidate.id}: input fingerprint does not match the locked input`);
  if (!candidate.rendererVersion.trim() || candidate.rendererVersion.length > 160) blockers.push(`${candidate.id}: renderer version is missing or unsafe`);
  if (candidate.views.length < DOMAIN_MINIMUM_VIEWS[benchmark.domain]) {
    blockers.push(`${candidate.id}: ${candidate.views.length}/${DOMAIN_MINIMUM_VIEWS[benchmark.domain]} required calibrated views`);
  }
  const viewIds = new Set<string>();
  for (const view of candidate.views) {
    if (!ID.test(view.viewId) || viewIds.has(view.viewId)) blockers.push(`${candidate.id}: invalid or duplicate view id ${view.viewId}`);
    viewIds.add(view.viewId);
    if (!FINGERPRINT.test(view.cameraFingerprint)) blockers.push(`${candidate.id}/${view.viewId}: calibrated camera fingerprint missing`);
    if (!SHA256.test(view.referenceSha256) || !SHA256.test(view.renderSha256)) blockers.push(`${candidate.id}/${view.viewId}: capture SHA-256 missing`);
    if (view.referenceSha256 === view.renderSha256) blockers.push(`${candidate.id}/${view.viewId}: render is byte-identical to the reference plate`);
    if (!FINGERPRINT.test(view.sceneFingerprint)) blockers.push(`${candidate.id}/${view.viewId}: rendered scene fingerprint missing`);
    if (!['admitted-local-reference', 'redistributable-reference'].includes(view.referenceOrigin)) blockers.push(`${candidate.id}/${view.viewId}: reference provenance is not admitted`);
    if (view.renderOrigin !== 'browser-webgl-canvas') blockers.push(`${candidate.id}/${view.viewId}: capture is not a browser WebGL render`);
    if (view.regions.length < 1) blockers.push(`${candidate.id}/${view.viewId}: no critical feature regions`);
  }
}

function scoreCandidate(candidate: VisualBenchmarkCandidate): CandidateVisualScore {
  const views = candidate.views.map((view) => {
    const reference = compareReferenceFrames(view.reference, view.render, view.regions);
    const material = compareMaterialFrames(view.reference, view.render, view.materialExpectation);
    return {
      viewId: view.viewId,
      reference,
      materialSimilarity: material.scores.overall,
      surfaceScaleSimilarity: material.scores.surfaceScale,
      irregularitySimilarity: material.scores.irregularity,
    };
  });
  const silhouetteIoU = average(views.map((view) => view.reference.silhouetteIoU));
  const interiorSimilarity = average(views.map((view) => view.reference.interiorSimilarity));
  const materialSimilarity = average(views.map((view) => view.materialSimilarity));
  const surfaceScaleSimilarity = average(views.map((view) => view.surfaceScaleSimilarity));
  const irregularitySimilarity = average(views.map((view) => view.irregularitySimilarity));
  const featureScores = views.flatMap((view) => view.reference.regions.map((region) => region.score));
  const minimumFeatureScore = featureScores.length > 0 ? Math.min(...featureScores) : 0;
  return {
    id: candidate.id,
    score: silhouetteIoU * 0.4 + interiorSimilarity * 0.2 + materialSimilarity * 0.16
      + surfaceScaleSimilarity * 0.08 + irregularitySimilarity * 0.06 + minimumFeatureScore * 0.1,
    silhouetteIoU,
    interiorSimilarity,
    materialSimilarity,
    surfaceScaleSimilarity,
    irregularitySimilarity,
    minimumFeatureScore,
    views,
  };
}

function evaluateBlindRatings(ratings: BlindVisualRating[] | undefined, blockers: string[]) {
  const safe = ratings ?? [];
  const raters = new Set(safe.map((rating) => rating.raterFingerprint));
  const morphloomFirst = safe.filter((rating) => rating.presentationOrder === 'morphloom-first').length;
  const imgFirst = safe.filter((rating) => rating.presentationOrder === 'img2threejs-first').length;
  const eligible = safe.length >= 5 && raters.size === safe.length && Math.abs(morphloomFirst - imgFirst) <= 1
    && safe.every((rating) => FINGERPRINT.test(rating.raterFingerprint));
  if (!eligible) blockers.push('blind evaluation requires at least five unique raters and balanced presentation order');
  return {
    eligible,
    ratings: safe.length,
    morphloomShare: safe.filter((rating) => rating.preferred === 'morphloom').length / Math.max(1, safe.length),
    img2threejsShare: safe.filter((rating) => rating.preferred === 'img2threejs').length / Math.max(1, safe.length),
    tieShare: safe.filter((rating) => rating.preferred === 'tie').length / Math.max(1, safe.length),
  };
}

export function auditSameInputVisualBenchmark(benchmark: SameInputVisualBenchmark): SameInputVisualBenchmarkReport {
  if (!ID.test(benchmark.id) || !FINGERPRINT.test(benchmark.lockedInputFingerprint)) throw new Error('Visual benchmark identity is invalid.');
  const blockers: string[] = [];
  const byId = new Map(benchmark.candidates.map((candidate) => [candidate.id, candidate]));
  if (byId.size !== 2 || !byId.has('morphloom') || !byId.has('img2threejs')) throw new Error('Visual benchmark requires one candidate from each engine.');
  for (const candidate of benchmark.candidates) validateCandidate(benchmark, candidate, blockers);
  const morphloom = byId.get('morphloom')!;
  const competitor = byId.get('img2threejs')!;
  const morphloomViews = new Map(morphloom.views.map((view) => [view.viewId, view]));
  const competitorViews = new Map(competitor.views.map((view) => [view.viewId, view]));
  for (const [viewId, view] of morphloomViews) {
    const other = competitorViews.get(viewId);
    if (!other) {
      blockers.push(`img2threejs: missing matched view ${viewId}`);
      continue;
    }
    if (view.referenceSha256 !== other.referenceSha256) blockers.push(`${viewId}: candidates did not use the same reference bytes`);
    if (view.cameraFingerprint !== other.cameraFingerprint) blockers.push(`${viewId}: candidates did not use the same calibrated camera`);
  }
  for (const viewId of competitorViews.keys()) if (!morphloomViews.has(viewId)) blockers.push(`morphloom: missing matched view ${viewId}`);

  let morphloomScore: CandidateVisualScore;
  let competitorScore: CandidateVisualScore;
  try {
    morphloomScore = scoreCandidate(morphloom);
    competitorScore = scoreCandidate(competitor);
  } catch (error) {
    throw new Error(`Visual benchmark frames are invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
  for (const score of [morphloomScore, competitorScore]) {
    if (score.silhouetteIoU < 0.65 || score.interiorSimilarity < 0.55 || score.materialSimilarity < 0.55 || score.minimumFeatureScore < 0.5) {
      blockers.push(`${score.id}: critical automatic visual threshold failed`);
    }
    if (benchmark.domain === 'surface'
      && (score.surfaceScaleSimilarity < 0.65 || score.irregularitySimilarity < 0.65)) {
      blockers.push(`${score.id}: multi-scale surface threshold failed`);
    }
  }
  const blind = evaluateBlindRatings(benchmark.blindRatings, blockers);
  const margin = morphloomScore.score - competitorScore.score;
  let status: SameInputVisualBenchmarkReport['status'] = 'unproven';
  if (blockers.filter((blocker) => !blocker.startsWith('blind evaluation')).length === 0) {
    if (Math.abs(margin) < 0.03) status = 'comparable';
    else status = margin > 0 ? 'automatic-morphloom-lead' : 'automatic-img2threejs-lead';
    if (blind.eligible && margin >= 0.03 && blind.morphloomShare >= 0.6) status = 'morphloom-winner';
    if (blind.eligible && margin <= -0.03 && blind.img2threejsShare >= 0.6) status = 'img2threejs-winner';
  }
  const claimAllowed = status === 'morphloom-winner' || status === 'img2threejs-winner';
  return {
    schema: 'morphloom.same-input-visual-audit/0.1',
    id: benchmark.id,
    domain: benchmark.domain,
    status,
    claimAllowed,
    scores: { morphloom: morphloomScore, img2threejs: competitorScore },
    blind,
    blockers,
    limitation: 'This audit ranks only the locked input, calibrated matched views, declared feature regions, renderer versions, and blind panel recorded in this report.',
  };
}

export function visualBenchmarkMinimumViews(domain: VisualBenchmarkDomain): number {
  return DOMAIN_MINIMUM_VIEWS[domain];
}
