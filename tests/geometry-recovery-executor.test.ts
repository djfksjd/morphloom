import { describe, expect, it } from 'vitest';
import type { AssemblyIR } from '../src/engine/assembly-ir';
import {
  createBoundedAxisScaleRecoveryTrials,
  createBoundedGroupAxisSpacingTrials,
  createBoundedScaleRecoveryTrials,
  createBoundedShapeRecoveryTrials,
  createBoundedTranslationRecoveryTrials,
  executeBoundedGeometryRecoverySearch,
  type GeometryRecoveryEvaluation,
} from '../src/engine/geometry-recovery-executor';
import type { GeometryRecoveryPlan } from '../src/engine/geometry-recovery-plan';
import { GALAXY_Z_FOLD8_EXTERIOR_IR } from '../src/engine/galaxy-fold8-exterior';
import { COOLING_ASSEMBLY_IR } from '../src/engine/cooling-assembly';

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
});
