# 상대 깊이 가시 표면 계약 — 2026-10-03

목적: 선택적 모델 상대 inverse-depth를 원본 field로 보존하고 명시적인 정사영 카메라와 독립 mm 깊이 anchor가 있을 때만 가시 표면을 만드는 진단 경로. 제품 정확도·후면·내부·폐쇄 솔리드·제조용 납품 승인 아님. 기존 AssemblyIR와 brightness micro surface 불변.

입력 버전 morphloom.depth-surface/0.1, mm/right-handed/Y-up/front camera -Z. source image SHA·raw NPY SHA는 추적용이며 번들만으로 원본 인증을 주장하지 않는다. 최대256² raw samples, finite values, binary validity mask, byte8MiB. 6–512 fit anchors와4–512 독립 validation anchors; 중복/invalid mask/out-of-range/양의 깊이 밖은 거부. 최소 fit 역깊이 범위 및 variance, 양의 affine inverse-depth slope, 모든 foreground reciprocal 값>0 필수. 사용자가 확인한 camera frustum과 datum cameraZ(mm); 임의 추측 없음.

fit은 1/cameraDepthMm = a*relativeProxy+b. validation normalized inverse-depth MAE<=.100, 각 validation error<=.250(고정한 검증 anchor 역깊이 범위); critical 검증 개별 실패가 평균에 가려지지 않는다. 이 값은 이전 analytic study의 .100 MAE 계약을 보존한 실험용이며 실제제품 허용공차 아님. 실패는 생성 거부, 명시적 diagnostic 생성만 허용하며 releaseAllowed:false 고정. 토러스 사전 실패를 인정하며 통과시키기 위한 threshold 조정 금지.

정점은 정확한 원본 pixel centres→frustum xy, worldZ=cameraZ-cameraDepth. 양의 +Z normal, UV 원본 pixel centres. stride2 기본, stride1–8 제한, 모든 내부 pixel mask가1인 cell만 생성; 마스크 구멍을 가로지르는 edge 금지. 미참조 정점 제거, 최대100000 triangles, stable source pixel indices. 원본 field/anchors 보존; frame/camera/stride 수정은 파생 geometry만 재생성. 의도적 open surface는 별도 topology 계약, 기존 watertight gate 약화 안함.

검수: 실패 테스트→최소 엔진/UI→2크기 구면/체커/실패토러스 actual vertex/UV/normal/mask→동일조건 전체·단면/clay 이미지→actual GLB diagnostic와 Blender 재열기·편집. 저장/재열기 입력과 비대상 raw field 바이트 보존. 동일입력 결정론적; 예산35분·동일결함2회 재진단. Windows/model inference/native depth representation 납품/숨은면/전문가 판정 not-run.
