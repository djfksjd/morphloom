import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { ProductSpec, ViewMode } from '../types';
import { buildOrnateKnife } from './knife';

export interface ProductPartInfo {
  id: string;
  name: string;
  category: 'enclosure' | 'display' | 'logic' | 'power' | 'camera' | 'audio' | 'radio' | 'mechanical';
  material: string;
  detail: string;
}

export interface ProductMetrics {
  vertices: number;
  triangles: number;
  heightMeters: number;
  bounds: THREE.Box3;
  parts: number;
  categories: number;
}

export interface ProductBuild {
  root: THREE.Group;
  metrics: ProductMetrics;
  parts: ProductPartInfo[];
}

interface PartOptions {
  id: string;
  name: string;
  category: ProductPartInfo['category'];
  material: string;
  detail: string;
  size: [number, number, number];
  position: [number, number, number];
  color: string;
  roughness?: number;
  metalness?: number;
  transmission?: number;
  radius?: number;
  emissive?: string;
}

const mm = (value: number) => value / 1000;

function physicalMaterial(options: PartOptions, mode: ViewMode): THREE.MeshPhysicalMaterial {
  const clay = mode === 'clay';
  return new THREE.MeshPhysicalMaterial({
    color: clay ? '#c5c6c3' : options.color,
    roughness: clay ? 0.82 : (options.roughness ?? 0.5),
    metalness: clay ? 0 : (options.metalness ?? 0.05),
    transmission: mode === 'beauty' ? (options.transmission ?? 0) : 0,
    transparent: Boolean(options.transmission),
    opacity: options.transmission ? Math.max(0.24, 1 - options.transmission * 0.7) : 1,
    thickness: options.transmission ? mm(1) : 0,
    clearcoat: mode === 'beauty' ? 0.18 : 0,
    clearcoatRoughness: 0.4,
    emissive: options.emissive ?? '#000000',
    emissiveIntensity: options.emissive ? 0.35 : 0,
    wireframe: mode === 'wireframe',
  });
}

