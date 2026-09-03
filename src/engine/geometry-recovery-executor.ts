import type { AssemblyIR } from './assembly-ir';
import {
  applyAssemblyComponentBatchPatch,
  fingerprintAssemblyIR,
  type AssemblyBatchEditReceipt,
  type AssemblyComponentPatch,
} from './assembly-edit';
import type { GeometryRecoveryAction, GeometryRecoveryPlan } from './geometry-recovery-plan';
import type { SilhouetteSemanticRepairReport } from './silhouette-semantic-repair';
import type { SurfaceComponentAttributionReport } from './surface-component-attribution';

type RecoveryEdit = Omit<AssemblyComponentPatch, 'schema' | 'operationId' | 'expectedInputFingerprint'>;
type Vector3 = [number, number, number];

export interface GeometryRecoveryTrial {
  id: string;
  actionId: string;
  edits: RecoveryEdit[];
}

export interface GeometryRecoveryEvaluation {
  gateScores: Record<string, number>;
  blockingGateIds: string[];
}

export interface GeometryRecoveryTrialReceipt {
  id: string;
  actionId: string;
  inputFingerprint: string;
  outputFingerprint?: string;
  batchReceipt?: AssemblyBatchEditReceipt;
  evaluation?: GeometryRecoveryEvaluation;
  accepted: boolean;
  blockers: string[];
}

export interface GeometryRecoveryExecutionReport {
  schema: 'morphloom.geometry-recovery-execution/0.1';
  status: 'improved' | 'unchanged' | 'blocked';
  inputFingerprint: string;
  outputFingerprint: string;
  selectedTrialId?: string;
  baseline: GeometryRecoveryEvaluation;
  selected?: GeometryRecoveryEvaluation;
  trials: GeometryRecoveryTrialReceipt[];
  blockers: string[];
}

const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/;
const MAX_TRIALS = 64;
const MAX_GATES = 32;

type RecoveryTrialGrouping = 'batch' | 'per-component';

function validateGrouping(grouping: RecoveryTrialGrouping | undefined): RecoveryTrialGrouping {
  const resolved = grouping ?? 'batch';
  if (resolved !== 'batch' && resolved !== 'per-component') {
    throw new Error('Geometry recovery trial grouping is unsafe.');
  }
  return resolved;
}

function groupRecoveryEdits(
  edits: RecoveryEdit[],
  grouping: RecoveryTrialGrouping,
): RecoveryEdit[][] {
  return grouping === 'batch' ? [edits] : edits.map((edit) => [edit]);
}

function safeEvaluation(value: GeometryRecoveryEvaluation): boolean {
  const entries = Object.entries(value?.gateScores ?? {});
  const blockerIds = value?.blockingGateIds;
  return entries.length > 0 && entries.length <= MAX_GATES
    && entries.every(([id, score]) => SAFE_ID.test(id) && Number.isFinite(score) && score >= 0 && score <= 1)
    && Array.isArray(blockerIds) && blockerIds.length <= MAX_GATES
    && blockerIds.every((id) => SAFE_ID.test(id))
    && new Set(blockerIds).size === blockerIds.length
    && blockerIds.every((id) => Object.hasOwn(value.gateScores, id));
}

function sameGateSet(left: GeometryRecoveryEvaluation, right: GeometryRecoveryEvaluation): boolean {
  const leftIds = Object.keys(left.gateScores).sort();
  const rightIds = Object.keys(right.gateScores).sort();
  return leftIds.length === rightIds.length && leftIds.every((id, index) => id === rightIds[index]);
}

function scoreTrial(
  baseline: GeometryRecoveryEvaluation,
  candidate: GeometryRecoveryEvaluation,
  targetGateIds: string[],
  minimumImprovement: number,
  maximumProtectedRegression: number,
  maximumTargetRegression: number,
): { accepted: boolean; objective: number; mean: number; blockers: string[] } {
  const blockers: string[] = [];
  if (!sameGateSet(baseline, candidate)) blockers.push('candidate changed the declared verification gate set');
  const newBlockers = candidate.blockingGateIds.filter((id) => !baseline.blockingGateIds.includes(id));
  if (newBlockers.length > 0) blockers.push(`candidate introduced blockers: ${newBlockers.join(', ')}`);
  for (const [id, baselineScore] of Object.entries(baseline.gateScores)) {
    const candidateScore = candidate.gateScores[id];
    if (candidateScore === undefined) continue;
    if (candidateScore < baselineScore - maximumProtectedRegression) {
      blockers.push(`${id} regressed by ${(baselineScore - candidateScore).toFixed(4)}`);
    }
  }
  const improvements = targetGateIds.map((id) => candidate.gateScores[id]! - baseline.gateScores[id]!);
  for (const [index, improvement] of improvements.entries()) {
    if (improvement < -maximumTargetRegression) {
      blockers.push(`${targetGateIds[index]} target regressed by ${(-improvement).toFixed(4)}`);
    }
  }
  const objective = Math.min(...targetGateIds.map((id) => candidate.gateScores[id]!));
  const mean = Object.values(candidate.gateScores).reduce((sum, score) => sum + score, 0)
    / Object.keys(candidate.gateScores).length;
  if (!improvements.some((improvement) => improvement >= minimumImprovement)) {
    blockers.push(`no target gate improved by at least ${minimumImprovement.toFixed(4)}`);
  }
  return { accepted: blockers.length === 0, objective, mean, blockers };
}

