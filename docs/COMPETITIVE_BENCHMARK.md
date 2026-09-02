# Morphloom vs. img2threejs

검증 기준일: 2026-09-02
img2threejs 기준 커밋: [`9fbd0ca`](https://github.com/img2threejs/img2threejs/tree/9fbd0ca5bbcc3b13bebe712745d6784d33db0b85)
최신 쇼케이스 실행 커밋: [`db90e65`](https://github.com/img2threejs/img2threejs-showcase/tree/db90e65a8d46f2a8d1a4eb76bd370b74ecfc467a)

## 결론

Morphloom이 모든 시각 결과에서 img2threejs보다 낫다고 아직 주장할 수는 없습니다. img2threejs는 한 장의 참조 이미지를 절차적 Three.js 모델로 재구성하는 과정과 자동 검수의 폭이 매우 넓습니다. Python 3.12.13에서 공식 테스트를 직접 실행해 1,083개 중 1,045개 통과, 38개 건너뜀, 실패 0개를 확인했습니다.

Morphloom은 실측 건축물, 제품 분해 구조, 전기 연결, 편집 가능한 부재, GLB/DCC 납품 쪽이 더 넓습니다. 이번 고도화로 img2threejs의 강점이었던 디테일 우선 계약과 단계별 시각 검수에 더해, 실제 시각 외피·내부 밴드·재질 비교 알고리즘을 Apache-2.0 조건에 맞춰 Morphloom의 AssemblyIR 납품 흐름에 결합했습니다.

추가로 Morphloom은 분야마다 다른 납품 계약을 실행합니다. 건축은 도면 점유영역 대비 실제 메시 상부 재투영 IoU·과잉/누락·보호 공백 침범, 폐쇄 셸, 80% 이상 미세표면을 함께 검사합니다. 애니메이션은 49본·30개 손가락 본의 실제 가중 정점·관절 변형과 22클립/185트랙의 이름·바인딩·실제 움직임·루프 이음·in-place 루트모션·5개 얼굴 모프 이름·GLB 메타데이터 보존, 게임은 10만 tris 예산·실제 스킨 LOD1·유한 치수/본 연결/바디 교차 충돌체·유한 UV·UV 삼각형 면적·단위 노멀, 3D 프린팅은 mm·폐쇄 체적·0.8 mm 이상 선언 형상·전역 `2V/A`와 연결 외피별 제한 국부 벽 두께 레이·45° 오버행 실측을 각각 검사합니다. 현재 8개 잠금 사례의 기술·판정·납품·거절 안전성은 모두 100%입니다.

최신 쇼케이스 전체도 직접 빌드했습니다. Lee Sin은 42본/10클립, Boxing Man은 41본/19클립, Monster는 41본/27클립을 표시합니다. Morphloom은 22개 의미 기반 클립으로 앞의 두 사례보다 많지만 Monster의 원시 클립 수 27개에는 못 미칩니다. 대신 모든 클립에 동작 범주·loop 여부·root-motion 정책을 선언하고 185개 트랙의 실제 변형, 반복 이음, in-place 이동, 49본/30손가락 본, 스킨 LOD, 충돌 정보와 GLB 재열기 후 메타데이터 지문까지 하나의 차단 게이트로 검증합니다. 따라서 **최대 클립 개수 우위가 아니라 납품 계약의 깊이 우위**로 표현합니다.

## 같은 Talon 사진으로 실제 렌더 비교

공개 Talon Doppler Ruby 정면 사진 한 장을 양쪽에 동일하게 사용했습니다. img2threejs는 공개 데모의 고정 캡처 모드로 다시 렌더했고, Morphloom은 사진의 알파 외곽과 내부 개구를 측정해 `TALON_REFERENCE_BENCHMARK_IR`을 생성한 뒤 로컬 뷰어에서 정면·ISO 렌더와 GLB 재열기를 실행했습니다.

UI·바닥·실측 보조선을 제거한 Morphloom 투명 WebGL PNG와 실제 img2threejs 캡처를 512×256 전경 포락으로 정렬한 정면 진단도 실행했습니다. 사진의 넓은 조명 변화는 메모리 상한이 있는 선형 색공간 lighting field로 제한적으로 제거하고, 원본의 미세·중간 표면 신호는 normal·roughness 입력으로 유지했습니다. Morphloom은 종합 0.911 대 0.785, 실루엣 0.937 대 0.745, 내부 디테일 0.929 대 0.868, 재질·질감 0.851 대 0.805, 표면 스케일 0.873 대 0.777, 불규칙성 0.849 대 0.771, 공간 질감 0.602 대 0.470으로 앞섰습니다. 색상 0.870 대 0.863과 미세구조 0.940 대 0.931도 Morphloom이 앞섰으며, 비교 렌더는 새 공간 질감 게이트에서 탈락했습니다. 이는 한 뷰 자동 진단이므로 필요한 2개 보정 시점과 5명 블라인드 패널을 충족하지 않아 `unproven`, `claimAllowed: false`입니다. 결과와 캡처 해시는 [`../benchmarks/talon-visual-broadside-latest.json`](../benchmarks/talon-visual-broadside-latest.json)에 고정했습니다.

| 실제 결과 | img2threejs | Morphloom |
|---|---:|---:|
| 정면 색상 재현 | 원본 플레이트 투영 | 조립 좌표계 원본 투영 |
| 사진 기반 표면 요철·거칠기 | Talon 코드에 normal/roughness map 없음 | 우세—소스 파생 normal+roughness 25/25 |
| 절삭날 두께 | 장면 수치 미표시 | 실제 wedge taper, 14/14구간 최대 0.12 mm |
| 실제 관통 개구 | 칼날 3 + 링 1 | 칼날 3 + 링 1 |
| 독립 편집 부품 | 데모 표시 5개 | 25개 명명 부품 |
| 폐쇄 메시 | 공개 화면에서 수치 미표시 | 25/25, 경계 0, 비매니폴드 0 |
| GLB 재열기 | 공개 화면에서 수치 미표시 | PASS, 포락 오차 0.000 mm, 명명 노드 100% |
| 준실무 납품성 | Three.js 전시 강점 | 우세—IR/GLB/OBJ/STL/PLY/USDZ/Figma SVG |

정면 색상 투영은 양쪽 모두 지원합니다. 검증한 img2threejs Talon 재질은 base-color plate와 상수 roughness를 사용하고, Morphloom은 같은 입력에서 파생한 normal·roughness를 GLB에 포함합니다. 따라서 이 사례에서 **표면 반응 기능과 편집·토폴로지·납품 범위는 Morphloom 쪽이 더 넓음**을 확인했습니다. 이것은 블라인드 지각 품질 우승 판정이 아닙니다. 단일 사진에서 안 보이는 깊이와 후면도 실측했다고 판정하지 않습니다. 상세 수치는 [`../benchmarks/talon-same-reference-latest.json`](../benchmarks/talon-same-reference-latest.json)에 고정했습니다.

이 비교로 확인된 근본 결함도 수정했습니다. 기존 `extrude`는 외곽만 받아 칼날 구멍을 가짜 검은 원으로 표현할 수밖에 없었지만, 이제 임의 다각형 홀과 타원 홀을 실제로 뚫고 검증합니다. 이 연산은 칼뿐 아니라 환기구, 기계 브래킷, 가구 손잡이, 제품 포트에도 재사용됩니다.

## 실제 반영한 장점

- 생성 전에 부품·재질·미세 표면·토폴로지를 `FidelityContract`로 잠급니다.
- 사진 기준 카메라는 4개 이상의 안정적인 앵커와 최대 4 px 재투영 오차를 가져야 합니다.
- `blockout → structure → form → material → surface → lighting → interaction → optimization` 순서를 건너뛸 수 없습니다.
- 전체 평균이 높아도 중요한 특징 하나가 임계값 아래면 통과하지 못합니다.
- 각 단계는 참조 시점, 직교, 클레이, 사광, 와이어, X-ray 중 필요한 검수 화면을 증거로 요구합니다.
- 동일 크기의 참조/렌더 프레임에서 실루엣 IoU, 내부 색·재질 차이, 특징 영역별 점수와 양쪽 이미지 지문을 직접 계산합니다.
- 2~3개의 직교 실루엣이 있으면 제한된 복셀 공간을 교집합으로 깎아 중복 내부면이 없는 용접된 폐쇄 메시를 만듭니다. 결과를 각 입력 시점으로 다시 투영해 최소 IoU 0.75·신뢰도 가중 IoU 0.85 미만은 폐쇄 메시라도 차단합니다.
- 유기형·연속 곡면은 `implicitSurface`의 sphere/capsule/box/cone/ellipsoid와 smooth-union/subtract/intersect 그래프로 편집하며 Surface Nets로 폴리곤화합니다. 특정 해상도의 모호한 셀이 비매니폴드 에지를 만들면 최대 4단계 범위에서 결정론적으로 재샘플링하고, 해결되지 않으면 납품을 차단합니다.
- 크기가 다른 참조/렌더도 전경 포락을 정렬한 뒤 상·중·하 내부를 분리 비교하므로 얼굴·창호·버튼 같은 내부 누락이 윤곽 점수에 숨지 않습니다.
- 재질 영역은 CIE Lab 색차, 밝기, 미세·중간·큰 스케일 대비, 기울기 방향 분포, 주기성, 불규칙성, 공간 배치를 별도로 검사해 색·통계만 비슷하거나 픽셀을 뒤섞은 재질을 차단합니다.
- 로컬 참조 플레이트를 부품 별 UV가 아닌 조립 XY 좌표계로 투영해 편집 부품 사이의 무늬가 끊기지 않습니다.
- 투명 원본의 검정 RGB가 필터 경계에 번지지 않도록 가장 가까운 유효 표면색을 제한된 픽셀 예산 안에서 확장합니다. 투영은 signed normal로 판정한 source-facing 삼각형에만 적용하며, 접선·후면은 authored UV와 `unobserved-side` 재질을 유지해 측면 오염·거울 복제·바코드 경계를 막습니다.
- 원본 밝기의 국부 기울기와 변동에서 tangent-space normal·roughness map을 생성해 요철·마모가 조명에 반응하게 합니다.
- `https:` 참조는 거부하고 로컬 경로와 `blob:`만 허용하며, 투영 로드 실패 시 100점과 GLB 납품을 모두 차단합니다.
- 수정 결과가 나빠지면 이전 최선 결과로 되돌리고, 같은 결함이 두 번 남으면 IR이 아니라 명세를 다시 고칩니다.
- 개선이 정체되거나 반복·토큰 상한에 도달하면 무한 생성하지 않고 추가 근거를 요청합니다.
- 계약과 검수 결과를 AssemblyIR/Three.js 장면에 보존해 이후 납품 검사가 잊지 않게 했습니다.
- 건축 도면은 직사각형 조합뿐 아니라 오목한 단일 다각형으로 소스 점유 구역을 잠글 수 있습니다. 자기교차 외곽선은 래스터 처리 전에 거부하고, 보호 공백과 실제 컴파일 메시를 위에서 재투영합니다. U자 중정 메움, 중앙 돌출부 반전, 누락/과잉 면적은 단순 포락이나 `verified` 메타데이터로 통과할 수 없으며 감사 지문도 GLB 재열기에서 확인합니다.
- 브라우저 GLB 검증은 동일 입력을 하나의 작업으로 합치고 서로 다른 무거운 작업을 직렬화합니다. 대기 작업은 4개로 제한하며, 오래된 결과가 현재 선택을 덮지 못하고 현재 항목을 다시 선택해도 이미 통과한 증거를 지우지 않습니다.

## 정직한 비교표

| 영역 | img2threejs | Morphloom |
|---|---|---|
| 한 장 이미지 기반 절차적 재구성 | 강점 | 보조 입력 |
| 디테일 인벤토리·특징별 합격 | 지원 | 지원 |
| 단계 잠금·회귀 방지·비용 상한 | 지원 | 지원 |
| 다중 실루엣 시각 외피 | 지원 | 지원—브라우저용 TypeScript 이식 + 시점별 역투영 IoU/오류 차단 |
| 유기형 암시적 곡면 | Surface Nets | 지원—Surface Nets + 경계 패딩·삼각형 예산·자동 매니폴드 재샘플링 차단 |
| 전경 정렬 내부 밴드 비교 | 지원 | 지원—상·중·하/사용자 구간 |
| 결정론적 재질 영역 비교 | 지원 | 지원—색·밝기·다중 스케일 구조·방향성·주기성·불규칙성·공간 대응 구조 |
| 실측 건축·방/부재 편집 | 로드맵 | 지원 |
| 제품 내부 부품·전선 연결 감사 | 문서상 핵심 범위 아님 | 지원 |
| GLB 규격·교차 파서·브라우저 재열기 검사 | Three.js factory 중심 | Khronos 공식 Validator + glTF Transform + 실제 바이트 Three.js 재열기 |
| 동일 입력 GLB 바이트 재현성 | 고정 커밋 감사에서 확인되지 않음 | 5분야 각각 2회 독립 생성 SHA-256 일치 |
| Blender 앱 자체 임포트·재내보내기·재임포트 | 공개 자동 증명 없음 | Blender 5.2.1 LTS에서 현재 compiler revision과 결합된 건축·산업디자인·전자 조립·애니메이션/게임·3D 프린팅 표면 5/5 통과 |
| DCC 재출력 바이트 정화·재검증 | 고정 커밋 감사에서 확인되지 않음 | Blender가 재생성한 비정상 탄젠트를 기록·복구하고 최종 바이트를 Khronos 오류/경고/정보 0 + glTF Transform 재파싱으로 차단 |
| Unity 앱 자체 임포트 | 공개 자동 증명 없음 | glTFast 6.20 고정 5분야 프리팹 임포트 하네스 구현·Unity 6000.5 API 컴파일 통과; 최신 실제 실행은 로컬 라이선싱 초기화 실패로 임포트 전 차단 |
| Unreal 앱 자체 임포트 | 공개 자동 증명 없음 | 아직 별도 검수—실행하지 않은 앱을 검증 완료로 표시하지 않음 |
| 실제 스켈레톤·스킨·애니메이션 GLB | 최신 쇼케이스 41–42 bones, 10–27 clips | 지원—49 bones(손가락 30), 실제 손가락 가중 정점·관절 변형, 22 clips/185 tracks의 이름·바인딩·동작·루프·루트모션·메타데이터 재열기 |
| 게임 LOD·충돌·예산·UV·노멀 게이트 | 고정 커밋 감사에서 확인되지 않음 | 지원—실제 스킨 LOD0/1의 중립/관절 포즈 3축 실루엣·포락·가중치 보존, 16부위 충돌 캡슐/구의 양끝점·중심·높이·회전·본·바디 교차·높이 커버, GLB 충돌 지문, 유한/비퇴화 UV·단위 노멀 검사 |
| 3D 프린팅 mm·폐쇄 체적·최소 형상·전역/국부 벽 두께·45° 오버행 | 고정 커밋 감사에서 확인되지 않음 | 지원—연결 외피별 6방향+위치/노멀 최장거리 표본, 256메시·수집 50만 삼각형·용접 정점 50만·연결 모서리 100만·메시당 96레이·2,400만 삼각형 검사 상한, 할당 전 초과/미히트/0체적/예산 소진 차단 |
| 실제 삼각형 자기 교차 | 고정 커밋에 ray-parity 검사 존재 | 공간 격자 broadphase + 정확 삼각형 교차 + 검사예산 초과 차단; 제품·전선·포즈·LOD·프린트 계약에 연결 |
| 자동 테스트 폭 | 코어 1,083개 실행 확인 | 188개—개수보다 납품 계약 회귀·고밀도 본체에 숨은 분리 0.3 mm 외피/단일 폐쇄 외피의 회전된 0.3 mm 탭/연결 인덱스 메모리 상한/할당 전 삼각형 상한/두께 검사 예산 소진·실제 삼각형 자기교차·손상/경고 GLB 공식 규격 차단·오목 다각형 건축 평면 반전/공백 침범·가짜 LOD/충돌체·충돌 리그 포즈 정렬·UV/노멀 위장·브라우저 검증 중복/경쟁·빈 동작/루프 단절·표면 스케일/공간 셔플 위장·다중 시점 불일치·암시적 곡면 결함·위험한 de-light 증거·거짓 우위 차단에 집중 |
| 동일 Talon 이미지 정면 색상 | 원본 plate 투영 | 원본 plate 투영 |
| 동일 Talon 이미지 표면 PBR 반응 | 상수 roughness, normal map 없음 | 우세—사진 파생 normal+roughness |
| 동일 Talon 이미지 편집·납품 결과 | 제한적 공개 지표 | 우세—25개 부품, 실제 wedge 날, 폐쇄 토폴로지, GLB 재열기 |

## 재실행

```bash
npm run benchmark:competitive
npm run benchmark:visual-captures -- --reference public/benchmark-input/talon-doppler-ruby.webp --morphloom morphloom-result.png --competitor img2threejs-talon-live.png --competitor-threshold 48 --output benchmarks/talon-visual-broadside-latest.json
npm run benchmark:fixtures -- /tmp/morphloom-fixtures
npm run benchmark:blender-cross-domain -- /tmp/morphloom-fixtures
npm run benchmark:unity-cross-domain -- /tmp/morphloom-fixtures
```

결과는 `benchmarks/competitive-latest.json`, `benchmarks/blender-cross-domain-latest.json`, `benchmarks/unity-cross-domain-latest.json`에 저장됩니다. 5분야 Blender 증명은 실제 상호운용성과 납품 바이트 무결성을 확인하지만 동일 입력의 시각적 우승을 뜻하지 않습니다. Unity 보고서는 라이선스나 에디터 실패도 구조화해 기록하며 임포트하지 못한 실행을 통과로 바꾸지 않습니다. 실제 시각 품질의 우열은 동일 입력 지문, 동일 목표, 동일 보정 카메라, 실제 WebGL 캡처, 중요 특징 영역, 최소 5명의 중복 없는 균형 블라인드 평가가 있어야 확정됩니다. 이 증거가 없으면 자동 지표가 앞서도 보고서는 `claimAllowed: false`를 유지합니다.

## 참고한 img2threejs 근거

- [Talon 전시의 base-color plate·상수 roughness 재질 구현](https://github.com/img2threejs/img2threejs-showcase/blob/1deaefc66407e6765782f9578b76db079e1ad40c/src/demos/talon-doppler-ruby/createTalonDopplerRubyModel.ts#L383-L445)
- [README의 detailInventory, visual hull, material pipeline, 단계별 검수](https://github.com/img2threejs/img2threejs/blob/9fbd0ca5bbcc3b13bebe712745d6784d33db0b85/README.md)
- [단계 오케스트레이션 구현](https://github.com/img2threejs/img2threejs/blob/9fbd0ca5bbcc3b13bebe712745d6784d33db0b85/forge/stage3_build/orchestrate_passes.py)
- [특징별 합격 정책](https://github.com/img2threejs/img2threejs/blob/9fbd0ca5bbcc3b13bebe712745d6784d33db0b85/forge/_shared/feature_acceptance_policy.py)
- [내부 차이 비교](https://github.com/img2threejs/img2threejs/blob/9fbd0ca5bbcc3b13bebe712745d6784d33db0b85/forge/stage4_review/interior_difference.py)
- [시각 외피 공간 깎기](https://github.com/img2threejs/img2threejs/blob/9fbd0ca5bbcc3b13bebe712745d6784d33db0b85/forge/stage3_build/visual_hull.py)
- [재질 영역 비교](https://github.com/img2threejs/img2threejs/blob/9fbd0ca5bbcc3b13bebe712745d6784d33db0b85/forge/stage4_review/material_comparator.py)
