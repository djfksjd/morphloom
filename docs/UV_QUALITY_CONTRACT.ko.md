# UV 품질 검사 확장 계약

2026-10-02, 활성 goal 첫 반복30분·같은 결함 수정 최대2회. 실제 GLB5개를 GLTFLoader로 재열고 기존 auditDomainReadiness를 실행했다. 기존 inspectGeometry는 UV count/finite 및 signed UV double area를 계산하고 absolute1e-10 이하를 퇴화로 센다. design-uv는 mesh coverage0.95·finite1·퇴화 fraction0.05 이하를 요구한다. 이 기준을 낮추거나 끄지 않는다.

기준선: 대표 gear 퇴화17.7719% FAIL, small32.0137% FAIL, large4.8077% PASS, bearing0% PASS, bevel extrude0% PASS. 증거 outputs/uv-quality-20261002/baseline.json은 실제 GLB hash를 인용한다. 기존 원본·파일을 덮어쓰지 않는다. UV 동일성과 UV 적합성은 별개이며 이전 안정화 검수가 이 실패를 대체하지 않는다.

기존 집계 helper를 재사용/확장해 per-mesh·per-triangle actual world area(m²)/UV area, 유한성·퇴화·방향과 Jacobian stretch/물리 UV scale을 보고한다. 실측 물성이나 texel density로 표시하지 않는다. texture 크기가 없으면 texels/mm는 not-run이다. mirror/tiling/planar overlap은 native mapping 계약과 실제 교차를 구분한다. 검사되지 않은 overlap을0으로 표시하지 않는다. bounded 교차 검사와 비용을 기록한다.

합격: 기존 실패 결과 유지, 특정 중요 mesh 실패가 평균에 가려지지 않음, 실제 UV 좌표 변조 실패 사례, source/output fingerprint와현재 선택/편집 결과 연결, stale 보고서 방지, 공통 UI 표시,5사례 회귀 및 실제 GLB 재열기. schema 변경이 필요하면 버전/명시적 migration/거부 조건을 먼저 정한다. 보고서 추가만으로 실패 모델의 품질이 개선됐다고 주장하지 않는다. geometry/UV 재작성은 원인·계약·사용자 원본 보존 범위에 근거해 별도 구현한다.

연결 tooth가 하나의 mesh 평균에 가려지는 문제도 분리한다. native source contour가 확인되는 경우 triangle centroid의 로컬 좌표를 기존 tooth 판정 연산으로 분류하고 tooth별0.05 퇴화 기준을 적용한다. 이는 전체 triangle의 feature 영역 분할이 아니라 centroid attribution이다. 원본 contour가 없으면 feature 검수는 not-run이며 임의 ID를 추정하지 않는다. root/body에 속한 triangle은 body로 남긴다. 기존 aggregate gate는 동일하게 유지하고 새 per-mesh/per-feature integrity는 더 엄격한 보조 결과다.
검사 예산: static100000tri/mesh·300000tri/scene, 속성300000vertices·size<=4, overlap20000후보/mesh(최대200000), fingerprint80MB, 납품 상세 보고서20MB. Instanced/skinned pose는 이 검사에서 blocked다. 실제 비용을 출력하고 미검사 pair를0으로 표시하지 않는다.
