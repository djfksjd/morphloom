import * as THREE from 'three';
import type { AssemblyGeometryIR, AssemblyIR } from './assembly-ir';
import { snapshotScene } from './delivery-validation';
import { inspectSurfaceSystem } from './surface-system';
import { analyzeTopology, type MeshTopologyReport } from './topology';
import { HUMANOID_RUNTIME_CLIP_NAMES, humanoidAnimationDelivery } from './humanoid-rig';

export type ProductionDomain =
  | 'architecture'
  | 'industrial-design'
  | 'animation'
  | 'game'
  | '3d-print';

const REQUIRED_RUNTIME_CLIPS = HUMANOID_RUNTIME_CLIP_NAMES;

export interface DomainReadinessInput {
  domain: ProductionDomain;
  root: THREE.Object3D;
  evidenceScore: number;
  deterministic: boolean;
  browserGlbRoundTrip: boolean;
  topology?: MeshTopologyReport;
  /** Millimetres represented by one authored source unit; AssemblyIR is 1 mm. */
  sourceUnitMm?: number;
  triangleBudget?: number;
}

export interface DomainReadinessCheck {
  id: string;
  label: string;
  pass: boolean;
  blocking: boolean;
  score: number;
  detail: string;
}

export interface DomainReadinessReport {
  domain: ProductionDomain;
  pass: boolean;
  score: number;
  checks: DomainReadinessCheck[];
  blockers: string[];
  warnings: string[];
  metrics: {
    meshes: number;
    triangles: number;
    namedMeshCoverage: number;
    uvMeshCoverage: number;
    normalMeshCoverage: number;
    pbrSurfaceCoverage: number;
    skeletons: number;
    bones: number;
    animationClips: number;
    animationTracks: number;
    animationSetCoverage: number;
    animationBindingCoverage: number;
    animationMotionCoverage: number;
    animationLoopClosureCoverage: number;
    animationInPlaceCoverage: number;
    maximumAnimationQuaternionError: number;
    bindPoseRmsErrorMm?: number;
    deformationMovedVertices: number;
    deformationMaximumMm: number;
    deformationFinite: boolean;
    gameLods: number;
    collisionPrimitives: number;
    fingerBones: number;
    fingerWeightedVertices: number;
    fingerAnimationTracks: number;
    maximumSkinWeightError: number;
    maximumSkinInfluences: number;
    minimumMeshAxisMm?: number;
    declaredMinimumFeatureMm?: number;
    enclosedVolumeMm3?: number;
    unsupportedOverhangAreaMm2: number;
    unsupportedOverhangRatio: number;
  };
}

