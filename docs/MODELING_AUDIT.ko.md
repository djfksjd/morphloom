# Morphloom 모델링 감사와 곡면 개선 결과

2026년 10월 2일, 로컬 `/Users/danny/Documents/morphloom`, origin `https://github.com/djfksjd/morphloom`, HEAD `a200aa4`를 확인했다. `git ls-remote`로 원격 HEAD/main도 `a200aa4593aa14a9f0348b014962d144d119c741`임을 확인했다. 기존 미커밋 요소 플랫폼·회로·시뮬레이션 변경을 보존했다. 커밋과 push는 하지 않았다.

현재 코드는 IR 생성·부분 수정·토폴로지·실제 납품 검사를 갖추고 있다. 이번에 수정한 것은 **요소 렌더러의 구와 타원체 Detail 정밀도**다. 전체 플랫폼이나 첫 기계 조립체 수직 슬라이스의 완료를 뜻하지 않는다. 기존 문서의 과거 영수증은 이번 변경의 검증 증거로 사용하지 않았다.

## 실제 구현 감사

확인 상태의 ‘코드·회귀’는 관련 구현을 읽고 현재 전체 테스트를 실행했다는 뜻이다. 각 분야의 시각 품질이나 모든 대상 앱에서 독립적으로 재검수했다는 뜻이 아니다.

| 기능 | 구현 위치 | 확인 상태 | 실제 제한 | 사용자 영향 | 우선순위 |
|---|---|---|---|---|---|
| 제품 IR·기하 | `src/engine/assembly-ir.ts`, `assembly-compiler.ts` | 코드·회귀 | roundedBox, extrude/holes/bevel, lathe, tube, bladeLoft 등을 지원. 범용 CAD/BREP 커널 아님 | 기존 연산을 재사용할 수 있음 | P1 |
| 부품 patch·보존 | `src/engine/assembly-edit.ts` | 코드·회귀 | 입력 fingerprint와 비대상 IR 보존 검사. 범용 DCC history는 아님 | 무관한 부품을 보존하는 기반 있음 | P1 |
| 캐릭터·리그·표정 | `character.ts`, `humanoid-rig.ts`, `facial-morphs.ts` | 코드·회귀 | 표정은 제한된 좌표 규칙, 실측 신원·FACS 검증 아님 | 별도 해부학·극단 포즈 검수 필요 | P2 |
| 토폴로지·자기 교차 | `topology.ts`, `self-intersection.ts` | 코드·회귀·현재 볼 메시 실행 | 메시별 검사. 이번 볼 시험은 부품 간 간섭·변형용 quad 흐름을 검증하지 않음 | 닫힌 메시와 제조 승인을 구분해야 함 | P1 |
| PBR·사진 표면 | `surface-system.ts`, `reference-surface.ts` | 코드·회귀 | 사진 밝기 기반 relief/roughness는 추정. 요소 loft에는 UV가 없고, sphere에는 UV가 있음 | 모든 요소에 UV/텍스처 납품을 주장할 수 없음 | P1 |
| 중요 특징·품질 단계 | `fidelity-pipeline.ts`, `generation-policy.ts` | 코드·회귀 | production domain은 여전히 고정 union/분기. 모든 분야용 capability planner 아님 | 새 분야를 core 변경 없이 수용하는 범위가 제한됨 | P1 |
| 분야별 준비 상태 | `domain-readiness.ts` | 코드·회귀 | UV 유한성·퇴화, normal·변형·LOD 등의 게이트가 존재. 사람의 독립 평가 대체 아님 | 검사 중복 구현보다 기존 검사 확장 우선 | P1 |
| 납품·내보내기 | `delivery-validation.ts`, `gltf-export-preparation.ts`, `ViewerApp.tsx` | 코드·회귀, 이번 볼 GLB·Blender 실행 | 원본 procedural 의미는 baked GLB만으로 복원 불가 | 원본 JSON과 선택 ID를 함께 납품 | P1 |
| 요소 편집 UI | `ElementEditor.tsx`, `element-project.ts` | 코드·현재 브라우저 실행 | 부위는 독립 월드 좌표. 조립 구속·기어 feature history 아님 | 선택·수치 편집·undo/redo를 재사용 | P1 |
| Domain Pack | `element-domain-packs.ts`, `examples/domain-packs/minimal-pack.ts` | 코드·회귀 | native 요소 IR 하나, trusted 동기 생성. Pack 조합·악성 코드 sandbox 미구현 | 볼 preview를 실제 베어링 모델로 오해하면 안 됨 | P1 |
| 기준선·성능·회귀 | `tests/`, `scripts/`, `benchmarks/` | 현재 실행 | 기존 품질 게이트 통과와 분야별 실무 품질은 별개 | 현재 입력·출력 해시로 증거 구분 | P1 |

