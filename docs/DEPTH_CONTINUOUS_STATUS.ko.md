# 선언된 구면 전면의 연속 경계 — 2026-10-03

native0.3의 선택적 depth-meshing/0.1로 기존 Three.js SphereGeometry를 가시 전면에 재사용했다. 반지름/XY는 명시적IR, Z는 독립 mm anchor와 검증된 fit에서 얻는다. 전면만 생성하며, 원본 mask와 같은 pixel-centre footprint 및 카메라 frame 전체 포함을 먼저 확인한다. 토러스/구멍/가림/잘린frame·과도한triangle예산을 거부한다. 원본의 실패 보고서는 계속 보존한다. releaseAllowed:false와 .100/.250/.001 기준을 낮추지 않았다.

새 경로는 대상의 topology/UV/index가 달라지므로 UI에서 명시적으로 선택해야 한다. 기본 raw/grid 경로와 native0.1/0.2는 유지한다. 마이그레이션은 깊은복사이며 원본/quality/calibration/fingerprint를 유지하고 미확인 자료를 unknown으로 남긴다. 격자 경로5GLB는 f734ce0과 전체바이트가 동일하다. 이전 bearing프로젝트는 전체SHA를 보존하며 다른 부품의 compiler/patch를 변경하지 않았다.

2크기×matte/checker와3mm볼을 검증했다. 큰구면 경계최대radial deficit1.737795→0.008995mm, 작은구면1.698166→0.007152mm,3mm볼0.106135→0.000447mm다. 모든edge/면의 sphere centre에 대한closest-point chord deviation이 사전 maxSagittaMm=min(.02,radius/3000)을 통과한다. 최대정점 구면오차<.001mm, unit/radial normal, 단일열린rim을 확인했다. 전면circle의 다각형 근사는 선언오차 내이며 원본mask/픽셀field를 수정하지 않는다. 이는 작성된fixture와 선언IR에 대한 근사기하 검증이다. 사진에서 반지름·후면·실측형상을 복원했다는 뜻이 아니다.

GLB10개는 UV/Khronos,퇴화/non-manifold/self-intersection0을통과했다. 의도된열린부분표면이므로 일반closed-solid topology.pass는false이며 일반납품승인으로 바꾸지 않았다. Blender5.2.1에서10개재열기·재내보내기, 선택볼1mm정점편집·재열기·복원 및 편집파일2개Khronos를확인했다. 진단용greyPBR/UV/명명/계층/sourceextras를보존했다. 사진텍스처베이크·일반재질납품은이번검수범위가아니다.

PHOTO EVIDENCE→깊이검수(/?editor=depth)에서기존depth0.2JSON을열고, '선택적 연속 구면 경계 · native0.3'에서chord허용오차mm를확인한뒤'연속 구면 전면 (대상 topology·UV 변경)'을선택한다. 적용/입력취소,예산초과시기존상태보존,Undo/Redo(연산·허용오차),저장/재열기와실제GLB를검수했다. 원본nativeJSON과GLB를함께보존한다. 선언된구면이없는torus의연속기능은비활성화된다. Node/browser2GLB는전체바이트가같다.

동일fixedspace/camera/light/1024² clay front/iso/wire/공통ROI의comparison.png에서기존톱니경계가감소했다. 모든renderer영수증의camera/light/settings/fixedspaceSHA와이미지SHA를대조했다. 원본 자료가 없는등각은구조검수다. 캐릭터/일반곡면/전문가/실제품/제조/BREP는not-run이다. M5/macOS/Node24환경에서fixturecompile은약7–25ms,16,562–19,012triangles(실제값은evidence.json);모든기기보장은없다.

UNI_AI의공식gateway모델조회200,gpt-6-sol접근확인. 공개코드+계약만검토1회요청했으나55초응답timeout으로검토결과와토큰/과금은unknown이며자동재시도하지않았다. 키/원본사진외부전송없음. 검증은로컬실행결과다.

Source93files652tests PASS. 게시scope와check/build/benchmark/quality:production은현재clone의publish-checks에기록한다. production의독립비교0/3부족실패는유지한다. 공개증거는benchmarks/modeling-slices-20261003/depth-continuous이며verification.json이현재engine/input/source/outputSHA를묶는다. 재실행은작업복사본에서 `npx vite-node scripts/depth-continuous-evidence.ts benchmarks/modeling-slices-20261003/depth-continuous benchmarks/modeling-slices-20261003/depth-boundary`, 이미지비교는 `npx vite-node scripts/depth-continuous-compare.ts benchmarks/modeling-slices-20261003/depth-continuous`이다.

현재 게시scope90files633tests/check/build/benchmark PASS. quality:production exit1은qualitygate 통과 뒤 독립비교0/3부족이며 기존기준을유지한다. source package.json의무관한sim:test추가와19개sim테스트는보존하고게시범위에넣지않았다. 원본Gitindex접근128오류는복구/교체하지않고별도cloneallowlist로게시한다.
