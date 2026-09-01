import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { analyzeSelfIntersections } from '../src/engine/self-intersection';
import { analyzeTopology } from '../src/engine/topology';

function twoClosedBoxes(offset: THREE.Vector3): THREE.BufferGeometry {
  const first = new THREE.BoxGeometry(1, 1, 1);
  const second = new THREE.BoxGeometry(1, 1, 1);
  second.applyMatrix4(new THREE.Matrix4().makeTranslation(offset.x, offset.y, offset.z));
  const merged = mergeGeometries([first, second], false);
  first.dispose();
  second.dispose();
  if (!merged) throw new Error('box fixture merge failed');
  return merged;
}

describe('geometric self-intersection gate', () => {
  it('accepts disconnected closed shells that do not touch', () => {
    const geometry = twoClosedBoxes(new THREE.Vector3(2, 0, 0));
    expect(analyzeSelfIntersections(geometry)).toMatchObject({
      intersections: 0,
      complete: true,
      triangleCount: 24,
    });
    const topology = analyzeTopology(new THREE.Mesh(geometry));
    expect(topology).toMatchObject({
      boundaryEdges: 0,
      nonManifoldEdges: 0,
      degenerateTriangles: 0,
      selfIntersections: 0,
      selfIntersectionComplete: true,
      pass: true,
    });
    geometry.dispose();
  });

  it('blocks mutually penetrating closed shells that edge topology alone cannot see', () => {
    const geometry = twoClosedBoxes(new THREE.Vector3(0.37, 0.29, 0.21));
    const geometric = analyzeSelfIntersections(geometry);
    expect(geometric.complete).toBe(true);
    expect(geometric.intersections).toBeGreaterThan(0);

    const topology = analyzeTopology(new THREE.Mesh(geometry));
    expect(topology.boundaryEdges).toBe(0);
    expect(topology.nonManifoldEdges).toBe(0);
    expect(topology.degenerateTriangles).toBe(0);
    expect(topology.selfIntersections).toBeGreaterThan(0);
    expect(topology.selfIntersectionMeshes).toBe(1);
    expect(topology.pass).toBe(false);
    geometry.dispose();
  });

  it('returns the same candidate and intersection counts on repeated runs', () => {
    const geometry = twoClosedBoxes(new THREE.Vector3(0.37, 0.29, 0.21));
    const first = analyzeSelfIntersections(geometry);
    const second = analyzeSelfIntersections(geometry);
    expect(second).toEqual(first);
    geometry.dispose();
  });
});
