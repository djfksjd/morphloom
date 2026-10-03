# 부품 선택 변경 중 오래된 적용 폐기

실제 A 위치 수정의 SHA-256 완료를 대기시키고 B→A로 선택했다. 원래 화면값 −65mm로 복원됐어도 기존 적용이 뒤늦게 −63mm로 저장된 실패를 재현했다. 수정은 선택/IR 변경과 unmount의 layout effect에서 적용 토큰을 무효화하며 최신 토큰만 commit/오류를 게시한다. 같은 ID로 돌아와도 이전 토큰은 복구되지 않는다.

실제 캔버스 선택·숫자 입력·Apply·Undo/Redo·SAVE IR·다시 가져오기를 통한6사례 PASS: ABA 폐기, 새 B 패널의 오래된 오류 억제, 이후 정상 편집과 B 보존, Undo/Redo, 현재 유효한 오류 표시, 먼저 Undo한 뒤 저장본 재열기. 실제 hash 결과는 바꾸지 않고 첫 완료 시점만 제어했다. 세션당 단일 대기 작업이며 busy는 오래된 작업 종료 후 풀린다.

공개95files681tests/원본98files700tests 단일worker PASS;check/build/benchmark PASS. 기존5초 제한 유지. 형상·IR·patch·compiler0.35.0·종전품질임계값 변경 없음. 이 UI 단계에서 DCC 왕복은 not-run; 이전 기하 단계 결과를 새 실행으로 표시하지 않는다. 실제 unmount/외부 파일 교체 중 apply/crypto 실패 주입은 not-run, 현재 검사 범위와 구분한다. 전체 quality gate/실측·CAD·독립 전문가 승인도 해결되지 않았다.

UNI_AI gpt-6-astra2회8,010tokens 분석/검토, 정상 응답이며 소진이 확인되지 않아 Claude CLI fallback은 실행하지 않았다. 리뷰는 실행 증거/전문가 평가가 아니다.

사용: 부품을 선택하고 숫자를 Apply한다. 적용 대기 중 다른 부품으로 이동하면 이전 적용은 폐기된다. 원래 부품으로 돌아와서 새 편집을 시작할 수 있다. Undo/Redo는 기존32단계 방식이다. [증거](../benchmarks/modeling-slices-20261003/editor-selection/verification.json),[실제 IR](../benchmarks/modeling-slices-20261003/editor-selection/assets.zip).
