# 가시 깊이 경계와 IR 구면 후보 — 2026-10-03

native depth0.2/report0.2에 전경 전체의 깊이 범위와 독립 경계 검증점을 구현했다. 하나의 샘플·검증점 실패도 차단한다. 출처와 치수가 부족하면 unknown이다. 원본 field 수정·clamp·smoothing 없이 기존 .100/.250와releaseAllowed:false를 유지한다.0.1은 호환되며 migrateDepthSurface는 원본을 깊은 복사하고 unknown계약만추가한다. 버전·잘못된선언·중복점·비경계점·NaN·배열불일치 실패조건을 제공한다.

구면 후보는 기존AssemblyIR sphere.radius를 받는 adapter와 선언된 중심을 사용한다. 실제 ball_0000의radius3 선언을 확인했고 기존bearing프로젝트 전체해시를 보존했다. 관측 마스크와 정확히 같은 구면 footprint일 때만 반지름/XY를 고정하고 fitanchor로Zdatum을 보정한다. 각fitanchor와datum허용오차를 검사한다. 전면만 만들며 토러스 구멍에는 적용을 거부한다. 원본의 실패보고서는 후보의 통과보고서로 대체하지 않는다.

2크기×matte/checker4구형과3mm볼의 실제 후보 정점이 사전 .001mm계약을통과했다. 원본 최대오차50.0797/44.1121/45.6793/32.5374mm(볼2.0336mm)에서 후보 .0000762/.0000762/.0000469/.0000469mm(볼 .00000293mm)로 감소했다. 이는 알려진 구면IR와mm검증점이 있는 작성된fixture의Float32정점 결과다. 모델이 반지름·후면·metric scale을 사진에서 복원한 성과로 해석하지 않는다. 실제제품 정확도는not-run이다.

11실제GLB의UV/Khronos와기존퇴화/non-manifold/self-intersection검사를통과했다. Openboundary는의도된부분표면이다. 원본→후보의sourcepixel/UV/index가 같고 원본배열·mask·calibration/quality/fingerprints가보존된다.0.1원본geometry/normal/UV/index회귀도동일하다.2Node/browser파일전체바이트동일,11Blender5.2.1재열기·재내보내기PASS. 선택볼1mm정점편집·재열기·복원에서UV/명명/계층/재질/sourceextras를보존했다. NativeJSON은GLB와함께보존한다.

PHOTO EVIDENCE→깊이검수(/?editor=depth)에서0.1무손실이전또는0.2JSON을불러온다. 확인한near/far camera-depthmm,허용오차,경계밴드pixels,독립CSV(x,y,depthMm)와자료유형을입력해경계계약을적용한다. 선언된IR구면checkbox로명시적인진단후보를검토한다. 후보/stride편집Undo/Redo·저장/재열기·torus비활성화를검증했다. 사용자선언은실측인증이아니다.

comparison.png와renders는동일fixeddatum10×/camera/light/1024²의clayfront/iso/wire와공통ROI다. 큰깊이돌출은감소했지만 픽셀/stride로잘린 부분표면 경계의앨리어싱이 남는다. 전체hemisphere·일반실무납품합격이아니다. 연속경계연산은다음범위이며현재원본/mask/UV/index보존조건을깨지않는다.

UNI_AI공식헤더models/chat200,gpt-6-sol1회3545tokens. 범위/NaN/fitanchor상쇄제안을검토후로컬코드와회귀검사로보강했다. API응답은제안이며실행은로컬이다. 원본사진/키외부전송·NPM의존성추가없음. 전문가·제조/BREP/CAD·일반사진정확도·automaticdelivery는미검증이다. quality:production의독립비교0/3부족실패는유지한다.

현재source92files647tests/check/build PASS. 게시scope는별도현재재검증한다. artifacts는outputs/depth-boundary-20261003의fixtures,*.depth.json,*.glb,evidence.json,node-browser.json,browser,blender,blender-edit,renders,verification.json이다. Source/outputSHA를영수증에연결한다. 원본Gitindex접근불가와무관한변경을보존하고별도clone의allowlist만게시한다.

현재 게시scope89files628tests/check/build/benchmark PASS,quality:production exit1(기존qualitygate통과,독립비교0/3부족). 볼후보는분리한부품의로컬datum을사용하며기존조립배치는원본project에보존된다. 공개증거는benchmarks/modeling-slices-20261003/depth-boundary에있다.


최초30분 이후에도 UI 선언 입력·보존 검사·최종 재검증을 진행하여 실제 작업은50분 이상으로 늘어났다. 기하/입력 예산과 합격 임계값은 변경하지 않았다. 마지막 원본과 후보는 모두 보존했다.

공개 증거 재실행: `npx vite-node scripts/depth-boundary-evidence.ts benchmarks/modeling-slices-20261003/depth-boundary`. 이 명령은 해당 폴더의 fixture와 함께 보존한 bearing.elements.json을 읽어 실제 GLB와 검증 보고서를 재생성한다. 실행은 증거 파일을 갱신하므로 작업 복사본에서 수행한다. 엔진 revision은 morphloom.depth-surface-engine/0.2이며 source SHA와 각 파일 SHA는 verification.json에 있다.
