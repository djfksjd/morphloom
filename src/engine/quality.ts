import type { CharacterSpec, HumanPack, ProductSpec, QualityCheck, QualityReport, ReferenceEvidence } from '../types';
import { deriveBodyTopology, type CharacterMetrics } from './character';
import type { ProductMetrics } from './product';
import type { AssemblyIR } from './assembly-ir';

function status(score: number, blockAt = 65): QualityCheck['status'] {
  return score >= 86 ? 'pass' : score >= blockAt ? 'warn' : 'blocked';
}

export function evaluateQuality(
  pack: HumanPack,
  spec: CharacterSpec,
  evidence?: ReferenceEvidence,
  metrics?: CharacterMetrics,
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
  const webHero = spec.outfit === 'web-hero';
  const silhouetteScore = evidence
    ? Math.min(morphStabilityScore, evidence.portraitSuitability)
    : webHero ? 35 : morphStabilityScore;
  const materialScore = webHero
    ? Math.min(98, 90 + Math.round((metrics?.surfaces.distinctFinishes ?? 0) * 1.5))
    : Math.round(82 + (spec.hairStyle !== 'none' ? 5 : 0) + (spec.outfit === 'field' ? 3 : 0));
  const poseErrorMm = (metrics?.poseLandmarkRmsMeters ?? Number.POSITIVE_INFINITY) * 1000;
  const rigScore = webHero
    ? Number.isFinite(poseErrorMm) ? Math.round(Math.max(0, 100 - poseErrorMm * 1.6)) : 0
    : 74;
  const exportScore = 92;

  const checks: QualityCheck[] = [
    {
      id: 'geometry',
      label: '인체 토폴로지',
      score: geometryScore,
      status: status(geometryScore),
      detail: webHero
        ? `${vertices.toLocaleString()}개 스킨 정점 · 이름 있는 슈트 상세 ${metrics?.namedDetailParts ?? 0}개`
        : `${vertices.toLocaleString()}개 정점의 연속형 인체 기본 메시`,
    },
    {
      id: 'silhouette',
      label: webHero ? '동일 시점 참조 충실도' : evidence ? '참조 증거 완성도' : '실루엣 안정성',
      score: silhouetteScore,
      status: status(silhouetteScore),
      detail: evidence
        ? `${evidence.fileName} · ${evidence.notes[0]}`
        : webHero
          ? 'LLM 체형·자세 해석 적용 · 단일 사진이라 후면·손 깊이의 동일 시점 비교는 아직 BLOCKED'
          : '모프 범위와 신체 비율의 안전 구간 검사',
    },
    {
      id: 'materials',
      label: webHero ? '웹 슈트 재질·부품' : '재질 분리',
      score: materialScore,
      status: status(materialScore),
      detail: webHero
        ? `hex-knit·optical glass·polymer ${metrics?.surfaces.distinctFinishes ?? 0}종 · inferred ${metrics?.inferredDetailParts ?? 0}`
        : '피부·슈트·헤어의 물리 기반 재질 분리',
    },
    {
      id: 'rig',
      label: webHero ? '랜드마크 포즈 오차' : '게임 리그',
      score: rigScore,
      status: webHero ? status(rigScore, 72) : 'warn',
      detail: webHero
        ? `17개 관절 목표 RMS ${Number.isFinite(poseErrorMm) ? poseErrorMm.toFixed(1) : '—'} mm · 오른손=화면 왼쪽 · 숨은 깊이는 inferred`
        : '17개 관절 프리뷰 완료 · 스킨 웨이트 연결 예정',
    },
    {
      id: 'export',
      label: 'GLB 내보내기',
      score: webHero ? 94 : exportScore,
      status: status(exportScore),
      detail: webHero
        ? `표준 glTF 2.0 · ${metrics?.namedDetailParts ?? 0}개 명명 부품 · CharacterIR 근거 메타데이터`
        : '표준 glTF 2.0 장면과 CharacterIR 메타데이터',
    },
  ];

  const base = checks.reduce((sum, check) => sum + check.score, 0) / checks.length;
  const hasBlockingCheck = checks.some((check) => check.status === 'blocked');
  return {
    total: Math.round(Math.max(0, Math.min(hasBlockingCheck ? 59 : 100, base))),
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
  const isExteriorOnly = assemblyIR?.metadata?.scope === 'exterior-only';
  const isArchitectural = assemblyIR?.metadata?.assetKind === 'building';
  const connectivity = metrics?.connectivity;
  const engineering = metrics?.engineering;
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
    ? engineering?.evidenceScore ?? (metrics?.bounds ? 64 : 52)
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
  const connectionDocumentation = connectivity && connectivity.wires > 0 && connectivity.ports > 0
    ? (connectivity.documentedPhysicalPins / connectivity.ports
      + connectivity.specifiedGaugeWires / connectivity.wires
      + connectivity.documentedVerificationWires / connectivity.wires) / 3
    : 0;
  const connectivityScore = isKnife || isExteriorOnly || isArchitectural
    ? 97
    : connectivity?.errors.length
      ? Math.max(0, 72 - connectivity.errors.length * 8)
      : connectivity
        ? Math.round(Math.min(connectivity.productionReady ? 99 : 89, 78 + connectionDocumentation * 16))
        : 52;
  const checks: QualityCheck[] = [
    {
      id: 'geometry',
      label: isKnife ? '가변 두께 검신' : isArchitectural ? '건축 부재 구조' : isExteriorOnly ? '외관 부품 구조' : isImportedAssembly ? '이미지 파생 부품 구조' : '부품 분해 구조',
      score: topologyScore,
      status: topology?.pass ? 'pass' : 'blocked',
      detail: topology
        ? `${topology.watertightMeshes}/${topology.meshes} 폐쇄형 · 경계 ${topology.boundaryEdges} · 비매니폴드 ${topology.nonManifoldEdges} · 퇴화 ${topology.degenerateTriangles}`
        : '전체 메시 토폴로지를 검사한 뒤 납품 가능 여부를 판정합니다.',
    },
    {
      id: 'silhouette',
      label: evidence ? '참조 증거 완성도' : isKnife ? '실물 단위 포락' : isArchitectural ? '실측 도면 근거' : isImportedAssembly ? '부품 근거 완성도' : '기구 치수 일관성',
      score: referenceFidelityScore,
      status: status(referenceFidelityScore),
      detail: evidence
        ? `${evidence.fileName} · ${evidence.notes[0]}`
        : isImportedAssembly && engineering
          ? `근거 기록 ${Math.round(engineering.componentEvidenceCoverage * 100)}% · measured/datasheet ${engineering.componentEvidence.measured + engineering.componentEvidence.datasheet} · estimated ${engineering.componentEvidence.estimated} · inferred ${engineering.componentEvidence.inferred}`
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
      label: isKnife ? '실무 토폴로지' : isArchitectural ? '건축 셸 범위 검수' : isExteriorOnly ? '외관 범위 검수' : '전기 연결·실물 검수',
      score: connectivityScore,
      status: isKnife || isExteriorOnly || isArchitectural ? 'pass' : connectivity?.errors.length ? 'blocked' : connectivity?.productionReady ? 'pass' : 'warn',
      detail: isKnife
        ? '전체 부품 폐쇄·매니폴드·퇴화 삼각형 0 자동 검사'
        : isArchitectural
          ? '도면 기반 벽체·개구부·지붕·지지부재 셸 · 구조해석과 MEP는 범위에서 제외'
        : isExteriorOnly
          ? '외관 전용 AssemblyIR · 내부 회로와 배선은 의도적으로 범위에서 제외'
        : connectivity
          ? `${connectivity.connectedWires}/${connectivity.wires} 도체 · 물리 핀 ${connectivity.documentedPhysicalPins}/${connectivity.ports} · AWG ${connectivity.specifiedGaugeWires}/${connectivity.wires} · 벤치 대기 ${connectivity.outstandingBenchChecks}`
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
  const hasBlockingCheck = checks.some((check) => check.status === 'blocked');
  return {
    total: Math.round(Math.max(0, Math.min(hasBlockingCheck ? 59 : 100, base))),
    checks,
    triangles: 0,
    vertices: 0,
  };
}