/**
 * Creates conservative, reversible scale trials from localized recovery
 * actions. These are proposals only: executeBoundedGeometryRecoverySearch
 * accepts one only when target gates improve and protected gates do not.
 */
export function createBoundedScaleRecoveryTrials(
  plan: GeometryRecoveryPlan,
  options: {
    expansionFactors?: number[];
    reductionFactors?: number[];
    grouping?: RecoveryTrialGrouping;
  } = {},
): GeometryRecoveryTrial[] {
  const expansionFactors = options.expansionFactors ?? [1.025, 1.05, 1.075];
  const reductionFactors = options.reductionFactors ?? [0.975, 0.95, 0.925];
  const grouping = validateGrouping(options.grouping);
  const validateFactors = (values: number[], minimum: number, maximum: number): boolean => (
    Array.isArray(values) && values.length >= 1 && values.length <= 8
    && values.every((value) => Number.isFinite(value) && value >= minimum && value <= maximum)
  );
  if (plan?.schema !== 'morphloom.geometry-recovery-plan/0.1'
    || !validateFactors(expansionFactors, 1.001, 1.25)
    || !validateFactors(reductionFactors, 0.75, 0.999)) {
    throw new Error('Geometry recovery scale trial configuration is unsafe.');
  }
  return plan.actions.flatMap((action) => {
    if (action.operation === 'request-region-evidence' || action.targetComponentIds.length < 1) return [];
    const factors = action.operation === 'expand-or-reshape-existing-units'
      ? expansionFactors : reductionFactors;
    return factors.flatMap((factor, factorIndex) => groupRecoveryEdits(
      action.targetComponentIds.map((componentId) => ({
        componentId,
        scaleMultiplier: [factor, factor, factor],
      })),
      grouping,
    ).map((edits, groupIndex) => ({
      id: grouping === 'batch'
        ? `${action.id}:scale-${factorIndex + 1}`
        : `${action.id}:c${groupIndex + 1}:scale-${factorIndex + 1}`,
      actionId: action.id,
      edits,
    })));
  });
}

/**
 * Converts calibrated semantic screen-space repair hints into reversible
 * metric translation trials. Fractions are evaluated independently from the
 * immutable source; this function never applies or accepts an edit itself.
 */
export function createSemanticTranslationRecoveryTrials(
  ir: AssemblyIR,
  plan: GeometryRecoveryPlan,
  repair: SilhouetteSemanticRepairReport,
  options: { fractions?: number[] } = {},
): GeometryRecoveryTrial[] {
  const fractions = options.fractions ?? [0.5, 0.75, 1];
  if (ir?.schema !== 'morphloom.assembly/0.1'
    || plan?.schema !== 'morphloom.geometry-recovery-plan/0.1'
    || repair?.schema !== 'morphloom.silhouette-semantic-repair/0.1'
    || !Array.isArray(fractions) || fractions.length < 1 || fractions.length > 8
    || fractions.some((fraction) => !Number.isFinite(fraction) || fraction < 0.05 || fraction > 1)) {
    throw new Error('Semantic translation recovery trial configuration is unsafe.');
  }
  const componentIds = new Set(ir.components.map((component) => component.id));
  const actionableHints = repair.hints.filter((hint) => hint.automatic3dTrialEligible);
  if (new Set(repair.actionableGroupIds).size !== repair.actionableGroupIds.length
    || actionableHints.length !== repair.actionableGroupIds.length
    || actionableHints.some((hint) => !repair.actionableGroupIds.includes(hint.groupId)
      || !hint.worldTranslationMm || hint.worldTranslationMm.length !== 3
      || hint.worldTranslationMm.some((value) => !Number.isFinite(value) || Math.abs(value) > 100_000)
      || Math.hypot(...hint.worldTranslationMm) <= 1e-9)) {
    throw new Error('Semantic translation recovery hints are inconsistent or unsafe.');
  }
  return actionableHints.flatMap((hint) => {
    const actions = plan.actions.filter((action) => action.semanticFeatureId === hint.groupId
      && action.operation === 'relocate-or-reshape-extraneous-units');
    if (actions.length !== 1) {
      throw new Error(`Semantic translation group requires exactly one recovery action: ${hint.groupId}`);
    }
    const action = actions[0]!;
    if (action.targetComponentIds.length < 1 || action.targetComponentIds.length > 64
      || new Set(action.targetComponentIds).size !== action.targetComponentIds.length
      || action.targetComponentIds.some((id) => !componentIds.has(id))) {
      throw new Error(`Semantic translation recovery target set is unsafe: ${hint.groupId}`);
    }
    return fractions.map((fraction, index) => ({
      id: `${action.id}:semantic-translate-${index + 1}`,
      actionId: action.id,
      edits: action.targetComponentIds.map((componentId) => ({
        componentId,
        translateMm: hint.worldTranslationMm!.map((value) => value * fraction) as Vector3,
      })),
    }));
  });
}

