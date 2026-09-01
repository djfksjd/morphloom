import * as THREE from 'three';
import type { HandGesture, PoseStyle } from '../types';

export type ReferenceJointId =
  | 'hips' | 'spine' | 'chest' | 'neck' | 'head'
  | 'shoulderL' | 'elbowL' | 'wristL'
  | 'shoulderR' | 'elbowR' | 'wristR'
  | 'hipL' | 'kneeL' | 'ankleL'
  | 'hipR' | 'kneeR' | 'ankleR';

export interface ReferencePoseIR {
  id: string;
  sourceView: 'front-three-quarter';
  sourcePixels: readonly [number, number];
  measuredLandmarks: Readonly<Record<ReferenceJointId, readonly [number, number]>>;
  inferredDepth: Readonly<Record<ReferenceJointId, number>>;
  detail: string;
}

export interface CharacterVisualInterpretation {
  id: string;
  source: 'agent-visual-judgment';
  subjectContext: string;
  anatomicalScreenMapping: {
    anatomicalRight: 'viewer-left';
    anatomicalLeft: 'viewer-right';
  };
  observations: ReadonlyArray<{
    id: string;
    label: string;
    evidence: 'visible' | 'inferred';
    confidence: number;
  }>;
}

/**
 * Semantic reading of the supplied photograph. This is deliberately stored
 * separately from pixel landmarks: it preserves what an image-capable agent
 * judged, how certain that judgment was, and which values came from hidden
 * single-view depth rather than direct image evidence.
 */
export const WEB_HERO_VISUAL_INTERPRETATION: CharacterVisualInterpretation = {
  id: 'web_hero_cosplay_semantics_v1',
  source: 'agent-visual-judgment',
  subjectContext: 'ordinary-person-in-web-hero-cosplay',
  anatomicalScreenMapping: {
    anatomicalRight: 'viewer-left',
    anatomicalLeft: 'viewer-right',
  },
  observations: [
    { id: 'body_silhouette', label: '슬림하지만 운동선수형이 아닌 일반인 체형', evidence: 'visible', confidence: 0.9 },
    { id: 'abdomen_projection', label: '복부가 살짝 앞으로 나온 슬림 소프트 체형', evidence: 'visible', confidence: 0.86 },
    { id: 'chest_softness', label: '가슴에 약한 연조직 볼륨', evidence: 'visible', confidence: 0.73 },
    { id: 'small_glutes', label: '둔부 볼륨이 작음', evidence: 'visible', confidence: 0.68 },
    { id: 'forward_head', label: '목과 머리가 약간 앞으로 나온 자세', evidence: 'visible', confidence: 0.82 },
    { id: 'rear_balance', label: '무게중심이 뒤쪽 지지 다리에 치우침', evidence: 'inferred', confidence: 0.78 },
    { id: 'front_right_leg', label: '해부학적 오른발(화면 왼쪽)이 앞으로 뻗음', evidence: 'visible', confidence: 0.96 },
    { id: 'bent_left_leg', label: '해부학적 왼발(화면 오른쪽)이 뒤에서 굽혀짐', evidence: 'visible', confidence: 0.96 },
    { id: 'web_shooting_hands', label: '양손은 거미줄을 쏘는 손가락 모양', evidence: 'visible', confidence: 0.89 },
    { id: 'right_hand_lead', label: '해부학적 오른손(화면 왼쪽)이 더 앞이고 조금 높음', evidence: 'inferred', confidence: 0.76 },
  ],
};

/**
 * Landmarks digitised from the supplied 960 × 1280 cosplay photograph.
 * X/Y are measured image pixels. Depth is necessarily inferred from one view
 * and is stored separately so the CharacterIR does not present it as measured.
 */
export const WEB_HERO_REFERENCE_POSE: ReferencePoseIR = {
  id: 'web_hero_cosplay_front_3q_v2',
  sourceView: 'front-three-quarter',
  sourcePixels: [960, 1280],
  measuredLandmarks: {
    hips: [476, 803], spine: [472, 644], chest: [467, 520], neck: [458, 433], head: [456, 342],
    shoulderL: [354, 478], elbowL: [291, 605], wristL: [223, 672],
    shoulderR: [561, 501], elbowR: [632, 607], wristR: [711, 681],
    hipL: [420, 794], kneeL: [360, 1015], ankleL: [336, 1212],
    hipR: [528, 807], kneeR: [554, 1002], ankleR: [479, 1092],
  },
  inferredDepth: {
    hips: 0, spine: 0.018, chest: 0.035, neck: 0.042, head: 0.052,
    shoulderL: 0.03, elbowL: 0.16, wristL: 0.54,
    shoulderR: 0.025, elbowR: 0.15, wristR: 0.52,
    hipL: 0.025, kneeL: 0.13, ankleL: 0.19,
    hipR: -0.015, kneeR: -0.085, ankleR: -0.13,
  },
  detail: '2D joint centres measured from the reference; Z depth, occluded rotations, and hand articulation inferred.',
};

