# Extrude UV 안정성 계약

2026-10-02. 활성 goal, 첫 반복20분·같은 결함 수정 최대2회. 현재 기어의 Node/browser 출력에서 bore UV6좌표 최대0.0001041198 차이를 재현했다. 위치/normal/metadata는 같고 같은 브라우저의 선택 전후 출력은 바이트가 같다. 현재 원본과 납품 파일을 덮어쓰지 않는다.

조사된 후보 원인은 Three ExtrudeGeometry의 generateSideWallUV가 abs(dy)<abs(dx)로 축을 선택하는 분기다. 대각선에 가까운 edge의 미세 연산 차이가 축 선택을 바꾸는지 실패 사례로 확인한다. 단순 오차 허용 확대로 통과시키지 않는다. 기존 cap UV와 위치/normal/PBR/계층을 보존하고 측벽의 일관된 축 또는 profile-distance 기준 연산을 검토한다. 지원 범위·엔진 revision·기존 UV 변경 범위를 명시한다.

합격: 실제 browser/Node 출력의 UV accessor 바이트 동일, 기어3크기·베어링 cage·다른 extrude 사례의 회귀, topology/치수 악화 없음, 기존 재질/파일 납품 검증 유지. 새 UV seam/overlap은 의도와 제한을 기록한다. 이 검사는 texel density/normal map 품질 전체를 대체하지 않는다. 변경 전 실패 테스트·원인 진단 후 최소 구현한다. 추가 의존성·schema 변경·push·배포 없음.
