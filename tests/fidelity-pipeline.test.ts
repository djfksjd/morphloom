import { describe, expect, it } from 'vitest';
import { createOrnateKnifeIR } from '../src/engine/knife';
import { validateAssemblyIR } from '../src/engine/assembly-compiler';
import {
  auditFidelityContract,
  auditFidelityDelivery,
  createFidelityContract,
  fidelityContractFingerprint,
  startFidelityWorkflow,
  submitFidelityReview,
  type FidelityContract,
  type FidelityReview,
  type FidelityWorkflowState,
} from '../src/engine/fidelity-pipeline';
import { DEFAULT_KNIFE_SPEC } from '../src/types';
import { calibratePerspectiveCamera } from '../src/engine/perspective-camera-calibration';

function calibratedCamera(id = 'source-front', sourceViewId = 'reference-front') {
  const azimuthDegrees = 30;
  const pixelsPerWorldUnit = 2;
  const offsetPixels: [number, number] = [200, 150];
  const angle = azimuthDegrees * Math.PI / 180;
  const worlds: Array<[number, number, number]> = [
    [-2, -1, -1], [2, -1, -1], [-2, 1, 1], [2, 1, 1],
    [0, 0, 2], [1, 2, -2], [-1, -2, 2], [3, 0.5, 0],
  ];
  const anchors = worlds.map((world, index) => ({
    id: `anchor-${index + 1}`,
    world,
    image: [
      offsetPixels[0] + pixelsPerWorldUnit * (world[0] * Math.cos(angle) - world[2] * Math.sin(angle)),
      offsetPixels[1] - pixelsPerWorldUnit * world[1],
    ] as [number, number],
    evidenceRef: `fixture/${sourceViewId}/anchor-${index + 1}`,
  }));
  return {
    id,
    sourceViewId,
    projection: 'orthographic' as const,
    anchorCount: anchors.length,
    reprojectionErrorPx: 0,
    anchors,
    calibrationRevision: 'morphloom-camera-calibration/0.1' as const,
    azimuthDegrees,
    pixelsPerWorldUnit,
    offsetPixels,
  };
}

function calibratedPerspectiveCamera(id = 'source-perspective', sourceViewId = 'reference-perspective') {
  const worlds: Array<[number, number, number]> = [
    [-3, -2, -1], [3, -2, 0], [-2, 2, 1], [2, 2, 2],
    [0, 0, -2], [1, -1, 3], [-1, 1, 2.5], [2.5, 0.5, -0.5],
  ];
  const anchors = worlds.map((world, index) => ({
    id: `perspective-anchor-${index + 1}`,
    world,
    image: [320 + 700 * world[0] / (world[2] + 12), 240 - 700 * world[1] / (world[2] + 12)] as [number, number],
    evidenceRef: `fixture/${sourceViewId}/anchor-${index + 1}`,
  }));
  const calibration = calibratePerspectiveCamera(anchors);
  if (calibration.status !== 'calibrated') throw new Error(calibration.blockers.join('; '));
  return {
    id,
    sourceViewId,
    projection: 'perspective' as const,
    anchorCount: anchors.length,
    reprojectionErrorPx: calibration.rmsReprojectionErrorPixels,
    anchors,
    calibrationRevision: 'morphloom-camera-calibration/0.2' as const,
    projectionMatrix: calibration.projectionMatrix,
    worldCenter: calibration.worldCenter,
    worldScale: calibration.worldScale,
    imageCenter: calibration.imageCenter,
    imageScale: calibration.imageScale,
  };
}

function fixtureContract(overrides: Partial<FidelityContract> = {}): FidelityContract {
  const ir = createOrnateKnifeIR(DEFAULT_KNIFE_SPEC);
  const contract = createFidelityContract(ir, {
    domain: 'product',
    complexity: 'moderate',
    cameras: [calibratedCamera()],
    targetFidelity: 0.9,
    maxIterationsPerPass: 5,
    maxTotalIterations: 28,
    tokenBudget: 100_000,
  });
  return { ...contract, ...overrides };
}

function passingReview(contract: FidelityContract, state: FidelityWorkflowState, id: string): FidelityReview {
  const pass = contract.passes[state.activePassIndex];
  return {
    id,
    passId: pass.id,
    comparisonArtifact: `proof/${id}.png`,
    comparisonEvidence: {
      method: 'external-vision',
      referenceFingerprint: 'abcd1234',
      renderFingerprint: `abcd${indexFingerprint(id)}`,
    },
    sourceViewId: 'reference-front',
    proofViews: [...pass.requiredProofViews],
    fidelity: 0.99,
    silhouetteIoU: 0.99,
    interiorSimilarity: 0.99,
    featureScores: contract.details.map((feature) => ({ featureId: feature.id, score: 0.99 })),
    hardGateFailures: [],
    defectTags: [],
    spentTokens: 1_000,
  };
}

