import type { SemiProfessionalReadinessReport } from './evidence-readiness';
import { expandGenerationBrief, type AssetDomain } from './generation-policy';

export type ModelingTool =
  | 'evidence-readiness'
  | 'component-edit'
  | 'camera-calibration'
  | 'plan-footprint'
  | 'dimension-contracts'
  | 'semantic-part-decomposition'
  | 'visual-plan-audit'
  | 'thin-feature-reconstruction'
  | 'visual-hull'
  | 'implicit-surface'
  | 'assembly-compiler'
  | 'surface-reconstruction'
  | 'pbr-reference-audit'
  | 'electrical-netlist'
  | 'clearance-router'
  | 'pose-landmarks'
  | 'humanoid-rig'
  | 'animation-delivery'
  | 'game-lod-collision'
  | 'print-thickness'
  | 'topology-audit'
  | 'visual-comparison'
  | 'glb-roundtrip'
  | 'native-reopen'
  | 'part-inventory-audit';

export interface ModelingRouteStage {
  id: string;
  tools: ModelingTool[];
  reason: string;
  blocking: boolean;
}

export interface ModelingRoute {
  schema: 'morphloom.modeling-route/0.1';
  request: string;
  domains: AssetDomain[];
  buildAllowed: boolean;
  deliveryAllowed: boolean;
  stages: ModelingRouteStage[];
  blockers: string[];
}

const DOMAIN_TOOLS: Record<AssetDomain, ModelingTool[]> = {
  architecture: ['semantic-part-decomposition', 'visual-plan-audit', 'plan-footprint', 'dimension-contracts', 'surface-reconstruction', 'pbr-reference-audit', 'assembly-compiler'],
  product: ['camera-calibration', 'semantic-part-decomposition', 'visual-plan-audit', 'visual-hull', 'thin-feature-reconstruction', 'implicit-surface', 'surface-reconstruction', 'pbr-reference-audit', 'assembly-compiler'],
  electronics: ['semantic-part-decomposition', 'visual-plan-audit', 'thin-feature-reconstruction', 'dimension-contracts', 'surface-reconstruction', 'pbr-reference-audit', 'electrical-netlist', 'clearance-router', 'assembly-compiler'],
  human: ['camera-calibration', 'semantic-part-decomposition', 'visual-plan-audit', 'pose-landmarks', 'thin-feature-reconstruction', 'implicit-surface', 'surface-reconstruction', 'pbr-reference-audit'],
  animation: ['semantic-part-decomposition', 'visual-plan-audit', 'humanoid-rig', 'animation-delivery'],
  game: ['semantic-part-decomposition', 'visual-plan-audit', 'humanoid-rig', 'animation-delivery', 'game-lod-collision'],
  '3d-print': ['semantic-part-decomposition', 'visual-plan-audit', 'implicit-surface', 'topology-audit', 'print-thickness'],
  surface: ['surface-reconstruction', 'pbr-reference-audit'],
  unknown: [],
};

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

export function createModelingRoute(
  request: string,
  readiness?: SemiProfessionalReadinessReport,
): ModelingRoute {
  const brief = expandGenerationBrief(request, readiness);
  const blockers: string[] = [];
  if (brief.domains.includes('unknown')) blockers.push('asset domain is unresolved');
  if (!readiness) blockers.push('evidence pack has not been assessed');
  else if (!readiness.buildReady) blockers.push(...readiness.blockers.map((item) => `evidence: ${item}`));
  else if (!readiness.deliveryReady) {
    const unresolved = readiness.unresolvedCapabilities.length > 0
      ? readiness.unresolvedCapabilities.join(', ')
      : 'delivery evidence';
    blockers.push(`delivery evidence unresolved: ${unresolved}`);
  }
  const domainTools = unique(brief.domains.flatMap((domain) => DOMAIN_TOOLS[domain]));
  const stages: ModelingRouteStage[] = [{
    id: 'evidence',
    tools: ['evidence-readiness'],
    reason: 'Resolve capabilities from drawings, measurements, scans, datasheets, or photographs without imposing a fixed photo count.',
    blocking: !readiness?.buildReady,
  }];
  if (domainTools.length > 0) stages.push({
    id: 'reconstruction',
    tools: domainTools,
    reason: `Compile the evidence-supported ${brief.domains.join('+')} representation into editable geometry and material systems.`,
    blocking: false,
  });
  stages.push({
    id: 'verification',
    tools: ['visual-plan-audit', 'part-inventory-audit', 'topology-audit', 'visual-comparison', 'glb-roundtrip', 'native-reopen'],
    reason: 'Verify geometry, calibrated-view likeness, delivered bytes, and the target application before release.',
    blocking: true,
  });
  return {
    schema: 'morphloom.modeling-route/0.1',
    request: brief.sourceRequest,
    domains: brief.domains,
    buildAllowed: readiness?.buildReady === true && !brief.domains.includes('unknown'),
    deliveryAllowed: readiness?.deliveryReady === true && !brief.domains.includes('unknown'),
    stages,
    blockers,
  };
}

