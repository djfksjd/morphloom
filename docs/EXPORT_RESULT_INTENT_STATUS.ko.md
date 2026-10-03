# 내보내기 완료와 오류의 소유권

2026-10-03, 기준2b6d632 이후. ElementEditor의 선택/전체/진단 tooth와 Workspace export에 현재 source identity 및 mounted 소유권 검사를 적용했다. 현재 실패는 계속 표시하고 오래된 실패·결과만 폐기한다. finally에서 소유한 메시/재질/checker와 busy를 정리하며 해제된 Workspace에는 busy 상태를 쓰지 않는다. IR·compiler0.39·element-renderer0.10·기하/UV/재질 버퍼·기존 검사 조건은 그대로다.

재현은 실제 GLB export/native SHA 결과의 완료를 지연한 뒤 새 Apply를 수행하고 validator 완료 실패를 주입한 것이다. 잘못된 형상을 만들거나 React state를 주입하지 않았다. 이 테스트를 실제 모델의 검증 실패로 표현하지 않는다. 수정 전 오래된 오류가 현재 status를 덮었고 실패 영수증을 먼저 보존했다.

Native UI14사례 PASS: 현재 선택/Workspace/진단 tooth 실패 표시, Apply/Undo/새 source 뒤 stale 오류 폐기, 선택/Workspace/tooth stale 성공 폐기, 자산 전환으로 해제된 child export 폐기, 진단용 gear UV FAIL과 일반 editable export 차단 유지. 실제 discard download 폴더 파일0개다. 부모 Workspace 자체의 unmount 완료는 not-run이며 child unmount만 실제 확인했다. selector/페이지 준비 및 진단용 UV 대기 조건의 초기 harness 실패는 따로 보존했다.

정상 현재 선택/혼합 export는 각각 GLB+source JSON+UV 보고서3개를 실제로 내려받아 magic·JSON 일치·UV/standard 결정을 검사했다. 새 파일로 Blender5.2.1 LTS named-part edit·두 번 재열기·Khronos PASS. 선택 GLB SHA256 `41565828b15f1504f1aa4aace8873dea31cbd8545067221365e5a6bd6471524d`, 혼합 GLB `5e49d2086635dbf1b49e8d07e817d056af557292f118b469ca77a8ab7b251724`. 같은 source의 이전 정상 GLB와 bytes가 같으며 이번 UI 수정이 렌더 형상을 개선했다고 주장하지 않는다. 현재 UI 상태 screenshot과 실제 파일·소스 해시를 묶는다.

현재 npm test 공개711/원본730·check/build/benchmark PASS. 전체 quality:gate/production FAIL은 기존 냉각 unused UV infos23 때문이며 별도 dominance도 독립 비교0/3으로 FAIL이다. 검사·임계값·releaseAllowed를 바꾸지 않았다. API 리뷰는 확인된 UNI_AI credit shortage/Claude 주간 limit으로 blocked; 로컬 hooks/StrictMode cleanup·resource 소유권 검토와 실행을 수행했다.

사용자는 기존 export 버튼을 그대로 쓴다. 작업 중 source가 변경되거나 해당 편집기가 해제되면 이전 결과를 내리지 않으므로 현재 상태에서 다시 export한다. source가 유지된 단순 선택 변경은 클릭 당시 snapshot을 내보낼 수 있다. GLB는 baked mesh이고 절차 편집은 companion JSON으로 재개한다. CAD/운동학/atlas/인간 전문가 승인 범위가 아니다.

증거는 `benchmarks/modeling-slices-20261003/export-result-intent/verification.json`와 원본 `outputs/export-intent-20261003`에 있다. 다음은 기존 UV0.4 명시적 편집·납품 경로의 현재 실행 검수다. 기본 gear0.3 UV 실패는 이미 문서화된 호환 사례이며 새 발견이나 새 기능 구현으로 포장하지 않는다. 연속 goal은 active다.