/**
 * Creates metric IR translation trials from a merged ground-truth surface
 * attribution. The caller declares the candidate-unit conversion explicitly;
 * Morphloom never assumes metres, millimetres, or scene scale from coordinates.
 */
export function createSurfaceAttributionTranslationRecoveryTrials(
  ir: AssemblyIR,
  plan: GeometryRecoveryPlan,
  attribution: SurfaceComponentAttributionReport,
  options: {
    candidateUnitsToIrUnits: number;
    fractions?: number[];
    maximumTranslationIrUnits?: number;
  },
): GeometryRecoveryTrial[] {
  const fractions = options.fractions ?? [0.25, 0.5, 0.75];
  const maximumTranslationIrUnits = options.maximumTranslationIrUnits ?? 100;
  if (ir?.schema !== 'morphloom.assembly/0.1'
    || plan?.schema !== 'morphloom.geometry-recovery-plan/0.1'
    || attribution?.schema !== 'morphloom.surface-component-attribution/0.1'
    || !Number.isFinite(options.candidateUnitsToIrUnits) || options.candidateUnitsToIrUnits <= 0
    || options.candidateUnitsToIrUnits > 1_000_000
    || !Array.isArray(fractions) || fractions.length < 1 || fractions.length > 8
    || fractions.some((fraction) => !Number.isFinite(fraction) || fraction < 0.05 || fraction > 1)
    || !Number.isFinite(maximumTranslationIrUnits) || maximumTranslationIrUnits <= 0
    || maximumTranslationIrUnits > 100_000) {
    throw new Error('Surface attribution translation trial configuration is unsafe.');
  }
  const componentIds = new Set(ir.components.map((component) => component.id));
  const attributedById = new Map(attribution.components.map((component) => [component.componentId, component]));
  return plan.actions.filter((action) => action.targetingMode === 'surface-nearest-attribution').flatMap((action) => {
    const componentId = action.surfaceAttributionComponentId;
    if (!componentId || action.targetComponentIds.length !== 1 || action.targetComponentIds[0] !== componentId
      || !componentIds.has(componentId)) {
      throw new Error(`Surface attribution recovery action has an unsafe target: ${action.id}`);
    }
    const attributed = attributedById.get(componentId);
    if (!attributed || attributed.recommendation !== 'relocate-or-reshape'
      || !attributed.suggestedTranslationCandidateUnits) {
      throw new Error(`Surface attribution recovery action lacks relocation evidence: ${action.id}`);
    }
    const fullTranslation = attributed.suggestedTranslationCandidateUnits.map((value) => (
      value * options.candidateUnitsToIrUnits
    )) as Vector3;
    if (fullTranslation.some((value) => !Number.isFinite(value))
      || Math.hypot(...fullTranslation) <= 1e-9
      || Math.hypot(...fullTranslation) > maximumTranslationIrUnits) {
      throw new Error(`Surface attribution recovery vector exceeds the bounded edit limit: ${action.id}`);
    }
    return fractions.map((fraction, index) => ({
      id: `${action.id}:surface-translate-${index + 1}`,
      actionId: action.id,
      edits: [{
        componentId,
        translateMm: fullTranslation.map((value) => value * fraction) as Vector3,
      }],
    }));
  });
}

