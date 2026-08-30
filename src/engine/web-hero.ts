import * as THREE from 'three';
import type { PoseStyle, ViewMode } from '../types';
import { createSurfaceMaterial } from './surface-system';
import { deformPointByReferencePose, getPoseJoints } from './reference-pose';

export interface WebHeroDimensions {
  heightMeters: number;
  bounds: THREE.Box3;
  headCenter: THREE.Vector3;
  headRadius: number;
  headSize: THREE.Vector3;
  torsoFrontZ: number;
}

export interface WebHeroBuild {
  group: THREE.Group;
  namedParts: number;
  visibleEvidenceParts: number;
  inferredParts: string[];
}

type EvidenceClass = 'visible' | 'inferred';

function markPart(
  mesh: THREE.Mesh,
  id: string,
  name: string,
  detail: string,
  evidence: EvidenceClass = 'visible',
): THREE.Mesh {
  mesh.name = id;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.characterPart = { id, name, detail, evidence };
  return mesh;
}

function cylinderBetween(
  start: THREE.Vector3,
  end: THREE.Vector3,
  radius: number,
  material: THREE.Material,
): THREE.Mesh {
  const direction = end.clone().sub(start);
  const length = direction.length();
  if (!Number.isFinite(length) || length <= 1e-6) throw new Error('Web segment must have finite non-zero length.');
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 10, 1, false), material);
  mesh.position.copy(start).add(end).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.multiplyScalar(1 / length));
  return mesh;
}

function addPolyline(
  group: THREE.Group,
  points: THREE.Vector3[],
  radius: number,
  material: THREE.Material,
  prefix: string,
  detail: string,
): number {
  let count = 0;
  for (let index = 1; index < points.length; index += 1) {
    const segment = cylinderBetween(points[index - 1], points[index], radius, material);
    markPart(segment, `${prefix}_${String(index).padStart(2, '0')}`, '거미줄 봉제 세그먼트', detail);
    group.add(segment);
    count += 1;
  }
  return count;
}

function ellipsePoints(
  center: THREE.Vector3,
  radiusX: number,
  radiusY: number,
  segments: number,
  startAngle = 0,
  endAngle = Math.PI * 2,
): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];
  for (let index = 0; index <= segments; index += 1) {
    const angle = THREE.MathUtils.lerp(startAngle, endAngle, index / segments);
    points.push(new THREE.Vector3(
      center.x + Math.cos(angle) * radiusX,
      center.y + Math.sin(angle) * radiusY,
      center.z,
    ));
  }
  return points;
}

function eyeGeometry(radius: number, inset: number): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(radius * 0.1 * inset, -radius * 0.42 * inset);
  shape.quadraticCurveTo(radius * 0.48 * inset, -radius * 0.32 * inset, radius * 0.58 * inset, radius * 0.44 * inset);
  shape.quadraticCurveTo(radius * 0.28 * inset, radius * 0.36 * inset, radius * 0.08 * inset, radius * 0.16 * inset);
  shape.quadraticCurveTo(radius * 0.02 * inset, -radius * 0.08 * inset, radius * 0.1 * inset, -radius * 0.42 * inset);
  return new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.0012, radius * 0.055),
    bevelEnabled: true,
    bevelSegments: 3,
    bevelSize: Math.max(0.0005, radius * 0.014),
    bevelThickness: Math.max(0.0005, radius * 0.012),
    curveSegments: 18,
  });
}

