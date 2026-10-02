# 가시 깊이 경계 계약 0.2 — 2026-10-03

고정 실패 사례는 6fd52cd의 구형 경계 최대 32–50mm 돌출과 토러스 검증점 실패다. 원본 깊이, 기존 .100/.250 임계값과 releaseAllowed:false를 유지한다. clamp 또는 smoothing을 사용하지 않는다. 작업 예산은 먼저30분,256²샘플,100k삼각형,8MiB입력,동일실패2회후재진단이다.

native0.2 quality.depthEnvelope은 unknown 또는 declared 상태다. 선언에는 camera-depth near/far mm,허용오차0..10mm,근거 user-measured/authored-fixture를 넣는다. 모든 전경 샘플을 검사하고 한 위반도 차단한다. quality.boundary에는1..8pixels밴드,독립검증점4..512개,허용오차0..10mm와근거를 선언한다.4방향 이웃으로 이미지 경계와 mask구멍의 전경 밴드를 구한다. 경계 검증점은 실제 밴드에 속하고 fit/validation의ID와pixel에중복되지 않아야 한다. 한 점의 실패도 평균과 무관하게 차단한다.

선언이 부족하면 unknown/blocked다. Legacy0.1은 호환 계산과 미검증 상태를 유지한다. Migration은 전체 원본을 깊은 복사하고 unknownquality만추가한다. 미지원버전,잘못된메타데이터,중복점,비경계점,배열불일치,비유한깊이는명시적실패다.

선택적 구면 후보는 morphloom.sphere-front-constraint/0.1로 반지름·중심mm와 user-declared/authored-fixture근거를 선언한다. 기존AssemblyIR sphere.radius를 adapter로 받고 반지름·XY를 고정한다. 전경pixel-centre마스크가 선언된 구면 footprint와 정확히 일치해야 한다. 토러스 구멍이나 다른 실루엣은 거부한다. fitanchor로 관측 가능한centerZ만 보정하고 선언datum과 centerFitToleranceMm(0..10) 및 각fitanchor오차를검사한다. 이번 작성한 fixture의사전허용오차는 .001mm다.

같은mask/UV/index메시커널로 전면만 만든다. 원본깊이 실패보고서는 후보보고서와 분리해서보존한다. 후보도 전체전경envelope,경계개별점,기존독립validation을통과해야 한다. 명시적 diagnostic경로만지원하며 실측·후면·제조·일반곡면복원으로표기하지않는다.

합격조건은2크기×matte/checker4구형과3mm볼의 실제후보정점MAE/최대오차<.001mm,토러스구면후보거부,XY/UV/index및원본배열/비대상원본보존이다. Native편집/Undo/저장/재열기,Node/browser바이트,Khronos,Blender재열기·편집과동일조건clay/iso/wire/ROI를검수한다. 픽셀절단 경계의앨리어싱은미해결범위로표시하고 원본보존계약을깨며숨기지않는다.
