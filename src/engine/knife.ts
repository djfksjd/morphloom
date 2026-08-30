import type { ProductSpec, ViewMode } from '../types';
import * as THREE from 'three';
import type { AssemblyComponentIR, AssemblyIR } from './assembly-ir';
import { compileAssemblyIR } from './assembly-compiler';
import type { ProductBuild } from './product';

const metal = (color: string, roughness = 0.25, surface: 'brushed-metal' | 'polished-metal' | 'anodized-metal' = 'brushed-metal') => ({ color, roughness, metalness: 0.88, surface });

export function createOrnateKnifeIR(spec: ProductSpec): AssemblyIR {
  const components: AssemblyComponentIR[] = [];
  components.push({
    id: 'blade_core', name: '양날 검신', category: 'mechanical', materialName: '고탄소 공구강',
    detail: '중심 능선과 대칭 팁을 가진 닫힌 베벨 압출 메시',
    geometry: {
      op: 'bladeLoft',
      sections: [[0, 18], [54, 20], [108, 23], [158, 25], [205, 23], [246, 19], [279, 13], [304, 7], [320, 2.6], [326, 0.28]],
      thickness: 5.4,
      apexThickness: 0.16,
      grindCurve: [0.025, 0.58, 1, 0.58, 0.025],
    },
    position: [0, 18, 0], material: { ...metal(spec.frameColor, 0.16, 'polished-metal'), anisotropy: 0.58, microNormalStrength: 0.12 },
  });
  components.push({
    id: 'fuller_front', name: '전면 혈조 인레이', category: 'mechanical', materialName: '산화강',
    detail: '칼날 강성을 유지하며 시각적 중심선을 형성하는 장식 혈조',
    geometry: { op: 'extrude', points: [[-3.5, 34], [-5.2, 170], [-3, 270], [0, 292], [3, 270], [5.2, 170], [3.5, 34]], depth: 0.5, bevelSize: 0.35, bevelThickness: 0.25, bevelSegments: 2 },
    position: [0, 18, 3.15], material: metal('#25344d', 0.32, 'anodized-metal'),
  });
  components.push({
    id: 'fuller_back', name: '후면 혈조 인레이', category: 'mechanical', materialName: '산화강',
    detail: '전면과 대칭인 후면 장식 혈조',
    geometry: { op: 'extrude', points: [[-3.5, 34], [-5.2, 170], [-3, 270], [0, 292], [3, 270], [5.2, 170], [3.5, 34]], depth: 0.5, bevelSize: 0.35, bevelThickness: 0.25, bevelSegments: 2 },
    position: [0, 18, -3.15], material: metal('#25344d', 0.32, 'anodized-metal'),
  });
  components.push({
    id: 'cross_guard', name: '문양 크로스가드', category: 'mechanical', materialName: '청동 합금',
    detail: '손을 보호하고 검신과 탱을 체결하는 장식 가드',
    geometry: { op: 'roundedBox', size: [98, 13, 14], radius: 4, segments: 5 },
    position: [0, 10, 0], material: metal(spec.batteryColor, 0.3),
  });
  components.push({
    id: 'guard_scroll_left', name: '좌측 가드 스크롤', category: 'mechanical', materialName: '청동 합금',
    detail: '곡선 스윕으로 만든 좌측 장식 퀼론',
    geometry: { op: 'tube', radius: 3.2, radialSegments: 12, points: [[-34, 10, 0], [-51, 8, 0], [-58, 1, 0], [-52, -7, 0], [-44, -3, 0]] },
    material: metal(spec.batteryColor, 0.28),
  });
  components.push({
    id: 'guard_scroll_right', name: '우측 가드 스크롤', category: 'mechanical', materialName: '청동 합금',
    detail: '곡선 스윕으로 만든 우측 장식 퀼론',
    geometry: { op: 'tube', radius: 3.2, radialSegments: 12, points: [[34, 10, 0], [51, 8, 0], [58, 1, 0], [52, -7, 0], [44, -3, 0]] },
    material: metal(spec.batteryColor, 0.28),
  });
  components.push({
    id: 'grip_core', name: '풀탱 그립 코어', category: 'mechanical', materialName: '월넛/강철 탱',
    detail: '손잡이 내부 탱과 목재 코어를 표현하는 회전체 메시',
    geometry: { op: 'lathe', profile: [[0, -2], [14, -2], [16, -8], [15, -25], [13, -63], [14, -85], [11, -94], [0, -94]], segments: 64 },
    material: { color: spec.boardColor, surface: 'wood', roughness: 0.72, metalness: 0.03, textureScale: [6, 24] },
  });
  for (const [index, y] of [-5, -28, -52, -76, -92].entries()) {
    components.push({
      id: `grip_ring_${index + 1}`, name: `손잡이 장식 링 ${index + 1}`, category: 'mechanical', materialName: '청동 합금',
      detail: '그립 미끄럼을 줄이고 장식 리듬을 만드는 독립 링',
      geometry: { op: 'torus', radius: index === 0 ? 15.5 : 13.8, tube: 1.7, radialSegments: 12, tubularSegments: 56 },
      position: [0, y, 0], rotation: [Math.PI / 2, 0, 0], material: metal(spec.batteryColor, 0.28),
    });
  }
  const helixPoints: Array<[number, number, number]> = [];
  for (let step = 0; step <= 44; step += 1) {
    const t = step / 44;
    const angle = t * Math.PI * 10;
    const radius = 14.2 - t * 1.2;
    helixPoints.push([Math.cos(angle) * radius, -8 - t * 78, Math.sin(angle) * radius]);
  }
  components.push({
    id: 'grip_wrap', name: '나선형 가죽 래핑', category: 'mechanical', materialName: '천연 가죽',
    detail: '연속 곡선 스윕으로 구성된 실제 입체 손잡이 감기',
    geometry: { op: 'tube', points: helixPoints, radius: 1.25, tubularSegments: 176, radialSegments: 9 },
    material: { color: '#2b1712', surface: 'leather', roughness: 0.86, metalness: 0, textureScale: [9, 20] },
  });
  components.push({
    id: 'pommel', name: '장식 폼멜', category: 'mechanical', materialName: '청동 합금',
    detail: '무게중심을 맞추고 탱 끝을 체결하는 다단 회전체',
    geometry: { op: 'lathe', profile: [[0, -93], [10, -94], [17, -101], [18, -111], [12, -122], [5, -128], [0, -129]], segments: 72 },
    material: metal(spec.batteryColor, 0.24),
  });
  components.push({
    id: 'pommel_gem', name: '폼멜 보석', category: 'mechanical', materialName: '청색 사파이어',
    detail: '반투명 물리 재질의 독립 보석 장식',
    geometry: { op: 'sphere', radius: 7.5, widthSegments: 48, heightSegments: 24 },
    position: [0, -112, 15], scale: [1, 1.25, 0.42], material: { color: spec.glassColor, surface: 'sapphire', roughness: 0.025, metalness: 0, transmission: 0.58, ior: 1.76 },
  });
  const engravingPoints: Array<[number, number, number]> = [
    [-7, 82, 3.35], [-12, 112, 3.35], [-5, 143, 3.35], [-10, 175, 3.35], [-3, 208, 3.35],
  ];
  components.push({
    id: 'blade_engraving', name: '검신 룬 각인', category: 'mechanical', materialName: '금 상감',
    detail: '칼날 표면을 따라 흐르는 곡선 스윕 금속 상감 장식',
    geometry: { op: 'tube', points: engravingPoints, radius: 0.72, tubularSegments: 72, radialSegments: 8 },
    material: metal('#d3ad52', 0.14, 'polished-metal'),
  });
  return {
    schema: 'morphloom.assembly/0.1',
    name: 'morphloom_ornate_dagger',
    units: 'mm',
    components,
    metadata: { topologyIntent: 'closed-editable-components', generator: 'Codex-or-Claude compatible' },
  };
}

export function buildOrnateKnife(spec: ProductSpec, mode: ViewMode): ProductBuild {
  const build = compileAssemblyIR(createOrnateKnifeIR(spec), mode);
  build.root.scale.set(spec.widthMm / 96, spec.heightMm / 438, spec.depthMm / 22);
  build.root.rotation.y = -0.14;
  build.metrics.bounds = new THREE.Box3().setFromObject(build.root);
  build.metrics.heightMeters = build.metrics.bounds.getSize(new THREE.Vector3()).y;
  return build;
}
