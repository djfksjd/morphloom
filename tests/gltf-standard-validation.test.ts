import { describe, expect, it } from 'vitest';
import { compareGlbRoundTrip, snapshotScene } from '../src/engine/delivery-validation';
import { validateGlbStandard } from '../src/engine/gltf-standard-validation';
import * as THREE from 'three';

function minimalGlb(): ArrayBuffer {
  const json = JSON.stringify({ asset: { version: '2.0' }, scene: 0, scenes: [{}] });
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

    const root = new THREE.Group();
    root.name = 'standard-validation-fixture';
    const snapshot = snapshotScene(root);
    const audit = compareGlbRoundTrip(snapshot, structuredClone(snapshot), bytes.byteLength, 1, undefined, undefined, result);
    expect(audit.status).toBe('blocked');
    expect(audit.platformNotes.gltf20).toBe('khronos-validator-blocked');
    expect(audit.blockers.join(' ')).toMatch(/Khronos glTF validation errors/);
    expect(audit.platformNotes.blender).toBe('application-import-not-run');
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
    });
    expect(audit.status).toBe('warn');
    expect(audit.score).toBeLessThan(100);
    expect(audit.platformNotes.gltf20).toBe('khronos-validator-warn');
  });
});