function indexFingerprint(value: string): string {
  let hash = 0;
  for (const character of value) hash = Math.imul(hash ^ character.charCodeAt(0), 0x45d9f3b);
  return (hash >>> 0).toString(16).padStart(4, '0').slice(-4);
}

describe('locked fidelity contract', () => {
  it('creates deterministic component, material, surface, and topology inventory', () => {
    const ir = createOrnateKnifeIR(DEFAULT_KNIFE_SPEC);
    const first = fixtureContract();
    const second = fixtureContract();
    expect(fidelityContractFingerprint(first)).toBe(fidelityContractFingerprint(second));
    expect(fidelityContractFingerprint({ ...second, tokenBudget: second.tokenBudget + 1 })).not.toBe(fidelityContractFingerprint(first));
    expect(first.details.map((item) => item.kind)).toEqual(expect.arrayContaining([
      'component', 'material', 'micro-surface', 'topology',
    ]));
    expect(first.details.filter((item) => item.importance === 'critical').length).toBeGreaterThan(0);
    expect(auditFidelityContract(first, ir)).toMatchObject({ pass: true, detailCoverage: 1, componentCoverage: 1, materialCoverage: 1 });
  });

  it('fails closed on legacy camera-summary contracts after the 0.2 receipt upgrade', () => {
    const ir = createOrnateKnifeIR(DEFAULT_KNIFE_SPEC);
    const legacy = structuredClone(fixtureContract()) as unknown as FidelityContract;
    Object.assign(legacy, { schema: 'morphloom.fidelity/0.1' });
    expect(auditFidelityContract(legacy, ir).blockers).toContain('unsupported fidelity schema');
  });

  it('fails closed for shallow inventory, missing camera calibration, and unsafe budgets', () => {
    const ir = createOrnateKnifeIR(DEFAULT_KNIFE_SPEC);
    const contract = fixtureContract();
    const audit = auditFidelityContract({
      ...contract,
      details: contract.details.slice(0, 2),
      cameras: [],
      maxTotalIterations: 999,
    }, ir);
    expect(audit.pass).toBe(false);
    expect(audit.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining('detail inventory'),
      expect.stringContaining('calibrated source camera'),
      'maxTotalIterations is unsafe',
    ]));
  });

  it('rejects underconstrained camera calibration with fewer than four anchors', () => {
    const ir = createOrnateKnifeIR(DEFAULT_KNIFE_SPEC);
    const contract = fixtureContract();
    const underconstrained = structuredClone(contract);
    underconstrained.cameras[0].anchorCount = 3;
    expect(auditFidelityContract(underconstrained, ir).blockers).toContain(
      'invalid camera calibration: source-front',
    );
  });

  it('rejects a reported camera result that cannot be recomputed from its bound anchors', () => {
    const ir = createOrnateKnifeIR(DEFAULT_KNIFE_SPEC);
    const contract = fixtureContract();
    const fabricated = structuredClone(contract);
    fabricated.cameras[0].azimuthDegrees += 5;
    expect(auditFidelityContract(fabricated, ir).blockers).toContain(
      'camera receipt does not reproduce from anchor coordinates: source-front',
    );
    const missingEvidence = structuredClone(contract);
    missingEvidence.cameras[0].anchors[0].evidenceRef = '';
    expect(auditFidelityContract(missingEvidence, ir).blockers).toContain(
      'invalid camera anchor evidence: source-front',
    );
    const oversized = structuredClone(contract);
    oversized.cameras[0].anchors = Array.from({ length: 513 }, (_, index) => ({
      ...oversized.cameras[0].anchors[index % oversized.cameras[0].anchors.length]!,
      id: `oversized-${index}`,
    }));
    oversized.cameras[0].anchorCount = oversized.cameras[0].anchors.length;
    expect(() => auditFidelityContract(oversized, ir)).not.toThrow();
    expect(auditFidelityContract(oversized, ir).blockers).toContain(
      'missing reproducible camera receipt: source-front',
    );
  });

  it('accepts a reproducible perspective receipt and blocks a modified projection matrix', () => {
    const ir = createOrnateKnifeIR(DEFAULT_KNIFE_SPEC);
    const perspective = fixtureContract({ cameras: [calibratedPerspectiveCamera()] });
    expect(auditFidelityContract(perspective, ir).pass).toBe(true);
    const modified = structuredClone(perspective);
    if (modified.cameras[0].projection !== 'perspective') throw new Error('expected perspective fixture');
    modified.cameras[0].projectionMatrix[0] += 0.1;
    expect(auditFidelityContract(modified, ir).blockers).toContain(
      'camera receipt does not reproduce from anchor coordinates: source-perspective',
    );
  });

  it('rejects missing component mappings, material mismatches, and canonical pass reordering', () => {
    const ir = createOrnateKnifeIR(DEFAULT_KNIFE_SPEC);
    const contract = fixtureContract();
    const altered = structuredClone(contract);
    altered.details[0].componentIds = ['missing-part'];
    altered.materialRegions[0].expectedSurface = 'hair';
    [altered.passes[0], altered.passes[1]] = [altered.passes[1], altered.passes[0]];
    const audit = auditFidelityContract(altered, ir);
    expect(audit.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining('missing component'),
      expect.stringContaining('surface mismatch'),
      'fidelity passes must use the locked canonical order',
    ]));
  });

  it('covers every part and surfaced region in a bounded 500-component assembly', () => {
    const ir = createOrnateKnifeIR(DEFAULT_KNIFE_SPEC);
    const template = ir.components[0];
    ir.name = 'bounded-large-assembly';
    ir.components = Array.from({ length: 500 }, (_, index) => ({
      ...structuredClone(template),
      id: `part-${index}`,
      name: `Part ${index}`,
    }));
    const contract = createFidelityContract(ir, {
      domain: 'product',
      cameras: [calibratedCamera('large-camera', 'large-reference')],
    });
    expect(contract.details.length).toBeLessThanOrEqual(2_048);
    expect(contract.materialRegions).toHaveLength(500);
    expect(auditFidelityContract(contract, ir)).toMatchObject({ pass: true, componentCoverage: 1, materialCoverage: 1 });
    ir.fidelity = contract;
    expect(() => validateAssemblyIR(ir)).not.toThrow();
  });
});