function inspectAnimationDelivery(root: THREE.Object3D): {
  bindingCoverage: number;
  motionCoverage: number;
  loopClosureCoverage: number;
  inPlaceCoverage: number;
  maximumQuaternionError: number;
} {
  const boneNames = new Set<string>();
  root.traverse((object) => {
    if (object instanceof THREE.Bone) boneNames.add(object.name);
    if (object instanceof THREE.SkinnedMesh) object.skeleton.bones.forEach((bone) => boneNames.add(bone.name));
  });
  let tracks = 0;
  let boundTracks = 0;
  let movingTracks = 0;
  let loopTracks = 0;
  let closedLoopTracks = 0;
  let inPlaceClips = 0;
  let validInPlaceClips = 0;
  let maximumQuaternionError = 0;
  for (const clip of root.animations) {
    const delivery = humanoidAnimationDelivery(clip.name);
    let clipInPlace = true;
    if (delivery?.rootMotion === 'in-place') inPlaceClips += 1;
    for (const track of clip.tracks) {
      tracks += 1;
      const binding = track.name.split('.')[0];
      if (boneNames.has(binding)) boundTracks += 1;
      const stride = track.getValueSize();
      const first = Array.from(track.values.slice(0, stride));
      const last = Array.from(track.values.slice(track.values.length - stride));
      const moving = Array.from({ length: track.times.length }, (_, key) => (
        Array.from(track.values.slice(key * stride, key * stride + stride))
      )).some((sample) => sample.some((value, index) => Math.abs(value - first[index]!) > 1e-7));
      if (moving && Array.from(track.values).every(Number.isFinite)
        && Array.from(track.times).every(Number.isFinite)) movingTracks += 1;
      if (delivery?.loop) {
        loopTracks += 1;
        if (first.every((value, index) => Math.abs(value - last[index]!) <= 1e-6)) closedLoopTracks += 1;
      }
      if (track.name.endsWith('.quaternion') && stride === 4) {
        for (let key = 0; key < track.times.length; key += 1) {
          const offset = key * 4;
          maximumQuaternionError = Math.max(maximumQuaternionError, Math.abs(Math.hypot(
            track.values[offset]!, track.values[offset + 1]!, track.values[offset + 2]!, track.values[offset + 3]!,
          ) - 1));
        }
      }
      if (delivery?.rootMotion === 'in-place' && track.name === 'hips.position' && stride === 3) {
        if (Math.hypot(last[0]! - first[0]!, last[2]! - first[2]!) > 0.001) clipInPlace = false;
      }
    }
    if (delivery?.rootMotion === 'in-place' && clipInPlace) validInPlaceClips += 1;
  }
  return {
    bindingCoverage: boundTracks / Math.max(1, tracks),
    motionCoverage: movingTracks / Math.max(1, tracks),
    loopClosureCoverage: closedLoopTracks / Math.max(1, loopTracks),
    inPlaceCoverage: validInPlaceClips / Math.max(1, inPlaceClips),
    maximumQuaternionError,
  };
}

function declaredGeometryFeatureMm(geometry: AssemblyGeometryIR): number | undefined {
  switch (geometry.op) {
    case 'roundedBox': return Math.min(...geometry.size);
    case 'cylinder': return Math.min(geometry.radiusTop * 2, geometry.radiusBottom * 2, geometry.depth);
    case 'sphere': return geometry.radius * 2;
    case 'torus': return geometry.tube * 2;
    case 'extrude': return geometry.depth;
    case 'lathe': return geometry.profile.length > 0
      ? Math.min(...geometry.profile.flatMap(([radius, height]) => [Math.abs(radius) * 2, Math.abs(height)]).filter((value) => value > 0))
      : undefined;
    case 'tube': return geometry.radius * 2;
    case 'surfacePatch': return Math.max(0, geometry.baseThickness - geometry.macroAmplitude - geometry.aggregateAmplitude);
    case 'hipRoof': return geometry.thickness;
    case 'bladeLoft': return Math.min(geometry.thickness, geometry.apexThickness);
    case 'visualHull': return undefined;
  }
}

function inspectDeclaredMinimumFeature(root: THREE.Object3D): number | undefined {
  const ir = root.userData.assemblyIR as AssemblyIR | undefined;
  if (!ir || ir.units !== 'mm') return undefined;
  const features = ir.components
    .map((component) => declaredGeometryFeatureMm(component.geometry))
    .filter((value): value is number => value !== undefined && Number.isFinite(value) && value > 0);
  return features.length > 0 ? Math.min(...features) : undefined;
}

function clampedScore(value: number): number {
  return Math.round(THREE.MathUtils.clamp(value, 0, 100));
}

