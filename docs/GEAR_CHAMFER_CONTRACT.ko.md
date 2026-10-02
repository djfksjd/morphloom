# Spur gear 축방향 chamfer 계약

2026-10-02. 첫 반복25분/동일 결함 수정2회/10만tri asset. Native ExtrudeGeometry probe→실제 millimeter chamfer→국부 편집→GLB→Blender를 잇는다. 기존 AssemblyIR·gear 모듈/압력각/치수는 유지한다. 제조 치근·맞물림/강도/정밀 CAD는 범위 밖이다.

구현 전 actual native probe는 bevelOffset=-c, depth=width-2c, 1 segment로 외경·중간 bore·치폭을 유지하면서 cap 외경 축소/bore 확대를 확인했다. 7 baseline PASS; 기본/작은/큰/dense/wide/thin 양의14개 중12 PASS, near-bore2 FAIL. 최초 작은 gear c=.1module는128 퇴화 FAIL. 두 실패를 무작정 재생성하지 않고 진단했다: 작은 사례 raw0/weld128(기존1µm weld에서 cap vertex collapse), near-bore raw8/weld8(실제 매우 가는 cap triangle). thresholds를 바꾸지 않는다.

고정 범위: elements0.5 opt-in Part.axialChamferMm; spur-gear에만 지원. 0은 기존 기하 그대로. 양수는 최소0.001mm, 최대min(.05module,.1faceWidth,.1root-wall radial). positive chamfer는 root radial wall>=.25module 필요. 범위 검증 후 실제 생성 topology pass가 필수며 FAIL 시 적용하지 않는다. 검증된 입력 범위라는 이유로 미측정 모든 조합의 성공을 보장하지 않는다. Missing UV/NaN/invalid old-schema fields는 기존 계약대로 거부한다. 명시적 lossless migration은 기본 연산을 삽입하지 않는다.

Representative m1/z24/20°/8mm width/6mm bore, c=.05mm. 중간 profile 원본과 동일; 치폭±.00001mm, 외경/중간 bore 정점 반경±.00001mm(large±.00001mm), cap chamfer기하45° planar bevel 1 segment. 원자료 없는 모서리 가공은 authored 시각화 선택. 첫 용도 제품 시각화, Blender5.2.1 baked mesh. UV는 native projector와 opt-in uvScale를 유지하며 topology 변화에 따라 target UV 변화는 허용, 비대상 UV/PBR/계층/변환 보존 필수.

Inspector mm 입력과 range, Apply/Cancel/Undo/Redo/save/reload, actual file hashes와 변경 전후 clay/grazing/전체/실제 edge close 검수. 회귀7경계사례+invalid near-bore, 기존82파일 테스트/quality gate 악화 없음. releaseAllowed·degenerate/nonmanifold/self-intersection 기준을 낮추지 않는다. 이전 전체 framing close FAIL을 이 goal의 성공 증거로 재사용하지 않는다.

추가 실행에서 기존 dense64 native profile은 일반 AssemblyIR4096 array 검사 때문에 실제 compiler에서 차단됐다. 선언형 gear는8192 curve budget을 갖지만 기존 compile 경로가 불일치했다. Raw AssemblyIR4096 guard는 유지하며, validateSpurGear+gearExtrude로만 만들 수 있는 bounded derived-gear compiler 경로를 재사용한다. 자유 raw profile의 한도를 늘리지 않는다. 양의chamfer가 있는 diagnostic tooth sector cut은 첫 단계에서 지원하지 않으며 UI/엔진에서 명확히 거부한다. 원본 chamfer를 묵시적으로 잃은 sector를 납품하지 않는다.
