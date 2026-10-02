# 일반/진단 메시 내보내기 검수

2026-10-02. 일반 GLB 다운로드가 UV 실패 보고서와 함께 성공하던 경로를 고쳤다. 기존 inspectExportedUv/analyzeTopology/Khronos 검사와 임계값을 재사용한다. 원본 IR/patch/schema, geometry 생성과 releaseAllowed는 변경하지 않았다. 이것은 static mesh 검사이며 production/atlas/제조/전문가 승인으로 승격하지 않는다.

변경: src/engine/mesh-export-policy.ts, src/ElementEditor.tsx, src/WorkspaceEditor.tsx, tests/mesh-export-policy.test.ts. 일반 export는 실제 내보낸 bytes의 UV integrity·critical feature·static coverage와 standard errors0/독립 parser read를 요구한다. 실패 ID와 해결 경로를 표시하고 다운로드를 차단한다. 프로젝트/workspace UV diagnostic 버튼과 checker/tooth diagnostic은 purpose='diagnostic', productionApproved=false, 실제 실패 목록과 validator 결과를 sidecar에 남긴다. UI의 오래된 검사 결과로 승인하지 않으며 superseded project는 기존 가드로 폐기한다.

현재 native volumetric 생성기는 기존 closed topology 검사를 따른다. 의도된 열린 표현에 대한 승인 계약은 미지원이다. 0.2+의 기존 topology gate는 진단에도 유지한다. 0.1 자료는 load/preview 호환을 유지하고, 기존에 없던 topology 승인 의미를 진단에 부여하지 않는다: legacy 진단은 topologyInspection not-run과 UV 실패/누락을 기록한다. 일반 export의 검수 실패는 차단된다.

실제 default gear1490/8384 UV퇴화(17.77%)는 일반 export 차단, UV100 수정은 통과. 치아 하나를 고정5% 기준보다 많이 손상시켜도 전체는5% 미만인 사례에서 해당 feature ID로 차단됐다. 초기 테스트의12손상/294면은 기준 미만이라 실패 사례가 아니었으며, 기존 기준을 넘는15면 손상으로 입력을 고쳤다. 기준은 변경하지 않았다.

브라우저: standalone 실패 차단/명시진단/수정 후 일반 export PASS. mixed workspace의 gear::spur_gear 실패 차단, 수정·undo/redo·save/reload PASS. 비대상 source와 실제12메시의 position/normal/index/PBR/계층/datums/비대상 UV가 정확 보존됐다. 선택 gear UV만 차이를 허용했다. 현재4GLB와4Blender 왕복파일 Khronos errors0,4Blender bounds/geometry/PBR/hierarchy 검사 PASS. clay 전후1024 동일조건 RGBA pixels도 동일하여 geometry 생성 회귀가 없음을 확인했다.

기존 whole bird 진단 보고서의 pretty JSON은21655441bytes로20MB guard에 걸렸다. 원인을 재진단하고 모든 정보를 유지한 compact JSON으로12807447bytes에 저장했다. 파싱한 object 동일,79584triangle rows·99meshes 보존;20MB guard/검사/개별 실패를 생략하지 않았다. 다운로드 순서 가정과 selector quoting 오류의 검수 스크립트 로그도 보존했고, magic bytes·실제 companion receipt SHA를 확인하도록 고쳤다. Legacy 전체 bird 진단 파일도 실제 생성됐다.

최신 전체87파일608테스트 PASS,check/build PASS. quality:production은 독립 비교 부족으로 기존 FAIL이다. 관련 현재 명령·로그는 outputs/mesh-export-gate-20261002에 있다. IR/GLB/sidecar/Blender/중립렌더/현재 source와artifact SHA는 verification.json. PNG filename/date/render-time metadata 때문에 파일bytes는 다르며 render-preservation.json의 실제 RGBA 비교를 따른다. UV/topology/standard 검사 성공을 신체·실물 비율/atlas/전 분야 완성으로 해석하지 않는다.

사용: 일반 Export project/workspace GLB는 실패 원인을 해결한 뒤 실행한다. 조사용 파일은 명시적으로 Export project/workspace UV diagnostic GLB를 선택한다. checker와 연결 tooth cut도 진단이다. JSON은 재편집 원본, GLB는 baked mesh다. diagnostic sidecar의 productionApproved는 항상false다.

이 목표 이전의 게시 커밋은 a8596af669e5c4e8f4012cf8fd3fe8e064680711(main,원격확인)이다. 후속 내보내기 gate 변경은 당시 체크포인트와 구분한다. 원본 dataless index와 무관한 회로/시뮬 변경을 보존했다. UNI_AI403/completion not-run,원자료 전송 없음. 다음 확인 결함: PBR scalar 편집 UI가 기존 material.surface를 보존하는지 실제 편집·파일로 검증한다.
