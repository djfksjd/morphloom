# 선언된 구면 가시 전면의 연속 경계 — 고정 계약

기준선은 f734ce0의 declared-sphere-front grid 후보다. 픽셀/stride로 잘린 경계와 .001mm 정점깊이 검증을 구분한다. 작성된 구면 IR와 독립 mm anchor가 있는 경우만 지원한다. 원본 samples/mask/quality/calibration/fingerprints는 수정하지 않는다. 후면과 내부는 생성하지 않으며 releaseAllowed:false와 .100/.250/.001 검증은 유지한다.

native0.3에 선택적 morphloom.depth-meshing/0.1, mode declared-sphere-front, maxSagittaMm을 추가한다.0.1/0.2는 기존 raw/grid 계산을 유지하며 옵션을 받지 않는다. 마이그레이션은 깊은 복사, 미확인 품질 unknown 유지, 자동 채택 없음. 연속 후보는 primaryForm+preview 선언과 명시적 diagnostic가 필요하다. UI는 대상 topology/UV 변경을 알리고 적용/취소/Undo/Redo와 저장·재열기를 제공한다.

기존 Three.js SphereGeometry를 가시 전면(북반구→+Z)으로 사용한다. 반지름과 XY는 기존 IR 선언, Z는 검증된 fit anchor로 정렬한다. 선언 원이 카메라 프레임에 완전히 들어 있어야 하며 전체 pixel-centre footprint가 관측 mask와 일치해야 한다. torus/hole/occlusion/crop과 일관되지 않는 anchor를 거부한다. UV는 원래 정사영 frame에 대한 투영이다. 원본/비대상에 영향을 주지 않으며 topology/UV/index 변경은 선택한 새로운 후보에만 한정한다.

먼저30분 점검, 동일 실패2회 재진단. 입력256²/8MiB,100k triangles 유지. 연산별 maxSagittaMm은 (0.00001..10)이고 실제 계산한 분할이100k를 넘으면 거부한다. 검증 fixture는 두 크기×matte/checker와3mm볼이다. 사전 목표는 maxSagittaMm=min(.02,radius/3000), boundary chord 및 모든 mesh edge/face centroid의 구면 chord deviation≤maxSagittaMm+0.0001mm, 실제정점 구면오차≤.001mm, degenerate/non-manifold/self-intersection0, 의도된 단일 열린 rim이다. 이전grid경계보다 최대 radial deficit를50% 이상 줄이고, 같은 카메라/조명/배경/1024² clay front/iso/wire/ROI에서 확인한다. UV는 finite[0,1], 면 orientation 일관성, Node/browser deterministic GLB 및 Blender 재열기/볼1mm편집/복원을 검수한다. compile은 이 Mac에서 각 fixture≤1초로 측정한다. 전문가/실제품/제조 정확도는 not-run이다.
