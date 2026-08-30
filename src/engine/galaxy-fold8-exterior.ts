import type {
  AssemblyComponentIR,
  AssemblyIR,
  AssemblyMaterialIR,
  ComponentEvidenceIR,
  EvidenceStatusIR,
} from './assembly-ir';

const OFFICIAL_PRODUCT_URL = 'https://www.samsung.com/us/smartphones/galaxy-z-fold8/';
const OFFICIAL_PRESS_URL = 'https://news.samsung.com/global/samsung-galaxy-z-fold8-ultra-fold8-and-flip8foldables-perfected-for-every-way-of-living';
const OFFICIAL_GRAPHITE_IMAGE = 'https://images.samsung.com/us/smartphones/galaxy-z-fold8/images/galaxy-z-fold8-features-colors-viewer-initial-graphite.jpg';
const OFFICIAL_CAMERA_IMAGE = 'https://images.samsung.com/us/smartphones/galaxy-z-fold8/images/galaxy-z-fold8-features-camera-spec.jpg';
const OFFICIAL_UNFOLDED_IMAGE = 'https://images.samsung.com/us/smartphones/galaxy-z-fold8/images/galaxy-z-fold8-features-display-unfolded.png';
const OFFICIAL_ACCESSORY_DRAWING = 'https://developer.samsung.com/Mobile/file/bdb2f328-8620-449f-8703-0421e381079f';

const WIDTH_MM = 161.4;
const HEIGHT_MM = 123.9;
const UNFOLDED_DEPTH_MM = 4.5;
const FOLDED_WIDTH_MM = 81.9;
const FOLDED_DEPTH_MM = 9.7;
const HALF_WIDTH_MM = 79.9;
const HALF_CENTER_X_MM = 40.75;

const evidence = (
  status: EvidenceStatusIR,
  source: string,
  notes: string[],
): ComponentEvidenceIR => ({ status, source, notes });

const roundedRectPoints = (
  width: number,
  height: number,
  radius: number,
  cornerSegments = 6,
): Array<[number, number]> => {
  const points: Array<[number, number]> = [];
  const centers: Array<[number, number, number]> = [
    [width / 2 - radius, height / 2 - radius, 0],
    [-width / 2 + radius, height / 2 - radius, Math.PI / 2],
    [-width / 2 + radius, -height / 2 + radius, Math.PI],
    [width / 2 - radius, -height / 2 + radius, Math.PI * 1.5],
  ];
  for (const [cx, cy, start] of centers) {
    for (let segment = 0; segment <= cornerSegments; segment += 1) {
      const angle = start + (segment / cornerSegments) * Math.PI / 2;
      points.push([cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius]);
    }
  }
  return points;
};

const graphiteFrame: AssemblyMaterialIR = {
  color: '#4a4a50',
  surface: 'anodized-metal',
  roughness: 0.27,
  metalness: 0.88,
  clearcoat: 0.42,
  clearcoatRoughness: 0.2,
  anisotropy: 0.52,
  microNormalStrength: 0.14,
  textureScale: [85, 7],
};

const graphiteGlass: AssemblyMaterialIR = {
  color: '#3d3e44',
  surface: 'ceramic-glass',
  roughness: 0.31,
  metalness: 0.08,
  clearcoat: 0.92,
  clearcoatRoughness: 0.16,
  ior: 1.52,
  microNormalStrength: 0.08,
  textureScale: [130, 130],
};

const displayGlass: AssemblyMaterialIR = {
  color: '#17191e',
  surface: 'optical-glass',
  roughness: 0.095,
  metalness: 0.02,
  transmission: 0.08,
  clearcoat: 1,
  clearcoatRoughness: 0.045,
  ior: 1.51,
  iridescence: 0.08,
  microNormalStrength: 0.035,
  textureScale: [210, 210],
  thicknessMm: 0.32,
  emissive: '#19171c',
};

const components: AssemblyComponentIR[] = [];
const add = (component: AssemblyComponentIR): void => { components.push(component); };