function inspectGeometry(root: THREE.Object3D): {
  uvMeshes: number;
  normalMeshes: number;
  maximumSkinWeightError: number;
  maximumSkinInfluences: number;
  minimumMeshAxisMm?: number;
  enclosedVolumeMm3: number;
  unsupportedOverhangAreaMm2: number;
  unsupportedOverhangRatio: number;
  fingerBones: number;
  fingerWeightedVertices: number;
  fingerAnimationTracks: number;
} {
  let meshes = 0;
  let uvMeshes = 0;
  let normalMeshes = 0;
  let maximumSkinWeightError = 0;
  let maximumSkinInfluences = 0;
  let minimumMeshAxisMm = Number.POSITIVE_INFINITY;
  let enclosedVolumeM3 = 0;
  let totalSurfaceAreaM2 = 0;
  let unsupportedOverhangAreaM2 = 0;
  const fingerBoneNames = new Set<string>();
  let fingerWeightedVertices = 0;
  const fingerPattern = /^(thumb|index|middle|ring|little)_\d{2}_[LR]$/;
  const bounds = new THREE.Box3().setFromObject(root);
  const buildPlateToleranceM = 0.0002;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const cross = new THREE.Vector3();
  const edgeA = new THREE.Vector3();
  const edgeB = new THREE.Vector3();
  const faceNormal = new THREE.Vector3();
  root.updateMatrixWorld(true);
  root.traverseVisible((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    meshes += 1;
    const geometry = object.geometry;
    const position = geometry.getAttribute('position');
    if (!position) return;
    if (geometry.hasAttribute('uv')) uvMeshes += 1;
    if (geometry.hasAttribute('normal')) normalMeshes += 1;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    if (geometry.boundingBox) {
      const size = geometry.boundingBox.clone().applyMatrix4(object.matrixWorld).getSize(new THREE.Vector3());
      for (const axis of [size.x, size.y, size.z]) {
        if (axis > 1e-7) minimumMeshAxisMm = Math.min(minimumMeshAxisMm, axis * 1000);
      }
    }
    if (object instanceof THREE.SkinnedMesh) {
      const weights = geometry.getAttribute('skinWeight');
      const indices = geometry.getAttribute('skinIndex');
      const fingerIndices = new Set<number>();
      object.skeleton.bones.forEach((bone, index) => {
        if (!fingerPattern.test(bone.name)) return;
        fingerBoneNames.add(bone.name);
        fingerIndices.add(index);
      });
      if (weights && indices && weights.itemSize === 4 && indices.itemSize === 4) {
        for (let vertex = 0; vertex < weights.count; vertex += 1) {
          let sum = 0;
          let influences = 0;
          let fingerWeighted = false;
          for (let slot = 0; slot < 4; slot += 1) {
            const weight = weights.getComponent(vertex, slot);
            if (weight > 1e-6) influences += 1;
            if (weight > 1e-3 && fingerIndices.has(indices.getComponent(vertex, slot))) fingerWeighted = true;
            sum += weight;
          }
          if (fingerWeighted) fingerWeightedVertices += 1;
          maximumSkinWeightError = Math.max(maximumSkinWeightError, Math.abs(sum - 1));
          maximumSkinInfluences = Math.max(maximumSkinInfluences, influences);
        }
      } else {
        maximumSkinWeightError = Number.POSITIVE_INFINITY;
        maximumSkinInfluences = Number.POSITIVE_INFINITY;
      }
    }
    const index = geometry.getIndex();
    const triangleCount = index ? index.count / 3 : position.count / 3;
    for (let triangle = 0; triangle < triangleCount; triangle += 1) {
      const ia = index ? index.getX(triangle * 3) : triangle * 3;
      const ib = index ? index.getX(triangle * 3 + 1) : triangle * 3 + 1;
      const ic = index ? index.getX(triangle * 3 + 2) : triangle * 3 + 2;
      a.fromBufferAttribute(position, ia).applyMatrix4(object.matrixWorld);
      b.fromBufferAttribute(position, ib).applyMatrix4(object.matrixWorld);
      c.fromBufferAttribute(position, ic).applyMatrix4(object.matrixWorld);
      enclosedVolumeM3 += a.dot(cross.crossVectors(b, c)) / 6;
      faceNormal.crossVectors(edgeA.copy(b).sub(a), edgeB.copy(c).sub(a));
      const doubledArea = faceNormal.length();
      if (doubledArea > 1e-14) {
        const area = doubledArea * 0.5;
        totalSurfaceAreaM2 += area;
        const centroidY = (a.y + b.y + c.y) / 3;
        const normalY = faceNormal.y / doubledArea;
        if (normalY < -Math.SQRT1_2 && centroidY > bounds.min.y + buildPlateToleranceM) {
          unsupportedOverhangAreaM2 += area;
        }
      }
    }
  });
  return {
    uvMeshes,
    normalMeshes,
    maximumSkinWeightError,
    maximumSkinInfluences,
    minimumMeshAxisMm: Number.isFinite(minimumMeshAxisMm) ? minimumMeshAxisMm : undefined,
    enclosedVolumeMm3: Math.abs(enclosedVolumeM3) * 1e9,
    unsupportedOverhangAreaMm2: unsupportedOverhangAreaM2 * 1e6,
    unsupportedOverhangRatio: totalSurfaceAreaM2 > 0 ? unsupportedOverhangAreaM2 / totalSurfaceAreaM2 : 0,
    fingerBones: fingerBoneNames.size,
    fingerWeightedVertices,
    fingerAnimationTracks: root.animations.reduce((sum, clip) => (
      sum + clip.tracks.filter((track) => fingerPattern.test(track.name.split('.')[0])).length
    ), 0),
  };
}

