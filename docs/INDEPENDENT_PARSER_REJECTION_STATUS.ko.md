# 독립 GLB 파서 실패 보존 — 2026-10-04

기준 main `5794d7cf4efdbadbdfc4f82156c590854c6baa63`. 게시 체크아웃과 GitHub HEAD 일치. 원본 로컬의 iCloud git index 실패 및 사용자 변경은 보존했다. UNI_AI/Claude 호출 0. 연속 Goal은 active이며 이 단계는 형상 개선이나 전체 납품 완료가 아니다.

## 재현과 판단

- 실제 `unknownRequired.glb`: Khronos 오류0/경고0/정보1 (`UNSUPPORTED_EXTENSION`). glTF Transform은 필수 확장 미지원으로 거부했다. 기존 `gltf:validate`는 예외 종료해 파일별 보고서를 잃고 다음 파일을 검사하지 못했다.
- 기존 납품 비교는 `errors`만 확인했다. 독립 재열기 `not-run`인 보고서를 전달해도 PASS가 되는 최소 재현을 확인했다.
- 외부 이미지 URI는 이미 Khronos `IO_ERROR`로 차단됐다. WebIO `readBinary`는 외부 리소스를 가져오지 않는다. 최초 네트워크 요청 가설은 기각했으며 새로운 네트워크 결함이라고 주장하지 않는다.

## 구현과 계약

`gltf-standard-validation.ts`는 독립 read 실패를 `independentRead.status: blocked`와 제한된 원인 문자열로 반환한다. Khronos의 실제 오류·경고·정보 개수와 코드는 그대로 둔다. 총 상태는 blocked다. 모듈 로딩 자체의 실패와 기존 크기 제한 예외는 종전처럼 throw한다.

`delivery-validation.ts`는 제공된 독립 read가 pass가 아니면 납품을 차단한다. 보고서가 없는 기존 호출은 그대로 유지한다. 독립 read 성공을 가장하거나 실패를 경고로 바꾸지 않는다. 실제 CLI는 여러 파일의 결과를 모두 반환하며 하나라도 실패하면 exit1이다.

IR/job/component patch 변경 없음, 원본/GLB 바이트 변환 없음. 기존 진단에 blocked 상태와 optional reason을 추가한다. 기존 pass/not-run 레코드를 계속 읽는다. 성공 임계값·UV 보존·infos0의 competitive 조건은 그대로다. 필수 미지원 확장, 외부 리소스의 지원을 확대하지 않는다. optional unknown 확장은 독립 read 성공 및 기존 Khronos 정책을 만족할 때만 기존대로 허용한다.

범위는 이 두 검증 경계이며 새 기하·리깅·DCC 역변환은 없다. 검증 자원은 작은 GLB4개와 기존 실제 납품 파일5개, 전체 검증1회 및 production의 선행 gate1회다. 합격 기준은 필수 미지원 확장 차단/보고서 보존, 실제 독립 성공 경로 보존, 외부 요청0, 입력 SHA 보존이다.

## 현재 실행

- 실패 테스트 추가: 2 fail / 5 pass. 이후 제품 수정 중 존재하지 않는 audit.exactParity를 테스트한 작성 오류를 발견해 실제 status/score/blocker로 교정했다. 제품 기준을 바꾸지 않았다.
- 관련7개 PASS, 전체110파일799개 PASS.
- `npm run check`, `npm run benchmark`, `npm run build`: exit0.
- 실제 CLI 4파일: blocked/pass/blocked/pass, exit1(예상). 이전처럼 첫 거부에서 보고서가 사라지지 않는다.
- 기존5분야 실제 repaired GLB를 현재 코드로 새로 검사:5 PASS, 모든 입력 SHA 불변. 이것은 현재 검증기 회귀 증거이며 새 Blender 재열기 증거가 아니다.
- 브라우저의 별도 검수 harness에서 파일 선택과 현재 production 검증기 호출: 필수 미지원 파일 blocked/원인 표시, 다음 유효 파일 pass. 스크린샷 포함. 제품 native-elements 편집 UI 재검증으로 주장하지 않는다. 첫 비동기 완료 전 읽기는 증거에서 제외하고 원자료를 남겼다.
- Blender 첫 import/재export: 이번 단계 not-run(기하·export·Blender 코드 무변경).
- `quality:gate`, `quality:production`: exit1. 외부 호출·비용 없는 로컬 스크립트임을 확인했다. production dominance는 선행 gate 실패로 not-run.

전체 실패는 기존 Blender cross-domain의 `benchmarkAccepted:false`가 유지되는 것과 구분한다. cooling 파일의 보존된 untextured TEXCOORD_0에 UNUSED_OBJECT infos23이 남으며 competitive의 infos0 조건을 충족하지 못한다. native 의미 보존 PASS와 전체 승인 FAIL은 서로 다르다. Unity not-run 및 시각 우수성 미입증도 그대로이나 이를 이번 실제 exit 원인이라고 섞어 보고하지 않는다.

## 증거와 재현

공개 증거: [independent-parser-rejection](../benchmarks/modeling-slices-20261004/independent-parser-rejection/). 로컬 실제 파일·로그: `/Users/danny/Documents/morphloom/outputs/parser-rejection-goal-20261004`.

`hashes.json`은 현재 변경 소스와 증거 SHA, `evidence.json`은 입력 파일 SHA/환경/범위, `commands.json`과 `quality-commands.json`은 실행 결과다. `batch-validation.json`, `native-existing-files-validation.json`, `browser-blocked.json/png`, `browser-valid.json`을 따른다.

```bash
npx vitest run tests/gltf-standard-validation.test.ts
npm run gltf:validate -- benchmarks/modeling-slices-20261004/independent-parser-rejection/unknownRequired.glb benchmarks/modeling-slices-20261004/independent-parser-rejection/valid.glb
npm test
npm run check
npm run benchmark
npm run build
npm run quality:gate
npm run quality:production
```

다음 한 작업은 UV 보존과 표준/전체 품질 계약이 충돌하는 실제 cooling23개 accessor의 납품 표현을 조사하는 것이다. UV 삭제·더미 텍스처·임계값 완화로 PASS를 만들지 않는다.
