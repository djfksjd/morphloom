# Workspace 선택 격리 계약 (2026-10-03)

현재9b020fc의 Workspace Isolate selection은 명시적으로 disabled이며 엔진은 모든 asset을 preview한다. 기존 local buildElementScene isolateIds를 재사용하는 기능 추가를20분/동일 결함 수정2회로 진행한다. 승인·형상 정확도·조립 분해 물리 시뮬레이션 기능으로 표시하지 않는다.

선택 scope는 assetId+local component ID이며 다른 asset의 같은 local ID와 구분한다. isolated preview만 대상 asset/component를 생성하고 기존 datum/world transform·assembly parent·pickID/geometry/UV/PBR를 유지한다. 원본 IR과 전체 delivery를 수정하지 않는다. preview 연산은 독립 revision을 기록하며 기존 workspace source schema/engine delivery metadata와 기본 export bytes는 유지한다. delivery에 preview option을 넣으면 조용히 생략하지 않고 거부한다. unknown asset/ID/empty·비정상 options는 생성 전에 오류로 거부한다.

UI:선택한 부품/element/group에 Isolate selection 적용; workspace asset 전환/중복 local IDs/끄기에서 원본 복원, checkbox 설명과 explode 미지원 구분. preview counts와 실제 draw calls가 변경되어야 한다. 원본 UV 검사와 전체 source JSON/export는 전체 대상을 유지한다. 저장·재열기는 편집 소스를 보존하며 임시 preview toggle은 원본 IR에 넣지 않는다.

합격:기존 실패/미지원 재현, 회전 datum과 중복ID·다른 크기 unit tests, 실제 볼 하나 native isolate→편집→꺼서 복원→undo/redo→저장·재열기, 비대상형상/UV/PBR/계층 hash exact, 실제 전체/선택 export와 Blender 재열기. 기존 geometry/texture/render/quality budget과 gate는 유지한다. API/Claude는 확인된 한도 때문에 blocked, 로컬 증거로 진행한다.
