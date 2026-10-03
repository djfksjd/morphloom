# 요소 편집기 불러오기와 사용자 편집의 우선순위

2026-10-03, 기준 762e9ca / compiler0.39 / element-renderer0.10. 실제 File.text 완료를 지연시키고 볼 반경2.6mm를 Apply한 뒤 해제하면 오래된 JSON이3mm로 되돌린다. 이 실패를 먼저 보존했다.

성공 계약: 새 파일 선택, 편집 입력, Apply/Cancel·Undo/Redo 및 생성/선택 이후 이전 불러오기 완료·오류는 현재 상태·선택·history를 덮지 않는다. 현재 파일이 성공하면 원래의 source 파싱·selection 복원을 유지한다. unmount 결과는 폐기한다. 이전 handler가 새 file input을 비우지 않는다.

기존2MB 제한·엄격한 스키마·UV/topology/GLB 검사를 유지한다. IR/기하·재질 byte와 엔진 버전 변경 없음. 실제 UI에서 Apply, draft, Undo/Redo, 파일A/B 완료 역전, stale failure, 생성, unmount를 검사한다. 현재 베어링 비대상10부품 buffer/UV/PBR/변환 해시, 실제 GLB magic/Khronos/Blender 재열기를 재사용·새로 실행한다. CAD/실측 베어링/운동학/전문가 승인 아님.

기존 베어링 품질 계약(100k삼각형/1024px)을 유지한다. 이번 검수 checkpoint40분, UNI_AI 크레딧 부족 확인 후 Claude CLI tool-disabled 검토 최대2회; 새 의존성 없음.
