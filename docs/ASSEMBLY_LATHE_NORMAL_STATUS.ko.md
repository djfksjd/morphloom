# Assembly lathe 모서리 법선: 2026-10-04

기준 HEAD `7c79a21584ac4c016a65826a5b5ac218f113262c`, compiler `morphloom-compiler/0.40.0`. 게시 작업 경로는 임시 publish checkout, 원본은 `/Users/danny/Documents/morphloom`이다. 원본의 dataless git index와 사용자 변경은 복구·삭제하지 않는다. UNI_AI와 Claude 추가 호출은 0회다.

## 재현과 구현

창작 부싱의 닫힌 lathe 단면에서 기존 공유 법선이 평평한 끝면과 원통 옆면을 함께 평균했다. 기본 32분할 끝면의 최대 법선 오차는 66.81258°, 옆면은 32.04088°였다. 기하가 둥근 모서리인 것처럼 보이는 셰이딩 결함이며 실제 bevel은 아니다.

기존 `creasePartNormals`의 결정론적 corner-angle 알고리즘을 순수 모듈로 옮겨 재사용한다. lathe에만 선택적 `normalPolicy`를 추가했다. UV 생성 후 적용하므로 정점 위치·UV·삼각형 수·치수를 바꾸지 않는다. 기존 선언 없는 IR의 법선 SHA를 고정해 회귀 검사하며, 자동 마이그레이션하지 않는다.

```json
"normalPolicy": {
  "schema": "morphloom.lathe-normals/0.1",
  "creaseAngleRad": 0.5235987755982988,
  "weighting": "corner-angle"
}
```

AssemblyIR의 기존 0.1과 component-patch 0.2를 유지하고 중첩 정책만 버전 관리한다. patch의 `lathe-normal-policy` set/clear가 명시적 마이그레이션이며 clear는 선언을 삭제해 원본 법선을 복원한다. 정책 버전·추가 키·가중치·0..π 범위·lathe 외 대상·오래된 fingerprint·patch 0.1·100000삼각형 예산 초과를 거부한다. 실패한 batch는 원본에 부분 적용하지 않는다. native elements의 별도 normal 정책을 대체하지 않는다.

## 실제 검증

| 사례 | 끝면 최대 오차 전 → 후 | 옆면 최대 오차 후 | Blender 첫 import / 재export 최대 오차 |
|---|---:|---:|---:|
| 작은 부싱, 16분할 | 66.84688° → 0° | 0.00000363° | 0.00445° / 0.00573° |
| 기본 부싱, 32분할 | 66.81258° → 0° | 0.00000667° | 0.00266° / 0.00525° |
| 큰 부싱, 128분할 | 66.80211° → 0° | 0.00004703° | 0.00066° / 0.00375° |
| 솔리드 회전체, 64분할 | 실제 파일 보고서 참조 → 0° | 0.00001754° | 0.00130° / 0.00152° |

기준은 구현 전에 고정한 0.01°다. 원본/수정 GLB 8개 모두 Khronos와 독립 WebIO 재열기 PASS, 동일 IR 반복 생성의 전체 SHA 일치. 독립 accessor 비교에서 대상 NORMAL 외 POSITION·UV·index·비대상 NORMAL·재질 JSON(확장 포함)·계층·변환은 보존됐다. 닫힘·winding·퇴화·자기 교차 검사도 PASS다. Blender 재export 4개는 별도로 Khronos/WebIO PASS다. Blender 파일 바이트가 엔진 원본과 같다는 주장은 하지 않는다.

실제 제품 UI에서 LOAD IR → 부품 선택 → 모서리 법선 활성화 → 적용·취소·Undo/Redo → SAVE IR → 새 세션 LOAD IR → GLB 다운로드를 실행했다. Undo JSON은 원본, Redo JSON은 수정본과 정확히 같다. 새 세션 GLB는 첫 다운로드와 전체 SHA가 같다. 181° 입력은 적용이 차단되고 저장 원본이 유지됐다. 재열기 후 1mm 추가 이동은 정책과 비대상 부품을 보존했다.

