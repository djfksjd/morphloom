import * as THREE from 'three';
import type { PoseStyle } from '../types';
import { getPoseJoints, type ReferenceJointId } from './reference-pose';

interface BoneDefinition {
  name: string;
  target: THREE.Vector3;
  parent?: string;
}

const BASE_BONES: ReadonlyArray<{ name: string; joint: ReferenceJointId; parent?: string }> = [
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
];

const FINGERS = [
  { name: 'thumb', length: 0.7, spread: -1 },
  { name: 'index', length: 0.92, spread: -0.5 },
  { name: 'middle', length: 1, spread: 0 },
  { name: 'ring', length: 0.92, spread: 0.5 },
  { name: 'little', length: 0.78, spread: 1 },
] as const;

interface HandFrame {
  wrist: THREE.Vector3;
  axis: THREE.Vector3;
  length: number;
  spreadAxis: THREE.Vector3;
  spreadHalf: number;
}

function deriveHandFrame(
  position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  heightMeters: number,
  side: 'L' | 'R',
  fallbackWrist: THREE.Vector3,
  fallbackElbow: THREE.Vector3,
): HandFrame {
  const directionSign = side === 'L' ? -1 : 1;
  const candidates: THREE.Vector3[] = [];
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const y = position.getY(index);
    if (x * directionSign <= heightMeters * 0.245 || y < heightMeters * 0.43 || y > heightMeters * 0.82) continue;
    candidates.push(new THREE.Vector3(x, y, position.getZ(index)));
  }
  if (candidates.length < 32) {
    const axis = fallbackWrist.clone().sub(fallbackElbow).normalize();
    return { wrist: fallbackWrist.clone(), axis, length: heightMeters * 0.085, spreadAxis: new THREE.Vector3(0, 0, 1), spreadHalf: heightMeters * 0.025 };
  }
  const progress = candidates.map((point) => point.x * directionSign);
  const minimum = Math.min(...progress);
  const maximum = Math.max(...progress);
  const range = Math.max(heightMeters * 0.04, maximum - minimum);
  const average = (points: THREE.Vector3[]): THREE.Vector3 => points
    .reduce((sum, point) => sum.add(point), new THREE.Vector3())
    .multiplyScalar(1 / Math.max(1, points.length));
  const wrist = average(candidates.filter((_, index) => progress[index] <= minimum + range * 0.16));
  const tip = average(candidates.filter((_, index) => progress[index] >= maximum - range * 0.06));
  const axis = tip.clone().sub(wrist);
  const length = axis.length();
  if (length < heightMeters * 0.025) axis.copy(fallbackWrist).sub(fallbackElbow);
  axis.normalize();
  const spreadAxis = new THREE.Vector3(0, 0, 1).addScaledVector(axis, -axis.z);
  if (spreadAxis.lengthSq() < 1e-8) spreadAxis.set(0, 1, 0);
  spreadAxis.normalize();
  let spreadExtent = 0;
  for (const point of candidates) spreadExtent = Math.max(spreadExtent, Math.abs(point.clone().sub(wrist).dot(spreadAxis)));
  return {
    wrist,
    axis,
    length: THREE.MathUtils.clamp(length, heightMeters * 0.055, heightMeters * 0.12),
    spreadAxis,
    spreadHalf: THREE.MathUtils.clamp(spreadExtent * 0.6, heightMeters * 0.012, heightMeters * 0.035),
  };
}

function extendedHumanoidBones(
  joints: Record<ReferenceJointId, THREE.Vector3>,
  heightMeters: number,
  position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
): BoneDefinition[] {
  const definitions: BoneDefinition[] = BASE_BONES.map((bone) => ({
    name: bone.name,
    parent: bone.parent,
    target: joints[bone.joint].clone(),
  }));
  for (const side of ['L', 'R'] as const) {
    const ankle = joints[`ankle${side}`];
    definitions.push({
      name: `toe_${side}`,
      parent: `ankle_${side}`,
      target: ankle.clone().add(new THREE.Vector3(0, -heightMeters * 0.006, heightMeters * 0.085)),
    });
    const elbow = joints[`elbow${side}`];
    const hand = deriveHandFrame(position, heightMeters, side, joints[`wrist${side}`], elbow);
    const wristDefinition = definitions.find((definition) => definition.name === `wrist_${side}`);
    if (!wristDefinition) throw new Error(`Humanoid wrist ${side} is missing.`);
    wristDefinition.target.copy(hand.wrist);
    for (const finger of FINGERS) {
      let parent = `wrist_${side}`;
      for (let segment = 1; segment <= 3; segment += 1) {
        const fraction = [0.36, 0.68, 1][segment - 1];
        const name = `${finger.name}_${String(segment).padStart(2, '0')}_${side}`;
        definitions.push({
          name,
          parent,
          target: hand.wrist.clone()
            .addScaledVector(hand.axis, hand.length * finger.length * fraction)
            .addScaledVector(hand.spreadAxis, hand.spreadHalf * finger.spread),
        });
        parent = name;
      }
    }
  }
  return definitions;
}

