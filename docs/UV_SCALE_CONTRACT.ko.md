# Opt-in UV scale 편집 계약

2026-10-02. 다음 활성 goal의 구현 전 계약. 첫 구현 반복25분·같은 결함 수정 최대2회. 기준선은 UV_QUALITY_STATUS.ko.md와 outputs/uv-quality-20261002/verification.json이다. gear/small의 UV 실패를 metadata나 threshold 변경으로 통과시키지 않는다.

UV scale은 native UV 좌표에 곱하는 양의 단위 없는 scalar이며 geometry/normal/PBR/계층/리그를 바꾸지 않는다. 물리 tile size나 texel density를 보장하지 않는다. 검사에서 측정한 UV units/m를 함께 표시한다. 기존 native planar/periodic overlap을 유지하는 opt-in 편집이며 unique atlas, padding, mip bleeding 해결로 표시하지 않는다.

원본0.1/0.2/0.3을 자동 업그레이드하지 않는다. part의 선언형 uvScale을 위해 elements0.4와 명시적 lossless migration을 먼저 검토한다. migration 후 기본값을 삽입해 UV를 바꾸지 않는다. 미지원 구버전 필드, NaN/Infinity/0/음수/범위 외, UV attribute 없음은 명확하게 거부한다. source/job/AssemblyIR의 기존 계약을 유지한다.

합격: 실제 UV 배열 변경과 기존 gate 결과, opt-in 유지, 선택 부품의 dimension/position/normal/index/PBR/계층 및 비대상 UV fingerprint 보존, undo/redo·저장/재열기, actual GLB의 texture checker 검수와 Blender 재열기,5사례 회귀. synthetic checker는 검사용 자료이며 원본 재질/관측 이미지라고 표시하지 않는다. 기본 납품의 원본 재질을 몰래 checker로 교체하지 않는다.

검수용 후보 scale은1/10/100/1000을 실제 데이터로 측정한 뒤 용도 계약에 맞게 선택한다. 허용 범위는 구현 전에 고정하고 geometry/texture 예산은 기존10만tri/asset 및 diagnostic64px checker를 사용한다. UV quality의1e-10/0.05, releaseAllowed를 유지하며 아틀라스/제조/전문가 승인은 미검증이다. 현재 미완료이며 다음에는 실제 UV scale probe·실패 테스트·schema 마이그레이션부터 진행한다.

구현 전 범위 고정: uvScale 0.001..1000, 유한 scalar. 64px checker의 8 cells/UV tile 기준으로 scale100은 planar mapping에 10mm tile / 1.25mm cell을 제공한다. 다른 native mapping에는 이 물리 크기를 일반화하지 않는다.
