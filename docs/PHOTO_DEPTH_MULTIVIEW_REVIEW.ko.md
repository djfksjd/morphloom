# 사진 깊이·멀티뷰 생성 모델의 Morphloom 적합성 검토

검토일: 2026-10-02. Morphloom 게시 커밋: `bb462e40dcde4804f7fabec36511af9779d3561d`.
판정: 선택적 로컬 보조 기능의 후보. 모델 연동·추론·품질 검증 완료가 아니다.
이번 작업은 코드·공식 모델 메타데이터 감사이며 가중치 다운로드와 의존성 설치는 하지 않았다.

## 권장 결정

Distill-Any-Depth는 **보이는 면의 상대 깊이** 실험에 적합하다. 반대편 생성은 Wonder3D/Era3D의 별도 역할이다. 두 경로는 관측 사진과 실측 치수보다 낮은 우선순위의 추정 근거로 취급한다.

첫 구현 우선순위는 모델 설치보다 **로컬 워커, 원시 깊이 산출물, 합성 근거의 출처, 카메라 변환 계약**이다. 현재 DomainPack은 동기식 ElementProject 생성 API이므로 Python 추론을 기존 `generate`에 숨겨 넣지 않는다. 무거운 모델은 선택 기능으로 유지하고 기존 결정론적 IR 컴파일러·편집·납품 검사를 재사용한다.

멀티뷰 첫 비교 후보는 Wonder3D와 Era3D의 정사영 변형이다. 공식 CUDA 환경과 라이선스 범위가 정해진 뒤 비교한다. Zero123++/InstantMesh는 상용 기본 경로 판정을 보류한다. TRELLIS.2는 별도 참고 메시 실험 후보로 남긴다. 현재 장치에서 실행할 수 있다고 검증한 멀티뷰 후보는 없다.

## 후보 비교: 기능과 배포 조건은 분리