export interface HumanoidRigResult {
  skeleton: THREE.Skeleton;
  rootBone: THREE.Bone;
  clips: THREE.AnimationClip[];
  /** Backward-compatible primary preview clip. */
  clip: THREE.AnimationClip;
  boneCount: number;
  weightedVertices: number;
  maximumWeightError: number;
  maximumInfluences: number;
}

type EulerTriplet = readonly [number, number, number];

function quaternionTrack(
  bones: Map<string, THREE.Bone>,
  name: string,
  times: readonly number[],
  rotations: readonly EulerTriplet[],
): THREE.QuaternionKeyframeTrack {
  if (!bones.has(name)) throw new Error(`Humanoid animation anchor ${name} is missing.`);
  if (times.length !== rotations.length) throw new Error(`Humanoid animation key count mismatch for ${name}.`);
  const values: number[] = [];
  for (const [x, y, z] of rotations) {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z));
    values.push(q.x, q.y, q.z, q.w);
  }
  return new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, [...times], values);
}

function hipsPositionTrack(
  bones: Map<string, THREE.Bone>,
  heightMeters: number,
  times: readonly number[],
  offsets: ReadonlyArray<readonly [number, number, number]>,
): THREE.VectorKeyframeTrack {
  const hips = bones.get('hips');
  if (!hips) throw new Error('Humanoid animation anchor hips is missing.');
  if (times.length !== offsets.length) throw new Error('Humanoid hips animation key count mismatch.');
  const values = offsets.flatMap(([x, y, z]) => [
    hips.position.x + x * heightMeters,
    hips.position.y + y * heightMeters,
    hips.position.z + z * heightMeters,
  ]);
  return new THREE.VectorKeyframeTrack('hips.position', [...times], values);
}

function animationClip(name: string, duration: number, tracks: THREE.KeyframeTrack[]): THREE.AnimationClip {
  const clip = new THREE.AnimationClip(name, duration, tracks);
  if (!clip.validate()) throw new Error(`Generated humanoid animation clip ${name} is invalid.`);
  return clip;
}