export type FailureCategory = 'evidence' | 'geometry' | 'topology' | 'material' | 'visual' | 'delivery' | 'runtime';
export type RecoveryAction =
  | 'request-evidence'
  | 'revise-geometry'
  | 'repair-topology'
  | 'revise-surface'
  | 'recalibrate-and-compare'
  | 'repair-interchange'
  | 'repair-target-import'
  | 'rollback-regression'
  | 'stop-budget';

export interface ModelingFailure {
  gateId: string;
  category: FailureCategory;
  severity: number;
  score: number;
  previousScore?: number;
}

export interface RecoveryState {
  iteration: number;
  maximumIterations: number;
  repeatedGateIds: string[];
  currentFingerprint: string;
  previousFingerprint?: string;
}

export interface RecoveryDecision {
  action: RecoveryAction;
  targetGateId?: string;
  verificationTools: ModelingTool[];
  reason: string;
}

export interface ModelingToolReceipt {
  tool: ModelingTool;
  pass: boolean;
  fingerprint: string;
  failures: ModelingFailure[];
}

export interface ModelingToolContext {
  request: string;
  iteration: number;
  signal: AbortSignal;
}

export interface ModelingToolAdapter {
  run(tool: ModelingTool, context: ModelingToolContext): Promise<ModelingToolReceipt>;
  applyRecovery(decision: RecoveryDecision, context: ModelingToolContext): Promise<string>;
  restore(fingerprint: string, context: ModelingToolContext): Promise<void>;
}

export interface ModelingWorkflowOptions {
  initialFingerprint: string;
  maximumIterations?: number;
  toolTimeoutMs?: number;
  signal?: AbortSignal;
}

export interface ModelingWorkflowReport {
  schema: 'morphloom.modeling-workflow/0.1';
  status: 'pass' | 'blocked' | 'cancelled';
  iterations: number;
  finalFingerprint: string;
  receipts: ModelingToolReceipt[];
  decisions: RecoveryDecision[];
  blockers: string[];
}

const RECOVERY: Record<FailureCategory, { action: RecoveryAction; tools: ModelingTool[] }> = {
  evidence: { action: 'request-evidence', tools: ['evidence-readiness'] },
  geometry: { action: 'revise-geometry', tools: ['semantic-part-decomposition', 'visual-plan-audit', 'thin-feature-reconstruction', 'part-inventory-audit', 'dimension-contracts', 'topology-audit', 'visual-comparison'] },
  topology: { action: 'repair-topology', tools: ['topology-audit', 'glb-roundtrip'] },
  material: { action: 'revise-surface', tools: ['surface-reconstruction', 'pbr-reference-audit', 'visual-comparison', 'glb-roundtrip'] },
  visual: { action: 'recalibrate-and-compare', tools: ['camera-calibration', 'visual-comparison'] },
  delivery: { action: 'repair-interchange', tools: ['glb-roundtrip', 'native-reopen'] },
  runtime: { action: 'repair-target-import', tools: ['game-lod-collision', 'native-reopen'] },
};

function safeFailure(failure: ModelingFailure): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,95}$/.test(failure.gateId)
    && Number.isInteger(failure.severity) && failure.severity >= 1 && failure.severity <= 5
    && Number.isFinite(failure.score) && failure.score >= 0 && failure.score <= 100
    && (failure.previousScore === undefined
      || (Number.isFinite(failure.previousScore) && failure.previousScore >= 0 && failure.previousScore <= 100));
}

