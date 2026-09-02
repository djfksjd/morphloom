import * as THREE from 'three';
import type { AssemblyGeometryIR, AssemblyIR } from './assembly-ir';
import { snapshotScene } from './delivery-validation';
import { inspectSurfaceSystem } from './surface-system';
import { analyzeTopology, type MeshTopologyReport } from './topology';
import { HUMANOID_RUNTIME_CLIP_NAMES, humanoidAnimationDelivery } from './humanoid-rig';
import { REQUIRED_FACIAL_MORPH_NAMES } from './facial-morphs';
import type { PlanFootprintAudit } from './plan-footprint';
import { auditSkinnedLodQuality } from './lod-quality';
import { auditSampledWallThickness } from './print-thickness';

export const DOMAIN_READINESS_REVISION = 'morphloom-domain-readiness/0.6.0';

const CRITICAL_DEFORMATION_JOINTS = [
  'shoulder_L', 'shoulder_R', 'elbow_L', 'elbow_R',
  'hip_L', 'hip_R', 'knee_L', 'knee_R', 'ankle_L', 'ankle_R',
] as const;
const MINIMUM_CRITICAL_JOINT_VERTICES = 8;
const MAXIMUM_CRITICAL_JOINT_SAMPLES = 128;
const MINIMUM_CRITICAL_JOINT_LOCALIZATION_COVERAGE = 0.98;
const CRITICAL_JOINT_LOCALIZATION_RADIUS_RATIO = 0.15;

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
    uvFiniteCoverage: number;
    degenerateUvTriangleFraction: number;
    normalValidityCoverage: number;
    maximumNormalUnitError: number;
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
    criticalDeformationJoints: number;
    criticalWeightedJoints: number;
    criticalMovingJoints: number;
    criticalLocalizedJoints: number;
    criticalJointWeightCoverage: number;
    criticalJointMotionCoverage: number;
    criticalJointLocalizationCoverage: number;
    minimumCriticalJointWeightedVertices: number;
    minimumCriticalJointMotionMm: number;
    minimumCriticalJointLocalizationCoverage: number;
    criticalUnweightedJoints: string[];
    criticalNonMovingJoints: string[];
    criticalMislocalizedJoints: string[];
    gameLods: number;
    lodTriangleRatio: number;
    lodMonotonicTriangleReduction: boolean;
    lodSkinWeightCoverage: number;
    lodSkeletonCoverage: number;
    lodNeutralBoundsError: number;
    lodNeutralSilhouetteEnvelopeError: number;
    lodPosedBoundsError: number;
    lodPosedSilhouetteEnvelopeError: number;
    collisionPrimitives: number;
    collisionPrimitiveValidityCoverage: number;
    collisionBoneCoverage: number;
    collisionBoundsOverlapCoverage: number;
    collisionVerticalCoverage: number;
    fingerBones: number;
    fingerWeightedVertices: number;
    fingerAnimationTracks: number;
    facialMorphTargets: number;
    facialMorphAffectedVertices: number;
    facialMorphMaximumMm: number;
    maximumSkinWeightError: number;
    maximumSkinInfluences: number;
    visualHullMeshes: number;
    minimumVisualHullViewIoU: number;
    confidenceWeightedVisualHullIoU: number;
    minimumMeshAxisMm?: number;
    declaredMinimumFeatureMm?: number;
    enclosedVolumeMm3?: number;
    surfaceAreaMm2: number;
    volumeThicknessProxyMm: number;
    sampledWallThicknessComplete: boolean;
    sampledWallThicknessMm: number;
    sampledWallThicknessP05Mm: number;
    sampledWallThicknessRays: number;
    sampledWallThicknessHitCoverage: number;
    sampledWallThicknessConnectedShells: number;
    sampledWallThicknessWeldedVertices: number;
    sampledWallThicknessComponentEdges: number;
    sampledWallThicknessTriangles: number;
    sampledWallThicknessTriangleLimit: number;
    sampledWallThicknessTriangleTests: number;
    unsupportedOverhangAreaMm2: number;
    unsupportedOverhangRatio: number;
  };
}

