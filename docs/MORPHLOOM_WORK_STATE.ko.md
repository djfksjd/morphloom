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

사용자 승인으로2026-10-02 main push 완료: a8596af669e5c4e8f4012cf8fd3fe8e064680711. 별도 체크아웃의 scoped83파일585테스트/check/build/benchmark PASS,독립production evidence 부족FAIL. benchmarks/modeling-slices-20261002에 공개 IR/GLB/렌더/현재검수 포함. 원본 index/무관한 변경 보존. 새 활성 goal은 MESH_EXPORT_GATE_CONTRACT.ko.md: 일반 GLB 다운로드의 실제UV/critical feature 실패 차단과 명시적 진단 경로;후속변경 아직미게시.

추가내보내기 goal 검수: MESH_EXPORT_GATE_STATUS.ko.md,outputs/mesh-export-gate-20261002. 일반UV/criticalfeature 실패 차단·명시진단purpose·actualGLB standard 검수·mixed undo/save/비대상파일 보존. 기존0.1진단은topology not-run을 명시하고20MB 상한을모든정보보존compactJSON으로지켰다.87파일608테스트/check/build PASS,4Blender reopen·8actualGLB Khronos 오류0,clay RGBA 동일. 원격게시 a8596af와후속로컬변경 구분. production 독립비교부족/전문가·제조·atlas 미검증 유지.

내보내기 goal main push/원격검증 완료: beef8823d656fbb667462ab4fae64d6e4320c2bb. 게시범위84파일589테스트/check/build PASS. 원본범위87파일608테스트 PASS. 최초push/기하검수와후속20분+10분 검수·별도게시검증을합해약39분. 다음활성goal은 PBR scalar 편집의선언형surface 보존이며실제브라우저재현부터시작.

PBR scalar 표면유실 goal 검수: PART_MATERIAL_PRESERVATION_STATUS.ko.md/outputs/part-material-preservation-20261002.2handler 최소수정,기어/볼 stage/history/save/export·actualgeometry/UV/non-targetPBR·Blenderpixels 보존,87파일608테스트/check/build PASS. 이것은로컬fix이며현재main beef882와구분하고다음의미있는batch에서게시. baselineworkingfile overwrite는재구성SourceSHA확인과명시로보정했다. 다음은surfacecache CPU/GPU accounting 실제측정.

표면캐시 CPU payload 누락 수정: SURFACE_CACHE_STATUS.ko.md / outputs/surface-cache-20261002/verification.json. 기존32MiB/96entry 유지,actualpayload+mip56MiB→31.5MiB,actualGLB 참조/payload동일(이미지저장순서로wholehash차이),editorowneddispose,88files609tests/check/build/Blender PASS. Khronos tangent warning1(strict FAIL)보존. 이전PBRscalar actualelapsed1487s(15분계획 초과). 두fix를한checkpoint로게시.

의미있는두fix main게시/원격SHA검증: aef595f4b36c69b4dd411b3f531ec803105f753e. 공개검수85files590tests/check/build PASS;productionFAIL 유지. 다음goal은 최신elements0.6 생성물을 선언하고 실행할수없는DomainPack version/representation 결합의후방호환 확장과 실제 mixed workspace 검수다.

DomainPack API0.4 최신source0.6 생성/공통UI/혼합/actualGLB/Blender 검수: DOMAIN_PACK_V4_STATUS.ko.md,outputs/domain-pack-v4-20261002/verification.json. Mixed export에서 드러난 sectionUV누락/inward/tinycap을renderer0.10으로수정.90files622tests(게시87files603)/check/build PASS,5actualbrowser normalexports,8Blenderpixel/repeat PASS. production독립비교0/3FAIL,fur strictNode/browser matrix/poleUV/극단twist/제조·전문가 미검증 유지. UNI_AI2회2,845tokens.

2026-10-03 사진 출처 보호·선택적 깊이 실험: PHOTO_DEPTH_SLICE_STATUS.ko.md. manifest0.2/legacy0.1 호환, synthetic/unknown 강한 근거 제외, SHA 기반 atomic 저장/재열기, 좁은 PHOTO EVIDENCE UI. 원본90files637tests/check/build/benchmark PASS. pinned Small CPU5실행·raw byte replay; 구형4사례 MAE .036–.051 통과, 토러스 .150>.100 실패. 자동 geometry 채택 보류, 실제제품/Blender 납품 not-run. UNI_AI models403, production독립비교부족FAIL 유지. 다음은 실제 기하·관통 제약 검수이며 모든분야 완료가 아니다.

선택적 depth 가시표면0.1·카메라/독립mm anchor·nativefield보존/Undo/save/reopen·실제진단GLB/Blender 구현. DEPTH_SURFACE_STATUS.ko.md.12Blender/2Node-browser bytes/10UV-Khronos PASS, 토러스 anchor FAIL 및 구형 경계최대32–50mm 오류 FAIL. calibration 평균통과≠형상합격, 모든GLB releaseAllowed:false. UNI_AI정상헤더 models/chat/responses200 재확인·4214+15tokens, 기존403점검 헤더누락수정. 다음은 경계ROI와declareddepthbounds이며 자동depth채택없음.
