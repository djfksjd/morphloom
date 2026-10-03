# Native IR 가져오기 순서 보호

실제 로컬 A/B 파일을 업로드하고 읽기 완료 순서만 제어했을 때, 기존 구현은 늦게 도착한 A가 최신 B를 덮어썼다. 실패한 기존 SAVE IR과 수정 후 SAVE IR을 함께 보존한다.

`latest-intent`의 단일 토큰으로 최신 입력만 결과·오류를 반영한다. 잘못되거나 2MB를 초과하는 새 입력도 이전 입력을 무효화하며 현재 IR은 유지한다. 실제 에셋 전환, 적용된 편집, 세션 삭제, 만료 콜백과 unmount는 이전 입력을 무효화한다. 읽기 자체를 취소하는 기능은 아니다. 입력 선택은 즉시 초기화해 같은 파일을 다시 선택할 수 있다.

브라우저 8사례: 역순 완료, 오래된 오류, 최신 잘못된 JSON, 최신 크기 초과, 실제 에셋 전환, 부품 위치 수정, 세션 삭제, 실제 만료 콜백의 제어 실행. 네이티브 SAVE IR의 바이트/JSON을 비교했다. React state 주입 없이 실제 File.text·UI·저장 경로를 사용했다. 만료는 제어한 콜백이며 실제 30분 경과 시험은 not-run. unmount는 토큰 unit test와 cleanup 코드 검토만 수행했으며 실제 브라우저 React unmount는 not-run. 건축 배치 편집 경로도 실제 브라우저 검사는 not-run.

IR/patch 스키마, compiler0.35.0, 정점·UV·재질·파일 형식과 releaseAllowed 계약은 변경하지 않는다. 이 단계는 편집 안정성 개선이며 전체 모델 품질·실측·CAD·전문가 승인 증거가 아니다. 이전 기하 단계의 Blender 검증을 이 UI 단계의 새 DCC 실행으로 표시하지 않는다.

UNI_AI gpt-6-astra 분석/검토2회 5,368 tokens, 정상 응답. 크레딧 소진은 확인되지 않아 Claude CLI fallback은 실행하지 않았다. API 제안은 실제 실행 증거와 구분한다.

증거: [verification](../benchmarks/modeling-slices-20261003/async-import/verification.json), [실제 입력·저장 파일](../benchmarks/modeling-slices-20261003/async-import/assets.zip). 테스트/명령의 최종 exit는 verification에 기록한다. 브라우저 검사 도구의 selector·중복 hook·좌표 오류와 자원 경합 중 테스트 실패 로그도 보존한다.

사용 방법: LOAD IR로 로컬 파일을 선택한다. 최신 파일/편집/에셋 전환이 우선한다. 잘못된 파일은 현재 모델을 보존하며 오류를 표시한다. SAVE IR은 현재 모델을 저장한다.

최종 검사: 공개95files/681tests 단일worker PASS, 원본98files/700tests 기본실행 PASS. check/build/benchmark PASS. quality:gate FAIL은 현재 competitive/native strict 검증과 관련되어 전체 합격으로 표시하지 않는다. 최초 공개검사3timeout 실패는 보존한다.
