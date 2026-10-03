# Blender benchmark 실행 격리 — 2026-10-04

397be3e의 repair CLI는 새 출력만 허용하지만 두 benchmark가 고정 delivery 경로를 재사용해 재실행이 실패했다. 기존 산출물을 둔 실제 Blender 실행으로 이 회귀를 재현했다. CLI의 원본 보존 정책은 유지하고, 두 benchmark가 실행마다 exclusive `blender-run-*` 폴더를 사용하도록 수정했다. 모든 raw/repaired GLB와 세부 영수증을 그곳에 보존한다. aggregate report0.1에 artifactDirectory를 추가했다.

aggregate report는 기존 갱신 동작을 유지하되 입력/manifest의 direct·symlink·hardlink alias를 거부한다. 최종 publication은 보호 경로를 다시 검사하고 임시 파일을 atomic rename한다. 다른 입력을 가리키는 symlink를 따라 쓰지 않는다. 실패·이전 실행 자료를 삭제하지 않는다.

```sh
MORPHLOOM_BLENDER_BINARY=/Applications/Blender.app/Contents/MacOS/Blender npm run benchmark:blender-cross-domain -- fixtures-dir new-roundtrip-report.json
MORPHLOOM_BLENDER_BINARY=/Applications/Blender.app/Contents/MacOS/Blender ./node_modules/.bin/vite-node scripts/blender-cross-domain-edit-benchmark.ts -- fixtures-dir new-edit-report.json
```

- 실제5-domain roundtrip와 edit 각각2회: 의미 보존 검사20 사례 PASS. 이전 실행·source·sentinel SHA 보존.
- 현재 테스트109 파일794 PASS, boundary5 PASS, check/benchmark/build PASS. 두 CLI와 helper의 strict 타입 검사도 로컬 기존 @types/node22.20.4(MIT)를 사용해 PASS. 저장소에는 Node 타입 선언이 없어 기본 check만으로 CLI 검증을 주장하지 않는다. 의존성 추가0.
- quality:gate/production FAIL. 기존 false 항목은 동일하며 cooling UV23 알림과 별도 앱/근거 부족은 해결하지 않았다.
- 반복 export 바이트 비교는 인체에서 FAIL. roundtrip은 TANGENT12 값, edit는 TANGENT6 값만 차이가 났다. JSON 구조는 같고 다른 accessor는 같다. 수치 차이로 PASS를 승격하지 않았다. 같은 raw GLB를 repair한 반복 결과는 byte exact PASS이므로 차이는 Blender raw export 경계부터 발생한다.

[계약](BENCHMARK_RUN_ISOLATION_CONTRACT.ko.md), [현재 코드·원본 SHA·환경·결과](../benchmarks/modeling-slices-20261004/benchmark-run-isolation/verification.json), [현재 실제4회 실행](../benchmarks/modeling-slices-20261004/benchmark-run-isolation/actual-runs.json), [인체 tangent 실패 진단](../benchmarks/modeling-slices-20261004/benchmark-run-isolation/human-repeat-accessors.json). 실제 파일은 outputs/benchmark-rerun-goal-20261004에 보존한다.

이번 구현은 재실행·산출물 보존 흐름을 해결했다. 전체 납품 완료가 아니다. 다음 한 작업은 기존 tangent 생성/검사 경로를 재사용해 인체 normal-mapped mesh의 Blender tangent 반복 차이를 해결하는 것이다.
