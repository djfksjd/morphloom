<div align="center">

# MORPHLOOM

### Codex 또는 Claude로 만드는 편집 가능한 로컬 3D 에셋

[한국어](./README.md) · [English](./README.en.md)

[![License](https://img.shields.io/badge/license-Apache--2.0-335cff?style=flat-square)](./LICENSE)
![Tests](https://img.shields.io/badge/tests-173%20passing-28a879?style=flat-square)
![Three.js](https://img.shields.io/badge/Three.js-r179-111111?style=flat-square)
![Benchmark](https://img.shields.io/badge/locked%20benchmark-100%25-28a879?style=flat-square)

</div>

Morphloom은 사진, 도면, 실측값, 데이터시트와 자연어 설명을 `CharacterIR` 또는 `AssemblyIR`로 정리한 뒤 Three.js 메시로 컴파일합니다.

Meshy 같은 전용 3D 생성 모델 없이 **Codex 또는 Claude 하나**로 작업하며, 결과는 브라우저에서 검수하고 여러 3D 형식으로 저장합니다.

> 현재 버전은 `v0.4 alpha`입니다. 준실무 편집 베이스를 목표로 하며 제조 승인 CAD, 인물 스캔, 회로 안전 검증을 대체하지 않습니다.

## 작동 방식

```text
사진 · 도면 · 치수 · 데이터시트 · 자연어
                    ↓ Codex / Claude
         CharacterIR / AssemblyIR
                    ↓ Morphloom
      3D 메시 · PBR 재질 · 부품 · 배선
                    ↓
        로컬 검수 · 실측 · 내보내기
```

- 생성 지시는 Codex/Claude 개발 대화에서 자연어로 입력합니다.
- 로컬 웹은 생성 폼이 아니라 **결과 검수 전용 화면**입니다.
- 자료 개수는 고정하지 않습니다. 필요한 형상·크기·재질을 설명할 근거가 충분하면 됩니다.
- 근거가 부족한 부분은 임의로 통과시키지 않고 `estimated` 또는 `inferred`로 남깁니다.

## 빠른 시작

필요 환경: Node.js 20.19 이상

```bash
npm install
npm run dev
```

브라우저에서 [http://127.0.0.1:4173](http://127.0.0.1:4173)을 엽니다.

사진 기반 표면 재질을 만들 때:

```bash
npm run surface:prepare -- --input ./reference.jpg --output ./outputs/surface.json
```

생성된 JSON은 로컬 뷰어의 `OPEN RESULT`로 확인합니다. 원본 사진은 외부로 전송되지 않으며, 색상 투영·normal·roughness와 최대 16,384점의 사진 기반 높이장이 한 좌표계로 정렬됩니다.

Codex/Claude 요청 예시:

```text
이 제품 도면과 사진을 근거로 AssemblyIR을 만들어줘.
실측값은 measured, 추정값은 estimated로 구분하고
부품 이름, PBR 표면, 배선 연결, 토폴로지를 검증해줘.
```

## 로컬 뷰어 기능

- Beauty · Clay · Wire · X-Ray
- 정면 · 등각 · 평면 · 후면 보기
- 드래그 회전 · 휠 광학 확대 · `Space`+드래그 화면 이동
- 우측 하단 `+`/`−` 확대와 화면 초기화 (모델 단면 잘림 방지)
- 오른쪽 검사 패널과 하단 파이프라인 접기·펼치기
- 기존 가구를 250 mm 단위로 이동·회전·초기화
- 층별 보기와 주간·야간 광원 미리보기
- 임의 두 점 거리 측정과 주요 부재의 폭·깊이·세로 높이 치수선 (`mm`, `cm`, `m`)
- 반복 소부품을 자동 정리하는 건축 치수 오버레이
- Khronos 공식 glTF 2.0 규격 검사, 독립 glTF Transform 파서, Three.js GLB 재열기의 3중 검사
- 같은 입력의 GLB 검증은 중복 실행하지 않고, 무거운 검증은 최대 4개 대기열에서 직렬 처리하며 이전 결과가 새 화면을 덮지 않음
- 품질 차단 사유와 근거 범위 표시
- 로컬 작업 취소·재시도와 결과 저장

## 내보내기

| 형식 | 주요 용도 |
|---|---|
| GLB | Blender · Unity · Unreal · Godot · 웹 |
| OBJ | Maya · 3ds Max · Cinema 4D 등 범용 메시 |
| PLY | Blender · MeshLab · CloudCompare |
| USDZ | Apple AR Quick Look · Reality Composer |
| STL | Fusion 360과 3D 프린팅용 메시 참조 |
| SVG | Figma용 2D 부품·포락 검수 시트 |
| PNG | UI·바닥·실측 보조선을 제외한 투명 배경 현재 렌더 |
| ZIP | GLB, OBJ/STL/PLY, IR, 품질 보고서, 미리보기 묶음 |

OBJ/STL은 STEP/BREP 제조 솔리드가 아닙니다. `.blend`, `.uasset`, FBX도 대상 프로그램에서 변환해야 합니다. GLB는 Khronos 규격, 독립 glTF Transform 파싱, 로컬 Three.js 재열기를 자동 검사합니다. Blender 4.5.11 LTS는 아래 5개 분야에서 실제 임포트·재내보내기·재임포트를 검증했고, Unity·Unreal 자체 임포트는 아직 별도 검수 항목입니다.

## 현재 제공되는 예제

| 영역 | 예제 |
|---|---|
| 제품 | 164부품 스마트폰 · Galaxy Z Fold8 외관 · 장식 단검 |
| 표면 | 각진 굵은·미세 골재와 역청 홈을 실제 변위+PBR로 결합한 아스팔트 |
| 전자 조립 | 75개 도체와 150개 물리 포트를 가진 TEC 냉각 어셈블리 |
| 건축 | HABS 실측 캐빈 · 9세대 공동주택 기준층 · 편집 가능한 2층 주택 콘셉트 |
| 캐릭터 | 실제 49-bone 스켈레톤(30개 손가락 본)·손 형상 기반 스킨 웨이트·idle/이동/회전/앉기/점프/제스처/상호작용 22클립·185트랙·중립/관절 포즈 실루엣을 검증한 스킨 LOD1·충돌 프리미티브를 가진 인체 베이스 · 포즈 기반 Web Hero |

제품·건축은 실측과 설계 근거가 충분할수록 정확도가 높아집니다. 캐릭터는 현재 게임 프리비즈와 후편집 베이스 단계입니다.

## 품질 게이트

```bash
npm test
npm run quality:gate
npm run benchmark:competitive
npm run benchmark:visual-captures -- --reference reference.webp --morphloom morphloom.png --competitor img2threejs.png --competitor-threshold 48 --output benchmarks/visual-latest.json
npm run benchmark:visual-set -- --manifest captures/manifest.json --output benchmarks/visual-set-latest.json --require-claim
npm run benchmark:fixtures -- /tmp/morphloom-fixtures
npm run benchmark:blender-cross-domain -- /tmp/morphloom-fixtures
npm run build
npm run gltf:validate -- path/to/asset.glb
npm run gltf:repair -- blender-output.glb delivery.glb
npm run blender:validate -- source.glb roundtrip.glb report.json
```

현재 잠금 벤치마크:

- 전체 합격률: **100% (8/8)**
- 기술 무결성: **100% (8/8)**
- 승인·차단 판단 정확도: **100% (8/8)**
- 납품 대상 모델·브라우저 GLB: **100% (5/5)**
- 근거 부족 안전 차단: **100% (3/3)**

100%는 잠근 8개 계약을 모두 올바르게 판정했다는 뜻이며 모든 입력의 시각 품질이 100점이라는 뜻이 아닙니다. 승인 사례는 산업디자인, 도면 기반 건축, 애니메이션, 게임, 3D 프린팅을 포함합니다. 콘셉트 주택·냉각 어셈블리·단일 사진 캐릭터는 기술 검사를 통과해도 근거 부족으로 정확히 차단됩니다. 브라우저 GLB 증명은 Three.js 재열기 결과이며, 새 내보내기 경로는 여기에 Khronos 공식 Validator 오류·경고를 별도로 기록합니다.

Blender 4.5.11 LTS 실제 왕복 검증은 건축·산업디자인·전자 조립·애니메이션/게임·3D 프린팅 표면 5개를 모두 통과했습니다. 각 입력을 두 번 독립 생성한 GLB의 SHA-256도 분야별로 일치합니다. 메시·재질·이미지·형상 모멘트·스킨·49본·22개 액션·5개 얼굴 모프를 해당 분야에 맞춰 비교했고, 강체 포락 오차는 0.000 mm, 스킨 캐릭터는 0.366 mm였습니다. Blender가 일부 미세 베벨에서 잘못 만든 탄젠트는 숨기지 않고 원본 실패를 기록한 뒤 자동 복구하며, 최종 납품 바이트를 Khronos 오류·경고·정보 0 및 glTF Transform 재파싱으로 다시 막습니다. [5분야 기계 판독 결과](./benchmarks/blender-cross-domain-latest.json)를 저장하며 Unity·Unreal 자체 임포트는 아직 검증 완료로 표시하지 않습니다.

| 준실무 납품 계약 | 점수 | 실제 차단 조건 |
|---|---:|---|
| 산업디자인 | 99 | 폐쇄 토폴로지 · 유한/비퇴화 UV · 단위 노멀 · 75% 이상 PBR 미세표면 · 근거 |
| 건축 | 99 | 오목 다각형·자기교차 차단 · 실제 상부 메시 재투영 IoU·과잉/누락·중정 공백 · 폐쇄 셸 · 유한/비퇴화 UV · 80% 이상 미세표면 · 실측/도면 근거 |
| 애니메이션 | 99 | 49본 스켈레톤 · 정규화 웨이트 · 관절 변형 실측 · 22개 동작/185트랙 · 손가락 웨이트/19트랙 · loop/in-place/GLB 의미 보존 |
| 게임 | 100 | 10만 tris 예산 · 실제 스킨 LOD0/1 · 이동/점프/제스처/상호작용 22클립 · 유한 치수/본 연결/바디 교차 충돌체 · 유한/비퇴화 UV · 단위 노멀 · PBR |
| 3D 프린팅 | 100 | 폐쇄 메시 · mm 단위 · 선언 형상 ≥0.8 mm · 체적/표면적 두께 지표 ≥0.8 mm · 양의 체적 · 45° 오버행 실측 |

일반 45° 기준의 비지지 오버행 면적은 실제 삼각형 노멀로 계산합니다. 다만 최종 방향·서포트·수축·공차는 프린터와 슬라이서에 따라 달라지므로 별도 공정 검수 없이 제조 적합성을 자동 승인하지 않습니다.

Morphloom은 생성 전에 디테일·재질·검수 시점과 특징별 합격선을 잠그고, 8단계 검수에서 회귀·반복 결함·비용 상한을 실제로 차단합니다.

두 개 이상의 직교 실루엣이 있으면 시각 외피를 폐쇄형 메시로 복원하고 각 입력 시점으로 역투영해 정확도를 다시 검사합니다. 유기형·인체 블록아웃·연속 곡면은 `implicitSurface`의 smooth-union/subtract/intersect 연산과 Surface Nets로 만들며, 모호한 셀이 생기면 최대 4단계의 결정론적 해상도 보정 후에도 비매니폴드이면 차단합니다. 참조와 렌더의 전경을 정렬해 상·중·하 내부 누락을 검사하고, 재질은 색뿐 아니라 밝기, 미세·중간·큰 스케일 대비, 방향 분포, 주기성, 불규칙성을 따로 비교합니다. 이 구현은 Apache-2.0인 img2threejs의 강한 부분을 TypeScript로 이식·수정한 것이며 출처와 변경 내용은 [`NOTICE`](./NOTICE)에 기록했습니다.

도면 기반 건축은 `planFootprintVerified` 표시만 믿지 않습니다. 소스 도면에서 잠근 점유 영역과 중정·후퇴부 같은 보호 공백을 실제 컴파일 메시 위에서 수직 광선으로 다시 샘플링해 IoU, 과잉 시공, 누락, 공백 침범을 계산합니다. 중앙 돌출부가 반대편으로 뒤집히거나 U자 중정이 메워지면 토폴로지가 멀쩡해도 품질 점수와 납품 판정이 차단되며, 이 감사 지문도 GLB 재열기까지 보존되어야 합니다.

상세 결과: [`benchmarks/quality-latest.json`](./benchmarks/quality-latest.json) · [벤치마크 정책](./benchmarks/README.md) · [다중 시점 캡처 규격](./docs/VISUAL_CAPTURE_SET.md) · [img2threejs 실제 비교](./docs/COMPETITIVE_BENCHMARK.md)

동일한 Talon 사진으로 실제 비교했습니다. Morphloom은 원본 정면 색상을 조립 좌표계에 정렬하고, 선형 색공간에서 넓은 조명 변화만 제한적으로 제거한 뒤 미세 밝기 변화로 normal·roughness 맵을 만듭니다. 보정량·입력 fingerprint·단일 사진 추론의 제한도 재질에 기록합니다. 검신은 실제 쐐기 형상이며 절삭선 14/14구간에서 최대 날끝 0.12 mm를 측정합니다. 25개 편집 부품, 경계·비매니폴드·퇴화 삼각형 0, GLB 포락 오차 0.000 mm도 확인했습니다. UI 없는 투명 WebGL 정면 진단에서 Morphloom은 종합 0.916 대 0.796, 실루엣 0.937 대 0.745, 내부 디테일 0.926 대 0.868, 재질·질감 0.902 대 0.877, 표면 스케일 0.853 대 0.777, 불규칙성 0.848 대 0.771로 앞섰습니다. 정면 한 뷰뿐이고 블라인드 패널이 없으므로 결과는 `unproven`, `claimAllowed: false`이며 전 분야 우세 주장이 아닙니다. [기계 판독 결과](./benchmarks/talon-visual-broadside-latest.json)를 공개합니다. 비교용 경쟁 렌더는 재배포하지 않고 해시만 기록합니다.

거친 표면은 색 노이즈만 입히지 않습니다. `surfacePatch`가 큰 굴곡과 2단 입도의 각진 골재를 닫힌 메시로 만들고, 같은 골재 규칙에서 albedo·normal·roughness를 생성합니다. 아스팔트 회귀 샘플은 6,959개 골재 특징, 111,936개 삼각형, RMS 높이 0.98 mm, 최고–최저 6.20 mm이며 경계·비매니폴드·퇴화 삼각형은 모두 0입니다. 이 수치는 절차형 표면 검증값이며 특정 도로의 실측·스캔 정확도를 뜻하지 않습니다.

사진 조건부 아스팔트 검증은 제공된 508×660 PNG의 SHA-256과 불규칙성 0.963을 기록하고, 99×128(12,672점) 높이장과 13,229개 절차 골재 특징을 결합했습니다. 높이장은 단일 블러가 아니라 미세·중간·큰 스케일 주파수 밴드를 결합하며 세 대역 모두 활성으로 측정됐고, 비교기는 반복 무늬가 같은 평균·분산으로 골재를 흉내 내는 경우도 차단합니다. 결과는 124,616 삼각형, RMS 0.58 mm, 최고–최저 4.35 mm, 폐쇄 메시 1/1이며 컴파일러 0.14 브라우저 GLB 재열기에서도 크기 오차 0 mm로 통과했습니다. 사진 명암에서 추정한 높이는 실측이 아니므로 현장 특화 재질에는 스캔 또는 높이 보정값이 필요합니다. 상세 기록은 [`benchmarks/asphalt-reference-latest.json`](./benchmarks/asphalt-reference-latest.json)에 있습니다.

표면 준비 CLI는 파일 헤더 단계에서 크기·해상도를 제한한 PNG·JPEG·WebP 입력을 받습니다.

## 현재 한계

- 한 장의 사진만으로 숨은 형상, 정확한 두께와 후면을 측정할 수 없습니다.
- 인체 베이스는 30개 손가락 본·실제 손가락 웨이트·5개 편집형 얼굴 모프(`jaw_open`, `smile`, 좌우 눈깜박임, 눈썹 올림)를 GLB에 보존합니다. 다만 정밀 FACS, 음소 립싱크, 정체성 기반 얼굴 리그, 손가락 충돌/근육 변형과 의류 물리 시뮬레이션은 별도 범위입니다.
- 포즈 기반 의류 주름과 micro-normal은 지원하지만 실제 원단 스캔을 대체하지 않습니다.
- 전기 연결 검사는 포트·핀명·AWG·3D 끝점 검사이며 SPICE, PCB ERC, 실물 도통 검사가 아닙니다.
- 건축 출력은 도면 기반 검수 셸이며 구조해석, MEP와 현장 승인을 포함하지 않습니다.

## 로컬 데이터와 보안

- 뷰어는 입력 파일을 외부 서버로 업로드하지 않습니다.
- 불러온 IR은 브라우저 메모리에만 있고 새로고침·명시적 제거·30분 만료 시 삭제됩니다.
- 저장소에 만든 IR, 코드와 원본 자료는 일반 로컬 파일이므로 자동 삭제되지 않습니다.
- 결과물도 사용자가 저장 버튼을 눌러야 파일로 저장됩니다.

## 주요 폴더

```text
src/engine/        IR 컴파일·형상·재질·토폴로지·품질 검사
src/components/    Three.js 결과 뷰어와 내보내기
schemas/           CharacterIR / AssemblyIR 계약
skills/            Codex/Claude 작업 지침
benchmarks/        재현성·품질·브라우저 왕복 결과
public/assets/     로컬 인체 베이스 팩
```

## 라이선스

코드는 [Apache-2.0](./LICENSE)입니다. 포함된 인체 베이스 데이터는 CC0-1.0이며 출처는 [`NOTICE`](./NOTICE)에 기록되어 있습니다.
