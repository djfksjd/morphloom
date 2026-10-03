# Corner-angle normals 계약 (2026-10-03)

기준 fbc8eec에서 닫힌 회전체의 직선 원통 측면 normal radial 오차가16/32/128분할 각각3.7934/1.8804/0.4689도다. 삼각형별 uniform weighting에 따른 비대칭을 재현했다. 실제 형상·실측물체 정확도 주장이 아니라 analytic 회전체 shading 결함이다.

45분/동일 결함 수정2회 예산. 기존 crease threshold·position·UV·index·PBR·계층을 보존한다. 선택 부품에만 명시적 corner-angle weighting을 적용한다. 기존 elements0.1–0.6/기존프로젝트/neutral migration은 생성 buffer byte-exact. 새 elements0.7은 optional normalWeighting:'uniform'|'corner-angle'을 허용하고 명시적 migration은 schema 외 기본값을 넣지 않는다. unknown weighting/old schema option/sphere나비기하적part에 대한 옵션은 거부한다. default uniform은 기존 알고리즘과 동일하다.

합격:analytic16/32/128분할 원통 radial normal 오차≤0.01도, cap축방향 normal 보존, valid topology·치수·legacy UV 유지. 삼각분할 대각선 변경에도 동일 smooth surface normal≤0.01도. neutral과비대상 부품의모든버퍼/UV/PBR/transform/계층 보존. native enable→선택race 변경→Apply/Cancel/Undo/Redo→save/reopen/actualGLB. 동일조건clay·사광closeup전후 및Blender 재열기 실제normal 비교. bearing 외다른규격회전체 검증. 컴파일평균비용 기존대비≤2배/대표asset≤10초, 삼각형/texture추가0. strict기존qualitygate는 약화하지 않으며기존실패와구분한다.