const JOINT_ORDER: readonly ReferenceJointId[] = [
  'hips', 'spine', 'chest', 'neck', 'head',
  'shoulderL', 'elbowL', 'wristL', 'shoulderR', 'elbowR', 'wristR',
  'hipL', 'kneeL', 'ankleL', 'hipR', 'kneeR', 'ankleR',
];

function restJoints(height: number): Record<ReferenceJointId, THREE.Vector3> {
  const h = height;
  return {
    hips: new THREE.Vector3(0, h * 0.515, 0),
    spine: new THREE.Vector3(0, h * 0.665, 0),
    chest: new THREE.Vector3(0, h * 0.765, 0),
    neck: new THREE.Vector3(0, h * 0.835, 0),
    head: new THREE.Vector3(0, h * 0.925, 0),
    shoulderL: new THREE.Vector3(-h * 0.145, h * 0.775, 0),
    elbowL: new THREE.Vector3(-h * 0.245, h * 0.655, 0),
    wristL: new THREE.Vector3(-h * 0.315, h * 0.545, 0),
    shoulderR: new THREE.Vector3(h * 0.145, h * 0.775, 0),
    elbowR: new THREE.Vector3(h * 0.245, h * 0.655, 0),
    wristR: new THREE.Vector3(h * 0.315, h * 0.545, 0),
    hipL: new THREE.Vector3(-h * 0.082, h * 0.505, 0),
    kneeL: new THREE.Vector3(-h * 0.088, h * 0.275, 0),
    ankleL: new THREE.Vector3(-h * 0.088, h * 0.055, 0),
    hipR: new THREE.Vector3(h * 0.082, h * 0.505, 0),
    kneeR: new THREE.Vector3(h * 0.088, h * 0.275, 0),
    ankleR: new THREE.Vector3(h * 0.088, h * 0.055, 0),
  };
}

function targetJoints(height: number): Record<ReferenceJointId, THREE.Vector3> {
  const h = height;
  return {
    hips: new THREE.Vector3(0, h * 0.515, 0),
    spine: new THREE.Vector3(-h * 0.008, h * 0.665, h * 0.04),
    chest: new THREE.Vector3(-h * 0.014, h * 0.765, h * 0.1),
    neck: new THREE.Vector3(-h * 0.025, h * 0.835, h * 0.14),
    head: new THREE.Vector3(-h * 0.027, h * 0.925, h * 0.16),
    shoulderL: new THREE.Vector3(-h * 0.157, h * 0.778, h * 0.08),
    elbowL: new THREE.Vector3(-h * 0.245, h * 0.665, h * 0.22),
    wristL: new THREE.Vector3(-h * 0.32, h * 0.605, h * 0.54),
    shoulderR: new THREE.Vector3(h * 0.145, h * 0.765, h * 0.075),
    elbowR: new THREE.Vector3(h * 0.255, h * 0.655, h * 0.21),
    wristR: new THREE.Vector3(h * 0.342, h * 0.595, h * 0.52),
    hipL: new THREE.Vector3(-h * 0.082, h * 0.505, h * 0.025),
    kneeL: new THREE.Vector3(-h * 0.105, h * 0.285, h * 0.13),
    ankleL: new THREE.Vector3(-h * 0.115, h * 0.052, h * 0.19),
    hipR: new THREE.Vector3(h * 0.082, h * 0.505, -h * 0.015),
    kneeR: new THREE.Vector3(h * 0.038, h * 0.315, -h * 0.085),
    ankleR: new THREE.Vector3(h * 0.055, h * 0.055, -h * 0.13),
  };
}

export function getPoseJoints(height: number, pose: PoseStyle): Record<ReferenceJointId, THREE.Vector3> {
  if (!Number.isFinite(height) || height <= 0) throw new Error('Character height must be a finite positive number.');
  return pose === 'reference-action' ? targetJoints(height) : restJoints(height);
}

