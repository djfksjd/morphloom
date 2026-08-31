import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { ProductSpec, ViewMode } from '../types';
import { buildOrnateKnife } from './knife';
import { compileElectricalHarness, type ConnectivityReport } from './connectivity';
import type { AssemblyMaterialIR, ElectricalHarnessIR, ElectricalPortIR, ElectricalSignalIR, ElectricalWireIR } from './assembly-ir';
import { createSurfaceMaterial, inferSurfaceFinish, inspectSurfaceSystem, type SurfaceReport } from './surface-system';
import { analyzeTopology, type MeshTopologyReport } from './topology';
import type { EngineeringAuditReport } from './engineering-audit';

export interface ProductPartInfo {
  id: string;
  name: string;
  category: 'enclosure' | 'display' | 'logic' | 'power' | 'camera' | 'audio' | 'radio' | 'mechanical' | 'interconnect';
  material: string;
  surface: string;
  detail: string;
  level?: string;
}

export interface ProductMetrics {
  vertices: number;
  triangles: number;
  heightMeters: number;
  bounds: THREE.Box3;
  parts: number;
  categories: number;
  connectivity?: ConnectivityReport;
  surfaces: SurfaceReport;
  topology: MeshTopologyReport;
  engineering?: EngineeringAuditReport;
}

export interface ProductBuild {
  root: THREE.Group;
  metrics: ProductMetrics;
  parts: ProductPartInfo[];
}

interface PartOptions extends AssemblyMaterialIR {
  id: string;
  name: string;
  category: ProductPartInfo['category'];
  material: string;
  detail: string;
  size: [number, number, number];
  position: [number, number, number];
  radius?: number;
}

const mm = (value: number) => value / 1000;

function physicalMaterial(options: PartOptions, mode: ViewMode): THREE.MeshPhysicalMaterial {
  return createSurfaceMaterial(options, { mode, category: options.category, materialName: `${options.material} ${options.id}` });
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
    surface: inferSurfaceFinish(`${options.material} ${options.id}`, options.surface),
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
    surface: inferSurfaceFinish(`${options.material} ${options.id}`, options.surface),
    detail: options.detail,
  } satisfies ProductPartInfo;
  root.add(mesh);
  parts.push(mesh.userData.part as ProductPartInfo);
  return mesh;
}

