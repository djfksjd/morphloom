# 검증된 평행이동 → 별도 native sourceJSON

2026-10-04, 기준 main c8c91a2. 게시 검증 체크아웃은 `/var/folders/z4/_txy7z5d7hb83mc592z_cq540000gn/T/morphloom-publish-w4nfo7ko/repo`, 원본은 `/Users/danny/Documents/morphloom`이다. 시작 시 GitHub와 게시본 HEAD는 같았다. 원본 git index 매핑 오류는 수리·삭제하지 않았고 사용자 추가 테스트 19개 및 사용자 WORK_STATE 문서를 보존했다. 원본에 이미 있던 파일은 HEAD 바이트와 동일함을 확인한 뒤 이번 소유 파일만 복사했다.

**이번 기능은 아래 제한된 범위에서 완료했다. 플랫폼 전체 납품·production은 미완료다.** 기존 연속 Goal의 다음 단계이며, 플랫폼 상태는 paused 그대로다. 도구에 목표 수정/재개 API가 없어 변경됐다고 보고하지 않는다. UNI_AI·Claude CLI 호출은 0회다.

## 실제 구현과 원인

- `reconstructTranslatedSource`는 원본 결합 UV 검사 후 한 native elements source의 실제 parse/editPart/export를 사용한다. 원본 IR 재생성과 이동 IR 재생성을 모두 수행해 전체 BIN 바이트와 비변환 scene semantics를 검증한다. 부모 identity datum, mm/right-handed Y-up, 대상 ID, 잠금, 선택 범위도 확인한다. 기존 1e-6 m 평행이동·1e-10 linear 검사 외의 바이트 비교를 오차 비교로 바꾸지 않았다.
- 성공하면 별도의 편집 가능한 sourceJSON과 버전 0.1 영수증을 반환한다. 원본 IR/GLB와 현재 이동 GLB의 before-edit metadata 및 editableIR false는 보존한다. 새 receipt schema는 기존 IR schema를 변경하지 않는다. 기존 IR 마이그레이션을 재사용하며 알 수 없는 source schema는 실패한다.
- 첫 3개 격리 테스트는 원래 TRS 노드에 새 matrix를 삽입해 binding JSON 계약을 위반했다. 실제 어댑터처럼 원래 표현을 유지했다. 이후 드러난 legacy UV 소스 실패도 기존 UV 편집 마이그레이션과 유효한 스케일로 fixture를 만들었으며 임계값을 변경하지 않았다. 잘못된 matrix·출처·이동의 차단 테스트를 유지한다.
- 기본 베어링 최초 차이는 원본 IR → 기하 생성 단계가 아니라 **corner-angle normal 가중치의 Math.atan2**였다. 실제 typed-array 바이트 비교에서 raw position/normal/UV와 accessor 구성·순서는 일치했고 4,675 Float64 각도 값이 최대 2.22e-16 차이, 최종 Float32 normal 12개가 최대 1.1047e-18 차이였다. 작은 수치라도 기존 BIN 계약에서는 FAIL이다.
- renderer **0.12**에서 각도 계산을 범위를 축소한 명시적 IEEE 다항식 계산으로 바꿨다. 양자화·반올림·허용 오차 우회 없이 유효 각도와 1e-17 작은 각도를 보존한다. uniform weighting은 변경하지 않는다. 같은 현재 입력/설정의 작은·기본·큰 베어링과 기어에서 기하 → normal → export 전체 typed-array/BIN/GLB SHA가 Node와 실제 브라우저에서 일치했다. 재생성 불일치가 있는 과거 renderer 파일은 계속 차단된다.
- 기존 검사 패널에 수정 소스 생성·다운로드 버튼을 연결했다. 새 선택·재검사·생성 실패는 이전 다운로드를 무효화한다. ticket와 mounted 확인으로 늦은 읽기/검사/오류/unmount 완료를 폐기한다. CLI는 exclusive 파일 생성과 실패 시 소유 파일 rollback을 적용한다.

## 지원과 비지원

단일 embedded native elements source, 실제 IR 부품 ID, glTF right-handed Y-up **world millimeters**의 선언된 평행이동, identity 부모, 정적 무텍스처 소스만 지원한다. 입력 GLB를 역편집하거나 출처 플래그만 수정하는 기능이 아니다.