for (const side of [-1, 1] as const) {
  const label = side < 0 ? 'left' : 'right';
  add({
    id: `${label}_armor_frame`,
    name: `${side < 0 ? '좌측' : '우측'} Armor Aluminum 프레임`,
    category: 'enclosure',
    materialName: 'Graphite Armor Aluminum',
    detail: `${HALF_WIDTH_MM}×${HEIGHT_MM}mm 외곽 프레임 · 공식 펼침 포락에서 중앙 힌지 간극을 제외해 분할`,
    geometry: { op: 'roundedBox', size: [HALF_WIDTH_MM, HEIGHT_MM, 4.08], radius: 1.95, segments: 6 },
    position: [side * HALF_CENTER_X_MM, 0, 0],
    material: graphiteFrame,
    evidence: evidence('datasheet', OFFICIAL_PRODUCT_URL, [
      `전체 펼침 포락 ${WIDTH_MM}×${HEIGHT_MM}×${UNFOLDED_DEPTH_MM}mm`,
      '좌우 프레임 분할 폭과 중앙 간극은 공식 정면 이미지에서 비례 추정',
    ]),
  });
}

add({
  id: 'flex_hinge_barrel',
  name: 'Flex Titanium 중앙 힌지 배럴',
  category: 'mechanical',
  materialName: '브러시드 티타늄 합금',
  detail: '펼침 상태에서 중앙 이음부를 지지하는 세로 힌지 외관 · 내부 기어와 링크는 외관 범위에서 제외',
  geometry: { op: 'cylinder', radiusTop: 2.02, radiusBottom: 2.02, depth: 121.4, radialSegments: 56 },
  position: [0, 0, -0.26],
  material: {
    color: '#77777d', surface: 'brushed-metal', roughness: 0.23, metalness: 0.95,
    anisotropy: 0.88, anisotropyRotation: 1.57, clearcoat: 0.34, microNormalStrength: 0.2, textureScale: [9, 130],
  },
  evidence: evidence('estimated', OFFICIAL_PRESS_URL, [
    'Flex Titanium 구조의 존재와 재질 계열은 공식 발표 근거',
    '배럴 직경과 노출 길이는 공식 정면·하단 사진 비례 추정',
  ]),
});

for (const side of [-1, 1] as const) {
  add({
    id: `hinge_cap_${side < 0 ? 'bottom' : 'top'}`,
    name: `${side < 0 ? '하단' : '상단'} 힌지 캡`,
    category: 'mechanical',
    materialName: 'PVD 티타늄',
    detail: '힌지 배럴 끝단의 가공 캡',
    geometry: { op: 'sphere', radius: 2.03, widthSegments: 40, heightSegments: 22 },
    position: [0, side * 60.7, -0.26],
    scale: [1, 0.46, 1],
    material: {
      color: '#77777e', surface: 'polished-metal', roughness: 0.18, metalness: 0.96,
      anisotropy: 0.55, clearcoat: 0.48, microNormalStrength: 0.09,
    },
    evidence: evidence('estimated', OFFICIAL_CAMERA_IMAGE, ['외관 사진에서 보이는 힌지 끝단을 비례 재구성']),
  });
}

add({
  id: 'main_flexible_display',
  name: '7.6인치 4:3 메인 플렉시블 디스플레이',
  category: 'display',
  materialName: '저반사 UTG/OLED 적층',
  detail: '공식 7.6인치·4:3 비율에서 계산한 154.43×115.82mm 활성영역 · 화면 그래픽은 재배포하지 않음',
  geometry: { op: 'extrude', points: roundedRectPoints(154.43, 115.82, 2.25, 10), depth: 0.34, bevelSize: 0.06, bevelThickness: 0.035, bevelSegments: 2 },
  position: [0, 0, 2.28],
  material: displayGlass,
  evidence: evidence('datasheet', OFFICIAL_PRODUCT_URL, [
    '대각선 7.6인치, 1,848×2,448, 4:3 공식 사양',
    '활성영역은 공식 대각선과 종횡비로 계산; 실제 마스킹 치수는 공개되지 않음',
  ]),
});

