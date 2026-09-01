export type BenchmarkDomain =
  | 'product'
  | 'industrial-design'
  | 'architecture'
  | 'service-assembly'
  | 'character'
  | 'animation'
  | 'game'
  | '3d-print';
export type BenchmarkExpectedDecision = 'release' | 'block';

export interface BenchmarkCaseInput {
  id: string;
  domain: BenchmarkDomain;
  topologyPass: boolean;
  evidenceScore: number;
  surfaceCoverage: number;
  domainChecksPass: boolean;
  firstFingerprint: string;
  repeatedFingerprint: string;
  inputFingerprint?: string;
  browserGlbRoundTrip?: boolean;
  expectedDecision?: BenchmarkExpectedDecision;
  expectedBlockerPrefix?: string;
}

export interface BenchmarkCaseResult extends BenchmarkCaseInput {
  reproducible: boolean;
  technicalReady: boolean;
  modelReady: boolean;
  deliveryReady: boolean;
  decisionCorrect: boolean;
  benchmarkPassed: boolean;
  score: number;
  blockers: string[];
}

const EVIDENCE_THRESHOLD: Record<BenchmarkDomain, number> = {
  product: 80,
  'industrial-design': 80,
  architecture: 85,
  'service-assembly': 85,
  character: 85,
  animation: 80,
  game: 75,
  '3d-print': 80,
};

const SURFACE_THRESHOLD: Record<BenchmarkDomain, number> = {
  product: 0.75,
  'industrial-design': 0.75,
  architecture: 0.4,
  'service-assembly': 0.75,
  character: 0.75,
  animation: 0.75,
  game: 0.75,
  '3d-print': 0,
};

export function evaluateBenchmarkCase(input: BenchmarkCaseInput): BenchmarkCaseResult {
  const qualityBlockers: string[] = [];
  const reproducible = input.firstFingerprint === input.repeatedFingerprint;
  if (!reproducible) qualityBlockers.push('same-input structural fingerprint changed');
  if (!input.topologyPass) qualityBlockers.push('topology failed');
  if (input.evidenceScore < EVIDENCE_THRESHOLD[input.domain]) {
    qualityBlockers.push(`evidence ${input.evidenceScore}/${EVIDENCE_THRESHOLD[input.domain]}`);
  }
  if (input.surfaceCoverage < SURFACE_THRESHOLD[input.domain]) {
    qualityBlockers.push(`micro-surface ${Math.round(input.surfaceCoverage * 100)}%/${Math.round(SURFACE_THRESHOLD[input.domain] * 100)}%`);
  }
  if (!input.domainChecksPass) qualityBlockers.push(`${input.domain} domain checks failed`);
  const modelReady = qualityBlockers.length === 0;
  const deliveryReady = modelReady && input.browserGlbRoundTrip === true;
  const blockers = [...qualityBlockers];
  if (modelReady && input.browserGlbRoundTrip !== true) blockers.push('browser GLB round-trip required');
  const technicalReady = reproducible
    && input.topologyPass
    && input.surfaceCoverage >= SURFACE_THRESHOLD[input.domain]
    && input.domainChecksPass
    && input.browserGlbRoundTrip === true;
  const expectedDecision = input.expectedDecision ?? 'release';
  const expectedBlockerObserved = expectedDecision === 'block'
    && typeof input.expectedBlockerPrefix === 'string'
    && input.expectedBlockerPrefix.length > 0
    && qualityBlockers.some((item) => item.startsWith(input.expectedBlockerPrefix as string));
  const decisionCorrect = expectedDecision === 'release'
    ? deliveryReady
    : !modelReady && expectedBlockerObserved;
  const benchmarkPassed = technicalReady && decisionCorrect;
  const raw = Math.round((
    (reproducible ? 100 : 0)
    + (input.topologyPass ? 100 : 0)
    + Math.max(0, Math.min(100, input.evidenceScore))
    + Math.max(0, Math.min(100, input.surfaceCoverage * 100))
    + (input.domainChecksPass ? 100 : 0)
    + (input.browserGlbRoundTrip === true ? 100 : 65)
  ) / 6);
  const score = deliveryReady ? raw : modelReady ? Math.min(79, raw) : Math.min(59, raw);
  return {
    ...input,
    expectedDecision,
    reproducible,
    technicalReady,
    modelReady,
    deliveryReady,
    decisionCorrect,
    benchmarkPassed,
    score,
    blockers,
  };
}

export interface BenchmarkPassRates {
  overall: number;
  technical: number;
  decision: number;
  modelRelease: number;
  deliveryRelease: number;
  rejectionSafety: number;
}

export function benchmarkPassRates(cases: BenchmarkCaseResult[]): BenchmarkPassRates {
  if (cases.length === 0) {
    return { overall: 0, technical: 0, decision: 0, modelRelease: 0, deliveryRelease: 0, rejectionSafety: 0 };
  }
  const releaseCases = cases.filter((item) => (item.expectedDecision ?? 'release') === 'release');
  const rejectionCases = cases.filter((item) => item.expectedDecision === 'block');
  return {
    overall: cases.filter((item) => item.benchmarkPassed).length / cases.length,
    technical: cases.filter((item) => item.technicalReady).length / cases.length,
    decision: cases.filter((item) => item.decisionCorrect).length / cases.length,
    modelRelease: releaseCases.length > 0
      ? releaseCases.filter((item) => item.modelReady).length / releaseCases.length
      : 0,
    deliveryRelease: releaseCases.length > 0
      ? releaseCases.filter((item) => item.deliveryReady).length / releaseCases.length
      : 0,
    rejectionSafety: rejectionCases.length > 0
      ? rejectionCases.filter((item) => item.decisionCorrect && item.technicalReady).length / rejectionCases.length
      : 0,
  };
}
