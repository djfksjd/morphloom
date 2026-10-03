# 선택 부품 corner-angle normals (2026-10-03)

실제 구현: elements0.7 optional normalWeighting, 명시적 migration, generic PartInspector의 적용·취소·Undo/Redo, 기존 creasePartNormals에 corner-angle weighting. renderer0.11. 기본 uniform과 이전 프로젝트는 기존 결과다. 기존 API0.4 Pack과 Workspace/session schema는 새 source를 명시적으로 읽으며 오래된 엔진은0.7을 지원한다고 주장하지 않는다. sphere/비기하 part에는 tool이 비활성화되고 이유를 표시한다.

Analytic 원통16/32/128분할의 radial normal 최대 오차3.7934/1.8804/0.4689도→0.0000021/0.0000067/0.0000367도. 고정 기준0.01도 PASS. hard cap 유지와 대각선 변경 검증 PASS. 신규11tests/native9cases PASS. 베어링3규격에서 선택 inner_race의 실제 normal만 바뀌고 position/UV/index/PBR/world/parent·비대상10/9/14개mesh 유지. 기존 엔진3규격의 source 및 전체generatedData hashes가현재legacy 결과와 같다. GLB root rendererRevision은 바뀌므로 전체파일 byte-identical이라고 주장하지 않는다.

현재clone764tests/check/build PASS; original 추가19tests 결과는 verification.json에 기록한다. 평균 compile ratio1.054/1.104/1.080(M5/Node24.13.1, 두warmups+다섯측정); 고정≤2배/10초 PASS. triangles/texture 추가0. 변경전후 동일1024clay whole/close·grazing close6장;실루엣 동일,시각 차이는 작고 normal 방향측정이 핵심증거다. 독립전문가 미검수.

현재native전체GLB+source+UV 실제3downloads PASS(Khronos errors0). 실제GLB 재열기 비교10비대상mesh attributes/PBR/datum/parent exact. Blender5.2.1 inner_race2mm변경·UV/PBR/hierarchy·두재열기 기본audit PASS. 추가strict split-normal 검사는 FAIL: 변경내륜 양방향최대0.005815도 이내이나 비대상sphere 최대0.039980도여서 고정0.01도 미충족. 이전 version의 실제GLB control도 동일sphere 오차로 FAIL; 이번modifier 회귀가아님을확인했다. 전체normal 납품인증은 BLOCKED이며 기준을높이거나실패검사를끄지않았다. quantization-hash 테스트의initial failure와angular failure를 모두 보존했다.

신선한전체quality:gate 결과는 verification.json에기록한다. 이전strict cooling unused UV infos23/dominance0/3은미해결. API/CLI 추가호출0/외부reviewblocked(UNI_AI credit shortage/Claude weekly limit). 추가의존성0. 원본git index128·user docs/WORK_STATE·추가tests 보존.

사용: 선택부품→Enable normal weighting(schema0.7)→Normal weighting Corner-angle weighted→Apply part edit. 취소/Undo/Redo/Save project JSON/Load JSON/Export project 또는 selected GLB를 사용한다. 옵션을 uniform으로 돌리면 기존계산으로 되돌린다. source JSON을함께보관한다. 증거:benchmarks/modeling-slices-20261003/corner-normal; 실제큰GLB는원본outputs/corner-normal-20261003에보관하고해시로연결한다.

현재상태는 editing-verified/selected normal improvement verified, strict Blender normal delivery blocked다. 다음은 sourceGLB·Blender import·export·reimport 단계의sphere normal 변화 위치를 측정해 원인을 분리한다. 같은파일의무작정재생성을하지않는다. 연속goal ACTIVE.
