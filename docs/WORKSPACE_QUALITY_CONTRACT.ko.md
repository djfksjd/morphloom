# 복합 프로젝트 첫 계약

2026-10-02 구현 전 고정. 생물 요소와 기계 조립체의 source IR을 embedded asset 단위로 보관하는 `morphloom.workspace/0.1`을 추가한다. source schema·seed·ID·geometry·UV·PBR·사용자 override를 재작성하지 않는다. 원본과 표시 파생 장면을 분리하며 instance ID로 이름을 scope한다. 생성 시 필요한 capability를 각 Pack에 명시하고 없는 기능은 거부한다.

단위 mm·오른손 Y-up을 명시해야 한다. asset datum의 position은 mm, XYZ Euler rotation은 rad이며 mesh에만 적용한다. 혼합 단위나 다른 표현을 추측 변환하지 않는다. 새 wrapper이므로 기존 IR migration은 불필요하며 잘못된 버전·입력·중복 asset ID를 거부한다.

최대 16 assets, 전체 256 parts·5000 reserved elements, 2MB JSON, 200만 표시 triangles·128 draw batches·128 export objects를 적용한다. 대표 fur+bearing Detail은 10만 triangles 이하다. UI와 파일 경로를 포함해 검수한다. 첫 반복 예산은 20분·같은 결함 최대 2회이며 넘으면 원인/현재 상태를 기록한다. 텍스처·새 의존성은 추가하지 않는다.

합격: 다른 asset의 편집 상태와 resolved distribution이 append/국부 수정/저장·재열기에서 동일하다. duplicate local ID는 충돌 없이 scoped names로 export한다. provider 오류가 기존 workspace를 손상시키지 않는다. GLB에서 이름·계층·UV·PBR·datum transform을 확인하고 Blender 재열기를 수행한다. GLB에 sourceSpec을 넣어도 target app이 이를 엔진 원본으로 복원한다고 주장하지 않는다. native source는 companion workspace JSON을 사용한다. 해당 구현·UI·납품이 검증되기 전에는 experimental이다.

검수 중 기존 repair의 untextured UV pruning 결함을 발견했다. 첫 반복 이후 이 별도 결함의 원인 확인·회귀 테스트·최소 수정·현재 파일 재검사에 15분을 추가 배정했다. 형상·보존·품질 임계값은 바꾸지 않는다.