function createAnimationSet(bones: Map<string, THREE.Bone>, heightMeters: number): THREE.AnimationClip[] {
  const rest: EulerTriplet = [0, 0, 0];
  const idleTimes = [0, 1, 2] as const;
  const idle = animationClip('morphloom_idle_preview', 2, [
    hipsPositionTrack(bones, heightMeters, idleTimes, [[0, 0, 0], [0, 0.0025, 0], [0, 0, 0]]),
    quaternionTrack(bones, 'chest', idleTimes, [rest, [0.012, 0, 0], rest]),
    quaternionTrack(bones, 'index_01_L', idleTimes, [rest, [0, 0, -0.08], rest]),
    quaternionTrack(bones, 'index_01_R', idleTimes, [rest, [0, 0, 0.08], rest]),
  ]);

  const cyclicTimes = [0, 0.25, 0.5, 0.75, 1] as const;
  const alternating = (amount: number): EulerTriplet[] => [
    [amount, 0, 0], [0, 0, 0], [-amount, 0, 0], [0, 0, 0], [amount, 0, 0],
  ];
  const alternatingOpposite = (amount: number): EulerTriplet[] => alternating(-amount);
  const bend = (amount: number): EulerTriplet[] => [
    [0, 0, 0], [amount, 0, 0], [0, 0, 0], [amount * 0.35, 0, 0], [0, 0, 0],
  ];
  const walk = animationClip('morphloom_walk_cycle', 1.2, [
    hipsPositionTrack(bones, heightMeters, cyclicTimes, [[0, 0, 0], [0, 0.008, 0], [0, 0, 0], [0, 0.008, 0], [0, 0, 0]]),
    quaternionTrack(bones, 'chest', cyclicTimes, [[0, 0.035, 0], rest, [0, -0.035, 0], rest, [0, 0.035, 0]]),
    quaternionTrack(bones, 'hip_L', cyclicTimes, alternating(0.42)),
    quaternionTrack(bones, 'hip_R', cyclicTimes, alternatingOpposite(0.42)),
    quaternionTrack(bones, 'knee_L', cyclicTimes, bend(0.62)),
    quaternionTrack(bones, 'knee_R', cyclicTimes, [rest, [0.22, 0, 0], rest, [0.62, 0, 0], rest]),
    quaternionTrack(bones, 'ankle_L', cyclicTimes, alternatingOpposite(0.15)),
    quaternionTrack(bones, 'ankle_R', cyclicTimes, alternating(0.15)),
    quaternionTrack(bones, 'shoulder_L', cyclicTimes, alternatingOpposite(0.32)),
    quaternionTrack(bones, 'shoulder_R', cyclicTimes, alternating(0.32)),
    quaternionTrack(bones, 'elbow_L', cyclicTimes, bend(0.28)),
    quaternionTrack(bones, 'elbow_R', cyclicTimes, [rest, [0.12, 0, 0], rest, [0.28, 0, 0], rest]),
  ]);

  const run = animationClip('morphloom_run_cycle', 0.8, [
    hipsPositionTrack(bones, heightMeters, cyclicTimes, [[0, 0, 0], [0, 0.018, 0.008], [0, 0.003, 0], [0, 0.018, -0.008], [0, 0, 0]]),
    quaternionTrack(bones, 'chest', cyclicTimes, [[0.1, 0.055, 0], [0.08, 0, 0], [0.1, -0.055, 0], [0.08, 0, 0], [0.1, 0.055, 0]]),
    quaternionTrack(bones, 'hip_L', cyclicTimes, alternating(0.72)),
    quaternionTrack(bones, 'hip_R', cyclicTimes, alternatingOpposite(0.72)),
    quaternionTrack(bones, 'knee_L', cyclicTimes, bend(1.02)),
    quaternionTrack(bones, 'knee_R', cyclicTimes, [rest, [0.42, 0, 0], rest, [1.02, 0, 0], rest]),
    quaternionTrack(bones, 'ankle_L', cyclicTimes, alternatingOpposite(0.28)),
    quaternionTrack(bones, 'ankle_R', cyclicTimes, alternating(0.28)),
    quaternionTrack(bones, 'shoulder_L', cyclicTimes, alternatingOpposite(0.7)),
    quaternionTrack(bones, 'shoulder_R', cyclicTimes, alternating(0.7)),
    quaternionTrack(bones, 'elbow_L', cyclicTimes, bend(0.75)),
    quaternionTrack(bones, 'elbow_R', cyclicTimes, [rest, [0.3, 0, 0], rest, [0.75, 0, 0], rest]),
  ]);

  const turnTimes = [0, 0.5, 1, 1.5, 2] as const;
  const turn = animationClip('morphloom_turn_in_place', 2, [
    quaternionTrack(bones, 'hips', turnTimes, [rest, [0, 0.28, 0], [0, 0, 0], [0, -0.28, 0], rest]),
    quaternionTrack(bones, 'chest', turnTimes, [rest, [0, 0.16, 0], [0, 0, 0], [0, -0.16, 0], rest]),
    quaternionTrack(bones, 'neck', turnTimes, [rest, [0, 0.2, 0], [0, 0, 0], [0, -0.2, 0], rest]),
    quaternionTrack(bones, 'head', turnTimes, [rest, [0, 0.3, 0], [0, 0, 0], [0, -0.3, 0], rest]),
    quaternionTrack(bones, 'shoulder_L', turnTimes, [rest, [0, -0.1, 0], rest, [0, 0.1, 0], rest]),
    quaternionTrack(bones, 'shoulder_R', turnTimes, [rest, [0, -0.1, 0], rest, [0, 0.1, 0], rest]),
  ]);

  const gestureTimes = [0, 0.35, 0.9, 1.4] as const;
  const gestureTracks: THREE.KeyframeTrack[] = [
    quaternionTrack(bones, 'shoulder_L', gestureTimes, [rest, [-0.35, 0, -0.45], [-0.35, 0, -0.45], rest]),
    quaternionTrack(bones, 'shoulder_R', gestureTimes, [rest, [-0.35, 0, 0.45], [-0.35, 0, 0.45], rest]),
    quaternionTrack(bones, 'elbow_L', gestureTimes, [rest, [0, 0, -0.72], [0, 0, -0.72], rest]),
    quaternionTrack(bones, 'elbow_R', gestureTimes, [rest, [0, 0, 0.72], [0, 0, 0.72], rest]),
    quaternionTrack(bones, 'wrist_L', gestureTimes, [rest, [0.08, 0, -0.16], [0.08, 0, -0.16], rest]),
    quaternionTrack(bones, 'wrist_R', gestureTimes, [rest, [0.08, 0, 0.16], [0.08, 0, 0.16], rest]),
  ];
  for (const side of ['L', 'R'] as const) {
    const sign = side === 'L' ? -1 : 1;
    for (const finger of FINGERS) {
      const curl = finger.name === 'index' ? 0.16 : finger.name === 'thumb' ? 0.34 : 0.68;
      gestureTracks.push(quaternionTrack(bones, `${finger.name}_01_${side}`, gestureTimes, [
        rest, [0, 0, curl * sign], [0, 0, curl * sign], rest,
      ]));
    }
  }
  const gesture = animationClip('morphloom_hand_gesture', 1.4, gestureTracks);
  return [idle, walk, run, turn, gesture];
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
  const definitions = extendedHumanoidBones(joints, heightMeters, position);
  const bones = new Map<string, THREE.Bone>();
  const worldTargets = new Map<string, THREE.Vector3>();
  for (const definition of definitions) {
    worldTargets.set(definition.name, definition.target.clone());
    const bone = new THREE.Bone();
    bone.name = definition.name;
    bones.set(definition.name, bone);
  }
  for (const definition of definitions) {
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
  const orderedBones = definitions.map((definition) => bones.get(definition.name)!);
  const boneIndices = new Map(orderedBones.map((bone, index) => [bone.name, index]));
  const skinIndices = new Uint16Array(position.count * 4);
  const skinWeights = new Float32Array(position.count * 4);
  const point = new THREE.Vector3();
  const pointOffset = new THREE.Vector3();
  const closest = new THREE.Vector3();
  const segments = definitions.flatMap((definition) => {
    if (!definition.parent) return [];
    const start = worldTargets.get(definition.parent)!;
    const delta = worldTargets.get(definition.name)!.clone().sub(start);
    const match = definition.name.match(/^(?:thumb|index|middle|ring|little)_\d{2}_([LR])$/);
    return [{
      child: definition.name,
      parent: definition.parent,
      start,
      delta,
      lengthSq: delta.lengthSq(),
      fingerSide: match?.[1] as 'L' | 'R' | undefined,
    }];
  });
  const handGates = new Map((['L', 'R'] as const).map((side) => {
    const wrist = worldTargets.get(`wrist_${side}`)!;
    const tip = worldTargets.get(`middle_03_${side}`)!;
    const axis = tip.clone().sub(wrist);
    const length = Math.max(heightMeters * 0.04, axis.length());
    axis.normalize();
    return [side, { wrist, axis, length }] as const;
  }));
  let maximumWeightError = 0;
  for (let vertex = 0; vertex < position.count; vertex += 1) {
    point.fromBufferAttribute(position, vertex);
    let best: { child: string; parent: string; distance: number; t: number } | undefined;
    for (const segment of segments) {
      if (segment.fingerSide) {
        const hand = handGates.get(segment.fingerSide)!;
        const offsetFromWrist = pointOffset.copy(point).sub(hand.wrist);
        const progress = offsetFromWrist.dot(hand.axis);
        const radialDistanceSq = offsetFromWrist.lengthSq() - progress ** 2;
        if (progress < -hand.length * 0.2 || progress > hand.length * 1.35
          || radialDistanceSq > (hand.length * 0.78) ** 2) continue;
      }
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
  const clips = createAnimationSet(bones, heightMeters);
  return {
    skeleton,
    rootBone: bones.get('hips')!,
    clips,
    clip: clips[0],
    boneCount: orderedBones.length,
    weightedVertices: position.count,
    maximumWeightError,
    maximumInfluences: 2,
  };
}