function alignedAxisVector(axis: 0 | 1 | 2, alignedYawDegrees: number): [number, number, number] {
  if (axis === 1) return [0, 1, 0];
  const radians = alignedYawDegrees * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return axis === 0 ? [cosine, 0, -sine] : [sine, 0, cosine];
}

function localAxisWeights(
  worldAxis: [number, number, number],
  rotation: [number, number, number] = [0, 0, 0],
): [number, number, number] {
  const [x, y, z] = rotation;
  const a = Math.cos(x); const b = Math.sin(x);
  const c = Math.cos(y); const d = Math.sin(y);
  const e = Math.cos(z); const f = Math.sin(z);
  // Three.js Euler XYZ object rotation. Multiplication by the transpose maps
  // the evidence/world direction into the component's local scale basis.
  const matrix = [
    c * e, -c * f, d,
    a * f + b * e * d, a * e - b * f * d, -b * c,
    b * f - a * e * d, b * e + a * f * d, a * c,
  ];
  return [
    Math.abs(matrix[0]! * worldAxis[0] + matrix[3]! * worldAxis[1] + matrix[6]! * worldAxis[2]),
    Math.abs(matrix[1]! * worldAxis[0] + matrix[4]! * worldAxis[1] + matrix[7]! * worldAxis[2]),
    Math.abs(matrix[2]! * worldAxis[0] + matrix[5]! * worldAxis[1] + matrix[8]! * worldAxis[2]),
  ];
}

/**
 * Creates anisotropic scale trials from failed audit axes. Unlike uniform
 * scaling, these proposals preserve unaffected dimensions and are therefore
 * suitable for profile failures such as an over-deep enclosure or a blade
 * whose edge is too thick. The audit axes are transformed back through the
 * locked yaw before the local IR scale multiplier is emitted.
 */
export function createBoundedAxisScaleRecoveryTrials(
  plan: GeometryRecoveryPlan,
  options: {
    alignedYawDegrees: number;
    sourceIr?: AssemblyIR;
    expansionFactors?: number[];
    reductionFactors?: number[];
    includeCounterfactualDirection?: boolean;
    grouping?: RecoveryTrialGrouping;
  },
): GeometryRecoveryTrial[] {
  const expansionFactors = options.expansionFactors ?? [1.05, 1.1, 1.15];
  const reductionFactors = options.reductionFactors ?? [0.95, 0.9, 0.85];
  const grouping = validateGrouping(options.grouping);
  const validateFactors = (values: number[], minimum: number, maximum: number): boolean => (
    Array.isArray(values) && values.length >= 1 && values.length <= 8
    && values.every((value) => Number.isFinite(value) && value >= minimum && value <= maximum)
  );
  if (plan?.schema !== 'morphloom.geometry-recovery-plan/0.1'
    || (options.sourceIr !== undefined && options.sourceIr.schema !== 'morphloom.assembly/0.1')
    || !Number.isFinite(options.alignedYawDegrees) || Math.abs(options.alignedYawDegrees) > 1_000_000
    || (options.includeCounterfactualDirection !== undefined
      && typeof options.includeCounterfactualDirection !== 'boolean')
    || !validateFactors(expansionFactors, 1.001, 1.5)
    || !validateFactors(reductionFactors, 0.5, 0.999)) {
    throw new Error('Geometry recovery axis-scale trial configuration is unsafe.');
  }
  return plan.actions.flatMap((action) => {
    if (action.operation === 'request-region-evidence' || action.targetComponentIds.length < 1) return [];
    const directions = action.spatialConstraintIds
      .map(bandDirection)
      .filter((value): value is NonNullable<typeof value> => value !== undefined);
    if (directions.length < 1) return [];
    if (directions.some((direction) => direction.side !== directions[0]!.side)) {
      throw new Error(`Geometry recovery action mixes reference and candidate bands: ${action.id}`);
    }
    const worldAxes = directions.map((direction) => alignedAxisVector(
      direction.axis, options.alignedYawDegrees,
    ));
    const expectedFactors = action.operation === 'expand-or-reshape-existing-units'
      ? expansionFactors : reductionFactors;
    const counterfactualFactors = action.operation === 'expand-or-reshape-existing-units'
      ? reductionFactors : expansionFactors;
    const factorSets = [
      { factors: expectedFactors, label: 'axis-scale' },
      ...(options.includeCounterfactualDirection
        ? [{ factors: counterfactualFactors, label: 'counter-axis-scale' }] : []),
    ];
    return factorSets.flatMap(({ factors, label }) => factors.flatMap((factor, factorIndex) => {
      return groupRecoveryEdits(action.targetComponentIds.map((componentId) => {
        const component = options.sourceIr?.components.find((candidate) => candidate.id === componentId);
        if (options.sourceIr && !component) {
          throw new Error(`Geometry recovery axis-scale target does not exist: ${componentId}`);
        }
        const weights = worldAxes.reduce<[number, number, number]>((maximums, worldAxis) => {
          const axisWeights = localAxisWeights(worldAxis, component?.rotation);
          return maximums.map((value, axis) => Math.max(value, axisWeights[axis]!)) as [number, number, number];
        }, [0, 0, 0]);
        return {
          componentId,
          scaleMultiplier: weights.map((weight) => 1 + (factor - 1) * weight) as [number, number, number],
        };
      }), grouping).map((edits, groupIndex) => ({
        id: grouping === 'batch'
          ? `${action.id}:${label}-${factorIndex + 1}`
          : `${action.id}:c${groupIndex + 1}:${label}-${factorIndex + 1}`,
        actionId: action.id,
        edits,
      }));
    }));
  });
}

