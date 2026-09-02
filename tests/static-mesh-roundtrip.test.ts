import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { snapshotScene } from '../src/engine/delivery-validation';
import { compareStaticMeshRoundTrip, exportMillimetreStlBytes } from '../src/engine/static-mesh-roundtrip';

function snapshot() {
  const root = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 3), new THREE.MeshStandardMaterial());
  mesh.name = 'delivery_box';
  root.add(mesh);
  return snapshotScene(root);
}

describe('static mesh delivery round-trip', () => {
  it('writes binary STL coordinates in millimetres with an exact byte contract', () => {
    const root = new THREE.Group();
    root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 2, 3), new THREE.MeshStandardMaterial()));
    const bytes = exportMillimetreStlBytes(root);
    const geometry = new STLLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    geometry.computeBoundingBox();
    const size = geometry.boundingBox!.getSize(new THREE.Vector3());
    expect(bytes.byteLength).toBe(84 + 12 * 50);
    expect(size.toArray()).toEqual([1_000, 2_000, 3_000]);
  });

  it('accepts triangle and bounds parity while recording format limits', () => {
    const source = snapshot();
    for (const format of ['obj', 'stl', 'ply'] as const) {
      const reopened = structuredClone(source);
      if (format === 'stl') {
        reopened.boundsMeters.min = reopened.boundsMeters.min.map((value) => value * 1_000);
        reopened.boundsMeters.max = reopened.boundsMeters.max.map((value) => value * 1_000);
        reopened.boundsMeters.size = reopened.boundsMeters.size.map((value) => value * 1_000);
      }
      const audit = compareStaticMeshRoundTrip(source, reopened, format, 512);
      expect(audit).toMatchObject({
        status: 'pass', format, triangleParity: true, boundsErrorMm: 0,
        coordinateUnit: format === 'stl' ? 'mm' : 'm',
        coordinateScaleFromMeters: format === 'stl' ? 1_000 : 1,
      });
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
    expect(() => compareStaticMeshRoundTrip(source, source, 'obj', 512, 0.1, 10)).toThrow(/coordinate scale/);
  });
});
