import { describe, expect, it } from 'vitest';
import type { AssemblyIR } from '../src/engine/assembly-ir';
import {
  createBoundedAxisScaleRecoveryTrials,
  createBoundedGroupAxisSpacingTrials,
  createBoundedScaleRecoveryTrials,
  createBoundedShapeRecoveryTrials,
  createBoundedTranslationRecoveryTrials,
  createSemanticTranslationRecoveryTrials,
  createSurfaceAttributionAxisScaleRecoveryTrials,
  createSurfaceAttributionTubeControlRecoveryTrials,
  createSurfaceAttributionTranslationRecoveryTrials,
  executeBoundedGeometryRecoverySearch,
  executeIterativeGeometryRecoverySearch,
  type GeometryRecoveryEvaluation,
} from '../src/engine/geometry-recovery-executor';
import { fingerprintAssemblyIR } from '../src/engine/assembly-edit';
import type { GeometryRecoveryPlan } from '../src/engine/geometry-recovery-plan';
import { GALAXY_Z_FOLD8_EXTERIOR_IR } from '../src/engine/galaxy-fold8-exterior';
import { COOLING_ASSEMBLY_IR } from '../src/engine/cooling-assembly';
import { createOrnateKnifeIR } from '../src/engine/knife';
import { DEFAULT_KNIFE_SPEC } from '../src/types';

function planFor(componentId: string): GeometryRecoveryPlan {
  return {
    schema: 'morphloom.geometry-recovery-plan/0.1', pass: true, actionable: true,
    sourceGeometryAuditFingerprint: 'a'.repeat(64), sourceVisualPlanFingerprint: 'b'.repeat(64),
    blockers: [], warnings: [], actions: [{
      id: 'recover-reference-intersection-1', causeBandId: 'reference:x-low',
      causeBandIds: ['reference:x-low', 'reference:y-low'], priority: 1,
      operation: 'expand-or-reshape-existing-units', targetComponentIds: [componentId],
      candidateComponentCount: 1, spatialConstraintIds: ['reference:x-low', 'reference:y-low'],
      targetingMode: 'cross-axis-intersection', evidenceViewIds: ['front'], requiredComponentIds: [componentId],
      prohibitedOperations: ['delete-required-component', 'lower-locked-feature-count', 'change-source-evidence'],
      verificationGates: ['surface-geometry-fidelity', 'visual-plan-revision', 'topology-integrity', 'multiview-silhouette'],
      reason: 'fixture',
    }],
  };
}

function scaleOf(ir: AssemblyIR, componentId: string): number {
  return ir.components.find((component) => component.id === componentId)?.scale?.[0] ?? 1;
}

async function scaleRoundProposal(ir: AssemblyIR, componentId: string) {
  const plan = planFor(componentId);
  return {
    sourceIrFingerprint: await fingerprintAssemblyIR(ir),
    plan,
    trials: createBoundedScaleRecoveryTrials(plan, { expansionFactors: [1.05] }),
  };
}

