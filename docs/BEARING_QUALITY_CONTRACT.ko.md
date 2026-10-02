# 베어링 시각화 슬라이스 품질 계약

2026년 10월 2일. 제조용 설계가 아닌 창작 제품 시각화·메시 편집·Blender GLB 납품을 대상으로 한다. `morphloom.bearing-visual/0.1`은 원자료가 없는 명시적 창작이다. 모든 raceway, clearance, 케이지 두께는 설계 선택이며 실제 베어링의 부하·마찰·속도·정밀도 등급을 뜻하지 않는다.

## 형상과 치수

기본값은 내경 20mm, 외경 40mm, 폭 12mm, 볼 직경 6mm, 볼 8개다. 내외륜은 닫힌 회전 프로파일이며 실제 원형 관통·오목한 raceway·0.24mm chamfer를 갖춘다. 케이지는 중앙 bore와 8개 개별 관통 pocket을 가진 extrude다. 케이지의 얇은 lip과 느슨한 시각화 clearance는 제조 타당성 검증 대상이 아니다. 볼은 pitch radius 15mm의 XZ 평면에 배치하고 Y를 회전축으로 선언한다.

실물 참조 대신 선언한 치수를 생성된 메시에서 측정한다. 내경·외경·폭·볼 반경과 기준 위치 오차는 최대 0.01mm다. 볼 곡면의 정규화 면 중심 반경 부족량은 직경의 0.002 이하다. inner/outer/cage/ball 각각의 경계·비매니폴드·퇴화·자기 교차는 기존 topology gate를 통과해야 한다. 중요 특징 하나가 실패하면 전체 실패다. raycast로 중앙 bore와 각 cage pocket에 실제 기하가 없는지 확인한다.

## 편집과 보존

`ball_0000` 등 안정적 ID를 사용한다. UI에서 반경·PBR·위치를 draft로 변경하고 Apply/Cancel, Undo/Redo, isolate/hide, 분리/복원, JSON 저장/재열기, 선택/전체 GLB 내보내기를 확인한다. 새 Pack 생성은 새 프로젝트이며 기존 사용자 편집을 자동 이식하지 않는다.

조립체는 identity datum의 한 단계 Group이다. 현재 계층 회전·조립 구속 solver는 없다. 분리하면 원래 위치·회전·assemblyId를 home에 저장하고 canonical world에서 분리한다. 복원은 그 위치·회전·소속을 복구하며 분리 중의 geometry·색·roughness·metalness 수정은 유지한다. 비대상 geometry/UV/normal/PBR/계층/변환과 원본 상태가 보존돼야 한다.

요소 프로젝트 0.1은 그대로 parse하고 serialize한다. 새 선언 필드는 0.2에서만 허용한다. 명시적 `migrateElementProject`는 0.1→0.2 복사이며 원본을 수정하지 않는다. 알 수 없는 버전·기하 연산·필드·소속·불가능한 볼 packing은 거부한다. 기존 AssemblyIR와 component patch의 버전은 변경하지 않는다.

## 자원과 납품

기본 및 두 다른 치수 사례에서 조립체 100,000삼각형 이하, 최대 35부품이다. 기존 전체 2,000,000삼각형·128 batch·2MB 원본·30 history 차단 한도를 유지한다. texture 0개, 추가 의존성 0개다. 컴파일·검수 시간은 실제 Node/macOS·에셋 규모와 함께 측정하며 보편적인 fps를 약속하지 않는다. 각 결함은 최대 2회 수정 후 원인을 재진단한다.

1024×1024, 동일 camera/studio/clay 설정의 전체·중요 특징 close-up과 wireframe을 기록한다. beauty 조명으로 결함을 숨기지 않는다. GLB의 이름·assembly 계층·PBR·UV와 companion JSON을 보존한다. UV는 sphere 위경도와 기존 assembly per-face projection을 사용하며 projection의 overlap은 의도적이다. 텍스처 atlas, mip bleeding, texel density 또는 tangent-space normal-map 납품을 주장하지 않는다.

현재 코드에서 생성한 GLB를 Khronos로 검사하고 Blender에서 import·볼 한 개 수정·export·두 차례 재열기를 검증한다. 변경 전후 동일 입력과 현재 소스/입출력 SHA-256에 결과를 연결한다. GLB는 baked mesh이며 원본 procedural 의미는 companion JSON에 보존한다. native CAD, 실제 운동학·부하·피로·제조 승인과 독립 인간 전문가 평가는 이번 합격 범위 밖이다.
