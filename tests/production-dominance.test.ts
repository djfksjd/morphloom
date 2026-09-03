import { describe, expect, it } from 'vitest';
import {
  auditProductionDominance as auditProductionDominanceEngine,
  PRODUCTION_BENCHMARK_DOMAINS,
  type ProductionBenchmarkDomain,
  type ProductionDominanceCase,
} from '../src/engine/production-dominance';
import type { SameInputVisualBenchmarkReport } from '../src/engine/visual-benchmark';

const auditProductionDominance = (cases: ProductionDominanceCase[]) => auditProductionDominanceEngine(cases, {
  developmentExposureLedgerSha256: 'c'.repeat(64), exposedCorpusCases: [],
});

function visual(
  domain: SameInputVisualBenchmarkReport['domain'],
  status: SameInputVisualBenchmarkReport['status'] = 'morphloom-winner',
): SameInputVisualBenchmarkReport {
  const score = (id: 'morphloom' | 'img2threejs', value: number) => ({
    id, score: value, silhouetteIoU: value, interiorSimilarity: value, materialSimilarity: value,
    surfaceScaleSimilarity: value, irregularitySimilarity: value, spatialStructureSimilarity: value,
    minimumFeatureScore: value, minimumViewScore: value, views: [],
  });
  return {
    schema: 'morphloom.same-input-visual-audit/0.2', id: 'case', domain,
    lockedInputFingerprint: '1'.repeat(64),
    candidateRendererVersions: { morphloom: 'morphloom-compiler/0.30.0', img2threejs: 'img2threejs/test' },
    status,
    claimAllowed: status === 'morphloom-winner',
    scores: { morphloom: score('morphloom', 0.9), img2threejs: score('img2threejs', 0.8) },
    blind: {
      eligible: true, ratings: 5, morphloomShare: 0.8, img2threejsShare: 0.2, tieShare: 0,
      ratingSetFingerprint: 'a'.repeat(64),
    },
    captureProtocol: { verified: true, evidenceFingerprint: 'f'.repeat(64) }, blockers: [], limitation: 'locked fixture',
  };
}

function benchmarkCase(domain: ProductionBenchmarkDomain, index: number): ProductionDominanceCase {
  const nativeReopens = domain === 'game' ? ['Blender', 'Unity']
    : domain === '3d-print' ? ['Blender', 'Prusa-Slicer'] : ['Blender'];
  const visualDomain = domain === 'architecture' ? 'architecture'
    : domain === 'animation' || domain === 'game' ? 'character'
      : domain === 'surface' ? 'surface' : 'industrial-design';
  const inputFingerprint = `${index + 1}`.repeat(64).slice(0, 64);
  const report = visual(visualDomain);
  report.id = `${domain}-${index}`;
  report.lockedInputFingerprint = inputFingerprint;
  return {
    id: `${domain}-${index}`,
    domain,
    inputFingerprint,
    independentReferenceFingerprint: `${index + 4}`.repeat(64).slice(0, 64),
    sameInputLocked: true,
    groundTruth: {
      schema: 'morphloom.independent-ground-truth/0.2',
      corpusId: 'verified-fixture-corpus',
      corpusCaseId: `${domain}-${index}`,
      manifestSha256: 'f'.repeat(64),
      lockedInputSha256: inputFingerprint,
      referenceAssetSha256: `${index + 4}`.repeat(64).slice(0, 64),
      auditPass: true,
      selectionProtocol: 'external-hidden-set',
      inputLockedAt: '2026-01-01T00:00:00.000Z',
      referenceRevealedAt: '2026-01-03T00:00:00.000Z',
      referenceHiddenUntilCandidatesSealed: true,
      developmentExposure: 'none',
      contaminationAuditSha256: 'c'.repeat(64),
      candidateSeals: {
        morphloom: {
          schema: 'morphloom.holdout-candidate-seal/0.1',
          engineRevision: 'morphloom-compiler/0.30.0',
          artifactSha256: `${index + 1}`.repeat(64).slice(0, 64),
          sealedAt: '2026-01-02T00:00:00.000Z',
          receiptSha256: `${index + 10}`.repeat(64).slice(0, 64),
        },
        img2threejs: {
          schema: 'morphloom.holdout-candidate-seal/0.1',
          engineRevision: 'img2threejs/test',
          artifactSha256: `${index + 7}`.repeat(64).slice(0, 64),
          sealedAt: '2026-01-02T01:00:00.000Z',
          receiptSha256: `${index + 13}`.repeat(64).slice(0, 64),
        },
      },
    },
    morphloom: {
      engineRevision: 'morphloom-compiler/0.30.0', artifactSha256: `${index + 1}`.repeat(64).slice(0, 64),
      releaseReceiptSha256: `${index + 2}`.repeat(64).slice(0, 64), releasePass: true, deterministic: true,
      browserRoundTrip: true, deliveryScore: 96, nativeReopens,
      referencePbr: {
        schema: 'morphloom.reference-pbr-receipt/0.1',
        receiptSha256: `${index + 3}`.repeat(64).slice(0, 64),
        referenceAssetSha256: `${index + 4}`.repeat(64).slice(0, 64),
        candidateArtifactSha256: `${index + 1}`.repeat(64).slice(0, 64),
        pass: true,
      },
    },
    img2threejs: {
      engineRevision: 'img2threejs/test', artifactSha256: `${index + 7}`.repeat(64).slice(0, 64),
      releaseReceiptSha256: `${index + 8}`.repeat(64).slice(0, 64), releasePass: true, deterministic: true,
      browserRoundTrip: true, deliveryScore: 80, nativeReopens: ['Blender'],
      referencePbr: {
        schema: 'morphloom.reference-pbr-receipt/0.1',
        receiptSha256: `${index + 9}`.repeat(64).slice(0, 64),
        referenceAssetSha256: `${index + 4}`.repeat(64).slice(0, 64),
        candidateArtifactSha256: `${index + 7}`.repeat(64).slice(0, 64),
        pass: false,
      },
    },
    visual: report,
  };
}

