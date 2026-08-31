import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildOrnateKnife } from '../src/engine/knife';
import { compileAssemblyIR } from '../src/engine/assembly-compiler';
import { COOLING_ASSEMBLY_IR } from '../src/engine/cooling-assembly';
import {
  buildFigmaReferenceSvg,
  compareGlbRoundTrip,
  createLocalBuildTelemetry,
  fingerprintJson,
  snapshotScene,
} from '../src/engine/delivery-validation';
import { DEFAULT_KNIFE_SPEC } from '../src/types';
import { benchmarkPassRates, evaluateBenchmarkCase } from '../src/engine/benchmark-policy';

describe('delivery validation and deterministic output', () => {
  it('excludes hidden editor helpers from the delivery snapshot', () => {
    const visible = buildOrnateKnife(DEFAULT_KNIFE_SPEC, 'beauty').root;
    const baseline = snapshotScene(visible);
    const hidden = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    hidden.name = 'hidden_editor_helper';
    hidden.visible = false;
    hidden.position.set(100, 100, 100);
    visible.add(hidden);
    const snapshot = snapshotScene(visible);
    expect(snapshot.meshes).toBe(16);
    expect(snapshot.namedMeshes).toBe(16);
    expect(snapshot.boundsMeters).toEqual(baseline.boundsMeters);
  });
  it('keeps conductor and terminal semantic IDs unique for interchange tools', () => {
    const build = compileAssemblyIR(COOLING_ASSEMBLY_IR, 'beauty');
    const snapshot = snapshotScene(build.root);
    expect(snapshot.duplicatePartIds).toEqual([]);
    expect(build.root.getObjectByName('w_12v_drive_a_terminal_1')?.userData.part.id).toBe('w_12v_drive_a_terminal_1');
  }, 20_000);
  it('produces the same structural/material fingerprint for the same input', () => {
    const first = buildOrnateKnife(DEFAULT_KNIFE_SPEC, 'beauty');
    const second = buildOrnateKnife(structuredClone(DEFAULT_KNIFE_SPEC), 'beauty');
    const firstSnapshot = snapshotScene(first.root);
    const secondSnapshot = snapshotScene(second.root);
    expect(secondSnapshot.fingerprint).toBe(firstSnapshot.fingerprint);
    expect(secondSnapshot.triangles).toBe(firstSnapshot.triangles);
    expect(secondSnapshot.meshes).toBe(firstSnapshot.meshes);
    expect(firstSnapshot.finiteTransforms).toBe(true);
    expect(firstSnapshot.duplicatePartIds).toEqual([]);
  });

  it('changes the fingerprint when a geometry-driving input changes', () => {
    const first = buildOrnateKnife(DEFAULT_KNIFE_SPEC, 'beauty');
    const second = buildOrnateKnife({ ...DEFAULT_KNIFE_SPEC, heightMm: DEFAULT_KNIFE_SPEC.heightMm + 4 }, 'beauty');
    expect(snapshotScene(second.root).fingerprint).not.toBe(snapshotScene(first.root).fingerprint);
  });

  it('canonicalizes JSON key order for source identity', () => {
    expect(fingerprintJson({ a: 1, b: { c: 2 } })).toBe(fingerprintJson({ b: { c: 2 }, a: 1 }));
    expect(fingerprintJson({ a: 2, b: { c: 2 } })).not.toBe(fingerprintJson({ a: 1, b: { c: 2 } }));
  });

  it('blocks interchange delivery when reopened geometry counts drift', () => {
    const build = buildOrnateKnife(DEFAULT_KNIFE_SPEC, 'beauty');
    const source = snapshotScene(build.root);
    const passed = compareGlbRoundTrip(source, structuredClone(source), 1024, 12);
    expect(passed).toMatchObject({ status: 'pass', meshParity: true, triangleParity: true });
    const drifted = structuredClone(source);
    drifted.meshes -= 1;
    drifted.triangles -= 4;
    const blocked = compareGlbRoundTrip(source, drifted, 1024, 12);
    expect(blocked.status).toBe('blocked');
    expect(blocked.blockers.join(' ')).toMatch(/mesh count changed/);
    expect(blocked.blockers.join(' ')).toMatch(/triangle count changed/);
  });

  it('exports an honest Figma reference sheet and measured local telemetry', () => {
    const build = buildOrnateKnife(DEFAULT_KNIFE_SPEC, 'beauty');
    const snapshot = snapshotScene(build.root);
    const svg = buildFigmaReferenceSvg(build.root, 'Ornate blade');
    expect(svg).toContain('Morphloom Figma Reference');
    expect(svg).toContain('data-part-id="blade_core"');
    expect(svg).toContain('not STEP/BREP');
    const telemetry = createLocalBuildTelemetry(snapshot, 31.5);
    expect(telemetry).toMatchObject({ compileMs: 31.5, uploadedToServer: false, storageLocation: 'browser-memory' });
    expect(telemetry.estimatedRenderBytes).toBeGreaterThan(0);
    expect(telemetry.llmCost.status).toBe('not-observed');
  });
});

describe('semi-professional benchmark policy', () => {
  it('separates model readiness from real browser delivery proof', () => {
    const modelReady = evaluateBenchmarkCase({
      id: 'product', domain: 'product', topologyPass: true, evidenceScore: 90, surfaceCoverage: 0.95,
      domainChecksPass: true, firstFingerprint: 'same', repeatedFingerprint: 'same', expectedDecision: 'release',
    });
    expect(modelReady).toMatchObject({ modelReady: true, deliveryReady: false });
    expect(modelReady.blockers).toContain('browser GLB round-trip required');
    const delivered = evaluateBenchmarkCase({ ...modelReady, browserGlbRoundTrip: true });
    expect(delivered).toMatchObject({ modelReady: true, deliveryReady: true });
    expect(benchmarkPassRates([modelReady, delivered])).toEqual({
      overall: 0.5, technical: 0.5, decision: 0.5, modelRelease: 1, deliveryRelease: 0.5, rejectionSafety: 0,
    });
  });

  it('blocks weak evidence even when topology and part checks pass', () => {
    const result = evaluateBenchmarkCase({
      id: 'service', domain: 'service-assembly', topologyPass: true, evidenceScore: 52, surfaceCoverage: 0.95,
      domainChecksPass: true, firstFingerprint: 'stable', repeatedFingerprint: 'stable', browserGlbRoundTrip: true,
      expectedDecision: 'block', expectedBlockerPrefix: 'evidence',
    });
    expect(result.modelReady).toBe(false);
    expect(result.deliveryReady).toBe(false);
    expect(result.score).toBeLessThanOrEqual(59);
    expect(result.blockers).toContain('evidence 52/85');
    expect(result).toMatchObject({ technicalReady: true, decisionCorrect: true, benchmarkPassed: true });
    expect(benchmarkPassRates([result])).toMatchObject({ rejectionSafety: 1 });
  });

  it('does not count an expected rejection when the requested blocker is absent', () => {
    const result = evaluateBenchmarkCase({
      id: 'wrong-reason', domain: 'character', topologyPass: false, evidenceScore: 95, surfaceCoverage: 0.95,
      domainChecksPass: true, firstFingerprint: 'same', repeatedFingerprint: 'same', browserGlbRoundTrip: true,
      expectedDecision: 'block', expectedBlockerPrefix: 'evidence',
    });
    expect(result).toMatchObject({ decisionCorrect: false, benchmarkPassed: false });
  });
});
