# 복합 프로젝트 불러오기와 하위 편집 보존

2026-10-03, 762e9ca 기준. 실제 Workspace File.text를 지연하고 하위 베어링 볼2.6mm를 Apply한 뒤 읽기를 완료하면 원래3mm가 덮어쓴다. before/edited/after JSON과 red 영수증을 먼저 보존한다.

기존 workspace0.1/element0.2 source·각 asset seed·ID·datum/조립 구조를 보존한다. 부모 불러오기 대기 중 하위 편집·draft·history·선택·새 asset 작업은 이전 완료/오류를 폐기한다. 새 파일이 정상 완료되면 기존 JSON 스키마검사와 전체 workspace 복원을 유지한다. 파일 객체 확보 즉시 input을 비워 같은 파일 재선택을 허용하고 늦은 handler가 새 input을 비우지 않는다. unmount 소유권을 폐기한다.

실제 UI: 하위 Apply/draft/Undo, 부모 Undo/Redo, 파일 완료 역전·stale failure, asset 선택·append, 정상 저장·재열기. source array/seed/datum 비대상 보존과 현재 render buffers를 검사한다. 현재 혼합 GLB를 실제 파일+Blender로 확인한다. 용도는 시각화/편집이며 운동학·제조·전문가 승인 아님. 원래 자원 budget·UV/topology/export gate와 releaseAllowed 유지. 새로운 의존성·스키마·메시 변경 없음.

checkpoint40분. UNI_AI의 크레딧 부족 및 Claude CLI 주간 사용 한도가 현재 확인되어 이번 추가 검토는 blocked로 기록하고 로컬 실제 검증을 진행한다. 이전 모델 제안을 이번 실행 증거로 재사용하지 않는다.
