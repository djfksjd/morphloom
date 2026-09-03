import { describe, expect, it } from 'vitest';
import {
  createModelingRoute,
  decideRecovery,
  executeModelingWorkflow,
  type ModelingToolAdapter,
} from '../src/engine/modeling-orchestrator';
import type { SemiProfessionalReadinessReport } from '../src/engine/evidence-readiness';

function readiness(overrides: Partial<SemiProfessionalReadinessReport> = {}): SemiProfessionalReadinessReport {
  return {
    target: 'semi-professional-editable', profile: 'service-assembly', buildReady: true, deliveryReady: true,
    score: 92, recommendedRoles: [], presentRecommendedRoles: [], missingRecommendedRoles: [],
    requiredCapabilities: [], resolvedCapabilities: [], unresolvedCapabilities: [], strongDimensionProperties: ['width'],
    calibratedViews: ['drawing'], identifiedComponentIds: ['pcb'], sourceAuditReady: true, sourceAuditIssues: [],
    conflicts: [], blockers: [], warnings: [], nextActions: [], ...overrides,
  };
}

describe('modeling multi-tool router and recovery', () => {
  it('routes a measured electronics request through dimensions, netlist, clearance and delivery proof', () => {
    const route = createModelingRoute('실측 도면과 BOM으로 전자제품 PCB, 커넥터, 전선을 조립해줘', readiness());
    const tools = route.stages.flatMap((stage) => stage.tools);
    expect(route.domains).toEqual(expect.arrayContaining(['electronics', 'product']));
    expect(route.buildAllowed).toBe(true);
    expect(route.deliveryAllowed).toBe(true);
    expect(tools).toEqual(expect.arrayContaining([
      'semantic-part-decomposition', 'thin-feature-reconstruction', 'dimension-contracts',
      'visual-plan-audit',
      'electrical-netlist', 'clearance-router', 'assembly-compiler', 'part-inventory-audit',
      'pbr-reference-audit', 'topology-audit', 'visual-comparison', 'glb-roundtrip', 'native-reopen',
    ]));
  });

  it('does not impose six photos when a drawing-based evidence pack resolves the build', () => {
    const report = readiness({ profile: 'architectural-review', strongDimensionProperties: ['width', 'height'] });
    const route = createModelingRoute('아파트 평면도와 단면도 실측으로 건물을 만들어줘', report);
    expect(route.buildAllowed).toBe(true);
    expect(route.stages.find((stage) => stage.id === 'evidence')?.reason).toContain('without imposing a fixed photo count');
    expect(route.stages.flatMap((stage) => stage.tools)).toEqual(expect.arrayContaining(['plan-footprint', 'dimension-contracts']));
  });

  it('allows a review build but never reports delivery pass when evidence is not delivery-ready', async () => {
    const route = createModelingRoute(
      '정면 사진과 실측 폭으로 제품 검토 모델을 만들어줘',
      readiness({ deliveryReady: false, unresolvedCapabilities: ['surface', 'interfaces'] }),
    );
    expect(route).toMatchObject({ buildAllowed: true, deliveryAllowed: false });
    expect(route.blockers).toEqual(['delivery evidence unresolved: surface, interfaces']);
    const adapter: ModelingToolAdapter = {
      async run(tool) {
        return { tool, pass: true, fingerprint: 'a'.repeat(64), failures: [] };
      },
      async applyRecovery() {
        throw new Error('recovery was not expected');
      },
      async restore() {
        throw new Error('rollback was not expected');
      },
    };
    const result = await executeModelingWorkflow(route, adapter, {
      initialFingerprint: 'a'.repeat(64), toolTimeoutMs: 1_000,
    });
    expect(result).toMatchObject({
      status: 'blocked',
      blockers: ['delivery evidence unresolved: surface, interfaces'],
    });
    expect(result.receipts.at(-1)?.tool).toBe('native-reopen');
  });

  it('rolls back a regressing correction before applying another repair', () => {
    const decision = decideRecovery([
      { gateId: 'blade-silhouette', category: 'geometry', severity: 5, score: 71, previousScore: 84 },
      { gateId: 'roughness', category: 'material', severity: 3, score: 76, previousScore: 75 },
    ], {
      iteration: 2, maximumIterations: 6, repeatedGateIds: [],
      currentFingerprint: 'a'.repeat(64), previousFingerprint: 'b'.repeat(64),
    });
    expect(decision).toMatchObject({ action: 'rollback-regression', targetGateId: 'blade-silhouette' });
  });

  it('requests evidence after two ineffective edits and stops at the cost ceiling', () => {
    const failure = { gateId: 'hidden-camera-stack', category: 'geometry' as const, severity: 5, score: 42 };
    expect(decideRecovery([failure], {
      iteration: 3, maximumIterations: 6, repeatedGateIds: ['hidden-camera-stack', 'hidden-camera-stack'],
      currentFingerprint: 'c'.repeat(64), previousFingerprint: 'c'.repeat(64),
    })).toMatchObject({ action: 'request-evidence', targetGateId: 'hidden-camera-stack' });
    expect(decideRecovery([failure], {
      iteration: 6, maximumIterations: 6, repeatedGateIds: [], currentFingerprint: 'c'.repeat(64),
    })).toMatchObject({ action: 'stop-budget' });
  });

  it('uses deterministic severity and score ordering for automatic repair', () => {
    const decision = decideRecovery([
      { gateId: 'surface-scale', category: 'material', severity: 4, score: 61 },
      { gateId: 'roughness-map', category: 'material', severity: 4, score: 48 },
      { gateId: 'uv', category: 'topology', severity: 3, score: 10 },
    ], {
      iteration: 1, maximumIterations: 6, repeatedGateIds: [], currentFingerprint: 'd'.repeat(64),
    });
    expect(decision).toMatchObject({ action: 'revise-surface', targetGateId: 'roughness-map' });
    expect(decision.verificationTools).toEqual(['surface-reconstruction', 'pbr-reference-audit', 'visual-comparison', 'glb-roundtrip']);
  });

  it('routes geometry failures through part decomposition and thin-feature recovery', () => {
    const decision = decideRecovery([
      { gateId: 'missing-tripod-legs', category: 'geometry', severity: 5, score: 31 },
    ], {
      iteration: 1, maximumIterations: 6, repeatedGateIds: [], currentFingerprint: 'e'.repeat(64),
    });
    expect(decision).toMatchObject({ action: 'revise-geometry', targetGateId: 'missing-tripod-legs' });
    expect(decision.verificationTools).toEqual(expect.arrayContaining([
      'semantic-part-decomposition', 'thin-feature-reconstruction', 'part-inventory-audit',
      'visual-plan-audit',
    ]));
  });

  it('executes routed tools, applies one bounded repair, and reruns the complete delivery chain', async () => {
    const route = createModelingRoute('거친 아스팔트 표면을 3D 프린팅용으로 만들어줘', readiness());
    let repaired = false;
    const calls: string[] = [];
    const adapter: ModelingToolAdapter = {
      async run(tool, context) {
        calls.push(`${context.iteration}:${tool}`);
        if (!repaired && tool === 'surface-reconstruction') return {
          tool, pass: false, fingerprint: 'a'.repeat(64),
          failures: [{ gateId: 'aggregate-scale', category: 'material', severity: 5, score: 62 }],
        };
        return { tool, pass: true, fingerprint: (repaired ? 'b' : 'a').repeat(64), failures: [] };
      },
      async applyRecovery(decision) {
        expect(decision).toMatchObject({ action: 'revise-surface', targetGateId: 'aggregate-scale' });
        repaired = true;
        return 'b'.repeat(64);
      },
      async restore() {
        throw new Error('rollback was not expected');
      },
    };
    const result = await executeModelingWorkflow(route, adapter, {
      initialFingerprint: 'a'.repeat(64), maximumIterations: 3, toolTimeoutMs: 1_000,
    });
    expect(result).toMatchObject({ status: 'pass', iterations: 2, finalFingerprint: 'b'.repeat(64) });
    expect(result.decisions).toHaveLength(1);
    expect(calls.find((call) => call.startsWith('1:'))).toBe('1:surface-reconstruction');
    expect(result.receipts.at(-1)?.tool).toBe('native-reopen');
  });

  it('cancels a non-responsive tool at the workflow deadline', async () => {
    const route = createModelingRoute('아파트 평면도와 실측으로 건물을 만들어줘', readiness({ profile: 'architectural-review' }));
    const adapter: ModelingToolAdapter = {
      run: async () => new Promise(() => undefined),
      applyRecovery: async () => 'b'.repeat(64),
      restore: async () => undefined,
    };
    const result = await executeModelingWorkflow(route, adapter, {
      initialFingerprint: 'a'.repeat(64), toolTimeoutMs: 100,
    });
    expect(result).toMatchObject({ status: 'cancelled', blockers: ['modeling tool timed out'] });
  });

  it('executes a tool only once when multiple routed stages require the same audit', async () => {
    const route = createModelingRoute('거친 표면을 폐쇄형 3D 프린팅 메시로 만들어줘', readiness());
    const calls: string[] = [];
    const adapter: ModelingToolAdapter = {
      async run(tool) {
        calls.push(tool);
        return { tool, pass: true, fingerprint: 'a'.repeat(64), failures: [] };
      },
      async applyRecovery() {
        throw new Error('recovery was not expected');
      },
      async restore() {
        throw new Error('rollback was not expected');
      },
    };
    const result = await executeModelingWorkflow(route, adapter, {
      initialFingerprint: 'a'.repeat(64), toolTimeoutMs: 1_000,
    });
    expect(result.status).toBe('pass');
    expect(calls.filter((tool) => tool === 'topology-audit')).toHaveLength(1);
  });

  it('fails closed when a read-only verifier mutates the asset fingerprint', async () => {
    const route = createModelingRoute('실측 제품을 만들어줘', readiness());
    const adapter: ModelingToolAdapter = {
      async run(tool) {
        return {
          tool, pass: true,
          fingerprint: tool === 'evidence-readiness' ? 'b'.repeat(64) : 'a'.repeat(64),
          failures: [],
        };
      },
      async applyRecovery() {
        throw new Error('recovery was not expected');
      },
      async restore() {
        throw new Error('rollback was not expected');
      },
    };
    await expect(executeModelingWorkflow(route, adapter, {
      initialFingerprint: 'a'.repeat(64), toolTimeoutMs: 1_000,
    })).rejects.toThrow(/Read-only modeling verification evidence-readiness changed the asset fingerprint/);
  });
});
