# 직접 bearing 입력 경계 (2026-10-03)

generateBearingProject와 registry의 입력 검증 차이를11개 실제 실패 테스트로 재현했다. null/undefined root는 TypeError, 배열·Date·상속 record 및 일부 null/undefined fields·범위 밖 치수는 잘못 통과했다. 기존 registry checkInput을 additive public validateDomainPackInput으로 재사용하고 직접 bearing 함수 첫머리에 연결했다. 검사 범위와 치수 packing 계산은 변경하지 않았다.

19 boundary cases PASS; 기존 bearing 회귀 포함26targeted tests PASS. 정상3크기의 source/actual position·normal·UV·index/PBR/world/parent와 actual GLB bytes는 before/after exact. 기본 누락값은 그대로이며 명시적null/undefined는 오류다. 기존 잘못 허용한 범위 밖 직접 호출의 거부는 의도된 bug fix; 기존 IR/schema/job/patch는 그대로. SDK 문서에 검증된 metadata 계약을 사용하는 조건과 반환 객체 미변경을 명시했다.

현재 npm test101files/734 PASS59.19s; 원본 추가19 사용자tests를 보존한104files/753 PASS59.06s; check/build PASS. 입력 경계 단계에서 UI/DCC/fullgate/production/dominance는 not-run. 정상파일 bytes exact 검수는 새 current before/after 생성이며 이전 DCC receipt를 새 실행으로 표기하지 않는다. 직전 strict quality gate FAIL과 comparison0/3 부족은 남았다. UNI_AI/Claude review는 이미 확인한 한도 때문에 blocked.

변경:src/engine/bearing-pack.ts, element-domain-packs.ts; tests/bearing-input-boundary.test.ts; scripts/bearing-input-evidence.ts; SDK/계약/상태와 proof. 원자료 형상·제조 정확도를 개선했다고 주장하지 않는다. 입력 오류가 기본 치수로 조용히 바뀌는 납품 위험을 줄인 작업이다.

로컬 IR/GLB/보고서:outputs/bearing-input-20261003/before, after, red.log/green.log, tests/source-tests/build logs, verification.json. 공개 작은 proof와 큰파일SHA:benchmarks/modeling-slices-20261003/bearing-input. verification SHA91c328d10d9d4e29ab7ee634c2fd9bf2029cf879a52f25a83891116a0a5844c6이며 input/output/code SHA를 함께 보존했다.10분 반복 내 완료. 자잘한 추가 push는 미뤄 다음 편집 기능 batch와 함께 검수한다.

다음:현재 Workspace에서 명시적으로 비활성화된 Isolate selection을 기존 local isolate 기능으로 확장한다. 이는 숨겨진 오작동 수정이 아니라 좁은 편집 기능 추가다. selected ball만 검수하면서 조립 datum·원본·전체 export를 보존하는 실제 경로를 확인한다. 연속 goal은 active.
