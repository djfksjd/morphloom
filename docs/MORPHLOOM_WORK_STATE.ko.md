# Morphloom 재개 상태

2026-10-02. 대상 `/Users/danny/Documents/morphloom`, remote `djfksjd/morphloom`, 기준 HEAD `a200aa4593aa14a9f0348b014962d144d119c741`. Raptor 실험과 별개다. 사용자 변경을 보존하며 커밋·push·배포하지 않았다. UNI_AI 우선 조회2회 HTTP403, completion not-run. 키를 출력하거나 원자료를 전송하지 않았다.

완료한 좁은 goal:

1. 창작 베어링의 groove/chamfer·관통 케이지·독립 볼 생성, 국부 편집·분리·복원·Blender 납품. `BEARING_SLICE_STATUS.ko.md`.
2. 서로 다른 Pack의 seed/ID/사용자 편집을 보존하는 mixed workspace. `WORKSPACE_SLICE_STATUS.ko.md`. 기존 repair의 UV 삭제 결함도 수정했다.
3. 자산 추가와 여러 asset 편집의 bounded 전체 Undo/Redo. `WORKSPACE_HISTORY_STATUS.ko.md`.

최신81파일·588테스트, check/build/benchmark PASS. `quality:production`은 독립 비교 자료 부족으로 FAIL. 제조·전 분야·전문가 수준 완료를 주장하지 않는다. outputs별 현재 source/file hashes와 영수증을 따른다. git status/diff는 dataless index 때문에 blocked이고 인덱스를 재작성하지 않았다. reset/checkout으로 사용자 변경을 정리하지 않는다.

UI는 `/?editor=elements`와 `/?editor=workspace`다. Preview는 HMR 없이 검수할 수 있다. Dev는 macOS tsconfig 이벤트로 반복 reload될 수 있다. JSON은 편집 원본, GLB는 baked mesh다.

완료한 네 번째 좁은 goal: spur gear 생성·연결 feature 편집/진단 추출·Blender 재열기. SPUR_GEAR_SLICE_STATUS.ko.md와 outputs/spur-gear-20261002/replay/evidence.json을 따른다. elements0.3과 명시적 migration을 추가하고 기존0.1/0.2를 유지했다.

제조용 치근·강도·맞물림 검증은 별도 범위다.

다섯 번째 좁은 goal 완료: 연결 tooth 화면 선택·윤곽·공통 inspector 동기화. GEAR_PICKING_STATUS.ko.md를 따른다. 새 활성 goal: Node/browser 간 bore UV6좌표 차이 원인과 안정 생성 수정. 선택 전후 같은 브라우저 납품 바이트는 보존됐지만 cross-runtime UV 동일성은 아직 미충족이다.

여섯 번째 좁은 goal 완료: Node/browser 대각선 측벽 UV 축 선택 안정화. EXTRUDE_UV_STABILITY_STATUS.ko.md를 따른다.5개 실제 사례의 UV/geometry/normal/PBR/계층 byte comparison와 Blender 재열기를 통과했다. 현재 증거는 outputs/extrude-uv-20261002/verification.json이다. 기존 UV atlas/overlap 한계는 유지하며 텍스처 사용자가 UV 변경 범위를 검토해야 한다.

활성 goal: 실제 UV 품질 검사 확장. UV_QUALITY_CONTRACT.ko.md와 outputs/uv-quality-20261002/baseline.json에서 재개한다. 실제 GLB의 기존 design-uv는 gear17.77%/small32.01% 퇴화로 FAIL, large4.81%/bearing/extrude는 UV 항목 PASS다. 전체 production readiness PASS를 의미하지 않는다. 기존0.05/1e-10 기준을 변경하지 않는다.

일곱 번째 좁은 goal 완료: 실제 UV 품질 검사와 current source/output SHA 연결, scoped ID, per-mesh/tooth 실패 표시, preview/선택/diagnostic/workspace 내보내기 보고서. UV_QUALITY_STATUS.ko.md와 outputs/uv-quality-20261002/verification.json을 따른다. 기존 gear/small UV 실패는 그대로이며 보고서 구현 성공을 모델 품질 합격으로 혼동하지 않는다. mixed rigid matrix의 cross-runtime 마지막 자릿값 차이는 strict comparator FAIL로 보존했다. 다음 우선순위는 opt-in 선언형 UV scale 편집과 synthetic checker로 실제 UV 개선 검증이다.

