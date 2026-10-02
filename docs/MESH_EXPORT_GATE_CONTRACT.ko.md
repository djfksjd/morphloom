# Static mesh 내보내기 검수 계약

2026-10-02. 첫20분 구현·검수. 기존 중요한 UV 실패가 보고서에만 남고 일반 GLB 다운로드가 성공하는 경우를 실제 default gear로 재현한다. 기존 analyzeTopology와 inspectExportedUv, Khronos validation을 재사용한다. 기존 임계값/IR/patch/releaseAllowed를 바꾸지 않는다.

일반 editable mesh export는 기존 topology와 actual GLB UV integrity(per-feature 포함), standard validation errors0/독립 parser read를 요구한다. UV 실패/미지원·불완전 static coverage는 일반 export를 차단하고 원인·해당ID를 표시한다. 진단용 export는 별도 사용자 경로이며 실패 사유와 scope를 기록한다. 진단도 기존 topology/표준 오류·파일/보고서 자원 상한을 통과해야 한다. checker/연결tooth cut은 진단 경로다. 어떤 경우에도 production/실측/atlas/제조/전문가 인증을 부여하지 않는다.

기준 default gear source0.3 UV17.77% 실패와 opt-in UV100 gear 통과, tooth 하나 손상 실패, mixed 한 자산 실패, 이미지 없는 정상 native UV 허용, 검사결과stale차단/undo/save/reopen을 확인한다. source/output SHA와 receipt purpose·현재검사revision을 연결한다. 기존 topology failure를 끄지 않는다. 첫 반복2회 동일 실패 후 원인 재진단. UNI_AI403 fallback/no새의존성/외부원자료/push자잘한반복 없음.

기존0.1 feather/strand에는 UV가 없고 topology normal export의 사전 검사가 없었다. 데이터·preview는 유지하며0.1 진단 경로는 기존 호환을 유지하고 topology not-run을 명시한다. 일반 검사 경로에서 기존 native volumetric 생성기의 closed 기준을 적용하며 의도된 열린 표현은 이 슬라이스의 승인 범위 밖이다. generic open surface에 일괄 폐쇄 조건을 부여한다고 선언하지 않는다. 기존0.2+ topology 검사는 진단에서도 유지한다.

검수 중 기존 whole bird의 pretty JSON receipt가20MB 상한을 넘는 원인을 확인했다. 정보 삭제/삼각형 생략 없이 JSON whitespace를 제거하는 직렬화를 적용하며20MB guard와 모든 검사/범위를 유지한다. 동일 원인2번 후 원인을 재진단했고 후속 검수는10분으로 제한한다.
