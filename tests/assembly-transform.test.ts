import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { composeWorldAxisRotation } from '../src/engine/assembly-transform';

const vectorFromEuler = (rotation: [number, number, number]): THREE.Vector3 => (
  new THREE.Vector3(0, 1, 0).applyEuler(new THREE.Euler(...rotation, 'XYZ'))
);

describe('assembly world-axis rotation composition', () => {
  it('matches quaternion world-axis composition for an already rotated part', () => {
    const source: [number, number, number] = [Math.PI / 2, 0.3, -0.2];
    const radians = Math.PI / 3;
    const actual = vectorFromEuler(composeWorldAxisRotation(source, [0, 1, 0], radians));
    const expectedQuaternion = new THREE.Quaternion()
      .setFromAxisAngle(new THREE.Vector3(0, 1, 0), radians)
      .multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(...source, 'XYZ')));
    const expected = new THREE.Vector3(0, 1, 0).applyQuaternion(expectedQuaternion);
    expect(actual.distanceTo(expected)).toBeLessThan(1e-12);
  });

  it('does not behave like naive Euler addition for a pre-rotated guard', () => {
    const source: [number, number, number] = [Math.PI / 2, 0, 0];
    const radians = Math.PI / 4;
    const composed = vectorFromEuler(composeWorldAxisRotation(source, [0, 1, 0], radians));
    const naive = vectorFromEuler([source[0], source[1] + radians, source[2]]);
    expect(composed.distanceTo(naive)).toBeGreaterThan(0.5);
  });

  it('rejects degenerate axes and preserves an exact zero rotation', () => {
    expect(composeWorldAxisRotation([0.1, 0.2, 0.3], [1, 0, 0], 0)).toEqual([0.1, 0.2, 0.3]);
    expect(() => composeWorldAxisRotation(undefined, [0, 0, 0], 1)).toThrow(/degenerate/);
  });
});
