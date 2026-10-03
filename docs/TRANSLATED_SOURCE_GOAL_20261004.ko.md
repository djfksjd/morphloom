# 단일 native source 평행이동 — 2026-10-04 작업 계약

기준은 게시 체크아웃 main `c8c91a2d2ccb802b431e569cd1fa99a1605d0478`이며, 시작 당시 GitHub HEAD와 같다. 원본 `/Users/danny/Documents/morphloom`의 git index 매핑 오류와 사용자 추가 테스트 19개를 보존한다. 원본의 사용자 문서 `docs/WORK_STATE.ko.md`는 수정하지 않는다.

기존 연속 고도화 Goal의 다음 단계로 이 계약을 적용한다. 플랫폼 Goal은 paused이고 새 등록은 unfinished 오류로 거부됐다. 현재 도구에는 목표 내용 수정·재개 API가 없으므로 상태를 변경했다고 보고하지 않는다. 명시된 token/time 예산은 없으며 파일 256 MB, source 2 MB, mesh 128 등의 기존 자원 한도를 유지한다. 과거 실험의 30분/2회 제한은 당시 기록이다. 새 가설 없이 동일 실패를 반복하지 않는다. UNI_AI/Claude 호출은 0회다.

## 지원 범위와 변경 전 합격 조건

- 실제 `elements` schema와 parse/editPart/validation/export를 재사용한다. IR 단위는 mm, 좌표는 right-handed Y-up이다.
- 정확한 원본과 선언된 leaf part 평행이동을 대상으로 한다. 부모 datum은 identity여야 한다. 원본 IR/GLB와 이동 GLB의 before-edit metadata를 변경하지 않는다.
- 새로운 sourceJSON과 버전 0.1 검증 영수증을 별도 반환한다. 기존 IR schema 개정·마이그레이션은 필요하지 않다. 알 수 없는 영수증 버전은 다른 버전으로 추측해 사용하지 않는다.
- 혼합 workspace, 잠긴 부품, texture/unsupported source, 잘못된 출처, 비가역·회전·스케일·평행이동 부모, 임의 DCC 메시 편집을 거부한다. 회전·스케일 지원, 새 기하·리깅·사진 복원은 범위 밖이다.
- BIN 전체 바이트 일치와 기존 binding JSON 검사를 유지한다. UV 5%와 기존 수치 임계값, releaseAllowed를 완화하지 않는다. 성공 사례는 작은·기본·큰 베어링과 기어이며 다른 부품/속성 보존, no-op·연속 이동·결정성도 확인한다.
- 실제 UI 저장 → 새 세션 재열기 → 추가 편집 → GLB 생성과 파일 교체·지연·오류·unmount 차단이 필요하다. CLI나 JSON 생성만으로 완료 처리하지 않는다.
- 현재 test/check/benchmark/build, quality:gate/production, 엄격한 GLB 검사와 독립 재열기를 수행한다. 전체 게이트 실패는 기능 결함·회귀·기존 범위 밖 실패·외부 차단으로 구분한다. Blender 첫 import와 재export normal 검사는 별개다.

실행 순서는 fixture 계약 위반 재현 → 유효 fixture → normal 경계 진단 → 최소 수정 → 실제 UI/파일/회귀 검증이다. 실패한 구현의 격리만으로 완료 처리하지 않는다. 결과는 [현재 상태](./TRANSLATED_SOURCE_STATUS.ko.md)에 기록한다.