function bandDirection(id: string): { axis: 0 | 1 | 2; direction: -1 | 0 | 1; side: 'reference' | 'candidate' } | undefined {
  const match = /^(reference|candidate):([xyz])-(low|middle|high)$/.exec(id);
  if (!match) return undefined;
  const side = match[1] as 'reference' | 'candidate';
  const axis = ({ x: 0, y: 1, z: 2 } as const)[match[2] as 'x' | 'y' | 'z'];
  const band = match[3] as 'low' | 'middle' | 'high';
  if (band === 'middle') return { axis, direction: 0, side };
  const outward = band === 'low' ? -1 : 1;
  return { axis, direction: (side === 'reference' ? outward : -outward) as -1 | 1, side };
}

function actionWorldDirection(
  action: GeometryRecoveryAction,
  alignedYawDegrees: number,
): { direction: [number, number, number]; side: 'reference' | 'candidate' } | undefined {
  const directions = action.spatialConstraintIds.map(bandDirection).filter((value) => value !== undefined);
  if (directions.length < 1) return undefined;
  if (directions.some((direction) => direction.side !== directions[0]!.side)) {
    throw new Error(`Geometry recovery action mixes reference and candidate bands: ${action.id}`);
  }
  const aligned = directions.reduce<[number, number, number]>((sum, direction) => {
    sum[direction.axis] += direction.direction;
    return sum;
  }, [0, 0, 0]);
  const length = Math.hypot(...aligned);
  if (length <= 1e-12) return undefined;
  const normalized = aligned.map((value) => value / length) as [number, number, number];
  const radians = alignedYawDegrees * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return {
    direction: [
      normalized[0] * cosine + normalized[2] * sine,
      normalized[1],
      -normalized[0] * sine + normalized[2] * cosine,
    ],
    side: directions[0]!.side,
  };
}

/**
 * Builds evidence-directed translation trials. Directions are derived from
 * missing-reference bands (move outward) or excess-candidate bands (move back
 * toward the center), then transformed from aligned audit space into the
 * assembly's world axes using the locked yaw receipt.
 */
export function createBoundedTranslationRecoveryTrials(
  plan: GeometryRecoveryPlan,
  options: {
    alignedYawDegrees: number;
    distancesMm?: number[];
    grouping?: RecoveryTrialGrouping;
  },
): GeometryRecoveryTrial[] {
  const distancesMm = options.distancesMm ?? [2, 5, 10];
  const grouping = validateGrouping(options.grouping);
  if (plan?.schema !== 'morphloom.geometry-recovery-plan/0.1'
    || !Number.isFinite(options.alignedYawDegrees) || Math.abs(options.alignedYawDegrees) > 1_000_000
    || !Array.isArray(distancesMm) || distancesMm.length < 1 || distancesMm.length > 8
    || distancesMm.some((distance) => !Number.isFinite(distance) || distance < 0.1 || distance > 1_000)) {
    throw new Error('Geometry recovery translation trial configuration is unsafe.');
  }
  return plan.actions.flatMap((action) => {
    if (action.operation === 'request-region-evidence' || action.targetComponentIds.length < 1) return [];
    const directionReceipt = actionWorldDirection(action, options.alignedYawDegrees);
    if (!directionReceipt) return [];
    return distancesMm.flatMap((distance, distanceIndex) => groupRecoveryEdits(
      action.targetComponentIds.map((componentId) => ({
        componentId,
        translateMm: directionReceipt.direction.map((value) => value * distance) as [number, number, number],
      })),
      grouping,
    ).map((edits, groupIndex) => ({
      id: grouping === 'batch'
        ? `${action.id}:translate-${distanceIndex + 1}`
        : `${action.id}:c${groupIndex + 1}:translate-${distanceIndex + 1}`,
      actionId: action.id,
      edits,
    })));
  });
}

