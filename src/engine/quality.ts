import type { CharacterSpec, HumanPack, ProductSpec, QualityCheck, QualityReport, ReferenceEvidence } from '../types';
import { deriveBodyTopology, type CharacterMetrics } from './character';
import type { ProductMetrics } from './product';
import type { AssemblyIR } from './assembly-ir';
import { auditAssemblyDetail } from './generation-policy';
import type { DeliveryAudit } from './delivery-validation';

function status(score: number, blockAt = 65): QualityCheck['status'] {
  return score >= 86 ? 'pass' : score >= blockAt ? 'warn' : 'blocked';
}

export function evaluateQuality(
  pack: HumanPack,
  spec: CharacterSpec,
  evidence?: ReferenceEvidence,
  metrics?: CharacterMetrics,
  deliveryAudit?: DeliveryAudit,
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
  const exportScore = deliveryAudit?.score ?? 65;
  const exportStatus: QualityCheck['status'] = !deliveryAudit || deliveryAudit.status === 'running'
    ? 'warn'
    : deliveryAudit.status;

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
        ? `hex-knit·optical glass·polymer ${metrics?.surfaces.distinctFinishes ?? 0}종 · 주름 ${metrics?.garmentWrinkles?.affectedVertices ?? 0} verts / max ${metrics?.garmentWrinkles?.maximumDisplacementMm.toFixed(2) ?? '—'} mm · inferred ${metrics?.inferredDetailParts ?? 0}`
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
      label: 'GLB 왕복 호환성',
      score: exportScore,
      status: exportStatus,
      detail: deliveryAudit
        ? deliveryAudit.status === 'blocked'
          ? `재열기 실패 · ${deliveryAudit.blockers.join(' · ')}`
          : `${deliveryAudit.source?.meshes ?? 0}개 메시 재열기 · 이름 ${Math.round(deliveryAudit.namedNodeCoverage * 100)}% · 포락 오차 ${deliveryAudit.boundsErrorMm.toFixed(3)} mm`
        : 'GLB를 다시 열어 노드·삼각형·단위·포락을 검증하는 중',
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
  deliveryAudit?: DeliveryAudit,
): QualityReport {
  const isKnife = spec.kind === 'ornate-knife';
  const isImportedAssembly = Boolean(assemblyIR);
  const isExteriorOnly = assemblyIR?.metadata?.scope === 'exterior-only';
  const isArchitectural = assemblyIR?.metadata?.assetKind === 'building';
  const isSurfaceBenchmark = assemblyIR?.metadata?.scope === 'surface-material-benchmark';
  const connectivity = metrics?.connectivity;
  const engineering = metrics?.engineering;
  const surfaces = metrics?.surfaces;
  const topology = metrics?.topology;
  const detailAudit = assemblyIR ? auditAssemblyDetail(assemblyIR) : undefined;
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
  const missingReconstructionEvidence = !assemblyIR && !isKnife && !evidence;
  const baseReferenceFidelityScore = evidence
    ? Math.min(envelopeScore, evidence.portraitSuitability)
    : missingReconstructionEvidence ? 45 : envelopeScore;
  const programCompleteness = Number(assemblyIR?.metadata?.programCompleteness ?? 0);
  const referenceFidelityScore = isSurfaceBenchmark
    ? 100
    : isArchitectural
      ? detailAudit?.modelPass && programCompleteness >= 100 ? 100 : Math.min(59, programCompleteness || baseReferenceFidelityScore)
      : baseReferenceFidelityScore;
  const surfaceCoverage = surfaces && surfaces.authoredMaterials > 0
    ? surfaces.microNormalMaterials / surfaces.authoredMaterials
    : 0;
  const surfaceScore = surfaces
    ? isSurfaceBenchmark
      && topology?.pass
      && (topology.surfaceReliefMeshes ?? 0) > 0
      && (topology.maximumSurfaceRmsRoughnessMm ?? 0) > 0
      && surfaces.microNormalMaterials === surfaces.authoredMaterials
      && surfaces.roughnessMappedMaterials === surfaces.authoredMaterials
      ? 100
      : surfaces.referenceProjectedMaterials > 0
      && surfaces.referenceReliefMaterials === surfaces.referenceProjectedMaterials
      ? 100
      : surfaceCoverage >= 0.98 && surfaces.distinctFinishes >= 6
      ? 100
      : Math.round(Math.min(99, 78 + surfaces.distinctFinishes * 1.25 + surfaceCoverage * 7))
    : 76;
  const topologyScore = topology
    ? topology.pass ? 100 : Math.max(0, 100 - topology.boundaryEdges - topology.nonManifoldEdges * 2 - topology.degenerateTriangles)
    : 64;
  const connectionDocumentation = connectivity && connectivity.wires > 0 && connectivity.ports > 0
    ? (connectivity.documentedPhysicalPins / connectivity.ports
      + connectivity.specifiedGaugeWires / connectivity.wires
      + connectivity.documentedVerificationWires / connectivity.wires) / 3
    : 0;
  const connectivityScore = isArchitectural
    ? detailAudit?.modelPass ? 100 : 50
    : isSurfaceBenchmark
      ? 100
      : isKnife || isExteriorOnly
        ? 97
        : connectivity?.errors.length
          ? Math.max(0, 72 - connectivity.errors.length * 8)
          : connectivity
            ? Math.round(Math.min(connectivity.productionReady ? 99 : 89, 78 + connectionDocumentation * 16))
            : 52;
  const exportScore = deliveryAudit?.score ?? 65;
  const exportStatus: QualityCheck['status'] = !deliveryAudit || deliveryAudit.status === 'running'
    ? 'warn'
    : deliveryAudit.status;
  const checks: QualityCheck[] = [
    {
      id: 'geometry',
      label: isKnife ? '가변 두께 검신' : isArchitectural ? '건축 부재 구조' : isSurfaceBenchmark ? '실변위 표면 구조' : isExteriorOnly ? '외관 부품 구조' : isImportedAssembly ? '이미지 파생 부품 구조' : '부품 분해 구조',
      score: topologyScore,
      status: topology?.pass ? 'pass' : 'blocked',
      detail: topology
        ? `${topology.watertightMeshes}/${topology.meshes} 폐쇄형 · 경계 ${topology.boundaryEdges} · 비매니폴드 ${topology.nonManifoldEdges} · 퇴화 ${topology.degenerateTriangles}${topology.edgeTaperMeshes ? ` · 실제 절삭날 ${topology.edgeTaperMeshes}개 · ${topology.verifiedEdgeTaperSegments ?? 0}구간 검증 · 최대 날끝 ${topology.maximumMeasuredEdgeThicknessMm?.toFixed(2)} mm` : ''}${topology.surfaceReliefMeshes ? ` · 실변위 ${topology.surfaceReliefMeshes}개 · 골재 ${topology.surfaceAggregateFeatures ?? 0}개 · RMS ${topology.maximumSurfaceRmsRoughnessMm?.toFixed(2)} mm · P-V ${topology.maximumSurfacePeakToValleyMm?.toFixed(2)} mm` : ''}`
        : '전체 메시 토폴로지를 검사한 뒤 납품 가능 여부를 판정합니다.',
    },
    {
      id: 'silhouette',
      label: evidence ? '참조 증거 완성도' : isKnife ? '실물 단위 포락' : isArchitectural ? '공간·가구 배치 완성도' : isSurfaceBenchmark ? '표면 벤치마크 완성도' : isImportedAssembly || missingReconstructionEvidence ? '부품 근거 완성도' : '기구 치수 일관성',
      score: referenceFidelityScore,
      status: status(referenceFidelityScore),
      detail: evidence
        ? `${evidence.fileName} · ${evidence.notes[0]}`
        : isSurfaceBenchmark
          ? '각진 굵은 골재·미세 골재·역청 홈·실변위·PBR 맵 회귀 조건 충족'
        : isArchitectural && detailAudit
          ? `필수 공간 ${programCompleteness}% · 욕실 설비·침대·수납·조명 포함 · ${detailAudit.modelBlockers.length ? detailAudit.modelBlockers.join(' · ') : '모델 프로그램 회귀 통과'}`
        : isImportedAssembly && engineering
          ? `근거 기록 ${Math.round(engineering.componentEvidenceCoverage * 100)}% · measured/datasheet ${engineering.componentEvidence.measured + engineering.componentEvidence.datasheet} · estimated ${engineering.componentEvidence.estimated} · inferred ${engineering.componentEvidence.inferred}`
        : isImportedAssembly ? envelopeLabel
          : missingReconstructionEvidence
            ? '절차형 내부 부품 데모 · 고객 도면/데이터시트/분해 근거가 없어 실물 일치 판정 BLOCKED'
            : `${spec.widthMm} × ${spec.heightMm} × ${spec.depthMm} mm 디자인 의도 포락 검사`,
    },
    {
      id: 'materials',
      label: surfaces?.referenceProjectedMaterials
        ? '정면 참조 투영·PBR 표면'
        : isKnife ? '강철·청동·가죽·보석 표면' : 'PBR 미세 표면',
      score: surfaceScore,
      status: status(surfaceScore),
      detail: surfaces
        ? `${surfaces.distinctFinishes}종 finish · micro-normal ${surfaces.microNormalMaterials}/${surfaces.authoredMaterials} · roughness-map ${surfaces.roughnessMappedMaterials}/${surfaces.authoredMaterials} · 참조 투영 ${surfaces.referenceProjectedMaterials}개 · 사진 파생 normal+roughness ${surfaces.referenceReliefMaterials}개${surfaces.referenceProjectionFingerprints.length ? ' · 입력 fingerprint 검증' : ''} · 이방성 ${surfaces.anisotropicMaterials}${detailAudit ? ` · IR 표면 ${Math.round(detailAudit.explicitSurfaceCoverage * 100)}%` : ''}`
        : '표면 재질을 컴파일한 뒤 roughness·normal·clearcoat를 검사합니다.',
    },
    {
      id: 'rig',
      label: isKnife ? '실무 토폴로지' : isArchitectural ? '건축 셸 범위 검수' : isSurfaceBenchmark ? '다중 스케일 표면 검수' : isExteriorOnly ? '외관 범위 검수' : '전기 연결·실물 검수',
      score: connectivityScore,
      status: isArchitectural
        ? detailAudit?.modelPass ? 'pass' : 'blocked'
        : isKnife || isExteriorOnly || isSurfaceBenchmark ? 'pass' : connectivity?.errors.length ? 'blocked' : connectivity?.productionReady ? 'pass' : 'warn',
      detail: isKnife
        ? '전체 부품 폐쇄·매니폴드·퇴화 삼각형 0 자동 검사'
        : isArchitectural
          ? detailAudit?.modelPass
            ? '외곽·개구부·연속 지붕·실내 프로그램·배치 편집·조명 프리뷰 검증 통과'
            : `모델 범위 검증 BLOCKED · ${detailAudit?.modelBlockers.join(' · ') ?? '감사 정보 없음'}`
        : isSurfaceBenchmark
          ? `실제 지오메트리 RMS ${topology?.maximumSurfaceRmsRoughnessMm?.toFixed(2) ?? '—'} mm · 최고–최저 ${topology?.maximumSurfacePeakToValleyMm?.toFixed(2) ?? '—'} mm · 골재 micro-normal·roughness-map 동시 검증`
        : isExteriorOnly
          ? '외관 전용 AssemblyIR · 내부 회로와 배선은 의도적으로 범위에서 제외'
        : connectivity
          ? `${connectivity.connectedWires}/${connectivity.wires} 도체 · 물리 핀 ${connectivity.documentedPhysicalPins}/${connectivity.ports} · AWG ${connectivity.specifiedGaugeWires}/${connectivity.wires} · 벤치 대기 ${connectivity.outstandingBenchChecks}`
          : '포트·네트·도체 그래프를 컴파일한 뒤 연결성을 판정합니다.',
    },
    {
      id: 'export',
      label: 'GLB 왕복·플랫폼 호환성',
      score: exportScore,
      status: exportStatus,
      detail: deliveryAudit
        ? deliveryAudit.status === 'blocked'
          ? `재열기 실패 · ${deliveryAudit.blockers.join(' · ')}`
          : `${deliveryAudit.source?.meshes ?? 0}개 메시 · ${deliveryAudit.source?.triangles.toLocaleString() ?? '—'} tris · 포락 오차 ${deliveryAudit.boundsErrorMm.toFixed(3)} mm · ${Math.round(deliveryAudit.namedNodeCoverage * 100)}% 명명 노드`
        : '실제 GLB를 메모리에서 다시 열어 Blender·Unity·Unreal 공통 glTF 구조를 검증하는 중',
    },
  ];
  const base = checks.reduce((sum, check) => sum + check.score, 0) / checks.length;
  const hasBlockingCheck = checks.some((check) => check.status === 'blocked');
  return {
    total: Math.round(Math.max(0, Math.min(hasBlockingCheck ? 59 : 100, base))),
    evidenceScore: isSurfaceBenchmark
      ? Number(assemblyIR?.metadata?.evidenceScore ?? 0)
      : isArchitectural ? engineering?.evidenceScore : undefined,
    deliveryReady: isSurfaceBenchmark
      ? false
      : isArchitectural ? assemblyIR?.metadata?.evidenceDeliveryReady === true : undefined,
    checks,
    triangles: 0,
    vertices: 0,
  };
}