function clamp01(value: number): number {
  return THREE.MathUtils.clamp(value, 0, 1);
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp01((value - edge0) / Math.max(0.000_001, edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function closestPointParameter(point: THREE.Vector3, start: THREE.Vector3, end: THREE.Vector3): number {
  const segment = end.clone().sub(start);
  const lengthSquared = segment.lengthSq();
  if (lengthSquared <= 1e-10) return 0;
  return clamp01(point.clone().sub(start).dot(segment) / lengthSquared);
}

function segmentDistance(point: THREE.Vector3, start: THREE.Vector3, end: THREE.Vector3): number {
  const t = closestPointParameter(point, start, end);
  return point.distanceTo(start.clone().lerp(end, t));
}

function transformByBone(
  point: THREE.Vector3,
  restStart: THREE.Vector3,
  restEnd: THREE.Vector3,
  targetStart: THREE.Vector3,
  targetEnd: THREE.Vector3,
): THREE.Vector3 {
  const restVector = restEnd.clone().sub(restStart);
  const targetVector = targetEnd.clone().sub(targetStart);
  const restLength = restVector.length();
  const targetLength = targetVector.length();
  if (restLength <= 1e-6 || targetLength <= 1e-6) return point.clone();

  const restDirection = restVector.multiplyScalar(1 / restLength);
  const targetDirection = targetVector.multiplyScalar(1 / targetLength);
  const rotation = new THREE.Quaternion().setFromUnitVectors(restDirection, targetDirection);
  const relative = point.clone().sub(restStart);
  const along = relative.dot(restDirection);
  const radial = relative.addScaledVector(restDirection, -along).applyQuaternion(rotation);
  return targetStart.clone()
    .addScaledVector(targetDirection, along * (targetLength / restLength))
    .add(radial);
}

function blendBonePair(
  point: THREE.Vector3,
  rest: Record<ReferenceJointId, THREE.Vector3>,
  target: Record<ReferenceJointId, THREE.Vector3>,
  first: readonly [ReferenceJointId, ReferenceJointId],
  second: readonly [ReferenceJointId, ReferenceJointId],
): THREE.Vector3 {
  const firstDistance = segmentDistance(point, rest[first[0]], rest[first[1]]);
  const secondDistance = segmentDistance(point, rest[second[0]], rest[second[1]]);
  const total = Math.max(firstDistance + secondDistance, 1e-6);
  const firstWeight = clamp01(secondDistance / total);
  const firstPoint = transformByBone(point, rest[first[0]], rest[first[1]], target[first[0]], target[first[1]]);
  const secondPoint = transformByBone(point, rest[second[0]], rest[second[1]], target[second[0]], target[second[1]]);
  return secondPoint.lerp(firstPoint, firstWeight);
}

/**
 * Topology-preserving landmark skinning for the single supplied action view.
 * The method is deterministic and dependency-free; it does not hide the fact
 * that depth and occluded rotations are inferred from one photograph.
 */
export function deformPointByReferencePose(
  source: THREE.Vector3,
  height: number,
  pose: PoseStyle,
  handGesture: HandGesture = 'relaxed',
): THREE.Vector3 {
  if (pose !== 'reference-action') return source.clone();
  const rest = restJoints(height);
  const target = targetJoints(height);
  const x = source.x;
  const y01 = source.y / height;
  const absX = Math.abs(x);
  const side = x < 0 ? 'L' : 'R';

  const torsoCore = y01 >= 0.515
    ? blendBonePair(source, rest, target, ['hips', 'chest'], ['chest', 'neck'])
    : transformByBone(source, rest.hips, rest.spine, target.hips, target.spine);
  const head = transformByBone(source, rest.neck, rest.head, target.neck, target.head);
  const torso = torsoCore.lerp(head, smoothstep(0.815, 0.885, y01));

  if (y01 > 0.43 && y01 < 0.825 && absX > height * 0.085) {
    const arm = blendBonePair(
      source,
      rest,
      target,
      [`shoulder${side}`, `elbow${side}`],
      [`elbow${side}`, `wrist${side}`],
    );
    const handWeight = smoothstep(height * 0.285, height * 0.35, absX);
    if (handWeight > 0 && handGesture === 'web-shooting') {
      const wrist = target[`wrist${side}`];
      const handRotation = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 0, 1),
        side === 'L' ? -0.52 * handWeight : 0.43 * handWeight,
      );
      const relative = arm.clone().sub(wrist).applyQuaternion(handRotation).multiplyScalar(1 + handWeight * 0.34);
      arm.copy(wrist).add(relative);
    }
    const armWeight = smoothstep(height * 0.085, height * 0.155, absX)
      * smoothstep(0.43, 0.515, y01)
      * (1 - smoothstep(0.79, 0.825, y01));
    return torso.lerp(arm, armWeight);
  }

  if (y01 < 0.56) {
    const leg = blendBonePair(
      source,
      rest,
      target,
      [`hip${side}`, `knee${side}`],
      [`knee${side}`, `ankle${side}`],
    );
    const legWeight = (1 - smoothstep(0.515, 0.56, y01))
      * smoothstep(height * 0.022, height * 0.085, absX);
    return torso.lerp(leg, legWeight);
  }

  return torso;
}

export function poseLandmarkRms(height: number, pose: PoseStyle): number {
  if (pose !== 'reference-action') return 0;
  const rest = restJoints(height);
  const target = targetJoints(height);
  let sum = 0;
  for (const id of JOINT_ORDER) {
    const actual = deformPointByReferencePose(rest[id], height, pose);
    sum += actual.distanceToSquared(target[id]);
  }
  return Math.sqrt(sum / JOINT_ORDER.length);
}
