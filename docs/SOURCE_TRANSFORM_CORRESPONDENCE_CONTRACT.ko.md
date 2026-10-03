# Blender 변환 대응 계산 수정 계약

2026-10-03 21:31 KST, 30분/최대2회 수정. 기준 4688f70. 회전·비균일 scale parent fixture는 실제 Blender import/source matrix 최대2.384185791015625e-7로 기존1e-7 거부를 재현했다. 원본 GLB/실패 로그/threshold를 보존한다. 설치된 Blender5.2.1 importer의 TRS 축 변환→행렬 조립→parent 합성 순서와 새 adapter의 전체행렬 basis 변환 순서를 비교한다. Float32 순서 차이라는 가설을 실제 숫자로 먼저 확인한다.

대응 계산을 수정한다면 기존1e-7 component guard, 실제 위치0.001mm, split normal0.01도, 원본 BIN/non-target JSON/IR reference 정책을 유지한다. 실패 검사 비활성화·epsilon 확대·ID 예외 금지. 부모 변환·local/world 이동의 실제 입력/출력 SHA와 source/import world matrix를 기록한다. TRS/matrix·회전/scale/translation·각 축·기존7case 회귀 및 shear/singular/unknown 거부를 확인한다. mesh/source geometry 수정·UI 확장은 별도 범위이며 이 단계에는 하지 않는다. 추가 dependency/API/CLI 모델 호출0(확인된 quota). 기존 source IR 현재화 문제는 다음 별도 단계이며 합격을 선언하지 않는다.