function inspectCollisionDelivery(root: THREE.Object3D): {
  schemaValid: boolean;
  primitives: number;
  primitiveValidityCoverage: number;
  boneCoverage: number;
  boundsOverlapCoverage: number;
  verticalCoverage: number;
} {
  type CollisionPrimitive = {
    id?: unknown;
    shape?: unknown;
    center?: unknown;
    radius?: unknown;
    height?: unknown;
    bone?: unknown;
    start?: unknown;
    end?: unknown;
    orientation?: unknown;
    role?: unknown;
  };
  type Manifest = { schema?: unknown; collisionPrimitives?: unknown };
  let manifest: Manifest | undefined;
  root.traverse((object) => {
    const candidate = object.userData.gameDelivery as Manifest | undefined;
    if (candidate && Array.isArray(candidate.collisionPrimitives)
      && (!manifest || candidate.collisionPrimitives.length > (manifest.collisionPrimitives as unknown[]).length)) manifest = candidate;
  });
  const primitives = Array.isArray(manifest?.collisionPrimitives)
    ? manifest.collisionPrimitives as CollisionPrimitive[] : [];
  if (primitives.length === 0) return {
    schemaValid: false, primitives: 0, primitiveValidityCoverage: 0,
    boneCoverage: 0, boundsOverlapCoverage: 0, verticalCoverage: 0,
  };
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(root);
  const size = bounds.getSize(new THREE.Vector3());
  const maximumAxis = Math.max(size.x, size.y, size.z, 1e-9);
  const ids = new Set<string>();
  let valid = 0;
  let bound = 0;
  let overlapping = 0;
  let coveredMinY = Number.POSITIVE_INFINITY;
  let coveredMaxY = Number.NEGATIVE_INFINITY;
  for (const primitive of primitives) {
    const center = primitive.center;
    const radius = primitive.radius;
    const height = primitive.height;
    const idValid = typeof primitive.id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(primitive.id) && !ids.has(primitive.id);
    if (typeof primitive.id === 'string') ids.add(primitive.id);
    const centerValid = Array.isArray(center) && center.length === 3 && center.every(Number.isFinite);
    const radiusValid = typeof radius === 'number' && Number.isFinite(radius) && radius > 0 && radius <= maximumAxis * 0.75;
    const shapeValid = primitive.shape === 'sphere' || primitive.shape === 'capsule';
    let capsuleValid = primitive.shape === 'sphere' && height === undefined;
    let primitiveBounds: THREE.Box3 | undefined;
    if (primitive.shape === 'capsule' && centerValid && radiusValid) {
      const start = primitive.start;
      const end = primitive.end;
      const orientation = primitive.orientation;
      const endpointsValid = Array.isArray(start) && start.length === 3 && start.every(Number.isFinite)
        && Array.isArray(end) && end.length === 3 && end.every(Number.isFinite);
      const orientationValid = Array.isArray(orientation) && orientation.length === 4 && orientation.every(Number.isFinite);
      if (endpointsValid && orientationValid && typeof height === 'number' && Number.isFinite(height)) {
        const startPoint = new THREE.Vector3(start[0], start[1], start[2]);
        const endPoint = new THREE.Vector3(end[0], end[1], end[2]);
        const axis = endPoint.clone().sub(startPoint);
        const length = axis.length();
        const expectedCenter = startPoint.clone().add(endPoint).multiplyScalar(0.5);
        const declaredCenter = new THREE.Vector3(center[0], center[1], center[2]);
        const quaternion = new THREE.Quaternion(orientation[0], orientation[1], orientation[2], orientation[3]);
        const orientationError = length > 1e-9
          ? 1 - new THREE.Vector3(0, 1, 0).applyQuaternion(quaternion).normalize().dot(axis.normalize())
          : Number.POSITIVE_INFINITY;
        capsuleValid = length > (radius as number) * 0.25 && length <= maximumAxis * 1.5
          && Math.abs(height - (length + (radius as number) * 2)) <= maximumAxis * 1e-5
          && expectedCenter.distanceTo(declaredCenter) <= maximumAxis * 1e-6
          && Math.abs(quaternion.length() - 1) <= 1e-5 && orientationError <= 1e-5;
        primitiveBounds = new THREE.Box3().setFromPoints([startPoint, endPoint]).expandByScalar(radius as number);
      }
    }
    const roleValid = typeof primitive.role === 'string' && /^[a-z0-9-]{1,40}$/.test(primitive.role);
    if (idValid && centerValid && radiusValid && shapeValid && capsuleValid && roleValid) valid += 1;
    const bone = typeof primitive.bone === 'string' ? root.getObjectByName(primitive.bone) : undefined;
    if (bone instanceof THREE.Bone) bound += 1;
    if (!centerValid || !radiusValid || !shapeValid || !capsuleValid) continue;
    const point = new THREE.Vector3(center[0], center[1], center[2]);
    primitiveBounds ??= new THREE.Box3(
      point.clone().addScalar(-(radius as number)),
      point.clone().addScalar(radius as number),
    );
    if (primitiveBounds.intersectsBox(bounds)) overlapping += 1;
    coveredMinY = Math.min(coveredMinY, primitiveBounds.min.y);
    coveredMaxY = Math.max(coveredMaxY, primitiveBounds.max.y);
  }
  const count = primitives.length;
  const verticalCoverage = bounds.isEmpty() || !Number.isFinite(coveredMinY) ? 0
    : Math.max(0, Math.min(bounds.max.y, coveredMaxY) - Math.max(bounds.min.y, coveredMinY)) / Math.max(size.y, 1e-9);
  return {
    schemaValid: manifest?.schema === 'morphloom.game-delivery/0.5',
    primitives: count,
    primitiveValidityCoverage: valid / count,
    boneCoverage: bound / count,
    boundsOverlapCoverage: overlapping / count,
    verticalCoverage,
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
  surfaceAreaMm2: number;
  volumeThicknessProxyMm: number;
  unsupportedOverhangAreaMm2: number;
  unsupportedOverhangRatio: number;
  fingerBones: number;
  fingerWeightedVertices: number;
  fingerAnimationTracks: number;
  facialMorphTargets: number;
  facialMorphAffectedVertices: number;
  facialMorphMaximumMm: number;
  visualHullMeshes: number;
  minimumVisualHullViewIoU: number;
  confidenceWeightedVisualHullIoU: number;
  uvFiniteCoverage: number;
  degenerateUvTriangleFraction: number;
  normalValidityCoverage: number;
  maximumNormalUnitError: number;
} {
  let meshes = 0;
  let uvMeshes = 0;
  let normalMeshes = 0;
  let uvVertices = 0;
  let invalidUvVertices = 0;
  let uvTriangles = 0;
  let degenerateUvTriangles = 0;
  let normalVertices = 0;
  let invalidNormalVertices = 0;
  let maximumNormalUnitError = 0;
  let maximumSkinWeightError = 0;
  let maximumSkinInfluences = 0;
  let minimumMeshAxisMm = Number.POSITIVE_INFINITY;
  let enclosedVolumeM3 = 0;
  let totalSurfaceAreaM2 = 0;
  let unsupportedOverhangAreaM2 = 0;
  const fingerBoneNames = new Set<string>();
  let fingerWeightedVertices = 0;
  const facialMorphNames = new Set<string>();
  const facialMorphVertices = new Set<string>();
  let facialMorphMaximumMm = 0;
  let visualHullMeshes = 0;
  let minimumVisualHullViewIoU = 1;
  let confidenceWeightedVisualHullIoU = 1;
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
    const visualHullEvidence = geometry.userData.visualHullEvidence as {
      minimumViewIoU?: unknown;
      confidenceWeightedIoU?: unknown;
    } | undefined;
    if (visualHullEvidence) {
      visualHullMeshes += 1;
      const minimum = Number(visualHullEvidence.minimumViewIoU);
      const weighted = Number(visualHullEvidence.confidenceWeightedIoU);
      minimumVisualHullViewIoU = Math.min(minimumVisualHullViewIoU, Number.isFinite(minimum) ? minimum : 0);
      confidenceWeightedVisualHullIoU = Math.min(confidenceWeightedVisualHullIoU, Number.isFinite(weighted) ? weighted : 0);
    }
    const position = geometry.getAttribute('position');
    if (!position) return;
    const morphDictionary = object.morphTargetDictionary ?? {};
    for (const requiredName of REQUIRED_FACIAL_MORPH_NAMES) {
      const morphIndex = morphDictionary[requiredName];
      const attribute = morphIndex === undefined ? undefined : geometry.morphAttributes.position?.[morphIndex];
      if (!attribute || attribute.itemSize !== 3 || attribute.count !== position.count) continue;
      facialMorphNames.add(requiredName);
      for (let vertex = 0; vertex < attribute.count; vertex += 1) {
        const displacement = Math.hypot(attribute.getX(vertex), attribute.getY(vertex), attribute.getZ(vertex)) * 1_000;
        if (displacement <= 0.0001) continue;
        facialMorphVertices.add(`${object.uuid}:${vertex}`);
        facialMorphMaximumMm = Math.max(facialMorphMaximumMm, displacement);
      }
    }
    const uv = geometry.getAttribute('uv');
    const normal = geometry.getAttribute('normal');
    if (uv && uv.itemSize >= 2 && uv.count === position.count) {
      uvMeshes += 1;
      uvVertices += uv.count;
      for (let vertex = 0; vertex < uv.count; vertex += 1) {
        if (!Number.isFinite(uv.getX(vertex)) || !Number.isFinite(uv.getY(vertex))) invalidUvVertices += 1;
      }
    } else if (uv) {
      uvVertices += position.count;
      invalidUvVertices += position.count;
    }
    if (normal && normal.itemSize >= 3 && normal.count === position.count) {
      normalMeshes += 1;
      normalVertices += normal.count;
      for (let vertex = 0; vertex < normal.count; vertex += 1) {
        const nx = normal.getX(vertex);
        const ny = normal.getY(vertex);
        const nz = normal.getZ(vertex);
        const length = Math.hypot(nx, ny, nz);
        const error = Math.abs(length - 1);
        maximumNormalUnitError = Math.max(maximumNormalUnitError, Number.isFinite(error) ? error : Number.POSITIVE_INFINITY);
        if (!Number.isFinite(length) || error > 0.05) invalidNormalVertices += 1;
      }
    } else if (normal) {
      normalVertices += position.count;
      invalidNormalVertices += position.count;
      maximumNormalUnitError = Number.POSITIVE_INFINITY;
    }
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
        if (uv && uv.itemSize >= 2 && uv.count === position.count) {
          uvTriangles += 1;
          const ua = uv.getX(ia); const va = uv.getY(ia);
          const ub = uv.getX(ib); const vb = uv.getY(ib);
          const uc = uv.getX(ic); const vc = uv.getY(ic);
          const signedDoubleUvArea = (ub - ua) * (vc - va) - (vb - va) * (uc - ua);
          if (!Number.isFinite(signedDoubleUvArea) || Math.abs(signedDoubleUvArea) <= 1e-10) degenerateUvTriangles += 1;
        }
      }
    }
  });
  const enclosedVolumeMm3 = Math.abs(enclosedVolumeM3) * 1e9;
  const surfaceAreaMm2 = totalSurfaceAreaM2 * 1e6;
  return {
    uvMeshes,
    normalMeshes,
    maximumSkinWeightError,
    maximumSkinInfluences,
    minimumMeshAxisMm: Number.isFinite(minimumMeshAxisMm) ? minimumMeshAxisMm : undefined,
    enclosedVolumeMm3,
    surfaceAreaMm2,
    volumeThicknessProxyMm: surfaceAreaMm2 > 0 ? 2 * enclosedVolumeMm3 / surfaceAreaMm2 : 0,
    unsupportedOverhangAreaMm2: unsupportedOverhangAreaM2 * 1e6,
    unsupportedOverhangRatio: totalSurfaceAreaM2 > 0 ? unsupportedOverhangAreaM2 / totalSurfaceAreaM2 : 0,
    fingerBones: fingerBoneNames.size,
    fingerWeightedVertices,
    fingerAnimationTracks: root.animations.reduce((sum, clip) => (
      sum + clip.tracks.filter((track) => fingerPattern.test(track.name.split('.')[0])).length
    ), 0),
    facialMorphTargets: facialMorphNames.size,
    facialMorphAffectedVertices: facialMorphVertices.size,
    facialMorphMaximumMm,
    visualHullMeshes,
    minimumVisualHullViewIoU,
    confidenceWeightedVisualHullIoU,
    uvFiniteCoverage: uvVertices > 0 ? 1 - invalidUvVertices / uvVertices : 0,
    degenerateUvTriangleFraction: uvTriangles > 0 ? degenerateUvTriangles / uvTriangles : 1,
    normalValidityCoverage: normalVertices > 0 ? 1 - invalidNormalVertices / normalVertices : 0,
    maximumNormalUnitError,
  };
}

