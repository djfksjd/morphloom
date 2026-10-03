# Bearing 직접 호출 입력 계약 (2026-10-03)

10분/동일 결함 수정2회. 현재9b020fc에서 registry와 generateBearingProject 직접 호출을 같은 입력으로 비교한다. null/undefined dimension을 기본값으로 바꾸거나 pack metadata 범위 밖 치수를 받아들이는 직접 경로가 재현되면 기존 공통 input 검사를 연결한다. 전역 범위/검사 기준을 바꾸지 않는다.

합격:양쪽 invalid-input code/packId 일치, null/non-record/non-finite/명시적 누락값/범위 밖·단위·좌표·seed 거부. 누락 필드의 기존 기본값, 지원된 null-prototype record와 정상3개 크기는 source/position/normal/UV/index/PBR/계층 byte-hash 그대로. 입력 객체 수정 없음. registry의 타 Pack 생성/오류 격리는 회귀 검사한다. API export 추가 외 schema/IR/job/patch/version 변화 없음. 기존에 잘못 허용한 범위 밖 직접 입력은 명시적 오류로 바꾸며 생산·제조 승인으로 표시하지 않는다. UNI_AI/Claude 협업 한도는 이미 확인돼 추가 호출하지 않는다.