const bezelMaterial: AssemblyMaterialIR = {
  color: '#0b0c0f', surface: 'molded-polymer', roughness: 0.5, metalness: 0.02,
  clearcoat: 0.22, clearcoatRoughness: 0.36, microNormalStrength: 0.18, textureScale: [90, 90],
};

for (const [id, size, position] of [
  ['top', [156.4, 2.55, 0.48], [0, 59.22, 2.22]],
  ['bottom', [156.4, 2.55, 0.48], [0, -59.22, 2.22]],
  ['left', [2.45, 116.2, 0.48], [-78.22, 0, 2.22]],
  ['right', [2.45, 116.2, 0.48], [78.22, 0, 2.22]],
] as Array<[string, [number, number, number], [number, number, number]]>) {
  add({
    id: `main_bezel_${id}`,
    name: `메인 디스플레이 ${id} 베젤`,
    category: 'display',
    materialName: '충격 흡수 블랙 폴리머',
    detail: '플렉시블 패널 가장자리의 보호 립',
    geometry: { op: 'roundedBox', size, radius: 0.2, segments: 3 },
    position,
    material: bezelMaterial,
    evidence: evidence('estimated', OFFICIAL_UNFOLDED_IMAGE, ['공식 펼침 이미지에서 베젤 비율 추정']),
  });
}

add({
  id: 'main_display_crease',
  name: '중앙 폴드 크리즈 표면',
  category: 'display',
  materialName: '저반사 보호 필름',
  detail: '중앙 접힘선을 별도 선택 가능한 미세 표면으로 표현 · 실제 깊이 프로파일은 미공개',
  geometry: { op: 'roundedBox', size: [0.34, 114.8, 0.05], radius: 0.02, segments: 3 },
  position: [0, 0, 2.49],
  material: {
    color: '#34363c', surface: 'optical-glass', roughness: 0.2, metalness: 0,
    transmission: 0.09, clearcoat: 0.82, clearcoatRoughness: 0.13, ior: 1.48,
  },
  evidence: evidence('inferred', OFFICIAL_PRESS_URL, ['크리즈 존재는 공식 설명 근거; 폭·깊이·반사 응답은 추정']),
});

add({
  id: 'main_selfie_aperture',
  name: '10MP 메인 화면 카메라 개구',
  category: 'camera',
  materialName: '광학 유리/흑색 차광 코팅',
  detail: '공식 10MP F2.2·100° 메인 화면 카메라의 펀치홀 외관',
  geometry: { op: 'cylinder', radiusTop: 1.75, radiusBottom: 1.75, depth: 0.38, radialSegments: 48 },
  position: [0, 54.9, 2.51],
  rotation: [Math.PI / 2, 0, 0],
  material: {
    color: '#06080a', surface: 'sapphire', roughness: 0.04, metalness: 0.04,
    transmission: 0.42, clearcoat: 1, clearcoatRoughness: 0.02, ior: 1.76, iridescence: 0.2, thicknessMm: 0.38,
  },
  evidence: evidence('estimated', OFFICIAL_CAMERA_IMAGE, ['카메라 사양은 공식 데이터시트, 개구 직경과 위치는 정면 이미지 비례 추정']),
});

add({
  id: 'rear_graphite_glass',
  name: 'Graphite 후면 강화유리',
  category: 'enclosure',
  materialName: 'Gorilla Glass Victus 2',
  detail: '카메라가 배치된 좌측 후면 판 · 공식 Victus 2 재질, Graphite 표면',
  geometry: { op: 'extrude', points: roundedRectPoints(77.1, 120.25, 2.35, 8), depth: 0.42, bevelSize: 0.08, bevelThickness: 0.04, bevelSegments: 2 },
  position: [HALF_CENTER_X_MM, 0, -2.13],
  material: graphiteGlass,
  evidence: evidence('datasheet', OFFICIAL_PRODUCT_URL, ['후면 Gorilla Glass Victus 2와 Graphite 색상은 공식 사양']),
});

