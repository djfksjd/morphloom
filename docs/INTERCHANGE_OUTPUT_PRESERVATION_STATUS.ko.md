# Interchange repair 원본 보존 — 2026-10-04

입력 GLB와 동일한 receipt 경로를 지정하면 원본을 JSON으로 덮어쓰던 결함을 수정했다. 기존 output/receipt와 symlink alias도 거부하고, parent의 canonical 경로로 출력 중복을 확인한다. 최종 기록은 exclusive open이며 늦은 실패 시 이 실행이 만든 파일만 되돌린다. 다른 프로세스가 대체한 inode의 파일은 삭제하지 않는다.

수정 전 신규7 테스트 FAIL, 수정 후 경계·경합 포함11 PASS. 전체108 파일789 테스트 PASS, check/benchmark/build PASS. 실제 cooling GLB에서 Blender export→현재 CLI repair→Khronos 및 독립 parser→Blender 재열기를 실행했다. 입력 alias 거부 뒤 원본 SHA가 유지되고 부분 출력이 없었다. UV·normal·광학 PBR recovery의 기존 성공 테스트도 유지했다. 동일한 실제 raw GLB를 수정 전후 CLI로 처리한 최종 GLB SHA도 완전히 일치했다.

```sh
npm run gltf:repair -- input.glb new-delivery.glb new-receipt.json
# 선택적 네 번째 인자는 검증된 원본 material source.glb
```

기존 출력 경로 재사용은 명시적 실패다. 다시 실행할 때 새 출력 경로를 선택한다. IR 스키마와 repair receipt0.1은 유지한다. 입력이나 사용자 출력은 덮어쓰지 않는다. API 호출0, 임계값 변경0, 테스트 skip0.

[계약](INTERCHANGE_OUTPUT_PRESERVATION_CONTRACT.ko.md), [코드·테스트 SHA와 실행 결과](../benchmarks/modeling-slices-20261004/interchange-output-preservation/verification.json), [실제 입력·출력 SHA와 Blender 재열기](../benchmarks/modeling-slices-20261004/interchange-output-preservation/actual-files.json).

전체 quality:gate/production은 여전히 FAIL이며 competitive 보고서의 false 항목은 직전 단계와 동일하다. cooling의 미참조 TEXCOORD_0 23건은 현재 source부터 존재하며 raw 재질의 편집 UV다. 이를 삭제하거나 dummy texture로 숨기지 않았다. 재열기의 geometry/image/skinning 의미 보존은 기본 Blender normal의 오차 해결을 뜻하지 않는다. 다음 작업은 이 23개 raw 부품의 기존 표면 계약과 납품 요구를 분리하여 검토하는 것이다.
