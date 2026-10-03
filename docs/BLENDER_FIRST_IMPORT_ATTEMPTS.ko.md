# 이번 실행 기록 — 2026-10-04

1. 가설: smooth/flat reference 후보가 legacy setter의 정밀도를 개선한다. 베어링 후보 성공 뒤 기어를 실행했다. 기어0.0160044° FAIL, 후보 방식 중단. 실패 자료는 outputs/blender-first-normal-goal-20261004에 보존했다.
2. 가설: 원본 Float32를 Blender CORNER float-vector normal 속성에 기록하면 압축 오차를 피할 수 있다. 커널의 동일 빌드 경로를 확인했다. 네 사례 실제 import/readback0°, 저장·재열기 PASS. 재export37 meshes 최대0.00442° PASS. 기존0.01° 유지.
3. 가설: 검사 이후 파일 경로 변경이나 늦은 실패는 잘못된 출처·부분 결과를 남길 수 있다. immutable snapshot, 신규 datablock rollback, exclusive 출력 publication을 구현했다. 7 conformance 사례 PASS. 입력 SHA와 .blend SHA를 실제 reopen 시 재검사했고 네 사례 PASS.
4. 현재 전체 게이트 실행: quality:gate/production exit1. 기존 cooling cross-domain delivery receipt의 infos23 대 required0이 남아 있고 Blender/edit benchmarkAccepted=false다. 다른 분야의 추정 근거·미실행 앱·시각 우위 미확립도 성공으로 승격하지 않았다. 이번 static normal import의 실패로 분류하지 않는다. 다음 작업은 이 UNUSED_OBJECT의 생성 위치 진단이다.

API/Claude 호출0, 테스트 삭제/skip0, gate 완화0. 이전 prototype의 시간/성공 자료를 이번 결과로 재사용하지 않았다. 렌더는 normal 채널 검사이며 전문가 승인이 아니다.
