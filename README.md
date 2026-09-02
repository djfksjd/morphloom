<div align="center">

# MORPHLOOM

### Codex 또는 Claude로 만드는 편집 가능한 로컬 3D 에셋

[한국어](./README.md) · [English](./README.en.md)

[![License](https://img.shields.io/badge/license-Apache--2.0-335cff?style=flat-square)](./LICENSE)
![Tests](https://img.shields.io/badge/tests-219%20passing-28a879?style=flat-square)
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
| STL (mm 좌표) | Fusion 360과 3D 프린팅용 메시 참조 |
| SVG | Figma용 2D 부품·포락 검수 시트 |
| PNG | UI·바닥·실측 보조선을 제외한 투명 배경 현재 렌더 |
| ZIP | GLB, OBJ/STL/PLY, IR, 품질 보고서, 미리보기 묶음 |

내보내기 전에 GLB는 Khronos·glTF Transform·Three.js, OBJ/STL/PLY는 각 로더로 다시 엽니다. STL은 단위 메타데이터가 없는 규격 특성상 좌표 자체를 mm로 기록합니다. ModernCat 건축물의 실제 브라우저 출력은 Blender 5.2.1에서 세 포맷 모두 81,768개 삼각형과 같은 포락을 유지했고, 13.54m 폭은 STL에서 13,540mm로 확인됐으며 최대 정규화 오차는 0.001mm였습니다. USDZ는 Three.js 출력의 잘못된 셰이더 타입과 노멀맵 디코딩을 보정한 뒤 Apple `usdchecker`를 통과합니다. [실제 파일 해시와 결과](./benchmarks/static-delivery-latest.json)를 공개합니다.

OBJ/STL은 STEP/BREP 제조 솔리드가 아니며 PBR·리깅·애니메이션은 GLB가 기준입니다. `.blend`, `.uasset`, FBX도 대상 프로그램에서 변환해야 합니다. Blender 5.2.1 LTS는 아래 5개 분야 GLB 왕복을 검증했습니다. Unity 실행은 이 Mac의 라이선싱 초기화 실패로 차단됐고 Unreal 자체 임포트도 아직 검증하지 않았습니다.

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
npm run benchmark:competitive
npm run benchmark:visual-captures -- --reference reference.webp --morphloom morphloom.png --competitor img2threejs.png --competitor-threshold 48 --output benchmarks/visual-latest.json
npm run benchmark:visual-set -- --manifest captures/manifest.json --output benchmarks/visual-set-latest.json --require-claim
npm run benchmark:neutral-render -- candidate.glb candidate-front.png candidate-front.json front
npm run benchmark:neutral-audit -- --morphloom morphloom-front.json,morphloom-rear.json --competitor competitor-front.json,competitor-rear.json --output benchmarks/neutral-latest.json
npm run benchmark:fixtures -- /tmp/morphloom-fixtures
npm run benchmark:blender-cross-domain -- /tmp/morphloom-fixtures
npm run benchmark:unity-cross-domain -- /tmp/morphloom-fixtures
npm run benchmark:static-delivery -- --asset-id moderncat-concept --asset-pack asset.zip --obj-file result.obj --obj-report obj.json --stl-file result.stl --stl-report stl.json --ply-file result.ply --ply-report ply.json --usdz-file result.usdz --output benchmarks/static-delivery-latest.json
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

100%는 잠근 8개 계약을 모두 올바르게 판정했다는 뜻이며 모든 입력의 시각 품질이 100점이라는 뜻이 아닙니다. 승인 사례는 산업디자인, 도면 기반 건축, 애니메이션, 게임, 3D 프린팅을 포함합니다. 콘셉트 주택·냉각 어셈블리·단일 사진 캐릭터는 기술 검사를 통과해도 근거 부족으로 정확히 차단됩니다. 브라우저 GLB 증명은 Khronos Validator·glTF Transform·Three.js 재열기 결과를 함께 기록합니다. 모프는 이름과 개수 외에도 각 대상의 비영 정점 수·변형 길이 합·제곱합·최대값을 비교하므로, 이름만 남고 표정 데이터가 축소되거나 손상된 GLB는 차단됩니다. compiler 0.23.0에서 실제 Chromium 대표 자산 9개와 캐릭터 모프 10/10 왕복을 다시 확인했습니다.

Blender 5.2.1 LTS 실제 왕복 검증은 건축·산업디자인·전자 조립·애니메이션/게임·3D 프린팅 표면 5개를 모두 통과했습니다. 증거는 현재 컴파일러 revision과 묶이며 이전 엔진 결과를 재사용하면 차단됩니다. 각 입력을 두 번 독립 생성한 GLB의 SHA-256도 분야별로 일치합니다. 메시·재질·이미지·형상 모멘트·스킨·49본·22개 액션·5개 얼굴 모프를 해당 분야에 맞춰 비교했고, 강체 포락 오차는 0.000 mm, 스킨 캐릭터는 0.366 mm였습니다. Blender가 일부 미세 베벨에서 잘못 만든 탄젠트는 숨기지 않고 원본 실패를 기록한 뒤 자동 복구하며, 최종 납품 바이트를 Khronos 오류·경고·정보 0 및 glTF Transform 재파싱으로 다시 막습니다. [5분야 기계 판독 결과](./benchmarks/blender-cross-domain-latest.json)를 저장합니다. Unity 하네스는 같은 5개 GLB의 메시·재질·텍스처·스킨·모프·애니메이션·포락을 검사하도록 구현하고 Unity 6000.5 API 컴파일까지 확인했지만, [최신 실행 증거](./benchmarks/unity-cross-domain-latest.json)는 라이선싱 초기화 단계에서 차단됐습니다. Unity·Unreal을 검증 완료로 표시하지 않습니다.

| 준실무 납품 계약 | 점수 | 실제 차단 조건 |
|---|---:|---|
| 산업디자인 | 99 | 폐쇄 토폴로지 · 근거 치수와 홀/핀/렌즈/커넥터 중심 피치 재실측 · 유한/비퇴화 UV · 단위 노멀 · 75% 이상 PBR 미세표면 · 근거 |
| 건축 | 99 | 오목 다각형·자기교차 차단 · 실제 상부 메시 재투영 IoU·과잉/누락·중정 공백 · 근거 치수 월드좌표 재실측 · 폐쇄 셸 · 유한/비퇴화 UV · 80% 이상 미세표면 · 실측/도면 근거 |
| 애니메이션 | 99 | 49본 스켈레톤 · 정규화 웨이트 · 상·하체 10관절별 웨이트/실제 변형/영향 위치 실측 · 22개 동작/185트랙 · 손가락 웨이트/19트랙 · loop/in-place/GLB 의미 보존 |
| 게임 | 100 | 10만 tris 예산 · 실제 스킨 LOD0/1 · 이동/점프/제스처/상호작용 22클립 · 유한 치수/본 연결/바디 교차 충돌체 · 유한/비퇴화 UV · 단위 노멀 · PBR |
| 3D 프린팅 | 100 | 폐쇄 메시 · mm 단위 · 선언 형상/전역 두께 지표 ≥0.8 mm · 연결 외피별 국부 두께 레이 ≥0.8 mm · 양의 체적 · 45° 오버행 실측 |

전역 `2V/A`나 삼각형 순서 기반 균등 표본만으로는 작은 얇은 셸·탭·리브가 고밀도 본체에 숨을 수 있습니다. 판정기 `morphloom-domain-readiness/0.9.0`은 0.001 mm 허용오차로 UV 이음 정점을 용접하고 공유 모서리 기준의 연결 외피를 분리한 뒤, 외피마다 ±X/±Y/±Z 대표 면을 먼저 검사합니다. 남은 표본은 면 중심 위치와 노멀을 결합한 6차원 특징 공간의 최장거리 순서로 골라, 면 수가 적어도 공간적으로 돌출되거나 방향이 다른 부위를 포함합니다. 반대편 교차도 같은 외피 안에서만 계산합니다. 기본 상한은 256메시·수집 50만 삼각형·용접 정점 50만·연결 모서리 100만·메시당 96레이·2,400만 삼각형 검사이며, 작은 외피까지 검사할 표본이나 메모리가 부족하면 합격시키지 않습니다. 19,200개 삼각형 본체 옆의 분리된 12개 삼각형·0.3 mm 외피와, 하나의 폐쇄 솔리드에 붙은 0.3 mm 탭을 모두 0.3 mm로 잡으며 후자는 3축 회전 뒤에도 같습니다. 더 넓은 표면을 찾도록 바뀐 현재 아스팔트 시편은 연결 외피 1개, 96/96레이, 최소 3.499 mm, 5백분위 17.683 mm로 통과했습니다.

같은 판정기는 캐릭터 리그도 본 이름이나 팔꿈치 한 곳의 움직임만으로 합격시키지 않습니다. 가장 상세한 스킨 메시에서 좌우 어깨·팔꿈치·골반·무릎·발목 10개 주요 관절마다 최소 8개 가중 정점과 1 mm 초과 실제 변형을 독립적으로 확인합니다. 각 관절의 부모–관절–자식 뼈 구간 주변에는 직접 가중 정점의 98% 이상이 있어야 합니다. 하체 본은 남아 있지만 무릎·발목 정점이 골반에 잘못 연결된 시편과, 10/10 관절이 모두 움직이지만 어깨·무릎 웨이트 위치를 서로 바꾼 시편을 애니메이션과 게임 납품에서 차단합니다. 판정 revision은 GLB 바이트를 바꾸지 않는 게이트 개선을 컴파일러와 별도로 추적합니다.

일반 45° 기준의 비지지 오버행 면적은 실제 삼각형 노멀로 계산합니다. 다만 최종 방향·서포트·수축·공차는 프린터와 슬라이서에 따라 달라지므로 별도 공정 검수 없이 제조 적합성을 자동 승인하지 않습니다.

Morphloom은 생성 전에 디테일·재질·검수 시점과 특징별 합격선을 잠그고, 8단계 검수에서 회귀·반복 결함·비용 상한을 실제로 차단합니다. 비교 렌더는 캔버스·픽셀비·색공간·톤매핑·노출·배경·그림자·조명/환경 해시를 하나의 프로토콜로 고정하고, 실제 PNG와 장면·카메라·참조·렌더 설정을 브라우저 캡처 영수증으로 연결합니다. 참조와 두 후보의 전체 캔버스를 같은 방식으로 축소해 비교하므로 잘못된 위치·크기·프레이밍을 개별 중앙 정렬로 숨길 수 없습니다. 이름만 바꾼 동일 평가영역이나 설정이 다른 캡처도 우세 판정에 사용할 수 없습니다.

토폴로지는 경계·비매니폴드·퇴화 삼각형뿐 아니라 실제 삼각형 자기 교차까지 검사합니다. 공간 격자로 후보를 제한한 뒤 정확 교차를 판정하며 검사 예산을 넘기면 합격시키지 않습니다. 이 게이트로 급격한 전선 스플라인 되감김과 캐릭터 골반·목 경계의 포즈 접힘을 발견해, 전선은 직선+필렛 경로로, 포즈는 연속 해부학 가중치로 수정했습니다. 게임 LOD는 source vertex 속성을 유지하는 meshoptimizer 인덱스 단순화를 사용하고 동일 토폴로지·스킨·실루엣 검사를 통과해야만 포함됩니다.

두 개 이상의 직교 실루엣이 있으면 시각 외피를 폐쇄형 메시로 복원하고 각 입력 시점으로 역투영해 정확도를 다시 검사합니다. 유기형·인체 블록아웃·연속 곡면은 `implicitSurface`와 Surface Nets로 만들며, 결정론적 보정 후에도 비매니폴드이면 차단합니다. 사진 투영은 원본을 향한 삼각형에만 적용하고 측면·후면은 근거 없는 반복 무늬 없이 별도 재질로 둡니다. 재질 검사는 색과 통계뿐 아니라 미세·중간·큰 스케일 및 실제 공간 배치를 비교해 픽셀을 뒤섞은 가짜 질감도 차단합니다. Apache-2.0인 img2threejs에서 참고한 부분과 변경 내용은 [`NOTICE`](./NOTICE)에 기록했습니다.

도면 기반 건축은 `planFootprintVerified` 표시만 믿지 않습니다. 소스 도면에서 잠근 점유 영역과 중정·후퇴부 같은 보호 공백을 실제 컴파일 메시 위에서 수직 광선으로 다시 샘플링해 IoU, 과잉 시공, 누락, 공백 침범을 계산합니다. 중앙 돌출부가 반대편으로 뒤집히거나 U자 중정이 메워지면 토폴로지가 멀쩡해도 품질 점수와 납품 판정이 차단됩니다. 또한 실측·데이터시트 치수는 전체 또는 이름 있는 부재의 X/Y/Z 크기·최소·최대·중심값으로 잠그고, 완성 메시의 월드 좌표를 다시 측정합니다. 회전된 칼날·경사 보·브래킷은 월드 AABB가 아니라 부품 자체 축의 길이·폭·두께로 검사할 수 있습니다. 부품 로컬 기준점 두 개를 지정하면 변환된 최종 메시에서 홀·핀·렌즈·커넥터 중심의 X/Y/Z 또는 3차원 피치도 다시 계산하며, 같은 회전 부품 안의 피치는 부품 자체 축으로 잠글 수 있습니다. 기준점은 실제 부품 형상 경계 안에 있어야 하며, 평면이 맞아도 층고·문/창 높이·슬래브 레벨이나 인터페이스 피치가 허용오차를 벗어나면 차단합니다. 감사 지문은 GLB 재열기까지 보존되어야 합니다. 도면에 없는 Laurel의 2700 mm 절개 높이는 계속 추정값으로 표시하며 치수 계약으로 승격하지 않습니다.

상세 결과: [`benchmarks/quality-latest.json`](./benchmarks/quality-latest.json) · [벤치마크 정책](./benchmarks/README.md) · [다중 시점 캡처 규격](./docs/VISUAL_CAPTURE_SET.md) · [img2threejs 실제 비교](./docs/COMPETITIVE_BENCHMARK.md)

동일한 Talon 사진으로 실제 비교했습니다. Morphloom은 조립 좌표계의 source-facing 삼각형에 원본을 정렬하고, 선형 색공간에서 넓은 조명 변화만 제한적으로 제거한 뒤 normal·roughness 맵을 만듭니다. 검신은 실제 쐐기 형상이며 절삭선 14/14구간에서 최대 날끝 0.12 mm를 측정합니다. 25개 편집 부품, 경계·비매니폴드·퇴화 삼각형 0, GLB 포락 오차 0.000 mm도 확인했습니다. 실제 투명 WebGL 정면 진단에서 Morphloom은 종합 0.911 대 0.785로 앞섰습니다. 추가로 양쪽 실제 장면 GLB를 Blender 5.2.1 LTS의 동일 카메라·조명·크기로 정면/후면/등각 3시점 렌더했고, 같은 GLB와 실제 파일 해시가 유지된 3/3 감사가 통과했습니다. 중립 정면에서는 종합 0.924 대 0.877, 내부 디테일 0.906 대 0.783, 재질 0.885 대 0.748이었습니다. 정면 한 장 기준이고 블라인드 패널이 없으므로 `unproven`, `claimAllowed: false`이며 전 분야 우세 주장이 아닙니다. [중립 렌더 감사](./benchmarks/talon-neutral-render-latest.json)와 [정면 진단](./benchmarks/talon-neutral-front-latest.json)을 공개합니다. 비교용 경쟁 렌더는 재배포하지 않고 해시만 기록합니다.

거친 표면은 색 노이즈만 입히지 않습니다. `surfacePatch`가 큰 굴곡과 2단 입도의 각진 골재를 닫힌 메시로 만들고, 같은 골재 규칙에서 albedo·normal·roughness를 생성합니다. 아스팔트 회귀 샘플은 6,959개 골재 특징, 111,936개 삼각형, RMS 높이 0.98 mm, 최고–최저 6.20 mm이며 경계·비매니폴드·퇴화 삼각형은 모두 0입니다. 이 수치는 절차형 표면 검증값이며 특정 도로의 실측·스캔 정확도를 뜻하지 않습니다.

사진 조건부 아스팔트 검증은 제공된 508×660 PNG의 SHA-256과 불규칙성 0.963을 기록하고, 99×128(12,672점) 높이장과 13,229개 절차 골재 특징을 결합했습니다. 높이장은 단일 블러가 아니라 미세·중간·큰 스케일 주파수 밴드를 결합하며 세 대역 모두 활성으로 측정됐고, 비교기는 반복 무늬가 같은 평균·분산으로 골재를 흉내 내는 경우도 차단합니다. 결과는 124,616 삼각형, RMS 0.58 mm, 최고–최저 4.35 mm, 폐쇄 메시 1/1이며 컴파일러 0.23.0 실제 Chromium GLB 재열기에서도 크기 오차 0 mm로 통과했습니다. 사진 명암에서 추정한 높이는 실측이 아니므로 현장 특화 재질에는 스캔 또는 높이 보정값이 필요합니다. 상세 기록은 [`benchmarks/asphalt-reference-latest.json`](./benchmarks/asphalt-reference-latest.json)에 있습니다.

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
