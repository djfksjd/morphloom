import * as THREE from 'three';

export type EulerTuple = [number, number, number];
export type AxisTuple = [number, number, number];

/**
 * Composes a world-axis rotation before an existing local XYZ Euler rotation.
 * Direct Euler-component addition is only valid for special aligned cases and
 * can shear the intended articulation frame when a part is already rotated.
 */
export function composeWorldAxisRotation(
  rotation: EulerTuple | undefined,
  axis: AxisTuple,
  radians: number,
): EulerTuple {
  const source = rotation ?? [0, 0, 0];
  if (![...source, ...axis, radians].every(Number.isFinite)) {
    throw new Error('Assembly rotation contains a non-finite value.');
  }
  const worldAxis = new THREE.Vector3(...axis);
  if (worldAxis.lengthSq() <= 1e-18) throw new Error('Assembly world rotation axis is degenerate.');
  if (Math.abs(radians) <= 1e-15) return [...source];
  worldAxis.normalize();
  const local = new THREE.Quaternion().setFromEuler(new THREE.Euler(...source, 'XYZ'));
  const world = new THREE.Quaternion().setFromAxisAngle(worldAxis, radians);
  const composed = world.multiply(local).normalize();
  const result = new THREE.Euler().setFromQuaternion(composed, 'XYZ');
  return [result.x, result.y, result.z];
}
