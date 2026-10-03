<div align="center">

# MORPHLOOM

### 선언형 IR로 생성·편집·검수하는 로컬 3D 에셋 도구

[한국어](./README.md) · [English](./README.en.md)

[![License](https://img.shields.io/badge/license-Apache--2.0-335cff?style=flat-square)](./LICENSE)
![Stage](https://img.shields.io/badge/stage-v0.4%20alpha-d69526?style=flat-square)
![Three.js](https://img.shields.io/badge/Three.js-r179-111111?style=flat-square)

</div>

Morphloom은 사진·도면·실측값·자연어 요구를 선언형 IR로 정리하고, 로컬 기하 엔진에서 메시와 PBR 재질을 생성하는 오픈소스 도구입니다. Codex/Claude 같은 개발 에이전트가 구조와 파라미터를 제안하고, 엔진이 형상 계산·반복 배치·검증을 수행합니다. 기본 경로에 유료 3D 생성 API가 필요하지 않습니다.

**현재는 `v0.4 alpha`입니다. 임의 사진의 정확한 3D 복원, 모든 분야의 실무 납품, 제조용 CAD/BREP 정확도를 보장하지 않습니다.** 특정 검사 통과나 많은 폴리곤을 전체 품질의 증거로 취급하지 않습니다.

## 현재 상태

아래는 **2026-10-04 단일 native source 평행이동 작업**의 현재 실행 결과입니다.

| 범위 | 확인된 결과 | 제한 |
|---|---|---|
| 게시본 테스트·타입 검사·벤치마크·빌드 | 108개 파일 / 779개 테스트 PASS, `check`·`benchmark`·`build` PASS | 임의 입력의 품질 인증이 아님 |
| 이동 결과의 별도 editable sourceJSON | 작은·기본·큰 베어링과 기어 4사례 PASS | 단일 embedded native source, identity 부모, 선언된 평행이동만 |
| 실제 브라우저 편집 흐름 | 저장·새 세션 재열기·GLB 반복 생성·추가 편집·Undo/Redo PASS4 | 현재 이동 GLB의 원본 참고 metadata는 수정하지 않음 |
| 원본 결합 UV·중요 특징 검사 | 기존 24개 톱니 검사와 한 톱니 손상 FAIL 유지 | 5% 임계값 유지; 전체 평균으로 대체하지 않음 |
| 파일 교체·지연·읽기 실패·unmount | 수정 source 생성 6사례, 기존 검사 지연 3사례 PASS | 이전 결과·다운로드를 새 선택에 재사용하지 않음 |
| 실제 파일 | 원본·이동본·재생성본 12 GLB 엄격 검사 PASS, Blender 첫 import 대응 PASS4 | Blender raw normal 충실도는 별도 FAIL |
| 전체 납품·production | **미충족** | 현재 `quality:gate`·`quality:production` exit 1, 기존 전역 영수증 수락 실패 유지 |

[구현 범위·현재 해시·실행 증거](./docs/TRANSLATED_SOURCE_STATUS.ko.md)를 확인하세요. renderer 0.12는 corner-angle normal의 실행 환경 차이를 제거했으며, 검증하지 않은 이전 버전 결과를 성공으로 승격하지 않습니다.

Blender 첫 import의 normal 오차와 회전·스케일 부모의 변환 대응 문제도 남아 있습니다. 기존 `releaseAllowed` 기준과 검사 임계값을 완화하지 않았습니다.

- [체크포인트·모델링 수학과 한계](./docs/CHECKPOINT_20261003_2340.ko.md)
- [현재 작업 상태](./docs/MORPHLOOM_WORK_STATE.ko.md)
- [원본/현재 GLB UV 검사](./docs/BOUND_REFERENCE_UV_STATUS.ko.md) · [검사 UI](./docs/BOUND_REFERENCE_UV_UI_STATUS.ko.md)
- [현재 엔진 검사 증거](./benchmarks/modeling-slices-20261003/bound-reference-uv/verification.json) · [UI 증거](./benchmarks/modeling-slices-20261003/bound-reference-uv-ui/verification.json)

## 빠른 시작

필요 환경: Node.js **20.19 이상**. Blender 등 대상 앱 검증은 별도 설치가 필요합니다.

```bash
npm install
npm run dev
```

[http://127.0.0.1:4173](http://127.0.0.1:4173)을 엽니다. 검수 뷰어에는 `?asset=cooler`처럼 예제 자산을 지정할 수 있습니다.

| 화면 | 주소 | 용도 |
|---|---|---|
| 검수 뷰어 | `/` | 결과 보기, 측정, 검사, 형식별 내보내기 |
| 부품·요소 편집기 | `/?editor=elements` | Domain Pack 생성, ID 선택, 파라미터 편집, isolate, undo/redo, 저장 |
| 복합 프로젝트 편집기 | `/?editor=workspace` | 자산별 편집·선택·isolate와 별도 편집 세션 저장 |
| 깊이 가시 표면 편집기 | `/?editor=depth` | 명시적 카메라·보정 자료가 있는 상대 깊이의 실험적 검수 |

웹에는 좁은 생성·편집 흐름이 포함됩니다. 범용 DCC나 임의 프롬프트만으로 모든 형상을 만드는 웹 서비스는 아닙니다.

## 생성·편집 원리

```text
사진 · 도면 · 측정 · 요구사항
             ↓ 개발 에이전트 / 선언형 입력
 CharacterIR · AssemblyIR · Elements / Workspace source
             ↓ 로컬 엔진
 파라메트릭 기하 · 거리장 · 메시 · PBR 재질
             ↓
 부품 편집 · 치수/실루엣/토폴로지/UV 검수
             ↓
 원본 JSON + 실제 납품 파일 + 검사 보고서
```

- IR은 안정적인 부품 ID와 단위·좌표계·근거를 보존합니다. 기하 계산에 임의 생성 코드를 실행하는 방식보다 선언된 연산을 우선합니다.
- 지원 연산에는 extrude, lathe, tube, 제한된 loft·bevel, implicit surface와 visual hull 등이 있습니다. 모든 CAD 연산이나 NURBS/BREP 커널의 지원을 뜻하지 않습니다.
- 기어는 모듈·잇수·압력각을 사용하는 제한된 인벌류트 스퍼기어입니다. 치근 근사와 지원 범위가 있으며 제조 승인용이 아닙니다.
- 베어링은 내·외륜·홈·포켓·개별 볼의 authored 시각화입니다. 간극·홈 비율은 제조사 실측이나 하중·수명 인증이 아닙니다.
- 생성된 메시와 원본 파라미터는 별개입니다. GLB의 임의 Blender 편집을 원본 IR에 자동 반영하지 않습니다.

선택적 로컬 Distill-Any-Depth-Small worker는 상대 역깊이를 출력합니다. 별도 가중치·환경과 실측 보정 자료가 필요하며 기본 의존성이 아닙니다. 단일 사진의 후면·내부·정확한 두께 복원을 보장하지 않습니다. [깊이 표면 상태](./docs/DEPTH_SURFACE_STATUS.ko.md)를 참고하세요.

## 대표 편집 흐름

`/?editor=elements`에서 Domain Pack을 선택하고 생성합니다. 생성 전 기존 수정본을 저장하세요.

1. 부품 또는 요소의 안정적인 ID를 선택합니다.
2. 지원되는 수치·기하·재질 파라미터를 변경하고 적용·취소합니다.
3. isolate와 검수 뷰를 사용하고, undo/redo로 비교합니다.
4. 원본 JSON을 저장해 다시 엽니다. 선택 메시 또는 프로젝트 GLB와 보고서를 내보냅니다.

기어·베어링, 새·털 예제와 확장용 Domain Pack이 있습니다. 지원 도구·표현은 팩마다 다릅니다. 등록 자체가 납품 검증은 아니며 일반적인 조립 구속·운동학·물리 시뮬레이션까지 포함하지 않습니다.

- [Domain Pack SDK와 버전별 계약](./docs/DOMAIN_PACK_SDK.ko.md)
- [Workspace 세션](./docs/WORKSPACE_SESSION_STATUS.ko.md) · [isolate](./docs/WORKSPACE_ISOLATE_STATUS.ko.md)
- [곡면 법선 옵션과 DCC 제한](./docs/CORNER_NORMAL_STATUS.ko.md)

### 원본/수정 GLB UV 검사

편집기의 **Original/current GLB UV inspection**을 펼치고 원본·수정 GLB를 선택합니다. `Inspect bound reference UV`로 검사하고 보고서를 저장합니다. 파일은 로컬에서 읽으며 뷰포트 프로젝트를 수정하지 않습니다.

이 검사는 [선언형 source-preserving translation 어댑터](./docs/SOURCE_SPEC_REFERENCE_STATUS.ko.md)의 결과를 대상으로 합니다. 임의 DCC 수정 파일, 잘못된 원본, 지원하지 않는 표현은 거부합니다. 통과하더라도 현재 GLB의 IR은 **before-edit reference**이며 `currentEditableIRAvailable: false`입니다. UV 합격은 전체 납품 합격이 아닙니다.

검사가 통과하면 **Generate modified native source JSON** → **Save modified source JSON**을 사용합니다. 새 세션의 **Load JSON**으로 이 파일을 다시 열어 편집·Undo/Redo·GLB 내보내기를 계속할 수 있습니다. 원본과 이동 GLB는 보존되며, 편집 가능한 것은 별도로 검증한 새 sourceJSON입니다. 지원하지 않는 입력은 저장을 차단합니다.

CLI에서도 동일한 검사를 실행할 수 있습니다. 보고서 경로는 새 파일이어야 합니다.

```bash
npx vite-node scripts/bound-reference-uv-audit.ts original.glb translated.glb new-report.json
```

## Job과 사진 표면 준비

[`morphloom.job/0.1`](./schemas/morphloom-job.schema.json)은 입력 파일과 SHA-256을 연결하는 선언형 작업 계약입니다. 아래 경로는 사용자가 준비하는 예시입니다.

```bash
npm run morphloom -- inspect --job work/job.json
npm run morphloom -- build --job work/job.json --out outputs/run-001
npm run surface:prepare -- --input ./reference.jpg --output ./outputs/surface.json
```

사진 표면의 색·normal·roughness·미세 높이는 밝기에서 추정한 표현입니다. 보정된 깊이·물성 측정이 아니며 원본 사진의 조명과 색 영향을 받습니다. 요청·근거·실행 상태를 확인하고, `review-pass`를 `delivery-pass`나 `releaseAllowed: true`와 혼동하지 마세요.

## 내보내기와 대상 앱

| 형식 | 표현·제한 |
|---|---|
| GLB | 메시·PBR·지원되는 리그/모프/애니메이션. 편집 가능한 원본 IR은 별도 JSON으로 보존 |
| OBJ / PLY | 정적 메시 교환. 재질·텍스처 보존 범위는 형식과 앱별로 확인 |
| STL | mm·Z-up 메시 참조. STEP/BREP 제조 솔리드가 아님 |
| USDZ | AR 교환. 지원하지 않는 표면 표현은 별도 검사 필요 |
| SVG / PNG | 2D 검수 시트·렌더 |
| ZIP | 지원 경로의 메시·원본·보고서 묶음 |

형식별 기능과 내보내기 경로는 다릅니다. 파일 생성만으로 대상 앱 호환성을 인정하지 않습니다. 과거 Blender·Godot·슬라이서 사례는 해당 엔진 버전·입력 해시의 증거이며 현재 모든 에셋의 성공으로 재사용할 수 없습니다. Unity·Unreal 등은 실제 확인한 범위만 주장합니다.

## 검증 명령

```bash
npm run check
npm test
npm run build
npm run quality:gate
npm run quality:production
npm run gltf:validate -- path/to/asset.glb
```

선택적 대상 앱 검증에는 설치된 Blender 등의 실행 파일이 필요합니다. 추가 benchmark 명령은 [package.json](./package.json)에서 확인하세요.

테스트 통과, 내부 점수, 규격 검사는 독립 전문가 평가나 실측 정확도를 대체하지 않습니다. 과거 잠금 벤치마크의 100%를 현재 전체 production 상태로 표시하지 않습니다. 날짜·엔진 버전·입출력 해시·실행 범위가 맞는 보고서만 증거로 사용합니다. [벤치마크 정책](./benchmarks/README.md)과 [비교 정책](./docs/COMPETITIVE_BENCHMARK.md)을 참고하세요.

## 알려진 한계

- 단일 사진의 숨은 형상은 추정입니다. 실루엣만으로 모든 오목한 구조를 복원할 수 없습니다.
- 깊이 표면은 명시적 카메라·보정 계약이 필요한 실험적 열린 표면입니다. 현재 일반 납품 승인 경로가 아닙니다.
- 캐릭터는 후편집·프리비즈 기반입니다. 실사 인체·FACS·근육·의류 물리는 별도 범위입니다.
- 전기 연결과 건축 검사는 회로 안전·구조해석·현장 승인 대신 사용할 수 없습니다.
- 표면 외관의 PBR 값으로 실제 밀도·강도·마찰·물성을 확정하지 않습니다.
- CAD/BREP·NURBS·IFC·USD 등 모든 표현과 교환 어댑터를 지원한다고 주장하지 않습니다.

## 데이터와 라이선스

뷰어의 로컬 파일 입력은 외부 서버에 업로드하지 않습니다. 개발 에이전트나 사용자가 별도 외부 모델을 호출하는 경로는 별도로 검토해야 합니다. 메모리에서 읽은 파일과 저장소·다운로드에 저장한 파일은 다르며, 로컬 파일은 사용자가 관리합니다.

코드는 [Apache-2.0](./LICENSE)입니다. 포함 데이터와 참고 코드의 출처·라이선스는 [NOTICE](./NOTICE)를 확인하세요. 선택적 외부 모델의 코드·가중치 라이선스는 별도입니다.

### 선택형 Blender normal 보존 import

Blender5.2.1에서 검증한 별도 로컬 도구로 원본 Float32 normal을 보존한 .blend와 SHA 영수증을 생성합니다. 기본 import 경로와 구분되며 texture·rig·animation·morph는 지원하지 않습니다. [사용법·제한·현재 증거](docs/BLENDER_FIRST_IMPORT_STATUS.ko.md)를 확인하세요. 전체 production 승인이나 DCC 편집의 IR 역변환을 뜻하지 않습니다.

Interchange repair CLI는 원본과 기존 출력의 덮어쓰기를 거부합니다. 재실행은 새 출력 경로를 사용하세요. [원본 보존 계약·현재 파일 검증](docs/INTERCHANGE_OUTPUT_PRESERVATION_STATUS.ko.md).