export function decideRecovery(failures: ModelingFailure[], state: RecoveryState): RecoveryDecision {
  if (!Array.isArray(failures) || failures.length < 1 || failures.length > 64 || failures.some((item) => !safeFailure(item))) {
    throw new Error('Modeling recovery failures are empty or unsafe.');
  }
  if (!Number.isInteger(state.iteration) || !Number.isInteger(state.maximumIterations)
    || state.iteration < 0 || state.maximumIterations < 1 || state.maximumIterations > 8
    || state.iteration > state.maximumIterations || state.repeatedGateIds.length > 64
    || !/^[a-f0-9]{8,128}$/.test(state.currentFingerprint)
    || (state.previousFingerprint !== undefined && !/^[a-f0-9]{8,128}$/.test(state.previousFingerprint))) {
    throw new Error('Modeling recovery state is unsafe.');
  }
  if (state.iteration >= state.maximumIterations) return {
    action: 'stop-budget', verificationTools: [],
    reason: 'The bounded refinement budget is exhausted; preserve the last accepted asset and report unresolved blockers.',
  };
  const regressed = failures
    .filter((item) => item.previousScore !== undefined && item.score < item.previousScore)
    .sort((a, b) => (b.previousScore! - b.score) - (a.previousScore! - a.score) || a.gateId.localeCompare(b.gateId))[0];
  if (regressed) return {
    action: 'rollback-regression', targetGateId: regressed.gateId,
    verificationTools: ['topology-audit', 'visual-comparison', 'glb-roundtrip'],
    reason: `The last edit regressed ${regressed.gateId}; restore the previous accepted fingerprint before trying a narrower correction.`,
  };
  const target = [...failures].sort((a, b) => b.severity - a.severity || a.score - b.score || a.gateId.localeCompare(b.gateId))[0]!;
  const repeated = state.repeatedGateIds.filter((id) => id === target.gateId).length;
  if (repeated >= 2 && state.previousFingerprint === state.currentFingerprint) return {
    action: 'request-evidence', targetGateId: target.gateId, verificationTools: ['evidence-readiness'],
    reason: `${target.gateId} survived two bounded corrections without changing the compiled asset; request the exact missing evidence instead of hallucinating another edit.`,
  };
  const recovery = RECOVERY[target.category];
  return {
    action: recovery.action,
    targetGateId: target.gateId,
    verificationTools: [...recovery.tools],
    reason: `Correct the highest-impact ${target.category} blocker ${target.gateId}, then rerun only its dependent gates before the full release suite.`,
  };
}

const RECEIPT_FINGERPRINT = /^[a-f0-9]{8,128}$/;
const READ_ONLY_VERIFICATION_TOOLS = new Set<ModelingTool>([
  'evidence-readiness',
  'visual-plan-audit',
  'plan-footprint',
  'dimension-contracts',
  'pbr-reference-audit',
  'part-inventory-audit',
  'electrical-netlist',
  'print-thickness',
  'topology-audit',
  'visual-comparison',
  'glb-roundtrip',
  'native-reopen',
]);

function safeReceipt(receipt: ModelingToolReceipt, expectedTool: ModelingTool): boolean {
  return receipt?.tool === expectedTool
    && typeof receipt.pass === 'boolean'
    && RECEIPT_FINGERPRINT.test(receipt.fingerprint)
    && Array.isArray(receipt.failures)
    && receipt.failures.length <= 64
    && receipt.failures.every(safeFailure)
    && (receipt.pass ? receipt.failures.length === 0 : receipt.failures.length > 0);
}

async function boundedAdapterCall<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  parentSignal?: AbortSignal,
): Promise<T> {
  if (parentSignal?.aborted) throw new DOMException('Modeling workflow cancelled.', 'AbortError');
  const controller = new AbortController();
  const onParentAbort = (): void => controller.abort(parentSignal?.reason);
  parentSignal?.addEventListener('abort', onParentAbort, { once: true });
  const timeout = setTimeout(() => controller.abort('modeling tool timed out'), timeoutMs);
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(new DOMException('Modeling tool cancelled or timed out.', 'AbortError'));
    controller.signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([operation(controller.signal), aborted]);
  } finally {
    clearTimeout(timeout);
    parentSignal?.removeEventListener('abort', onParentAbort);
    if (onAbort) controller.signal.removeEventListener('abort', onAbort);
  }
}

