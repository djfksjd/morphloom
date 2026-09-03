<div align="center">

# MORPHLOOM

### Codex 또는 Claude로 만드는 편집 가능한 로컬 3D 에셋

[한국어](./README.md) · [English](./README.en.md)

[![License](https://img.shields.io/badge/license-Apache--2.0-335cff?style=flat-square)](./LICENSE)
![Tests](https://img.shields.io/badge/tests-473%20passing-28a879?style=flat-square)
![Three.js](https://img.shields.io/badge/Three.js-r179-111111?style=flat-square)
![Benchmark](https://img.shields.io/badge/model%20gate-100%25-28a879?style=flat-square)

</div>

Morphloom은 사진, 도면, 실측값, 데이터시트와 자연어 설명을 `CharacterIR` 또는 `AssemblyIR`로 정리한 뒤 Three.js 메시로 컴파일합니다.

Meshy 같은 전용 3D 생성 모델 없이 **Codex 또는 Claude 하나**로 작업하며, 결과는 브라우저에서 검수하고 여러 3D 형식으로 저장합니다.

> 현재 버전은 `v0.4 alpha`입니다. 준실무 편집 베이스를 목표로 하며 제조 승인 CAD, 인물 스캔, 회로 안전 검증을 대체하지 않습니다.

엔진은 입력 종류를 먼저 판별해 도면 외곽, 치수 계약, 다중 시점 외피, 유기 곡면, 전기 연결, 리깅, 표면 복원, 두께 검사 중 필요한 도구만 실행합니다. 여섯 장 사진처럼 고정된 자료 수를 요구하지 않으며, 해결에 필요한 근거가 없으면 그 부분만 추가로 요청합니다. 수정 결과가 나빠지면 이전 최선본으로 되돌리고 같은 결함이 두 번 반복되면 형상을 추측하지 않고 근거 부족으로 차단합니다.

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

특정 결과는 `?asset=cooler`, `?asset=laurel-homes`처럼 바로 열 수 있어 CLI 결과 링크로 쓰기 좋습니다.

모델이 임의 생성 스크립트를 쓰지 않도록, 실제 작업은 [`morphloom.job/0.1`](./schemas/morphloom-job.schema.json) JSON으로 고정합니다.

```bash
npm run morphloom -- inspect --job work/job.json
npm run morphloom -- build --job work/job.json --out outputs/run-001
```

각 입력은 작업공간 안의 실제 파일 경로와 SHA-256으로 연결됩니다. 엔진이 파일 바이트·크기·형식·이미지 해상도, 실측 근거, GLB 2회 생성 일치, Khronos 검사와 독립 재열기를 확인합니다. `review-pass`는 검토본이며 `delivery-pass`와 `releaseAllowed: true`만 납품 후보입니다.

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
- 자산 크기에 맞춰 라벨 수·크기·간격을 조절하는 치수 오버레이
- Khronos 공식 glTF 2.0 규격 검사, 독립 glTF Transform 파서, Three.js GLB 재열기의 3중 검사
- 같은 입력의 GLB 검증은 중복 실행하지 않고, 첫 화면 조작이 가능해진 뒤 자동 시작하며 이전 결과가 새 화면을 덮지 않음
- 품질 차단 사유와 근거 범위 표시
- 로컬 작업 취소·재시도와 결과 저장

## 내보내기

| 형식 | 주요 용도 |
|---|---|
| GLB | Blender · Unity · Unreal · Godot · 웹 |
| OBJ | Maya · 3ds Max · Cinema 4D 등 범용 메시 |
| PLY | Blender · MeshLab · CloudCompare |
| USDZ | Apple AR Quick Look · Reality Composer |
| STL (mm·Z-up 좌표) | Fusion 360과 3D 프린팅용 메시 참조 |
| SVG | Figma용 2D 부품·포락 검수 시트 |
| PNG | UI·바닥·실측 보조선을 제외한 투명 배경 현재 렌더 |
| ZIP | GLB, OBJ/STL/PLY, IR, 품질 보고서, 미리보기 묶음 |

내보내기 전에 GLB는 Khronos·glTF Transform·Three.js, OBJ/STL/PLY는 각 로더로 다시 엽니다. STL은 단위 메타데이터가 없는 규격 특성상 좌표 자체를 mm로 기록하고, Three.js의 Y-up을 슬라이서용 Z-up으로 명시 변환합니다. 현재 0.31.0 아스팔트 자산팩은 브라우저에서 실제 내려받은 뒤 OBJ·STL·PLY 111,936면을 Blender 5.2.1로 재열었고, 포맷 간 포락 오차 0.000031mm와 Apple `usdchecker` 통과를 확인했습니다. 경쟁 게이트는 자산 ID를 고정하지 않고 현재 브라우저의 동일 입력 지문과 납품 가능 상태까지 일치할 때만 이 증거를 인정합니다. 결정적 RGBA8 질감은 USDZ 전용 캔버스 브리지로 변환하며, 지원하지 않는 표면 맵은 조용히 버리지 않고 차단합니다. [정적 납품 검사 결과](./benchmarks/static-delivery-latest.json)를 공개합니다.

OBJ/STL은 STEP/BREP 제조 솔리드가 아니며 PBR·리깅·애니메이션은 GLB가 기준입니다. `.blend`, `.uasset`, FBX도 대상 프로그램에서 변환해야 합니다. Blender 5.2.1 LTS와 Godot 4.7.2는 아래 5개 분야 GLB 왕복을 검증했고, PrusaSlicer 2.9.6은 111,936면 아스팔트 STL의 Z-up·매니폴드·43층 도구경로 생성을 검증했습니다. Unity 실행은 이 Mac의 라이선싱 초기화 실패로 차단됐고 Unreal 자체 임포트도 아직 검증하지 않았습니다.

## 현재 제공되는 예제

| 영역 | 예제 |
|---|---|
| 제품 | 164부품 스마트폰 · Galaxy Z Fold8 외관 · 장식 단검 |
| 표면 | 각진 굵은·미세 골재와 역청 홈을 실제 변위+PBR로 결합한 아스팔트 |
| 전자 조립 | 75개 도체와 150개 물리 포트를 가진 TEC 냉각 어셈블리 |
| 건축 | HABS 실측 캐빈 · 9세대 공동주택 기준층 · 편집 가능한 2층 주택 콘셉트 |
| 캐릭터 | 실제 49-bone 스켈레톤(30개 손가락 본)·손 형상 기반 스킨 웨이트·좌우 어깨/팔꿈치/골반/무릎/발목 10관절의 개별 정점 변형과 해부학적 영향 위치 검증·idle/이동/회전/앉기/점프/제스처/상호작용 22클립·185트랙·중립/관절 포즈 실루엣을 검증한 스킨 LOD1·16부위 포즈 정렬 충돌 리그를 가진 인체 베이스 · 포즈 기반 Web Hero |

제품·건축은 실측과 설계 근거가 충분할수록 정확도가 높아집니다. 캐릭터는 현재 게임 프리비즈와 후편집 베이스 단계입니다.

## 품질 게이트

```bash
npm test
npm run quality:gate
npm run quality:production
npm run benchmark:competitive
npm run benchmark:visual-captures -- --reference reference.webp --morphloom morphloom.png --competitor img2threejs.png --competitor-threshold 48 --output benchmarks/visual-latest.json
npm run benchmark:visual-set -- --manifest captures/manifest.json --output benchmarks/visual-set-latest.json --require-claim
npm run benchmark:neutral-render -- candidate.glb candidate-front.png candidate-front.json front
npm run benchmark:neutral-audit -- --morphloom morphloom-front.json,morphloom-rear.json --competitor competitor-front.json,competitor-rear.json --output benchmarks/neutral-latest.json
npm run benchmark:fixtures -- /tmp/morphloom-fixtures
npm run benchmark:blender-cross-domain -- /tmp/morphloom-fixtures
npm run benchmark:unity-cross-domain -- /tmp/morphloom-fixtures
npm run benchmark:godot-cross-domain -- /tmp/morphloom-fixtures
npm run benchmark:prusaslicer -- /tmp/morphloom-fixtures
npm run benchmark:static-delivery -- --asset-id asphalt-surface --asset-pack asset.zip --obj-file result.obj --obj-report obj.json --stl-file result.stl --stl-report stl.json --ply-file result.ply --ply-report ply.json --usdz-file result.usdz --output benchmarks/static-delivery-latest.json
npm run benchmark:ground-truth -- --require-pass
npm run benchmark:abo-scale -- --require-pass
npm run benchmark:abo-hull
npm run benchmark:abo-semantic-lamp
npm run benchmark:dominance
npm run build
npm run gltf:validate -- path/to/asset.glb
npm run gltf:repair -- blender-output.glb delivery.glb
npm run blender:validate -- source.glb roundtrip.glb report.json
```

현재 잠금 벤치마크:

- 전체·기술·판단 합격률: **100% (9/9)**
- 납품 대상 모델·브라우저 납품: **100% (6/6)**
- 근거 부족 결과의 안전 차단: **100% (3/3)**
- 실제 브라우저 GLB 증명: **100% (7/7), 콘솔 오류·경고 0**
- Blender 실제 5분야 재열기: **100% (5/5)**
- Blender 실제 부품 부분수정·재열기: **100% (5/5)**
- Godot 실제 5분야 재열기: **100% (5/5)**
- PrusaSlicer·OBJ/STL/PLY/USDZ: **현재 0.31.0 실제 재열기·검증 통과**

7개 브라우저 증명은 산업디자인, 실측/콘셉트 건축, 전자 조립, 캐릭터 프리비즈, 애니메이션·게임, 3D 프린팅 표면을 포함합니다. 하나의 아스팔트 증명은 동일한 납품물을 대상으로 서로 다른 3D 프린팅 계약과 표면 계약에서 각각 재사용합니다. 품질 점수 59인 세 사례는 기술 실패가 아니라 입력 근거가 부족해 의도대로 납품을 막은 사례입니다. 검증기는 실제 질감 픽셀·샘플러와 PBR/광학 값을 지문에 넣고 GLB 재열기 뒤 동일성을 요구합니다. 브라우저와 Node의 색 변환·문자 정렬·전선 곡선 부동소수점 차이도 같은 입력 지문을 흔들지 않도록 고정했습니다. 이 100%는 잠근 9개 기술 계약의 통과율이며 독립 블라인드 비교나 임의 입력의 시각적 완벽함을 뜻하지 않습니다.

`quality:production`은 더 엄격합니다. 분야마다 서로 다른 동일 입력 사례 3개, 반복 생성, 브라우저와 Blender 재열기, 게임 엔진/슬라이서 재열기, img2threejs와의 자동 점수 우위, 최소 5명의 순서 균형 블라인드 우위를 모두 요구합니다. 한 항목이라도 없으면 전 분야 우세나 실무 즉시 납품을 선언하지 않습니다.

현재 외부 ABO 파일럿은 3개 사례·18개 자산과 2개 다중 시점 크기 추론을 검증합니다. 의미 기반 램프는 정답 GLB 감사까지 통과했습니다. 팬 사례는 101개 편집 부품, 결정론적 GLB, Khronos/독립 재열기를 통과했지만 네 시점 윤곽과 정답 형상은 아직 차단됩니다. 강체 촬영 포즈 잔차를 분리한 뒤 최저 전체 윤곽·주요 질량·얇은 부재 점수는 0.597·0.674·0.710이며, 4,096점 형상 감사는 최대 치수 오차 4.15%, RMS Chamfer 0.0560, P95 0.1162, 커버리지 54.1%입니다. 선택 잔차가 최대 80°이고 독립 측정되지 않았으므로 이 보정은 진단에만 쓰며 카메라 정확도나 납품 근거로 인정하지 않습니다. 따라서 팬은 `productionReady: false`이며 전 분야 우세도 아직 주장하지 않습니다.

GLB 증명은 Khronos Validator·glTF Transform·Three.js 재열기 결과를 함께 기록합니다. 모프는 실제 변형 페이로드를, 질감은 픽셀·슬롯·UV 변환과 샘플링 의미를 비교합니다. glTF가 보존하지 못하는 텍스처·재질 의미는 조용히 버리지 않고 모델 단계에서 차단합니다. 최신 0.31.0 브라우저 영수증은 [`benchmarks/browser-roundtrip-latest.json`](./benchmarks/browser-roundtrip-latest.json)에 저장됩니다.

Blender 5.2.1 LTS 실제 왕복 검증은 건축·산업디자인·전자 조립·애니메이션/게임·3D 프린팅 표면 5개를 모두 통과했습니다. 증거는 현재 컴파일러 revision과 묶이며 이전 엔진 결과를 재사용하면 차단됩니다. 각 입력을 두 번 독립 생성한 GLB의 SHA-256도 분야별로 일치합니다. 추가로 창문 50mm, 칼 장식 5mm, USB-C 3mm, 머리카락 5mm 이동과 아스팔트 국부 1.5mm 요철 편집을 Blender에서 실행했습니다. 대상 외 메시, UV, PBR 재질, 계층, 리그 49본과 22개 애니메이션을 검사하고 두 번 재열었으며 최종 GLB는 모두 Khronos 오류·경고·정보 0을 통과했습니다. [왕복 결과](./benchmarks/blender-cross-domain-latest.json)와 [부분 편집 결과](./benchmarks/blender-cross-domain-edit-latest.json)를 저장합니다. Godot 4.7.2도 동일한 5개 GLB를 실제 `PackedScene`으로 가져와 5/5 통과했습니다. [Godot 결과](./benchmarks/godot-cross-domain-latest.json)는 공식 앱과 입력 해시에 묶입니다. 현재 0.31.0 아스팔트 STL은 PrusaSlicer 2.9.6에서 단일 매니폴드 부품·양의 체적·111,936면·43층/190,158회 압출 이동 G-code를 통과했고, 같은 브라우저 자산팩의 OBJ/STL/PLY/USDZ도 현재 revision으로 검증했습니다. Unity는 라이선싱 초기화에서 차단됐고 Unreal 자체 임포트도 아직 검증하지 않았습니다.

| 준실무 납품 계약 | 점수 | 실제 차단 조건 |
|---|---:|---|
| 산업디자인 | 99 | 폐쇄 토폴로지 · 근거 치수와 홀/핀/렌즈/커넥터 중심 피치 재실측 · 유한/비퇴화 UV · 단위 노멀 · 75% 이상 PBR 미세표면 · 근거 |
| 건축 | 99 | 오목 다각형·자기교차 차단 · 실제 상부 메시 재투영 IoU·과잉/누락·중정 공백 · 근거 치수 월드좌표 재실측 · 폐쇄 셸 · 유한/비퇴화 UV · 80% 이상 미세표면 · 실측/도면 근거 |
| 전자 조립 | 94, 실물 승인 차단 | 75/75 도선 · 150/150 필수 포트 · 물리 핀/선경/검증 근거 100% · live 앵커 · 종단 오차 ≤0.05 mm · 토폴로지·UV·노멀·PBR · 추정 부품·실물 bench 대기가 남으면 출고 차단 |
| 애니메이션 | 100 | 49본 스켈레톤 · 정규화 웨이트 · 상·하체 10관절별 웨이트/실제 변형/영향 위치 실측 · 22개 동작/185트랙 · 손가락 웨이트/19트랙 · loop/in-place/GLB 의미 보존 |
| 게임 | 100 | 10만 tris 예산 · 실제 스킨 LOD0/1 · 이동/점프/제스처/상호작용 22클립 · 유한 치수/본 연결/바디 교차 충돌체 · 유한/비퇴화 UV · 단위 노멀 · PBR |
| 3D 프린팅 | 100 | 폐쇄 메시 · mm 단위 · 선언 형상/전역 두께 지표 ≥0.8 mm · 연결 외피별 국부 두께 레이 ≥0.8 mm · 양의 체적 · 45° 오버행 실측 |

전역 `2V/A`나 삼각형 순서 기반 균등 표본만으로는 작은 얇은 셸·탭·리브가 고밀도 본체에 숨을 수 있습니다. 판정기 `morphloom-domain-readiness/0.14.0`은 0.001 mm 허용오차로 UV 이음 정점을 용접하고 공유 모서리 기준의 연결 외피를 분리한 뒤, 외피마다 ±X/±Y/±Z 대표 면을 먼저 검사합니다. 남은 표본은 면 중심 위치와 노멀을 결합한 6차원 특징 공간의 최장거리 순서로 골라, 면 수가 적어도 공간적으로 돌출되거나 방향이 다른 부위를 포함합니다. 반대편 교차도 같은 외피 안에서만 계산합니다. 기본 상한은 256메시·수집 50만 삼각형·용접 정점 50만·연결 모서리 100만·메시당 96레이·2,400만 삼각형 검사이며, 작은 외피까지 검사할 표본이나 메모리가 부족하면 합격시키지 않습니다. 19,200개 삼각형 본체 옆의 분리된 12개 삼각형·0.3 mm 외피와, 하나의 폐쇄 솔리드에 붙은 0.3 mm 탭을 모두 0.3 mm로 잡으며 후자는 3축 회전 뒤에도 같습니다. 더 넓은 표면을 찾도록 바뀐 현재 아스팔트 시편은 연결 외피 1개, 96/96레이, 최소 3.499 mm, 5백분위 17.683 mm로 통과했습니다.

같은 판정기는 캐릭터 리그도 본 이름이나 팔꿈치 한 곳의 움직임만으로 합격시키지 않습니다. 가장 상세한 스킨 메시에서 좌우 어깨·팔꿈치·골반·무릎·발목 10개 주요 관절마다 최소 8개 가중 정점과 1 mm 초과 실제 변형을 독립적으로 확인합니다. 각 관절의 부모–관절–자식 뼈 구간 주변에는 직접 가중 정점의 98% 이상이 있어야 합니다. 하체 본은 남아 있지만 무릎·발목 정점이 골반에 잘못 연결된 시편과, 10/10 관절이 모두 움직이지만 어깨·무릎 웨이트 위치를 서로 바꾼 시편을 애니메이션과 게임 납품에서 차단합니다. 판정 revision은 GLB 바이트를 바꾸지 않는 게이트 개선을 컴파일러와 별도로 추적합니다.

일반 45° 기준의 비지지 오버행 면적은 실제 삼각형 노멀로 계산합니다. 다만 최종 방향·서포트·수축·공차는 프린터와 슬라이서에 따라 달라지므로 별도 공정 검수 없이 제조 적합성을 자동 승인하지 않습니다.

Morphloom은 생성 전에 디테일·재질·검수 시점과 특징별 합격선을 잠그고, 8단계 검수에서 회귀·반복 결함·비용 상한을 실제로 차단합니다. 비교 렌더는 캔버스·픽셀비·색공간·톤매핑·노출·배경·그림자·조명/환경 해시를 하나의 프로토콜로 고정하고, 실제 PNG와 장면·카메라·참조·렌더 설정을 브라우저 캡처 영수증으로 연결합니다. 참조와 두 후보의 전체 캔버스를 같은 방식으로 축소해 비교하므로 잘못된 위치·크기·프레이밍을 개별 중앙 정렬로 숨길 수 없습니다. 이름만 바꾼 동일 평가영역이나 설정이 다른 캡처도 우세 판정에 사용할 수 없습니다.

카메라 계약은 오차 숫자만 저장하지 않습니다. 직교 사진은 4개 이상, 원근 사진은 서로 한 평면에 있지 않은 6개 이상의 이름 있는 3D↔2D 기준점과 각 근거를 저장합니다. 엔진은 직교 각도·배율·오프셋 또는 원근 3×4 투영을 다시 풀고 모든 기준점의 양의 투영 깊이와 픽셀 오차를 재검증합니다. 기준점 좌표나 투영행렬을 바꾸고 기존 오차만 유지한 결과는 차단됩니다.

토폴로지는 경계·비매니폴드·퇴화 삼각형뿐 아니라 실제 삼각형 자기 교차까지 검사합니다. 공간 격자로 후보를 제한한 뒤 정확 교차를 판정하며 검사 예산을 넘기면 합격시키지 않습니다. 이 게이트로 급격한 전선 스플라인 되감김과 캐릭터 골반·목 경계의 포즈 접힘을 발견해, 전선은 직선+필렛 경로로, 포즈는 연속 해부학 가중치로 수정했습니다. 게임 LOD는 source vertex 속성을 유지하는 meshoptimizer 인덱스 단순화를 사용하고 동일 토폴로지·스킨·실루엣 검사를 통과해야만 포함됩니다.

두 개 이상의 직교 실루엣이 있으면 시각 외피를 폐쇄형 메시로 복원하고 각 입력 시점으로 역투영해 정확도를 다시 검사합니다. 유기형·인체 블록아웃·연속 곡면은 `implicitSurface`와 Surface Nets로 만들며, 결정론적 보정 후에도 비매니폴드이면 차단합니다. 사진 투영은 원본을 향한 삼각형에만 적용하고 측면·후면은 근거 없는 반복 무늬 없이 별도 재질로 둡니다. 재질 검사는 색과 통계뿐 아니라 미세·중간·큰 스케일 및 실제 공간 배치를 비교해 픽셀을 뒤섞은 가짜 질감도 차단합니다. 레퍼런스에 공간적 PBR 변화가 있으면 상수값이나 범용 노이즈로 대체할 수 없고, 실제 GLB 표면 면적 기준으로 `reference` 또는 `measured` 출처와 잠긴 입력 SHA-256이 함께 확인돼야 합니다. 이는 재질 변화와 근거를 검증하는 장치이며 물리적으로 보정된 BRDF 측정은 아닙니다. Apache-2.0인 img2threejs에서 참고한 부분과 변경 내용은 [`NOTICE`](./NOTICE)에 기록했습니다.

도면 기반 건축은 `planFootprintVerified` 표시만 믿지 않습니다. 소스 도면에서 잠근 점유 영역과 중정·후퇴부 같은 보호 공백을 실제 컴파일 메시 위에서 수직 광선으로 다시 샘플링해 IoU, 과잉 시공, 누락, 공백 침범을 계산합니다. 중앙 돌출부가 반대편으로 뒤집히거나 U자 중정이 메워지면 토폴로지가 멀쩡해도 품질 점수와 납품 판정이 차단됩니다. 또한 실측·데이터시트 치수는 전체 또는 이름 있는 부재의 X/Y/Z 크기·최소·최대·중심값으로 잠그고, 완성 메시의 월드 좌표를 다시 측정합니다. 회전된 칼날·경사 보·브래킷은 월드 AABB가 아니라 부품 자체 축의 길이·폭·두께로 검사할 수 있습니다. 부품 로컬 기준점 두 개를 지정하면 변환된 최종 메시에서 홀·핀·렌즈·커넥터 중심의 X/Y/Z 또는 3차원 피치도 다시 계산하며, 같은 회전 부품 안의 피치는 부품 자체 축으로 잠글 수 있습니다. 기준점은 실제 부품 형상 경계 안에 있어야 하며, 평면이 맞아도 층고·문/창 높이·슬래브 레벨이나 인터페이스 피치가 허용오차를 벗어나면 차단합니다. 감사 지문은 GLB 재열기까지 보존되어야 합니다. 도면에 없는 Laurel의 2700 mm 절개 높이는 계속 추정값으로 표시하며 치수 계약으로 승격하지 않습니다.

상세 결과: [`benchmarks/quality-latest.json`](./benchmarks/quality-latest.json) · [벤치마크 정책](./benchmarks/README.md) · [다중 시점 캡처 규격](./docs/VISUAL_CAPTURE_SET.md) · [img2threejs 실제 비교](./docs/COMPETITIVE_BENCHMARK.md)

동일한 Talon 사진으로 실제 비교했습니다. Morphloom은 조립 좌표계의 source-facing 삼각형에 원본을 정렬하고, 선형 색공간에서 넓은 조명 변화만 제한적으로 제거한 뒤 normal·roughness 맵을 만듭니다. 검신은 실제 쐐기 형상이며 절삭선 14/14구간에서 최대 날끝 0.12 mm를 측정합니다. 25개 편집 부품, 경계·비매니폴드·퇴화 삼각형 0, GLB 포락 오차 0.000 mm도 확인했습니다. 실제 투명 WebGL 정면 진단에서 Morphloom은 종합 0.911 대 0.785로 앞섰습니다. 추가로 양쪽 실제 장면 GLB를 Blender 5.2.1 LTS의 동일 카메라·조명·크기로 정면/후면/등각 3시점 렌더했고, 같은 GLB와 실제 파일 해시가 유지된 3/3 감사가 통과했습니다. 중립 정면에서는 종합 0.924 대 0.877, 내부 디테일 0.906 대 0.783, 재질 0.885 대 0.748이었습니다. 정면 한 장 기준의 6회 에이전트 블라인드는 Morphloom 4·비교 1·동률 1, 평균 종합 우위 9.83점으로 나왔지만 압도적 기준인 6-0과 10점 차에 미달하므로 `unproven`, `claimAllowed: false`이며 전 분야 우세 주장이 아닙니다. [중립 렌더 감사](./benchmarks/talon-neutral-render-latest.json)와 [정면 진단](./benchmarks/talon-neutral-front-latest.json)을 공개합니다. 비교용 경쟁 렌더는 재배포하지 않고 해시만 기록합니다.

거친 표면은 색 노이즈만 입히지 않습니다. `surfacePatch`가 큰 굴곡과 2단 입도의 각진 골재를 닫힌 메시로 만들고, 같은 골재 규칙에서 albedo·normal·roughness를 생성합니다. 표면 전용 게이트는 선언값만 믿지 않고 최종 메시의 상단 꼭짓점에서 RMS와 최고–최저 높이를 다시 계산합니다. 그래서 원래 메타데이터와 normal map을 남긴 채 기하만 평평하게 만들거나 roughness map만 제거해도 납품이 차단됩니다. 아스팔트 회귀 샘플은 6,959개 골재 특징, 111,936개 삼각형, RMS 높이 0.98 mm, 최고–최저 6.20 mm이며 경계·비매니폴드·퇴화 삼각형은 모두 0입니다. 이 수치는 절차형 표면 검증값이며 특정 도로의 실측·스캔 정확도를 뜻하지 않습니다.

사진 조건부 아스팔트 검증은 제공된 508×660 PNG의 SHA-256과 불규칙성 0.873을 기록하고, 99×128(12,672점) 높이장과 13,229개 절차 골재 특징을 결합했습니다. v3 분석기는 제한적으로 조명을 제거하고 같은 보정 픽셀에서 형상 높이·노멀·거칠기를 함께 도출합니다. 실제 사진 증거 게이트는 97.84점이고 결과는 124,616 삼각형, RMS 0.51 mm, 최고–최저 4.37 mm, 폐쇄 메시 1/1입니다. 컴파일러 0.30.0의 Aside 재열기에서도 크기 오차 0 mm와 질감·재질 페이로드 동일성을 통과했습니다. 사진 명암에서 추정한 높이는 실측이 아니므로 현장 특화 재질에는 스캔 또는 높이 보정값이 필요합니다. 상세 기록은 [`benchmarks/asphalt-reference-latest.json`](./benchmarks/asphalt-reference-latest.json)에 있습니다.

표면 준비 CLI는 파일 헤더 단계에서 크기·해상도를 제한한 PNG·JPEG·WebP 입력을 받습니다.

## 현재 한계

- 한 장의 사진만으로 숨은 형상, 정확한 두께와 후면을 측정할 수 없습니다.
- 인체 베이스는 30개 손가락 본·실제 손가락 웨이트·5개 편집형 얼굴 모프(`jaw_open`, `smile`, 좌우 눈깜박임, 눈썹 올림)를 GLB에 보존합니다. 각 얼굴 모프의 비영 변형 정점 중 98% 이상이 실제 머리-목 영향 구역 안에 있어야 하고, 90% 이상이 턱·입·눈·눈썹의 기대 높이 구역에 있어야 하며, 좌우 눈깜박임도 각 눈 쪽 정점 90% 이상을 요구합니다. 이름·개수·최대 변형량을 유지한 채 다리로 옮기거나 좌우/상하 의미를 바꾼 모프는 애니메이션/게임 납품을 차단합니다. 다만 정밀 FACS, 음소 립싱크, 정체성 기반 얼굴 리그, 손가락 충돌/근육 변형과 의류 물리 시뮬레이션은 별도 범위입니다.
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