테스트 111파일/805개, `npm run check`, `npm run benchmark`, `npm run build` PASS. 마지막 UI 설명 문구/테스트 정리 후 관련 6개·check·build도 PASS. Apple M5/macOS, Node 24.13.1, Blender 5.2.1 LTS, `--threads 1`. 고정 카메라·조명·1024 해상도의 clay/사광/wire 전후 3쌍은 설정·bounds·프레이밍이 일치한다. 원자료 사진은 없으며 창작 구조 검사다.

처음 병렬 부하 중 솔리드 컴파일의 2배 예산 검사는 실패했다. 실패 로그를 보존했다. 부하 분리 후 전후 실행 순서를 번갈아 2 warmup/5측정한 median 비율은 작은 1.174, 기본 0.995, 큰 1.438, 솔리드 1.288로 모두 고정 2배 예산 안이다. 작은 시간 차이를 속도 개선으로 주장하지 않는다.

## 실패·주장 범위

비대상 구 부품의 Blender 첫 import 최대 normal 오차는 **0.02968046°로 FAIL**이다. 이번 lathe 수정의 성공과 별개이며 전체 Blender normal 보존 완료가 아니다.

현재 `quality:gate`와 `quality:production`은 exit 1이다. compiler 0.40 변경으로 기존 0.39 browser 영수증이 무효화되어 첫 quality 단계의 browser round-trip 요구에서 멈췄다. competitive와 dominance는 이 명령에서 **not-run**이다. 함께 복사된 competitive-latest는 이전 실행 자료이며 현재 결과로 사용하지 않는다. 기존 cooling UV 보존/strict unused accessor infos 23 충돌도 해결하지 않았다. 영수증 버전만 고치거나 UV 삭제·가짜 텍스처·임계값 완화를 하지 않았다. 이번 기능은 opt-in 검증 범위이며 플랫폼 production-ready가 아니다.

## 사용·증거·재현

LOAD IR로 lathe가 포함된 AssemblyIR을 열고 부품을 선택한다. `회전체 법선 · 명시적 옵션`에서 체크와 도 단위 각도를 입력해 적용한다. 해제/Undo로 복원, SAVE IR로 별도 저장한다. GLB는 메시 납품이며 제조용 BREP·실측 정확도를 의미하지 않는다.

공개 증거: [`benchmarks/modeling-slices-20261004/assembly-lathe-normals`](../benchmarks/modeling-slices-20261004/assembly-lathe-normals). 로컬 원본: `/Users/danny/Documents/morphloom/outputs/lathe-shading-goal-20261004`. `manifest.json`은 실제 파일 SHA와 변경 코드 SHA를 기록한다. `verified/proof.json`, `file-preservation.json`, `browser-proof.json`, `*-normal-comparison.json`, 각 command/log와 중립 렌더를 구분한다. 최초 실패도 보존한다.

기본 수정 GLB와 실제 브라우저 재열기 GLB SHA: `83cb41f99512f236037fb50593da7edb255bd837c0b49d2c5a3120cb3a6eed9b`.

```sh
npm test -- --run tests/assembly-lathe-normals.test.ts
npm test
npm run check
npm run benchmark
npm run build
```

Blender/비교 명령의 실제 인자는 `blender-commands.json`과 `normal-comparison-commands.json`에 남긴다. 기록된 절대 경로를 새 증거 디렉터리로 바꿔 실행한다. `diagnostic-scripts`는 당시 실험 보존용이며 경로·신규 출력 조건을 확인하고 실행한다. 다음 한 단계는 새 compiler에 대해 기존 전 분야 browser 검증 영수증을 실제 재실행해 게이트의 현재 실패 경계를 다시 확인하는 것이다. 연속 Goal은 active다.
