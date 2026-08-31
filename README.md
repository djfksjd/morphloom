<div align="center">

# MORPHLOOM

### Codex 또는 Claude로 만드는 편집 가능한 로컬 3D 에셋

[한국어](./README.md) · [English](./README.en.md)

[![License](https://img.shields.io/badge/license-Apache--2.0-335cff?style=flat-square)](./LICENSE)
![Tests](https://img.shields.io/badge/tests-64%20passing-28a879?style=flat-square)
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
- GLB 재열기와 포락·삼각형·명명 노드 비교
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
| PNG | 현재 뷰포트 캡처 |
| ZIP | GLB, OBJ/STL/PLY, IR, 품질 보고서, 미리보기 묶음 |

OBJ/STL은 STEP/BREP 제조 솔리드가 아닙니다. `.blend`, `.uasset`, FBX도 대상 프로그램에서 변환해야 합니다.

## 현재 제공되는 예제

| 영역 | 예제 |
|---|---|
| 제품 | 164부품 스마트폰 · Galaxy Z Fold8 외관 · 장식 단검 |
| 전자 조립 | 75개 도체와 150개 물리 포트를 가진 TEC 냉각 어셈블리 |
| 건축 | HABS 실측 캐빈 · 9세대 공동주택 기준층 · 편집 가능한 2층 주택 콘셉트 |
| 캐릭터 | 14,517정점 인체 베이스 · 포즈 기반 Web Hero |

제품·건축은 실측과 설계 근거가 충분할수록 정확도가 높아집니다. 캐릭터는 현재 게임 프리비즈와 후편집 베이스 단계입니다.

## 품질 게이트

```bash
npm test
npm run quality:gate
npm run build
```

현재 잠금 벤치마크:

- 전체 합격률: **100% (5/5)**
- 기술 무결성: **100% (5/5)**
- 승인·차단 판단 정확도: **100% (5/5)**
- 납품 대상 모델·브라우저 GLB: **100% (2/2)**
- 근거 부족 안전 차단: **100% (3/3)**

100%는 모든 결과물이 완성품이라는 뜻이 아닙니다. 모델 완성도와 출처 신뢰도를 분리합니다. 장식 단검과 검증된 건축 셸은 승인 사례이며, 콘셉트 주택·냉각 어셈블리·단일 사진 캐릭터는 기술 검사를 통과했지만 근거 부족을 정확히 차단한 사례입니다.

상세 결과: [`benchmarks/quality-latest.json`](./benchmarks/quality-latest.json) · [벤치마크 정책](./benchmarks/README.md)

## 현재 한계

- 한 장의 사진만으로 숨은 형상, 정확한 두께와 후면을 측정할 수 없습니다.
- 사람 얼굴 동일성, 정확한 손가락, 스킨 웨이트와 의류 시뮬레이션은 아직 완성 단계가 아닙니다.
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
