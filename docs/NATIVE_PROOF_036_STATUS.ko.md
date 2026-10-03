# Native0.36 및 실제 품질 증빙

현재0.36에서5분야 fixture를 두 번 생성해 동일 SHA를 확인했다. Blender5import와5개 독립 편집/reopen, Godot5사례, asphalt PrusaSlicer, 실제 browser OBJ/STL/PLY·Asset Pack·USDZ 파일을 생성하고 Blender/static/usdchecker 검사를 통과했다. 포맷 교환과 편집의 해당 사례만 검증했으며 전체 형상·제조·전문가 품질을 승인한 것이 아니다. Unity는 not-run.

브라우저 추가 결함: Laurel의 실제 품질 패널은 공간 프로그램59/BLOCKED인데 SAVE PROOF가 고정 allow-list로 qualityReleaseReady:true를 기록했다. 현재 관측한 품질과 build metrics가 있어야 ready가 되며, static allow-list도 유지한다. effect/de-dup은 품질 결과 변경을 반영하고 SAVE 시에도 활성 결과의 실패를 보수적으로 반영한다. 기존 bool/schema/compiler/GLB 형상은 변경하지 않는다.

실제7SAVE PROOF 경로 PASS: Laurel/Blade/Cooler/ModernCat/WebHero blocked는 false, Asphalt/FieldHuman은 기존 허용 범위 true. 기존 benchmark의 expected ready=true는 변경하지 않았다. 따라서 현재 strict quality:production FAIL(전체/기술/의사결정78%,deliveryRelease67%,release browser proof2/4)이 맞다. Laurel 공간 프로그램, Blade122/Cooler1596 방향 충돌, 참조/전문가 비교 부족을 해결했다고 주장하지 않는다. 포맷 PASS로 품질 실패를 덮지 않는다.

공개686/원본705tests와check/build/benchmark PASS. static audit의 첫 잘못된 CLI 인자 실패 로그도 보존했다. 이 단계에는 core geometry 변경/새 의존성/threshold 완화가 없다. 실제 검사 모드는 Beauty이며 Clay에서 수정 후 품질 metrics의 최신성은 다음 검수 항목이고 아직 not-run이다.

UNI_AI: native 긴 검토1회402(사유 원문 미출력/분류 불가), 짧은 연결21tokens와축소검토346tokens 정상; proof 검토543tokens 정상. 전체 크레딧 소진은 확인되지 않아 Claude CLI fallback not-run. CLI 설치/help만 확인했으며 로그인/호출 가능성은 검증하지 않았다. 큰 문맥 요청의 가용성과 잔액 소진을 혼동하지 않는다.

실제 큰 파일은 로컬 outputs/native-036-20261003와 publication worktree outputs/native-036-20261003/fixtures에 있으며 공개 repo에는 hash-bound receipts와작은 native proof JSON을 보존한다. 이전0.35영수증을0.36으로 relabel하지 않았다. [검증](../benchmarks/modeling-slices-20261003/native-proof-036/verification.json),[보고 전후](../benchmarks/modeling-slices-20261003/native-proof-036/proof-before-reproduction.json). SAVE PROOF는 현재 실패도 기록하므로 해당 품질 blocker를 먼저 해결한 뒤 납품한다.