function inspectSkinDeformation(root: THREE.Object3D): {
  bindPoseRmsErrorMm?: number;
  movedVertices: number;
  maximumMm: number;
  finite: boolean;
} {
  let squaredError = 0;
  let samples = 0;
  let movedVertices = 0;
  let maximumMm = 0;
  let finite = true;
  const source = new THREE.Vector3();
  const transformed = new THREE.Vector3();
  root.updateMatrixWorld(true);
  root.traverseVisible((object) => {
    if (!(object instanceof THREE.SkinnedMesh)) return;
    const position = object.geometry.getAttribute('position');
    const elbow = object.skeleton.bones.find((bone) => bone.name === 'elbow_L');
    if (!position || !elbow) {
      finite = false;
      return;
    }
    object.skeleton.update();
    const stride = Math.max(1, Math.floor(position.count / 2_048));
    for (let index = 0; index < position.count; index += stride) {
      source.fromBufferAttribute(position, index);
      transformed.copy(source);
      object.applyBoneTransform(index, transformed);
      const error = transformed.distanceTo(source);
      squaredError += error * error;
      samples += 1;
      finite = finite && Number.isFinite(transformed.x) && Number.isFinite(transformed.y) && Number.isFinite(transformed.z);
    }
    const originalRotation = elbow.quaternion.clone();
    try {
      elbow.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0.18)));
      root.updateMatrixWorld(true);
      object.skeleton.update();
      for (let index = 0; index < position.count; index += stride) {
        source.fromBufferAttribute(position, index);
        transformed.copy(source);
        object.applyBoneTransform(index, transformed);
        const movementMm = transformed.distanceTo(source) * 1_000;
        if (movementMm > 0.1) movedVertices += 1;
        maximumMm = Math.max(maximumMm, movementMm);
        finite = finite && Number.isFinite(transformed.x) && Number.isFinite(transformed.y) && Number.isFinite(transformed.z);
      }
    } finally {
      elbow.quaternion.copy(originalRotation);
      root.updateMatrixWorld(true);
      object.skeleton.update();
    }
  });
  return {
    bindPoseRmsErrorMm: samples > 0 ? Math.sqrt(squaredError / samples) * 1_000 : undefined,
    movedVertices,
    maximumMm,
    finite,
  };
}

/**
 * Cross-domain delivery audit. It intentionally checks different contracts per
 * destination instead of turning one generic score into a universal quality claim.
 */
