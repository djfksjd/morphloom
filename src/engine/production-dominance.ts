import type { SameInputVisualBenchmarkReport } from './visual-benchmark';

export const PRODUCTION_BENCHMARK_DOMAINS = [
  'architecture',
  'industrial-design',
  'electronics-assembly',
  'animation',
  'game',
  '3d-print',
  'surface',
] as const;

export type ProductionBenchmarkDomain = typeof PRODUCTION_BENCHMARK_DOMAINS[number];

export interface ReferencePbrReceipt {
  schema: 'morphloom.reference-pbr-receipt/0.1';
  receiptSha256: string;
  referenceAssetSha256: string;
  candidateArtifactSha256: string;
  pass: boolean;
}

export interface ProductionCandidateResult {
  engineRevision: string;
  artifactSha256: string;
  releaseReceiptSha256: string;
  releasePass: boolean;
  deterministic: boolean;
  browserRoundTrip: boolean;
  deliveryScore: number;
  nativeReopens: string[];
  referencePbr: ReferencePbrReceipt;
}

export interface IndependentGroundTruthReceipt {
  schema: 'morphloom.independent-ground-truth/0.1';
  corpusId: string;
  corpusCaseId: string;
  manifestSha256: string;
  lockedInputSha256: string;
  referenceAssetSha256: string;
  auditPass: boolean;
}

export interface ProductionDominanceCase {
  id: string;
  domain: ProductionBenchmarkDomain;
  inputFingerprint: string;
  independentReferenceFingerprint: string;
  sameInputLocked: boolean;
  groundTruth: IndependentGroundTruthReceipt;
  morphloom: ProductionCandidateResult;
  img2threejs: ProductionCandidateResult;
  visual: SameInputVisualBenchmarkReport;
}

export interface ProductionDomainDominance {
  domain: ProductionBenchmarkDomain;
  pass: boolean;
  cases: number;
  independentInputs: number;
  independentReferences: number;
  morphloomReleaseRate: number;
  competitorReleaseRate: number;
  visualWinRate: number;
  meanDeliveryAdvantage: number;
  blockers: string[];
}

export interface ProductionDominanceReport {
  schema: 'morphloom.production-dominance/0.4';
  pass: boolean;
  claimAllowed: boolean;
  domains: ProductionDomainDominance[];
  blockers: string[];
  limitation: string;
}

const ID = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,95}$/;
const FINGERPRINT = /^[a-f0-9]{8,128}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const REVISION = /^[a-zA-Z0-9][a-zA-Z0-9+_.\/-]{0,159}$/;
const MINIMUM_CASES_PER_DOMAIN = 3;

function normalizedApplication(value: string): string {
  return value.trim().toLowerCase();
}

function nativeDeliveryPass(domain: ProductionBenchmarkDomain, applications: string[]): boolean {
  const available = new Set(applications.map(normalizedApplication));
  if (!available.has('blender')) return false;
  if (domain === 'game') return ['unity', 'unreal', 'godot'].some((name) => available.has(name));
  if (domain === '3d-print') return ['prusa-slicer', 'cura', 'orcaslicer', 'bambu-studio'].some((name) => available.has(name));
  return true;
}

function safeCandidate(candidate: ProductionCandidateResult): boolean {
  return REVISION.test(candidate.engineRevision)
    && SHA256.test(candidate.artifactSha256)
    && SHA256.test(candidate.releaseReceiptSha256)
    && Number.isFinite(candidate.deliveryScore)
    && candidate.deliveryScore >= 0
    && candidate.deliveryScore <= 100
    && Array.isArray(candidate.nativeReopens)
    && candidate.nativeReopens.length <= 16
    && candidate.nativeReopens.every((item) => typeof item === 'string' && item.length > 0 && item.length <= 80)
    && new Set(candidate.nativeReopens.map(normalizedApplication)).size === candidate.nativeReopens.length;
}

function safeReferencePbr(
  receipt: ReferencePbrReceipt,
  candidate: ProductionCandidateResult,
  referenceAssetSha256: string,
): boolean {
  return receipt?.schema === 'morphloom.reference-pbr-receipt/0.1'
    && SHA256.test(receipt.receiptSha256)
    && receipt.referenceAssetSha256 === referenceAssetSha256
    && receipt.candidateArtifactSha256 === candidate.artifactSha256
    && typeof receipt.pass === 'boolean';
}

