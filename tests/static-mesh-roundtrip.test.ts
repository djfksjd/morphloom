import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { snapshotScene } from '../src/engine/delivery-validation';
import { compareStaticMeshRoundTrip } from '../src/engine/static-mesh-roundtrip';

function snapshot() {
  const root = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 3), new THREE.MeshStandardMaterial());
  mesh.name = 'delivery_box';
  root.add(mesh);
  return snapshotScene(root);
}

describe('static mesh delivery round-trip', () => {
  it('accepts triangle and bounds parity while recording format limits', () => {
    const source = snapshot();
    for (const format of ['obj', 'stl', 'ply'] as const) {
      const audit = compareStaticMeshRoundTrip(source, structuredClone(source), format, 512);
      expect(audit).toMatchObject({ status: 'pass', format, triangleParity: true, boundsErrorMm: 0 });
      expect(audit.warnings).toHaveLength(1);
    }
  });

  it('blocks triangle loss and sub-millimetre envelope drift beyond tolerance', () => {
    const source = snapshot();
    const reopened = structuredClone(source);
    reopened.triangles -= 1;
    reopened.boundsMeters.max[0] += 0.0002;
    const audit = compareStaticMeshRoundTrip(source, reopened, 'obj', 512, 0.1);
    expect(audit.status).toBe('blocked');
    expect(audit.blockers).toEqual(expect.arrayContaining([
      expect.stringMatching(/triangle count changed/),
      expect.stringMatching(/bounds drift 0\.200 mm/),
    ]));
  });

  it('rejects unsafe payload sizes and tolerances', () => {
    const source = snapshot();
    expect(() => compareStaticMeshRoundTrip(source, source, 'stl', 0)).toThrow(/payload/);
    expect(() => compareStaticMeshRoundTrip(source, source, 'ply', 512, 11)).toThrow(/tolerance/);
  });
});