function fittedMaskGeometry(halfHead: THREE.Vector3): THREE.SphereGeometry {
  const geometry = new THREE.SphereGeometry(1, 72, 52);
  const positions = geometry.getAttribute('position');
  for (let index = 0; index < positions.count; index += 1) {
    const normalizedY = positions.getY(index);
    const jaw = THREE.MathUtils.lerp(0.72, 1, THREE.MathUtils.smoothstep(normalizedY, -0.92, -0.08));
    positions.setXYZ(
      index,
      positions.getX(index) * halfHead.x * jaw,
      normalizedY * halfHead.y,
      positions.getZ(index) * halfHead.z * THREE.MathUtils.lerp(0.83, 1, jaw),
    );
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

function createMask(
  metrics: WebHeroDimensions,
  mode: ViewMode,
  pose: PoseStyle,
  redFabric: THREE.MeshPhysicalMaterial,
  webMaterial: THREE.MeshPhysicalMaterial,
  bezelMaterial: THREE.MeshPhysicalMaterial,
  lensMaterial: THREE.MeshPhysicalMaterial,
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'web_hero_mask_system';
  const faceSystem = new THREE.Group();
  faceSystem.name = 'mask_face_fitted_system';
  group.add(faceSystem);
  const radius = Math.max(metrics.headSize.x, metrics.headSize.y) * 0.5;
  const halfHead = metrics.headSize.clone().multiplyScalar(0.515);
  const mask = markPart(
    new THREE.Mesh(fittedMaskGeometry(halfHead), redFabric),
    'mask_shell',
    '전면 풀헤트 웹 마스크',
    '사진에서 확인된 적색 섬유 마스크; 후면 이음선은 추정',
  );
  mask.position.copy(metrics.headCenter);
  faceSystem.add(mask);

  const faceZ = metrics.headCenter.z + halfHead.z * 0.985;
  for (const side of [-1, 1] as const) {
    const bezel = markPart(
      new THREE.Mesh(eyeGeometry(radius * 0.82, 1), bezelMaterial),
      `eye_bezel_${side < 0 ? 'left' : 'right'}`,
      `${side < 0 ? '좌' : '우'}측 눈 렌즈 베젤`,
      '검은 프레임과 상단이 넓은 날카로운 실루엣',
    );
    bezel.scale.set(side, 1.08, 1);
    bezel.position.set(metrics.headCenter.x + side * halfHead.x * 0.065, metrics.headCenter.y + halfHead.y * 0.035, faceZ);
    faceSystem.add(bezel);

    const lens = markPart(
      new THREE.Mesh(eyeGeometry(radius * 0.82, 0.76), lensMaterial),
      `eye_lens_${side < 0 ? 'left' : 'right'}`,
      `${side < 0 ? '좌' : '우'}측 백색 광학 렌즈`,
      '사진의 흰색 메시 렌즈; 정확한 IOR·메시 피치는 추정',
    );
    lens.scale.set(side, 1.08, 1);
    lens.position.set(metrics.headCenter.x + side * halfHead.x * 0.065, metrics.headCenter.y + halfHead.y * 0.035, faceZ + radius * 0.018);
    faceSystem.add(lens);
  }

  const webRadius = Math.max(0.00055, metrics.heightMeters * 0.00036);
  const webCenter = new THREE.Vector3(metrics.headCenter.x, metrics.headCenter.y - halfHead.y * 0.02, faceZ + radius * 0.022);
  for (const [ringIndex, scale] of [0.24, 0.44, 0.66].entries()) {
    addPolyline(
      faceSystem,
      ellipsePoints(webCenter, halfHead.x * scale * 0.9, halfHead.y * scale, 18),
      webRadius,
      webMaterial,
      `mask_web_ring_${ringIndex + 1}`,
      '사진에서 확인된 마스크 방사형 거미줄 봉제',
    );
  }
  for (let ray = 0; ray < 8; ray += 1) {
    const angle = (ray / 8) * Math.PI * 2;
    addPolyline(faceSystem, [
      webCenter,
      new THREE.Vector3(
        webCenter.x + Math.cos(angle) * halfHead.x * 0.76,
        webCenter.y + Math.sin(angle) * halfHead.y * 0.78,
        webCenter.z,
      ),
    ], webRadius, webMaterial, `mask_web_ray_${ray + 1}`, '마스크 중앙에서 퍼지는 봉제');
  }

  const neckSeam = markPart(
    new THREE.Mesh(new THREE.TorusGeometry(metrics.heightMeters * 0.047, webRadius, 10, 56), webMaterial),
    'mask_neck_seam',
    '마스크 넥 실링 링',
    '마스크와 슈트 경계를 보존하는 분리 이음선',
  );
  neckSeam.position.copy(getPoseJoints(metrics.heightMeters, pose).neck);
  neckSeam.rotation.x = Math.PI / 2;
  group.add(neckSeam);

  if (pose === 'reference-action') {
    for (const child of faceSystem.children) child.position.sub(metrics.headCenter);
    faceSystem.position.copy(metrics.headCenter);
    faceSystem.rotation.z = 0.025;
  }

  group.userData.mode = mode;
  return group;
}

function createTorsoWeb(
  metrics: WebHeroDimensions,
  webMaterial: THREE.MeshPhysicalMaterial,
  emblemMaterial: THREE.MeshPhysicalMaterial,
  pose: PoseStyle,
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'web_hero_torso_detail';
  const height = metrics.heightMeters;
  const radius = Math.max(0.00052, height * 0.0003);
  const surfaceOffset = Math.max(height * 0.005, metrics.torsoFrontZ - height * 0.045);
  const onTorso = (x: number, y: number, z = surfaceOffset) => deformPointByReferencePose(
    new THREE.Vector3(x, y, z),
    height,
    pose,
  );
  const center = onTorso(0, height * 0.72);

  const endpoints = [
    onTorso(-height * 0.085, height * 0.805),
    onTorso(0, height * 0.825),
    onTorso(height * 0.085, height * 0.805),
    onTorso(height * 0.078, height * 0.605),
    onTorso(0, height * 0.575),
    onTorso(-height * 0.078, height * 0.605),
  ];
  endpoints.forEach((endpoint, index) => {
    addPolyline(group, [center, endpoint], radius, webMaterial, `torso_web_ray_${index + 1}`, '전면 가슴 방사형 웹 심');
  });
  for (const [ringIndex, scale] of [0.36, 0.68, 1].entries()) {
    addPolyline(
      group,
      ellipsePoints(new THREE.Vector3(0, height * 0.72, surfaceOffset), height * 0.075 * scale, height * 0.1 * scale, 16)
        .map((point) => onTorso(point.x, point.y, point.z)),
      radius,
      webMaterial,
      `torso_web_ring_${ringIndex + 1}`,
      '전면 가슴의 곡면 거미줄 봉제',
    );
  }

  const emblemCenter = onTorso(0, height * 0.72, surfaceOffset + height * 0.006);
  const emblemBody = markPart(
    new THREE.Mesh(new THREE.SphereGeometry(height * 0.008, 24, 16), emblemMaterial),
    'chest_spider_body',
    '가슴 중앙 거미 엠블럼 본체',
    '사진에서 보이는 어두운 가슴 문양을 분리 메시로 재구성',
  );
  emblemBody.position.copy(emblemCenter);
  emblemBody.scale.set(0.72, 2.15, 0.48);
  group.add(emblemBody);

  const legTargets = [
    [-0.03, 0.03], [-0.042, 0.011], [-0.041, -0.017], [-0.029, -0.038],
    [0.03, 0.03], [0.042, 0.011], [0.041, -0.017], [0.029, -0.038],
  ] as const;
  legTargets.forEach(([x, y], index) => {
    const side = x < 0 ? -1 : 1;
    const start = emblemCenter.clone().add(new THREE.Vector3(side * height * 0.006, y > 0 ? height * 0.015 : -height * 0.014, 0));
    const elbow = emblemCenter.clone().add(new THREE.Vector3(x * height * 0.62, y * height * 0.58, 0));
    const end = emblemCenter.clone().add(new THREE.Vector3(x * height, y * height, 0));
    addPolyline(group, [start, elbow, end], height * 0.00125, emblemMaterial, `chest_spider_leg_${index + 1}`, '가슴 거미 엠블럼의 8개 다리');
  });
  return group;
}

export function createWebHeroDetails(metrics: WebHeroDimensions, mode: ViewMode, pose: PoseStyle): WebHeroBuild {
  const group = new THREE.Group();
  group.name = 'web_hero_editable_details';

  const redFabric = createSurfaceMaterial({
    color: '#8a1734', surface: 'hex-knit', roughness: 0.67, sheen: 0.52,
    clearcoat: 0.07, clearcoatRoughness: 0.6, microNormalStrength: 0.82, textureScale: [42, 54],
  }, { mode, category: 'human', materialName: '적색 헥사곤 슈트 섬유' });
  const webMaterial = createSurfaceMaterial({
    color: '#4b1624', surface: 'soft-touch-polymer', roughness: 0.64,
    clearcoat: 0.1, microNormalStrength: 0.18, textureScale: [20, 20],
  }, { mode, category: 'human', materialName: '웹 슈트 검은 라인' });
  const bezelMaterial = createSurfaceMaterial({
    color: '#101217', surface: 'molded-polymer', roughness: 0.26,
    clearcoat: 0.52, clearcoatRoughness: 0.18,
  }, { mode, category: 'human', materialName: '렌즈 고광택 프레임' });
  const lensMaterial = createSurfaceMaterial({
    color: '#eef2e8', surface: 'optical-glass', roughness: 0.06,
    ior: 1.52, transmission: 0.16, clearcoat: 1, clearcoatRoughness: 0.04,
    microNormalStrength: 0.08, textureScale: [46, 46], thicknessMm: 2.4,
  }, { mode, category: 'human', materialName: '백색 마스크 메시 광학 렌즈' });
  const emblemMaterial = createSurfaceMaterial({
    color: '#1c1b20', surface: 'soft-touch-polymer', roughness: 0.34,
    clearcoat: 0.24, clearcoatRoughness: 0.22,
  }, { mode, category: 'human', materialName: '검정 가슴 거미 엠블럼' });

  group.add(
    createMask(metrics, mode, pose, redFabric, webMaterial, bezelMaterial, lensMaterial),
    createTorsoWeb(metrics, webMaterial, emblemMaterial, pose),
  );
  const parts: THREE.Mesh[] = [];
  group.traverse((object) => {
    if (object instanceof THREE.Mesh && object.userData.characterPart) parts.push(object);
  });
  const inferredParts = [
    'rear_mask_seam',
    'rear_suit_panel_boundary',
    'rear_emblem',
  ];
  group.userData.referenceEvidence = {
    sourceViews: ['front-three-quarter'],
    visibleParts: parts.map((part) => part.name),
    inferredParts,
    posePolicy: pose === 'reference-action'
      ? 'reference-action-estimate: forward hands, asymmetric lift, torso lean, staggered knees; hidden joint rotations inferred'
      : 'neutral-a-pose-for-editable-game-asset',
  };
  return {
    group,
    namedParts: parts.length,
    visibleEvidenceParts: parts.length,
    inferredParts,
  };
}
