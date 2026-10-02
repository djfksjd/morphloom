# 선언된 구면 가시 전면의 연속 경계 — 고정 계약

기준선은 f734ce0의 declared-sphere-front grid 후보다. 픽셀/stride로 잘린 경계와 .001mm 정점깊이 검증을 구분한다. 작성된 구면 IR와 독립 mm anchor가 있는 경우만 지원한다. 원본 samples/mask/quality/calibration/fingerprints는 수정하지 않는다. 후면과 내부는 생성하지 않으며 releaseAllowed:false와 .100/.250/.001 검증은 유지한다.

native0.3에 선택적 morphloom.depth-meshing/0.1, mode declared-sphere-front, maxSagittaMm을 추가한다.0.1/0.2는 기존 raw/grid 계산을 유지하며 옵션을 받지 않는다. 마이그레이션은 깊은 복사, 미확인 품질 unknown 유지, 자동 채택 없음. 연속 후보는 primaryForm+preview 선언과 명시적 diagnostic가 필요하다. UI는 대상 topology/UV 변경을 알리고 적용/취소/Undo/Redo와 저장·재열기를 제공한다.

기존 Three.js SphereGeometry를 가시 전면(북반구→+Z)으로 사용한다. 반지름과 XY는 기존 IR 선언, Z는 검증된 fit anchor로 정렬한다. 선언 원이 카메라 프레임에 완전히 들어 있어야 하며 전체 pixel-centre footprint가 관측 mask와 일치해야 한다. torus/hole/occlusion/crop과 일관되지 않는 anchor를 거부한다. UV는 원래 정사영 frame에 대한 투영이다. 원본/비대상에 영향을 주지 않으며 topology/UV/index 변경은 선택한 새로운 후보에만 한정한다.

먼저30분 점검, 동일 실패2회 재진단. 입력256²/8MiB,100k triangles 유지. 연산별 maxSagittaMm은 (0.00001..10)이고 실제 계산한 분할이100k를 넘으면 거부한다. 검증 fixture는 두 크기×matte/checker와3mm볼이다. 사전 목표는 maxSagittaMm=min(.02,radius/3000), boundary chord 및 모든 mesh edge/face centroid의 구면 chord deviation≤maxSagittaMm+0.0001mm, 실제정점 구면오차≤.001mm, degenerate/non-manifold/self-intersection0, 의도된 단일 열린 rim이다. 이전grid경계보다 최대 radial deficit를50% 이상 줄이고, 같은 카메라/조명/배경/1024² clay front/iso/wire/ROI에서 확인한다. UV는 finite[0,1], 면 orientation 일관성, Node/browser deterministic GLB 및 Blender 재열기/볼1mm편집/복원을 검수한다. compile은 이 Mac에서 각 fixture≤1초로 측정한다. 전문가/실제품/제조 정확도는 not-run이다.

## 실제 삼각형 검증 보강 — 기존 합격 임계값 유지

c8e4dba 완료 감사에서 정점/analyticfield 검증만으로 실제 삼각형 깊이를 증명할 수 없음을 확인했다. 실제 GLB의 Float32 삼각형을 원본 pixel-centre에 투영·보간하고 전체 전경 누락0, 기존 envelope/독립boundary .001mm 및 .100/.250 검증을 함께 확인한다. UI의 적용은 실제 메시 validation 실패 시 거부하며 이전 상태를 보존한다. releaseAllowed:false는 불변이다.

Three.js SphereGeometry 샘플과 전체 관측 mask의 선언 구면 pixel-centre를 기존 ConvexHull로 삼각화한다. fit/validation/boundary 검증점의 위치·깊이를 기하 보강에 사용하지 않는다. 기존 fit의 Z datum은 재사용한다. rim만 full-mask의 최소 radial clearance와 기존 sagitta 계약으로 분할하며 임시 cap은 제거한다. .0035mm 이내 중복 파라메트릭 점을 생략해 기존 topology 용접 기준을 지키고 원본 raster 점을 보존한다. Node/browser 동일 면 집합은 canonical index 순서로 기록한다. 실제 정점/곡률 검사는 생성 후에도 수행한다.

엔진 revision0.3.1, native0.3/연산0.1 호환을 유지한다. 샘플러는 입력256²/100k triangles 외 합산2,000,000 projected pixel tests를 넘으면 명시적으로 실패한다. 30분 checkpoint와 동일 실패2회 재진단 기록을 보존하며 이후 검수 시간을 최초 예산 안에 완료했다고 보고하지 않는다.