/**
 * Generates local shape edits for routed tubes while translating rigid parts.
 * Only one extreme control point is moved per open tube, so the remaining
 * route and every undeclared component stay byte-identical.
 */
export function createBoundedShapeRecoveryTrials(
  ir: AssemblyIR,
  plan: GeometryRecoveryPlan,
  options: {
    alignedYawDegrees: number;
    distancesMm?: number[];
    grouping?: RecoveryTrialGrouping;
  },
): GeometryRecoveryTrial[] {
  const distancesMm = options.distancesMm ?? [2, 5, 10];
  const grouping = validateGrouping(options.grouping);
  if (ir?.schema !== 'morphloom.assembly/0.1'
    || plan?.schema !== 'morphloom.geometry-recovery-plan/0.1'
    || !Number.isFinite(options.alignedYawDegrees) || Math.abs(options.alignedYawDegrees) > 1_000_000
    || !Array.isArray(distancesMm) || distancesMm.length < 1 || distancesMm.length > 8
    || distancesMm.some((distance) => !Number.isFinite(distance) || distance < 0.1 || distance > 1_000)) {
    throw new Error('Geometry recovery shape trial configuration is unsafe.');
  }
  const componentById = new Map(ir.components.map((component) => [component.id, component]));
  return plan.actions.flatMap((action) => {
    if (action.operation === 'request-region-evidence' || action.targetComponentIds.length < 1) return [];
    const directionReceipt = actionWorldDirection(action, options.alignedYawDegrees);
    if (!directionReceipt) return [];
    return distancesMm.flatMap((distance, distanceIndex) => groupRecoveryEdits(
      action.targetComponentIds.map((componentId): RecoveryEdit => {
        const component = componentById.get(componentId);
        if (!component) throw new Error(`Geometry recovery shape target does not exist: ${componentId}`);
        const delta = directionReceipt.direction.map((value) => value * distance) as [number, number, number];
        if (component.geometry.op !== 'tube' || component.geometry.closed || component.geometry.points.length < 2) {
          return { componentId, translateMm: delta };
        }
        const dot = (point: [number, number, number]): number => point.reduce((sum, value, axis) => (
          sum + value * directionReceipt.direction[axis]!
        ), 0);
        const candidates = component.geometry.points.map((point, pointIndex) => ({ pointIndex, projection: dot(point) }));
        candidates.sort((left, right) => directionReceipt.side === 'reference'
          ? right.projection - left.projection || left.pointIndex - right.pointIndex
          : left.projection - right.projection || left.pointIndex - right.pointIndex);
        return {
          componentId,
          geometry: {
            operation: 'tube-point-deltas',
            deltas: [{ pointIndex: candidates[0]!.pointIndex, deltaMm: delta }],
          },
        };
      }),
      grouping,
    ).map((edits, groupIndex) => ({
      id: grouping === 'batch'
        ? `${action.id}:shape-${distanceIndex + 1}`
        : `${action.id}:c${groupIndex + 1}:shape-${distanceIndex + 1}`,
      actionId: action.id,
      edits,
    })));
  });
}

/**
 * Changes spacing inside a semantic component group around one world-axis
 * pivot without scaling the individual rigid parts. Tube control points are
 * moved around the same pivot so routed or wire geometry stays coherent.
 */