function safeGroundTruth(receipt: IndependentGroundTruthReceipt, item: ProductionDominanceCase): boolean {
  return receipt?.schema === 'morphloom.independent-ground-truth/0.1'
    && ID.test(receipt.corpusId)
    && ID.test(receipt.corpusCaseId)
    && SHA256.test(receipt.manifestSha256)
    && SHA256.test(receipt.lockedInputSha256)
    && SHA256.test(receipt.referenceAssetSha256)
    && receipt.auditPass === true
    && receipt.lockedInputSha256 === item.inputFingerprint
    && receipt.referenceAssetSha256 === item.independentReferenceFingerprint
    && receipt.referenceAssetSha256 !== item.morphloom.artifactSha256
    && receipt.referenceAssetSha256 !== item.img2threejs.artifactSha256;
}

function visualDomainFor(domain: ProductionBenchmarkDomain): SameInputVisualBenchmarkReport['domain'] {
  if (domain === 'architecture') return 'architecture';
  if (domain === 'animation' || domain === 'game') return 'character';
  if (domain === 'surface') return 'surface';
  return 'industrial-design';
}

function safeVisualReport(report: SameInputVisualBenchmarkReport, item: ProductionDominanceCase): boolean {
  const shares = report?.blind
    ? report.blind.morphloomShare + report.blind.img2threejsShare + report.blind.tieShare
    : Number.NaN;
  return report?.schema === 'morphloom.same-input-visual-audit/0.2'
    && report.id === item.id
    && report.lockedInputFingerprint === item.inputFingerprint
    && report.candidateRendererVersions?.morphloom === item.morphloom.engineRevision
    && report.candidateRendererVersions?.img2threejs === item.img2threejs.engineRevision
    && report.domain === visualDomainFor(item.domain)
    && typeof report.claimAllowed === 'boolean'
    && report.captureProtocol?.verified === true
    && report.blind?.eligible === true
    && report.blind.ratings >= 5
    && FINGERPRINT.test(report.blind.ratingSetFingerprint)
    && Number.isFinite(shares) && Math.abs(shares - 1) <= 1e-9
    && Array.isArray(report.blockers) && report.blockers.length === 0
    && Number.isFinite(report.scores?.morphloom?.score)
    && Number.isFinite(report.scores?.img2threejs?.score)
    && report.scores.morphloom.score >= 0 && report.scores.morphloom.score <= 1
    && report.scores.img2threejs.score >= 0 && report.scores.img2threejs.score <= 1;
}

