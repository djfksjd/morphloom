# Workspace 선택 문맥 저장 계약 (2026-10-03)

현재14d6a43의 source 재열기는 첫 asset을 활성화하고 child selection을 비운다. 부품을 다시 찾는 수고를 줄이는25분/동일 결함 수정2회 단계다. scene geometry나 history stack을 재설계하지 않는다.

기존 Workspace source0.1/Save workspace JSON/GLB companion/export bytes를 보존한다. source에 임의 UI field를 넣지 않고 별도 morphloom.workspace-editor-session/0.1 envelope에 workspace 원본과 activeAssetId·selectedId만 기록한다. 새 Save editor session JSON을 제공하고 기존 Load workspace JSON이 source 또는 명시적 session schema를 구분한다. 기존 source는 동일한 첫 asset/빈 selection 정책으로 변환되며 UI에 복구된 session과 구분한다. source schema migration은 없고 source→session wrapper 생성은 명시적 변환 함수다.

parser/schema:정확한 envelope fields·known version·2MB·valid workspace·namespace 안의 asset/part/element/group ID 검사. unknown version/extra fields/없는 asset·component/다른 asset의 ID/예산 초과는 source나 현재 세션을 변경하지 않고 오류. 단위/좌표/seed/IR/project selection metadata를 추측·변경하지 않는다. non-empty workspace의 active asset은 명시적이어야 한다. empty workspace는 empty active/selection만 허용한다.

UI selection은 source patch/history와 분리해 callback으로 전달한다. session으로 재열었을 때 asset과 선택 부품/그룹의 실제 inspector가 복원된다. 저장된 문맥 로드에도 기존 async load ownership·draft/edit invalidation·unmount guards를 유지한다. 선택 문맥 자체는 모델 edit history 항목을 만들지 않는다.

합격:실패/부족한 흐름 먼저 재현, parser/schema conformance·lossless source roundtrip·동일 local ID namespace 구분·invalid input atomic reject. native ball edit→session 저장→새 UI 재열기→bearing/ball inspector/radius 복원, 기존 source 저장·불러오기와 stale session import 회귀, actual whole export 및 비대상 source/geometry/UV/PBR/계층 보존. camera/isolate/undo history 복구는 이번 schema에서 지원하지 않으며 명시한다. API/CLI는 확인된 한도 때문에 추가 호출하지 않는다.
