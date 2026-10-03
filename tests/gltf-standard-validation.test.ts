import { describe, expect, it, vi } from 'vitest';
import { compareGlbRoundTrip, snapshotScene } from '../src/engine/delivery-validation';
import { validateGlbStandard } from '../src/engine/gltf-standard-validation';
import * as THREE from 'three';

function minimalGlb(document: object = { asset: { version: '2.0' }, scene: 0, scenes: [{}] }): ArrayBuffer {
  const json = JSON.stringify(document);
  const paddedLength = Math.ceil(json.length / 4) * 4;
  const bytes = new Uint8Array(12 + 8 + paddedLength);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.byteLength, true);
  view.setUint32(12, paddedLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.fill(0x20, 20);
  bytes.set(new TextEncoder().encode(json), 20);
  return bytes.buffer;
}

describe('Khronos glTF delivery validation', () => {
  it('accepts a valid GLB and reports the validator identity', async () => {
    const result = await validateGlbStandard(minimalGlb());
    expect(result).toMatchObject({
      status: 'pass',
      validator: 'Khronos glTF Validator',
      errors: 0,
      warnings: 0,
      truncated: false,
      independentRead: { status: 'pass', parser: 'glTF Transform WebIO' },
    });
    expect(result.validatorVersion).toMatch(/^2\./);
  });

  it('rejects corrupted GLB bytes before they can be marked deliverable', async () => {
    const bytes = minimalGlb();
    new DataView(bytes).setUint32(0, 0x0, true);
    const result = await validateGlbStandard(bytes);
    expect(result.status).toBe('blocked');
    expect(result.errors).toBeGreaterThan(0);
    expect(result.issueCodes).toContain('GLB_INVALID_MAGIC');
    expect(result.independentRead.status).toBe('not-run');

    const root = new THREE.Group();
    root.name = 'standard-validation-fixture';
    const snapshot = snapshotScene(root);
    const audit = compareGlbRoundTrip(snapshot, structuredClone(snapshot), bytes.byteLength, 1, undefined, undefined, result);
    expect(audit.status).toBe('blocked');
    expect(audit.platformNotes.gltf20).toBe('khronos-validator-blocked');
    expect(audit.blockers.join(' ')).toMatch(/Khronos glTF validation errors/);
    expect(audit.platformNotes.blender).toBe('application-import-not-run');
  });

  it('reports a required extension rejected by the independent parser without losing the Khronos result', async () => {
    const bytes = minimalGlb({
      asset: { version: '2.0' }, scene: 0, scenes: [{}],
      extensionsUsed: ['VENDOR_unimplemented'], extensionsRequired: ['VENDOR_unimplemented'],
      extensions: { VENDOR_unimplemented: {} },
    });
    const result = await validateGlbStandard(bytes);
    expect(result).toMatchObject({
      status: 'blocked', errors: 0, warnings: 0, infos: 1,
      issueCodes: ['UNSUPPORTED_EXTENSION'],
      independentRead: { status: 'blocked', meshes: 0, reason: 'Missing required extension, "VENDOR_unimplemented".' },
    });
    const snapshot = snapshotScene(new THREE.Group());
    const audit = compareGlbRoundTrip(snapshot, structuredClone(snapshot), bytes.byteLength, 1, undefined, undefined, result);
    expect(audit.status).toBe('blocked');
    expect(audit.blockers.join(' ')).toMatch(/independent GLB read blocked/);
    expect(audit.platformNotes.gltf20).toBe('khronos-validator-blocked');
  });

  it('allows an optional unknown extension only when independent reading actually succeeds', async () => {
    const result = await validateGlbStandard(minimalGlb({
      asset: { version: '2.0' }, scene: 0, scenes: [{}],
      extensionsUsed: ['VENDOR_unimplemented'], extensions: { VENDOR_unimplemented: {} },
    }));
    expect(result).toMatchObject({ status: 'pass', errors: 0, infos: 1, independentRead: { status: 'pass' } });
  });

  it('blocks external image resources without making a network request', async () => {
    const fetch = vi.fn(() => { throw new Error('network must not be called'); });
    vi.stubGlobal('fetch', fetch);
    try {
      const result = await validateGlbStandard(minimalGlb({
        asset: { version: '2.0' }, scene: 0, scenes: [{}], images: [{ uri: 'https://example.invalid/image.png' }],
      }));
      expect(result).toMatchObject({ status: 'blocked', independentRead: { status: 'not-run' } });
      expect(result.issueCodes).toContain('IO_ERROR');
      expect(fetch).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });

  it('does not award delivery parity to a supplied unexecuted independent read', async () => {
    const result = await validateGlbStandard(minimalGlb());
    result.independentRead.status = 'not-run';
    const snapshot = snapshotScene(new THREE.Group());
    const audit = compareGlbRoundTrip(snapshot, structuredClone(snapshot), 128, 1, undefined, undefined, result);
    expect(audit.status).toBe('blocked');
    expect(audit.score).toBeLessThan(100);
    expect(audit.blockers.join(' ')).toContain('independent GLB read not-run');
  });

  it('surfaces specification warnings instead of awarding an exact 100', () => {
    const root = new THREE.Group();
    root.name = 'warning-fixture';
    const snapshot = snapshotScene(root);
    const audit = compareGlbRoundTrip(snapshot, structuredClone(snapshot), 128, 1, undefined, undefined, {
      status: 'warn',
      validator: 'Khronos glTF Validator',
      validatorVersion: '2.0.0-test',
      errors: 0,
      warnings: 1,
      infos: 0,
      hints: 0,
      truncated: false,
      issueCodes: ['TEST_WARNING'],
      independentRead: {
        status: 'pass', parser: 'glTF Transform WebIO', nodes: 1, meshes: 0, materials: 0, skins: 0, animations: 0,
      },
    });
    expect(audit.status).toBe('warn');
    expect(audit.score).toBeLessThan(100);
    expect(audit.platformNotes.gltf20).toBe('khronos-validator-warn');
  });
});
