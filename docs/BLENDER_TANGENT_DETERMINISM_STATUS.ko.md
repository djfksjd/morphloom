# Blender tangent 반복 결정성 — 현재 결과

선택적 local Blender benchmark의 인체 TANGENT 반복 차이를 single-thread 실행 profile로 해결했다. 기본 실행에서는 같은 mesh 입력의 tangent가 최대1.788139343e-7 달랐고, importer/exporter를 거친 최종 파일에서도12/6 값이 달랐다. 원본 source나 IR 연산의 차이로 보고하지 않았다.

동일 빌드의 [MikkTSpace 구현](https://raw.githubusercontent.com/blender/blender/9e2066aef7ef/intern/mikktspace/mikktspace.hh)은 face>10000과 worker>1일 때 병렬 모드로 들어가며 group tangent를 atomic Float32 덧셈으로 누산한다. 덧셈 순서에 따라 마지막 비트가 달라질 수 있다. --threads1의 실제 최소 재현과 전체 실행에서 반복 차이가 사라졌다. 원래 MikkTSpace 계산과 normal-map 자료를 유지하며 새 양자화나 다른 tangent 알고리즘을 넣지 않았다.

- 현재5-domain roundtrip/edit 각각2회:20 의미 검수 사례 PASS, 최종10 SHA 쌍 모두 byte exact. source·이전 결과 SHA 보존.
- 기본 실행 대비10 사례의 JSON 및 TANGENT 외 accessor 모두 byte exact. tangent handedness도 동일. geometry/normal/UV/index/skin/animation/PBR/계층을 바꾸지 않았다.
- 실제 GLB의 normalMap과 TANGENT를 Three.js 브라우저에서 다시 읽었다. 차이가 있는 LOD1 부위 최대 방향 차이 vertex3057을 같은512×512 camera/light로 비교했으며 RGBA 채널 차이0. 첫 crop은 변화 없는 Mesh_0를 선택해 유효한 변화 영역 검수로 사용하지 않았고 로컬에 보존했다. 현재 closeup은 변경된 실제 LOD1 영역이다. 이 한 화면을 모든 포즈·앱·전문가 승인으로 일반화하지 않는다.
- 현재110 파일795 테스트, check/benchmark/build, 추가 strict CLI 타입 검사 PASS. 저장소에 없는 Node 타입은 기존 로컬22.20.4 선언을 사용했으며 의존성을 추가하지 않았다.
- quality:gate/production FAIL, 기존 false 항목 동일. cooling UV23와 기본 Blender import normal drift, 다른 분야의 근거·앱 검증 부족은 별도다.

두 benchmark 명령은 자동으로 profile0.1과 --threads1을 사용하며 aggregate receipt에 옵션과 각 native 실행 elapsedMs를 기록한다. [실제 코드·환경·결과](../benchmarks/modeling-slices-20261004/blender-tangent-determinism/verification.json), [현재 입력/출력 SHA와 시간](../benchmarks/modeling-slices-20261004/blender-tangent-determinism/actual-runs.json), [중립 closeup](../benchmarks/modeling-slices-20261004/blender-tangent-determinism/normalmap-closeup.png), [계약](BLENDER_TANGENT_DETERMINISM_CONTRACT.ko.md).

직접 재현은 `/Applications/Blender.app/Contents/MacOS/Blender --background --threads 1 --python-exit-code 1 --python scripts/blender-glb-roundtrip.py -- source.glb new.glb new.json`이다. 원본 파일과 실패 probe는 outputs/tangent-determinism-goal-20261004에 남긴다. GPU 렌더는 저장한 실제 GLB의 shader 관측이며 Blender GUI 기본 export나 다른 버전의 결정성을 보장하지 않는다. 현재 fresh native receipts를 두 latest 보고서에 연결한 뒤 quality 두 명령을 다시 실행했다. Blender/editor 개별 의미 검사는 pass지만 benchmarkAccepted는 둘 다 false이며 production으로 승격하지 않았다. 다음 우선순위는 남은 gate blocker의 실제 원인과 지원 경계를 사용자 검수에서 확인 가능하게 하는 것이다.

로컬 원본의 기존 Blender latest 영수증 두 파일은 publisher의 기반과 달라 보존했다. 현재 납품 증거의 작업 기준은 격리 publisher main과 위 SHA 보고서다. 대응되는 코드·문서는 원본에도 동기화했으며 사용자 영수증을 덮어쓰지 않았다. [보존 기록](../benchmarks/modeling-slices-20261004/blender-tangent-determinism/local-preservation.json).
