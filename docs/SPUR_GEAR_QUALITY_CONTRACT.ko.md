# Spur gear 첫 구현 계약

2026-10-02, 활성 goal의 구현 전 기준. 외접·직선·전위0의 단일 spur gear 시각화와 선언형 편집을 대상으로 한다. 제조 승인·가공 공차·응력·정확한 cutter trochoid·맞물림 동역학은 범위 밖이다. 공식 참고: [KHK 치수 계산](https://khkgears.net/new/gear_knowledge/gear_technical_reference/calculation_gear_dimensions.html), [KHK spur 기술 자료](https://khkgears.net/pdf/spur-tech.pdf). 공식 HTML의 gzip 응답을 해독하여 Table 4.1 치수 관계를 확인했다. 원문은 outputs/spur-gear-20261002/khk-dimensions.html에 보존했다. 표준을 완전히 준수했다고 표시하지 않는다.

대표 창작 입력: module1mm, teeth24, pressureAngle20deg, faceWidth8mm, bore6mm. 다른 검증 입력: module0.2/teeth18/pressure20/width2/bore1, module2/teeth40/pressure25/width12/bore10. 외접 인벌류트 flank와 실제 관통 bore를 geometry로 표현한다. primary 치수와 접합을 통과하기 전 마모·스크래치를 추가하지 않는다. 치근 연결의 근사 방식과 오차는 별도로 기록한다.

선언한 pitch/base/addendum/root 관계는 계산 결과와 생성 정점에서 확인한다. 주요 경계 치수 오차0.01mm 이하, flank 분할의 analytic curve 대비 오차0.005 module 이하를 구현 전에 고정한다. 세 사례별10만삼각형·texture0·새 의존성0. 1024×1024 동일 camera/light의 clay·wire·flank 가까이 보기와 Blender 실제 파일을 확인한다. 기존 topology/납품/비대상 보존 gate는 유지한다. 단일 중요 특징 실패도 전체 실패다.

Tooth ID는 연결된 body feature를 뜻하며 detachable assembly part로 표시하지 않는다. 추출은 원본을 변경하지 않는 검사용 독립 물체 생성이고, 실제 치아가 분리되는 구조라는 주장은 하지 않는다. 부품 ID·입출력 fingerprints·유효 범위·실패 조건과 편집 원본을 보존한다. 필요한 필드는 새 schema version과 명시적 migration을 제공하고 기존0.1/0.2 입력은 그대로 유지한다. 새 연산은 선언형이며 임의 코드 실행을 추가하지 않는다.

현재 병목: generic part-geometry의 polygon256점 제한은 촘촘한 인벌류트 반복에 부족할 수 있다. 임계값을 완화해 거친 flank를 통과시키지 않는다. 원본 parametric 표현을 유지하고 기존 extrude로 파생하는 경로 또는 versioned bounded 연산을 검토한다. Gear/involute 구현은 코드 검색에서 찾지 못했다.

다음 반복 예산30분·같은 결함 수정 최대2회. 먼저 analytic 치수/곡률·undercut 거부·stable feature ID 실패 테스트를 작성한다. 자료가 확인되지 않은 수식/치근은 blocked/not-run으로 남기며 이전 베어링 결과를 기어 검증으로 재사용하지 않는다.
