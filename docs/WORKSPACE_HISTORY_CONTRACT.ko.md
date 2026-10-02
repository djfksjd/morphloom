# Workspace history 계약

2026-10-02 구현 전 고정. 자산 추가와 서로 다른 source의 편집을 하나의 history에서 undo/redo한다. 각 source seed/ID/override/geometry/PBR와 명시적 asset datum은 snapshot에 보존한다. redo 후 분기 편집은 미래 상태를 삭제하고 실패 commit은 현재 상태와 redo를 변경하지 않는다. 동일 snapshot은 새 history를 소비하지 않는다.

최대30 상태·합계8MiB UTF-8 serialized snapshot budget, 단일 파일2MB를 유지한다. 가장 오래된 상태부터 퇴출하고 현재 유효 상태는 유지한다. UTF-8 snapshot bytes는 실제 JS heap/GPU 메모리의 측정치가 아니다. constructor/current/undo/redo는 외부 객체와 참조를 공유하지 않는다. UI에서 전역 Undo/Redo 가능 여부와 retained bytes를 표시한다. load는 현재 편집 상태를 복원하고 history는 새로 시작한다. session history를 납품 파일에 저장하는 기능은 이번 범위 밖이다.

15분·동일 결함 최대2회. 기존 요소 local history는 유지한다. Workspace undo/redo/load 시 source 편집기를 새 snapshot으로 초기화해 낡은 draft가 source를 다시 덮지 않도록 한다. 실제 browser에서 append, 볼 수정, 다른 자산 수정, 전체 undo/redo, save/reopen, GLB bytes/Khronos/Blender를 검증한다. source/output 지문을 새 evidence 디렉터리에 남긴다.