| 후보 | 실제 역할 / 코드 확인 | 라이선스·실행 제한 | Morphloom 판정 |
|---|---|---|---|
| [Distill-Any-Depth](https://github.com/Westlake-AGI-Lab/Distill-Any-Depth) | 단안 상대 깊이. Small 24.8M. CLI CUDA 고정; app CPU 선택 경로. MPS 경로 미연결 | 코드 MIT; [공식 체크포인트 카드](https://huggingface.co/xingyang1/Distill-Any-Depth) Apache-2.0 선언. Small 파일 크기 99,165,428 bytes는 원격 메타데이터이며 다운로드/RAM 측정이 아님 | 선택적 보이는 면 깊이 실험 우선. mm·후면 복원 판정 불가 |
| [Wonder3D](https://github.com/xxlong0/Wonder3D) | 256²의 6시점 RGB+normal. 입력 카메라 기준 정사영; 방위각 0,45,90,180,-90,-45 | 코드 MIT와 달리 [공식 예제 가중치](https://huggingface.co/flamehaze1115/wonder3d-v1.0) AGPL-3.0. 복원에 CUDA 도구 사용 | 숨은 면 후보 비교용. 미세 특징 해상도와 배포 조건 검토 필요 |
| [Era3D](https://github.com/pengHTYX/Era3D) | 512² 멀티뷰 RGB+normal. 원본 focal/elevation 예측; ortho 변형은 회귀 모듈 제거 | GitHub AGPL-3.0 및 코드·모델 포함 제품 조건 설명. [공식 모델 카드](https://huggingface.co/pengHTYX/MacLab-Era3D-512-6view)에는 Apache-2.0: **표기 충돌**, 배포 판정 보류. 설치 CUDA/xformers | 정사영 변형을 비교 후보로 유지. 원본·ortho 모델 혼동 금지 |
| [Zero123++](https://github.com/SUDO-AI-3D/zero123plus) | 6시점 이미지; v1.2 FOV 30°, elevation 20/-10 교대. normal은 별도 ControlNet | 코드 Apache-2.0, README 가중치 CC-BY-NC-4.0. ~5GB는 공식 기본 예제 수치이며 전체 복원 예산 아님 | 상용 기본 경로 보류. 정사영 hull에 직접 투입 불가 |
| [InstantMesh](https://github.com/TencentARC/InstantMesh) | 멀티뷰→복원 메시. `run.py`가 Zero123++ v1.2를 로드한 뒤 자체 UNet 적용; 기본 OBJ/vertex color, texmap 선택 | 자체 코드·카드 Apache-2.0만으로 전체 체인 조건 해결 불가. CUDA 권장 | 파이프라인 참고; upstream 모델 조건 포함 감사 필요 |
| [TRELLIS.2](https://github.com/microsoft/TRELLIS.2) | 이미지→메시/PBR/GLB. 선언형 치수·조립 부품을 자동 보장하지 않음 | 자체 코드·모델 MIT; Linux/NVIDIA≥24GB 공식 조건. setup의 nvdiffrast v0.4.0 및 nvdiffrec renderutils에 비상업 사용 제한 | 현재 Mac 공식 경로 blocked. 무거운 선택적 참고 메시 후보 |

AGPL은 비상업 전용이라는 뜻이 아니다. 결합·배포·네트워크 서비스 조건을 검토해야 하며 별도 프로세스만으로 조건이 자동 해소된다고 판단하지 않는다. 위 표는 확인된 문서·메타데이터 비교이며 법률 승인 판정이 아니다. TRELLIS 의존성은 실제 설치 대상으로 지정된 [nvdiffrast v0.4.0](https://raw.githubusercontent.com/NVlabs/nvdiffrast/v0.4.0/LICENSE.txt), [nvdiffrec renderutils](https://raw.githubusercontent.com/JeffreyXiang/nvdiffrec/renderutils/LICENSE.txt)를 읽었다. 모델 카드 표기만으로 모든 기반 모델·종속 도구·데이터 권리를 확정하지 않는다.

## Distill-Any-Depth를 그대로 붙일 수 없는 이유

확인한 upstream 커밋: `6d8f415392eafb49c96a38cc4dedbd09a1607f50`.
[`app.py`](https://github.com/Westlake-AGI-Lab/Distill-Any-Depth/blob/6d8f415392eafb49c96a38cc4dedbd09a1607f50/app.py)는 700²로 종횡비 유지 없이 변환하고, 예측을 이미지마다 min/max 정규화한 후 컬러 uint8 이미지로 반환한다. 이를 높이장으로 읽으면 깊이의 의미와 원본 픽셀 대응이 손실된다. 분모가 0인 상수 출력도 별도 방어가 필요하다.

[`infer.py`](https://github.com/Westlake-AGI-Lab/Distill-Any-Depth/blob/6d8f415392eafb49c96a38cc4dedbd09a1607f50/tools/testers/infer.py)는 CUDA를 요구하고 small 로더 분기와 argparse 선택지가 불일치한다. `--mode` 선택만으로 metric 깊이가 보장되지 않는다. large는 disparity로 구성한다. `app.py`는 요청마다 모델을 구성·로드하므로 상주 로컬 워커에서 제한된 캐시와 작업 수가 필요하다. 전처리 변경은 모델 품질에 영향을 줄 수 있어 원본 방식과 종횡비 보존 방식을 함께 비교해야 한다.

## 기존 Morphloom과 접점

| 현재 구현 | 확인한 실제 제한 | 최소 확장 방향 — 이번 검토에서 미구현 |
|---|---|---|
| `src/engine/reference-surface.ts` | 밝기/고역 신호 기반 미세 높이·normal·roughness 추정; 물체 깊이 아님 | 유지. 상대 깊이 자료는 별도 artifact와 코드 경로로 분리 |
| `src/engine/assembly-ir.ts` | 연산 allowlist; surfacePatch relief와 visualHull 존재 | 모델 출력으로 기존 연산을 우회하거나 임의 코드 실행하지 않음 |
| `src/engine/visual-hull.ts` | component-local 정사영 mask; canonical/yaw 프레임. 원근·elevation·깊이·normal 융합 미지원 | Wonder/Era의 카메라·마스크 변환 검증; 원근 뷰는 명시적으로 거부하거나 별도 검증된 연산 필요 |
| `src/engine/fidelity-pipeline.ts` | 검수 카메라는 원근/정사영 지원 | 검수 카메라 지원을 hull의 원근 복원 지원으로 해석하지 않음 |
| `src/engine/reference-set.ts` | 역할/capability 기반 coverage; synthetic lineage 계약 없음 | 합성 뷰를 실제 후면 사진 또는 depth/scale 해결 근거로 세지 않도록 계약 추가 |
| `src/engine/element-domain-packs.ts` | API 0.4도 동기식 native ElementProject 생성; experimental | 비동기 로컬 추론 job/파일 어댑터를 별도 좁은 계약으로 설계 |

실루엣 hull은 오목한 홈·깊은 관통 구조를 해결하지 못할 수 있다. normal 지도도 탄젠트 공간 재질 normal과 카메라/월드 공간 형상 normal을 구분해야 한다. 생성 메시를 받았다고 부품 ID·치수·토폴로지·리깅이 회복된 것으로 표시하지 않는다.

## 다음 실험의 선작성 계약

제안이며 구현/합격 증거는 아니다.

- 데이터: 원본 fingerprint, 모델/체크포인트 revision 및 SHA, 엔진·전처리 버전, seed, 장치, 원시 Float32 값, finite/유효 mask, 원본→모델→출력 픽셀 변환, 카메라·좌표·단위. 상대 depth/inverse-depth/disparity를 명시; 근거 없는 confidence 지도를 만들어 붙이지 않음.
- 합성 시점: synthetic, 원본 ID, 모델·seed·카메라·crop·법선 좌표계, inferred 영역. 원본 실측값·사용자 수정은 우선 보존. 기존 schema/job/patch 변경 시 version/migration/실패 조건 선작성.
- 워커: 로컬 입력만, 지정된 실행 파일과 선언형 인자, 작업 취소·timeout·byte/pixel 예산, 실패 격리. 모델 자동 다운로드/외부 업로드 금지. 산출물은 원본 자료와 별도로 보관하고 표시 메시와 연결.
- 초기 실행 예산 제안: depth Small 단일 모델, 동시에 1작업, 최대 원본 1024², 10개 이내 검증 입력, 2회 실패 시 재진단. 첫 장 로드 포함 120초 상한; peak RSS를 측정해 메모리 계약 확정. 속도/메모리 상한 달성은 아직 미검증.
- 평가: 기존 허가된 사진과 정확한 카메라·깊이를 가진 합성 fixture 사용. scale/shift 정렬한 상대 깊이 오차, 가림 경계, 실루엣, 얇은/반사/투명 부위 실패를 각각 보고. 총평균으로 중요 특징 실패를 숨기지 않음. 절대 mm 평가는 충분한 독립 실측 깊이 앵커·카메라 보정 없으면 blocked.
- 보존/납품: 기존 IR 국부 수정·undo/reopen, 비대상 형상/UV/재질/계층 보존; 파생 메시의 동일 조건 clay/wire/closeup과 실제 GLB/Blender 재열기. 추론 성공만으로 releaseAllowed를 올리지 않음.

한 물체의 알려진 크기만으로 모든 픽셀의 metric 깊이 또는 보이지 않는 후면·내부를 확정하지 않는다. 가중치·입력·seed를 고정해도 장치 간 비트 단위 재현성은 별도로 검사한다.

## 이번에 실제 수행한 것 / 미수행

공식 저장소의 고정 커밋 파일, 모델 카드·revision·파일 크기 메타데이터를 읽고 해시를 보존했다. Morphloom 관련 6개 파일을 게시본과 바이트 대조했다. 로컬 PyTorch 장치 접근만 조회했다. CUDA 없음, MPS 가용; 모델 MPS 지원이나 실제 성능 증거는 아니다.

UNI_AI `gpt-6-sol`에 필요한 공개 코드 관찰만 1회 검토 요청했다(총 1,434 tokens). API 응답은 설계 제안이며 전문가 평가/실행 증거가 아니다. 응답 후 확인한 Era3D 카드의 Apache 표기와 GitHub AGPL 충돌은 위 표에 정정했다.

가중치 다운로드, 패키지 설치, 모델 추론, 성능·품질 A/B, 모델 기반 GLB/Blender 재열기는 모두 **not-run**. 모델 설치/연동 코드 변경도 없다. 이번 문서에는 앞선 DomainPack 테스트를 모델 검증으로 재사용하지 않는다. 원본 참조 사진을 외부로 보내지 않았다. 문서만의 작은 push는 하지 않았다.

감사 산출물: `outputs/distill-depth-review-20261002/`의 upstream.json, model-metadata.json, remote-metadata.json, morphloom-inputs.json, device-probe.json, uni-ai-review.json, verification.json. 코드/메타데이터 원문은 검토용 로컬 스냅샷으로 보존했다. 전체 앱을 완벽한 자동 모델러로 판정하지 않는다.
