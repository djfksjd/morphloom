# Workspace 전체 Undo/Redo 검수

2026-10-02. `morphloom.workspace-engine/0.2`의 `WorkspaceHistory`와 전체 Undo/Redo UI를 구현했다. Container schema0.1과 기존 요소 local history는 유지한다. Serialize 결과도 실제2MB 한도를 검사한다. Snapshot은 검증 후 commit하며 최대30개·합계8MiB UTF-8 bytes로 제한한다. 같은 상태는 무시하고 undo 뒤 새 commit은 redo branch를 제거한다. current/undo/redo는 참조를 공유하지 않는다.

변경 파일: `src/engine/element-workspace.ts`, `src/WorkspaceEditor.tsx`, `tests/workspace-history.test.ts`. 사전 계약은 `WORKSPACE_HISTORY_CONTRACT.ko.md`다. 자산 추가·source 편집을 global history에 기록하며 전체 undo/redo 시 source editor를 snapshot으로 초기화한다. Aggregate/serialization 거부 시 마지막 workspace와 source editor를 복구한다. JSON은 현재 편집 상태를 저장하고 load는 새 history를 시작한다. Session history의 disk persistence는 미지원이다.

최신 전체77파일·574테스트 PASS, check/build/benchmark PASS. History 테스트5개가 cross-asset 편집, redo branching, 참조 격리, failed commit 보존,30-state와 별도의 byte-budget eviction을 검사한다. `quality:production`은 내부 gate PASS 이후 독립 비교 부족으로 exit1이며 임계값을 변경하지 않았다.

실제 빌드 preview에서 asset append→볼 반경3→2.8→다른 asset body X0→5를 수정했다. Global Undo3회로 body→볼→append를 정확히 되돌리고 Redo3회로 전체 상태를 복구했다. 각 단계 실제 다운로드 JSON 전체를 비교해 비대상 source·seed·ID·datum 보존을 확인했다. 저장/재열기 뒤 편집 상태는 동일하고 history는1상태로 초기화됐다. 단독으로 유효한4970요소 source를 기존50요소 workspace에 입력해 aggregate-budget 오류를 실제 관측했다. 편집기가 원래 베어링으로 복구됐으며 저장 workspace와 history1상태가 유지됐다.

증거 기준 디렉터리는 `outputs/workspace-history-20261002/`다. `verification.json`에 source·출력 SHA-256과 명령 결과가 있다. `browser-verification.json`, `final/evidence.json`, `ui-blender.json`, `ui-repair.json`은 새 입력/출력 검수다. `ui-initial/append/ball/animal/undo-animal/undo-ball/undo-append/redo-all/reopened/after-rejection.json`은 실제 다운로드 상태다. 실제 `ui.glb`를 Khronos/Blender에서 확인했고 사용하지 않는 tangent는 기존 UV-preserving repair로 제거했다. `ui-full.png`는 UI다. 새 생성 GLB의 Blender 볼 개별 수정도 다시 실행했다. 이전 repair의 UV 결함 진단·정확한 attribute/PBR/geometry 보존은 `WORKSPACE_SLICE_STATUS.ko.md`를 참고한다.

Workspace datum 후속 편집, cross-asset isolate/explode, 제조·운동학·충돌 승인·독립 전문가 검수는 미지원/미검증이다. UNI_AI completion은 models HTTP403으로 not-run, git 최종 status/diff는 macOS dataless index로 blocked다. 인덱스는 재작성하지 않았다. 자기 생성 benchmark 영수증만 archive 후 HEAD로 복구했다. 커밋·push·배포 없음.
