# 실제 축방향 기어 chamfer

2026-10-02. 좁은 기하·국부 편집·파일 경로 검수 완료. 전체 releaseAllowed/제조/CAD/전문가 승인은 아니다. 계약은 GEAR_CHAMFER_CONTRACT.ko.md, 현재 source/input/output SHA는 `outputs/gear-chamfer-20261002/verification.json`이다.

elements0.5 optional Part.axialChamferMm과 명시적 lossless migrateElementProjectToV5. 기본값 삽입/자동 업그레이드 없음. spur-gear만 지원하며0은 기존 버퍼 보존. 양수 최소0.001mm/최대min(.05module,.1width,.1radial root-wall), radial wall>=.25module; 실제 generated topology 실패도 적용 전에 거부한다. bevelOffset=-c, depth=width-2c, 1 segment로 cap에45°면을 만들고 중간 외곽·bore·치폭을 유지한다. Native UVscale0.4 편집도 유지한다.

공통 inspector: Enable chamfer editing(schema0.5)→gear 선택→Gear axial chamfer(mm)→Apply/Cancel. Undo/Redo와 JSON 저장·재열기. 최대치를 field/설명에 표시하며 실패 원인을 표시한다. Feature overlay는 실제 chamfer와 직벽 경계에 위치한다. 양의chamfer sector 추출은 지원하지 않아 버튼/engine을 명시적으로 거부한다. 원본 chamfer를 잃은 진단 파일을 몰래 내보내지 않는다.

새 대형 raw profile 허용 없이 기존 compiler를 재사용했다. 64치 파생 프로파일은 기존 AssemblyIR4096 array guard에 막히던 불일치가 있었다. validateSpurGear+gearExtrude가 만든 bounded8192 profile만 별도 engine-derived 경로로 처리한다. 자유 AssemblyIR4096/raw part extrude256점 한도는 유지한다.

실제 측정·검증:

- 수정 전 실패 테스트 후 `npm test`:83 files/595 tests PASS,44.81s. 6 크기/경계 chamfer 실제 정점·치폭·cap radius 차이·topology 검사, old-version/invalid/near-bore 거부, zero buffers 보존, raw4096 guard 보존. `npm run check`, `npm run build` PASS.
- `npx vite-node scripts/gear-chamfer-evidence.ts`:gear c.05mm/small c.01mm/large c.1mm/현재 zero baseline, 실제GLB topology/UV/개별tooth PASS. 기본16768tri/1.61MB geometry-buffer/Node generation 약55ms; M5 macOS/Node24.13.1, 환경·asset 규모 한정 측정. 다른 기기 성능 보장 아님.
- browser-verify/edit:4 current input/source/output SHA, actual exports와 Node accessor/PBR/계층 exact PASS. migration/cancel/apply/invalid .051mm atomic reject/undo/redo/save/reload PASS. 처음 fixed AX ref/companion download race로 harness가 실패했다. current ref 조회와 모든 companion 완료 barrier를 적용했으며 실패로그를 보존했다.
- mixed workspace:실제11 비대상 bearing GLB accessor position/normal/UV/index, 모든 PBR·이름·계층·변환 exact 보존. 원본 두 source seed/단위/IR 유지.
- Blender5.2.1 5파일 재열기 PASS. mixed gear를2mm 이동 후 재열기/추가 stability 파일에서 canonical face·UV·PBR·비대상·계층 보존 PASS. 메시편집 검수이며 parametric history는 source IR로 편집한다.
- 추가 Khronos 검사에서 기존 Blender scripts가 강제로 만든 unused zero tangents를 발견했다(gear2/mixed15오류). `blender/failures`의 실제 invalid mixed files와 validator report를 보존했다. source에 TANGENT 또는 material normalTexture가 있을 때만 export_tangents를 켜는 source-dependent shared policy를 구현했다. `python3 scripts/test_blender_export_policy.py`:1 test/5 cases PASS. 검사 기준/검사를 끄지 않았다. 재생성된7 actual Blender outputs:glTF errors0, independent parser PASS. normal texture/source tangent가 있을 때는 요구를 보존하며 그 경우의 광범위 tangent 품질 검수는 별도다.
- quality:production의 internal quality:gate PASS, 독립 비교0/3 부족 exit1 유지. fresh benchmark 영수증을 outputs에 저장하고 원래 파일을 바이트 기준으로 복원했다.

동일1024 clay/grazing 전후 `gear-before-full.png`/`gear-full.png`, 실제 tooth ROI `gear-before-close.png`/`gear-close.png`. 기존 전체 framing gate가 먼저 PASS해야 ROI를 렌더하며, ROI actual vertices 최소25px margin도 별도 통과했다. 주변 gear 잘림은 명시적인 지역검수이며 전체 framing 검사 대체가 아니다. 카메라/조명/배경/해상도 동일, DOF/beauty 후처리 없음.

주요 변경 파일: src/engine/gear-chamfer.ts, assembly-compiler.ts, element-project.ts, element-renderer.ts; src/ElementEditor.tsx, PartInspector.tsx; schemas/element-project-v5.schema.json, element-workspace.schema.json; tests/gear-chamfer.test.ts; scripts/gear-chamfer-evidence.ts, blender_export_policy.py, test_blender_export_policy.py, blender-glb-roundtrip.py, blender-component-edit-audit.py. 추가 의존성 없음.

납품 IR/GLB/UV report는 `outputs/gear-chamfer-20261002/browser/edited-gear.*`, mixed source/files는 workspace-before/after.*, Blender edit proof는 blender/workspace-edit.json. verification.json에 코드·입력·출력·이미지 해시가 있다.

미검증/지원 제한: manufacturing fit/root trochoid/strength, unique UV atlas·padding/mip·실제texel density, 인간 전문가 평가, chamfered diagnostic tooth cuts. mixed rotated datum의 기존 cross-runtime 마지막 matrix 자릿값 차이는 이번 actual mixed Node before/after 검수와 별개이며 아직 strict FAIL이다. UNI_AI last403/completion not-run, git status/diff dataless index blocked. push/commit/deploy 없음.

시간: 최초25분 반복 뒤 Blender unused tangent 결함을 진단해 후속10분 검증을 배정했다. 범위·검사 실패를 기록하고 실패를 숨기지 않았다. 다음 우선순위는 알려진 mixed datum의 cross-runtime matrix 차이다.

Goal 도구 기준 실제 총37분(보고/해시 기록 포함). 최초25분+후속10분 예산을 약2분 초과했으며 초과를 숨기지 않는다. 최종 구현/파일 검증은 완료했으며 다음 goal은 별도의20분 반복 계약으로 진행한다.