## 첫 수정 단위와 사전 계약

기존 `bearing.ball.preview`를 사용하는 곡면 결함을 먼저 재현했다. 단독 볼은 복잡한 대표 조립체의 대체물이 아니며, 이번 단위는 그 조립체에 필요한 곡면 납품 기반의 수정이다. 실물 원자료 없이 이상적인 구·타원체를 창작한 예제다.

수정 전 세 크기에서 실패 테스트를 작성했다. 계약은 직경으로 정규화한 **삼각형 면 중심의 반경 부족량 ≤ 0.002**, Detail 구당 ≤ 3,000삼각형이다. 실측 제조 공차와 최대 Hausdorff 오차를 의미하지 않는다. 기존 전체 200만 삼각형·128 batch 제한을 유지했다. 수정·검증 반복 상한은 2회, 새 의존성과 텍스처는 0개다.

`element-renderer.ts`에서 Low의 16×12 분할은 유지하고 Detail과 선택 내보내기를 같은 48×32 생성 함수로 연결했다. 렌더 전 예산 계산도 실제 LOD별 구 분할을 반영한다. 기존 mm 단위·좌표·ID·재질·IR 스키마·patch 계약은 변경하지 않았다. 저장된 0.1 프로젝트를 그대로 다시 열 수 있으며 마이그레이션은 필요 없다. 새 렌더는 이전의 저분할 정점 수와 동일하지 않다.

| 관측 | 변경 전 | 변경 후 |
|---|---|---|
| 구 Detail 삼각형 | 352 | 2,976 |
| 정규화한 최대 면 중심 반경 부족량 | 0.0122498218 | 0.00148552835 |
| 8mm 구의 동일 측정량 | 약 0.0980mm | 약 0.0119mm |
| Low 구 삼각형 | 352 | 352 |
| 형상 시험 | 0.1·8·100mm 구에서 새 계약 실패 | 세 구와 6×10×4mm 타원체 통과 |

면 중심은 검수 표본이며 면 전체의 최대 오차 인증이 아니다. sphere의 위도·경도 UV seam과 극점 왜곡은 의도된 매핑이다. 텍스처 없는 예제이므로 texel density, 패딩, mip bleeding, normal-map tangent 호환은 미검증이다. 재질 생성은 바꾸지 않았다.

## 실제 검증 결과

- 기준선 `npm run check`: 종료 0. 기준선 `npm test`: 74파일·554테스트 통과.
- 수정 후 관련 테스트: 3파일·29테스트 통과. 전체 `npm test`: 74파일·557테스트 통과.
- `npm run build`, `npm run benchmark`: 종료 0. build는 TypeScript 검사를 포함한다.
- `npm run quality:production`: 종료 1. 내부 `quality:gate`와 competitive benchmark는 통과했으나 dominance의 분야별 독립 입력·참조·동일 입력 사례가 0/3이라 차단됐다. 이 미달은 요소 렌더러를 사용하지 않는 평가이며 기준을 낮추지 않았다. 이전 receipt에도 사례 0이 기록돼 있다.
- `npx vite-node scripts/ball-curvature-evidence.ts`: 생성 정점·UV·normal·index, 토폴로지, 치수, 선택 내보내기, undo/redo, JSON 저장·재열기, 분리·복원을 검사했다. 비대상 부품의 형상·UV·재질·변환 fingerprint가 일치했다.
- 동일 입력 재실행: JSON·선택 GLB·두 부품 GLB의 실제 바이트가 일치했다. 실행 시간 표본을 포함한 보고서 자체의 동일 바이트는 요구하지 않았다.
- 기존 `scripts/element-slice-evidence.ts`도 현재 코드로 재실행해 bird/fur/ball·LOD·5,000요소 예산 회귀를 확인했다.
- Blender 5.2.1 LTS: 기존 neutral renderer로 같은 카메라·조명·1024×1024·clay 설정의 전후 렌더를 생성·열람했다. 소스 실루엣의 각짐 감소를 확인했다. 두 렌더는 같은 8mm/같은 재질·위치 입력이다.
- Blender: 선택 볼 가져오기→재출력→재열기 통과. 두 부품 중 볼만 X 방향 2mm 이동 후 두 차례 내보내기·재열기 통과. 비대상 부품의 중심·크기 drift 0mm, face·UV·PBR·계층 보존 검사 통과.
- 현재 선택 GLB와 Blender 편집·stability GLB의 Khronos 검사 통과.
- 브라우저: Pack 선택, 볼 선택, Detail 2,976/Low 352 표시, Scale X 8→10, Undo 8·Redo 10 확인. viewport ready, 보고된 브라우저 오류와 Vite overlay 없음. 저장·업로드·내보내기 버튼을 누르는 UI 전체 시나리오는 이번에 실행하지 않았다. 이 경로의 core/file 검증과 구분한다.

