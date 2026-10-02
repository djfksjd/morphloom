# 복합 프로젝트 현재 검수 기록

2026-10-02. `/?editor=workspace`에서 생물 요소와 창작 베어링을 함께 표시·편집·저장·납품한다. 기존 ElementEditor와 부품 inspector를 재사용하며 native source IR을 합치거나 ID/seed를 재작성하지 않는다. `morphloom.workspace/0.1`은 새 container이고 기존 요소 IR의 버전은 유지한다. 단위·좌표가 다른 입력, 중복 instance ID, 미지원 source schema·capability는 거부한다. 저장된 Pack ID/capability는 provenance이며 설치된 provider의 현재 검증을 인증하지 않는다.

## 구현 위치

- `src/engine/element-workspace.ts`: strict wrapper 검증, capability 요청 생성, atomic append·부품 edit, parse/serialize, scoped 표시·GLB scene, aggregate 자원 제한과 실패 시 dispose.
- `src/WorkspaceEditor.tsx`: Pack 입력·명시적 datum·자산 선택·원본 보존·저장/업로드·전체 GLB/JSON 다운로드, 오래된 export/load 차단.
- `src/ElementEditor.tsx`, `src/viewer-main.tsx`: 기존 편집기를 재사용하는 workspace 경로, datum 하이라이트, viewport asset picking.
- `schemas/element-workspace.schema.json`, `tests/element-workspace.test.ts`: container 구조와 source seed/분포/수정 보존·충돌·provider 실패·납품 이름 검사.
- `scripts/workspace-slice-evidence.ts`: 생성된 현재 GLB/원본과 source SHA-256 영수증.
- `scripts/repair-glb-interchange.ts`, `tests/gltf-interchange-repair.test.ts`: 기존 repair가 untextured UV를 지우던 결함을 실패 테스트로 재현하고 `keepAttributes: true`로 수정. 불필요한 tangent 제거는 유지한다.

## 실제 검증

측정 환경 Node 24.13.1/macOS arm64/Apple M5, Blender 5.2.1 LTS. 독립 seed17 fur와 seed91 bearing, mm position -100/+100의 대표 프로젝트는 62개의 baked meshes·73,984삼각형·3,038,400 geometry-buffer bytes이며 한 번 측정한 export scene build는 약 83ms다. 기존 기관·털의 조형 품질 개선을 주장하지 않는다. 두 분야를 담는 container와 원본 보존 검증이다.

현재 전체 테스트는 76파일·569테스트 PASS, check/build PASS다. 기존 benchmark PASS. `quality:production`은 내부 gate PASS 이후 독립 비교 사례 부족으로 FAIL(exit 1)이며 releaseAllowed를 약화시키지 않았다. UNI_AI는 앞선 `/models/` HTTP403 때문에 completion not-run이다. 독립 인간 전문가 검수는 not-run이다.

실제 빌드 preview에서 append→볼 반경3→2.8→Undo3→Redo2.8→다른 asset 선택→save/reopen을 확인했다. 각 다운로드 JSON에서 다른 asset source와 resolved distribution을 보존했다. 중복 asset append는 오류를 표시하고 원본을 변경하지 않았다. 기록은 `outputs/workspace-slice-20261002/browser-verification.json`이다. macOS가 tsconfig 변경 이벤트를 반복 발생시켜 dev HMR 검수는 초기화됐고, immutable preview(4176)에서 다시 실행했다.

엔진과 브라우저의 실제 GLB는 Khronos 오류/경고0이다. Blender에서 `bearing::ball_0000`을 X2mm 이동하고 두 차례 export/reopen해 나머지61 meshes의 canonical face/UV/PBR/명명/계층 보존을 확인했다. Blender export의 사용하지 않는 tangent에서 vector-length 오류13건이 나타났다. 기존 repair가 12개 unused tangent accessor를 제거하도록 재사용했고, UV pruning 결함을 수정한 최종 repair 파일은 Khronos PASS다. NORMAL/UV/position 등 **모든 non-tangent attribute 배열, indices, PBR factors, node 이름/계층/local transforms가 repair 전후 정확히 같다**. surface512 비교도 PASS이며 수정 파일을 Blender에서 다시 재열었다. 초기 실패 파일/로그는 보존한다.

## 결과물

기준 디렉터리는 `outputs/workspace-slice-20261002/`다.

| 결과 | 위치 |
|---|---|
| 편집 원본·생성 GLB·현재 소스/입출력 해시 | `current/evidence.json`, `current/before.workspace.json`, `current/after.workspace.json`, `current/after.glb` |
| Blender 실제 개별 수정 | `current/blender-edit.json` |
| 실제 브라우저 GLB·재열기 | `preview-browser.glb`, `preview-browser-blender.json` |
| UV 보존 repair·Khronos·Blender | `preview-browser-repaired.glb`, `repair.json`, `repair-preservation.json`, `repaired-gltf.log`, `repaired-blender.json` |
| 중립 clay·실제 UI | `clay.png`, `clay.json`, `browser-full.png` |
| 전체 검사·source/output 지문 | `verification.json` |

기어·구속·cross-asset collision, 다른 단위 변환, NURBS/BREP/volume/terrain/time/USD/STEP/IFC는 미지원이다. GLB는 baked mesh이며 절차 의미 복원은 companion workspace JSON으로 한다. 텍스처가 없는 사례이므로 texel density/atlas/normal-map 납품은 미검증이다. Workspace isolate/explode는 비활성화 이유를 표시한다. 자산을 전환하면 해당 편집기의 local undo 세션을 새로 시작한다. 저장된 source 수정은 유지한다. 후속 workspace 전체 undo의 최신 검수는 [history 기록](WORKSPACE_HISTORY_STATUS.ko.md)을 따른다.

최종 git status/diff는 macOS dataless `.git/index` 때문에 blocked다. 인덱스 재작성·삭제나 사용자 변경 복구는 하지 않았다. 생성 benchmark 영수증은 outputs에 보관하며 HEAD 접근 가능한 파일만 자기 생성 변경을 정리한다. 커밋·push·배포 없음.
