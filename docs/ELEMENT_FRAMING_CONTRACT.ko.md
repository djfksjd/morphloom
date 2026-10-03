# Element/Workspace Fit view 계약 (2026-10-03)

구현 전 현재 native 기어0.4 full-page 캡처에서26mm 기어가 약80px로 축소된다. ElementEditor는 Box diagonal을0.1m로 올리고 aspect를 모르는 상태에서 카메라 거리를 결정한다. 원본 baseline-failure.json은 outputs/element-framing-20261003에 보존한다.

첫 반복20분/동일 결함 수정2회. 새 생성기나 카메라 보정 모델을 만들지 않고 기존 fitPerspectiveCameraToBounds를 재사용한다. 현재 host aspect/FOV45도/기존iso 방향/1.22 padding으로 실제bounds의 모든 corner를 포함한다. 빈 scene은 안전한 기존 규모 fallback. 최초 표시·명시적 Fit view만 자동 fit; 편집/검수 모드 변경으로 저장된 사용자 orbit pose를 덮지 않는다. near는 mm-scale asset을 자르지 않게 조정한다. IR/geometry/UV/PBR/export 바이트는 변경하지 않는다.

합격: 실제 default/small/large 기어와 bearing/동물/mixed 사례의 initial/Fit view 표시, wide/narrow에서 Fit view 후 clip 없음. 기본26mm 기어의 canvas foreground limiting-axis 점유율0.5..0.9, 모든 foreground margin>=8px. 같은 조명/checker/방향/viewport로 전후 검수. 전체 corners의 투영 수학검사와 empty bounds 경로, orbit pose 편집 후 보존, export source/bytes unchanged. UI 프레이밍이며 원자료 실루엣 정확도/형상 개선/납품 gate 승인이 아니다. 기존 quality thresholds 유지; API/Claude 한도 해제는 의존 조건으로 삼지 않는다.
