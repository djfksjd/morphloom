# Morphloom vs. img2threejs

검증 기준일: 2026-09-01
img2threejs 기준 커밋: [`9fbd0ca`](https://github.com/img2threejs/img2threejs/tree/9fbd0ca5bbcc3b13bebe712745d6784d33db0b85)

## 결론

Morphloom이 모든 시각 결과에서 img2threejs보다 낫다고 아직 주장할 수는 없습니다. img2threejs는 한 장의 참조 이미지를 절차적 Three.js 모델로 재구성하는 과정과 자동 검수의 폭이 매우 넓습니다. Python 3.12.13에서 공식 테스트를 직접 실행해 1,083개 중 1,045개 통과, 38개 건너뜀, 실패 0개를 확인했습니다.

Morphloom은 실측 건축물, 제품 분해 구조, 전기 연결, 편집 가능한 부재, GLB/DCC 납품 쪽이 더 넓습니다. 이번 고도화로 img2threejs의 강점이었던 디테일 우선 계약과 단계별 시각 검수를 Morphloom의 AssemblyIR 납품 흐름에 결합했습니다.

## 실제 반영한 장점

- 생성 전에 부품·재질·미세 표면·토폴로지를 `FidelityContract`로 잠급니다.
- 기준 카메라는 3개 이상의 앵커와 최대 재투영 오차를 가져야 합니다.
- `blockout → structure → form → material → surface → lighting → interaction → optimization` 순서를 건너뛸 수 없습니다.
- 전체 평균이 높아도 중요한 특징 하나가 임계값 아래면 통과하지 못합니다.
- 각 단계는 참조 시점, 직교, 클레이, 사광, 와이어, X-ray 중 필요한 검수 화면을 증거로 요구합니다.
- 동일 크기의 참조/렌더 프레임에서 실루엣 IoU, 내부 색·재질 차이, 특징 영역별 점수와 양쪽 이미지 지문을 직접 계산합니다.
- 수정 결과가 나빠지면 이전 최선 결과로 되돌리고, 같은 결함이 두 번 남으면 IR이 아니라 명세를 다시 고칩니다.
- 개선이 정체되거나 반복·토큰 상한에 도달하면 무한 생성하지 않고 추가 근거를 요청합니다.
- 계약과 검수 결과를 AssemblyIR/Three.js 장면에 보존해 이후 납품 검사가 잊지 않게 했습니다.

## 정직한 비교표

| 영역 | img2threejs | Morphloom |
|---|---|---|
| 한 장 이미지 기반 절차적 재구성 | 강점 | 보조 입력 |
| 디테일 인벤토리·특징별 합격 | 지원 | 지원 |
| 단계 잠금·회귀 방지·비용 상한 | 지원 | 지원 |
| 실측 건축·방/부재 편집 | 로드맵 | 지원 |
| 제품 내부 부품·전선 연결 감사 | 문서상 핵심 범위 아님 | 지원 |
| GLB와 Blender/Unity/Unreal 재열기 검사 | Three.js factory 중심 | 지원 |
| 자동 테스트 폭 | 1,083개 실행 확인 | 더 작음—계속 확대 필요 |
| 동일 이미지 블라인드 시각 우승 | 미검증 | 미검증 |

## 재실행

```bash
npm run benchmark:competitive
```

결과는 `benchmarks/competitive-latest.json`에 저장됩니다. 이 벤치마크는 계약·게이트의 작동을 비교합니다. 실제 시각 품질의 우열은 동일 입력, 동일 목표, 동일 카메라, 블라인드 평가자를 사용하는 별도 렌더 벤치마크가 있어야 확정할 수 있습니다.

## 참고한 img2threejs 근거

- [README의 detailInventory, visual hull, material pipeline, 단계별 검수](https://github.com/img2threejs/img2threejs/blob/9fbd0ca5bbcc3b13bebe712745d6784d33db0b85/README.md)
- [단계 오케스트레이션 구현](https://github.com/img2threejs/img2threejs/blob/9fbd0ca5bbcc3b13bebe712745d6784d33db0b85/forge/stage3_build/orchestrate_passes.py)
- [특징별 합격 정책](https://github.com/img2threejs/img2threejs/blob/9fbd0ca5bbcc3b13bebe712745d6784d33db0b85/forge/_shared/feature_acceptance_policy.py)
- [내부 차이 비교](https://github.com/img2threejs/img2threejs/blob/9fbd0ca5bbcc3b13bebe712745d6784d33db0b85/forge/stage4_review/interior_difference.py)
