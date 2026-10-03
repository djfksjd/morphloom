# 공유 모서리의 면 방향 검수

기존 검사는 edge의 방향을 제거해 세므로 일부 삼각형을 뒤집은 닫힌 박스를 pass로 표시했다. 새 검사는 위치 weld 후 정확히 두 면이 공유하는 모서리의 방향 충돌을 mesh별/전체로 계산한다. 실제 뒤집힌 박스3개, legacy tube16개 충돌을 검출했다. UV/normal seam이 있어도 같은 위치를 기준으로 계산한다. 의도된 열린 경계와 non-manifold는 기존 항목으로 따로 계산한다.

기존 unsigned closure/pass의 뜻과 임계값은 유지한다. 새로운 quality row는 충돌 하나라도 blocked이며 기존 전체 blocked cap59와 Asset Pack 차단에 연결된다. 보고서에 실패 필드만 있거나 count/boolean이 상충해도 blocked; 둘 다 없는 이전 보고서는 not-run/warn이며 pass로 추정하지 않는다. 새 필드는 optional additive이며 IR/patch schema는 그대로다. 파일의 추가 topology metadata를 구별하는 revision은0.36.0이다.

실제 브라우저의 legacy→기존 flat-cap 편집→Undo/SAVE IR/GLB 검사와 현재 Blender5.2.1 LTS 재열기에서 충돌16→0을 확인했다. 이 단계는 새 기하 연산이 아니라 실제 방향 결함을 숨기지 않는 검사 개선이다. 106개의 원래/flat/curve geometry vertex/index/normal/UV buffer SHA가0.35와 정확히 같다. GLB 전체 bytes는 새 metadata 때문에 이전 버전과 다르다.

국부 일관성이 전체 바깥 방향/양의 체적을 보장하지 않는다. 모든 면을 일관되게 반전하면 이 항목은 통과한다. weld1e-6의 기존 한계, 매우 작은/가까운 표면의 병합 한계도 유지한다. CAD/제조/전문가 검증과 의도된 open-surface의 전체 납품 계약은 이 검사만으로 해결되지 않는다.

공개96files686tests/원본99files705tests PASS,check/build/benchmark PASS. 첫 공개3timeout과 타입 ID 선언 누락으로 실패한check/build를 보존한 뒤 수정·동일5초 제한으로 재검사했다. 원본 runtime tests 이후 타입 union만 추가했으며 마지막 source check/build도 별도 기록한다. 16,448삼각형의5paired sample 중앙값 old15.0/new14.4ms는 해당 환경 관측이며 성능 우위/모든 기기 보장이 아니다.

quality:production FAIL 유지. 새0.36에서 이전0.35 DCC 영수증을 현재 검증으로 표시하지 않는다. 이 단계는 실제2GLB/Khronos/Blender를 확인했으며 기존5cross-domain native matrix 재검사는 다음 단계다. 다른 앱 및 독립 전문가 평가는 현재 revision에서 not-run.

UNI_AI gpt-6-astra 분석/검토2회14,246tokens. partial failure를 warn으로 표시하는 문제를 모델 검토가 지적했고4종 regression으로 수정했다. 크레딧 소진이 확인되지 않아 Claude CLI fallback은 not-run.

사용: quality 패널의 공유 모서리 면 방향 항목을 확인한다. legacy tube는 선택 후 Flat tube cap finish 또는 outward caps를 Apply하고 기존 치수/UV/납품 검사를 다시 확인한다. 기존 선언은 자동 변경하지 않는다. 전체 방향이 뒤집힌 임의 메시의 자동 수정은 지원하지 않는다. [증거](../benchmarks/modeling-slices-20261003/topology-orientation/verification.json),[실제 파일](../benchmarks/modeling-slices-20261003/topology-orientation/assets.zip).