add({
  id: 'cover_display',
  name: '5.5인치 10:16 커버 디스플레이',
  category: 'display',
  materialName: 'Gorilla Glass Ceramic 3/OLED',
  detail: '공식 5.5인치·10:16 비율에서 계산한 74.05×118.48mm 활성영역',
  geometry: { op: 'extrude', points: roundedRectPoints(74.05, 118.48, 2.5, 10), depth: 0.4, bevelSize: 0.06, bevelThickness: 0.035, bevelSegments: 2 },
  position: [-HALF_CENTER_X_MM, 0, -2.13],
  material: displayGlass,
  evidence: evidence('datasheet', OFFICIAL_PRODUCT_URL, [
    '대각선 5.5인치, 1,248×1,972, 10:16 공식 사양',
    '활성영역은 공식 대각선과 종횡비로 계산',
  ]),
});

add({
  id: 'cover_selfie_aperture',
  name: '10MP 커버 화면 카메라 개구',
  category: 'camera',
  materialName: '광학 유리/흑색 차광 코팅',
  detail: '공식 10MP F2.2·85° 커버 화면 카메라의 펀치홀 외관',
  geometry: { op: 'cylinder', radiusTop: 1.68, radiusBottom: 1.68, depth: 0.42, radialSegments: 48 },
  position: [-HALF_CENTER_X_MM, 54.1, -2.38],
  rotation: [Math.PI / 2, 0, 0],
  material: {
    color: '#050709', surface: 'sapphire', roughness: 0.04, transmission: 0.4,
    clearcoat: 1, clearcoatRoughness: 0.02, ior: 1.76, iridescence: 0.18, thicknessMm: 0.4,
  },
  evidence: evidence('estimated', OFFICIAL_PRODUCT_URL, ['카메라 사양은 공식 데이터시트, 개구 직경과 위치는 이미지 비례 추정']),
});

add({
  id: 'rear_camera_island',
  name: '듀얼 카메라 아일랜드',
  category: 'camera',
  materialName: 'Graphite CNC 알루미늄',
  detail: '50MP 초광각·50MP 광각·플래시를 세로로 고정하는 외부 하우징',
  geometry: { op: 'extrude', points: roundedRectPoints(18.8, 51.2, 7.2, 10), depth: 1.25, bevelSize: 0.22, bevelThickness: 0.12, bevelSegments: 3 },
  position: [64.3, 20.8, -2.82],
  material: {
    color: '#55565d', surface: 'anodized-metal', roughness: 0.26, metalness: 0.84,
    clearcoat: 0.5, clearcoatRoughness: 0.19, anisotropy: 0.48, microNormalStrength: 0.12, textureScale: [65, 9],
  },
  evidence: evidence('estimated', OFFICIAL_ACCESSORY_DRAWING, ['듀얼 카메라 구성과 후면 방향은 공식 사양·액세서리 도면, 아일랜드 외곽 치수는 이미지 비례 추정']),
});

