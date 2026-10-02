# Element Part 표면 편집 검수

2026-10-02. renderer0.9 / source0.6. 깨끗한 제품 시각화의 authored roughness-only 슬라이스다. 실측 물성·제조·전문가 승인과 구분한다.

| 기능 | 구현 위치 | 확인 상태 | 제한과 사용자 영향 | 우선순위 |
|---|---|---|---|---|
| 기존 PBR·절차 표면 | surface-system.ts | 기존 생성기 재사용, 실제64² RGBA 검사 | 3개 metal finish의 roughness-only; scalar PBR 유지 | 구현 완료 |
| 사진 표면 | reference-surface.ts | 코드 감사, 이번 실행 제외 | 원자료 없는 물성 추정 금지 | 후속 |
| 국부 편집 | element-project/PartInspector/ElementEditor | 실제 UI cancel/apply/undo/redo/save/reload PASS | opt-in0.6; 잠긴 부품/미지원 채널 거부 | 구현 완료 |
| 납품 | element-renderer.ts | GLB·Blender 왕복 PASS | GLB는 baked mesh, JSON은 원본 | 구현 완료 |
| UV 검사 | 기존 uv-quality.ts | 기존 검사 재사용 | overlap/atlas/padding 미검증 유지 | 다음 |

변경 파일: src/engine/{surface-system,element-project,element-renderer}.ts, src/{PartInspector,ElementEditor}.tsx, schemas/{element-project-v6,element-workspace}.schema.json, tests/part-surface.test.ts, scripts/part-surface-evidence.ts. 새 의존성 없음. Node PNG는 이미 설치된 @napi-rs/canvas shim을 재사용한다. schema0.1..0.5는 surface를 받지 않으며 migrateElementProjectToV6는 기본값을 삽입하지 않는다. channels/finish/repeat 범위를 검증한다. Domain Pack 생성/API 버전0.6 지원은 선언하지 않는다.

npm run check/build PASS; npm test 85파일600테스트 PASS(47.81s). npm run quality:production exit1: 내장 quality gate 통과, 독립 비교 자료0/3 부족은 기존 FAIL 유지. benchmarks 기존 bytes를 조건부 복원하고 현재 영수증은 outputs/part-surface-20261002에 보관했다.

기어/작은기어/케이지/ball_0000의 actual position·normal·UV·index와 node 계층/변환, 비대상 PBR 보존 PASS. 선택 부품에서도 기본 색·roughness·metalness scalar 유지. Node 전후8파일+브라우저4파일+Blender 왕복4파일, 합계16GLB Khronos errors0 및 독립 parser read PASS. Blender 왕복64² pixels가 원본 RGBA와 일치하며 repeat8/8·repeat wrap 보존. 공유 texture는 cache 소유이고 한 scene dispose가 다른 scene pixels를 삭제하지 않는 테스트 PASS.

파일 검수 도구 초안의 metadata·stride·non-indexed·mesh 이름 가정 오류 로그도 보존했다. sourceSpec에는 의도한 재질 변경이 있으므로 계층/변환과 구분했으며 accessor stride를 읽고 node sourceId로 부품을 대응했다. 정점/비대상 재질 검사를 생략하지 않았다. 최종 근거는 file-verification.json이다.

동일 카메라1024 material 전체/close: gear-before-material-{full,close}.png ↔ gear-material-{full,close}.png. gear-roughness-close.png는 실제 roughness socket의 별도 emission 채널 진단이다. 전체 framing gate 후 tooth ROI margin25px 검사. 근거리 regular 줄무늬가 보이며 자연스러운 실측 금속 가공면을 보장하지 않는다. 평면 tile1.25mm·nominal8cycles/tile0.15625mm는 창작값이다. 볼 UVunits/m75.07..240.0·max anisotropy5.114로 평면 스케일을 곡면 전체에 일반화할 수 없다.

M5 macOS/Node24.13.1/Blender5.2.1 LTS. 대표16768tri/1609728geometry bytes, bearing43808tri/2476800bytes. 3recipe CPU147456bytes+approx GPU196608bytes=344064bytes로 계약 예산 이내. 기존 cache estimatedBytes는 GPU mip 근사만 계산하며 CPU+GPU라는 과거 주석과 차이가 있다. combined 계산을 별도 기록했고 기존 상한은 변경하지 않았다. 최대 texture 수의 실제 GPU residency는 미측정이다.

사용: /?editor=elements → JSON 열기 → Enable surface editing(schema0.6) → 부품 선택 → Roughness surface finish/repeat U/V → Apply. Cancel/Undo/Redo 가능. Save source JSON은 재편집 원본, Export project GLB + source JSON은 메시·원본·UV 보고서를 저장한다.

IR·GLB·pixels·현재 source/artifact SHA256: outputs/part-surface-20261002/verification.json, file-verification.json, roundtrip-texture-verification.json 및 current/, browser/, blender/. UI 증거는 browser-edit-final.log. UNI_AI models403으로 로컬 fallback, completion not-run/원자료 전송 없음. git status/diff는 기존 dataless index로 blocked이며 index 수정·commit·push·배포 없음.

미검증: normal/tangent/anisotropy 편집, 사진 투영, 실측/전문가 승인, atlas/padding/mip bleeding, 다른 DCC, 제조. 다음 우선순위는 실제 texture resolution·transform을 반영한 texel density 보고서다.
