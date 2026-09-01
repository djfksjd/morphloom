# Morphloom vs. img2threejs

검증 기준일: 2026-09-01
img2threejs 기준 커밋: [`9fbd0ca`](https://github.com/img2threejs/img2threejs/tree/9fbd0ca5bbcc3b13bebe712745d6784d33db0b85)

## 결론

Morphloom이 모든 시각 결과에서 img2threejs보다 낫다고 아직 주장할 수는 없습니다. img2threejs는 한 장의 참조 이미지를 절차적 Three.js 모델로 재구성하는 과정과 자동 검수의 폭이 매우 넓습니다. Python 3.12.13에서 공식 테스트를 직접 실행해 1,083개 중 1,045개 통과, 38개 건너뜀, 실패 0개를 확인했습니다.

Morphloom은 실측 건축물, 제품 분해 구조, 전기 연결, 편집 가능한 부재, GLB/DCC 납품 쪽이 더 넓습니다. 이번 고도화로 img2threejs의 강점이었던 디테일 우선 계약과 단계별 시각 검수에 더해, 실제 시각 외피·내부 밴드·재질 비교 알고리즘을 Apache-2.0 조건에 맞춰 Morphloom의 AssemblyIR 납품 흐름에 결합했습니다.

## 같은 Talon 사진으로 실제 렌더 비교

공개 Talon Doppler Ruby 정면 사진 한 장을 양쪽에 동일하게 사용했습니다. img2threejs는 공개 데모의 고정 캡처 모드로 다시 렌더했고, Morphloom은 사진의 알파 외곽과 내부 개구를 측정해 `TALON_REFERENCE_BENCHMARK_IR`을 생성한 뒤 로컬 뷰어에서 정면·ISO 렌더와 GLB 재열기를 실행했습니다.

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

정면 색상 투영은 양쪽 모두 지원합니다. 하지만 검증한 img2threejs Talon 재질은 base-color plate와 상수 roughness를 사용하고, Morphloom은 같은 입력에서 파생한 normal·roughness를 GLB에 포함합니다. 따라서 이 사례의 **참조 기반 표면 재질 반응은 Morphloom 우세**, 편집·토폴로지·납품도 Morphloom 우세입니다. 단, 단일 사진에서 안 보이는 깊이와 후면을 실측했다고 판정하지 않습니다. 상세 수치는 [`../benchmarks/talon-same-reference-latest.json`](../benchmarks/talon-same-reference-latest.json)에 고정했습니다.

이 비교로 확인된 근본 결함도 수정했습니다. 기존 `extrude`는 외곽만 받아 칼날 구멍을 가짜 검은 원으로 표현할 수밖에 없었지만, 이제 임의 다각형 홀과 타원 홀을 실제로 뚫고 검증합니다. 이 연산은 칼뿐 아니라 환기구, 기계 브래킷, 가구 손잡이, 제품 포트에도 재사용됩니다.

## 실제 반영한 장점

- 생성 전에 부품·재질·미세 표면·토폴로지를 `FidelityContract`로 잠급니다.
- 기준 카메라는 3개 이상의 앵커와 최대 재투영 오차를 가져야 합니다.
- `blockout → structure → form → material → surface → lighting → interaction → optimization` 순서를 건너뛸 수 없습니다.
- 전체 평균이 높아도 중요한 특징 하나가 임계값 아래면 통과하지 못합니다.
- 각 단계는 참조 시점, 직교, 클레이, 사광, 와이어, X-ray 중 필요한 검수 화면을 증거로 요구합니다.
- 동일 크기의 참조/렌더 프레임에서 실루엣 IoU, 내부 색·재질 차이, 특징 영역별 점수와 양쪽 이미지 지문을 직접 계산합니다.
- 2~3개의 직교 실루엣이 있으면 제한된 복셀 공간을 교집합으로 깎아 중복 내부면이 없는 용접된 폐쇄 메시를 만듭니다.
- 크기가 다른 참조/렌더도 전경 포락을 정렬한 뒤 상·중·하 내부를 분리 비교하므로 얼굴·창호·버튼 같은 내부 누락이 윤곽 점수에 숨지 않습니다.
- 재질 영역은 CIE Lab 색차, 밝기, 미세 대비, 방향성 반사를 별도로 검사해 색만 비슷한 평면 재질을 차단합니다.
- 로컬 참조 플레이트를 부품 별 UV가 아닌 조립 XY 좌표계로 투영해 편집 부품 사이의 무늬가 끊기지 않습니다.
- 원본 밝기의 국부 기울기와 변동에서 tangent-space normal·roughness map을 생성해 요철·마모가 조명에 반응하게 합니다.
- `https:` 참조는 거부하고 로컬 경로와 `blob:`만 허용하며, 투영 로드 실패 시 100점과 GLB 납품을 모두 차단합니다.
- 수정 결과가 나빠지면 이전 최선 결과로 되돌리고, 같은 결함이 두 번 남으면 IR이 아니라 명세를 다시 고칩니다.
- 개선이 정체되거나 반복·토큰 상한에 도달하면 무한 생성하지 않고 추가 근거를 요청합니다.
- 계약과 검수 결과를 AssemblyIR/Three.js 장면에 보존해 이후 납품 검사가 잊지 않게 했습니다.

## 정직한 비교표

| 영역 | img2threejs | Morphloom |
|---|---|---|
| 한 장 이미지 기반 절차적 재구성 | 강점 | 보조 입력 |
| 디테일 인벤토리·특징별 합격 | 지원 | 지원 |
| 단계 잠금·회귀 방지·비용 상한 | 지원 | 지원 |
| 다중 실루엣 시각 외피 | 지원 | 지원—브라우저용 TypeScript 이식 |
| 전경 정렬 내부 밴드 비교 | 지원 | 지원—상·중·하/사용자 구간 |
| 결정론적 재질 영역 비교 | 지원 | 지원—색·밝기·미세구조·방향성 |
| 실측 건축·방/부재 편집 | 로드맵 | 지원 |
| 제품 내부 부품·전선 연결 감사 | 문서상 핵심 범위 아님 | 지원 |
| GLB와 Blender/Unity/Unreal 재열기 검사 | Three.js factory 중심 | 지원 |
| 자동 테스트 폭 | 1,083개 실행 확인 | 더 작음—계속 확대 필요 |
| 동일 Talon 이미지 정면 색상 | 원본 plate 투영 | 원본 plate 투영 |
| 동일 Talon 이미지 표면 PBR 반응 | 상수 roughness, normal map 없음 | 우세—사진 파생 normal+roughness |
| 동일 Talon 이미지 편집·납품 결과 | 제한적 공개 지표 | 우세—25개 부품, 실제 wedge 날, 폐쇄 토폴로지, GLB 재열기 |

## 재실행

```bash
npm run benchmark:competitive
```

결과는 `benchmarks/competitive-latest.json`에 저장됩니다. 이 벤치마크는 계약·게이트의 작동을 비교합니다. 실제 시각 품질의 우열은 동일 입력, 동일 목표, 동일 카메라, 블라인드 평가자를 사용하는 별도 렌더 벤치마크가 있어야 확정할 수 있습니다.

## 참고한 img2threejs 근거

- [Talon 전시의 base-color plate·상수 roughness 재질 구현](https://github.com/img2threejs/img2threejs-showcase/blob/1deaefc66407e6765782f9578b76db079e1ad40c/src/demos/talon-doppler-ruby/createTalonDopplerRubyModel.ts#L383-L445)
- [README의 detailInventory, visual hull, material pipeline, 단계별 검수](https://github.com/img2threejs/img2threejs/blob/9fbd0ca5bbcc3b13bebe712745d6784d33db0b85/README.md)
- [단계 오케스트레이션 구현](https://github.com/img2threejs/img2threejs/blob/9fbd0ca5bbcc3b13bebe712745d6784d33db0b85/forge/stage3_build/orchestrate_passes.py)
- [특징별 합격 정책](https://github.com/img2threejs/img2threejs/blob/9fbd0ca5bbcc3b13bebe712745d6784d33db0b85/forge/_shared/feature_acceptance_policy.py)
- [내부 차이 비교](https://github.com/img2threejs/img2threejs/blob/9fbd0ca5bbcc3b13bebe712745d6784d33db0b85/forge/stage4_review/interior_difference.py)
- [시각 외피 공간 깎기](https://github.com/img2threejs/img2threejs/blob/9fbd0ca5bbcc3b13bebe712745d6784d33db0b85/forge/stage3_build/visual_hull.py)
- [재질 영역 비교](https://github.com/img2threejs/img2threejs/blob/9fbd0ca5bbcc3b13bebe712745d6784d33db0b85/forge/stage4_review/material_comparator.py)
