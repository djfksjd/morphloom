# Opt-in native UV scale 검수

2026-10-02. 좁은 UV 편집 goal 완료. 전체 제작 플랫폼의 production 승인을 의미하지 않는다. 계약: [UV_SCALE_CONTRACT.ko.md](UV_SCALE_CONTRACT.ko.md). 현재 코드/입력/실제 파일 SHA256: `outputs/uv-scale-20261002/verification.json`.

실제 변경: elements0.4 optional part.uvScale (유한0.001..1000), 명시적 lossless migrateElementProjectToV4, matching finite UV 사전 검증/원자 적용. 기존0.1/0.2/0.3은 자동 변환하지 않는다. UV 필드가 있는 프로젝트의 구버전 downgrade는 거부한다. renderer0.6은 소유한 geometry의 UV만 변경한다. 반복 생성에 누적 배율을 적용하지 않는다.

공통 inspector에서 schema0.4 opt-in→선택 부품→Native UV scalar→Apply/Cancel; Undo/Redo와 JSON 저장/재열기. 1은 원래 native mapping으로 복원한다. Synthetic UV checker preview는64px/8 cells/tile, 검사용이다. 일반 GLB는 기존 PBR, Export checker diagnostic GLB는 별도 synthetic texture와 diagnosticAppearance를 담는다. workspace도 같은 inspector/source 스키마를 수용한다. Pack registry의 생성 계약은0.1/0.2/0.3 그대로이며 Pack/API0.4 지원을 선언하지 않았다.

실제 데이터 측정:

| 사례 | 기존 UV 퇴화 비율 | 선택 부품 scale100 이후 | 실제 제한 |
|---|---:|---:|---|
| 기본 gear |17.7719%|0%|native projection overlap 유지|
| 작은 gear |32.0137%|0%|같음|
| 큰 gear |4.80769%|0%|같음|
| bearing |0%|0%|한 볼 UV만 변경; 나머지 보존|
| beveled extrude |0%|0%|베벨 distortion 유지|

기어의 실제 UV units/m 범위는 약84.09..100.13이며 planar surface에서10mm tile/1.25mm checker cell이 관찰된다. 다른 spherical/lathe mapping에 이 물리 크기를 일반화하지 않는다. scale10/100/1000 probe에서 절대 UV area gate가 모두 통과했지만 scale100 선택은 checker 용도 기준이다. 1e-10/0.05, releaseAllowed, overlap/atlas 검사 기준을 바꾸지 않았다. UV 좌표의 확대는 특이값 비율(왜곡)이나 기존 겹침을 고치지 않는다.

검증 명령·결과:

- `npx vitest run tests/uv-scale.test.ts`: 수정 전 실패, 구현 후3 PASS. 구버전/범위/lock/downgrade/UV 없음·NaN 거부, 실제 모든 정점·UV·노멀·index·행렬/PBR·비대상 보존, history 복원.
- `npm test`:82 files /591 tests PASS,42.69s. 최종 lock/downgrade assertion 추가 후 focused3 PASS. `npm run check`, `npm run build`: PASS.
- `npx vite-node scripts/uv-scale-evidence.ts`:5 실제 GLB topology/UV/per-tooth PASS. `browser-verify.py`:5 actual export source/output SHA와 current receipt PASS.
- `browser-edit.py`: 실제 migration/Cancel/Apply/Undo/Redo/저장·재열기 PASS. `preservation.py`:5 이전/현재 GLB actual accessors 비교, 선택 UV×100만 변경; 다른 UV/position/normal/index/PBR/이름/변환/계층 보존. checker embedded PNG64/repeat 확인.
- `verify-files.py`:5 Node↔browser accessor/PBR/계층 exact PASS,8 Blender5.2.1 재열기 PASS. checker texture64x64 보존. GLB에서 원본 parametric 편집을 복원하는 것은 source IR 역할이며 Blender는 baked mesh 편집이다.
- `npm run quality:production`: 내장 quality:gate PASS; 독립 비교0/3 부족으로 exit1 유지. 이번 현재 benchmark 영수증은 outputs에 보관하고 원래 benchmark 파일을 바이트 기준으로 복원했다.

동일 camera/lighting1024 전후: `checker-before-neutral.png`, `checker-after-neutral.png`. 실제 checker 파일을 Blender로 렌더했다. 추가 regional close 시도는 기존 전체 프레임 margin0px 검사에서 FAIL; `checker-before-close.log/.png`와 `render-close.py`를 보존했다. 잘린 이미지를 통과 렌더로 표시하거나 framing threshold를 낮추지 않았다.

변경 파일: src/engine/part-uv.ts, uv-checker.ts, element-project.ts, element-renderer.ts; src/ElementEditor.tsx, PartInspector.tsx; schemas/element-project-v4.schema.json, element-workspace.schema.json; tests/uv-scale.test.ts; scripts/uv-scale-evidence.ts. 이 기록·계약·SDK·work state를 갱신했다. 추가 의존성 없음.

납품: `outputs/uv-scale-20261002/browser/edited-gear.elements.json`, `edited-gear.glb`, `edited-gear.uv.json`. checker-before/after GLB는 진단용 별도 파일. verification.json에서 모든 파일 해시를 확인한다.

미검증: unique atlas/padding/mip bleeding/cross-mesh shared texture, actual production texel density, 제조·맞물림·강도, 인간 전문가 검수. 기존 mixed rotated datum matrix 마지막 자릿값 cross-runtime 차이는 이 범위 밖이며 이전 strict FAIL 유지. UNI_AI403/완성 API not-run, git index dataless status/diff blocked. 사용자 변경을 정리하거나 push하지 않았다.