활성 goal: opt-in part UV scale과 synthetic checker 검수. UV_SCALE_CONTRACT.ko.md에서 재개한다. 실제 구현은 아직 not-run. 기존 실패/원본과 검사 threshold를 보존하고 실제 좌표·checker·납품으로 확인한다.

여덟 번째 좁은 goal 완료: opt-in part UV scale0.4·staged inspector·synthetic checker. UV_SCALE_STATUS.ko.md와 outputs/uv-scale-20261002/verification.json을 따른다. 실제5파일 UV-only preservation,5 Node/browser,8 Blender 재열기,82파일591테스트 PASS. 기존 threshold/releaseAllowed 유지. 전후checker전체렌더 PASS,추가close framing FAIL 보존. 생산 독립 비교 부족 FAIL/atlas·제조 미검증/UNI_AI403/git index blocked 유지. 현재 활성 상태는 goal 도구와 가장 최근 체크포인트를 따른다.

아홉 번째 좁은 goal 완료: 실제 mm 단위 gear axial chamfer0.5와 국부 편집/납품. GEAR_CHAMFER_STATUS.ko.md와 outputs/gear-chamfer-20261002/verification.json을 따른다.83파일595테스트·4 Node/browser·5 Blender reopen·mixed2mm edit preservation·7 Blender파일 Khronos PASS. 전체/ROI 전후 렌더 검수. Raw AssemblyIR4096 guard 유지, bounded derived gear8192 경로 추가. 기존 강제 unused tangent 출력 오류를 source-dependent policy로 수정하고 invalid mixed files/보고서를 보존했다. chamfered sector unsupported, 제조/atlas/전문가 미검증, production 독립비교 부족 FAIL 유지.

열 번째 좁은 goal 완료: bounded deterministic 회전으로 mixed Node/browser strict matrix 차이 해결. DATUM_ROTATION_STATUS.ko.md/outputs/datum-rotation-20261002/verification.json.84파일597테스트·4완전GLB바이트 Node/browser/replay동일·5 Blender/Khronos PASS. 원본 source와local geometry/UV/PBR 보존, mixed 편집/undo/reload/export 검수. workspace-engine0.3/renderer0.8이며schema 불변. 이전strict FAIL/currentbaseline도 보존했다. 전체 rig/resolver/모든GPU/GIS정밀도 인증이 아니다. Production 독립비교 부족FAIL/UNI_AI403/gitindexblocked 유지.

열한 번째 좁은 goal 검수: Part surface0.6 opt-in roughness-only·기존 surface-system 재사용·renderer0.9. PART_SURFACE_STATUS.ko.md/outputs/part-surface-20261002/verification.json.85파일600테스트/check/build PASS,16GLB Khronos errors0,4Blender pixels/repeat 보존,UI staged/history/save/reload PASS. production 독립비교 부족FAIL/UNI_AI403/gitindexblocked 유지. normal/tangent/실측/atlas 미검증. 다음 우선순위는 실제 texture transform을 반영한 texel density다.

열두 번째 좁은 goal 검수: 실제 metallic-roughness map 해상도/transform의 per-triangle·mesh·feature texel density와 누락 표시. TEXEL_DENSITY_STATUS.ko.md/outputs/texel-density-20261002에서 재개.86파일604테스트 PASS,실제4browser reports와 native density exact,납품4GLB bytes 보존·현재Blender pixels 확인. report0.2,원본IR·geometry/PBR·기존임계값 불변. Atlas/padding/mip/unique coverage 미검증.

2026-10-02 게시 검수: 요소 편집·베어링/기어·workspace·표면/UV 검사를 포함한 별도 체크아웃에서83파일585테스트/check/build/benchmark를 확인했다. 기존 회로·시뮬 작업과 원본 dataless index는 보존했다. 선택 공개 IR/GLB/중립 렌더/현재검수 로그·SHA는 benchmarks/modeling-slices-20261002에 보관한다. 이 문서의 과거 no-push 기록은 해당 단계 시점의 기록이며 현재 게시 요청과 구분한다.
