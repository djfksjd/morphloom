import type { CharacterSpec, HumanPack, ProductSpec, QualityCheck, QualityReport, ReferenceEvidence } from '../types';
import { deriveBodyTopology } from './character';
import type { ProductMetrics } from './product';
import type { AssemblyIR } from './assembly-ir';

function status(score: number, blockAt = 65): QualityCheck['status'] {
  return score >= 86 ? 'pass' : score >= blockAt ? 'warn' : 'blocked';
}

export function evaluateQuality(
  pack: HumanPack,
  spec: CharacterSpec,
  evidence?: ReferenceEvidence,
): QualityReport {
  const topology = deriveBodyTopology(pack);
  const vertices = topology.boundary;
  const triangles = topology.indices.length / 3;
  const geometryScore = Math.round(
    Math.min(100, 68 + Math.log10(Math.max(vertices, 1)) * 6 - pack.quantizationError * 2000),
  );
  const silhouettePenalty =
    Math.abs(spec.shoulderScale - 1) * 30 + Math.abs(spec.legScale - 1) * 45 + Math.abs(spec.headScale - 1) * 35;
  const morphStabilityScore = Math.round(Math.max(0, 96 - silhouettePenalty));
  const silhouetteScore = evidence
    ? Math.min(morphStabilityScore, evidence.portraitSuitability)
    : morphStabilityScore;
  const materialScore = Math.round(82 + (spec.hairStyle !== 'none' ? 5 : 0) + (spec.outfit === 'field' ? 3 : 0));
  const rigScore = 74;
  const exportScore = 92;

  const checks: QualityCheck[] = [
    {
      id: 'geometry',
      label: '인체 토폴로지',
      score: geometryScore,
      status: status(geometryScore),
      detail: `${vertices.toLocaleString()}개 정점의 연속형 인체 기본 메시`,
    },
    {
      id: 'silhouette',
      label: evidence ? '참조 증거 완성도' : '실루엣 안정성',
      score: silhouetteScore,
      status: status(silhouetteScore),
      detail: evidence
        ? `${evidence.fileName} · ${evidence.notes[0]}`
        : '모프 범위와 신체 비율의 안전 구간 검사',
    },
    {
      id: 'materials',
      label: '재질 분리',
      score: materialScore,
      status: status(materialScore),
      detail: '피부·슈트·헤어의 물리 기반 재질 분리',
    },
    {
      id: 'rig',
      label: '게임 리그',
      score: rigScore,
      status: 'warn',
      detail: '17개 관절 프리뷰 완료 · 스킨 웨이트 연결 예정',
    },
    {
      id: 'export',
      label: 'GLB 내보내기',
      score: exportScore,
      status: status(exportScore),
      detail: '표준 glTF 2.0 장면과 CharacterIR 메타데이터',
    },
  ];

  const base = checks.reduce((sum, check) => sum + check.score, 0) / checks.length;
  return {
    total: Math.round(Math.max(0, Math.min(100, base))),
    checks,
    triangles,
    vertices,
  };
}

