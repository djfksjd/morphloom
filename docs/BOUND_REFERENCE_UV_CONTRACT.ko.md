# 실제 원본 파일과 연결한 UV 참고 검수

2026-10-03 22:46 KST,30분/수정2회. 기준은 직전 게시 commit과 source-spec-reference actual-uv-feature-gate.json이다. 참고 파일은 sourceIR 현재화 없이 안전하게 BLOCKED인 상태에서 시작한다. 다음 기능은 원본 GLB SHA와 현재 파일의 provenance를 실제 bytes로 연결하고, BIN·accessor·mesh/index/UV/재질·비대상 JSON과 허용된 translation/reference metadata 차이를 검증한 뒤에만 원본의 connected UV feature context를 사용할 수 있는 좁은 검수다.

before-edit IR을 현재 editable IR로 승격하지 않는다. 미검증 metadata만으로 context를 허용하지 않는다. 제공된 original/current 실제 source/output SHA·도구 버전·geometry binding 범위를 receipt에 기록한다. 한 이빨 실패가 aggregate에 가려지지 않아야 하며0.05/1e-10 threshold 및 현재 reference-only fail을 유지한다. 잘못된 original SHA,변경된 UV/index/position,unsupported URI/morph/skin/time,unknownversion/충돌은 거부한다. Native source 및8reference cases 회귀·actual gear tooth 손상·Blender 파일 보존을 확인한다. SourceIR 복원/UI/CAD/first-import normal/strictinfos0 문제는 별도 범위다. API/Claude quotas로 추가 호출0,새 dependency0. 연속 goal ACTIVE.