혼합 workspace, 잘못된 SHA, geometry/normal/UV/index/PBR/계층 변조, 선언과 다른 이동, matrix 표현 삽입, 잠긴 부품, texture/외부 URI, 비지원 schema·생성 elements/groups, 비가역 변환, 회전·스케일·평행이동 부모는 거부한다. 회전 부모 지원 확대, 임의 DCC 메시 편집, 사진 복원·리깅·새 기하는 추가하지 않았다.

## 현재 실행 결과

| 명령/검증 | 현재 결과 | 범위·실패 분류 |
|---|---|---|
| npm test (게시 체크아웃) | PASS, 108파일 / 779테스트 | 새 source 7개, 결정론 각도 2개 포함 |
| npm run check | PASS | 현재 제품 src 타입 검사 |
| npm run benchmark | PASS | 현재 로컬 벤치마크 실행 |
| npm run build | PASS | 현재 src 빌드 |
| npm run quality:gate | exit 1 | quality 단계 통과, competitive의 기존 cooling Blender 영수증 UNUSED_OBJECT info 23개가 infos=0 조건에 불합격 |
| npm run quality:production | exit 1 | 앞 competitive 실패; dominance 명령 not-run |
| 원본 npm test | exit 1, 활성111파일 / 798테스트 PASS | 과거 outputs 격리 테스트 1 suite가 자동 수집돼 보관본 의존 경로 import 실패. 실패 자료 삭제·skip 없이 보존; 새 기능 회귀가 아님 |
| 원본/이동/재생성 12 GLB | 엄격 검사 PASS12 | Khronos + 독립 glTF Transform + Three.js 재열기 |
| 실제 브라우저 4 에셋 | PASS4 | 저장·새 세션 재열기·추가 편집·Undo/Redo·GLB 반복 생성 전체 바이트 일치 |
| 연속 이동/0 이동 | PASS4 | 새로 재생성한 원본에서 다음 (1,-2,0.5)mm 이동과 no-op; source 모든 비대상 필드 보존, 중복 이동 없음 |
| 비동기 수정 소스 UI | PASS6 | 파일 교체 stale success/error, 현재 읽기 실패, 검증 다운로드 무효화, child unmount success/error |
| 기존 UV UI/지연 읽기 | PASS8 / PASS3 | 현재 수정본에서 다시 실행; 24/294면 손상 톱니 FAIL 유지 |
| Blender 첫 import 대응 | PASS4 | 세 입력 간 실제 메시·normal·UV·재질·부모·좌표 대응 보존 |
| Blender raw normal 충실도 | FAIL | sphere 첫 import 최대 약0.03390°, 재export 약0.03556° > 기존0.01°. native 결정성 수정과 별개 |
| Blender 재export·재import | 실제 실행4 | 네 파일 생성·재열기 실행; 원본 BIN 일치 아님, raw normal 납품 승격 금지 |

전역 보고서의 새 false 경로는 작업 전 자료 대비 0개다. 위 과거 자료는 실패 분류에만 사용했고 현재 명령 성공 증거로 재사용하지 않았다. 새 기능 결함·회귀로 남은 실패는 관측되지 않았다. quality/production 코드는 로컬 생성과 파일 영수증 검사이며 외부 모델/API·비용 호출을 추가하지 않았다. 외부 앱 미실행을 PASS로 바꾸지 않았다. 독립 인간 전문가 평가는 not-run이다.

## 사용자 흐름과 재현

1. `/?editor=elements`의 **Original/current GLB UV inspection**을 연다. 현재 엔진의 원본 native export와 지원 어댑터 이동 GLB를 고른다. 필요한 IR은 정확한 원본 GLB에 embedded돼 있어야 한다.
2. **Inspect bound reference UV** → PASS 후 **Generate modified native source JSON**을 누른다. FAIL/BLOCKED에서는 적용·다운로드할 수 없다.
3. **Save modified source JSON**, **Save source regeneration proof**를 각각 저장한다. 새 세션의 **Load JSON**으로 새 sourceJSON을 다시 열고 대상 ID 선택, 추가 편집·Undo/Redo, **Export project GLB + source JSON**을 사용한다.

```bash
# 출력은 모두 새 경로여야 한다.
blender --background --python-exit-code 1 --python scripts/blender-source-translation.py -- original.glb translated.glb translation.json ball_0000 2 1 -3
npx vite-node scripts/translated-source-audit.ts original.glb translated.glb modified.elements.json regeneration.json
npm run gltf:validate -- original.glb translated.glb regenerated.glb
npx vite-node scripts/translated-source-normal-boundary-audit.ts original.glb new-boundaries.json
# manifest 경로/입력/세션 이름이 명시된 현재 브라우저 및 독립 앱 재현 스크립트
python3 scripts/translated-source-browser-flow.py NEW_EVIDENCE_ROOT
python3 scripts/translated-source-async-browser.py NEW_EVIDENCE_ROOT
blender --background --python-exit-code 1 --python scripts/translated-source-independent-audit.py -- NEW_EVIDENCE_ROOT
```

