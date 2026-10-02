# Deterministic datum rotation 검수

2026-10-02. 알려진 mixed workspace cross-runtime matrix strict FAIL을 이번 실제 baseline으로 재현하고 해결했다. [계약](DATUM_ROTATION_CONTRACT.ko.md), current 코드/원본/GLB/보고서 hash는 `outputs/datum-rotation-20261002/verification.json`.

Math.sin/cos 마지막1ulp 차이를 bounded half-angle sin21/cos20 Horner 계산과 normalized quaternion XYZ로 대체했다. Source Euler 계약±2π는 그대로다. helper는 existing resolved 배치용±4π 각도만 받고 half-angle±2π를 reduction/fold한다. 원본 workspace0.1과 elements0.1..0.5는 자동 변경하지 않는다. workspace-engine0.3/renderer0.8/deterministic-rotation0.1로 계산 변경을 기록한다. static part/element 배치와 workspace datum에 적용했다. Character rig, animation, 전체 generated resolver의 결정론 인증은 아니다.

검증:

- current baseline:matrix4성분2.78e-17 차이 strict FAIL, 실제 파일/비교기 보존. 기존 검사기를 변경하거나 epsilon 비교로 바꾸지 않았다.
- `npm test`:84 files/597 tests PASS,45.01s. `deterministic-rotation.test.ts`:2테스트,4097 signed/fold trig값과unit quaternion·matrix·world-point 오차/범위·입력 보존. check/build PASS.
- `npx vite-node scripts/datum-rotation-evidence.ts`:mixed/signed/boundary/compound4source/GLB. 음수회전,±2π,part+datum 복합회전,1km offset 사례. 현재 source IR 바이트 보존, 모든 local position/normal/UV/index/PBR bytes 보존.
- actual browser4파일:기존 strict raw accessor/PBR/모든node/scene/matrix 비교 PASS. 추가 확인에서 완전한 GLB 파일바이트도4사례 모두 Node와 동일했다. Node 재실행4파일도바이트 동일.
- 각 사례 actual vertex123240개 세계좌표를 native 이전 계산과 비교했다. 최대차이2.03e-14mm/matrix7.77e-16, 사전1e-5mm/1e-12 예산 이하. 이는 테스트 입력/표시 파생에 대한 수치 측정이며 제조/측량정밀도 주장이 아니다.
- browser mixed:선택 gear PBRroughness.4 변경, Undo/Redo·workspace 저장/재열기·수정후 실제 export. geometry fingerprint·datum·비대상 source 보존 PASS. active-source summary와 full-export source/output SHA를 구분한다.
- Blender5.2.1:4원본+수정1파일 재열기 PASS,5 outputs Khronos errors0/independent parser PASS. 먼좌표의 GPU/DCC 일반 정확도 보증이 아니다.
- `npm run quality:production`:internal quality:gate PASS,독립 비교0/3 부족 exit1 유지. fresh receipts를 outputs에 저장하고 원래 benchmark 파일을 바이트 기준으로 복원했다.

변경 파일: src/engine/deterministic-rotation.ts, element-workspace.ts, element-renderer.ts; tests/deterministic-rotation.test.ts; scripts/datum-rotation-evidence.ts. 새 의존성/스키마 필드 없음. 기존 IR/seed/ID/단위/좌표계/UV/PBR/계층을 보존한다.

원본·납품: `current/workspace.json`, `browser/workspace/workspace.glb`, 같은 폴더workspace.uv.json; edited file은 browser/edited/workspace.glb, 저장원본saved/workspace.json. Node/browser 기타3케이스, Blender파일,world-measurement와whole-byte-equality는 outputs/datum-rotation-20261002에 있다. UI 검수캡처ui-local-edit.png.

미검증: 모든JS엔진/hardware,전체 rig/time/generated resolver,실제GIS 정밀도/제조/전문가 판단,atlas/독립production비교. 다른 모든회전커널도 해결했다고 주장하지 않는다. UNI_AI403/completion not-run, git index dataless로status/diff blocked. 사용자 변경 정리/reset/commit/push/deploy 없음.

이번 goal은 코드·파일 검수 완료다. 다음 우선순위는 기존 surface-system을 재사용한 Element Part의 실제 표면 재질 편집·GLB 보존 경로 감사이며 중복 새 재질 엔진부터 만들지 않는다.

Goal 도구 실제 총35분(분석·검증·보고 포함)으로 최초20분 반복 예산을 초과했다. 구현/실제파일은 검증됐지만 이 예산 준수를 성공으로 보고하지 않는다. 다음 goal은 단계별시간을 더 자주 확인하고 총 감사·검증 예산을 작업 전 분리해 기록한다.
