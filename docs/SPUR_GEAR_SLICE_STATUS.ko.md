# Spur gear 검수 기록

2026-10-02. 기준 HEAD a200aa4593aa14a9f0348b014962d144d119c741. 사용자 변경을 보존했고 커밋·push·배포하지 않았다. UNI_AI 모델 조회 HTTP403, completion not-run 이후 로컬에서 구현·검증했다.

## 구현과 파일

전위0 외접 직선 기어의 인벌류트 flank, 실제 관통 bore와 치폭을 선언형 spur-gear로 생성한다. module/잇수/압력각/치폭/bore/PBR과 tooth별 addendum multiplier0.9–1.1을 공통 inspector에서 적용·취소·Undo/Redo한다. 연결 tooth ID별 진단 sector를 독립 GLB로 추출한다. 실제 분리 부품을 뜻하지 않는다. 원본 JSON이 절차 편집 원본이며 GLB는 baked mesh다.

- 생성/Pack: src/engine/spur-gear.ts, gear-pack.ts
- 기존 경로 확장: part-geometry.ts, element-project.ts, element-domain-packs.ts, element-renderer.ts
- UI: src/PartInspector.tsx, ElementEditor.tsx, WorkspaceEditor.tsx
- schema: schemas/element-project-v3.schema.json, element-workspace.schema.json
- 검증: tests/spur-gear.test.ts, scripts/spur-gear-evidence.ts

elements0.3에서 새 연산을 허용하고 명시적 migrateElementProjectToV3를 제공한다. 기존0.1/0.2와 AssemblyIR/job/component patch는 유지한다. 미지원 필드·fractional teeth·undercut 위험·bore·feature ID·override·capability 오류를 거부한다. 기존 threshold는 낮추지 않았다.

## 측정과 실제 검수

대표 m1/z24/20deg/치폭8mm/bore6mm: pitch24mm, base22.5526229mm, addendum26mm, root21.5mm. 생성 정점·raycast 관통·topology·pitch-circle 치두께를 검사했다. 해석적 극값으로 계산한 flank chord 최대 오차0.0005217764mm는 사전 계약0.005mm 이하이다. m0.2/z18 및 m2/z40/25deg에서도 치수·곡선 오차·10만삼각형 예산을 통과했다. 대표8384삼각형, 텍스처0, 새 의존성0이다.

초기 cap 퇴화 삼각형2개는 실패로 보존했다. 두 번 실패 후 과도한 bore 분할의 sliver를 진단하고 물리 sag0.002mm 기반 분할로 수정했다. topology 검사는 유지했다.

브라우저에서 tooth_0003 수정·취소·Undo/Redo, module1→1.1mm, roughness0.4, 저장/재열기, 실제 tooth/전체 GLB 내보내기를 확인했다. 비대상 tooth contour와 혼합 workspace의11개 베어링 메시 geometry/UV/normal/index/PBR/계층 fingerprint를 보존했다. Blender5.2.1 LTS에서 기어만2mm 이동한 뒤 두 번 재열고11개 비대상 메시 보존을 확인했다. 선택 tooth와 UI 내보내기 파일도 Blender roundtrip/glTF validator를 통과했다.

npm run check, npm test(78파일579테스트), npm run build, npm run benchmark PASS. quality:production FAIL: 내부 gate PASS지만 독립 비교 사례0/3이다. git status/diff는 macOS dataless index 때문에 blocked이며 인덱스를 재작성하지 않았다.

## 증거와 사용

outputs/spur-gear-20261002/replay/evidence.json은 현재 소스 해시와 출력 해시를 연결한다. current의4개 GLB는 replay와 바이트가 같다. verification.json은 실행 로그·파일 해시를 묶는다. 전후 원본은 current/gear-before.elements.json와 gear-after.elements.json, 납품은 gear-before.glb, gear-after.glb, tooth.glb, mixed.glb다. 실제 앱 검수는 current/blender-edit.json, tooth-blender.json, browser-verification.json, ui-gear-blender.json, ui-tooth-blender.json이다.

같은1024해상도·카메라·조명의 before-clay.png/after-clay.png와 wire.png/tooth-front.png를 확인했다. tooth-close.png는 framing 실패 기록이며 합격 이미지로 사용하지 않는다.

/?editor=elements 또는 workspace에서 mechanical.spur-gear.visual을 생성하고 부품과 연결 feature를 선택해 Apply한다. JSON 저장은 원본, Export GLB는 baked mesh, diagnostic export는 검사용 tooth sector다.

창작 기어이며 공식 KHK 치수 관계를 적용했으나 실제 제품 복원이나 제조 표준 완전 준수를 주장하지 않는다. 치근은 radial connector 근사다. trochoid/필렛/백래시/강도/맞물림 dynamics, 신규 bevel, texture/normal-map 납품, 독립 전문가 평가는 미검증이다. feature dropdown만 지원하며 화면 클릭 선택은 다음 우선순위다.