자동 브라우저 스크립트는 이 실행의 4179 포트와 manifest 계약을 사용한다. `npm run dev -- --port 4179`로 시작하고 새 증거 폴더에 `browser-originals-final.json`(실제 원본/이동/source 경로), 입력 sourceJSON 및 `async.workspace.json`을 준비한다. 같은 출력 폴더를 재사용하지 않는다.

브라우저 스크립트는 native 파일 선택·DOM 조작·실제 다운로드를 사용한다. async 스크립트는 File.arrayBuffer 시간/오류만 제어하고 React 상태를 주입하지 않는다. 원본 생성 스크립트는 3개의 동시 다운로드 중 관측 파일을 GLB로 추측하지 않고 actual glTF magic을 확인한다. 시도 실패와 `.crdownload`도 로컬 증거로 보존했다.

## 실제 파일과 증거

로컬 증거: `/Users/danny/Documents/morphloom/outputs/translated-source-goal-20261004`. 현재 코드 해시·모든 실제 파일 SHA·실행 환경·명령 결과는 [verification.json](../benchmarks/modeling-slices-20261004/translated-source/verification.json), 선택된 소스·로그·브라우저 스크린샷은 [evidence.tar.gz](../benchmarks/modeling-slices-20261004/translated-source/evidence.tar.gz)에 있다. 큰 GLB는 로컬에 보존하며 README나 영수증만으로 파일 성공을 판단하지 않았다.

| 사례 | 대상 | 원본 GLB SHA256 | 이동 GLB SHA256 | 수정 sourceJSON SHA256 | 재생성 GLB SHA256 |
|---|---|---|---|---|---|
| small | `ball_0000` | `f7d3ffd7f7d8eaf83caf0752b9362733f21d11ff5271fed5794b191f77806e82` | `deaa30e04caaa3e7994de8827980e9488ff524df286afbe3eae4a7b1615cf826` | `6e13d77ea9bde372abedd6e3e2001c432eeaf09cc0d25a3b38254d070db8d17c` | `96eedf08795c4dde4e51ac417f5503995f7ccd2604bf1bb6683ec69dea517d30` |
| default | `ball_0000` | `9b2d53e4d31bd83410cedfb1a80ca9860010534a5af872eee8b130bdd3882cb8` | `1f338aaea65cae302ebfff6ce776e76b4b0a45829d909504200d088f7e886c7f` | `d2fa237088d11d0a923a22c365726ce039850f42634d996a1de5a30466f00860` | `70e781365720894393454d5059c8244b2eada83b3a47a71cb7721b339b4c41e9` |
| large | `ball_0000` | `438e8e6477017c7b30d0167e8394f3a5e43a1a876d78d08b25962c78c086a4f3` | `f0a74bc8c10242303c0ed588df719f64625fbfa7d5e65abbb9a7e168fdd87156` | `25543d8a740da51b6860a719f4b1fb20a9cebcdf612764a855b2f611582c33f0` | `e24c23c1b712ecdb61c27032c3d58eb2219092d54d3b9d6bde361a6bd6b7d0d0` |
| gear | `spur_gear` | `9f208951b34de07ecf95e6b488bf86fe9e58f7f923257470c617be5bda3c467d` | `8f57def0358a3a4d6df8c9e1544000a728553f220d12bc9e386d36a6ec590ab8` | `a1b1d9f4ab02a6135a56e46411a87aba2374ff319acd1f1b84dfb115c0061cc1` | `af481099d9933883b37988796e41fafb09d58271880d7e8186b0ff1128ee37d2` |

이동은 네 사례 모두 (2,1,-3)mm다. 같은 sourceJSON의 반복 GLB 바이트가 일치한다. 비대상 IR 전체 필드와 원본/이동/재생성 BIN, accessor 구성, 비변환 JSON 의미·계층을 확인했다. index가 있는 별도 유효 sphere 사례의 성공·변조 차단도 테스트했다.

다음 해결할 한 가지는 **Blender 첫 import raw normal drift**다. 현재 native source 흐름의 완료를 전체 DCC 납품 승인으로 확대하지 않는다.
