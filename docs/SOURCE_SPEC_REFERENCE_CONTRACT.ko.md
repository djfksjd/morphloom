# 변환 파일의 sourceSpec 참조 상태 계약

2026-10-03 21:44 KST 시작,20분/수정2회. source translation adapter만 opt-in version0.2로 확장할지 검토하며 기존 native IR/GLB/UI/compiler는 변경하지 않는다. 기존0.1 GLB의 sourceSpec은 변환 전 자료인데 실제 파일에서는 그 상태가 표시되지 않는다. receipt의 주석만으로 해결하지 않는다.

구현 전에 고정: 원본 BIN·POSITION/NORMAL/UV/PBR·명명·계층과 비대상 node JSON은 보존한다. 허용 JSON 차이는 대상 node transform, 그 ancestor에 있는 sourceSpec을 원본 그대로 before-edit-reference 필드로 옮기는 것, 명시적 versioned transform provenance만이다. 원본 내용을 유실하지 않으며 모르는 sourceSpec은 해석하지 않는다. 형상 기반 editable IR 피팅/자동 현재화는 하지 않는다. 원래 native sourceSpec 경로를 유지해 stale IR을 현재자료로 오인시키지 않는다.

새 provenance에는 입력 GLB SHA·stable node name·glTF Y-up 월드 mm delta·currentEditableIRAvailable:false와 버전이 필요하다. 충돌/미지원 provenance/version은 거부한다. 추가 nonzero edit chain은 별도 정책이 없으면 거부하고, no-op은 현재 proof를 덮어쓰지 않는다. 원본 sourceSpec이 없는 GLB도 명시적으로 처리한다. current0.1 지원 7개 actual Blender cases/two reopen/BIN/UV/PBR·1e-7/0.001mm/0.01deg guard를 유지하고 metadata 차이는 선언된 whitelist로 검사한다. 새 reference를 UV/품질검사에서 현재 관측자료로 재분류하지 않는다. UI 연결·모든 source/target adapter 호환·일반 native DCC re-export·raw first-import normals/strict info0 납품은 미검증/blocked다. 추가 dependency/API 전송0.