describe('bounded fidelity workflow', () => {
  it('does not let a high average hide one failed critical feature', () => {
    const contract = fixtureContract();
    const state = startFidelityWorkflow(contract);
    const review = passingReview(contract, state, 'critical-fail');
    const critical = contract.details.find((item) => item.importance === 'critical');
    if (!critical) throw new Error('test contract must include a critical feature');
    review.featureScores.find((item) => item.featureId === critical.id)!.score = critical.threshold - 0.01;
    const result = submitFidelityReview(contract, state, review);
    expect(result).toMatchObject({ accepted: false, action: 'refine-ir' });
    expect(result.failedFeatureIds).toContain(critical.id);
  });

  it('requires calibrated comparison views and every pass proof view', () => {
    const contract = fixtureContract();
    const state = startFidelityWorkflow(contract);
    const missingView = passingReview(contract, state, 'missing-view');
    missingView.proofViews = ['source-camera'];
    expect(submitFidelityReview(contract, state, missingView)).toMatchObject({
      accepted: false, action: 'refine-spec', reason: expect.stringContaining('missing proof view'),
    });
    const uncalibrated = passingReview(contract, state, 'uncalibrated');
    uncalibrated.sourceViewId = 'free-camera';
    expect(submitFidelityReview(contract, state, uncalibrated)).toMatchObject({
      accepted: false, action: 'refine-spec', reason: 'review source view is not calibrated',
    });
    const incompletePixelProof = passingReview(contract, state, 'incomplete-pixel-proof');
    incompletePixelProof.comparisonEvidence.method = 'pixel-frame-v1';
    incompletePixelProof.silhouetteIoU = undefined;
    expect(() => submitFidelityReview(contract, state, incompletePixelProof)).toThrow(/must include silhouette and interior/);
  });

  it('blocks hard-gate failures and over-budget work', () => {
    const contract = fixtureContract({ tokenBudget: 500 });
    const state = startFidelityWorkflow(contract);
    const hardGate = passingReview(contract, state, 'hard-gate');
    hardGate.spentTokens = 0;
    hardGate.hardGateFailures = ['attachment-integrity'];
    expect(submitFidelityReview(contract, state, hardGate)).toMatchObject({ accepted: false, action: 'refine-ir' });
    const overBudget = passingReview(contract, state, 'over-budget');
    expect(submitFidelityReview(contract, state, overBudget)).toMatchObject({
      accepted: false, action: 'request-input', state: { stopped: true },
    });
  });

  it('reverts a regression and refines the specification for repeated defects', () => {
    const contract = fixtureContract();
    let state = startFidelityWorkflow(contract);
    const first = passingReview(contract, state, 'initial-low');
    first.fidelity = 0.8;
    first.featureScores.forEach((score) => { score.score = 0.99; });
    const initial = submitFidelityReview(contract, state, first);
    state = initial.state;
    const regression = passingReview(contract, state, 'regression');
    regression.fidelity = 0.78;
    expect(submitFidelityReview(contract, state, regression)).toMatchObject({
      accepted: false, action: 'refine-ir', reason: expect.stringContaining('regressed'), revertToReviewId: 'initial-low',
    });

    state = startFidelityWorkflow(contract);
    const defectOne = passingReview(contract, state, 'defect-one');
    defectOne.defectTags = ['blade-profile'];
    state = submitFidelityReview(contract, state, defectOne).state;
    const defectTwo = passingReview(contract, state, 'defect-two');
    defectTwo.defectTags = ['blade-profile'];
    expect(submitFidelityReview(contract, state, defectTwo)).toMatchObject({
      accepted: false, action: 'refine-spec', reason: expect.stringContaining('survived two corrections'),
    });
  });

  it('stops on a plateau and always terminates at a refinement ceiling', () => {
    const contract = fixtureContract();
    let state = startFidelityWorkflow(contract);
    const first = passingReview(contract, state, 'plateau-one');
    first.fidelity = 0.79;
    state = submitFidelityReview(contract, state, first).state;
    const second = passingReview(contract, state, 'plateau-two');
    second.fidelity = 0.795;
    expect(submitFidelityReview(contract, state, second)).toMatchObject({
      accepted: false, action: 'request-input', reason: expect.stringContaining('plateaued'), state: { stopped: true },
    });

    const bounded = fixtureContract({ maxIterationsPerPass: 2, maxTotalIterations: 8 });
    state = startFidelityWorkflow(bounded);
    const failOne = passingReview(bounded, state, 'bounded-one');
    const critical = bounded.details.find((item) => item.importance === 'critical')!;
    failOne.featureScores.find((item) => item.featureId === critical.id)!.score = 0.7;
    state = submitFidelityReview(bounded, state, failOne).state;
    const failTwo = passingReview(bounded, state, 'bounded-two');
    failTwo.fidelity = 0.9;
    failTwo.featureScores.find((item) => item.featureId === critical.id)!.score = 0.75;
    expect(submitFidelityReview(bounded, state, failTwo)).toMatchObject({
      accepted: false, action: 'request-input', reason: 'bounded refinement ceiling reached', state: { stopped: true },
    });
  });

  it('replays accepted and rejected review ids without changing state', () => {
    const contract = fixtureContract();
    const initial = startFidelityWorkflow(contract);
    const rejectedReview = passingReview(contract, initial, 'idempotent-reject');
    rejectedReview.hardGateFailures = ['topology-integrity'];
    const rejected = submitFidelityReview(contract, initial, rejectedReview);
    const rejectionReplay = submitFidelityReview(contract, rejected.state, rejectedReview);
    expect(rejectionReplay).toMatchObject({ accepted: false, action: 'refine-ir' });
    expect(rejectionReplay.state).toBe(rejected.state);
    const conflictingReplay = { ...rejectedReview, spentTokens: rejectedReview.spentTokens + 1 };
    expect(() => submitFidelityReview(contract, rejected.state, conflictingReplay)).toThrow(/Review id conflict/);

    const acceptedReview = passingReview(contract, initial, 'idempotent-accept');
    const accepted = submitFidelityReview(contract, initial, acceptedReview);
    const acceptanceReplay = submitFidelityReview(contract, accepted.state, acceptedReview);
    expect(acceptanceReplay).toMatchObject({ accepted: true, action: 'advance' });
    expect(acceptanceReplay.state).toBe(accepted.state);
  });

  it('completes all eight locked passes and only then releases delivery', () => {
    const contract = fixtureContract();
    let state = startFidelityWorkflow(contract);
    expect(auditFidelityDelivery(contract, state).pass).toBe(false);
    for (let index = 0; index < contract.passes.length; index += 1) {
      const transition = submitFidelityReview(contract, state, passingReview(contract, state, `pass-${index}`));
      expect(transition.accepted).toBe(true);
      state = transition.state;
    }
    expect(state).toMatchObject({ stopped: true, stopReason: 'all fidelity passes accepted' });
    expect(auditFidelityDelivery(contract, state)).toEqual({ pass: true, blockers: [] });
    const tampered = structuredClone(state);
    tampered.bestReviewByPass.blockout!.score = 1;
    expect(auditFidelityDelivery(contract, tampered)).toMatchObject({
      pass: false, blockers: expect.arrayContaining(['fidelity proof below threshold: blockout']),
    });
    const finalReview = state.reviews.at(-1)!;
    expect(submitFidelityReview(contract, state, finalReview)).toMatchObject({ accepted: true, action: 'complete' });
  });
});
