# Gear 직접 선택 검수

2026-10-02. 실제 ray hit를 메시 로컬 mm 좌표로 변환하고 generated contour 안/root circle 밖일 때만 tooth ID를 선택한다. bore/몸체/치간 빈 공간을 거부한다. 임시 feature 윤곽 표시·dropdown·inspector를 연결했고 ID가 사라지면 해제한다. 원본 schema는 변경하지 않는다.

변경: src/engine/gear-picking.ts, src/ElementEditor.tsx, tests/gear-picking.test.ts. 실제 contour 및 회전·비균일 scale을 적용한 mesh raycast 테스트를 추가했다. check/build,79파일581테스트 PASS. 브라우저에서 tooth_0005 클릭→윤곽→수정→Undo, bore 클릭 해제, tooth_0023 선택 후24→18 teeth 변경 시 해제를 확인했다. 선택 전후 같은 브라우저 GLB는 바이트가 같고 glTF/Blender roundtrip도 PASS다. outputs/spur-gear-20261002/picking-verification.json과 picking-final.png를 따른다.

Node/browser GLB의 bore UV6좌표에서 최대0.0001041198 차이가 발견됐다. 위치/normal/metadata는 같지만 전체 UV 동일성은 미충족이다. 선택 회귀는 아니며 다음 goal에서 명시적 안정 UV 연산을 검토한다. 선택은 세션 상태이고 reload 후 feature 자동 복원은 지원하지 않는다. 제조/맞물림/독립 전문가 평가를 주장하지 않는다.
