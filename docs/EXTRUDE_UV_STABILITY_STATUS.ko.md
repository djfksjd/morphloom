# Extrude UV 안정성 수정

2026-10-02. 기존 기어의 Node/브라우저 UV6좌표 차이를 실제 파일에서 재현했다. Three ExtrudeGeometry의 abs(dy)<abs(dx) 축 선택이 대각선 edge의 double 연산 차이에 반응했다. 동일한 float32 정점을 생성하는 미세한 입력 차이에 대한 테스트가 수정 전 실패했다.

새 src/engine/extrude-uv.ts는 납품 float32 좌표로 측벽 축을 결정하고 exact tie는 Y로 통일한다. cap 투영과 Z 좌표, 기하 생성은 유지한다. assembly-compiler.ts의 기존 extrude에 UVGenerator를 연결했고 element renderer revision은0.4, UV revision은0.1이다. schema/AssemblyIR/job/component patch는 변경하지 않았다. 기존 flat projection과 의도된 UV overlap을 유지하며 atlas/texel density/normal map 납품 지원을 새로 주장하지 않는다. 현재 기어 측벽 UV18좌표가 기준선과 달라진다. 기존 UV 기반 수동 텍스처를 사용하는 프로젝트는 이 변경을 검토해야 한다.

기어3크기·베어링·베벨 extrude 총5개를 실제 브라우저에서 로딩하고 다시 GLB로 내보냈다. 모든 UV/POSITION/NORMAL/index accessor bytes와 mesh/PBR/hierarchy metadata가 Node 출력과 일치했다. 각 파일 glTF validator와 Blender5.2.1 LTS roundtrip PASS. Node 재실행5파일은 바이트가 같다. 변경 전 gear POSITION/NORMAL/재질과12576개 cap vertex UV는 보존됐고 베어링11메시 POSITION/NORMAL도 보존됐다. topology/치수 검사는 기존 threshold 그대로 통과했다.

명령: check/build/benchmark PASS, npm test80파일582테스트 PASS. quality:production FAIL은 기존 독립 비교 자료 부족이며 임계값을 낮추지 않았다. git status/diff는 macOS dataless index 때문에 blocked이다. 사용자 변경과 기존 실패 파일을 보존하고 커밋·push·배포하지 않았다. UNI_AI403 이후 completion not-run, 독립 전문가 평가 not-run이다.

추가 파일: tests/extrude-uv-stability.test.ts, scripts/extrude-uv-evidence.ts, scripts/compare-glb-attributes.py. 원본과 Node GLB는 outputs/extrude-uv-20261002/current, 실제 브라우저 파일은 browser, Blender 재열기는 blender, 현재 소스·파일 해시와 전체 검증은 verification.json이다. 변경 전 실패는 red-test.log와 red-comparison.json에 남겼다. 편집/내보내기 방법은 기존 elements/workspace UI와 같다.

지원 주장은 이 환경과5사례에 한정한다. 임의 DCC/모든 시스템에서의 결정론·UV atlas·제조 승인은 검증하지 않았다. 다음 우선순위는 기존 납품 검수 경로에서 UV 품질과 의도된 overlap 계약을 사용자에게 구체적으로 표시하는 것이다.