function addPart(root: THREE.Group, parts: ProductPartInfo[], mode: ViewMode, options: PartOptions): THREE.Mesh {
  const [sx, sy, sz] = options.size;
  const radius = Math.min(options.radius ?? 0.0012, sx * 0.48, sy * 0.48, sz * 0.48);
  const geometry = radius > 0.00005
    ? new RoundedBoxGeometry(sx, sy, sz, 3, radius)
    : new THREE.BoxGeometry(sx, sy, sz, 2, 2, 1);
  const mesh = new THREE.Mesh(geometry, physicalMaterial(options, mode));
  mesh.name = options.id;
  mesh.position.set(...options.position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.part = {
    id: options.id,
    name: options.name,
    category: options.category,
    material: options.material,
    detail: options.detail,
  } satisfies ProductPartInfo;
  root.add(mesh);
  parts.push(mesh.userData.part as ProductPartInfo);
  return mesh;
}

function addCylinderPart(
  root: THREE.Group,
  parts: ProductPartInfo[],
  mode: ViewMode,
  options: Omit<PartOptions, 'size'> & { radiusMm: number; depthMm: number; segments?: number },
): THREE.Mesh {
  const geometry = new THREE.CylinderGeometry(
    mm(options.radiusMm),
    mm(options.radiusMm),
    mm(options.depthMm),
    options.segments ?? 48,
    2,
  );
  const mesh = new THREE.Mesh(geometry, physicalMaterial({ ...options, size: [1, 1, 1] }, mode));
  mesh.name = options.id;
  mesh.rotation.x = Math.PI / 2;
  mesh.position.set(...options.position);
  mesh.castShadow = true;
  mesh.userData.part = {
    id: options.id,
    name: options.name,
    category: options.category,
    material: options.material,
    detail: options.detail,
  } satisfies ProductPartInfo;
  root.add(mesh);
  parts.push(mesh.userData.part as ProductPartInfo);
  return mesh;
}

function createCameraModule(
  root: THREE.Group,
  parts: ProductPartInfo[],
  mode: ViewMode,
  id: string,
  label: string,
  x: number,
  y: number,
  z: number,
  explode: number,
): void {
  addPart(root, parts, mode, {
    id: `${id}_housing`, name: `${label} 카메라 하우징`, category: 'camera', material: '알루미늄/폴리머',
    detail: '렌즈 배럴과 OIS 구동계를 고정하는 독립 모듈', size: [mm(15.4), mm(15.4), mm(4.8)],
    position: [x, y, z + explode * mm(8)], color: '#24272a', roughness: 0.38, metalness: 0.42, radius: mm(2.2),
  });
  addCylinderPart(root, parts, mode, {
    id: `${id}_sensor`, name: `${label} CMOS 이미지 센서`, category: 'camera', material: '실리콘/세라믹',
    detail: '광신호를 전기신호로 변환하는 적층형 센서 패키지', radiusMm: 4.7, depthMm: 0.65,
    position: [x, y, z + mm(3.1) + explode * mm(13)], color: '#17455a', roughness: 0.2, metalness: 0.16,
  });
  for (let layer = 0; layer < 5; layer += 1) {
    addCylinderPart(root, parts, mode, {
      id: `${id}_lens_${layer + 1}`, name: `${label} 렌즈 ${layer + 1}`, category: 'camera', material: '광학 유리',
      detail: `다군 렌즈 스택의 ${layer + 1}번째 광학 요소`, radiusMm: 5.4 - layer * 0.28, depthMm: 0.55,
      position: [x, y, z + mm(4.2 + layer * 0.72) + explode * mm(17 + layer * 3.2)],
      color: layer % 2 ? '#315e73' : '#142936', roughness: 0.08, metalness: 0.05, transmission: 0.38,
    });
  }
}

function createChip(
  root: THREE.Group,
  parts: ProductPartInfo[],
  mode: ViewMode,
  id: string,
  name: string,
  x: number,
  y: number,
  sx: number,
  sy: number,
  z: number,
  explode: number,
): void {
  addPart(root, parts, mode, {
    id, name, category: 'logic', material: '에폭시 몰드/BGA',
    detail: '메인보드 실장 반도체 패키지 · 개별 선택 및 BOM 추적 가능',
    size: [mm(sx), mm(sy), mm(0.85)], position: [mm(x), mm(y), z + explode * mm(1.6)],
    color: '#16191a', roughness: 0.32, metalness: 0.2, radius: mm(0.55),
  });
}

export function buildProduct(spec: ProductSpec, mode: ViewMode): ProductBuild {
  if (spec.kind === 'ornate-knife') return buildOrnateKnife(spec, mode);
  const root = new THREE.Group();
  root.name = 'morphloom_smartphone_assembly';
  const parts: ProductPartInfo[] = [];
  const w = mm(spec.widthMm);
  const h = mm(spec.heightMm);
  const d = mm(spec.depthMm);
  const e = spec.explode;

  root.userData.assemblyIR = { version: '0.1', kind: 'smartphone', spec: structuredClone(spec) };

  addPart(root, parts, mode, {
    id: 'rear_glass', name: '후면 강화유리', category: 'enclosure', material: '세라믹 강화유리',
    detail: '무선충전 투과 영역과 카메라 개구를 갖는 후면 패널', size: [w * 0.96, h * 0.978, mm(0.72)],
    position: [0, 0, -d * 0.45 - e * mm(18)], color: spec.glassColor, roughness: 0.16, transmission: 0.08,
    radius: mm(spec.cornerRadiusMm * 0.78),
  });
  addPart(root, parts, mode, {
    id: 'mid_frame', name: '구조용 미드프레임', category: 'enclosure', material: '재생 알루미늄',
    detail: '전체 부품의 기준면과 낙하 충격 경로를 제공하는 CNC 프레임', size: [w, h, mm(2.05)],
    position: [0, 0, -e * mm(4)], color: spec.frameColor, roughness: 0.28, metalness: 0.78,
    radius: mm(spec.cornerRadiusMm),
  });

  const boardZ = e * mm(1.5);
  addPart(root, parts, mode, {
    id: 'logic_board', name: '다층 메인 로직 보드', category: 'logic', material: 'FR-4/구리 10층',
    detail: 'SoC·메모리·전력관리·RF 회로가 실장되는 고밀도 다층 PCB', size: [mm(59), mm(51), mm(0.82)],
    position: [0, mm(47), boardZ], color: spec.boardColor, roughness: 0.5, metalness: 0.12, radius: mm(4),
  });
  createChip(root, parts, mode, 'soc', '애플리케이션 프로세서 SoC', -12, 52, 13.5, 13.5, boardZ, e);
  createChip(root, parts, mode, 'dram', 'LPDDR 메모리', 4, 52, 10.5, 13, boardZ, e);
  createChip(root, parts, mode, 'nand', 'NAND 저장장치', 17.5, 50, 10, 14, boardZ, e);
  createChip(root, parts, mode, 'pmic', '전력관리 IC', -14, 35.5, 8.5, 7.5, boardZ, e);
  createChip(root, parts, mode, 'rf_transceiver', 'RF 트랜시버', -2.5, 35.5, 8, 7.5, boardZ, e);
  createChip(root, parts, mode, 'wifi_chip', 'Wi‑Fi / Bluetooth IC', 9.5, 35.5, 7.5, 7.5, boardZ, e);
  createChip(root, parts, mode, 'uwb_chip', 'UWB 위치 IC', 19, 36, 6.5, 6.5, boardZ, e);

  const shieldSpecs: Array<[string, string, number, number, number, number]> = [
    ['rf_shield_1', 'RF 차폐 실드 A', -15, 59, 16, 10],
    ['rf_shield_2', 'RF 차폐 실드 B', 14, 59, 15, 10],
    ['rf_shield_3', '전원부 차폐 실드', 2, 39, 13, 8],
  ];
  for (const [id, name, x, y, sx, sy] of shieldSpecs) {
    addPart(root, parts, mode, {
      id, name, category: 'radio', material: '니켈실버',
      detail: '고주파 간섭을 억제하고 열을 분산하는 탈착식 실드 캔',
      size: [mm(sx), mm(sy), mm(0.55)], position: [mm(x), mm(y), boardZ - e * mm(2.4)],
      color: '#aeb1ae', roughness: 0.32, metalness: 0.86, radius: mm(0.8),
    });
  }

  const passivePositions: Array<[number, number]> = [
    [-25, 31], [-21, 31], [-17, 31], [-9, 31], [-5, 31], [1, 31], [7, 31], [13, 31], [20, 31], [24, 31],
    [-25, 37], [-21, 39], [-17, 42], [-9, 43], [-4, 45], [3, 46], [10, 44], [17, 44], [23, 43],
    [-25, 51], [-18, 48], [-8, 60], [6, 61], [22, 56],
  ];
  for (const [index, [x, y]] of passivePositions.entries()) {
    const capacitor = index % 3 === 0;
    addPart(root, parts, mode, {
      id: `smd_${String(index + 1).padStart(2, '0')}`,
      name: capacitor ? `MLCC 커패시터 ${index + 1}` : `칩 저항 ${index + 1}`,
      category: 'logic',
      material: capacitor ? '세라믹/니켈' : '알루미나/루테늄',
      detail: capacitor ? '전원 무결성과 고주파 디커플링용 적층 세라믹 커패시터' : '바이어스·종단·전류 감지를 위한 표면실장 저항',
      size: capacitor ? [mm(1.25), mm(0.7), mm(0.55)] : [mm(1.6), mm(0.78), mm(0.42)],
      position: [mm(x), mm(y), boardZ + e * mm(3.2)],
      color: capacitor ? '#c9b68f' : '#343538', roughness: 0.5, metalness: 0.22, radius: mm(0.12),
    });
  }

  for (let connector = 0; connector < 4; connector += 1) {
    addPart(root, parts, mode, {
      id: `board_connector_${connector + 1}`, name: `보드 커넥터 ${connector + 1}`, category: 'logic', material: 'LCP/금도금 구리',
      detail: 'FPC와 로직보드를 연결하는 초저높이 다핀 커넥터', size: [mm(8.5), mm(2.2), mm(1.1)],
      position: [mm(-19 + connector * 12.5), mm(26), boardZ + e * mm(4.4)], color: '#9f7b36', roughness: 0.32, metalness: 0.46, radius: mm(0.35),
    });
  }

  addPart(root, parts, mode, {
    id: 'battery', name: '리튬이온 배터리 셀', category: 'power', material: 'Li-ion 파우치/흑연',
    detail: '고밀도 파우치 셀 · 보호회로와 접착 풀탭을 별도 구성', size: [mm(60), mm(72), mm(3.9)],
    position: [0, mm(-17), e * mm(5.4)], color: spec.batteryColor, roughness: 0.58, metalness: 0.18, radius: mm(4.2),
  });
  addPart(root, parts, mode, {
    id: 'battery_bms', name: '배터리 보호회로 BMS', category: 'power', material: 'FR-4/니켈',
    detail: '과전압·과전류·온도를 감시하는 셀 보호 보드', size: [mm(37), mm(7), mm(1)],
    position: [0, mm(20.5), e * mm(7.7)], color: '#1b4736', roughness: 0.46, radius: mm(1),
  });

  const cameraZ = boardZ + mm(1.2);
  createCameraModule(root, parts, mode, 'wide_camera', '광각', mm(-21.5), mm(63), cameraZ, e);
  createCameraModule(root, parts, mode, 'ultrawide_camera', '초광각', mm(0), mm(63), cameraZ, e);
  createCameraModule(root, parts, mode, 'tele_camera', '망원', mm(-21.5), mm(42), cameraZ, e);
  addCylinderPart(root, parts, mode, {
    id: 'lidar', name: 'ToF 깊이 센서', category: 'camera', material: '광학 유리/VCSEL',
    detail: '비행시간 방식 깊이 측정 모듈', radiusMm: 4.2, depthMm: 2.1,
    position: [mm(0), mm(43), cameraZ + e * mm(3)], color: '#182b33', roughness: 0.14, transmission: 0.22,
  });

  addPart(root, parts, mode, {
    id: 'taptic_motor', name: '선형 햅틱 액추에이터', category: 'mechanical', material: '텅스텐/구리/스틸',
    detail: '정밀 촉각 피드백을 생성하는 선형 공진 액추에이터', size: [mm(38), mm(11.5), mm(3.8)],
    position: [mm(-9), mm(-62), e * mm(5.1)], color: '#8c8f8e', roughness: 0.35, metalness: 0.84, radius: mm(2.4),
  });
  addPart(root, parts, mode, {
    id: 'bottom_speaker', name: '하단 스피커 모듈', category: 'audio', material: '네오디뮴/폴리머',
    detail: '밀폐형 음향 챔버와 드라이버 어셈블리', size: [mm(29), mm(15), mm(4.2)],
    position: [mm(19), mm(-62), e * mm(5.2)], color: '#24272a', roughness: 0.58, radius: mm(3),
  });
  addPart(root, parts, mode, {
    id: 'earpiece', name: '수화 스피커', category: 'audio', material: '네오디뮴/구리',
    detail: '상단 통화 음향과 스테레오 출력을 담당', size: [mm(22), mm(5.2), mm(2.4)],
    position: [0, mm(73), e * mm(4.5)], color: '#2b2e31', roughness: 0.5, radius: mm(1.3),
  });

  addCylinderPart(root, parts, mode, {
    id: 'wireless_coil', name: '무선충전 코일', category: 'power', material: '에나멜 구리/페라이트',
    detail: 'Qi 유도전력 수신 코일', radiusMm: 22, depthMm: 0.55,
    position: [0, mm(-8), e * mm(9.4)], color: '#a4672c', roughness: 0.45, metalness: 0.68, segments: 72,
  });
  addPart(root, parts, mode, {
    id: 'nfc_antenna', name: 'NFC 안테나 필름', category: 'radio', material: '구리/폴리이미드',
    detail: '근거리 통신용 인쇄 안테나와 정합 네트워크', size: [mm(52), mm(46), mm(0.22)],
    position: [0, mm(-8), e * mm(11.2)], color: '#a77732', roughness: 0.5, metalness: 0.48, radius: mm(12),
  });
  addPart(root, parts, mode, {
    id: 'usb_c_port', name: 'USB‑C 포트', category: 'logic', material: '스테인리스/액정폴리머',
    detail: '24핀 데이터·충전 커넥터 및 고정 실드', size: [mm(10.4), mm(7.5), mm(3.2)],
    position: [0, mm(-75), e * mm(5)], color: '#a5a8a7', roughness: 0.25, metalness: 0.88, radius: mm(1.5),
  });

  for (let flex = 0; flex < 5; flex += 1) {
    addPart(root, parts, mode, {
      id: `flex_${flex + 1}`, name: `연성 회로 케이블 ${flex + 1}`, category: 'logic', material: '폴리이미드/구리',
      detail: '모듈 간 전원·고속 신호를 전달하는 FPC', size: [mm(4 + flex * 1.4), mm(23 - flex * 2.2), mm(0.18)],
      position: [mm(-22 + flex * 11), mm(8 - flex * 5), e * mm(12.8 + flex * 0.35)], color: '#bd7432', roughness: 0.48, metalness: 0.24, radius: mm(1),
    });
  }

  const screwPoints: Array<[number, number]> = [
    [-30, 70], [30, 70], [-31, 28], [31, 28], [-31, -22], [31, -22], [-29, -68], [29, -68], [-12, -72], [12, -72],
  ];
  for (const [index, [x, y]] of screwPoints.entries()) {
    addCylinderPart(root, parts, mode, {
      id: `screw_${index + 1}`, name: `정밀 고정 나사 ${index + 1}`, category: 'mechanical', material: '스테인리스 스틸',
      detail: '프레임과 모듈을 기준 토크로 체결하는 M1급 패스너', radiusMm: 0.85, depthMm: 1.4,
      position: [mm(x), mm(y), e * mm(14.5)], color: '#afb2b1', roughness: 0.28, metalness: 0.92, segments: 20,
    });
  }

  addPart(root, parts, mode, {
    id: 'display_oled', name: 'OLED 발광 패널', category: 'display', material: '유기 발광층/TFT',
    detail: '서브픽셀 발광층과 LTPO TFT 백플레인', size: [w * 0.93, h * 0.958, mm(0.34)],
    position: [0, 0, d * 0.38 + e * mm(19)], color: '#111927', roughness: 0.19, emissive: '#0c1c34', radius: mm(spec.cornerRadiusMm * 0.74),
  });
  addPart(root, parts, mode, {
    id: 'touch_digitizer', name: '터치 디지타이저', category: 'display', material: 'ITO 투명전극',
    detail: '정전식 멀티터치 감지 전극층', size: [w * 0.94, h * 0.962, mm(0.2)],
    position: [0, 0, d * 0.42 + e * mm(23)], color: '#53697b', roughness: 0.12, transmission: 0.36, radius: mm(spec.cornerRadiusMm * 0.76),
  });
  addPart(root, parts, mode, {
    id: 'polarizer', name: '원형 편광판', category: 'display', material: '광학 폴리머',
    detail: '외광 반사를 억제하고 OLED 대비를 유지하는 편광층', size: [w * 0.95, h * 0.968, mm(0.18)],
    position: [0, 0, d * 0.45 + e * mm(27)], color: '#263544', roughness: 0.11, transmission: 0.48, radius: mm(spec.cornerRadiusMm * 0.78),
  });
  addPart(root, parts, mode, {
    id: 'cover_glass', name: '전면 커버 글라스', category: 'display', material: '강화 알루미노실리케이트',
    detail: '올레포빅 코팅과 곡면 가장자리를 갖는 최외곽 보호 유리', size: [w * 0.978, h * 0.985, mm(0.72)],
    position: [0, 0, d * 0.48 + e * mm(32)], color: '#a8bdd1', roughness: 0.08, transmission: 0.62, radius: mm(spec.cornerRadiusMm * 0.9),
  });

  root.rotation.x = -0.04;
  root.rotation.y = -0.08;

  let vertices = 0;
  let triangles = 0;
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const position = object.geometry.getAttribute('position');
    vertices += position?.count ?? 0;
    const index = object.geometry.getIndex();
    triangles += index ? index.count / 3 : (position?.count ?? 0) / 3;
  });
  const bounds = new THREE.Box3().setFromObject(root);
  return {
    root,
    parts,
    metrics: {
      vertices,
      triangles,
      heightMeters: h,
      bounds,
      parts: parts.length,
      categories: new Set(parts.map((part) => part.category)).size,
    },
  };
}