function inspectSkinDeformation(root: THREE.Object3D): {
  bindPoseRmsErrorMm?: number;
  movedVertices: number;
  maximumMm: number;
  finite: boolean;
  criticalJoints: number;
  weightedJoints: number;
  movingJoints: number;
  localizedJoints: number;
  minimumWeightedVertices: number;
  minimumJointMotionMm: number;
  minimumJointLocalizationCoverage: number;
  unweightedJoints: string[];
  nonMovingJoints: string[];
  mislocalizedJoints: string[];
} {
  let squaredError = 0;
  let samples = 0;
  let movedVertices = 0;
  let maximumMm = 0;
  let finite = true;
  const source = new THREE.Vector3();
  const transformed = new THREE.Vector3();
  root.updateMatrixWorld(true);
  let primarySkin: THREE.SkinnedMesh | undefined;
  root.traverseVisible((object) => {
    if (!(object instanceof THREE.SkinnedMesh)) return;
    const position = object.geometry.getAttribute('position');
    if (!position) {
      finite = false;
      return;
    }
    const primaryPosition = primarySkin?.geometry.getAttribute('position');
    if (!primarySkin || position.count > (primaryPosition?.count ?? 0)) primarySkin = object;
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
  });

  const criticalJoints = primarySkin ? CRITICAL_DEFORMATION_JOINTS.length : 0;
  let weightedJoints = 0;
  let movingJoints = 0;
  let localizedJoints = 0;
  let minimumWeightedVertices = Number.POSITIVE_INFINITY;
  let minimumJointMotionMm = Number.POSITIVE_INFINITY;
  let minimumJointLocalizationCoverage = Number.POSITIVE_INFINITY;
  const unweightedJoints: string[] = [];
  const nonMovingJoints: string[] = [];
  const mislocalizedJoints: string[] = [];
  if (primarySkin) {
    const position = primarySkin.geometry.getAttribute('position');
    const skinIndex = primarySkin.geometry.getAttribute('skinIndex');
    const skinWeight = primarySkin.geometry.getAttribute('skinWeight');
    const boneIndexByName = new Map(primarySkin.skeleton.bones.map((bone, index) => [bone.name, index]));
    const jointByBoneIndex = new Map<number, string>();
    const weightedVertexCounts = new Map<string, number>();
    const localizedVertexCounts = new Map<string, number>();
    const sampledVertices = new Map<string, number[]>();
    for (const jointName of CRITICAL_DEFORMATION_JOINTS) {
      const boneIndex = boneIndexByName.get(jointName);
      if (boneIndex !== undefined) jointByBoneIndex.set(boneIndex, jointName);
      weightedVertexCounts.set(jointName, 0);
      localizedVertexCounts.set(jointName, 0);
      sampledVertices.set(jointName, []);
    }
    if (!position || !skinIndex || !skinWeight
      || skinIndex.itemSize < 4 || skinWeight.itemSize < 4
      || skinIndex.count !== position.count || skinWeight.count !== position.count) {
      finite = false;
      unweightedJoints.push(...CRITICAL_DEFORMATION_JOINTS);
      nonMovingJoints.push(...CRITICAL_DEFORMATION_JOINTS);
      mislocalizedJoints.push(...CRITICAL_DEFORMATION_JOINTS);
    } else {
      let minimumY = Number.POSITIVE_INFINITY;
      let maximumY = Number.NEGATIVE_INFINITY;
      for (let vertex = 0; vertex < position.count; vertex += 1) {
        minimumY = Math.min(minimumY, position.getY(vertex));
        maximumY = Math.max(maximumY, position.getY(vertex));
      }
      const bodyHeight = Math.max(0, maximumY - minimumY);
      const localizationRadiusSq = Math.max(
        0.05, bodyHeight * CRITICAL_JOINT_LOCALIZATION_RADIUS_RATIO,
      ) ** 2;
      const boneLocalPosition = (bone: THREE.Bone): THREE.Vector3 => primarySkin!.worldToLocal(
        bone.getWorldPosition(new THREE.Vector3()),
      );
      const connectedSegments = new Map<string, Array<{
        start: THREE.Vector3;
        delta: THREE.Vector3;
        lengthSq: number;
      }>>();
      for (const jointName of CRITICAL_DEFORMATION_JOINTS) {
        const joint = primarySkin.skeleton.bones[boneIndexByName.get(jointName) ?? -1];
        if (!joint) {
          connectedSegments.set(jointName, []);
          continue;
        }
        const center = boneLocalPosition(joint);
        const endpoints: Array<[THREE.Vector3, THREE.Vector3]> = [];
        if (joint.parent instanceof THREE.Bone) endpoints.push([boneLocalPosition(joint.parent), center]);
        for (const child of joint.children) {
          if (child instanceof THREE.Bone) endpoints.push([center, boneLocalPosition(child)]);
        }
        connectedSegments.set(jointName, endpoints.map(([start, end]) => {
          const delta = end.clone().sub(start);
          return { start, delta, lengthSq: delta.lengthSq() };
        }));
      }
      const localizationPoint = new THREE.Vector3();
      const localizationOffset = new THREE.Vector3();
      const localizationClosest = new THREE.Vector3();
      for (let vertex = 0; vertex < position.count; vertex += 1) {
        for (let slot = 0; slot < 4; slot += 1) {
          const weight = skinWeight.getComponent(vertex, slot);
          if (!Number.isFinite(weight)) {
            finite = false;
            continue;
          }
          if (weight <= 0.001) continue;
          const boneIndex = skinIndex.getComponent(vertex, slot);
          const jointName = jointByBoneIndex.get(boneIndex);
          if (!jointName) continue;
          let duplicate = false;
          for (let previous = 0; previous < slot; previous += 1) {
            if (skinWeight.getComponent(vertex, previous) > 0.001
              && skinIndex.getComponent(vertex, previous) === boneIndex) duplicate = true;
          }
          if (duplicate) continue;
          weightedVertexCounts.set(jointName, weightedVertexCounts.get(jointName)! + 1);
          localizationPoint.fromBufferAttribute(position, vertex);
          const localized = (connectedSegments.get(jointName) ?? []).some((segment) => {
            const t = segment.lengthSq > 1e-12
              ? THREE.MathUtils.clamp(
                localizationOffset.copy(localizationPoint).sub(segment.start).dot(segment.delta) / segment.lengthSq,
                0, 1,
              )
              : 0;
            localizationClosest.copy(segment.start).addScaledVector(segment.delta, t);
            return localizationClosest.distanceToSquared(localizationPoint) <= localizationRadiusSq;
          });
          if (localized) localizedVertexCounts.set(jointName, localizedVertexCounts.get(jointName)! + 1);
          const jointSamples = sampledVertices.get(jointName)!;
          if (jointSamples.length < MAXIMUM_CRITICAL_JOINT_SAMPLES) jointSamples.push(vertex);
        }
      }

      const probeRotation = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0.37, 0.71, 0.59).normalize(), 0.12,
      );
      for (const jointName of CRITICAL_DEFORMATION_JOINTS) {
        const weightedVertices = weightedVertexCounts.get(jointName) ?? 0;
        const localizationCoverage = (localizedVertexCounts.get(jointName) ?? 0) / Math.max(1, weightedVertices);
        minimumWeightedVertices = Math.min(minimumWeightedVertices, weightedVertices);
        minimumJointLocalizationCoverage = Math.min(minimumJointLocalizationCoverage, localizationCoverage);
        if (weightedVertices >= MINIMUM_CRITICAL_JOINT_VERTICES) weightedJoints += 1;
        else unweightedJoints.push(jointName);
        if (weightedVertices >= MINIMUM_CRITICAL_JOINT_VERTICES
          && localizationCoverage >= MINIMUM_CRITICAL_JOINT_LOCALIZATION_COVERAGE) localizedJoints += 1;
        else mislocalizedJoints.push(jointName);
        const joint = primarySkin.skeleton.bones[boneIndexByName.get(jointName) ?? -1];
        const jointSamples = sampledVertices.get(jointName) ?? [];
        let jointMaximumMm = 0;
        let jointMovedVertices = 0;
        if (joint && jointSamples.length > 0) {
          const originalRotation = joint.quaternion.clone();
          const baseline = jointSamples.map((vertex) => {
            source.fromBufferAttribute(position, vertex);
            transformed.copy(source);
            primarySkin!.applyBoneTransform(vertex, transformed);
            return transformed.clone();
          });
          try {
            joint.quaternion.multiply(probeRotation);
            root.updateMatrixWorld(true);
            primarySkin.skeleton.update();
            jointSamples.forEach((vertex, sampleIndex) => {
              source.fromBufferAttribute(position, vertex);
              transformed.copy(source);
              primarySkin!.applyBoneTransform(vertex, transformed);
              const movementMm = transformed.distanceTo(baseline[sampleIndex]!) * 1_000;
              if (movementMm > 0.1) {
                jointMovedVertices += 1;
                movedVertices += 1;
              }
              jointMaximumMm = Math.max(jointMaximumMm, movementMm);
              maximumMm = Math.max(maximumMm, movementMm);
              finite = finite && Number.isFinite(transformed.x)
                && Number.isFinite(transformed.y) && Number.isFinite(transformed.z);
            });
          } finally {
            joint.quaternion.copy(originalRotation);
            root.updateMatrixWorld(true);
            primarySkin.skeleton.update();
          }
        }
        minimumJointMotionMm = Math.min(minimumJointMotionMm, jointMaximumMm);
        const jointMoves = weightedVertices >= MINIMUM_CRITICAL_JOINT_VERTICES
          && jointMaximumMm > 1
          && jointMovedVertices >= Math.min(4, jointSamples.length);
        if (jointMoves) movingJoints += 1;
        else nonMovingJoints.push(jointName);
      }
    }
  } else {
    finite = false;
  }
  return {
    bindPoseRmsErrorMm: samples > 0 ? Math.sqrt(squaredError / samples) * 1_000 : undefined,
    movedVertices,
    maximumMm,
    finite,
    criticalJoints,
    weightedJoints,
    movingJoints,
    localizedJoints,
    minimumWeightedVertices: Number.isFinite(minimumWeightedVertices) ? minimumWeightedVertices : 0,
    minimumJointMotionMm: Number.isFinite(minimumJointMotionMm) ? minimumJointMotionMm : 0,
    minimumJointLocalizationCoverage: Number.isFinite(minimumJointLocalizationCoverage)
      ? minimumJointLocalizationCoverage : 0,
    unweightedJoints,
    nonMovingJoints,
    mislocalizedJoints,
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
  const collisionDelivery = inspectCollisionDelivery(input.root);
  const lodQuality = auditSkinnedLodQuality(input.root);
  const declaredMinimumFeatureMm = inspectDeclaredMinimumFeature(input.root);
  const sampledWallThickness = input.domain === '3d-print'
    ? auditSampledWallThickness(input.root)
    : undefined;
  const deliveredClipNames = new Set(snapshot.animationClipNames);
  const animationSetCoverage = REQUIRED_RUNTIME_CLIPS.filter((name) => deliveredClipNames.has(name)).length
    / REQUIRED_RUNTIME_CLIPS.length;
  const namedMeshCoverage = snapshot.meshes > 0 ? snapshot.namedMeshes / snapshot.meshes : 0;
  const uvMeshCoverage = snapshot.meshes > 0 ? geometry.uvMeshes / snapshot.meshes : 0;
  const normalMeshCoverage = snapshot.meshes > 0 ? geometry.normalMeshes / snapshot.meshes : 0;
  const uvIntegrityScore = Math.min(uvMeshCoverage, geometry.uvFiniteCoverage,
    Math.max(0, 1 - geometry.degenerateUvTriangleFraction)) * 100;
  const normalIntegrityScore = Math.min(normalMeshCoverage, geometry.normalValidityCoverage) * 100;
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
  if (geometry.visualHullMeshes > 0) {
    const projectionPass = geometry.minimumVisualHullViewIoU >= 0.75
      && geometry.confidenceWeightedVisualHullIoU >= 0.85;
    add('visual-hull-projection', '다중 시점 외피 재투영', projectionPass,
      projectionPass ? 100 : geometry.confidenceWeightedVisualHullIoU * 100,
      `${geometry.visualHullMeshes} hull · min IoU ${geometry.minimumVisualHullViewIoU.toFixed(3)} · weighted ${geometry.confidenceWeightedVisualHullIoU.toFixed(3)}`);
  }

  if (input.domain === 'architecture') {
    const footprint = input.root.userData.planFootprintAudit as PlanFootprintAudit | undefined;
    add('architecture-topology', '건축 셸 토폴로지', topology.pass, topology.pass ? 100 : 0, `${topology.watertightMeshes}/${topology.meshes} 폐쇄형`);
    add('architecture-plan', '실제 도면 외곽 재투영', footprint?.pass === true,
      footprint ? footprint.iou * 100 : 0,
      footprint ? `IoU ${footprint.iou.toFixed(3)} · 과잉 ${(footprint.falsePositiveFraction * 100).toFixed(1)}% · 누락 ${(footprint.falseNegativeFraction * 100).toFixed(1)}%${footprint.voidOccupancy.length ? ` · 공백 ${footprint.voidOccupancy.map((entry) => `${entry.id} ${(entry.fraction * 100).toFixed(1)}%`).join(', ')}` : ''}` : '컴파일된 도면 외곽 검증 없음');
    add('architecture-evidence', '실측·도면 근거', input.evidenceScore >= 85, input.evidenceScore, `${input.evidenceScore}/85`);
    add('architecture-surface', '건축 마감 표면', pbrSurfaceCoverage >= 0.8, pbrSurfaceCoverage * 100, `${Math.round(pbrSurfaceCoverage * 100)}% micro-normal (최소 80%)`);
    const uvPass = uvMeshCoverage >= 0.95 && geometry.uvFiniteCoverage === 1 && geometry.degenerateUvTriangleFraction <= 0.05;
    add('architecture-uv', '건축 UV 무결성', uvPass, uvIntegrityScore, `${Math.round(uvMeshCoverage * 100)}% 메시 · 유한값 ${Math.round(geometry.uvFiniteCoverage * 100)}% · 퇴화 삼각형 ${(geometry.degenerateUvTriangleFraction * 100).toFixed(2)}%`);
  } else if (input.domain === 'industrial-design') {
    add('design-topology', '제품 토폴로지', topology.pass, topology.pass ? 100 : 0, `경계 ${topology.boundaryEdges} · 비매니폴드 ${topology.nonManifoldEdges} · 자기교차 ${topology.selfIntersections}`);
    add('design-evidence', '제품 근거', input.evidenceScore >= 80, input.evidenceScore, `${input.evidenceScore}/80`);
    const uvPass = uvMeshCoverage >= 0.95 && geometry.uvFiniteCoverage === 1 && geometry.degenerateUvTriangleFraction <= 0.05;
    add('design-uv', '제품 UV 무결성', uvPass, uvIntegrityScore, `${Math.round(uvMeshCoverage * 100)}% 메시 · 유한값 ${Math.round(geometry.uvFiniteCoverage * 100)}% · 퇴화 삼각형 ${(geometry.degenerateUvTriangleFraction * 100).toFixed(2)}%`);
    const normalPass = normalMeshCoverage === 1 && geometry.normalValidityCoverage === 1 && geometry.maximumNormalUnitError <= 0.05;
    add('design-normals', '제품 노멀 무결성', normalPass, normalIntegrityScore, `${Math.round(normalMeshCoverage * 100)}% 메시 · 유효 ${Math.round(geometry.normalValidityCoverage * 100)}% · 최대 단위오차 ${geometry.maximumNormalUnitError.toExponential(2)}`);
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
    const criticalJointPass = deformation.weightedJoints === deformation.criticalJoints
      && deformation.movingJoints === deformation.criticalJoints;
    add('animation-joint-deformation', '주요 관절별 실제 변형', criticalJointPass,
      deformation.criticalJoints > 0 ? deformation.movingJoints / deformation.criticalJoints * 100 : 0,
      `${deformation.movingJoints}/${deformation.criticalJoints} 관절 변형 · 웨이트 ${deformation.weightedJoints}/${deformation.criticalJoints} · 최소 ${deformation.minimumWeightedVertices} vertices · 최소 이동 ${deformation.minimumJointMotionMm.toFixed(2)} mm${deformation.nonMovingJoints.length > 0 ? ` · 실패 ${deformation.nonMovingJoints.join(', ')}` : ''}`);
    const jointLocalizationPass = deformation.criticalJoints > 0
      && deformation.localizedJoints === deformation.criticalJoints;
    add('animation-joint-localization', '주요 관절 웨이트 위치', jointLocalizationPass,
      deformation.criticalJoints > 0 ? deformation.localizedJoints / deformation.criticalJoints * 100 : 0,
      `${deformation.localizedJoints}/${deformation.criticalJoints} 관절 위치 통과 · 최소 구역 일치 ${(deformation.minimumJointLocalizationCoverage * 100).toFixed(1)}%${deformation.mislocalizedJoints.length > 0 ? ` · 실패 ${deformation.mislocalizedJoints.join(', ')}` : ''}`);
    const fingerRigPass = geometry.fingerBones >= 30 && geometry.fingerWeightedVertices > 0 && geometry.fingerAnimationTracks >= 16;
    add('animation-finger-rig', '손가락 리그·가중치', fingerRigPass, fingerRigPass ? 100 : 0, `${geometry.fingerBones} finger bones · ${geometry.fingerWeightedVertices} weighted vertices · ${geometry.fingerAnimationTracks} animated tracks`);
    const facialMorphPass = geometry.facialMorphTargets === REQUIRED_FACIAL_MORPH_NAMES.length
      && geometry.facialMorphAffectedVertices >= 100
      && geometry.facialMorphMaximumMm >= 0.5 && geometry.facialMorphMaximumMm <= 30;
    add('animation-facial-morphs', '얼굴 표정 모프', facialMorphPass, facialMorphPass ? 100 : 0, `${geometry.facialMorphTargets}/${REQUIRED_FACIAL_MORPH_NAMES.length} targets · ${geometry.facialMorphAffectedVertices} affected vertices · max ${geometry.facialMorphMaximumMm.toFixed(2)} mm`);
    const animationSetPass = snapshot.animationClips >= REQUIRED_RUNTIME_CLIPS.length
      && snapshot.animationTracks >= 180 && animationSetCoverage === 1;
    add('animation-clips', '납품용 기본 동작 세트', animationSetPass, animationSetPass ? 100 : animationSetCoverage * 100, `${snapshot.animationClips} clips · ${snapshot.animationTracks} tracks · 필수 동작 ${Math.round(animationSetCoverage * 100)}%`);
    const animationQualityPass = animationDelivery.bindingCoverage === 1
      && animationDelivery.motionCoverage === 1
      && animationDelivery.loopClosureCoverage === 1
      && animationDelivery.inPlaceCoverage === 1
      && animationDelivery.maximumQuaternionError <= 1e-5;
    add('animation-clip-quality', '동작 바인딩·반복·루트모션 품질', animationQualityPass, animationQualityPass ? 100 : 0, `binding ${Math.round(animationDelivery.bindingCoverage * 100)}% · motion ${Math.round(animationDelivery.motionCoverage * 100)}% · loop ${Math.round(animationDelivery.loopClosureCoverage * 100)}% · in-place ${Math.round(animationDelivery.inPlaceCoverage * 100)}%`);
    const uvPass = uvMeshCoverage >= 0.8 && geometry.uvFiniteCoverage === 1 && geometry.degenerateUvTriangleFraction <= 0.05;
    add('animation-uv', '캐릭터 UV 무결성', uvPass, uvIntegrityScore, `${Math.round(uvMeshCoverage * 100)}% 메시 · 유한값 ${Math.round(geometry.uvFiniteCoverage * 100)}% · 퇴화 삼각형 ${(geometry.degenerateUvTriangleFraction * 100).toFixed(2)}%`);
    const normalPass = normalMeshCoverage === 1 && geometry.normalValidityCoverage === 1 && geometry.maximumNormalUnitError <= 0.05;
    add('animation-normals', '캐릭터 노멀 무결성', normalPass, normalIntegrityScore, `${Math.round(normalMeshCoverage * 100)}% 메시 · 유효 ${Math.round(geometry.normalValidityCoverage * 100)}% · 최대 단위오차 ${geometry.maximumNormalUnitError.toExponential(2)}`);
    add('animation-evidence', '캐릭터 베이스 근거', input.evidenceScore >= 80, input.evidenceScore, `${input.evidenceScore}/80`);
  } else if (input.domain === 'game') {
    const triangleBudget = input.triangleBudget ?? 100_000;
    add('game-budget', '실시간 삼각형 예산', snapshot.triangles <= triangleBudget, snapshot.triangles <= triangleBudget ? 100 : triangleBudget / snapshot.triangles * 100, `${snapshot.triangles.toLocaleString()} / ${triangleBudget.toLocaleString()} tris`);
    const runtimeTopologyPass = topology.nonManifoldEdges === 0
      && topology.degenerateTriangles === 0
      && topology.selfIntersections === 0
      && topology.selfIntersectionComplete;
    add('game-topology', '게임 메시 토폴로지', runtimeTopologyPass, runtimeTopologyPass ? 100 : 0, `경계 ${topology.boundaryEdges} · 비매니폴드 ${topology.nonManifoldEdges} · 퇴화 ${topology.degenerateTriangles} · 자기교차 ${topology.selfIntersections}`);
    const uvPass = uvMeshCoverage >= 0.8 && geometry.uvFiniteCoverage === 1 && geometry.degenerateUvTriangleFraction <= 0.05;
    add('game-uv', '게임 UV 무결성', uvPass, uvIntegrityScore, `${Math.round(uvMeshCoverage * 100)}% 메시 · 유한값 ${Math.round(geometry.uvFiniteCoverage * 100)}% · 퇴화 삼각형 ${(geometry.degenerateUvTriangleFraction * 100).toFixed(2)}%`);
    const normalPass = normalMeshCoverage === 1 && geometry.normalValidityCoverage === 1 && geometry.maximumNormalUnitError <= 0.05;
    add('game-normals', '게임 노멀 무결성', normalPass, normalIntegrityScore, `${Math.round(normalMeshCoverage * 100)}% 메시 · 유효 ${Math.round(geometry.normalValidityCoverage * 100)}% · 최대 단위오차 ${geometry.maximumNormalUnitError.toExponential(2)}`);
    add('game-skeleton', '게임용 스켈레톤', snapshot.skeletons >= 1 && snapshot.bones >= 45, Math.min(100, snapshot.bones / 45 * 100), `${snapshot.skeletons} skeleton · ${snapshot.bones} bones`);
    const gameJointDeformationPass = deformation.finite
      && deformation.weightedJoints === deformation.criticalJoints
      && deformation.movingJoints === deformation.criticalJoints;
    add('game-joint-deformation', '게임 주요 관절 실제 변형', gameJointDeformationPass,
      deformation.criticalJoints > 0 ? deformation.movingJoints / deformation.criticalJoints * 100 : 0,
      `${deformation.movingJoints}/${deformation.criticalJoints} 관절 변형 · 웨이트 ${deformation.weightedJoints}/${deformation.criticalJoints} · 최소 ${deformation.minimumWeightedVertices} vertices${deformation.nonMovingJoints.length > 0 ? ` · 실패 ${deformation.nonMovingJoints.join(', ')}` : ''}`);
    const gameJointLocalizationPass = deformation.criticalJoints > 0
      && deformation.localizedJoints === deformation.criticalJoints;
    add('game-joint-localization', '게임 관절 웨이트 위치', gameJointLocalizationPass,
      deformation.criticalJoints > 0 ? deformation.localizedJoints / deformation.criticalJoints * 100 : 0,
      `${deformation.localizedJoints}/${deformation.criticalJoints} 관절 위치 통과 · 최소 구역 일치 ${(deformation.minimumJointLocalizationCoverage * 100).toFixed(1)}%${deformation.mislocalizedJoints.length > 0 ? ` · 실패 ${deformation.mislocalizedJoints.join(', ')}` : ''}`);
    add('game-finger-rig', '게임 손가락 리그', geometry.fingerBones >= 30 && geometry.fingerWeightedVertices > 0, geometry.fingerBones >= 30 && geometry.fingerWeightedVertices > 0 ? 100 : 0, `${geometry.fingerBones} finger bones · ${geometry.fingerWeightedVertices} weighted vertices`);
    const gameFacialMorphPass = geometry.facialMorphTargets === REQUIRED_FACIAL_MORPH_NAMES.length
      && geometry.facialMorphAffectedVertices >= 100;
    add('game-facial-morphs', '게임 얼굴 표정 모프', gameFacialMorphPass, gameFacialMorphPass ? 100 : 0, `${geometry.facialMorphTargets}/${REQUIRED_FACIAL_MORPH_NAMES.length} targets · ${geometry.facialMorphAffectedVertices} affected vertices`);
    const runtimeMotionPass = snapshot.animationClips >= REQUIRED_RUNTIME_CLIPS.length
      && snapshot.animationTracks >= 180 && animationSetCoverage === 1;
    add('game-runtime-motion', '게임 런타임 동작 세트', runtimeMotionPass, runtimeMotionPass ? 100 : animationSetCoverage * 100, `${snapshot.animationClips} clips · 이동/점프/제스처/상호작용 ${Math.round(animationSetCoverage * 100)}%`);
    const gameMotionQualityPass = animationDelivery.bindingCoverage === 1
      && animationDelivery.motionCoverage === 1
      && animationDelivery.loopClosureCoverage === 1
      && animationDelivery.inPlaceCoverage === 1
      && animationDelivery.maximumQuaternionError <= 1e-5;
    add('game-motion-quality', '게임 동작 품질 계약', gameMotionQualityPass, gameMotionQualityPass ? 100 : 0, `binding ${Math.round(animationDelivery.bindingCoverage * 100)}% · motion ${Math.round(animationDelivery.motionCoverage * 100)}% · loop ${Math.round(animationDelivery.loopClosureCoverage * 100)}% · in-place ${Math.round(animationDelivery.inPlaceCoverage * 100)}%`);
    const collisionPass = snapshot.collisionPrimitives >= 16 && collisionDelivery.schemaValid
      && collisionDelivery.primitiveValidityCoverage === 1 && collisionDelivery.boneCoverage === 1
      && collisionDelivery.boundsOverlapCoverage === 1 && collisionDelivery.verticalCoverage >= 0.75;
    add('game-collision', '실제 충돌 프리미티브', collisionPass, collisionPass ? 100 : 0,
      `${snapshot.collisionPrimitives}개 포즈 정렬 · 유효 ${Math.round(collisionDelivery.primitiveValidityCoverage * 100)}% · 본 연결 ${Math.round(collisionDelivery.boneCoverage * 100)}% · 바디 교차 ${Math.round(collisionDelivery.boundsOverlapCoverage * 100)}% · 높이 커버 ${Math.round(collisionDelivery.verticalCoverage * 100)}%`);
    add('game-lod-profile', 'LOD 납품 프로필', snapshot.gameLods >= 1, snapshot.gameLods >= 1 ? 100 : 0, `${snapshot.gameLods} declared LOD levels`);
    add('game-additional-lods', '추가 LOD 메시', snapshot.gameLods >= 2, snapshot.gameLods >= 2 ? 100 : 60, snapshot.gameLods >= 2 ? `${snapshot.gameLods} LOD levels` : 'LOD0만 포함 · 대상 플랫폼 최적화에서 LOD1+ 생성 필요', false);
    const lodQualityRequired = snapshot.gameLods >= 2;
    const everyDeclaredLodPresent = lodQuality.lodMeshes === Math.max(0, snapshot.gameLods - 1);
    add('game-lod-quality', 'LOD 형상·변형 보존', !lodQualityRequired || (lodQuality.pass && everyDeclaredLodPresent),
      lodQuality.pass && everyDeclaredLodPresent ? 100 : 0,
      lodQualityRequired
        ? `${lodQuality.lodMeshes}/${Math.max(0, snapshot.gameLods - 1)} meshes · tris ${(lodQuality.triangleRatio * 100).toFixed(1)}% · 감소 ${lodQuality.monotonicTriangleReduction ? '연속' : '실패'} · neutral bounds ${(lodQuality.neutralBoundsError * 100).toFixed(2)}% / silhouette ${(lodQuality.neutralSilhouetteEnvelopeError * 100).toFixed(2)}% · posed bounds ${(lodQuality.posedBoundsError * 100).toFixed(2)}% / silhouette ${(lodQuality.posedSilhouetteEnvelopeError * 100).toFixed(2)}% · skin ${Math.round(lodQuality.skinWeightCoverage * 100)}%`
        : 'LOD1+가 선언되면 형상·스킨 변형 보존 검사를 차단 게이트로 적용',
      lodQualityRequired);
    add('game-pbr', '게임 PBR 표면', pbrSurfaceCoverage >= 0.75, pbrSurfaceCoverage * 100, `${Math.round(pbrSurfaceCoverage * 100)}% micro-normal`);
  } else {
    const unitReady = input.sourceUnitMm === 1;
    const minimumAxis = geometry.minimumMeshAxisMm ?? 0;
    const minimumFeature = declaredMinimumFeatureMm ?? 0;
    add('print-topology', '출력 가능한 폐쇄형 메시', topology.pass, topology.pass ? 100 : 0, `경계 ${topology.boundaryEdges} · 비매니폴드 ${topology.nonManifoldEdges} · 퇴화 ${topology.degenerateTriangles} · 자기교차 ${topology.selfIntersections}`);
    add('print-units', '명시적 mm 단위', unitReady, unitReady ? 100 : 0, unitReady ? '1 source unit = 1 mm' : '출력 단위가 mm로 고정되지 않음');
    add('print-declared-feature', '선언된 최소 형상', minimumFeature >= 0.8, minimumFeature >= 0.8 ? 100 : minimumFeature / 0.8 * 100, declaredMinimumFeatureMm === undefined ? 'mm 기반 IR 형상 치수 없음' : `${minimumFeature.toFixed(3)} mm / 최소 0.800 mm`);
    add('print-bounds-sanity', '메시 축 치수 점검', minimumAxis >= 0.4, minimumAxis >= 0.4 ? 100 : minimumAxis / 0.4 * 100, `${minimumAxis.toFixed(3)} mm`, false);
    add('print-volume', '양의 폐쇄 체적', geometry.enclosedVolumeMm3 > 1, geometry.enclosedVolumeMm3 > 1 ? 100 : 0, `${geometry.enclosedVolumeMm3.toFixed(1)} mm³`);
    const thicknessProxyPass = geometry.volumeThicknessProxyMm >= 0.8;
    add('print-volume-thickness', '체적·표면적 두께 지표', thicknessProxyPass,
      thicknessProxyPass ? 100 : geometry.volumeThicknessProxyMm / 0.8 * 100,
      `${geometry.volumeThicknessProxyMm.toFixed(3)} mm / 최소 0.800 mm`);
    const sampledThicknessPass = sampledWallThickness?.complete === true
      && sampledWallThickness.minimumMm >= 0.8;
    add('print-local-thickness', '국부 벽 두께 표본', sampledThicknessPass,
      sampledThicknessPass ? 100 : (sampledWallThickness?.minimumMm ?? 0) / 0.8 * 100,
      sampledWallThickness
        ? `최소 ${sampledWallThickness.minimumMm.toFixed(3)} mm · P05 ${sampledWallThickness.percentile05Mm.toFixed(3)} mm · 연결 외피 ${sampledWallThickness.connectedShells} · ${sampledWallThickness.hitRays}/${sampledWallThickness.sampledRays} rays · ${sampledWallThickness.triangleTests.toLocaleString()}/${sampledWallThickness.maximumTriangleTests.toLocaleString()} tests${sampledWallThickness.blockers.length > 0 ? ` · ${sampledWallThickness.blockers.join('; ')}` : ''}`
        : '국부 벽 두께 검사를 실행하지 못함');
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
      uvFiniteCoverage: geometry.uvFiniteCoverage,
      degenerateUvTriangleFraction: geometry.degenerateUvTriangleFraction,
      normalValidityCoverage: geometry.normalValidityCoverage,
      maximumNormalUnitError: geometry.maximumNormalUnitError,
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
      criticalDeformationJoints: deformation.criticalJoints,
      criticalWeightedJoints: deformation.weightedJoints,
      criticalMovingJoints: deformation.movingJoints,
      criticalLocalizedJoints: deformation.localizedJoints,
      criticalJointWeightCoverage: deformation.weightedJoints / Math.max(1, deformation.criticalJoints),
      criticalJointMotionCoverage: deformation.movingJoints / Math.max(1, deformation.criticalJoints),
      criticalJointLocalizationCoverage: deformation.localizedJoints / Math.max(1, deformation.criticalJoints),
      minimumCriticalJointWeightedVertices: deformation.minimumWeightedVertices,
      minimumCriticalJointMotionMm: deformation.minimumJointMotionMm,
      minimumCriticalJointLocalizationCoverage: deformation.minimumJointLocalizationCoverage,
      criticalUnweightedJoints: deformation.unweightedJoints,
      criticalNonMovingJoints: deformation.nonMovingJoints,
      criticalMislocalizedJoints: deformation.mislocalizedJoints,
      gameLods: snapshot.gameLods,
      lodTriangleRatio: lodQuality.triangleRatio,
      lodMonotonicTriangleReduction: lodQuality.monotonicTriangleReduction,
      lodSkinWeightCoverage: lodQuality.skinWeightCoverage,
      lodSkeletonCoverage: lodQuality.skeletonCoverage,
      lodNeutralBoundsError: lodQuality.neutralBoundsError,
      lodNeutralSilhouetteEnvelopeError: lodQuality.neutralSilhouetteEnvelopeError,
      lodPosedBoundsError: lodQuality.posedBoundsError,
      lodPosedSilhouetteEnvelopeError: lodQuality.posedSilhouetteEnvelopeError,
      collisionPrimitives: snapshot.collisionPrimitives,
      collisionPrimitiveValidityCoverage: collisionDelivery.primitiveValidityCoverage,
      collisionBoneCoverage: collisionDelivery.boneCoverage,
      collisionBoundsOverlapCoverage: collisionDelivery.boundsOverlapCoverage,
      collisionVerticalCoverage: collisionDelivery.verticalCoverage,
      fingerBones: geometry.fingerBones,
      fingerWeightedVertices: geometry.fingerWeightedVertices,
      fingerAnimationTracks: geometry.fingerAnimationTracks,
      facialMorphTargets: geometry.facialMorphTargets,
      facialMorphAffectedVertices: geometry.facialMorphAffectedVertices,
      facialMorphMaximumMm: geometry.facialMorphMaximumMm,
      maximumSkinWeightError: geometry.maximumSkinWeightError,
      maximumSkinInfluences: geometry.maximumSkinInfluences,
      visualHullMeshes: geometry.visualHullMeshes,
      minimumVisualHullViewIoU: geometry.minimumVisualHullViewIoU,
      confidenceWeightedVisualHullIoU: geometry.confidenceWeightedVisualHullIoU,
      minimumMeshAxisMm: geometry.minimumMeshAxisMm,
      declaredMinimumFeatureMm,
      enclosedVolumeMm3: geometry.enclosedVolumeMm3,
      surfaceAreaMm2: geometry.surfaceAreaMm2,
      volumeThicknessProxyMm: geometry.volumeThicknessProxyMm,
      sampledWallThicknessComplete: sampledWallThickness?.complete ?? false,
      sampledWallThicknessMm: sampledWallThickness?.minimumMm ?? 0,
      sampledWallThicknessP05Mm: sampledWallThickness?.percentile05Mm ?? 0,
      sampledWallThicknessRays: sampledWallThickness?.sampledRays ?? 0,
      sampledWallThicknessHitCoverage: sampledWallThickness?.hitCoverage ?? 0,
      sampledWallThicknessConnectedShells: sampledWallThickness?.connectedShells ?? 0,
      sampledWallThicknessWeldedVertices: sampledWallThickness?.weldedVertices ?? 0,
      sampledWallThicknessComponentEdges: sampledWallThickness?.componentEdges ?? 0,
      sampledWallThicknessTriangles: sampledWallThickness?.triangles ?? 0,
      sampledWallThicknessTriangleLimit: sampledWallThickness?.maximumTriangles ?? 0,
      sampledWallThicknessTriangleTests: sampledWallThickness?.triangleTests ?? 0,
      unsupportedOverhangAreaMm2: geometry.unsupportedOverhangAreaMm2,
      unsupportedOverhangRatio: geometry.unsupportedOverhangRatio,
    },
  };
}
