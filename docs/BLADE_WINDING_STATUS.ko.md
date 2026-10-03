# 검신·튜브 면 방향 교정

기존 칼 IR의122방향 충돌을 검신 옆면40과4튜브 끝면82로 분해해 재현했다. 버전이 명시된 `sideWinding`0.1은 검신 옆면 두 strip의 삼각형 방향만 교정한다. 새 기본 칼은 이를 명시하고 기존 `flat-outward` 튜브 마감을 재사용한다. 기존 파일은 자동 마이그레이션하지 않는다. 미선언16부품의 실제 attribute/index hash는 이전0.36과 동일하다.

엔진과 실제0.37GLB Blender재열기:122→0, 경계/non-manifold/퇴화/검사된 자기교차0, 삼각형18930·외곽 치수 유지. 전체 및 근접 사광1024px 이미지는 동일 카메라·조명·정규화로 생성했다. 외곽은 그대로이며 화면의 변화는 작다. 면 방향 검사와 모서리 셰이딩의 제한된 개선을 전체 사실적 모델링 성과로 확대하지 않는다. 원자료 충실도와 기능성 칼/제조 설계는 미검증이다.

공개 컴파일러의 기존 UV 경로는 삼각형을 펼치므로 교정한 옆면에서는 두 corner의 position/UV 배열 순서가 함께 바뀐다. 각 공간 좌표와 그 점의 UV는 그대로이며 다른 삼각형·부품 버퍼는 보존한다. normal은 공유 정점에서 다시 평균화한다. 초기 indexed-array 가정의 테스트 실패도 보존했다.

사용: 검신 선택 → `옆면을 바깥 방향으로 교정` 체크 → Apply. 해제는 기존 옆면 방향 복원이며 전체 검사를 다시 확인한다. Cancel/Undo/Redo/SAVE IR·재열기/정규GLB 경로를 실제 브라우저에서 시험했다(40→0→Undo40→Redo0). 일반 loft의 다른 크기3사례,2/512단면, Float32붕괴, 잘못된 버전·방향·치수·patch/stale 입력을 검사한다. set/clear는 깊은 복사이고 비대상 ID·재질·계층을 보존한다.

기존 runtime의 두 단면 지원과 schema의 min3 불일치를 UNI_AI가 지적했다. Schema는 두 단면 set/clear를 허용하도록 맞췄으며 실제 Draft202012Validator도 통과했다. 새 선언에는 증가하는 단면 좌표와 양의 깊이를 검증한다. 임계값을 낮춰 닫힘·퇴화 검사를 통과시키지 않는다.

Compiler는 실제 파일 변경 때문에0.37로 올렸다. 다른 분야의0.36 Blender/Godot/Prusa 영수증을0.37검증으로 취급하지 않는다. 이번 native확인은 칼 GLB/수정·안정성재열기와 브라우저 출력이다. CAD, 독립 인간 전문가 평가는 not-run이며 전체 release는 아직 차단돼 있다. 현재 hash·명령·UNI_AI 내역은 [검증](../benchmarks/modeling-slices-20261003/blade-winding/verification.json)에 기록한다. 다음은 냉각 장치1596충돌을 IR 튜브와 harness 생성 기하로 분해한다.

최종 공개694/원본713tests(one worker,기존5초 limit)·양쪽check/build/benchmark PASS. 초기 버전 기대값0.36 실패는0.37로 갱신해 보존했고 topology/UV gate는 약화하지 않았다. 새7브라우저 proof에서 칼은 현재 blocked가 해소되어 allow-list 범위의 ready=true이며 다른 실제 실패는 false를 유지한다. 냉각 장치·건축 프로그램·참조 근거와 현 버전 다분야 native 영수증 부족으로 전체 quality:production은 FAIL이다. Float32 실제삼각형 preflight를 migration/IR검사와 컴파일이 공유해 invalid 편집을 commit 전에 거부한다. 공유 preflight 정리 후 파일을 다시 생성해 Blender·렌더 영수증과 SHA 일치를 확인했다. UNI_AI3회12107tokens, 최종 정리는 로컬 테스트로 검증했다.
