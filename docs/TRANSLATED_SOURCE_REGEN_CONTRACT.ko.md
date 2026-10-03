# 검증된 이동과 원본IR 재생성 계약

2026-10-03 23:32 KST,30분/구현2회. 먼저 실제원본IR 재생성의 BIN/기하·normal·UV·재질·계층·변환 동일성을 확인한다. 검증된 단일nativeelements source만 대상으로 source-position 이동을 기존editPart로 수행하고 실제파일과 생성결과를 다시 비교한다. 혼합workspace/원본불일치/잠금/texture/unsupportedsource는 명시적으로거부하며 현재GLB의before-edit reference 또는IRfalse를 수정하지 않는다. 성공해도 별도현재sourceJSON과재생성증거를 반환한다. sourceIR개정은없고 기존parse/validation/boundUV/exportcompiler 재사용. 비대상source·BIN·normal·UV·재질보존, 원본 및새파일SHA를 기록한다. 출처metadata만 믿어source복원 완료라 하지않는다. 첫probe실패시구현전 원인분리. API추가0/dependency0,기존모든gate유지.
