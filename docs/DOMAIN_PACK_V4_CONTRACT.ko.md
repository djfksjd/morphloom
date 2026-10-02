# Domain Pack API0.4 계약

문제: parser/renderer/editor는 elements0.6을 지원하지만 registry는 Pack/API 버전과 원본 표현 버전을 결합하여 최신 원본 생성 Pack을 거부한다.

기존 Pack0.1~0.3의 API/engineApi/representation 동일 버전 규칙을 유지한다. 추가 API0.4는 engineApi 정확히0.4를 요구하고, native output schema를 명시적으로 elements0.1~0.6 중 하나로 선언한다. 실제 출력 schema가 선언과 일치해야 한다. 미지원 표현·API·단위·좌표·capability·부적합 input·provider 실패는 기존 typed 오류로 거부하며 무관한 원본/history는 보존한다. 등록 자체는 experimental이며 납품 검증 승인이 아니다. 임의 코드 sandbox/무한루프 차단은 지원하지 않는다.

기존 gear engine에 선언형 UV scale과 roughness-only 표면을 연결한 SDK Pack 예제를 만들고 공통 selector/inspector/workspace에 등록한다. generator별 ID 예외·compiler 재작성·묵시적 migration 없이 명시적 source migration을 사용한다. 실제0.6 source/GLB, 사용자 stage/apply/cancel/undo/reload/export, fur+gear 혼합 프로젝트, 다른 기어 크기, 실패 격리와 non-target 데이터 보존을 검수한다. 기존 품질·메모리·export 임계값을 유지한다.

용도: authored product/mechanical visualization, Blender5.2.1 LTS와 현재 static GLB. 제조/맞물림/하중/실측 metal/atlas 정확도를 주장하지 않는다. 렌더/texture 알고리즘 변경이 목표가 아니므로 geometry/UV/PBR/image bytes 검수를 중심으로 하고 기존 중립 렌더를 재사용할 때 current hash가 일치하는지 확인한다. 예산: 감사10분+구현/검수20분, 기존2M triangles/128export batches/32MiB 공유캐시 유지.

## 실제 혼합 검수에서 드러난 의존 결함

기존 fur/feather section은 UV가 없고, 반경0.001의 끝 ring을 cap으로 막아 기본 fur tip의16삼각형이 기존world area1e-14 아래로 떨어졌다. side/cap winding도 inward였다. 일반 mixed export가 이 결함을 실제로 차단했다. 원본IR/parameter/ID를 유지하면서 section의 끝을 single pole로 연결하고 seam UV·outward winding·seam normal 평균을 적용한다. renderer0.10으로 파생 메시 변경을 명시한다. 내부 ring의 원래 위치는 유지하고 tiny끝 ring만 제거한다. 데이터 gate를 낮추지 않는다. 원본/수정 실제GLB를 따로 보존하여 모양·닫힘·UV·normal·Blender 납품을 재검수한다. 이것은 strand/feather representation B 개선이며 실제 groom/해부학 검증은 아니다.