export function auditDomainReadiness(input: DomainReadinessInput): DomainReadinessReport {
  if (!Number.isFinite(input.evidenceScore) || input.evidenceScore < 0 || input.evidenceScore > 100) {
    throw new Error('Domain evidence score must be between 0 and 100.');
  }
  const snapshot = snapshotScene(input.root);
  const topology = input.topology ?? analyzeTopology(input.root);
  const skinnedTopology = input.domain === 'animation'
    ? analyzeTopology(input.root, { onlyVisible: true, meshFilter: (mesh) => mesh instanceof THREE.SkinnedMesh })
    : undefined;
  const surfaces = inspectSurfaceSystem(input.root);
  const geometry = inspectGeometry(input.root);
  const deformation = inspectSkinDeformation(input.root);
  const animationDelivery = inspectAnimationDelivery(input.root);
  const declaredMinimumFeatureMm = inspectDeclaredMinimumFeature(input.root);
  const deliveredClipNames = new Set(snapshot.animationClipNames);
  const animationSetCoverage = REQUIRED_RUNTIME_CLIPS.filter((name) => deliveredClipNames.has(name)).length
    / REQUIRED_RUNTIME_CLIPS.length;
  const namedMeshCoverage = snapshot.meshes > 0 ? snapshot.namedMeshes / snapshot.meshes : 0;
  const uvMeshCoverage = snapshot.meshes > 0 ? geometry.uvMeshes / snapshot.meshes : 0;
  const normalMeshCoverage = snapshot.meshes > 0 ? geometry.normalMeshes / snapshot.meshes : 0;
  const pbrSurfaceCoverage = surfaces.authoredMaterials > 0
    ? surfaces.microNormalMaterials / surfaces.authoredMaterials
    : 0;
  const checks: DomainReadinessCheck[] = [];
  const add = (id: string, label: string, pass: boolean, score: number, detail: string, blocking = true): void => {
    checks.push({ id, label, pass, score: clampedScore(score), detail, blocking });
  };

  add('determinism', '동일 입력 재현성', input.deterministic, input.deterministic ? 100 : 0, input.deterministic ? '구조 fingerprint 일치' : '동일 입력 결과가 달라짐');
  add('finite-scene', '유한 장면 데이터', snapshot.finiteTransforms, snapshot.finiteTransforms ? 100 : 0, snapshot.finiteTransforms ? '모든 변환값이 유한함' : 'NaN/Infinity 변환 발견');
  add('named-parts', '이름 있는 편집 단위', namedMeshCoverage === 1, namedMeshCoverage * 100, `${snapshot.namedMeshes}/${snapshot.meshes} 메시 명명`);
  add('glb-roundtrip', '실제 GLB 재열기', input.browserGlbRoundTrip, input.browserGlbRoundTrip ? 100 : 0, input.browserGlbRoundTrip ? '브라우저 GLTFLoader 재열기 통과' : '동일 입력 브라우저 증명 없음');

  if (input.domain === 'architecture') {
    const ir = input.root.userData.assemblyIR as { metadata?: { planFootprintVerified?: boolean; assetKind?: string } } | undefined;
    add('architecture-topology', '건축 셸 토폴로지', topology.pass, topology.pass ? 100 : 0, `${topology.watertightMeshes}/${topology.meshes} 폐쇄형`);
    add('architecture-plan', '도면 외곽 검증', ir?.metadata?.planFootprintVerified === true, ir?.metadata?.planFootprintVerified ? 100 : 0, ir?.metadata?.planFootprintVerified ? '검증된 평면 외곽' : '평면 외곽 근거 없음');
    add('architecture-evidence', '실측·도면 근거', input.evidenceScore >= 85, input.evidenceScore, `${input.evidenceScore}/85`);
    add('architecture-surface', '건축 마감 표면', pbrSurfaceCoverage >= 0.8, pbrSurfaceCoverage * 100, `${Math.round(pbrSurfaceCoverage * 100)}% micro-normal (최소 80%)`);
  } else if (input.domain === 'industrial-design') {
    add('design-topology', '제품 토폴로지', topology.pass, topology.pass ? 100 : 0, `경계 ${topology.boundaryEdges} · 비매니폴드 ${topology.nonManifoldEdges}`);
    add('design-evidence', '제품 근거', input.evidenceScore >= 80, input.evidenceScore, `${input.evidenceScore}/80`);
    add('design-uv', '제품 UV', uvMeshCoverage >= 0.95, uvMeshCoverage * 100, `${Math.round(uvMeshCoverage * 100)}% 메시 UV`);
    add('design-surface', '제품 PBR 미세표면', pbrSurfaceCoverage >= 0.75, pbrSurfaceCoverage * 100, `${Math.round(pbrSurfaceCoverage * 100)}% micro-normal`);
  } else if (input.domain === 'animation') {
    const bodyTopologyPass = skinnedTopology?.pass === true;
    add('animation-topology', '변형 가능한 폐쇄형 바디', bodyTopologyPass, bodyTopologyPass ? 100 : 0, `${skinnedTopology?.watertightMeshes ?? 0}/${skinnedTopology?.meshes ?? 0} 스킨 메시 폐쇄형`);
    add('animation-skeleton', '실제 스켈레톤', snapshot.skeletons >= 1 && snapshot.bones >= 45, Math.min(100, snapshot.bones / 45 * 100), `${snapshot.skeletons} skeleton · ${snapshot.bones} bones`);
    add('animation-weights', '정규화 스킨 웨이트', geometry.maximumSkinWeightError <= 1e-5 && geometry.maximumSkinInfluences <= 4, geometry.maximumSkinWeightError <= 1e-5 ? 100 : 0, `오차 ${geometry.maximumSkinWeightError.toExponential(2)} · 최대 ${geometry.maximumSkinInfluences} influences`);
    const bindPoseRmsErrorMm = deformation.bindPoseRmsErrorMm ?? Number.POSITIVE_INFINITY;
    const deformationPass = deformation.finite && bindPoseRmsErrorMm <= 0.01
      && deformation.movedVertices > 0 && deformation.maximumMm > 1 && deformation.maximumMm < 500;
    add('animation-deformation', '실제 뼈 변형 검증', deformationPass, deformationPass ? 100 : 0, `bind RMS ${Number.isFinite(bindPoseRmsErrorMm) ? bindPoseRmsErrorMm.toFixed(4) : '없음'} mm · 이동 표본 ${deformation.movedVertices} · 최대 ${deformation.maximumMm.toFixed(1)} mm`);
    const fingerRigPass = geometry.fingerBones >= 30 && geometry.fingerWeightedVertices > 0 && geometry.fingerAnimationTracks >= 16;
    add('animation-finger-rig', '손가락 리그·가중치', fingerRigPass, fingerRigPass ? 100 : 0, `${geometry.fingerBones} finger bones · ${geometry.fingerWeightedVertices} weighted vertices · ${geometry.fingerAnimationTracks} animated tracks`);
    const animationSetPass = snapshot.animationClips >= REQUIRED_RUNTIME_CLIPS.length
      && snapshot.animationTracks >= 180 && animationSetCoverage === 1;
    add('animation-clips', '납품용 기본 동작 세트', animationSetPass, animationSetPass ? 100 : animationSetCoverage * 100, `${snapshot.animationClips} clips · ${snapshot.animationTracks} tracks · 필수 동작 ${Math.round(animationSetCoverage * 100)}%`);
    const animationQualityPass = animationDelivery.bindingCoverage === 1
      && animationDelivery.motionCoverage === 1
      && animationDelivery.loopClosureCoverage === 1
      && animationDelivery.inPlaceCoverage === 1
      && animationDelivery.maximumQuaternionError <= 1e-5;
    add('animation-clip-quality', '동작 바인딩·반복·루트모션 품질', animationQualityPass, animationQualityPass ? 100 : 0, `binding ${Math.round(animationDelivery.bindingCoverage * 100)}% · motion ${Math.round(animationDelivery.motionCoverage * 100)}% · loop ${Math.round(animationDelivery.loopClosureCoverage * 100)}% · in-place ${Math.round(animationDelivery.inPlaceCoverage * 100)}%`);
    add('animation-uv', '캐릭터 UV', uvMeshCoverage >= 0.8, uvMeshCoverage * 100, `${Math.round(uvMeshCoverage * 100)}% 메시 UV`);
    add('animation-evidence', '캐릭터 베이스 근거', input.evidenceScore >= 80, input.evidenceScore, `${input.evidenceScore}/80`);
  } else if (input.domain === 'game') {
    const triangleBudget = input.triangleBudget ?? 100_000;
    add('game-budget', '실시간 삼각형 예산', snapshot.triangles <= triangleBudget, snapshot.triangles <= triangleBudget ? 100 : triangleBudget / snapshot.triangles * 100, `${snapshot.triangles.toLocaleString()} / ${triangleBudget.toLocaleString()} tris`);
    const runtimeTopologyPass = topology.nonManifoldEdges === 0 && topology.degenerateTriangles === 0;
    add('game-topology', '게임 메시 토폴로지', runtimeTopologyPass, runtimeTopologyPass ? 100 : 0, `경계 ${topology.boundaryEdges} · 비매니폴드 ${topology.nonManifoldEdges} · 퇴화 ${topology.degenerateTriangles}`);
    add('game-uv', '게임 UV', uvMeshCoverage >= 0.8, uvMeshCoverage * 100, `${Math.round(uvMeshCoverage * 100)}% 메시 UV`);
    add('game-normals', '게임 노멀', normalMeshCoverage === 1, normalMeshCoverage * 100, `${Math.round(normalMeshCoverage * 100)}% 메시 노멀`);
    add('game-skeleton', '게임용 스켈레톤', snapshot.skeletons >= 1 && snapshot.bones >= 45, Math.min(100, snapshot.bones / 45 * 100), `${snapshot.skeletons} skeleton · ${snapshot.bones} bones`);
    add('game-finger-rig', '게임 손가락 리그', geometry.fingerBones >= 30 && geometry.fingerWeightedVertices > 0, geometry.fingerBones >= 30 && geometry.fingerWeightedVertices > 0 ? 100 : 0, `${geometry.fingerBones} finger bones · ${geometry.fingerWeightedVertices} weighted vertices`);
    const runtimeMotionPass = snapshot.animationClips >= REQUIRED_RUNTIME_CLIPS.length
      && snapshot.animationTracks >= 180 && animationSetCoverage === 1;
    add('game-runtime-motion', '게임 런타임 동작 세트', runtimeMotionPass, runtimeMotionPass ? 100 : animationSetCoverage * 100, `${snapshot.animationClips} clips · 이동/점프/제스처/상호작용 ${Math.round(animationSetCoverage * 100)}%`);
    const gameMotionQualityPass = animationDelivery.bindingCoverage === 1
      && animationDelivery.motionCoverage === 1
      && animationDelivery.loopClosureCoverage === 1
      && animationDelivery.inPlaceCoverage === 1
      && animationDelivery.maximumQuaternionError <= 1e-5;
    add('game-motion-quality', '게임 동작 품질 계약', gameMotionQualityPass, gameMotionQualityPass ? 100 : 0, `binding ${Math.round(animationDelivery.bindingCoverage * 100)}% · motion ${Math.round(animationDelivery.motionCoverage * 100)}% · loop ${Math.round(animationDelivery.loopClosureCoverage * 100)}% · in-place ${Math.round(animationDelivery.inPlaceCoverage * 100)}%`);
    add('game-collision', '충돌 프리미티브', snapshot.collisionPrimitives >= 1, snapshot.collisionPrimitives >= 1 ? 100 : 0, `${snapshot.collisionPrimitives} collision primitives`);
    add('game-lod-profile', 'LOD 납품 프로필', snapshot.gameLods >= 1, snapshot.gameLods >= 1 ? 100 : 0, `${snapshot.gameLods} declared LOD levels`);
    add('game-additional-lods', '추가 LOD 메시', snapshot.gameLods >= 2, snapshot.gameLods >= 2 ? 100 : 60, snapshot.gameLods >= 2 ? `${snapshot.gameLods} LOD levels` : 'LOD0만 포함 · 대상 플랫폼 최적화에서 LOD1+ 생성 필요', false);
    add('game-pbr', '게임 PBR 표면', pbrSurfaceCoverage >= 0.75, pbrSurfaceCoverage * 100, `${Math.round(pbrSurfaceCoverage * 100)}% micro-normal`);
  } else {
    const unitReady = input.sourceUnitMm === 1;
    const minimumAxis = geometry.minimumMeshAxisMm ?? 0;
    const minimumFeature = declaredMinimumFeatureMm ?? 0;
    add('print-topology', '출력 가능한 폐쇄형 메시', topology.pass, topology.pass ? 100 : 0, `경계 ${topology.boundaryEdges} · 비매니폴드 ${topology.nonManifoldEdges} · 퇴화 ${topology.degenerateTriangles}`);
    add('print-units', '명시적 mm 단위', unitReady, unitReady ? 100 : 0, unitReady ? '1 source unit = 1 mm' : '출력 단위가 mm로 고정되지 않음');
    add('print-declared-feature', '선언된 최소 형상', minimumFeature >= 0.8, minimumFeature >= 0.8 ? 100 : minimumFeature / 0.8 * 100, declaredMinimumFeatureMm === undefined ? 'mm 기반 IR 형상 치수 없음' : `${minimumFeature.toFixed(3)} mm / 최소 0.800 mm`);
    add('print-bounds-sanity', '메시 축 치수 점검', minimumAxis >= 0.4, minimumAxis >= 0.4 ? 100 : minimumAxis / 0.4 * 100, `${minimumAxis.toFixed(3)} mm`, false);
    add('print-volume', '양의 폐쇄 체적', geometry.enclosedVolumeMm3 > 1, geometry.enclosedVolumeMm3 > 1 ? 100 : 0, `${geometry.enclosedVolumeMm3.toFixed(1)} mm³`);
    const supportFree = geometry.unsupportedOverhangRatio <= 0.01;
    add('print-overhang', '45° 오버행 분석', supportFree, supportFree ? 100 : Math.max(0, 100 - geometry.unsupportedOverhangRatio * 500), `${geometry.unsupportedOverhangAreaMm2.toFixed(1)} mm² · 표면의 ${(geometry.unsupportedOverhangRatio * 100).toFixed(2)}%`, false);
  }

  const blockers = checks.filter((check) => check.blocking && !check.pass).map((check) => `${check.id}: ${check.detail}`);
  const warnings = checks.filter((check) => !check.blocking && !check.pass).map((check) => `${check.id}: ${check.detail}`);
  const blockingChecks = checks.filter((check) => check.blocking);
  return {
    domain: input.domain,
    pass: blockers.length === 0,
    score: blockingChecks.length > 0
      ? Math.round(blockingChecks.reduce((sum, check) => sum + check.score, 0) / blockingChecks.length)
      : 0,
    checks,
    blockers,
    warnings,
    metrics: {
      meshes: snapshot.meshes,
      triangles: snapshot.triangles,
      namedMeshCoverage,
      uvMeshCoverage,
      normalMeshCoverage,
      pbrSurfaceCoverage,
      skeletons: snapshot.skeletons,
      bones: snapshot.bones,
      animationClips: snapshot.animationClips,
      animationTracks: snapshot.animationTracks,
      animationSetCoverage,
      animationBindingCoverage: animationDelivery.bindingCoverage,
      animationMotionCoverage: animationDelivery.motionCoverage,
      animationLoopClosureCoverage: animationDelivery.loopClosureCoverage,
      animationInPlaceCoverage: animationDelivery.inPlaceCoverage,
      maximumAnimationQuaternionError: animationDelivery.maximumQuaternionError,
      bindPoseRmsErrorMm: deformation.bindPoseRmsErrorMm,
      deformationMovedVertices: deformation.movedVertices,
      deformationMaximumMm: deformation.maximumMm,
      deformationFinite: deformation.finite,
      gameLods: snapshot.gameLods,
      collisionPrimitives: snapshot.collisionPrimitives,
      fingerBones: geometry.fingerBones,
      fingerWeightedVertices: geometry.fingerWeightedVertices,
      fingerAnimationTracks: geometry.fingerAnimationTracks,
      maximumSkinWeightError: geometry.maximumSkinWeightError,
      maximumSkinInfluences: geometry.maximumSkinInfluences,
      minimumMeshAxisMm: geometry.minimumMeshAxisMm,
      declaredMinimumFeatureMm,
      enclosedVolumeMm3: geometry.enclosedVolumeMm3,
      unsupportedOverhangAreaMm2: geometry.unsupportedOverhangAreaMm2,
      unsupportedOverhangRatio: geometry.unsupportedOverhangRatio,
    },
  };
}