export async function executeModelingWorkflow(
  route: ModelingRoute,
  adapter: ModelingToolAdapter,
  options: ModelingWorkflowOptions,
): Promise<ModelingWorkflowReport> {
  const maximumIterations = options.maximumIterations ?? 6;
  const toolTimeoutMs = options.toolTimeoutMs ?? 120_000;
  if (route.schema !== 'morphloom.modeling-route/0.1'
    || !RECEIPT_FINGERPRINT.test(options.initialFingerprint)
    || !Number.isInteger(maximumIterations) || maximumIterations < 1 || maximumIterations > 8
    || !Number.isInteger(toolTimeoutMs) || toolTimeoutMs < 100 || toolTimeoutMs > 600_000) {
    throw new Error('Modeling workflow configuration is unsafe.');
  }
  if (!route.buildAllowed) return {
    schema: 'morphloom.modeling-workflow/0.1', status: 'blocked', iterations: 0,
    finalFingerprint: options.initialFingerprint, receipts: [], decisions: [],
    blockers: route.blockers.length > 0 ? [...route.blockers] : ['modeling route is not build-ready'],
  };

  const receipts: ModelingToolReceipt[] = [];
  const decisions: RecoveryDecision[] = [];
  const repeatedGateIds: string[] = [];
  const tools = unique(route.stages.flatMap((stage) => stage.tools));
  if (tools.length < 1 || tools.length > 64) throw new Error('Modeling route tool count is unsafe.');
  const maximumReceiptBudget = tools.length * (maximumIterations + 1) * 2;
  let currentFingerprint = options.initialFingerprint;
  let previousFingerprint: string | undefined;
  let pendingVerificationTools: ModelingTool[] | undefined;

  try {
    for (let iteration = 0; iteration <= maximumIterations; iteration += 1) {
      const iterationReceipts: ModelingToolReceipt[] = [];
      const runTools = async (sequence: ModelingTool[]): Promise<boolean> => {
        for (const tool of sequence) {
          const receipt = await boundedAdapterCall(
            (signal) => adapter.run(tool, { request: route.request, iteration, signal }),
            toolTimeoutMs,
            options.signal,
          );
          if (!safeReceipt(receipt, tool)) throw new Error(`Modeling adapter returned an unsafe ${tool} receipt.`);
          if (READ_ONLY_VERIFICATION_TOOLS.has(tool) && receipt.fingerprint !== currentFingerprint) {
            throw new Error(`Read-only modeling verification ${tool} changed the asset fingerprint.`);
          }
          iterationReceipts.push(receipt);
          receipts.push(receipt);
          if (receipts.length > maximumReceiptBudget) throw new Error('Modeling workflow receipt budget exceeded.');
          currentFingerprint = receipt.fingerprint;
          if (!receipt.pass) return false;
        }
        return true;
      };
      let complete = true;
      if (pendingVerificationTools) {
        complete = await runTools(pendingVerificationTools);
        if (complete) pendingVerificationTools = undefined;
      }
      if (complete) complete = await runTools(tools);
      const failures = iterationReceipts.flatMap((receipt) => receipt.failures);
      if (complete && failures.length === 0) {
        if (!route.deliveryAllowed) return {
          schema: 'morphloom.modeling-workflow/0.1', status: 'blocked', iterations: iteration + 1,
          finalFingerprint: currentFingerprint, receipts, decisions,
          blockers: route.blockers.length > 0
            ? [...route.blockers]
            : ['evidence pack permits a review draft but not a production delivery'],
        };
        return {
          schema: 'morphloom.modeling-workflow/0.1', status: 'pass', iterations: iteration + 1,
          finalFingerprint: currentFingerprint, receipts, decisions, blockers: [],
        };
      }

      const decision = decideRecovery(failures, {
        iteration,
        maximumIterations,
        repeatedGateIds,
        currentFingerprint,
        previousFingerprint,
      });
      decisions.push(decision);
      if (decision.targetGateId) repeatedGateIds.push(decision.targetGateId);
      if (decision.action === 'stop-budget' || decision.action === 'request-evidence') return {
        schema: 'morphloom.modeling-workflow/0.1', status: 'blocked', iterations: iteration + 1,
        finalFingerprint: currentFingerprint, receipts, decisions, blockers: [decision.reason],
      };
      if (decision.action === 'rollback-regression') {
        if (!previousFingerprint) return {
          schema: 'morphloom.modeling-workflow/0.1', status: 'blocked', iterations: iteration + 1,
          finalFingerprint: currentFingerprint, receipts, decisions,
          blockers: ['A regression was detected before an accepted checkpoint existed.'],
        };
        await boundedAdapterCall(
          (signal) => adapter.restore(previousFingerprint!, { request: route.request, iteration, signal }),
          toolTimeoutMs,
          options.signal,
        );
        currentFingerprint = previousFingerprint;
        previousFingerprint = undefined;
        pendingVerificationTools = unique(decision.verificationTools);
        continue;
      }
      const beforeRecovery = currentFingerprint;
      const recoveredFingerprint = await boundedAdapterCall(
        (signal) => adapter.applyRecovery(decision, { request: route.request, iteration, signal }),
        toolTimeoutMs,
        options.signal,
      );
      if (!RECEIPT_FINGERPRINT.test(recoveredFingerprint)) {
        throw new Error('Modeling recovery returned an unsafe fingerprint.');
      }
      previousFingerprint = beforeRecovery;
      currentFingerprint = recoveredFingerprint;
      pendingVerificationTools = unique(decision.verificationTools);
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return {
      schema: 'morphloom.modeling-workflow/0.1', status: 'cancelled', iterations: decisions.length + 1,
      finalFingerprint: currentFingerprint, receipts, decisions,
      blockers: [options.signal?.aborted ? 'modeling workflow cancelled by caller' : 'modeling tool timed out'],
    };
    throw error;
  }
  throw new Error('Modeling workflow terminated outside its bounded state machine.');
}
