# 원본/현재 파일 결합 UV 검수 — 현재 결과

2026-10-03 22:46 KST 착수. 30분 계약을 초과했다. 23:22 KST 기록 시 약36분이며, 손상 fixture 재검증과 기록이 포함된다. 코드 구현은 하나, 손상 fixture는 두 번 실행했다. UNI_AI402/Claude 주간 제한이 이전 실제 호출에서 확인되어 추가 호출0; 새 의존성0.

`inspectBoundReferenceUv(originalBytes,currentBytes)`는 실제 원본 SHA, BIN, JSON 의미, 허용된 월드 이동과 before-edit reference 내용을 검증한 뒤 소유한 검사 장면에만 원본 기하 문맥을 연결한다. 원본/현재 파일을 수정하거나 장면/IR을 반환하지 않는다. 기존 UV0.3,0.05/1e-10 임계값과 standalone reference-only 실패는 그대로다. receipt0.1은 새 독립 계약이며 기존 IR/job/patch 마이그레이션은 필요하지 않다. 잘못된 SHA·BIN·JSON·이동·버전·기어 파라미터·계층은 거부한다.

실제 기존 GLB8쌍의 현재 UV 검사 PASS, 기어24개 톱니 검사 PASS. 파일을 재생성하지 않았고 이전 Blender 증거를 이번8회 실행으로 세지 않았다. 새로운 손상 GLB에는 실제 UV accessor bytes만 수정했다. Blender0.2 이동 후24/294면이 손상된 tooth_0003 FAIL, 메시 전체 손상률0.286%≤5%이지만 criticalFeatures FAIL/CLI exit1. 첫 fixture12/294는5%미만이라 정상 통과했으며 제외 이유를 보존했다. 두 손상 fixture의 Blender 실행만 이번 단계의 새 DCC 실행이다.

현재 `npm test`: 게시본106파일770/원본109파일789 PASS, `npm run check`, `npm run build` PASS. 원본 사용자19테스트 보존. JSONSchema 실제8 receipts PASS. 변경 전후 이미지 없음: 형상·재질·렌더 변경이 아닌 파일 결합 검수 단계다. 전체 quality:gate/quality:production 이번 수정본 not-run; 기존 전역 FAIL을 해결했다고 주장하지 않는다.

사용: `npx vite-node scripts/bound-reference-uv-audit.ts original.glb translated.glb NEW-report.json`. 통과는 UV 범위이며 CAD/현재 editableIR/전문가/전체 납품 합격이 아니다. 원본 없이 검사하면 기존 BLOCKED. URI/required extension/skin/morph/animation/instance 비지원; 실제 texel density는 텍스처 없는 사례에서 not-run. UI 연결은 다음 단계. 현재 파일 SHA와 코드 SHA는 아래 archive manifest 및 verification에 기록했다.

로컬 실제 GLB·전체 보고서: `/Users/danny/Documents/morphloom/outputs/bound-reference-uv-20261003`. 게시 증거: `benchmarks/modeling-slices-20261003/bound-reference-uv/verification.json`. 연속 goal ACTIVE.
