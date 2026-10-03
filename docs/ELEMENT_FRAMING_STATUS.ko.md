# 작은 부품 Fit view 수정 (2026-10-03)

ElementEditor의0.1m 거리 floor와 aspect 미반영 initial framing을 제거했다. 기존 fitPerspectiveCameraToBounds를 현재 canvas aspect/FOV45/iso1,.55,1/padding1.22로 연결했다. 빈 bounds fallback과 크기에 맞는 near, 저장된 사용자 pose 보존을 유지했다. Workspace도 같은 ElementEditor를 사용한다. IR/schema/geometry/UV/PBR/compiler/export는 변경하지 않았다.

실제 실패→수정 증거: 같은 source0.4/SHA ee2f2f28e2c12af6776e01b6cc4fd27c9655eab1878eb015187f073b71876913,1280×720viewport/742×468canvas, checker/카메라 방향/조명에서26mm 기어 foreground limiting-axis21.79%→60.68%. baseline native 실패를 owned publish preview에서5620ddf camera로 재실행하고 try/finally로 수정본을 byte-exact 복구했다. 원본 및 사용자 실행 서버는 이 재현에서 건드리지 않았다. 이전632px높이 캡처는 최초 진단이고 정량 전후 쌍은 이번720px로 별도 보존한다.

현재 native8사례 PASS:기본/wide·narrow/소형/대형 기어, bearing, animal, mixed workspace, empty. 모든 유효 foreground margin 최소77px 이상(합격 최소8px); empty는 viewport 초기화 검사이며 UV 납품 PASS가 아니다. 실제 pointer orbit→checker 재생성의 변화pixel비율0.00346%, 실제1mm part edit/Undo→0.8461%(canvas1% 이하 계약). 이 수치는 화면 일치 허용 오차이며 동일 내부 camera identity 보증이나 모든 인터랙션 검수는 아니다. 4test/8 size×aspect corner projection checks PASS.

npm test100files/715 PASS59.04s; 원본 checkout의 추가 사용자19tests를 보존한 최종103files/734 PASS59.82s; npm run check/build PASS. 첫 source test는 mirror guard가 잘못 original dataless git에서 실패한 뒤 시작되어 수정본 증거로 거부했다. 최종 post-mirror run을 따로 저장했다. source index는 수리/초기화하지 않았다.

새 일반 UI3파일 다운로드의 GLB SHA de2ad4577274b75ffbb61543b8b358900cbb73b1d39ef8d7a7ac0c4a5cd12443는 카메라 수정 전 byte-exact다. 실제 생성물에 변화 없음을 확인했다. 동일 바이트의 Blender 검수는 직전 UV_CURRENT 단계 결과이며 새 DCC 실행으로 재표기하지 않는다.

현재 npm run quality:gate exit1:내부 생성검사와 composite 경쟁 기준을 구분한다. 기존 cooling native Blender 검증의 unusedUV infos23 엄격조건 FAIL이 남았다. quality:production은 해당 실패 뒤 blocked/not-run, dominance는 이번 단계 not-run(직전 독립0/3 부족 유지). original latest benchmark는 덮어쓰지 않았고 이번 fresh 결과를 outputs에 보존했다. UV 제거/가짜texture/임계값 완화 없음.

변경:src/ElementEditor.tsx; tests/element-camera-framing.test.ts; scripts/element-framing-browser-regression.py; 계약/상태 문서와 작은 proof. 함수/helper를 복제하거나 의존성을 추가하지 않았다. UNI_AI/Claude 추가협업은 확인된 credit/weekly limit 때문에 blocked; 로컬 검증으로 진행했다.

사용:작은 부품 생성/불러오기→Fit view. 기존 orbit은 Apply/Undo 및 checker 전환에서 보존되며 원하는 전체 재프레이밍은 Fit view로 수행한다. 편집용 뷰 확대이며 형상 정확도/제조/CAD/전문가 승인은 아니다. 창 크기를 바꾼 뒤에도 현재 pose를 유지하고 Fit view를 명시적으로 다시 누른다.

산출물:/Users/danny/Documents/morphloom/outputs/element-framing-20261003. paired-before.png/paired-after.png, source fixtures, actual downloads, current test/gate logs. Git proof:benchmarks/modeling-slices-20261003/element-framing. verification SHA659ad7a50c5005c974582b7067247eaebbd45b6b90dcbf2ad90c19070996a1af. 실패·discarded 로그도 남겼다. 스크린샷 harness의 최초 잘못된 출력 경로는 이미 커밋된 원본 archive에서 byte-exact 복원했고 확인 receipt를 보존했다.

20분 반복 계약 안에서 완료했다. 다음 단계:Domain Pack registry와 직접 bearing 생성 호출의 입력 거부 계약 차이를 실제 테스트로 확인한다. 전 분야 완성 선언 없이 연속 goal은 active.