export function auditProductionDominance(cases: ProductionDominanceCase[]): ProductionDominanceReport {
  if (!Array.isArray(cases) || cases.length > 256) throw new Error('Production benchmark case collection is unsafe.');
  const blockers: string[] = [];
  const ids = new Set<string>();
  for (const item of cases) {
    if (!ID.test(item.id) || ids.has(item.id)) throw new Error(`Invalid or duplicate production benchmark id: ${item.id}`);
    ids.add(item.id);
    if (!PRODUCTION_BENCHMARK_DOMAINS.includes(item.domain)) throw new Error(`Unsupported production benchmark domain: ${item.domain}`);
    if (!FINGERPRINT.test(item.inputFingerprint) || !FINGERPRINT.test(item.independentReferenceFingerprint)) {
      throw new Error(`Production benchmark fingerprints are invalid in ${item.id}`);
    }
    if (!safeCandidate(item.morphloom) || !safeCandidate(item.img2threejs)) {
      throw new Error(`Production benchmark candidate result is unsafe in ${item.id}`);
    }
    if (!safeGroundTruth(item.groundTruth, item)) {
      throw new Error(`Production benchmark ground-truth proof is unsafe or mismatched in ${item.id}`);
    }
    if (!safeReferencePbr(item.morphloom.referencePbr, item.morphloom, item.independentReferenceFingerprint)
      || !safeReferencePbr(item.img2threejs.referencePbr, item.img2threejs, item.independentReferenceFingerprint)) {
      throw new Error(`Production benchmark PBR proof is unsafe or mismatched in ${item.id}`);
    }
    if (!safeVisualReport(item.visual, item)) {
      throw new Error(`Production benchmark visual proof is unsafe or mismatched in ${item.id}`);
    }
    if (item.morphloom.artifactSha256 === item.img2threejs.artifactSha256
      || item.morphloom.releaseReceiptSha256 === item.img2threejs.releaseReceiptSha256
      || item.morphloom.referencePbr.receiptSha256 === item.img2threejs.referencePbr.receiptSha256) {
      throw new Error(`Production benchmark candidates reuse evidence in ${item.id}`);
    }
  }

  const domains = PRODUCTION_BENCHMARK_DOMAINS.map((domain): ProductionDomainDominance => {
    const scoped = cases.filter((item) => item.domain === domain);
    const domainBlockers: string[] = [];
    const inputs = new Set(scoped.map((item) => item.inputFingerprint));
    const references = new Set(scoped.map((item) => item.independentReferenceFingerprint));
    if (scoped.length < MINIMUM_CASES_PER_DOMAIN) {
      domainBlockers.push(`${scoped.length}/${MINIMUM_CASES_PER_DOMAIN} required same-input cases`);
    }
    if (references.size < MINIMUM_CASES_PER_DOMAIN) {
      domainBlockers.push(`${references.size}/${MINIMUM_CASES_PER_DOMAIN} independent references`);
    }
    if (inputs.size < MINIMUM_CASES_PER_DOMAIN) {
      domainBlockers.push(`${inputs.size}/${MINIMUM_CASES_PER_DOMAIN} independent locked inputs`);
    }
    for (const candidate of ['morphloom', 'img2threejs'] as const) {
      const artifacts = new Set(scoped.map((item) => item[candidate].artifactSha256));
      const receipts = new Set(scoped.map((item) => item[candidate].releaseReceiptSha256));
      const pbrReceipts = new Set(scoped.map((item) => item[candidate].referencePbr.receiptSha256));
      if (artifacts.size < scoped.length) domainBlockers.push(`${candidate}: artifact bytes were reused across cases`);
      if (receipts.size < scoped.length) domainBlockers.push(`${candidate}: release receipts were reused across cases`);
      if (pbrReceipts.size < scoped.length) domainBlockers.push(`${candidate}: PBR receipts were reused across cases`);
    }
    for (const item of scoped) {
      if (!item.sameInputLocked) domainBlockers.push(`${item.id}: input is not locked identically`);
      if (!item.morphloom.releasePass) domainBlockers.push(`${item.id}: Morphloom production release failed`);
      if (!item.morphloom.deterministic) domainBlockers.push(`${item.id}: Morphloom repeat build changed`);
      if (!item.morphloom.browserRoundTrip) domainBlockers.push(`${item.id}: Morphloom browser GLB round-trip failed`);
      if (!item.morphloom.referencePbr.pass) domainBlockers.push(`${item.id}: Morphloom reference-bound PBR audit failed`);
      if (!nativeDeliveryPass(domain, item.morphloom.nativeReopens)) {
        domainBlockers.push(`${item.id}: Morphloom native target reopen evidence is incomplete`);
      }
      if (!item.visual.claimAllowed || item.visual.status !== 'morphloom-winner') {
        domainBlockers.push(`${item.id}: balanced blind visual win is not proven`);
      }
      if (item.visual.scores.morphloom.score <= item.visual.scores.img2threejs.score) {
        domainBlockers.push(`${item.id}: automatic visual score does not lead`);
      }
      if (item.morphloom.deliveryScore < item.img2threejs.deliveryScore) {
        domainBlockers.push(`${item.id}: delivery score regresses against img2threejs`);
      }
    }
    const rate = (predicate: (item: ProductionDominanceCase) => boolean): number => (
      scoped.length === 0 ? 0 : scoped.filter(predicate).length / scoped.length
    );
    const meanDeliveryAdvantage = scoped.length === 0 ? 0 : scoped.reduce(
      (sum, item) => sum + item.morphloom.deliveryScore - item.img2threejs.deliveryScore,
      0,
    ) / scoped.length;
    if (scoped.length >= MINIMUM_CASES_PER_DOMAIN && meanDeliveryAdvantage <= 0) {
      domainBlockers.push('mean delivery advantage is not strictly positive');
    }
    return {
      domain,
      pass: domainBlockers.length === 0,
      cases: scoped.length,
      independentInputs: inputs.size,
      independentReferences: references.size,
      morphloomReleaseRate: rate((item) => item.morphloom.releasePass),
      competitorReleaseRate: rate((item) => item.img2threejs.releasePass),
      visualWinRate: rate((item) => item.visual.claimAllowed && item.visual.status === 'morphloom-winner'),
      meanDeliveryAdvantage,
      blockers: domainBlockers,
    };
  });
  for (const domain of domains) blockers.push(...domain.blockers.map((item) => `${domain.domain}: ${item}`));
  return {
    schema: 'morphloom.production-dominance/0.4',
    pass: blockers.length === 0,
    claimAllowed: blockers.length === 0,
    domains,
    blockers,
    limitation: blockers.length === 0
      ? 'The claim is limited to the locked references, candidate revisions, render protocol, and native applications recorded by each case.'
      : 'All-domain superiority remains unproven until every blocker is resolved; technical readiness or one winning reference cannot substitute for missing same-input blind evidence.',
  };
}
