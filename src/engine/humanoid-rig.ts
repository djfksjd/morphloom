import * as THREE from 'three';
import type { PoseStyle } from '../types';
import { getPoseJoints, type ReferenceJointId } from './reference-pose';

interface BoneDefinition {
  name: string;
  joint: ReferenceJointId;
  parent?: string;
}

const HUMANOID_BONES: readonly BoneDefinition[] = [
  { name: 'hips', joint: 'hips' },
  { name: 'spine', joint: 'spine', parent: 'hips' },
  { name: 'chest', joint: 'chest', parent: 'spine' },
  { name: 'neck', joint: 'neck', parent: 'chest' },
  { name: 'head', joint: 'head', parent: 'neck' },
  { name: 'shoulder_L', joint: 'shoulderL', parent: 'chest' },
  { name: 'elbow_L', joint: 'elbowL', parent: 'shoulder_L' },
  { name: 'wrist_L', joint: 'wristL', parent: 'elbow_L' },
  { name: 'shoulder_R', joint: 'shoulderR', parent: 'chest' },
  { name: 'elbow_R', joint: 'elbowR', parent: 'shoulder_R' },
  { name: 'wrist_R', joint: 'wristR', parent: 'elbow_R' },
  { name: 'hip_L', joint: 'hipL', parent: 'hips' },
  { name: 'knee_L', joint: 'kneeL', parent: 'hip_L' },
  { name: 'ankle_L', joint: 'ankleL', parent: 'knee_L' },
  { name: 'hip_R', joint: 'hipR', parent: 'hips' },
  { name: 'knee_R', joint: 'kneeR', parent: 'hip_R' },
  { name: 'ankle_R', joint: 'ankleR', parent: 'knee_R' },
] as const;

export interface HumanoidRigResult {
  skeleton: THREE.Skeleton;
  rootBone: THREE.Bone;
  clip: THREE.AnimationClip;
  boneCount: number;
  weightedVertices: number;
  maximumWeightError: number;
  maximumInfluences: number;
}

function createIdleClip(bones: Map<string, THREE.Bone>, heightMeters: number): THREE.AnimationClip {
  const hips = bones.get('hips');
  const chest = bones.get('chest');
  if (!hips || !chest) throw new Error('Humanoid animation anchors are missing.');
  const times = [0, 1, 2];
  const hipBase = hips.position;
  const hipLift = heightMeters * 0.0025;
  const hipsTrack = new THREE.VectorKeyframeTrack('hips.position', times, [
    hipBase.x, hipBase.y, hipBase.z,
    hipBase.x, hipBase.y + hipLift, hipBase.z,
    hipBase.x, hipBase.y, hipBase.z,
  ]);
  const rest = new THREE.Quaternion();
  const breath = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.012, 0, 0));
  const chestTrack = new THREE.QuaternionKeyframeTrack('chest.quaternion', times, [
    rest.x, rest.y, rest.z, rest.w,
    breath.x, breath.y, breath.z, breath.w,
    rest.x, rest.y, rest.z, rest.w,
  ]);
  const clip = new THREE.AnimationClip('morphloom_idle_preview', 2, [hipsTrack, chestTrack]);
  if (!clip.validate()) throw new Error('Generated humanoid animation clip is invalid.');
  return clip;
}

/**
 * Adds a real glTF-compatible skeleton and bounded two-bone skin weights to an
 * already posed body. The current shape is the bind pose, so merely enabling
 * skinning cannot move the authored result; downstream DCC tools can animate it.
 */
export function rigHumanoidGeometry(
  geometry: THREE.BufferGeometry,
  heightMeters: number,
  pose: PoseStyle,
): HumanoidRigResult {
  const position = geometry.getAttribute('position');
  if (!position || position.itemSize !== 3 || position.count < 3) throw new Error('Humanoid rigging requires a non-empty position attribute.');
  if (!Number.isFinite(heightMeters) || heightMeters <= 0 || heightMeters > 3) throw new Error('Humanoid rig height is outside the supported range.');
  const joints = getPoseJoints(heightMeters, pose);
  const bones = new Map<string, THREE.Bone>();
  const worldTargets = new Map<string, THREE.Vector3>();
  for (const definition of HUMANOID_BONES) {
    const target = joints[definition.joint];
    if (!target) throw new Error(`Humanoid joint ${definition.joint} is missing.`);
    worldTargets.set(definition.name, target.clone());
    const bone = new THREE.Bone();
    bone.name = definition.name;
    bones.set(definition.name, bone);
  }
  for (const definition of HUMANOID_BONES) {
    const bone = bones.get(definition.name)!;
    const target = worldTargets.get(definition.name)!;
    if (definition.parent) {
      const parent = bones.get(definition.parent);
      const parentTarget = worldTargets.get(definition.parent);
      if (!parent || !parentTarget) throw new Error(`Humanoid bone parent ${definition.parent} is missing.`);
      bone.position.copy(target).sub(parentTarget);
      parent.add(bone);
    } else {
      bone.position.copy(target);
    }
  }
  const orderedBones = HUMANOID_BONES.map((definition) => bones.get(definition.name)!);
  const boneIndices = new Map(orderedBones.map((bone, index) => [bone.name, index]));
  const skinIndices = new Uint16Array(position.count * 4);
  const skinWeights = new Float32Array(position.count * 4);
  const point = new THREE.Vector3();
  const pointOffset = new THREE.Vector3();
  const closest = new THREE.Vector3();
  const segments = HUMANOID_BONES.flatMap((definition) => {
    if (!definition.parent) return [];
    const start = worldTargets.get(definition.parent)!;
    const delta = worldTargets.get(definition.name)!.clone().sub(start);
    return [{ child: definition.name, parent: definition.parent, start, delta, lengthSq: delta.lengthSq() }];
  });
  let maximumWeightError = 0;
  for (let vertex = 0; vertex < position.count; vertex += 1) {
    point.fromBufferAttribute(position, vertex);
    let best: { child: string; parent: string; distance: number; t: number } | undefined;
    for (const segment of segments) {
      const t = segment.lengthSq > 1e-12
        ? THREE.MathUtils.clamp(pointOffset.copy(point).sub(segment.start).dot(segment.delta) / segment.lengthSq, 0, 1)
        : 0;
      const distance = point.distanceToSquared(closest.copy(segment.start).addScaledVector(segment.delta, t));
      if (!best || distance < best.distance) {
        best = { child: segment.child, parent: segment.parent, distance, t };
      }
    }
    if (!best) throw new Error('Humanoid skinning could not find a bone segment.');
    const parentWeight = 1 - best.t;
    const childWeight = best.t;
    const offset = vertex * 4;
    skinIndices[offset] = boneIndices.get(best.parent)!;
    skinIndices[offset + 1] = boneIndices.get(best.child)!;
    skinWeights[offset] = parentWeight;
    skinWeights[offset + 1] = childWeight;
    maximumWeightError = Math.max(maximumWeightError, Math.abs(parentWeight + childWeight - 1));
  }
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));
  const skeleton = new THREE.Skeleton(orderedBones);
  return {
    skeleton,
    rootBone: bones.get('hips')!,
    clip: createIdleClip(bones, heightMeters),
    boneCount: orderedBones.length,
    weightedVertices: position.count,
    maximumWeightError,
    maximumInfluences: 2,
  };
}