export function createBoundedGroupAxisSpacingTrials(
  ir: AssemblyIR,
  plan: GeometryRecoveryPlan,
  options: {
    axis: 0 | 1 | 2;
    factors: number[];
    pivotMm?: number;
    actionIds?: string[];
  },
): GeometryRecoveryTrial[] {
  if (ir?.schema !== 'morphloom.assembly/0.1'
    || plan?.schema !== 'morphloom.geometry-recovery-plan/0.1'
    || ![0, 1, 2].includes(options.axis)
    || !Array.isArray(options.factors) || options.factors.length < 1 || options.factors.length > 8
    || options.factors.some((factor) => !Number.isFinite(factor) || factor < 0.25 || factor > 1.5
      || Math.abs(factor - 1) < 1e-9)
    || (options.pivotMm !== undefined && (!Number.isFinite(options.pivotMm)
      || Math.abs(options.pivotMm) > 100_000))
    || (options.actionIds !== undefined && (!Array.isArray(options.actionIds)
      || options.actionIds.length < 1 || options.actionIds.length > 64
      || new Set(options.actionIds).size !== options.actionIds.length
      || options.actionIds.some((id) => !SAFE_ID.test(id))))) {
    throw new Error('Geometry recovery group-spacing configuration is unsafe.');
  }
  const componentById = new Map(ir.components.map((component) => [component.id, component]));
  const selectedActionIds = options.actionIds ? new Set(options.actionIds) : undefined;
  if (selectedActionIds && [...selectedActionIds].some((id) => !plan.actions.some((action) => action.id === id))) {
    throw new Error('Geometry recovery group-spacing action filter references a missing action.');
  }
  return plan.actions.flatMap((action) => {
    if (action.operation === 'request-region-evidence'
      || (selectedActionIds && !selectedActionIds.has(action.id))) return [];
    if (action.targetComponentIds.length > 64
      || new Set(action.targetComponentIds).size !== action.targetComponentIds.length) {
      throw new Error(`Geometry recovery group target set is unsafe: ${action.id}`);
    }
    const components = action.targetComponentIds.map((id) => componentById.get(id));
    if (components.some((component) => !component)) {
      throw new Error(`Geometry recovery group target does not exist: ${action.id}`);
    }
    if (components.some((component) => component!.geometry.op === 'tube'
      && component!.geometry.points.length > 16)) {
      throw new Error(`Geometry recovery group tube exceeds the bounded edit limit: ${action.id}`);
    }
    const coordinates = components.flatMap((component) => {
      if (component!.geometry.op === 'tube') {
        return component!.geometry.points.map((point) => point[options.axis]);
      }
      return [component!.position?.[options.axis] ?? 0];
    });
    const pivotMm = options.pivotMm ?? (
      (Math.min(...coordinates) + Math.max(...coordinates)) / 2
    );
    return options.factors.flatMap((factor, factorIndex) => {
      const edits = components.flatMap((component): RecoveryEdit[] => {
        if (component!.geometry.op === 'tube') {
          const deltas = component!.geometry.points.map((point, pointIndex) => {
            const delta = (point[options.axis] - pivotMm) * (factor - 1);
            const deltaMm: Vector3 = [0, 0, 0];
            deltaMm[options.axis] = delta;
            return { pointIndex, deltaMm };
          }).filter((delta) => Math.abs(delta.deltaMm[options.axis]) > 1e-9);
          return deltas.length > 0 ? [{
            componentId: component!.id,
            geometry: { operation: 'tube-point-deltas', deltas },
          }] : [];
        }
        const position = component!.position?.[options.axis] ?? 0;
        const delta = (position - pivotMm) * (factor - 1);
        if (Math.abs(delta) <= 1e-9) return [];
        const translateMm: Vector3 = [0, 0, 0];
        translateMm[options.axis] = delta;
        return [{ componentId: component!.id, translateMm }];
      });
      if (edits.length > 64) {
        throw new Error(`Geometry recovery group trial exceeds the bounded edit limit: ${action.id}`);
      }
      if (edits.length < 1) return [];
      return [{
        id: `${action.id}:group-axis-${options.axis + 1}-spacing-${factorIndex + 1}`,
        actionId: action.id,
        edits,
      }];
    });
  });
}

/**
 * Evaluates independent recovery candidates from the same immutable source.
 * It never chains rejected edits, never widens the declared target set, and
 * returns the original IR when no candidate improves without regression.
 * Target gates use a stricter Pareto-style regression budget than other
 * protected gates so a gain in one target cannot conceal damage to another.
 */
