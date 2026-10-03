# Blender 첫 import normal 보존 — 2026-10-04

이 단계는 기존 실패에서 시작한다. 기반4b6faa1, normal 기준0.01° 유지. UNI_AI/Claude0. 작은·기본·큰 native 베어링과 기어의 원본 NORMAL을 직접 확인하고, 별도의 선택적 로컬 Blender import 도구를 검증한다. 일반 FLAT/SMOOTH import는 원본 NORMAL을 버리므로 보존 기능으로 제공하지 않는다.

과거 prototype의 첫 setter와 adaptive 후보를 재사용하되 당시 전체 왕복 실패를 성공으로 바꾸지 않는다. 현재 source SHA의 모든 메시를 대상으로 실제 POSITION/index/loop 대응과 NORMAL을 확인한 뒤 reference 후보를 별도 복사에서 평가한다. 모든 메시가 고정0.01°를 만족할 때만 결과를 적용·저장한다. 기존 scene의 소유 데이터와 비대상 기하·UV·재질·부모·변환을 보존한다. 입력 GLB와 제품 기본 import/export 경로는 변경하지 않는다. 새 후보가 실패하면 결과 파일을 생성하지 않는다.

산출물은 명시적 import policy의 editable .blend 및 원본 SHA·Blender 버전·메시별 최고 normal 오차·보존 검사 영수증이다. 실제 .blend 재열기와 후속 GLB 재export의 raw normal/규격 검사 결과를 별도로 기록한다. 첫 import 성공으로 재export 전체 통과·production-ready를 주장하지 않는다. 일반 DCC remesh·재질/법선 편집이나 IR 역변환은 비지원이다.

검증: 네 사례 모든 메시의 첫 import 및 .blend reopen ≤0.01°, 원본 기하/UV/index/PBR/계층·배치 보존, source SHA 고정, 잘못된/과대/비지원/충돌 입력 원자적 거부. 현재 도구와 이전 default import 결과 비교. 실패를 평균으로 가리지 않는다. 선언된 import 설정 및 비용은 로컬 Blender에 한정하고 의존성 추가0. 기본 UI 경로는 전체 검증 전 변경하지 않는다.

## 실험 결과에 따른 구현 경로

초기 reference 후보는 기어에서 0.0160044°로 실패해 중단했다. 임계값은 변경하지 않았다. 이후 동일 Blender 빌드의 FLOAT_VECTOR/CORNER `custom_normal` 경로에 원본 Float32 값을 기록하고 실제 corner_normals를 다시 읽는 방식을 검증했다. 원본 파일의 immutable snapshot을 decoder와 importer가 공유한다. 실패 시 새 datablock만 제거한다.

Blender 5.2만 허용하며 5.2.1 LTS 빌드9e2066aef7ef에서 실행했다. embedded 정적 삼각형과 Float32 POSITION/NORMAL만 지원한다. texture, URI, 필수 확장, node 확장, skin, animation, morph는 거부한다. 상한은 GLB256MB/JSON16MB, meshes128/nodes10000, accessor 및 mesh corners200000, 전체 vertices/corners2000000이다.

CLI는 빈 scene에서 별도 .blend와 영수증을 생성하며 기존 출력을 덮어쓰지 않는다. 모듈 함수 `import_static_with_source_normals(path)`는 기존 scene에 추가 import하고 실패 시 기존 사용자 자산을 보존한다. sourceSpec은 scene의 `morphloom_source_references_json`에 before-edit-reference로 보관하고 객체에서는 제거한다. 영수증의 currentEditableIRAvailable은 false다. normal 기록 전후의 Blender geometry/UV/index/material slot/계층 보존을 검사하며, 원본과 재export 전체 파일의 바이트 일치를 주장하지 않는다.

커널 근거: [동일 빌드 mesh_normals.cc](https://raw.githubusercontent.com/blender/blender/9e2066aef7ef/source/blender/blenkernel/intern/mesh_normals.cc). 기본 importer의 legacy short2 setter와 다른 경로다. 이 도구 없이 기본 import/reimport한 결과는 별도 검사 대상이다.