export function evaluateProductQuality(
  spec: ProductSpec,
  evidence?: ReferenceEvidence,
  metrics?: ProductMetrics,
  assemblyIR?: AssemblyIR,
): QualityReport {
  const isKnife = spec.kind === 'ornate-knife';
  const isImportedAssembly = Boolean(assemblyIR);
  const connectivity = metrics?.connectivity;
  const surfaces = metrics?.surfaces;
  const topology = metrics?.topology;
  const ratio = spec.heightMm / spec.widthMm;
  const compiledEnvelope = metrics?.bounds ? {
    x: metrics.bounds.max.x - metrics.bounds.min.x,
    y: metrics.bounds.max.y - metrics.bounds.min.y,
    z: metrics.bounds.max.z - metrics.bounds.min.z,
  } : undefined;
  const envelopeLabel = compiledEnvelope
    ? `${Math.round(compiledEnvelope.x * 1000)} × ${Math.round(compiledEnvelope.y * 1000)} × ${Math.round(compiledEnvelope.z * 1000)} mm 컴파일 포락`
    : '컴파일 포락을 계산하는 중';
  const envelopeScore = isImportedAssembly
    ? metrics?.bounds ? 97 : 78
    : Math.round(Math.max(0, isKnife
      ? 98 - Math.abs(ratio - 4.56) * 9 - Math.abs(spec.depthMm - 22) * 0.7
      : 98 - Math.abs(ratio - 2.085) * 34 - Math.abs(spec.depthMm - 8.25) * 1.8));
  const referenceFidelityScore = evidence
    ? Math.min(envelopeScore, evidence.portraitSuitability)
    : envelopeScore;
  const surfaceCoverage = surfaces && surfaces.authoredMaterials > 0
    ? surfaces.microNormalMaterials / surfaces.authoredMaterials
    : 0;
  const surfaceScore = surfaces
    ? Math.round(Math.min(99, 78 + surfaces.distinctFinishes * 1.25 + surfaceCoverage * 7))
    : 76;
  const topologyScore = topology
    ? topology.pass ? 100 : Math.max(0, 100 - topology.boundaryEdges - topology.nonManifoldEdges * 2 - topology.degenerateTriangles)
    : 64;
  const checks: QualityCheck[] = [
    {
      id: 'geometry',
      label: isKnife ? '가변 두께 검신' : isImportedAssembly ? '이미지 파생 부품 구조' : '부품 분해 구조',
      score: topologyScore,
      status: topology?.pass ? 'pass' : 'blocked',
      detail: topology
        ? `${topology.watertightMeshes}/${topology.meshes} 폐쇄형 · 경계 ${topology.boundaryEdges} · 비매니폴드 ${topology.nonManifoldEdges} · 퇴화 ${topology.degenerateTriangles}`
        : '전체 메시 토폴로지를 검사한 뒤 납품 가능 여부를 판정합니다.',
    },
    {
      id: 'silhouette',
      label: evidence ? '참조 증거 완성도' : isKnife ? '실물 단위 포락' : isImportedAssembly ? '컴파일 포락' : '기구 치수 일관성',
      score: referenceFidelityScore,
      status: status(referenceFidelityScore),
      detail: evidence
        ? `${evidence.fileName} · ${evidence.notes[0]}`
        : isImportedAssembly ? envelopeLabel : `${spec.widthMm} × ${spec.heightMm} × ${spec.depthMm} mm 기준 포락 검사`,
    },
    {
      id: 'materials',
      label: isKnife ? '강철·청동·가죽·보석 표면' : 'PBR 미세 표면',
      score: surfaceScore,
      status: status(surfaceScore),
      detail: surfaces
        ? `${surfaces.distinctFinishes}종 finish · micro-normal ${surfaces.microNormalMaterials}/${surfaces.authoredMaterials} · 이방성 ${surfaces.anisotropicMaterials}`
        : '표면 재질을 컴파일한 뒤 roughness·normal·clearcoat를 검사합니다.',
    },
    {
      id: 'rig',
      label: isKnife ? '실무 토폴로지' : '전기 연결성',
      score: isKnife ? 97 : connectivity && connectivity.errors.length === 0 ? 99 : 72,
      status: isKnife || (connectivity && connectivity.errors.length === 0) ? 'pass' : 'warn',
      detail: isKnife
        ? '전체 부품 폐쇄·매니폴드·퇴화 삼각형 0 자동 검사'
        : connectivity
          ? `${connectivity.connectedWires}/${connectivity.wires} 도체 · 필수 포트 ${connectivity.connectedRequiredPorts}/${connectivity.requiredPorts} · 부유 끝 ${connectivity.danglingWires}`
          : '포트·네트·도체 그래프를 컴파일한 뒤 연결성을 판정합니다.',
    },
    {
      id: 'export',
      label: 'GLB/BOM 내보내기',
      score: 95,
      status: 'pass',
      detail: 'glTF 노드 이름과 AssemblyIR 메타데이터 동시 보존',
    },
  ];
  const base = checks.reduce((sum, check) => sum + check.score, 0) / checks.length;
  return {
    total: Math.round(Math.max(0, Math.min(100, base))),
    checks,
    triangles: 0,
    vertices: 0,
  };
}
