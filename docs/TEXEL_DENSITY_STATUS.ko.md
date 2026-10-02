# Texel density 검수

2026-10-02. UV quality revision0.2. 기존 world-space triangle Jacobian에 실제 metallic-roughness image 해상도와 UV texture matrix를 적용해 singular-value 범위를 texels/mm로 측정한다. 기존 UV integrity·per-feature 실패 기준·releaseAllowed는 변경하지 않았다. IR·geometry·PBR 연산은 추가하지 않았다.

변경: src/engine/texel-density.ts, src/engine/uv-quality.ts, src/ElementEditor.tsx, tests/texel-density.test.ts. report0.2는 기존 UV core fields를 유지하며 mesh/triangle/feature density, 실제 imageSize·matrix·wrapModes와 측정 누락을 추가한다. receipt0.1의 source/output SHA envelope는 유지한다. 새 status 값 measured/partial은 해당 report revision을 이해하는 소비자가 처리해야 하며 예전 보고서를 재검수 결과로 취급하지 않는다. 원본 IR 마이그레이션은 필요 없다.

지원: 단일 static material·UV0·실제 이미지 해상도≤16384·finite invertible texture transform. 같은 이미지/채널/transform을 공유하는 loader clone을 인식한다. 별도 roughness/metalness map, 여러 material group, 다른 UV channel, 미로드 이미지, singular transform, skinned/instanced는 not-run이다. invalid/singular triangle은 누락 수에 남고 해당 connected feature에서도 표시된다. wrapping/clamping 이전 local sampling density이며 반복이 고유 이미지 해상도를 늘리지 않는다. clamp 경계 밖 unique coverage/atlas/padding/mip bleeding 승인은 하지 않는다.

실제4browser GLB receipt의 per-mesh/feature density가 Node 원본과 정확히 일치했다. 기어25.5905–51.3223, 작은기어25.5906–51.3214, 케이지37.0815–51.2158, ball_0000 27.1818–277.9232texels/mm. 평균으로 숨기지 않는 국부 범위이며 특정 품질 임계값을 새로 발명하지 않았다. native parent 이름은 GLTFLoader에서 정리되므로 geometry hash는 다를 수 있다; scoped component ID/density를 정확 비교했다. 4 GLB는 이전 표면 검수 파일과 전체 bytes 동일함을 새로 검사했고 현재 파일의 SHA를 기록했다.

알려진 1m 삼각형·비정사각64x128·repeat2/3·world scale2/1·texture 회전 사례, 미지원 UV, 실제 loader식 clone, 특정 tooth singular UV 회귀 PASS. 최신 npm test86파일604테스트 PASS(76.78s), check/build PASS. quality:production의 독립 비교 부족 기존 FAIL은 유지한다. 실행별 최신 영수증은 outputs/texel-density-20261002/commands.json과 로그에 있다.

actual4GLB Khronos errors0, Blender5.2.1 LTS에서 현재4파일 새로 열어 pixels 확인 PASS. 원본·납품 SHA/실제 map 측정: comparison.json, standard-validation.json, blender/*-pixels.json, browser/*.uv.json, verification.json. UI는 UV quality를 열어 mesh별 texels/mm·status·누락, connected tooth 펼침에서 feature별 density/누락을 본다. Save current UV summary 및 GLB 내보내기가 현재 측정을 저장한다. 이미지가 없는 부품은 계속 not-run이다.

UNI_AI models403/completion not-run, 외부 원자료 전송 없음. git status/diff는 dataless index로 blocked; index 수정·commit·push·배포 없음. 독립 인간 전문가 승인, 실측 금속, 다른 DCC·제조 검증은 not-run. 다음 우선순위는 표면 패턴의 물리 스케일 편차를 사용자가 예측하고 수정하는 좁은 흐름이며 자동 UV 재작성은 별도 계약이 필요하다.