describe('bounded geometry recovery execution', () => {
  it('scales only the failed aligned axis while preserving unaffected dimensions', () => {
    const componentId = GALAXY_Z_FOLD8_EXTERIOR_IR.components[0]!.id;
    const plan = planFor(componentId);
    plan.actions[0]!.causeBandId = 'candidate:z-low';
    plan.actions[0]!.causeBandIds = ['candidate:z-low'];
    plan.actions[0]!.spatialConstraintIds = ['candidate:z-low'];
    plan.actions[0]!.operation = 'relocate-or-reshape-extraneous-units';
    const trials = createBoundedAxisScaleRecoveryTrials(plan, {
      alignedYawDegrees: 180, reductionFactors: [0.8],
    });
    expect(trials).toHaveLength(1);
    expect(trials[0]!.edits[0]!.scaleMultiplier).toEqual([1, 1, 0.8]);
  });

  it('maps a failed aligned depth axis back to width at a quarter-turn yaw', () => {
    const componentId = GALAXY_Z_FOLD8_EXTERIOR_IR.components[0]!.id;
    const plan = planFor(componentId);
    plan.actions[0]!.spatialConstraintIds = ['reference:z-high'];
    const trials = createBoundedAxisScaleRecoveryTrials(plan, {
      alignedYawDegrees: 90, expansionFactors: [1.2],
    });
    expect(trials[0]!.edits[0]!.scaleMultiplier?.[0]).toBeCloseTo(1.2);
    expect(trials[0]!.edits[0]!.scaleMultiplier?.[1]).toBeCloseTo(1);
    expect(trials[0]!.edits[0]!.scaleMultiplier?.[2]).toBeCloseTo(1);
  });

  it('can probe the bounded opposite scale direction when spatial inference is wrong', () => {
    const componentId = GALAXY_Z_FOLD8_EXTERIOR_IR.components[0]!.id;
    const plan = planFor(componentId);
    plan.actions[0]!.spatialConstraintIds = ['reference:z-middle'];
    const trials = createBoundedAxisScaleRecoveryTrials(plan, {
      alignedYawDegrees: 0, expansionFactors: [1.1], reductionFactors: [0.9],
      includeCounterfactualDirection: true,
    });
    expect(trials.map((trial) => trial.id)).toEqual([
      `${plan.actions[0]!.id}:axis-scale-1`,
      `${plan.actions[0]!.id}:counter-axis-scale-1`,
    ]);
    expect(trials.map((trial) => trial.edits[0]!.scaleMultiplier)).toEqual([
      [1, 1, 1.1], [1, 1, 0.9],
    ]);
  });

  it('maps the world recovery axis into a rotated component local scale basis', () => {
    const source = structuredClone(GALAXY_Z_FOLD8_EXTERIOR_IR);
    const componentId = source.components[0]!.id;
    source.components[0]!.rotation = [Math.PI / 2, 0, 0];
    const plan = planFor(componentId);
    plan.actions[0]!.spatialConstraintIds = ['reference:z-high'];
    const trials = createBoundedAxisScaleRecoveryTrials(plan, {
      alignedYawDegrees: 0, expansionFactors: [1.2], sourceIr: source,
    });
    expect(trials[0]!.edits[0]!.scaleMultiplier?.[0]).toBeCloseTo(1);
    expect(trials[0]!.edits[0]!.scaleMultiplier?.[1]).toBeCloseTo(1.2);
    expect(trials[0]!.edits[0]!.scaleMultiplier?.[2]).toBeCloseTo(1);
  });

  it('keeps a middle-band axis actionable for profile thickness recovery', () => {
    const componentId = GALAXY_Z_FOLD8_EXTERIOR_IR.components[0]!.id;
    const plan = planFor(componentId);
    plan.actions[0]!.spatialConstraintIds = ['candidate:z-middle'];
    plan.actions[0]!.operation = 'relocate-or-reshape-extraneous-units';
    const trials = createBoundedAxisScaleRecoveryTrials(plan, {
      alignedYawDegrees: 0, reductionFactors: [0.8],
    });
    expect(trials[0]!.edits[0]!.scaleMultiplier).toEqual([1, 1, 0.8]);
  });

  it('selects the strongest isolated improvement from independent bounded trials', async () => {
    const source = structuredClone(GALAXY_Z_FOLD8_EXTERIOR_IR);
    const componentId = source.components[0]!.id;
    const plan = planFor(componentId);
    const trials = createBoundedScaleRecoveryTrials(plan, { expansionFactors: [1.02, 1.06] });
    const evaluate = async (ir: AssemblyIR): Promise<GeometryRecoveryEvaluation> => {
      const shape = Math.min(1, 0.5 + (scaleOf(ir, componentId) - 1) * 2);
      return { gateScores: { shape, topology: 1 }, blockingGateIds: shape < 0.55 ? ['shape'] : [] };
    };
    const result = await executeBoundedGeometryRecoverySearch(source, plan, trials, evaluate, {
      targetGateIds: ['shape'],
    });
    expect(result.report).toMatchObject({ status: 'improved', selectedTrialId: `${plan.actions[0]!.id}:scale-2` });
    expect(scaleOf(result.ir, componentId)).toBeCloseTo(1.06);
    expect(result.report.trials.every((trial) => trial.batchReceipt?.unaffectedComponentsPreserved)).toBe(true);
    expect(source).toEqual(GALAXY_Z_FOLD8_EXTERIOR_IR);
  });

  it('returns the immutable source when every apparent improvement regresses a protected gate', async () => {
    const source = structuredClone(GALAXY_Z_FOLD8_EXTERIOR_IR);
    const componentId = source.components[0]!.id;
    const plan = planFor(componentId);
    const trials = createBoundedScaleRecoveryTrials(plan, { expansionFactors: [1.05] });
    const evaluate = async (ir: AssemblyIR): Promise<GeometryRecoveryEvaluation> => ({
      gateScores: {
        shape: 0.5 + (scaleOf(ir, componentId) - 1),
        topology: scaleOf(ir, componentId) === 1 ? 1 : 0.9,
      },
      blockingGateIds: ['shape'],
    });
    const result = await executeBoundedGeometryRecoverySearch(source, plan, trials, evaluate, {
      targetGateIds: ['shape'], maximumProtectedRegression: 0,
    });
    expect(result.report.status).toBe('unchanged');
    expect(result.report.trials[0]?.blockers.join(' ')).toContain('topology regressed');
    expect(result.ir).toBe(source);
  });

  it('isolates a candidate evaluation crash and still selects a later verified improvement', async () => {
    const source = structuredClone(GALAXY_Z_FOLD8_EXTERIOR_IR);
    const componentId = source.components[0]!.id;
    const plan = planFor(componentId);
    const trials = createBoundedScaleRecoveryTrials(plan, { expansionFactors: [1.02, 1.06] });
    const result = await executeBoundedGeometryRecoverySearch(source, plan, trials, async (ir) => {
      const scale = scaleOf(ir, componentId);
      if (scale > 1.01 && scale < 1.04) throw new Error('renderer allocation failed\nretryable detail');
      return { gateScores: { shape: 0.5 + (scale - 1), topology: 1 }, blockingGateIds: ['shape'] };
    }, { targetGateIds: ['shape'] });
    expect(result.report.status).toBe('improved');
    expect(result.report.selectedTrialId).toBe(`${plan.actions[0]!.id}:scale-2`);
    expect(result.report.trials[0]!.failure).toEqual({
      stage: 'evaluate', code: 'candidate-evaluation-failed',
      message: 'renderer allocation failed retryable detail',
    });
    expect(result.report.trials[1]!.accepted).toBe(true);
    expect(source).toEqual(GALAXY_Z_FOLD8_EXTERIOR_IR);
  });

  it('isolates an inapplicable candidate edit before evaluating the next trial', async () => {
    const source = structuredClone(GALAXY_Z_FOLD8_EXTERIOR_IR);
    const componentId = source.components[0]!.id;
    const plan = planFor(componentId);
    const valid = createBoundedScaleRecoveryTrials(plan, { expansionFactors: [1.06] })[0]!;
    let evaluations = 0;
    const result = await executeBoundedGeometryRecoverySearch(source, plan, [{
      id: 'invalid-local-profile', actionId: plan.actions[0]!.id,
      edits: [{ componentId, geometry: {
        operation: 'tube-point-deltas', deltas: [{ pointIndex: 0, deltaMm: [1, 0, 0] }],
      } }],
    }, valid], async (ir) => {
      evaluations += 1;
      return {
        gateScores: { shape: 0.5 + (scaleOf(ir, componentId) - 1), topology: 1 },
        blockingGateIds: ['shape'],
      };
    }, { targetGateIds: ['shape'] });
    expect(result.report.status).toBe('improved');
    expect(result.report.trials[0]!.failure?.code).toBe('candidate-apply-failed');
    expect(result.report.trials[0]!.batchReceipt).toBeUndefined();
    expect(result.report.trials[1]!.accepted).toBe(true);
    expect(evaluations).toBe(2); // immutable baseline plus only the applicable trial
  });

  it('records an unsafe candidate evaluation without aborting the bounded search', async () => {
    const source = structuredClone(GALAXY_Z_FOLD8_EXTERIOR_IR);
    const componentId = source.components[0]!.id;
    const plan = planFor(componentId);
    const trials = createBoundedScaleRecoveryTrials(plan, { expansionFactors: [1.02, 1.06] });
    const result = await executeBoundedGeometryRecoverySearch(source, plan, trials, async (ir) => {
      const scale = scaleOf(ir, componentId);
      if (scale > 1.01 && scale < 1.04) {
        return { gateScores: { shape: Number.NaN, topology: 1 }, blockingGateIds: ['shape'] };
      }
      return { gateScores: { shape: 0.5 + (scale - 1), topology: 1 }, blockingGateIds: ['shape'] };
    }, { targetGateIds: ['shape'] });
    expect(result.report.status).toBe('improved');
    expect(result.report.trials[0]!.failure?.code).toBe('candidate-evaluation-unsafe');
    expect(result.report.trials[1]!.accepted).toBe(true);
  });

  it('rejects a tradeoff that improves one target while regressing another target', async () => {
    const source = structuredClone(GALAXY_Z_FOLD8_EXTERIOR_IR);
    const componentId = source.components[0]!.id;
    const plan = planFor(componentId);
    const trials = createBoundedScaleRecoveryTrials(plan, { expansionFactors: [1.05] });
    const evaluate = async (ir: AssemblyIR): Promise<GeometryRecoveryEvaluation> => {
      const edited = scaleOf(ir, componentId) > 1;
      return {
        gateScores: { rms: edited ? 0.61 : 0.6, coverage: edited ? 0.599 : 0.6 },
        blockingGateIds: [],
      };
    };
    const result = await executeBoundedGeometryRecoverySearch(source, plan, trials, evaluate, {
      targetGateIds: ['rms', 'coverage'], maximumProtectedRegression: 0.005,
    });
    expect(result.report.status).toBe('unchanged');
    expect(result.report.trials[0]?.blockers.join(' ')).toContain('coverage target regressed');
    expect(result.ir).toBe(source);
  });

  it('rejects a trial that edits outside the localized recovery target set', async () => {
    const source = structuredClone(GALAXY_Z_FOLD8_EXTERIOR_IR);
    const plan = planFor(source.components[0]!.id);
    const evaluate = async (): Promise<GeometryRecoveryEvaluation> => ({
      gateScores: { shape: 0.5 }, blockingGateIds: ['shape'],
    });
    await expect(executeBoundedGeometryRecoverySearch(source, plan, [{
      id: 'widened-trial', actionId: plan.actions[0]!.id,
      edits: [{ componentId: source.components[1]!.id, scaleMultiplier: [1.05, 1.05, 1.05] }],
    }], evaluate, { targetGateIds: ['shape'] })).rejects.toThrow(/widens/);
  });

  it('maps evidence-directed translation back through the locked alignment yaw', () => {
    const plan = planFor(GALAXY_Z_FOLD8_EXTERIOR_IR.components[0]!.id);
    plan.actions[0]!.spatialConstraintIds = ['reference:x-low', 'reference:y-low'];
    const trials = createBoundedTranslationRecoveryTrials(plan, {
      alignedYawDegrees: 180, distancesMm: [10],
    });
    const delta = trials[0]!.edits[0]!.translateMm!;
    expect(delta[0]).toBeCloseTo(10 / Math.sqrt(2));
    expect(delta[1]).toBeCloseTo(-10 / Math.sqrt(2));
    expect(delta[2]).toBeCloseTo(0);
  });

  it('turns a calibrated semantic residual into independent bounded translation trials', () => {
    const source = structuredClone(GALAXY_Z_FOLD8_EXTERIOR_IR);
    const componentId = source.components[0]!.id;
    const plan = planFor(componentId);
    plan.actions[0]!.operation = 'relocate-or-reshape-extraneous-units';
    plan.actions[0]!.semanticFeatureId = 'camera-island';
    plan.actions[0]!.targetingMode = 'semantic-feature-overlap';
    const trials = createSemanticTranslationRecoveryTrials(source, plan, {
      schema: 'morphloom.silhouette-semantic-repair/0.1',
      actionableGroupIds: ['camera-island'], blockedGroupIds: [], limitation: 'fixture',
      hints: [{
        groupId: 'camera-island', recommendation: 'shrink-or-relocate',
        candidateOperation: 'relocate-or-reshape', confidence: 0.8,
        automatic3dTrialEligible: true, evidenceViewIds: ['front', 'right'], screenMatches: [],
        worldTranslationMm: [4, -2, 6], worldFitRmsNormalizedError: 0.001, blockers: [],
      }],
    }, { fractions: [0.5, 1] });
    expect(trials).toHaveLength(2);
    expect(trials.map((trial) => trial.edits[0]!.translateMm)).toEqual([
      [2, -1, 3], [4, -2, 6],
    ]);
    expect(trials.every((trial) => trial.actionId === plan.actions[0]!.id)).toBe(true);
  });

  it('creates no semantic translation trial for evidence-blocked hints', () => {
    const source = structuredClone(GALAXY_Z_FOLD8_EXTERIOR_IR);
    const plan = planFor(source.components[0]!.id);
    expect(createSemanticTranslationRecoveryTrials(source, plan, {
      schema: 'morphloom.silhouette-semantic-repair/0.1',
      actionableGroupIds: [], blockedGroupIds: ['unknown'], limitation: 'fixture',
      hints: [{
        groupId: 'unknown', recommendation: 'inspect', candidateOperation: 'inspect', confidence: 0,
        automatic3dTrialEligible: false, evidenceViewIds: [], screenMatches: [], blockers: ['blocked'],
      }],
    })).toEqual([]);
  });

  it('converts a ground-truth surface residual using an explicit unit contract', () => {
    const source = structuredClone(GALAXY_Z_FOLD8_EXTERIOR_IR);
    const componentId = source.components[0]!.id;
    const plan = planFor(componentId);
    plan.actions[0]!.operation = 'relocate-or-reshape-extraneous-units';
    plan.actions[0]!.targetingMode = 'surface-nearest-attribution';
    plan.actions[0]!.surfaceAttributionComponentId = componentId;
    plan.actions[0]!.surfaceAttributionEvidenceFingerprint = 'a'.repeat(16);
    const trials = createSurfaceAttributionTranslationRecoveryTrials(source, plan, {
      schema: 'morphloom.surface-component-attribution/0.1', evidenceFingerprint: 'a'.repeat(16), selectedYawDegrees: 0,
      distanceThreshold: 0.04, candidateUniformScale: 1,
      relocateOrReshapeComponentIds: [componentId], shrinkExcessComponentIds: [],
      expandOrAddDetailComponentIds: [], limitation: 'fixture',
      components: [{
        componentId, candidateSamples: 24, candidateCoverage: 0.5,
        candidateMeanDistance: 0.1, candidateP95Distance: 0.2,
        assignedReferenceSamples: 24, assignedReferenceCoverage: 0.5,
        assignedReferenceMeanDistance: 0.1, assignedReferenceP95Distance: 0.2,
        missingResponsibility: 0.5, outlierCandidateSamples: 12, missingReferenceSamples: 12,
        recommendation: 'relocate-or-reshape', suggestedTranslationCandidateUnits: [0.01, -0.02, 0.03],
      }],
    }, { candidateUnitsToIrUnits: 1_000, fractions: [0.25, 0.5], maximumTranslationIrUnits: 50 });
    expect(trials.map((trial) => trial.edits[0]!.translateMm)).toEqual([
      [2.5, -5, 7.5], [5, -10, 15],
    ]);
    plan.actions[0]!.surfaceAttributionEvidenceFingerprint = 'b'.repeat(16);
    expect(() => createSurfaceAttributionTranslationRecoveryTrials(source, plan, {
      schema: 'morphloom.surface-component-attribution/0.1', evidenceFingerprint: 'a'.repeat(16),
      selectedYawDegrees: 0, distanceThreshold: 0.04, candidateUniformScale: 1,
      relocateOrReshapeComponentIds: [componentId], shrinkExcessComponentIds: [],
      expandOrAddDetailComponentIds: [], limitation: 'fixture', components: [{
        componentId, candidateSamples: 24, candidateCoverage: 0.5,
        candidateMeanDistance: 0.1, candidateP95Distance: 0.2,
        assignedReferenceSamples: 24, assignedReferenceCoverage: 0.5,
        assignedReferenceMeanDistance: 0.1, assignedReferenceP95Distance: 0.2,
        missingResponsibility: 0.5, outlierCandidateSamples: 12, missingReferenceSamples: 12,
        recommendation: 'relocate-or-reshape', suggestedTranslationCandidateUnits: [0.01, -0.02, 0.03],
      }],
    }, { candidateUnitsToIrUnits: 1_000 })).toThrow(/unsafe target/);
  });

  it('turns attributed robust extent evidence into a capped one-axis scale trial', () => {
    const source = structuredClone(GALAXY_Z_FOLD8_EXTERIOR_IR);
    const componentId = source.components[0]!.id;
    source.components[0]!.rotation = [0, Math.PI / 2, 0];
    const plan = planFor(componentId);
    plan.actions[0]!.operation = 'relocate-or-reshape-extraneous-units';
    plan.actions[0]!.targetingMode = 'surface-nearest-attribution';
    plan.actions[0]!.surfaceAttributionComponentId = componentId;
    plan.actions[0]!.surfaceAttributionEvidenceFingerprint = 'c'.repeat(16);
    const trials = createSurfaceAttributionAxisScaleRecoveryTrials(source, plan, {
      schema: 'morphloom.surface-component-attribution/0.1', evidenceFingerprint: 'c'.repeat(16),
      selectedYawDegrees: 0, distanceThreshold: 0.04, candidateUniformScale: 1,
      relocateOrReshapeComponentIds: [componentId], shrinkExcessComponentIds: [],
      expandOrAddDetailComponentIds: [], limitation: 'fixture', components: [{
        componentId, candidateSamples: 24, candidateCoverage: 0.5,
        candidateMeanDistance: 0.1, candidateP95Distance: 0.2,
        assignedReferenceSamples: 24, assignedReferenceCoverage: 0.5,
        assignedReferenceMeanDistance: 0.1, assignedReferenceP95Distance: 0.2,
        missingResponsibility: 0.5, outlierCandidateSamples: 12, missingReferenceSamples: 12,
        recommendation: 'relocate-or-reshape', suggestedAlignedScaleAxis: 0,
        suggestedAlignedScaleFactor: 1.8,
      }],
    }, { fractions: [0.5, 1], maximumFactorDelta: 0.2 });
    expect(trials).toHaveLength(2);
    expect(trials[0]!.edits[0]!.scaleMultiplier).toEqual([1, 1, 1.1]);
    expect(trials[1]!.edits[0]!.scaleMultiplier).toEqual([1, 1, 1.2]);
    plan.actions[0]!.surfaceAttributionEvidenceFingerprint = 'd'.repeat(16);
    expect(() => createSurfaceAttributionAxisScaleRecoveryTrials(source, plan, {
      schema: 'morphloom.surface-component-attribution/0.1', evidenceFingerprint: 'c'.repeat(16),
      selectedYawDegrees: 0, distanceThreshold: 0.04, candidateUniformScale: 1,
      relocateOrReshapeComponentIds: [componentId], shrinkExcessComponentIds: [],
      expandOrAddDetailComponentIds: [], limitation: 'fixture', components: [],
    })).toThrow(/unsafe target/);
  });

  it('creates bounded independent control-point trials for an attributed bent tube', () => {
    const source = structuredClone(COOLING_ASSEMBLY_IR);
    const tube = source.components.find((component) => component.geometry.op === 'tube')!;
    tube.rotation = [0, Math.PI / 2, 0];
    const plan = planFor(tube.id);
    plan.actions[0]!.operation = 'relocate-or-reshape-extraneous-units';
    plan.actions[0]!.targetingMode = 'surface-nearest-attribution';
    plan.actions[0]!.surfaceAttributionComponentId = tube.id;
    plan.actions[0]!.surfaceAttributionEvidenceFingerprint = 'e'.repeat(16);
    const trials = createSurfaceAttributionTubeControlRecoveryTrials(source, plan, {
      schema: 'morphloom.surface-component-attribution/0.1', evidenceFingerprint: 'e'.repeat(16),
      selectedYawDegrees: 0, distanceThreshold: 0.04, candidateUniformScale: 1,
      relocateOrReshapeComponentIds: [tube.id], shrinkExcessComponentIds: [],
      expandOrAddDetailComponentIds: [], limitation: 'fixture', components: [{
        componentId: tube.id, candidateSamples: 24, candidateCoverage: 0.5,
        candidateMeanDistance: 0.1, candidateP95Distance: 0.2,
        assignedReferenceSamples: 24, assignedReferenceCoverage: 0.5,
        assignedReferenceMeanDistance: 0.1, assignedReferenceP95Distance: 0.2,
        missingResponsibility: 0.5, outlierCandidateSamples: 12, missingReferenceSamples: 12,
        recommendation: 'relocate-or-reshape', suggestedTranslationCandidateUnits: [0.01, 0.02, 0.03],
      }],
    }, {
      candidateUnitsToIrUnits: 1_000, fractions: [0.5],
      maximumTranslationIrUnits: 50, maximumControlPoints: 4,
    });
    expect(trials.length).toBeGreaterThanOrEqual(2);
    expect(trials.length).toBeLessThanOrEqual(4);
    expect(new Set(trials.map((trial) => trial.edits[0]!.geometry?.deltas[0]!.pointIndex)).size)
      .toBe(trials.length);
    expect(trials.every((trial) => trial.edits[0]!.geometry?.operation === 'tube-point-deltas')).toBe(true);
  });

  it('uses the control-local surface residual instead of the component centroid residual', () => {
    const source = structuredClone(COOLING_ASSEMBLY_IR);
    const tube = source.components.find((component) => component.geometry.op === 'tube')!;
    if (tube.geometry.op !== 'tube') throw new Error('fixture tube is missing');
    tube.rotation = [0, Math.PI / 2, 0];
    const selectedControl = Math.min(1, tube.geometry.points.length - 1);
    const plan = planFor(tube.id);
    plan.actions[0]!.operation = 'relocate-or-reshape-extraneous-units';
    plan.actions[0]!.targetingMode = 'surface-nearest-attribution';
    plan.actions[0]!.surfaceAttributionComponentId = tube.id;
    plan.actions[0]!.surfaceAttributionEvidenceFingerprint = 'f'.repeat(16);
    const trials = createSurfaceAttributionTubeControlRecoveryTrials(source, plan, {
      schema: 'morphloom.surface-component-attribution/0.1', evidenceFingerprint: 'f'.repeat(16),
      selectedYawDegrees: 0, distanceThreshold: 0.04, candidateUniformScale: 1,
      relocateOrReshapeComponentIds: [tube.id], shrinkExcessComponentIds: [],
      expandOrAddDetailComponentIds: [], limitation: 'fixture', components: [{
        componentId: tube.id, candidateSamples: 24, candidateCoverage: 0.5,
        candidateMeanDistance: 0.1, candidateP95Distance: 0.2,
        assignedReferenceSamples: 24, assignedReferenceCoverage: 0.5,
        assignedReferenceMeanDistance: 0.1, assignedReferenceP95Distance: 0.2,
        missingResponsibility: 0.5, outlierCandidateSamples: 12, missingReferenceSamples: 12,
        recommendation: 'relocate-or-reshape', suggestedTranslationCandidateUnits: [0, 0, -0.04],
        controlPointTranslations: [{
          controlIndex: selectedControl, outlierCandidateSamples: 6, missingReferenceSamples: 7,
          confidence: 0.5, suggestedTranslationCandidateUnits: [0.01, 0, 0],
        }],
      }],
    }, { candidateUnitsToIrUnits: 1_000, fractions: [0.5], maximumTranslationIrUnits: 50 });
    expect(trials).toHaveLength(1);
    const geometry = trials[0]!.edits[0]!.geometry;
    expect(geometry?.operation).toBe('tube-point-deltas');
    if (geometry?.operation !== 'tube-point-deltas') throw new Error('expected tube control edit');
    expect(geometry.deltas[0]!.pointIndex).toBe(selectedControl);
    expect(geometry.deltas[0]!.deltaMm[0]).toBeCloseTo(0);
    expect(geometry.deltas[0]!.deltaMm[2]).toBeCloseTo(5);
  });

  it('moves only the evidence-facing extreme control point for an open tube', () => {
    const source = structuredClone(COOLING_ASSEMBLY_IR);
    const tube = source.components.find((component) => component.geometry.op === 'tube')!;
    if (tube.geometry.op !== 'tube') throw new Error('fixture tube is missing');
    const plan = planFor(tube.id);
    plan.actions[0]!.spatialConstraintIds = ['reference:x-high'];
    const trials = createBoundedShapeRecoveryTrials(source, plan, {
      alignedYawDegrees: 0, distancesMm: [5],
    });
    const edit = trials[0]!.edits[0]!;
    expect(edit.geometry?.operation).toBe('tube-point-deltas');
    const expectedIndex = tube.geometry.points.reduce((winner, point, index, points) => (
      point[0] > points[winner]![0] ? index : winner
    ), 0);
    expect(edit.geometry?.deltas).toEqual([{ pointIndex: expectedIndex, deltaMm: [5, 0, 0] }]);
  });

  it('maps an evidence direction into a rotated tube local control-point frame', () => {
    const source = structuredClone(COOLING_ASSEMBLY_IR);
    const tube = source.components.find((component) => component.geometry.op === 'tube')!;
    tube.rotation = [0, Math.PI / 2, 0];
    if (tube.geometry.op !== 'tube') throw new Error('fixture tube is missing');
    const plan = planFor(tube.id);
    plan.actions[0]!.spatialConstraintIds = ['reference:x-high'];
    const edit = createBoundedShapeRecoveryTrials(source, plan, {
      alignedYawDegrees: 0, distancesMm: [5],
    })[0]!.edits[0]!;
    const expectedIndex = tube.geometry.points.reduce((winner, point, index, points) => (
      point[2] > points[winner]![2] ? index : winner
    ), 0);
    expect(edit.geometry?.operation).toBe('tube-point-deltas');
    if (edit.geometry?.operation !== 'tube-point-deltas') throw new Error('expected a tube control edit');
    expect(edit.geometry?.deltas[0]!.pointIndex).toBe(expectedIndex);
    expect(edit.geometry?.deltas[0]!.deltaMm[0]).toBeCloseTo(0);
    expect(edit.geometry?.deltas[0]!.deltaMm[2]).toBeCloseTo(5);
  });

  it('extends only the evidence-facing blade tip section instead of translating the whole knife', () => {
    const source = createOrnateKnifeIR(DEFAULT_KNIFE_SPEC);
    const blade = source.components.find((component) => component.id === 'blade_core')!;
    const plan = planFor(blade.id);
    plan.actions[0]!.spatialConstraintIds = ['reference:y-high'];
    const trials = createBoundedShapeRecoveryTrials(source, plan, {
      alignedYawDegrees: 0, distancesMm: [4],
    });
    expect(trials[0]!.edits[0]).toEqual({
      componentId: 'blade_core',
      geometry: { operation: 'blade-section-deltas', deltas: [{ pointIndex: 9, deltaMm: [4, 0] }] },
    });
  });

  it('can isolate multi-target recovery proposals into one-component trials', () => {
    const source = structuredClone(GALAXY_Z_FOLD8_EXTERIOR_IR);
    const componentIds = source.components.slice(0, 2).map((component) => component.id);
    const plan = planFor(componentIds[0]!);
    plan.actions[0]!.targetComponentIds = componentIds;
    plan.actions[0]!.candidateComponentCount = componentIds.length;
    const trials = createBoundedScaleRecoveryTrials(plan, {
      expansionFactors: [1.02, 1.04], grouping: 'per-component',
    });
    expect(trials).toHaveLength(4);
    expect(trials.map((trial) => trial.id)).toEqual([
      `${plan.actions[0]!.id}:c1:scale-1`,
      `${plan.actions[0]!.id}:c2:scale-1`,
      `${plan.actions[0]!.id}:c1:scale-2`,
      `${plan.actions[0]!.id}:c2:scale-2`,
    ]);
    expect(trials.every((trial) => trial.edits.length === 1)).toBe(true);
    expect(new Set(trials.map((trial) => trial.edits[0]!.componentId))).toEqual(new Set(componentIds));
  });

  it('compresses a semantic group around a shared axis pivot without scaling rigid parts', () => {
    const source = structuredClone(GALAXY_Z_FOLD8_EXTERIOR_IR);
    const targets = source.components.slice(0, 2);
    targets[0]!.position = [0, 0, -20];
    targets[1]!.position = [0, 0, 20];
    const plan = planFor(targets[0]!.id);
    plan.actions[0]!.targetComponentIds = targets.map((component) => component.id);
    plan.actions[0]!.candidateComponentCount = 2;
    const trials = createBoundedGroupAxisSpacingTrials(source, plan, {
      axis: 2, factors: [0.5], pivotMm: 0,
    });
    expect(trials).toHaveLength(1);
    expect(trials[0]!.edits).toEqual([
      { componentId: targets[0]!.id, translateMm: [0, 0, 10] },
      { componentId: targets[1]!.id, translateMm: [0, 0, -10] },
    ]);
    expect(trials[0]!.edits.every((edit) => edit.scaleMultiplier === undefined)).toBe(true);
  });

  it('moves tube control points around the same group-spacing pivot', () => {
    const source = structuredClone(COOLING_ASSEMBLY_IR);
    const tube = source.components.find((component) => component.geometry.op === 'tube')!;
    const plan = planFor(tube.id);
    const trials = createBoundedGroupAxisSpacingTrials(source, plan, {
      axis: 0, factors: [0.5], pivotMm: 0,
    });
    expect(trials[0]!.edits[0]!.geometry?.operation).toBe('tube-point-deltas');
    if (tube.geometry.op !== 'tube') throw new Error('fixture tube is missing');
    expect(trials[0]!.edits[0]!.geometry?.deltas[0]!.deltaMm[0])
      .toBeCloseTo(-tube.geometry.points[0]![0] * 0.5);
  });

  it('fails closed instead of partially spacing an unsupported long tube group', () => {
    const source = structuredClone(COOLING_ASSEMBLY_IR);
    const tube = source.components.find((component) => component.geometry.op === 'tube')!;
    if (tube.geometry.op !== 'tube') throw new Error('fixture tube is missing');
    tube.geometry.points = Array.from({ length: 17 }, (_, index) => [index, 0, 0]);
    const plan = planFor(tube.id);
    expect(() => createBoundedGroupAxisSpacingTrials(source, plan, {
      axis: 0, factors: [0.5], pivotMm: 0,
    })).toThrow(/bounded edit limit/);
  });

  it('replans from each accepted checkpoint for bounded iterative improvement', async () => {
    const source = structuredClone(GALAXY_Z_FOLD8_EXTERIOR_IR);
    const componentId = source.components[0]!.id;
    const evaluate = async (ir: AssemblyIR): Promise<GeometryRecoveryEvaluation> => ({
      gateScores: { shape: Math.min(1, 0.5 + scaleOf(ir, componentId) - 1), topology: 1 },
      blockingGateIds: ['shape'],
    });
    const result = await executeIterativeGeometryRecoverySearch(
      source,
      (ir) => scaleRoundProposal(ir, componentId),
      evaluate,
      { targetGateIds: ['shape'], maximumRounds: 2, maximumTotalTrials: 2 },
    );
    expect(result.report).toMatchObject({ status: 'improved', totalTrials: 2 });
    expect(result.report.rounds).toHaveLength(2);
    expect(result.report.rounds.every((round) => round.accepted)).toBe(true);
    expect(result.report.selectedTrialIds).toHaveLength(2);
    expect(scaleOf(result.ir, componentId)).toBeCloseTo(1.1025);
  });

  it('rejects a stale iterative proposal before applying its edits', async () => {
    const source = structuredClone(GALAXY_Z_FOLD8_EXTERIOR_IR);
    const componentId = source.components[0]!.id;
    await expect(executeIterativeGeometryRecoverySearch(source, async (ir) => ({
      ...await scaleRoundProposal(ir, componentId), sourceIrFingerprint: '0'.repeat(64),
    }), async () => ({ gateScores: { shape: 0.5 }, blockingGateIds: ['shape'] }), {
      targetGateIds: ['shape'], maximumRounds: 2,
    })).rejects.toThrow(/stale round proposal/);
    expect(source).toEqual(GALAXY_Z_FOLD8_EXTERIOR_IR);
  });

  it('stops cumulative protected-gate drift even when each round is locally acceptable', async () => {
    const source = structuredClone(GALAXY_Z_FOLD8_EXTERIOR_IR);
    const componentId = source.components[0]!.id;
    const evaluate = async (ir: AssemblyIR): Promise<GeometryRecoveryEvaluation> => {
      const scale = scaleOf(ir, componentId);
      return {
        gateScores: {
          shape: Math.min(1, 0.5 + scale - 1),
          topology: 1 - Math.max(0, scale - 1) * 0.003,
        },
        blockingGateIds: ['shape'],
      };
    };
    const result = await executeIterativeGeometryRecoverySearch(
      source,
      (ir) => scaleRoundProposal(ir, componentId),
      evaluate,
      {
        targetGateIds: ['shape'], maximumRounds: 3, maximumTotalTrials: 3,
        maximumProtectedRegression: 0.0002, maximumCumulativeProtectedRegression: 0.0002,
      },
    );
    expect(result.report.rounds).toHaveLength(2);
    expect(result.report.rounds.map((round) => round.accepted)).toEqual([true, false]);
    expect(result.report.rounds[1]!.blockers.join(' ')).toContain('cumulative checkpoint');
    expect(scaleOf(result.ir, componentId)).toBeCloseTo(1.05);
  });
});