for (const [id, label, y, fov] of [
  ['ultrawide', '50MP 초광각', 38.2, '120°'],
  ['wide', '50MP 광각', 20.0, '85°'],
] as const) {
  add({
    id: `${id}_camera_outer_ring`,
    name: `${label} 외부 보호 링`,
    category: 'camera',
    materialName: 'PVD 알루미늄',
    detail: `${label} 렌즈창의 충격 보호 동심 링`,
    geometry: { op: 'torus', radius: 6.35, tube: 0.72, radialSegments: 18, tubularSegments: 72 },
    position: [64.3, y, -3.58],
    material: {
      color: '#8b8c92', surface: 'polished-metal', roughness: 0.15, metalness: 0.96,
      anisotropy: 0.58, clearcoat: 0.55, clearcoatRoughness: 0.11, microNormalStrength: 0.08,
    },
    evidence: evidence('estimated', OFFICIAL_CAMERA_IMAGE, ['공식 카메라 이미지에서 링 직경과 단차 비례 추정']),
  });
  add({
    id: `${id}_camera_sapphire_window`,
    name: `${label} 사파이어 렌즈창`,
    category: 'camera',
    materialName: 'AR 코팅 사파이어',
    detail: `${label} ${fov} 외부 광학창 · 센서와 내부 렌즈 스택은 외관 범위에서 제외`,
    geometry: { op: 'cylinder', radiusTop: 5.62, radiusBottom: 5.62, depth: 0.5, radialSegments: 64 },
    position: [64.3, y, -3.73],
    rotation: [Math.PI / 2, 0, 0],
    material: {
      color: '#101c27', surface: 'sapphire', roughness: 0.025, metalness: 0.02,
      transmission: 0.61, clearcoat: 1, clearcoatRoughness: 0.018, ior: 1.76,
      iridescence: 0.28, microNormalStrength: 0.025, thicknessMm: 0.5,
    },
    evidence: evidence('estimated', OFFICIAL_PRODUCT_URL, [`${label} ${fov} 사양은 공식 데이터시트`, '외부 창 직경과 코팅 반사는 이미지 기반 추정']),
  });
  add({
    id: `${id}_camera_aperture`,
    name: `${label} 가시 입사동`,
    category: 'camera',
    materialName: '광학 흑색 코팅',
    detail: '외부에서 관찰되는 1차 렌즈와 차광 배럴',
    geometry: { op: 'cylinder', radiusTop: 2.55, radiusBottom: 2.55, depth: 0.16, radialSegments: 56 },
    position: [64.3, y, -4.01],
    rotation: [Math.PI / 2, 0, 0],
    material: {
      color: '#05090d', surface: 'optical-glass', roughness: 0.055, transmission: 0.16,
      clearcoat: 1, clearcoatRoughness: 0.025, ior: 1.56, iridescence: 0.34,
    },
    evidence: evidence('inferred', OFFICIAL_CAMERA_IMAGE, ['가시 입사동의 색과 깊이만 사진에서 추정']),
  });
}

add({
  id: 'rear_flash_ring',
  name: '후면 LED 플래시 링',
  category: 'camera',
  materialName: '폴리시드 알루미늄',
  detail: '듀얼 카메라 하단의 원형 플래시 고정 링',
  geometry: { op: 'torus', radius: 2.62, tube: 0.38, radialSegments: 14, tubularSegments: 56 },
  position: [64.3, 3.7, -3.54],
  material: { color: '#bab4a7', surface: 'polished-metal', roughness: 0.2, metalness: 0.8, clearcoat: 0.52 },
  evidence: evidence('estimated', OFFICIAL_CAMERA_IMAGE, ['플래시 위치와 직경을 공식 사진에서 비례 추정']),
});

add({
  id: 'rear_flash_diffuser',
  name: '후면 LED 플래시 확산창',
  category: 'camera',
  materialName: '형광체 광학 실리콘',
  detail: '촬영용 LED의 미세 확산 커버',
  geometry: { op: 'cylinder', radiusTop: 2.18, radiusBottom: 2.18, depth: 0.34, radialSegments: 48 },
  position: [64.3, 3.7, -3.66],
  rotation: [Math.PI / 2, 0, 0],
  material: {
    color: '#eee2b5', surface: 'optical-glass', roughness: 0.26, transmission: 0.23,
    clearcoat: 0.64, clearcoatRoughness: 0.14, ior: 1.45, emissive: '#806c3e',
  },
  evidence: evidence('estimated', OFFICIAL_CAMERA_IMAGE, ['확산창의 직경과 표면은 공식 사진 기반 추정']),
});