describe('all-domain production dominance gate', () => {
  it('fails closed when one attractive reference is mistaken for all-domain superiority', () => {
    const report = auditProductionDominance([benchmarkCase('industrial-design', 0)]);
    expect(report.pass).toBe(false);
    expect(report.claimAllowed).toBe(false);
    expect(report.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining('industrial-design: 1/3 required same-input cases'),
      expect.stringContaining('architecture: 0/3 required same-input cases'),
      expect.stringContaining('game: 0/3 required same-input cases'),
    ]));
  });

  it('requires native runtime and slicer reopen evidence for their delivery domains', () => {
    const cases = PRODUCTION_BENCHMARK_DOMAINS.flatMap((domain) => [0, 1, 2].map((index) => benchmarkCase(domain, index)));
    cases.find((item) => item.domain === 'game')!.morphloom.nativeReopens = ['Blender'];
    cases.find((item) => item.domain === '3d-print')!.morphloom.nativeReopens = ['Blender'];
    const report = auditProductionDominance(cases);
    expect(report.pass).toBe(false);
    expect(report.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining('game: game-0: Morphloom native target reopen evidence is incomplete'),
      expect.stringContaining('3d-print: 3d-print-0: Morphloom native target reopen evidence is incomplete'),
    ]));
  });

  it('allows a scoped superiority claim only after every locked domain case passes', () => {
    const cases = PRODUCTION_BENCHMARK_DOMAINS.flatMap((domain) => [0, 1, 2].map((index) => benchmarkCase(domain, index)));
    const report = auditProductionDominance(cases);
    expect(report.pass).toBe(true);
    expect(report.claimAllowed).toBe(true);
    expect(report.domains).toHaveLength(PRODUCTION_BENCHMARK_DOMAINS.length);
    expect(report.domains.every((item) => item.cases === 3 && item.visualWinRate === 1)).toBe(true);
  });

  it('rejects malformed candidate scores before they can influence a claim', () => {
    const item = benchmarkCase('surface', 0);
    item.morphloom.deliveryScore = Number.NaN;
    expect(() => auditProductionDominance([item])).toThrow(/unsafe/);
  });

  it('rejects a visual report copied from another input or engine revision', () => {
    const item = benchmarkCase('industrial-design', 0);
    item.visual.lockedInputFingerprint = 'f'.repeat(64);
    expect(() => auditProductionDominance([item])).toThrow(/visual proof/);
  });

  it('binds each PBR receipt to the same reference and candidate artifact', () => {
    const mismatched = benchmarkCase('surface', 0);
    mismatched.morphloom.referencePbr.candidateArtifactSha256 = 'e'.repeat(64);
    expect(() => auditProductionDominance([mismatched])).toThrow(/PBR proof/);

    const failed = benchmarkCase('surface', 0);
    failed.morphloom.referencePbr.pass = false;
    const report = auditProductionDominance([failed]);
    expect(report.blockers).toContainEqual(expect.stringContaining('reference-bound PBR audit failed'));
  });

  it('rejects a claimed win whose input or reference is not bound to an independently audited corpus', () => {
    const item = benchmarkCase('industrial-design', 0);
    item.groundTruth.lockedInputSha256 = 'e'.repeat(64);
    expect(() => auditProductionDominance([item])).toThrow(/ground-truth proof/);

    const leaked = benchmarkCase('industrial-design', 0);
    leaked.groundTruth.referenceAssetSha256 = leaked.morphloom.artifactSha256;
    leaked.independentReferenceFingerprint = leaked.morphloom.artifactSha256;
    expect(() => auditProductionDominance([leaked])).toThrow(/ground-truth proof/);
  });

  it('rejects a tuned case or a candidate sealed after holdout reference reveal', () => {
    const tuned = benchmarkCase('industrial-design', 0);
    tuned.groundTruth.developmentExposure = 'tuning';
    expect(() => auditProductionDominance([tuned])).toThrow(/ground-truth proof/);

    const late = benchmarkCase('industrial-design', 0);
    late.groundTruth.candidateSeals.morphloom.sealedAt = '2026-01-04T00:00:00.000Z';
    expect(() => auditProductionDominance([late])).toThrow(/ground-truth proof/);
  });

  it('binds both pre-reveal candidate seals to their exact engine and artifact', () => {
    const wrongArtifact = benchmarkCase('industrial-design', 0);
    wrongArtifact.groundTruth.candidateSeals.img2threejs.artifactSha256 = 'f'.repeat(64);
    expect(() => auditProductionDominance([wrongArtifact])).toThrow(/ground-truth proof/);

    const wrongRevision = benchmarkCase('industrial-design', 0);
    wrongRevision.groundTruth.candidateSeals.morphloom.engineRevision = 'morphloom-compiler/older';
    expect(() => auditProductionDominance([wrongRevision])).toThrow(/ground-truth proof/);

    const looseTimestamp = benchmarkCase('industrial-design', 0);
    looseTimestamp.groundTruth.candidateSeals.morphloom.sealedAt = '2026-01-02';
    expect(() => auditProductionDominance([looseTimestamp])).toThrow(/ground-truth proof/);
  });

  it('rejects a case found in the hash-bound development exposure ledger', () => {
    const item = benchmarkCase('industrial-design', 0);
    expect(() => auditProductionDominanceEngine([item], {
      developmentExposureLedgerSha256: 'c'.repeat(64),
      exposedCorpusCases: [`${item.groundTruth.corpusId}/${item.groundTruth.corpusCaseId}`],
    })).toThrow(/ground-truth proof/);
  });

  it('blocks repeated inputs and reused candidate artifacts from satisfying case volume', () => {
    const cases = [0, 1, 2].map((index) => benchmarkCase('architecture', index));
    for (const item of cases) {
      item.inputFingerprint = '1'.repeat(64);
      item.visual.lockedInputFingerprint = item.inputFingerprint;
      item.groundTruth.lockedInputSha256 = item.inputFingerprint;
      item.morphloom.artifactSha256 = 'a'.repeat(64);
      item.groundTruth.candidateSeals.morphloom.artifactSha256 = item.morphloom.artifactSha256;
      item.morphloom.referencePbr.candidateArtifactSha256 = item.morphloom.artifactSha256;
      item.morphloom.referencePbr.receiptSha256 = 'b'.repeat(64);
      item.groundTruth.candidateSeals.morphloom.receiptSha256 = '9'.repeat(64);
    }
    const report = auditProductionDominance(cases);
    expect(report.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining('architecture: 1/3 independent locked inputs'),
      expect.stringContaining('architecture: morphloom: artifact bytes were reused across cases'),
      expect.stringContaining('architecture: morphloom: PBR receipts were reused across cases'),
      expect.stringContaining('architecture: morphloom: holdout candidate seals were reused across cases'),
    ]));
  });

  it('rejects one seal receipt reused for both engine candidates', () => {
    const item = benchmarkCase('industrial-design', 0);
    item.groundTruth.candidateSeals.img2threejs.receiptSha256
      = item.groundTruth.candidateSeals.morphloom.receiptSha256;
    expect(() => auditProductionDominance([item])).toThrow(/reuse evidence/);
  });
});