export async function executeBoundedGeometryRecoverySearch(
  source: AssemblyIR,
  plan: GeometryRecoveryPlan,
  trials: GeometryRecoveryTrial[],
  evaluate: (ir: AssemblyIR) => Promise<GeometryRecoveryEvaluation>,
  options: {
    targetGateIds: string[];
    minimumImprovement?: number;
    maximumProtectedRegression?: number;
    maximumTargetRegression?: number;
  },
): Promise<{ ir: AssemblyIR; report: GeometryRecoveryExecutionReport }> {
  const minimumImprovement = options.minimumImprovement ?? 0.002;
  const maximumProtectedRegression = options.maximumProtectedRegression ?? 0;
  const maximumTargetRegression = options.maximumTargetRegression ?? 0;
  const targetGateIds = options.targetGateIds;
  const inputFingerprint = await fingerprintAssemblyIR(source);
  const baseline = await evaluate(source);
  if (!safeEvaluation(baseline)) throw new Error('Geometry recovery baseline evaluation is unsafe.');
  if (plan?.schema !== 'morphloom.geometry-recovery-plan/0.1' || !plan.pass || !plan.actionable) return {
    ir: source,
    report: {
      schema: 'morphloom.geometry-recovery-execution/0.1', status: 'blocked',
      inputFingerprint, outputFingerprint: inputFingerprint, baseline, trials: [],
      blockers: ['geometry recovery plan is not safe and actionable'],
    },
  };
  if (!Array.isArray(trials) || trials.length < 1 || trials.length > MAX_TRIALS
    || !Array.isArray(targetGateIds) || targetGateIds.length < 1 || targetGateIds.length > MAX_GATES
    || new Set(targetGateIds).size !== targetGateIds.length
    || targetGateIds.some((id) => !SAFE_ID.test(id) || !Object.hasOwn(baseline.gateScores, id))
    || !Number.isFinite(minimumImprovement) || minimumImprovement <= 0 || minimumImprovement > 0.25
    || !Number.isFinite(maximumProtectedRegression) || maximumProtectedRegression < 0
    || maximumProtectedRegression > 0.1
    || !Number.isFinite(maximumTargetRegression) || maximumTargetRegression < 0
    || maximumTargetRegression > maximumProtectedRegression) {
    throw new Error('Geometry recovery execution configuration is unsafe.');
  }
  const actionById = new Map(plan.actions.map((action) => [action.id, action]));
  const trialIds = new Set<string>();
  const receipts: GeometryRecoveryTrialReceipt[] = [];
  const candidates: Array<{
    id: string; ir: AssemblyIR; evaluation: GeometryRecoveryEvaluation;
    objective: number; mean: number; fingerprint: string;
  }> = [];
  for (const trial of trials) {
    if (!SAFE_ID.test(trial?.id ?? '') || trialIds.has(trial.id)) throw new Error('Geometry recovery trial ids are invalid or duplicated.');
    trialIds.add(trial.id);
    const action = actionById.get(trial.actionId);
    if (!action || action.operation === 'request-region-evidence') throw new Error(`Geometry recovery trial references a blocked action: ${trial.actionId}`);
    const allowedTargets = new Set(action.targetComponentIds);
    if (!Array.isArray(trial.edits) || trial.edits.length < 1 || trial.edits.length > 64
      || trial.edits.some((edit) => !allowedTargets.has(edit.componentId))) {
      throw new Error(`Geometry recovery trial widens its declared target set: ${trial.id}`);
    }
    const applied = await applyAssemblyComponentBatchPatch(source, {
      schema: 'morphloom.component-batch-patch/0.1', operationId: trial.id,
      expectedInputFingerprint: inputFingerprint, edits: trial.edits,
    });
    const evaluation = await evaluate(applied.ir);
    if (!safeEvaluation(evaluation)) throw new Error(`Geometry recovery trial returned an unsafe evaluation: ${trial.id}`);
    const scored = scoreTrial(
      baseline, evaluation, targetGateIds, minimumImprovement, maximumProtectedRegression,
      maximumTargetRegression,
    );
    receipts.push({
      id: trial.id, actionId: trial.actionId, inputFingerprint,
      outputFingerprint: applied.receipt.outputFingerprint, batchReceipt: applied.receipt,
      evaluation, accepted: scored.accepted, blockers: scored.blockers,
    });
    if (scored.accepted) candidates.push({
      id: trial.id, ir: applied.ir, evaluation, objective: scored.objective,
      mean: scored.mean, fingerprint: applied.receipt.outputFingerprint,
    });
  }
  candidates.sort((left, right) => right.objective - left.objective
    || right.mean - left.mean || left.fingerprint.localeCompare(right.fingerprint));
  const selected = candidates[0];
  if (!selected) return {
    ir: source,
    report: {
      schema: 'morphloom.geometry-recovery-execution/0.1', status: 'unchanged',
      inputFingerprint, outputFingerprint: inputFingerprint, baseline, trials: receipts,
      blockers: ['no bounded candidate improved target gates without protected-gate regression'],
    },
  };
  return {
    ir: selected.ir,
    report: {
      schema: 'morphloom.geometry-recovery-execution/0.1', status: 'improved',
      inputFingerprint, outputFingerprint: selected.fingerprint, selectedTrialId: selected.id,
      baseline, selected: selected.evaluation, trials: receipts, blockers: [],
    },
  };
}