for (const [id, name, y, height] of [
  ['power_key', '지문 센서 통합 전원 키', 2.5, 11.2],
  ['volume_up_key', '볼륨 상단 키', 22.4, 9.2],
  ['volume_down_key', '볼륨 하단 키', 12.2, 9.2],
] as const) {
  add({
    id,
    name,
    category: 'mechanical',
    materialName: '양극산화 알루미늄',
    detail: '우측 외곽 프레임과 거의 같은 높이로 맞춘 독립 외부 조작부',
    geometry: { op: 'roundedBox', size: [0.42, height, 1.55], radius: 0.18, segments: 4 },
    position: [80.58, y, 0.18],
    material: {
      color: '#606169', surface: 'anodized-metal', roughness: 0.24, metalness: 0.9,
      anisotropy: 0.48, clearcoat: 0.42, microNormalStrength: 0.1,
    },
    evidence: evidence('estimated', OFFICIAL_GRAPHITE_IMAGE, ['버튼 존재와 순서는 공식 이미지, 길이·돌출량은 비례 추정']),
  });
}

add({
  id: 'sim_tray',
  name: 'nanoSIM 트레이 외곽',
  category: 'mechanical',
  materialName: '양극산화 알루미늄/실링',
  detail: '공식 nanoSIM 지원 사양의 외부 트레이 경계',
  geometry: { op: 'roundedBox', size: [0.38, 17.8, 1.46], radius: 0.16, segments: 3 },
  position: [-80.58, -9.5, 0.16],
  material: graphiteFrame,
  evidence: evidence('estimated', OFFICIAL_PRODUCT_URL, ['nanoSIM 지원은 공식 사양, 트레이 위치와 치수는 이미지 기반 추정']),
});

add({
  id: 'usb_c_opening',
  name: 'USB-C 하단 개구',
  category: 'interconnect',
  materialName: '흑색 절연 인서트/스테인리스',
  detail: '하단 중앙의 USB-C 외부 개구 · 내부 커넥터 핀은 외관 범위에서 제외',
  geometry: { op: 'roundedBox', size: [9.1, 0.42, 2.65], radius: 0.19, segments: 4 },
  position: [39.6, -61.77, -0.1],
  material: {
    color: '#08090b', surface: 'molded-polymer', roughness: 0.42, metalness: 0.24,
    clearcoat: 0.2, clearcoatRoughness: 0.3, microNormalStrength: 0.22,
  },
  evidence: evidence('estimated', OFFICIAL_PRESS_URL, ['공식 하단 사진에서 USB-C 개구 위치와 폭 비례 추정']),
});

for (const [edge, y] of [['bottom', -61.78], ['top', 61.78]] as const) {
  for (let index = 0; index < 6; index += 1) {
    add({
      id: `${edge}_speaker_port_${index + 1}`,
      name: `${edge === 'top' ? '상단' : '하단'} 스피커 포트 ${index + 1}`,
      category: 'audio',
      materialName: '흑색 스테인리스 메시',
      detail: '프레임 가장자리의 음향 방출구',
      geometry: { op: 'cylinder', radiusTop: 0.36, radiusBottom: 0.36, depth: 0.38, radialSegments: 24 },
      position: [-32.6 + index * 2.0, y, -0.12],
      material: { color: '#090a0c', surface: 'raw', roughness: 0.62, metalness: 0.44, microNormalStrength: 0.28 },
      evidence: evidence('estimated', OFFICIAL_PRESS_URL, ['개구 개수와 피치는 공개되지 않아 외관 사진으로 추정']),
    });
  }
}

