<div align="center">

# MORPHLOOM

### 이미지와 언어를 편집 가능한 3D 에셋으로 직조하는 로컬 오픈소스

**Codex 또는 Claude 하나만 사용합니다. Meshy·Tripo·전용 3D 생성 모델·외부 3D MCP는 필요하지 않습니다.**

[한국어](./README.md) · [English](./README.en.md)

[![License](https://img.shields.io/badge/license-Apache--2.0-335cff?style=flat-square)](./LICENSE)
![Tests](https://img.shields.io/badge/tests-23%20passing-28a879?style=flat-square)
![Three.js](https://img.shields.io/badge/Three.js-r179-111111?style=flat-square)
![Model weights](https://img.shields.io/badge/3D%20model%20weights-none-f05d47?style=flat-square)

</div>

---

Morphloom은 멀티모달 코딩 에이전트가 사진과 요구사항을 읽어 공통 `CharacterIR` 또는 `AssemblyIR`을 작성하고, 브라우저의 결정론적 Three.js 엔진이 실제 메시를 컴파일하는 방식입니다. 결과물은 단일 렌더가 아니라 **부품 이름·실물 단위·재질·토폴로지·전기 연결 정보를 가진 편집 가능한 GLB**입니다.

> 현재 상태는 `v0.3 alpha`입니다. 제품 시각화, 게임 프리비즈, 후편집 가능한 베이스 메시를 목표로 합니다. 제조 승인 CAD, 인물 스캔, 회로 설계 검증을 대체한다고 주장하지 않습니다.

## 핵심 결과

| 에셋 | 검증된 결과 |
|---|---:|
| 사실적 인체 베이스 | 14,517 skin vertices · 38개 거시/치수 모프 |
| 단일 사진 웹 히어로 | 48,156 tris · 139개 명명 상세 · 참조 액션 포즈 · `hex-knit`/렌즈/웹 PBR 분리 |
| 스마트폰 분해도 | 164개 독립 부품 · 142,480 tris · 카메라 부품 39개 · watertight 220/220 메시 |
| 스마트폰 배선 | 개별 도체 28/28 연결 · 필수 포트 56/56 · 부유 끝 0 |
| 스마트폰 표면 | PBR finish 13종 · micro-normal 219/220 · 이방성 반사 재질 111개 |
| 장식 단검 | 16개 부품 · 18,930 tris · watertight 16/16 |
| 첨부 이미지 파생 냉각 장치 | 24개 원본 부품 → 67개 렌더 부품 · watertight 153/153 메시 · 개별 도체 43/43 · 필수 포트 86/86 |
| 출력 | GLB · PNG · CharacterIR/AssemblyIR JSON |

## 사진을 넣으면 바로 3D가 만들어지나요?

정확히는 두 단계입니다.

```text
사진 + 실제 치수
      ↓  Codex 또는 Claude가 시각 근거를 판독
CharacterIR / AssemblyIR
      ↓  Morphloom 로컬 컴파일러
메시 + 재질 + 부품 트리 + 배선 + 품질 게이트
      ↓
GLB + PNG + IR
```

- 웹 화면에는 최대 24장·총 96MB의 사진을 함께 넣을 수 있습니다. 파일은 로컬에서 해상도·구도·노출을 검사합니다.
- 정면·후면·좌·우·상·하단 촬영 현황을 표시하고, 분해도·부품·재질·치수 사진을 역할별로 분류합니다.
- 같은 부품의 근접 사진에는 ASCII `component_id`를 지정합니다. `SAVE EVIDENCE`는 파일명과 역할을 `morphloom.evidence/0.1` JSON으로 내보내며 이미지 원본이나 로컬 URL은 포함하지 않습니다.
- 브라우저 자체가 몰래 외부 LLM을 호출하지는 않습니다. 이미지 이해와 IR 작성은 저장소를 연 **Codex 또는 Claude**가 담당합니다.
- 만들어진 IR을 `LOAD IR`로 열면 실제 메시가 컴파일되고, 실패한 토폴로지·빈 포트·떠 있는 전선은 품질 게이트에서 차단됩니다.
- OpenAI의 공식 API도 텍스트·이미지 입력과 JSON 출력을 지원하지만, Morphloom 기본 경로는 별도 API 키 없이 현재 코딩 에이전트를 사용합니다. [OpenAI 공식 문서](https://developers.openai.com/api/reference/cli/resources/responses/methods/create)

### 이번 첨부 이미지 점검

사용자가 제공한 2038×1268 전자 냉각 어셈블리 이미지를 실제 회귀 사례로 사용했습니다. `COOLER / 03` 프리셋은 이미지에서 읽힌 냉각판, 접촉패드, TEC1-12706, 구리 베이스, AXP90 핀스택·히트파이프, 92 mm 팬, ESP32-S3, ADC, MUX, 센서, 전력 감시 및 드라이버를 재구성합니다.

| 판정 항목 | 결과 |
|---|---:|
| 원본 해상도 | 2038×1268 |
| 구조 부품 | 24 |
| 렌더 부품 | 67 |
| 삼각형 | 124,664 |
| 개별 도체 | 43/43 연결 |
| 필수 전기 포트 | 86/86 연결 |
| 떠 있는 전선 / 열린 필수 포트 | 0 / 0 |
| 실제 부품 위 포트 | 86/86 |
| 단자 중심 최대 오차 | 0.0001 mm 미만 |

보이지 않는 바닥면, 정확한 체결 구조, 실제 PCB 패턴과 배선 경로는 사진 한 장으로 측정할 수 없으므로 `inferred`로 기록합니다. 원본 이미지는 권리가 불명확해 저장소에 재배포하지 않습니다.

## 30초 실행

```bash
npm ci
npm run dev
```

브라우저에서 표시된 로컬 주소를 엽니다.

- `PHONE / 01` — 스마트폰 164부품·28개 도체 분해도
- `BLADE / 02` — 가변 두께 검신과 장식을 가진 단검
- `COOLER / 03` — 첨부 이미지에서 파생한 전기 연결 회귀 사례
- `HUMAN` — CC0 인체 토폴로지와 로컬 모프
- `WEB HERO / 04` — 마스크·렌즈·웹 슈트·참조 액션 포즈 단일 사진 회귀 사례

검증 명령:

```bash
npm test
npm run benchmark
npm run build
```

## 전선이 실제로 연결됐다는 의미

전선은 화면에 보이는 곡선만이 아닙니다. `AssemblyIR.electrical`은 다음 정보를 보존합니다.

- 소유 부품과 핀 이름을 가진 `port`
- `power`, `ground`, `data`, `rf`, `audio`, `sensor`, `control` 신호 분류
- 양 끝 포트, 네트 이름, 직경, 색, 차폐 여부를 가진 개별 `wire`
- 부품 로컬 좌표에서 계산되는 정확한 단자 위치와 소유 부품 경계 검사
- 필수 포트 미연결, 존재하지 않는 포트 참조, 신호 불일치, 포트 과부하, 단자 이탈 자동 검사

각 도체는 독립적으로 선택 가능한 폐쇄형 메시입니다. 컴파일러가 전선의 시작·끝 캡 중심과 단자 좌표를 다시 측정하며, 허용 오차를 넘으면 빌드를 실패시킵니다.

## 반사각을 결정하는 PBR 미세 표면

`surface-system.ts`는 단순한 색상 이름 대신 표면의 빛 반응을 컴파일합니다. 현재 20개 finish를 제공합니다.

| Finish | 반사 특성 |
|---|---|
| `brushed-metal` | 방향성 가공결 · 높은 anisotropy · 미세 roughness 변화 |
| `anodized-metal` | 산화 피막 clearcoat · 입자형 micro-normal |
| `sapphire` | IOR 1.76 · AR iridescence · 얇은 보호창 transmission |
| `optical-glass` | IOR 1.52 · 저거칠기 · 투과/코팅 반사 |
| `pcb-soldermask` | 솔더마스크 orange-peel · 낮은 금속성 · 얇은 clearcoat |
| `machined-copper` | 방향성 절삭결 · 구리 금속 반사 |
| `rubber`, `leather`, `wood` | 재질별 sheen과 비금속 미세결 |
| `skin`, `fabric`, `hair` | 피부 미세결, 직물 섬유, 모발 방향성 반사 |
| `hex-knit` | 육각 직조 높이장·거칠기 변화·sheen을 결합한 슈트 각도 반사 |

- 64×64 절차적 normal/roughness map은 고정 seed로 생성되어 실행마다 동일합니다.
- 카메라 베젤·사파이어 창·내부 렌즈·플래시·LiDAR는 자동 이름 추정이 아니라 명시적 표면값을 사용합니다.
- 표면 메타데이터는 material `userData`에 기록되어 GLB에서 finish와 PBR 수치를 추적할 수 있습니다.
- `Beauty`는 PBR 표면을, `Clay`는 형상을, `X-Ray`는 내부 구조를 점검하는 용도입니다.

현재 값은 물리적으로 타당한 프리셋이지 실제 시편을 고니오리플렉토미터로 측정한 BRDF 데이터는 아닙니다. 특정 제품과 정확히 맞추려면 교차편광 사진, 다중 조명 촬영 또는 제조사 재질 데이터가 추가로 필요합니다.

## Codex 하나로 이미지 → 에셋

1. 저장소를 Codex에서 열고 정면·후면·측면 또는 분해 이미지를 첨부합니다.
2. 실제로 아는 전체 치수와 부품 목록을 함께 제공합니다.
3. 다음처럼 요청합니다.

```text
AGENTS.md를 따르고 첨부 이미지를 AssemblyIR로 만들어줘.
보이는 모든 정비 가능 부품을 분리하고, 전선마다 from/to 포트를 지정해.
보이지 않는 형상은 inferred로 표시하고 npm test, benchmark, build를 통과시켜.
```

4. 생성된 IR을 화면의 `LOAD IR`로 열어 부품 선택·분해·회전 후 GLB를 내보냅니다.

여러 사진을 사용하는 제품은 먼저 웹 화면에서 6면·분해도·부품 사진을 추가하고 역할과 `component_id`를 지정한 뒤 `SAVE EVIDENCE`를 실행합니다. 생성된 `morphloom-evidence.json`과 원본 사진들을 같은 파일명으로 에이전트에 전달하면 반복 촬영된 부품이 하나의 AssemblyIR 노드로 병합됩니다. 누락 시점, ID 없는 부품 사진, 낮은 입력 품질은 `EVIDENCE` 단계를 `BLOCKED`로 유지합니다.

## Claude 하나로 사용

`CLAUDE.md`가 같은 공급자 중립 계약을 제공합니다. Codex와 Claude 모두 `morphloom.assembly/0.1` 또는 `morphloom.character/0.1`을 사용하므로 에이전트를 바꿔도 메시 엔진은 바뀌지 않습니다.

## 지원 형상 연산

| 연산 | 용도 |
|---|---|
| `roundedBox` | 프레임, 칩, 배터리, 외장 |
| `cylinder`, `sphere`, `torus` | 렌즈, 패스너, 링, 보석 |
| `extrude` | 측정된 2D 윤곽 판재와 장식 |
| `lathe` | 손잡이, 폼멜, 회전체 |
| `tube` | 케이블, 각인, 히트파이프, 나선 래핑 |
| `bladeLoft` | 길이별 폭·횡단 프로파일을 갖는 가변 두께 칼날 |

모든 AssemblyIR 입력은 mm입니다. 외부 IR은 최대 500개 부품, 2,000개 포트, 2,000개 전선과 제한된 세그먼트·수치 범위로 검증합니다.

## img2threejs 직접 비교

사용자가 지정한 [Talon Knife · Doppler Ruby](https://img2threejs.io/#/x/talon-doppler-ruby)를 공개 기준으로 사용했습니다.

| 항목 | Morphloom Ornate Knife | img2threejs Talon |
|---|---:|---:|
| 삼각형 | 18,930 | 약 25,000 |
| 상위 편집 부품 | 16 | 5 |
| 가변 두께 칼날 | 예 | 예 |
| 자동 매니폴드 검사 | 16/16 통과 | 공개 화면에 수치 없음 |
| 공통 JSON 형상·전기 IR | 예 | 데모별 TypeScript |
| 사진 추적 실루엣 | 에이전트 입력에 따라 달라짐 | 예, 이 데모의 강점 |
| 사진 투영 마감 | 예정 | 예, 이 데모의 강점 |

Morphloom은 **부품 세분화, 재사용 가능한 IR, 전기 연결 의미론, 자동 토폴로지 증거**에서 더 강합니다. Talon 데모는 **특정 사진과의 실루엣·표면 일치**에서 더 강합니다. 모든 시각 품질에서 이미 우월하다고 과장하지 않습니다.

## 스파이더맨 단일 사진 정직성 테스트

[Wikimedia Commons의 960×1280 코스프레 사진](https://commons.wikimedia.org/wiki/File:Spider-Man_cosplay.jpg)(ManoSolo13241324, CC BY-SA 4.0) 한 장을 고정 회귀 자료로 사용했습니다. 파일명 근거로 `WEB HERO / 04`를 선택하며, 전진한 양손·비대칭 팔 높이·상체 전경·엇갈린 무릎을 `reference-action` 포즈로 기록합니다. 보이는 마스크, 좌우 광학 렌즈, 방사형 웹, 적·청 패널, 가슴 문양은 139개의 이름 있는 편집 단위로 생성되고, 파란 슈트에는 각도에 따라 반사가 달라지는 `hex-knit` 미세 노멀/거칠기 맵을 적용합니다.

| 같은 시점에서 확인한 항목 | 현재 판정 |
|---|---|
| 적색 마스크와 큰 백색 렌즈 | 재구성됨 · 렌즈 IOR/clearcoat 분리 |
| 적색 중앙 패널·청색 측면 패널 | 재구성됨 · 정점색 기반 편집 가능 |
| 마스크/흉부 웹과 가슴 문양 | 독립 폐쇄 메시로 재구성됨 |
| 전진한 손과 비대칭 다리 | 단일 시점 추정 포즈로 재구성됨 |
| 육각 직조 질감 | 절차적 `hex-knit` PBR로 추정 |
| 정확한 손가락 제스처·피부 웨이트 | 아직 생산 기준 미달 |
| 후면 패턴·실제 봉제선·정확한 원단 피치 | 사진에 없어 `inferred` |

**결론:** 게임 프리비즈와 후편집 베이스로는 이전의 일반 인체 출력보다 분명히 고도화됐지만, 한 장만으로 동일 인물·정확한 손가락·후면까지 자동 복원하는 완성품은 아닙니다. 실무 납품 전 검수를 작게 만들려면 정면·후면·좌·우, 손 근접, 마스크·원단 매크로 사진과 실제 키를 추가해야 합니다. UI의 `89/100`은 토폴로지·재질·내보내기 빌드 점수이며 사진 유사도 점수로 오해하면 안 됩니다.

## 현재 한계

- 한 장의 사진만으로 숨은 부품, 정확한 두께, 공차, 핀 배열을 측정할 수 없습니다.
- 현재 배선 검사는 기하·포트·신호 클래스 연결성 검사이며, SPICE 시뮬레이션이나 PCB ERC는 아닙니다.
- 사람은 편집 가능한 사실적 베이스 단계입니다. 얼굴 동일성, 실제 skin weights, facial rig, 의상 시뮬레이션은 다음 품질 게이트입니다.
- 사진 기반 de-light, 다중 시점 카메라 캘리브레이션, UV atlas/bake, LOD, 충돌 메시, Blender/Unity/Unreal 왕복 검증이 남아 있습니다.

## 프로젝트 구조

```text
src/engine/assembly-compiler.ts  공통 형상 IR 컴파일러
src/engine/connectivity.ts       포트·네트·개별 도체와 연결성 검사
src/engine/surface-system.ts     PBR finish·micro-normal·roughness·이방성 반사
src/engine/reference-set.ts      다중 시점·부품 사진 증거 매니페스트
src/engine/cooling-assembly.ts   첨부 이미지 파생 회귀 사례
src/engine/product.ts            스마트폰 164부품 예제
src/engine/knife.ts              장식 단검 IR 예제
src/engine/character.ts          CC0 인체 메시·모프·참조 포즈 변형
src/engine/web-hero.ts           마스크·렌즈·웹·가슴 문양 편집 단위
src/engine/topology.ts           메시 무결성 검사
schemas/                         에이전트용 JSON 계약
benchmarks/                      재현 가능한 수치와 비교 정책
```

## 라이선스

코드는 [Apache-2.0](./LICENSE)입니다. 포함된 `oxihuman-core-v1.ohpk` 데이터는 CC0-1.0입니다. 출처와 변경 사항은 [`NOTICE`](./NOTICE)와 provenance 파일에 기록했습니다.

---

<div align="center">

**사진을 그럴듯한 한 장의 렌더로 끝내지 않고, 검사하고 고칠 수 있는 3D 구조로 만듭니다.**

</div>
