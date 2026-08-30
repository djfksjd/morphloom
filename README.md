# Morphloom

**Codex 또는 Claude 하나만으로 편집 가능한 3D 사람과 제품 어셈블리를 만드는 오픈소스 로컬 파이프라인.**

Morphloom은 Meshy, Tripo, 전용 3D 생성 모델, 외부 3D MCP를 호출하지 않습니다. 멀티모달 코딩 에이전트가 사진과 요구사항을 읽어 공통 `CharacterIR` 또는 `AssemblyIR`을 작성하고, 브라우저의 결정론적 Three.js 엔진이 실제 메시를 컴파일합니다.

> 상태: `v0.1 alpha`. 제품 시각화·게임 프리비즈·후편집 가능한 베이스 메시를 목표로 합니다. 제조 승인 CAD나 인물 스캔을 대체한다고 주장하지 않습니다.

## 지금 되는 것

| 영역 | 현재 구현 |
|---|---|
| 사실적 인체 베이스 | MakeHuman 계열 CC0 토폴로지, 14,517 skin vertices, 38개 거시/치수 모프 |
| 인체 편집 | 키, 체격, 근육, 성별 블렌드, 나이, 어깨·다리·머리 비율, 헤어·슈트 |
| 제품 어셈블리 | 부품 이름·재질·설명·실물 mm 단위·독립 transform을 가진 메시 트리 |
| 스마트폰 예제 | 90개 부품, 42,384 tris, 카메라 부품 22개, 회로 부품 42개 |
| 장식 단검 예제 | 16개 부품, 18,930 tris, 가변 두께 검신·혈조·가드·가죽 래핑·폼멜·상감 |
| 실무 토폴로지 게이트 | watertight, boundary edge, non-manifold edge, degenerate triangle 자동 검사 |
| 내보내기 | GLB, PNG, CharacterIR/AssemblyIR JSON |
| 개인정보 | 업로드 이미지는 기본적으로 브라우저 로컬에서만 읽음 |

## 30초 실행

```bash
npm ci
npm run dev
```

브라우저에서 표시된 로컬 주소를 열고 `PRODUCT` 또는 `HUMAN`을 선택합니다. `BLADE / 02`는 장식 단검, `PHONE / 01`은 휴대폰 분해 예제입니다.

검증 명령:

```bash
npm test
npm run benchmark
npm run build
```

## Codex만 사용하는 방법

1. Codex에 정면·측면·3/4 사진과 실제 치수를 첨부합니다.
2. “`AGENTS.md`를 따르고 이 물체를 AssemblyIR로 만들어줘. 보이지 않는 부품은 inferred로 표시해”라고 요청합니다.
3. Codex가 JSON이나 빌더를 작성하고 테스트합니다.
4. 편집기의 `LOAD IR`로 JSON을 열어 회전·분해·부품 선택 후 GLB를 내보냅니다.

## Claude만 사용하는 방법

동일한 저장소에서 `CLAUDE.md`가 같은 계약을 제공합니다. 두 에이전트는 서로 다른 포맷을 만들지 않고 `morphloom.assembly/0.1` 또는 `morphloom.character/0.1`만 출력합니다. 에이전트 교체가 메시 엔진 교체를 의미하지 않습니다.

## AssemblyIR가 지원하는 형상 연산

- `roundedBox`: 프레임, 칩, 배터리, 외장
- `cylinder`, `sphere`, `torus`: 렌즈, 패스너, 링, 보석
- `extrude`: 측정된 2D 윤곽을 가진 판재와 장식
- `lathe`: 손잡이, 폼멜, 회전체
- `tube`: 케이블, 각인, 나선 래핑, 곡선 장식
- `bladeLoft`: 길이별 폭과 횡단 grind profile로 만드는 가변 두께 칼날

모든 입력은 mm이고 컴파일러가 미터로 변환합니다. 외부 IR은 500개 부품, 512 세그먼트, 제한된 수치 범위로 검증해 브라우저 메모리 폭주를 막습니다.

## 사진 한 장에서 가능한 것과 불가능한 것

사진은 보이는 실루엣, 색, 부품 위치, 비례의 근거입니다. 사진에 보이지 않는 내부 회로, 체결 구조, 칼날 두께는 측정할 수 없으므로 에이전트의 제품 지식이나 공개 사양을 사용한 **추정(inference)** 입니다. 정확한 복제품이 필요하면 정면·후면·측면 이미지, 전체 치수, 알려진 부품 목록을 함께 제공해야 합니다.

실제 제조에는 공차, 나사산, 재료 규격, 간섭, 열·구조 해석과 전문 CAD 검토가 별도로 필요합니다. Morphloom의 “실무용”은 깨끗한 메시, 명명된 부품, 실물 단위, 후편집·렌더·게임 엔진 전달이 가능한 수준을 뜻합니다.

## img2threejs 직접 비교

사용자가 지정한 [Talon Knife · Doppler Ruby](https://img2threejs.io/#/x/talon-doppler-ruby)를 공개 기준으로 사용했습니다.

| 항목 | Morphloom Ornate Knife | img2threejs Talon |
|---|---:|---:|
| 삼각형 | 18,930 | 약 25,000 |
| 상위 편집 부품 | 16 | 5 |
| 가변 두께 칼날 | 예 | 예 |
| 자동 매니폴드 검사 | 16/16 통과 | 공개 화면에 수치 없음 |
| 공통 JSON 형상 IR | 예 | 데모별 TypeScript |
| 사진 추적 실루엣 | 에이전트 입력에 따라 달라짐 | 예, 이 데모의 강점 |
| 사진 투영 마감 | 예정 | 예, 이 데모의 강점 |

현재 Morphloom은 **부품 세분화, 재사용 가능한 IR, 자동 토폴로지 증거**에서 더 강합니다. 해당 Talon 데모는 **특정 사진과의 실루엣·표면 일치**에서 더 강합니다. 따라서 “모든 시각 품질에서 이미 우월하다”는 식의 과장은 하지 않습니다. 벤치마크 결과는 `npm run benchmark`로 재현할 수 있습니다.

## 구조

```text
reference image + prompt
          ↓ Codex or Claude
   CharacterIR / AssemblyIR
          ↓ local compiler
 topology → morph/loft → materials → quality gates
          ↓
      GLB + PNG + IR
```

- `src/engine/assembly-compiler.ts`: 공통 제품 IR 컴파일러와 입력 제한
- `src/engine/knife.ts`: 장식 단검 IR 예제
- `src/engine/product.ts`: 고밀도 스마트폰 부품 예제
- `src/engine/character.ts`: CC0 인체 메시, 보조 형상 제거, 헤어·리그 프리뷰
- `src/engine/topology.ts`: 메시 무결성 검사
- `schemas/`: 에이전트가 출력해야 하는 JSON 계약
- `benchmarks/`: 비교 기준과 정직한 판정

## 다음 품질 게이트

- 사진 기반 전·후면 텍스처 투영과 de-light
- 다중 시점 윤곽 피팅과 카메라 캘리브레이션
- 구멍/차집합을 포함한 견고한 CSG
- 실제 humanoid skin weights, facial rig, 게임 엔진 애니메이션 검증
- UV atlas, bake, LOD, collision mesh
- Blender/Unity/Unreal 왕복 테스트

## 라이선스

코드는 Apache-2.0입니다. 포함된 `oxihuman-core-v1.ohpk` 데이터는 CC0-1.0입니다. 자세한 출처와 변경 사항은 `NOTICE` 및 `public/assets/oxihuman-core-v1.provenance.json`에 기록했습니다.