for (const [id, x, y] of [
  ['bottom_microphone', 55.5, -61.78],
  ['top_microphone', -55.8, 61.78],
  ['sim_eject_hole', -80.6, -17.1],
] as const) {
  add({
    id,
    name: id === 'sim_eject_hole' ? 'SIM 트레이 이젝트 홀' : `${id.startsWith('top') ? '상단' : '하단'} 마이크 홀`,
    category: id === 'sim_eject_hole' ? 'mechanical' : 'audio',
    materialName: '흑색 방수 메시',
    detail: id === 'sim_eject_hole' ? 'SIM 트레이 수동 배출용 핀홀' : '외부 방수·방진 음향 개구',
    geometry: { op: 'cylinder', radiusTop: 0.48, radiusBottom: 0.48, depth: 0.38, radialSegments: 28 },
    position: [x, y, -0.08],
    rotation: id === 'sim_eject_hole' ? [0, 0, Math.PI / 2] : undefined,
    material: { color: '#07080a', surface: 'raw', roughness: 0.7, metalness: 0.32, microNormalStrength: 0.25 },
    evidence: evidence('estimated', OFFICIAL_PRESS_URL, ['포트 위치와 지름은 공식 외관 사진에서 추정']),
  });
}

for (const [edge, side, y] of [
  ['left_top', -1, 48], ['left_bottom', -1, -45], ['right_top', 1, 47], ['right_bottom', 1, -46],
] as const) {
  add({
    id: `antenna_break_${edge}`,
    name: `${edge} 안테나 절연선`,
    category: 'radio',
    materialName: 'RF 절연 폴리머',
    detail: '금속 프레임의 RF 방사를 위한 외부 절연 브레이크',
    geometry: { op: 'roundedBox', size: [0.44, 2.1, 4.0], radius: 0.18, segments: 3 },
    position: [side * 80.56, y, 0],
    material: {
      color: '#2a2b30', surface: 'molded-polymer', roughness: 0.46, metalness: 0.05,
      clearcoat: 0.16, microNormalStrength: 0.2,
    },
    evidence: evidence('estimated', OFFICIAL_GRAPHITE_IMAGE, ['프레임 절연선 위치는 공식 Graphite 사진에서 추정']),
  });
}

export const GALAXY_Z_FOLD8_EXTERIOR_IR: AssemblyIR = {
  schema: 'morphloom.assembly/0.1',
  name: 'Galaxy Z Fold8 exterior — Graphite — unfolded',
  units: 'mm',
  components,
  metadata: {
    scope: 'exterior-only',
    model: 'Galaxy Z Fold8',
    color: 'Graphite',
    foldState: 'unfolded-180deg',
    officialWidthMm: WIDTH_MM,
    officialHeightMm: HEIGHT_MM,
    officialUnfoldedDepthMm: UNFOLDED_DEPTH_MM,
    officialFoldedWidthMm: FOLDED_WIDTH_MM,
    officialFoldedDepthMm: FOLDED_DEPTH_MM,
    officialWeightG: 201,
    mainDisplayInches: 7.6,
    coverDisplayInches: 5.5,
    sourceOfficialProduct: OFFICIAL_PRODUCT_URL,
    sourceOfficialPress: OFFICIAL_PRESS_URL,
    sourceGraphiteImage: OFFICIAL_GRAPHITE_IMAGE,
    sourceCameraImage: OFFICIAL_CAMERA_IMAGE,
    sourceUnfoldedImage: OFFICIAL_UNFOLDED_IMAGE,
    sourceAccessoryDrawing: OFFICIAL_ACCESSORY_DRAWING,
    nfcCenterFromRightMm: 34,
    nfcCenterFromTopMm: 34,
    wirelessCoilDiameterMm: 41,
    wirelessCoilCenterFromRightMm: 41.5,
    wirelessCoilCenterFromTopMm: 80.9,
    accessoryMagnetCenterBelowDeviceCenterMm: 18.95,
    accessoryMagnetCenterFromDeviceEdgeMm: 40.44,
    evidencePolicy: '공식 치수·디스플레이·재질·카메라 사양은 datasheet, 공개되지 않은 개구·단차·곡률은 estimated/inferred로 보존합니다.',
    internalElectronicsIncluded: false,
    redistributionNote: '삼성 공식 사진은 모델링 근거 URL로만 기록하며 저장소에 재배포하지 않습니다.',
  },
};
