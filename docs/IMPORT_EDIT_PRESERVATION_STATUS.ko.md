# 단일·복합 프로젝트의 지연 불러오기와 편집 보존

2026-10-03, 기준762e9ca 이후. compiler0.39 / element-renderer0.10 / 기존 IR·workspace 스키마 유지. `ElementEditor.tsx`, `WorkspaceEditor.tsx`의 기존 load ticket을 사용자 입력·선택·Apply/Cancel·history·생성·하위 source 변경과 unmount에서 무효화한다. 실제 파일 객체 확보 뒤 input을 즉시 비워 재선택을 허용한다. 이미 시작된 File.text 자체를 중단한다고 주장하지 않는다.

두 실제 실패: 읽기 대기 중2.6mm Apply 후 오래된 source JSON 또는 부모 workspace JSON이 볼 반경을3mm로 덮어썼다. 수정 뒤 요소10·Workspace11개 native UI 사례가 통과했다. draft·Cancel·Undo/Redo·완료 순서 역전·stale error·선택·새 Pack/asset·저장 재열기를 포함한다. 별도 베어링 native controls10사례로 추출 X45mm→복원 X15mm, shape/PBR·비대상10부품을 확인했다. 테스트 경계는 실제 File.text 결과의 완료 순서만 제어하며 React state를 주입하지 않는다. unmount 소유권 코드는 검토했으나 별도 native unmount completion 시나리오는 not-run이다.

반경·UV·법선·PBR/world transform/부모를 포함한 비대상10개 mesh hash를 기존 bearing evidence로 다시 검사했다. 닫힌 기하의 양의 체적 검사도 기존3개 크기 회귀에 추가했다. 형상은 그대로이며 면을 임의로 뒤집거나 compiler 버전을 올리지 않았다.

실제 UI 선택 GLB SHA256 `41565828b15f1504f1aa4aace8873dea31cbd8545067221365e5a6bd6471524d`: Blender5.2.1 LTS에서 mesh1개/ball_0000/parent bearing_assembly/UV1개, 직경5.5999998mm, 양의 체적91.469194mm³, 중심 X14.9999997mm, roughness0.32/metalness0.94를 실제로 확인했다. 볼 수정·export·두 차례 재열기와 Khronos를 통과했다. 전체와 두 다른 크기 engine 검사도 재실행했다.

혼합 UI GLB SHA256 `5e49d2086635dbf1b49e8d07e817d056af557292f118b469ca77a8ab7b251724`: fur와 bearing을 한 workspace에서 저장·재열기하고 실제 GLB+JSON+UV 보고서를 받았다. Blender에서 bearing::ball_0000만2mm 이동·두 차례 재열기; 비대상61mesh의 최대 중심 오차0.00000373mm/크기 오차0.00000746mm를 확인했다. source seed/ID/datum·이름·계층·UV·PBR은 기존 검사로 비교했다. GLB는 baked mesh이고 source JSON은 절차 편집 재개용이다. DCC 정점 편집을 자동으로 IR 파라미터에 역변환한다고 주장하지 않는다.

현재 최종본: npm test 공개711/원본730 PASS, 양쪽 check/build PASS, benchmark PASS. 전체 npm quality:gate FAIL: 내부 quality 지표100%·필수 proof4/4는 통과하지만 기존 냉각 파일의 사용되지 않는 TEXCOORD_0 정보23개 때문에 competitive의 엄격한 infos0 조건이 실패한다. quality:production도 여기서 중단된다. 별도 dominance 실행도 독립 동일입력 비교0/3으로 FAIL이다. 이전 architectural status의 전체 gate PASS 표기를 정정했고 raw 실패·benchmark threshold는 유지했다. 무텍스처 material의 UV를 버리거나 dummy texture를 추가하여 통과시키지 않는다.

렌더는 실제 Blender1024px 동일 camera/studio의 전체 clay·볼 근접 사광 전후다. **볼3→2.8mm 사용자 편집 예시**이며 이번 async UI 수정이 생성 형상을 개선했다는 이미지가 아니다. 원자료 없는 창작이므로 제조 clearance·물성·실측/운동학·인간 전문가/CAD 승인, atlas/padding/tangent normal-map 납품은 미검증이다.

UNI_AI gpt-6-astra 요청의 크레딧 부족이 실제 확인되어 Claude CLI로 전환했다. Opus5.5 첫 read-only 검토는 성공했고 둘째는 주간 limit으로 blocked였다. tool-disabled/public context 제한을 지켰으며 제안과 실행 증거를 구분한다. 후속 Workspace API 검토는 blocked이고 로컬 React/hooks/resource 검토 및 실제 검증을 수행했다.

증거: `benchmarks/modeling-slices-20261003/import-edit-preservation/verification.json`, 원본 local outputs `outputs/bearing-orientation-20261003`와 `outputs/workspace-import-20261003`. 최초 잘못 저장한 JSON-as-GLB와 harness 오류는 실패로 보존했다. 최종 다운로드는 glTF magic과 companion JSON·UV 검사로 확인한다. 원본 iCloud git index는 수정하지 않고 publishing clone에서 정상 git diff/check/commit/push한다.

사용: `viewer.html?editor=elements` 또는 `viewer.html?editor=workspace`. 안정 ID를 선택→수치/PBR Apply→Undo/Redo·Save JSON/Load JSON. Workspace는 기존 자산을 선택하거나 서로 다른 Pack을 Append한다. Export 버튼은 GLB와 source JSON·UV 보고서를 함께 내린다. 브라우저의 여러 다운로드를 허용해야 세 파일을 받는다.

다음: 늦은 export 결과·오류의 source/선택 소유권을 실제로 재현한 뒤 최소 수정한다. 무텍스처 UV와 infos0 조건의 충돌, 독립 비교 부족은 별도 차단 항목이다. 전체 goal은 계속 active이며 완벽한3D 생성/모든 분야 납품 완료를 선언하지 않는다.
