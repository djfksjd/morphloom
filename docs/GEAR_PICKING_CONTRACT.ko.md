# Gear 화면 feature 선택 계약

2026-10-02. 기존 기어 goal 다음 반복, 예산20분·같은 결함 수정 최대2회. 실제 raycast hit를 메시 로컬 좌표로 변환해 tooth contour 안이며 root 바깥인 경우에만 stable tooth ID를 반환한다. bore/몸체/치간 빈 공간은 feature로 표시하지 않는다. 선택된 feature contour를 표시하고 dropdown·공통 inspector와 동기화한다. 회전·비균일 scale·workspace datum·explode는 실제 메시 transform을 따른다. 다른 자산 선택은 기존 경로를 보존한다.

원본 schema와 GLB 기하는 변경하지 않는다. 선택은 세션 상태이며 JSON의 새 필드를 추가하지 않는다. 잇수 변경으로 사라진 ID는 해제하고 Undo 후 잘못된 ID를 재사용하지 않는다. 실제 브라우저 클릭→ID→편집→내보내기와 topology를 검증한다. 제조·맞물림 승인과 연결 feature를 실제 detachable 부품으로 표현하는 것은 범위 밖이다.
