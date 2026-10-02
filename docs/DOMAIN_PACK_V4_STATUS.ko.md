# Domain Pack API0.4 검수

기존API0.1~0.3 규칙을 유지하고 API0.4의 engineApi0.4와 native output schema0.1~0.6을 분리했다. 실제 생성schema 일치를 검사한다. SDK surface-gear는 기존gear/UV/surface 엔진과 명시적0.6 migration을 조합한다. 두 selector에 등록하고 공통inspector/workspace를 사용한다.

등록실패→수정,6schema conformance,미지원API/schema/단위/좌표/capability/input/provider 실패격리를 검수했다. 실제브라우저 생성→mm치수/PBR stagedcancel/apply→undo/redo→저장/재열기→일반GLB,fur+gear mixed source와 비대상 actualmesh/UV/PBR/image/계층 보존 PASS. 다른크기의3기어 생성/기하/PBR 검수와8파일 Blender 왕복/pixel/repeat8 PASS.

Mixed 일반export가 기존fur UV누락/inward winding/tinycap을 차단한 뒤 실제기하를 수정했다. renderer0.10이며 원본IR/ID 불변. UVseam의 exact geometric identity로 edge당2faces 검사 유지. 최초index-only closure 실패 보존. 32asphalt 측정은 유지하고 단위test redundantlarge샘플을20개로 줄여 같은byteoverflow를5초 안에 검수하며 별도 cold97smallmaps의96entry guard도 확인했다. 상한/품질검사를 낮추지 않았다.

등록 자체는 experimental이다. sectionB는 groom/해부학검증이 아니다. PoleUV pinching/atlas/padding/극단twist 자기교차는 미검증. Defaultgear Node/browser actualpayload/decodedpixels는 같지만 fur Float64 matrix 일부극소수점 차이는 남아 fullruntime동일성은 주장하지 않는다. PNGencoder 차이는 decodedRGBA로 검수했다. Production독립비교부족FAIL/제조·전문가 미검증 유지.

UNI_AI gpt-6-sol 검토2회 총2,845tokens,실행증거와 구분했다. winding/pole fan 검토와tipUV/큰twist 위험을 제한에 반영했다. actualsource/artifact/hashes/중립wire·clay 전후: outputs/domain-pack-v4-20261002. 초기close unusedmesh framing 실패도 보존했다. 검수명령의 최초isolatedcopy작업은 cwd착오로 실패했고 source에서 재수행한 뒤 current scoped검사를 별도로 실행한다.

사용: /?editor=elements 또는workspace의 Pack목록에서 example.surface-gear.visual 선택→Generate/Append→공통 inspector 편집. JSON은 원본,GLB는 bakedmesh. 등록됐어도 actual 검사에 실패하면 일반export는 차단된다.

현재검사: source90files622tests/check/build PASS;게시범위87files603tests/check/build PASS. quality:production은 현재수정본으로 재실행하고 독립비교0/3으로FAIL 유지. Close는 실제1mesh와 before기준 정규화고정으로 camera/light/scale을 동일하게 재렌더했다. 계획30분 초과를 기록한다.

중립전후: [before wire](../benchmarks/modeling-slices-20261002/domain-pack-v4/renders/before-wire.png) / [after wire](../benchmarks/modeling-slices-20261002/domain-pack-v4/renders/after-wire.png), [before close](../benchmarks/modeling-slices-20261002/domain-pack-v4/renders/before-close-locked.png) / [after close](../benchmarks/modeling-slices-20261002/domain-pack-v4/renders/after-close-locked.png). 원자료가 없는 authored scene의 구조검수다.
