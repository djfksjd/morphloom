import * as THREE from 'three';
import type { AssemblyGeometryIR, AssemblyIR } from './assembly-ir';
import { snapshotScene } from './delivery-validation';
import { inspectSurfaceSystem } from './surface-system';
import { analyzeTopology, type MeshTopologyReport } from './topology';

export type ProductionDomain =
  | 'architecture'
  | 'industrial-design'
  | 'animation'
  | 'game'
  | '3d-print';

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
    maximumSkinWeightError: number;
    maximumSkinInfluences: number;
    minimumMeshAxisMm?: number;
    declaredMinimumFeatureMm?: number;
    enclosedVolumeMm3?: number;
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
} {
  let meshes = 0;
  let uvMeshes = 0;
  let normalMeshes = 0;
  let maximumSkinWeightError = 0;
  let maximumSkinInfluences = 0;
  let minimumMeshAxisMm = Number.POSITIVE_INFINITY;
  let enclosedVolumeM3 = 0;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const cross = new THREE.Vector3();
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
      if (weights && indices && weights.itemSize === 4 && indices.itemSize === 4) {
        for (let vertex = 0; vertex < weights.count; vertex += 1) {
          let sum = 0;
          let influences = 0;
          for (let slot = 0; slot < 4; slot += 1) {
            const weight = weights.getComponent(vertex, slot);
            if (weight > 1e-6) influences += 1;
            sum += weight;
          }
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
    }
  });
  return {
    uvMeshes,
    normalMeshes,
    maximumSkinWeightError,
    maximumSkinInfluences,
    minimumMeshAxisMm: Number.isFinite(minimumMeshAxisMm) ? minimumMeshAxisMm : undefined,
    enclosedVolumeMm3: Math.abs(enclosedVolumeM3) * 1e9,
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
  const declaredMinimumFeatureMm = inspectDeclaredMinimumFeature(input.root);
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
    add('animation-skeleton', '실제 스켈레톤', snapshot.skeletons >= 1 && snapshot.bones >= 15, Math.min(100, snapshot.bones / 15 * 100), `${snapshot.skeletons} skeleton · ${snapshot.bones} bones`);
    add('animation-weights', '정규화 스킨 웨이트', geometry.maximumSkinWeightError <= 1e-5 && geometry.maximumSkinInfluences <= 4, geometry.maximumSkinWeightError <= 1e-5 ? 100 : 0, `오차 ${geometry.maximumSkinWeightError.toExponential(2)} · 최대 ${geometry.maximumSkinInfluences} influences`);
    add('animation-clips', '재생 가능한 애니메이션', snapshot.animationClips >= 1 && snapshot.animationTracks >= 2, snapshot.animationClips >= 1 ? 100 : 0, `${snapshot.animationClips} clips · ${snapshot.animationTracks} tracks`);
    add('animation-uv', '캐릭터 UV', uvMeshCoverage >= 0.8, uvMeshCoverage * 100, `${Math.round(uvMeshCoverage * 100)}% 메시 UV`);
    add('animation-evidence', '캐릭터 베이스 근거', input.evidenceScore >= 80, input.evidenceScore, `${input.evidenceScore}/80`);
  } else if (input.domain === 'game') {
    const triangleBudget = input.triangleBudget ?? 100_000;
    add('game-budget', '실시간 삼각형 예산', snapshot.triangles <= triangleBudget, snapshot.triangles <= triangleBudget ? 100 : triangleBudget / snapshot.triangles * 100, `${snapshot.triangles.toLocaleString()} / ${triangleBudget.toLocaleString()} tris`);
    const runtimeTopologyPass = topology.nonManifoldEdges === 0 && topology.degenerateTriangles === 0;
    add('game-topology', '게임 메시 토폴로지', runtimeTopologyPass, runtimeTopologyPass ? 100 : 0, `경계 ${topology.boundaryEdges} · 비매니폴드 ${topology.nonManifoldEdges} · 퇴화 ${topology.degenerateTriangles}`);
    add('game-uv', '게임 UV', uvMeshCoverage >= 0.8, uvMeshCoverage * 100, `${Math.round(uvMeshCoverage * 100)}% 메시 UV`);
    add('game-normals', '게임 노멀', normalMeshCoverage === 1, normalMeshCoverage * 100, `${Math.round(normalMeshCoverage * 100)}% 메시 노멀`);
    add('game-skeleton', '게임용 스켈레톤', snapshot.skeletons >= 1 && snapshot.bones >= 15, Math.min(100, snapshot.bones / 15 * 100), `${snapshot.skeletons} skeleton · ${snapshot.bones} bones`);
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
    add('print-supports', '오버행·서포트 분석', false, 50, '슬라이서별 서포트 생성은 후속 공정', false);
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
      maximumSkinWeightError: geometry.maximumSkinWeightError,
      maximumSkinInfluences: geometry.maximumSkinInfluences,
      minimumMeshAxisMm: geometry.minimumMeshAxisMm,
      declaredMinimumFeatureMm,
      enclosedVolumeMm3: geometry.enclosedVolumeMm3,
    },
  };
}