## 파일과 재현

변경 파일은 `src/engine/element-renderer.ts`, `tests/element-renderer.test.ts`, `scripts/ball-curvature-evidence.ts`, 이 보고서다. 기존 untracked 파일에는 이미 작성된 코드를 보존한 최소 변경을 넣었다. benchmark 실행으로 갱신된 기존 tracked 보고서는 이번 출력 폴더에 복사하고 작업 전 내용으로 복원했다.

산출물은 Git에서 제외된 `outputs/ball-slice-20261002/`에 있다. 기준선 모델·IR·렌더러 소스는 `baseline/`, 현재 IR·파일·품질·Blender 영수증은 `current/`, 결정론 재실행은 `replay/`다. 전후 close-up은 `before.png`, `after.png`이고 카메라·렌더 설정·PNG/GLB 해시는 각각의 `*-render.json`에 있다. 브라우저 캡처는 `browser-final.png`다.

`current/verification.json`은 명령 결과와 파일 SHA-256을 기록한다. `current/evidence.json`은 현재 엔진 파일 SHA-256에 연결한 측정 결과를 기록한다. 이 요소 렌더러는 별도의 엔진 버전 상수가 없으므로 프로젝트 0.4.0, 요소 schema 0.1과 소스 해시를 함께 사용한다.

현재 선택 볼 GLB SHA-256:
`66e69dae2d7a223d5eeb43c5c1f142997d5bf7ef48a7d5d192800812ef29689a`

현재 원본 프로젝트 SHA-256:
`86a0311a65f3b49679ba215636a7e9d0b1d8f3b4109e312db09c693c13247f08`

```bash
npm run dev
# 기본 port 4173: /?editor=elements
npx vite-node scripts/ball-curvature-evidence.ts outputs/ball-curvature
npx vitest run tests/element-renderer.test.ts tests/element-domain-packs.test.ts tests/element-project.test.ts
```

UI에서 `bearing.ball.preview` 선택 → diameterMm 입력 → Generate pack → bearing_ball 선택 → Scale(mm)·Color 수정 → Undo/Redo를 사용한다. 세 Scale 축이 다르면 타원체다. `Save project JSON`으로 원본을 저장하고 `Load JSON`으로 연다. `Export selected GLB + source JSON`은 별도 이름의 baked 메시와 원본을 함께 내보낸다. Blender에서는 GLB를 import해 해당 이름의 메시를 수정할 수 있다. GLB만으로 원본 파라미터 편집은 복원되지 않는다.

## 차단과 다음 우선순위

UNI_AI 설정과 파일 권한 600은 확인했지만 공식 gateway의 첫 `/models/` 요청이 HTTP 403이었다. completion과 API 코드 리뷰는 not-run이며 자동 재시도하지 않았다. 키·인증 헤더·원자료는 출력하거나 외부 문맥에 포함하지 않았다. 이 작업은 로컬 분석·실행으로 수행했다. 호스트 세션의 과금 경로를 UNI_AI로 전환한 것은 아니다.

**첫 수직 슬라이스 전체는 미완료**다. 다음 우선순위는 기존 AssemblyIR의 lathe/torus/sphere를 이용한 명시적 내외륜·볼·케이지 조립체다. 대표 에셋에는 관통·접합·재질 차이·반복 구조가 있어야 하고, 단독 볼의 성공을 그 검증으로 재사용해서는 안 된다. 안정적 ball ID와 기준 좌표·분리/복원 관계를 먼저 계약하고 실제 생성·국부 편집·Blender 납품을 연결해야 한다.

그 뒤에 필요한 공통 기능만 Domain Pack 코어로 추출한다. 두 Pack capability 조합, 분야 간 단위/좌표 충돌, native 표현과 표시용 파생 메시의 관계, 기어 involute/feature ID, USD/STEP/IFC는 미구현이다. 독립 인간 전문가 평가, 실물 형상 충실도, 제조 정확도, 물리 성능은 검증하지 않았다.


2026-10-02 추가: 선언 기하·베어링 조립체의 현재 구현과 새 검수 영수증은 [베어링 슬라이스 기록](BEARING_SLICE_STATUS.ko.md)을 따른다. 이 문서의 과거 실행 숫자·API 성공 기록을 현재 수정본 증거로 재사용하지 않는다.