function addTorusPart(
  root: THREE.Group,
  parts: ProductPartInfo[],
  mode: ViewMode,
  options: Omit<PartOptions, 'size'> & { radiusMm: number; tubeMm: number; radialSegments?: number; tubularSegments?: number },
): THREE.Mesh {
  const geometry = new THREE.TorusGeometry(
    mm(options.radiusMm),
    mm(options.tubeMm),
    options.radialSegments ?? 14,
    options.tubularSegments ?? 64,
  );
  const mesh = new THREE.Mesh(geometry, physicalMaterial({ ...options, size: [1, 1, 1] }, mode));
  mesh.name = options.id;
  mesh.position.set(...options.position);
  mesh.castShadow = true;
  mesh.userData.part = {
    id: options.id,
    name: options.name,
    category: options.category,
    material: options.material,
    surface: inferSurfaceFinish(`${options.material} ${options.id}`, options.surface),
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
    position: [x, y, z + explode * mm(8)], color: '#24272a', surface: 'anodized-metal', roughness: 0.38, metalness: 0.72, radius: mm(2.2),
  });
  addCylinderPart(root, parts, mode, {
    id: `${id}_sensor`, name: `${label} CMOS 이미지 센서`, category: 'camera', material: '실리콘/세라믹',
    detail: '광신호를 전기신호로 변환하는 적층형 센서 패키지', radiusMm: 4.7, depthMm: 0.65,
    position: [x, y, z + mm(3.1) + explode * mm(13)], color: '#17455a', surface: 'semiconductor', roughness: 0.2, metalness: 0.16,
  });
  for (let layer = 0; layer < 5; layer += 1) {
    addCylinderPart(root, parts, mode, {
      id: `${id}_lens_${layer + 1}`, name: `${label} 렌즈 ${layer + 1}`, category: 'camera', material: '광학 유리',
      detail: `다군 렌즈 스택의 ${layer + 1}번째 광학 요소`, radiusMm: 5.4 - layer * 0.28, depthMm: 0.55,
      position: [x, y, z + mm(4.2 + layer * 0.72) + explode * mm(17 + layer * 3.2)],
      color: layer % 2 ? '#315e73' : '#142936', surface: 'optical-glass', roughness: 0.045, metalness: 0, transmission: 0.52,
      ior: 1.56, iridescence: 0.18, thicknessMm: 0.55,
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

function createExteriorCameraSystem(
  root: THREE.Group,
  parts: ProductPartInfo[],
  mode: ViewMode,
  rearZ: number,
): void {
  const islandZ = rearZ - mm(1.05);
  addPart(root, parts, mode, {
    id: 'camera_island', name: '정밀 카메라 아일랜드', category: 'enclosure', material: 'CNC 알루미늄/무광 유리',
    detail: '세 개의 광학 모듈·플래시·ToF·마이크를 개별 개구로 고정하는 후면 구조물',
    size: [mm(45), mm(55), mm(1.5)], position: [mm(-10.8), mm(52.8), islandZ],
    color: '#22262b', surface: 'anodized-metal', roughness: 0.24, metalness: 0.78, radius: mm(7.2),
  });

  const cameraCovers: Array<[string, string, number, number]> = [
    ['wide', '광각', -21.5, 63],
    ['ultrawide', '초광각', 0, 63],
    ['tele', '망원', -21.5, 42],
  ];
  for (const [id, label, x, y] of cameraCovers) {
    addTorusPart(root, parts, mode, {
      id: `${id}_outer_bezel`, name: `${label} 티타늄 외부 베젤`, category: 'camera', material: 'PVD 티타늄',
      detail: '충격으로부터 렌즈 윈도를 보호하는 미세 동심 가공 금속 링', radiusMm: 7.25, tubeMm: 1.05,
      position: [mm(x), mm(y), islandZ - mm(1.05)], color: '#9aa3aa', surface: 'polished-metal', roughness: 0.16, metalness: 0.96, anisotropy: 0.42,
    });
    addCylinderPart(root, parts, mode, {
      id: `${id}_sapphire_window`, name: `${label} 사파이어 윈도`, category: 'camera', material: '사파이어/AR 코팅',
      detail: '다층 반사 방지 코팅을 적용한 외부 보호 광학창', radiusMm: 6.35, depthMm: 0.72,
      position: [mm(x), mm(y), islandZ - mm(1.32)], color: '#193448', surface: 'sapphire', roughness: 0.025, transmission: 0.56, ior: 1.76, thicknessMm: 0.72,
    });
    addTorusPart(root, parts, mode, {
      id: `${id}_inner_bezel`, name: `${label} 내부 차광 링`, category: 'camera', material: '흑색 양극산화 알루미늄',
      detail: '고스트와 플레어를 억제하는 내부 배럴 차광 구조', radiusMm: 4.15, tubeMm: 0.62,
      position: [mm(x), mm(y), islandZ - mm(1.76)], color: '#11171b', surface: 'anodized-metal', roughness: 0.18, metalness: 0.72,
    });
    addCylinderPart(root, parts, mode, {
      id: `${id}_visible_aperture`, name: `${label} 가시 조리개`, category: 'camera', material: '광학 흑색 코팅',
      detail: '외부에서 관찰되는 유효 입사동과 1차 렌즈 반사층', radiusMm: 2.55, depthMm: 0.38,
      position: [mm(x), mm(y), islandZ - mm(1.94)], color: id === 'tele' ? '#17283a' : '#0b1822', roughness: 0.08, metalness: 0.08,
    });
  }

  addTorusPart(root, parts, mode, {
    id: 'flash_retaining_ring', name: 'True-tone 플래시 링', category: 'camera', material: '스테인리스 스틸',
    detail: '플래시 확산판을 카메라 아일랜드에 고정하는 링', radiusMm: 4.35, tubeMm: 0.55,
    position: [mm(0), mm(43), islandZ - mm(1.05)], color: '#c7b98f', roughness: 0.3, metalness: 0.76,
  });
  addCylinderPart(root, parts, mode, {
    id: 'flash_diffuser', name: '듀얼톤 플래시 확산판', category: 'camera', material: '광학 실리콘/형광체',
    detail: '색온도가 다른 LED를 혼합하는 미세 확산 구조', radiusMm: 3.65, depthMm: 0.58,
    position: [0, mm(43), islandZ - mm(1.34)], color: '#f0e4b7', surface: 'optical-glass', roughness: 0.22, transmission: 0.25, emissive: '#c8ae72',
  });
  addCylinderPart(root, parts, mode, {
    id: 'lidar_cover_window', name: 'ToF/LiDAR 외부 윈도', category: 'camera', material: 'IR 투과 유리',
    detail: '근적외선 송수신을 위한 저반사 외부 커버', radiusMm: 3.25, depthMm: 0.5,
    position: [mm(0), mm(52), islandZ - mm(1.3)], color: '#162a31', surface: 'optical-glass', roughness: 0.07, transmission: 0.4, ior: 1.52,
  });
  addCylinderPart(root, parts, mode, {
    id: 'rear_microphone_port', name: '후면 마이크 포트', category: 'audio', material: '스테인리스 메시',
    detail: '영상 촬영 지향성 오디오용 방진·방수 음향 포트', radiusMm: 0.9, depthMm: 0.46,
    position: [mm(8.5), mm(45.5), islandZ - mm(1.28)], color: '#090b0d', roughness: 0.52, metalness: 0.35,
  });
}

function createExteriorShellDetails(
  root: THREE.Group,
  parts: ProductPartInfo[],
  mode: ViewMode,
  width: number,
  height: number,
  depth: number,
  frontZ: number,
  frameColor: string,
): void {
  const railZ = frontZ + mm(0.46);
  const railColor = '#171b20';
  const rails: Array<[string, [number, number, number], [number, number, number]]> = [
    ['front_bezel_left', [mm(1.7), height * 0.91, mm(0.52)], [-width * 0.472, 0, railZ]],
    ['front_bezel_right', [mm(1.7), height * 0.91, mm(0.52)], [width * 0.472, 0, railZ]],
    ['front_bezel_top', [width * 0.9, mm(1.8), mm(0.52)], [0, height * 0.465, railZ]],
    ['front_bezel_bottom', [width * 0.9, mm(2.2), mm(0.52)], [0, -height * 0.463, railZ]],
  ];
  for (const [id, size, position] of rails) {
    addPart(root, parts, mode, {
      id, name: `전면 베젤 ${id.split('_').at(-1)}`, category: 'display', material: '광학 흑색 폴리머',
      detail: '디스플레이 비활성 경계를 가리는 초박형 전면 베젤', size, position,
      color: railColor, roughness: 0.28, radius: mm(0.7),
    });
  }
  addPart(root, parts, mode, {
    id: 'front_sensor_island', name: '전면 센서 아일랜드', category: 'display', material: 'IR 투과 유리',
    detail: '셀피 카메라·근접 센서·조도 센서를 수용하는 전면 개구', size: [mm(20), mm(5.2), mm(0.58)],
    position: [0, height * 0.423, railZ + mm(0.12)], color: '#080d13', roughness: 0.08, radius: mm(2.6),
  });
  addTorusPart(root, parts, mode, {
    id: 'selfie_camera_bezel', name: '전면 카메라 베젤', category: 'camera', material: '흑색 알루미늄',
    detail: '전면 카메라 렌즈의 미세 차광 링', radiusMm: 1.65, tubeMm: 0.32,
    position: [mm(5.1), height * 0.423, railZ + mm(0.46)], color: '#1a242c', roughness: 0.2, metalness: 0.54,
  });
  addCylinderPart(root, parts, mode, {
    id: 'selfie_camera_window', name: '전면 카메라 광학창', category: 'camera', material: 'AR 코팅 유리',
    detail: '전면 카메라의 반사 방지 보호 윈도', radiusMm: 1.3, depthMm: 0.34,
    position: [mm(5.1), height * 0.423, railZ + mm(0.54)], color: '#16324a', surface: 'sapphire', roughness: 0.035, transmission: 0.48, ior: 1.76,
  });
  addPart(root, parts, mode, {
    id: 'front_earpiece_grille', name: '전면 수화부 메시', category: 'audio', material: '레이저 천공 스테인리스',
    detail: '방진 메시와 미세 음향 슬롯을 포함한 수화부 출구', size: [mm(9.5), mm(0.75), mm(0.42)],
    position: [mm(-2.8), height * 0.423, railZ + mm(0.5)], color: '#3b4248', roughness: 0.46, metalness: 0.62, radius: mm(0.3),
  });

  const sideX = width * 0.505;
  const buttons: Array<[string, string, number, number]> = [
    ['power_button', '측면 전원 버튼', sideX, 31],
    ['volume_up_button', '볼륨 증가 버튼', -sideX, 35],
    ['volume_down_button', '볼륨 감소 버튼', -sideX, 20],
    ['action_button', '기능 버튼', -sideX, 51],
  ];
  for (const [id, name, x, y] of buttons) {
    addPart(root, parts, mode, {
      id, name, category: 'mechanical', material: '양극산화 알루미늄',
      detail: '프레임과 독립된 클릭 돔·실링 구조를 가진 외부 조작 버튼', size: [mm(1.35), mm(id === 'action_button' ? 7 : 11), depth * 0.52],
      position: [x, mm(y), 0], color: frameColor, roughness: 0.25, metalness: 0.82, radius: mm(0.55),
    });
  }
  addPart(root, parts, mode, {
    id: 'sim_tray', name: 'SIM 트레이', category: 'mechanical', material: '알루미늄/LCP 실링',
    detail: '이젝트 핀 홀과 방수 가스켓을 갖는 측면 트레이', size: [mm(1.05), mm(19), depth * 0.6],
    position: [sideX, mm(-22), 0], color: frameColor, roughness: 0.27, metalness: 0.78, radius: mm(0.45),
  });

  for (let breakIndex = 0; breakIndex < 8; breakIndex += 1) {
    const right = breakIndex % 2 === 0;
    addPart(root, parts, mode, {
      id: `antenna_break_${breakIndex + 1}`, name: `안테나 절연선 ${breakIndex + 1}`, category: 'radio', material: 'RF 투과 폴리머',
      detail: '금속 프레임의 안테나 구간을 전기적으로 분리하는 사출 절연부', size: [mm(1.5), mm(2.1), depth * 0.96],
      position: [right ? sideX : -sideX, mm(67 - Math.floor(breakIndex / 2) * 44), 0], color: '#70777b', roughness: 0.38, radius: mm(0.25),
    });
  }

  addPart(root, parts, mode, {
    id: 'usb_c_throat', name: 'USB-C 외부 개구', category: 'enclosure', material: '흑색 LCP/스테인리스',
    detail: '프레임 하단의 실제 케이블 삽입 개구와 금속 실드', size: [mm(10.2), mm(2.2), mm(3.5)],
    position: [0, -height * 0.501, 0], color: '#11161a', roughness: 0.32, metalness: 0.45, radius: mm(1.05),
  });
  for (let hole = 0; hole < 12; hole += 1) {
    const leftBank = hole < 6;
    addPart(root, parts, mode, {
      id: `bottom_acoustic_port_${hole + 1}`, name: `하단 음향 포트 ${hole + 1}`, category: 'audio', material: '스테인리스 메시',
      detail: leftBank ? '마이크와 기압 센서용 미세 음향 개구' : '하단 스피커 챔버의 음향 출구',
      size: [mm(1.25), mm(1.05), mm(1.65)],
      position: [mm((leftBank ? -18 : 11) + (hole % 6) * 2.8), -height * 0.501, 0],
      color: '#111417', roughness: 0.55, metalness: 0.36, radius: mm(0.42),
    });
  }
}

function createSmartphoneHarness(): ElectricalHarnessIR {
  const ports: ElectricalPortIR[] = [];
  const wires: ElectricalWireIR[] = [];
  const addPort = (
    componentId: string,
    pin: string,
    signal: ElectricalSignalIR,
    position: [number, number, number],
    direction: [number, number, number] = [0, 0, 1],
    physicalPin = pin,
  ) => {
    const id = `${componentId}_${pin}`;
    ports.push({ id, componentId, pin, physicalPin, signal, position, direction, required: true, maxConnections: 1 });
    return id;
  };
  const addWire = (
    id: string,
    name: string,
    net: string,
    signal: ElectricalSignalIR,
    from: string,
    to: string,
    color: string,
    diameter = 0.46,
    shielded = false,
  ) => wires.push({
    id, name, net, signal, from, to, color, diameter, shielded,
    gauge: diameter >= 0.65 ? '22AWG' : diameter >= 0.42 ? '26AWG' : '30AWG',
    verification: 'design',
  });

  const cellPositive = addPort('battery', 'cell_pos', 'power', [-13, 36, 2.1], [0, 1, 0]);
  const cellNegative = addPort('battery', 'cell_neg', 'ground', [13, 36, 2.1], [0, 1, 0]);
  const bmsCellPositive = addPort('battery_bms', 'cell_pos_in', 'power', [-12, -3.6, 0.6], [0, -1, 0]);
  const bmsCellNegative = addPort('battery_bms', 'cell_neg_in', 'ground', [12, -3.6, 0.6], [0, -1, 0]);
  const bmsVbat = addPort('battery_bms', 'vbat_out', 'power', [-12, 3.6, 0.6], [0, 1, 0]);
  const bmsGround = addPort('battery_bms', 'system_gnd', 'ground', [12, 3.6, 0.6], [0, 1, 0]);
  const pmicVbat = addPort('pmic', 'vbat_in', 'power', [-3, -3.9, 0.5], [0, -1, 0]);
  const pmicGround = addPort('pmic', 'system_gnd', 'ground', [3, -3.9, 0.5], [0, -1, 0]);
  addWire('wire_cell_positive', '배터리 셀 양극', 'VBAT_CELL_POS', 'power', cellPositive, bmsCellPositive, '#df4f3f', 0.72);
  addWire('wire_cell_negative', '배터리 셀 음극', 'VBAT_CELL_NEG', 'ground', cellNegative, bmsCellNegative, '#20252d', 0.72);
  addWire('wire_bms_vbat', 'BMS 시스템 전원', 'VBAT_SYS', 'power', bmsVbat, pmicVbat, '#e45442', 0.66);
  addWire('wire_bms_ground', 'BMS 시스템 접지', 'GND_SYS', 'ground', bmsGround, pmicGround, '#252a31', 0.66);

  const connectorPins = (
    connector: number,
    definitions: Array<[string, ElectricalSignalIR]>,
  ) => definitions.map(([pin, signal], index) => {
    const spacing = definitions.length > 1 ? 7.2 / (definitions.length - 1) : 0;
    return addPort(
      `board_connector_${connector}`,
      pin,
      signal,
      [-3.6 + index * spacing, -1.2, 0.65],
      [0, -1, 0],
    );
  });

  const usbPins: Array<[string, ElectricalSignalIR]> = [['vbus', 'power'], ['gnd', 'ground'], ['dp', 'data'], ['dn', 'data']];
  const usbPorts = usbPins.map(([pin, signal], index) => addPort('usb_c_port', pin, signal, [-3 + index * 2, 3.8, 1.7], [0, 1, 0]));
  const boardUsbPorts = connectorPins(1, usbPins);
  usbPins.forEach(([pin, signal], index) => addWire(
    `wire_usb_${pin}`,
    `USB-C ${pin.toUpperCase()} 도체`,
    `USB_${pin.toUpperCase()}`,
    signal,
    usbPorts[index],
    boardUsbPorts[index],
    signal === 'power' ? '#e84f3a' : signal === 'ground' ? '#24272c' : index % 2 ? '#66a9df' : '#e6c654',
    signal === 'data' ? 0.34 : 0.48,
    signal === 'data',
  ));

  const cameraSources: Array<[string, string]> = [
    ['wide_camera_housing', 'wide'],
    ['ultrawide_camera_housing', 'ultrawide'],
    ['tele_camera_housing', 'tele'],
    ['lidar', 'lidar'],
  ];
  const cameraBoardGroups = [
    connectorPins(2, [['wide_data', 'data'], ['wide_vdd', 'power'], ['ultra_data', 'data'], ['ultra_vdd', 'power']]),
    connectorPins(3, [['tele_data', 'data'], ['tele_vdd', 'power'], ['lidar_data', 'data'], ['lidar_vdd', 'power']]),
  ].flat();
  cameraSources.forEach(([componentId, label], index) => {
    const terminalY = componentId === 'lidar' ? -1.05 : -7.8;
    const dataPort = addPort(componentId, 'mipi_data', 'data', [-2.1, terminalY, 2.5], [0, -1, 0]);
    const powerPort = addPort(componentId, 'vdd', 'power', [2.1, terminalY, 2.5], [0, -1, 0]);
    addWire(`wire_${label}_data`, `${label} 고속 데이터`, `${label.toUpperCase()}_MIPI`, 'data', dataPort, cameraBoardGroups[index * 2], '#67aee3', 0.31, true);
    addWire(`wire_${label}_power`, `${label} 모듈 전원`, `${label.toUpperCase()}_VDD`, 'power', powerPort, cameraBoardGroups[index * 2 + 1], '#d85c49', 0.36);
  });

  const auxiliaryDefinitions: Array<{
    componentId: string;
    label: string;
    pins: Array<[string, ElectricalSignalIR, string, string]>;
    position: [number, number, number];
    direction: [number, number, number];
  }> = [
    { componentId: 'taptic_motor', label: 'TAPTIC', pins: [['ctrl', 'control', 'CTRL', '#c49bea'], ['gnd', 'ground', 'GND', '#252a31']], position: [0, 5.9, 2], direction: [0, 1, 0] },
    { componentId: 'bottom_speaker', label: 'SPK', pins: [['pos', 'audio', 'POS', '#e7b74d'], ['neg', 'audio', 'NEG', '#a9772f']], position: [0, 7.6, 2.2], direction: [0, 1, 0] },
    { componentId: 'earpiece', label: 'EAR', pins: [['pos', 'audio', 'POS', '#e7b74d'], ['neg', 'audio', 'NEG', '#a9772f']], position: [0, -2.7, 1.3], direction: [0, -1, 0] },
    { componentId: 'wireless_coil', label: 'QI', pins: [['pos', 'power', 'POS', '#c06c35'], ['neg', 'power', 'NEG', '#734329']], position: [0, 0.4, 0], direction: [0, 0, 1] },
    { componentId: 'nfc_antenna', label: 'NFC', pins: [['rf', 'rf', 'RF', '#69c1a8'], ['gnd', 'ground', 'GND', '#252a31']], position: [0, 23.2, 0.2], direction: [0, 1, 0] },
    { componentId: 'display_oled', label: 'DISPLAY', pins: [['data', 'data', 'DATA', '#67aee3'], ['vdd', 'power', 'VDD', '#d85c49']], position: [0, -76.8, 0.2], direction: [0, -1, 0] },
  ];
  const boardAuxPorts = connectorPins(4, auxiliaryDefinitions.flatMap(({ label, pins }) => (
    pins.map(([pin, signal]) => [`${label.toLowerCase()}_${pin}`, signal] as [string, ElectricalSignalIR])
  )));
  let boardAuxIndex = 0;
  for (const definition of auxiliaryDefinitions) {
    definition.pins.forEach(([pin, signal, netSuffix, color], pinIndex) => {
      const localPosition: [number, number, number] = [
        definition.position[0] + (pinIndex === 0 ? -1.1 : 1.1),
        definition.position[1],
        definition.position[2],
      ];
      const source = addPort(definition.componentId, pin, signal, localPosition, definition.direction);
      addWire(
        `wire_${definition.label.toLowerCase()}_${pin}`,
        `${definition.label} ${pin.toUpperCase()} 도체`,
        `${definition.label}_${netSuffix}`,
        signal,
        source,
        boardAuxPorts[boardAuxIndex],
        color,
        signal === 'data' || signal === 'rf' ? 0.31 : 0.38,
        signal === 'data' || signal === 'rf',
      );
      boardAuxIndex += 1;
    });
  }

  return {
    ports,
    wires,
    endpointToleranceMm: 0.05,
    portToleranceMm: 0.25,
    verificationScope: 'digital port graph and 3D endpoint anchoring; production continuity requires a physical fixture test',
    benchChecks: [
      { id: 'phone_power_short', instruction: '전원 인가 전 VBAT와 GND 사이 단락을 검사합니다.', status: 'required' },
      { id: 'phone_flex_continuity', instruction: '카메라·디스플레이·오디오 FPC의 핀 연속성을 검사합니다.', status: 'required' },
    ],
  };
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
  const rearZ = -d * 0.45 - e * mm(18);
  const frontZ = d * 0.48 + e * mm(32);

  addPart(root, parts, mode, {
    id: 'rear_glass', name: '후면 강화유리', category: 'enclosure', material: '세라믹 강화유리',
    detail: '무선충전 투과 영역과 카메라 개구를 갖는 후면 패널', size: [w * 0.96, h * 0.978, mm(0.72)],
    position: [0, 0, rearZ], color: spec.glassColor, surface: 'ceramic-glass', roughness: 0.16, transmission: 0.08,
    radius: mm(spec.cornerRadiusMm * 0.78),
  });
  addPart(root, parts, mode, {
    id: 'mid_frame', name: '구조용 미드프레임', category: 'enclosure', material: '재생 알루미늄',
    detail: '전체 부품의 기준면과 낙하 충격 경로를 제공하는 CNC 프레임', size: [w, h, mm(2.05)],
    position: [0, 0, -e * mm(4)], color: spec.frameColor, surface: 'anodized-metal', roughness: 0.28, metalness: 0.84,
    radius: mm(spec.cornerRadiusMm),
  });
  createExteriorCameraSystem(root, parts, mode, rearZ);

  const boardZ = e * mm(1.5);
  addPart(root, parts, mode, {
    id: 'logic_board', name: '다층 메인 로직 보드', category: 'logic', material: 'FR-4/구리 10층',
    detail: 'SoC·메모리·전력관리·RF 회로가 실장되는 고밀도 다층 PCB', size: [mm(59), mm(51), mm(0.82)],
    position: [0, mm(47), boardZ], color: spec.boardColor, surface: 'pcb-soldermask', roughness: 0.42, metalness: 0.1, radius: mm(4),
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
    position: [0, mm(-17), e * mm(5.4)], color: spec.batteryColor, surface: 'soft-touch-polymer', roughness: 0.62, metalness: 0.12, radius: mm(4.2),
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
    position: [mm(0), mm(43), cameraZ + e * mm(3)], color: '#182b33', surface: 'semiconductor', roughness: 0.14, transmission: 0.22,
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
    position: [0, 0, frontZ], color: '#a8bdd1', surface: 'ceramic-glass', roughness: 0.055, transmission: 0.62, ior: 1.52, thicknessMm: 0.72, radius: mm(spec.cornerRadiusMm * 0.9),
  });
  createExteriorShellDetails(root, parts, mode, w, h, d, frontZ, spec.frameColor);

  const electrical = createSmartphoneHarness();
  const connectivity = compileElectricalHarness(root, parts, electrical, mode);
  root.userData.assemblyIR = {
    schema: 'morphloom.assembly/0.1',
    kind: 'smartphone',
    units: 'mm',
    spec: structuredClone(spec),
    electrical: structuredClone(electrical),
  };

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
  const surfaces = inspectSurfaceSystem(root);
  const topology = analyzeTopology(root);
  root.userData.surfaceSystem = structuredClone(surfaces);
  root.userData.topology = structuredClone(topology);
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
      connectivity,
      surfaces,
      topology,
    },
  };
}
