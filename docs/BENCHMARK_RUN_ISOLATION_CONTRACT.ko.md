# Blender benchmark 재실행 보존 계약 — 2026-10-04

기반397be3e. repair CLI의 새 출력 전용 정책은 유지한다. 기존 cross-domain benchmark가 고정된 delivery 경로를 재사용해 두 번째 실행에서 실패하는 회귀를 해결한다. 같은 source manifest로 두 번 실행할 수 있어야 하고 이전 실행 산출물과 원본의 모든 bytes를 보존해야 한다.

공통 도우미가 fixture directory 아래 exclusive 임시 run directory를 만든다. 두 benchmark의 raw/repaired GLB, Blender receipt 및 repair receipt를 이 경로에 둔다. source 입력과 manifest는 그대로 읽는다. 기존 aggregate report schema0.1은 유지하고 실제 artifactDirectory를 추가한다. report 경로가 입력이나 manifest의 symlink/hardlink alias인 경우 실행 전에 거부한다. 기존 명시적 aggregate report 갱신 동작은 유지하며 과거 개별 실행은 삭제하지 않는다.

검증: helper 경계 테스트, 현재 실제 Blender의 5-domain roundtrip 및 edit 각각2회, 원본·기존 sentinel·첫 실행 산출물의 SHA 보존, 동일 repair 출력 반복 SHA, 현재 npm test/check/benchmark/build/quality. cooling 미참조 UV와 기본 Blender normal drift는 별도 실패로 유지한다. 이번 반복 상한은 benchmark당2회, 출력 디스크 예산2GB, 외부 API0. 불필요한 재실행은 하지 않는다.

최종 publication에서도 alias를 재검사하고 atomic rename으로 aggregate entry를 갱신한다. 초기 타입 선언 부재·Node20 선언 호환 오류 기록은 보존했다. 기존 로컬22.20.4 선언과 strict 설정으로 CLI 타입 검사를 완료했다. 같은 raw repair 입력의 반복 SHA 검사는 통과했으나 서로 다른 Blender raw 입력의 인체 tangent 반복 불일치는 별도 FAIL이며 다음 단계로 남긴다.
