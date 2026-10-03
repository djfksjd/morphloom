# 케이지 곡면 작업 계약 — 구현 전 고정

기준 c9fcc5b, ABO B07XMV34PX 기존 5사진과 101부품 IR. 네 spin 사진을 로컬에서 모두 확인했다. 평평한 front 링과 직선 spoke는 사진의 앞으로 솟은 guard와 구조가 다르다. 이번 작업은 앞 guard의 실제 곡면 표현과 선택한 wire의 수치 편집만 다룬다. 카메라·치수 미보정으로 사진 정확도 합격이나 전체 제품 완료를 주장하지 않는다.

- 용도: 제품 시각화와 편집 가능한 mesh, 대상 Blender. 원본 사진 외부 전송 없음. UNI_AI 공개 코드 분석/초안/리뷰 ≤3회, usage 기록.
- 일반 연산: 기존 tube의 두 endpoint + 명시적 2차 Bezier control point(mm). 새 curve/0.1과 patch/0.2 opt-in; 기존 assembly/job와 patch/0.1 유지. 기존 경로는 정점/normal/UV/index 동일. 입력 오류/특이 접선/후진 경로/과도한 휨/곡률보다 굵은 wire는 생성 전에 거부한다.
- 대표 추정: outer radius 216mm, front profile rise 30mm. 사진에서 볼록한 형태는 관측됐지만 rise 수치는 작성 추정이다. 포물선 z=-42-30*(1-(r/216)^2), outer attachment와 링 반지름 보존; 중심 cap도 동일30mm 앞으로 이동. front 링18+spoke12+cap1만 변경, 나머지70부품 geometry/UV/PBR/계층 보존. 위치는 기존 -4도 tilt 좌표계에 적용.
- 중요 특징별 합격: rim 기준 rise 30mm±0.1, spoke centerline과 ring 높이 차이≤0.1mm, 실제 기하에 볼록한 depth 존재. tube cap 닫힘/기존 topology·UV integrity 통과. 후면과 blade/stand 형상은 유지. 이 기준은 기하 연산 검증이며 원자료 오차 검증이 아니다.
- 비교: 동일1024² clay, wire, side/등각 및 선택 spoke 확대. DOF/후처리로 결함을 숨기지 않는다. 모델 전체 bounding 변화는 guard 앞쪽 깊이 외 기록하고 불확실한 source silhouette 정확도는 not-run.
- 예산: compile≤2초, triangles≤120000, texture estimate≤16MiB, GLB≤20MiB, 기존 검사 임계값 불변. 절반 크기와 축 회전 다른 fixture로 일반성 확인.
- 편집: 선택한 2-point open tube에서 local control mm 입력/적용/취소/undo/redo/저장·재열기. 다른 링이나 연결 부품을 자동 변경한다고 주장하지 않는다. 실제 GLB와 Blender 재열기·국부 수정 검증.
- 반복: 원인별 최대2회 실패 후 재진단; 30분 checkpoint, 한 작업 단위 90분 예산 후 미완료는 구분 기록. 독립 전문가·CAD/BREP·제조·완전 인체·Domain Pack 확장은 이번 작업 밖.
