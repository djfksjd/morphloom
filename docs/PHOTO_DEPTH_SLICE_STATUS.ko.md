# 사진 출처와 로컬 깊이 실험 — 2026-10-03

현재는 관측/합성 출처 보호 경로와 선택적 raw-depth 실험이다. 실제 제품 사진의 편집 가능한 형상 개선이나 모델 기반 Blender 납품 완료가 아니다.

구현: optional reference-provenance0.1, evidence manifest0.2, 기존0.1/pack0.2 호환. 새 사진은 unknown, 사용자 확인 observed, synthetic 분류. synthetic/unknown은 capability/권장 시점/치수/카메라/서비스 부품 근거에서 제외하며 CAD/datasheet 역할을 붙여도 승격되지 않는다. 합성 원본ID·모델revision·seed 기록, missing/cycle/invalid metadata 거부. source IDs는 저장 시 stable view IDs로 변환하고 재열기 시 runtime IDs로 복원한다. 모델/원본/seed 미입력은 미확정이며 실제 생성 실행 영수증이 아니다.

`PHOTO EVIDENCE` 링크와 `/?editor=evidence`에서 기존 사진 입력 패널을 재사용한다. 기본 검수 뷰어는 유지하며 이 좁은 화면에 형상 생성/GLB 납품을 노출하지 않는다. 새 사진 SHA-256을 로컬에서 계산하여 재열기 내용 불일치를 거부한다. 저장→같은 사진 재추가→LOAD EVIDENCE JSON 순서다. 복원은 atomic이며 source pixel/analysis와 다른 assetKind는 보존한다. 기존 출처 없는0.1 자료는 호환 계산을 유지하되 미분류 경고를 표시하며 자동으로 observed를 붙이지 않는다. observed는 사용자의 확인이고 실측 인증이 아니다.

스키마: `schemas/evidence-pack.schema.json`의 nested0.1/0.2, provenance def. 기존 IR/job/patch/releaseAllowed와 모든 임계값 유지. `migrateReferenceManifestProvenance`는 deep-copy additive migration이다. unknown version/kind, 잘못된 seed/길이/중복·누락·순환 부모, 이미지 일치 실패는 명시적 실패다. Legacy fingerprint 없는 저장본은 filename/size/dimension 기반 호환이며 암호학적 식별로 주장하지 않는다.

깊이: `scripts/local-depth-small.py`는 별도 로컬 CPU 실험 CLI다. 공식 checkout6d8f415·Small safetensors SHA56a173c0와 revision38095a41을 검증하고 raw Float32 NPY, alpha-validity mask, 전처리/mapping/device/입출력SHA/workerSHA/시간/RSS 영수증을 쓴다. 자체 다운로드·원자료 외부 전송·IR 수정 없음. 16MiB/1024²/700²/4threads/120s deadline·기존 출력 overwrite 거부, offline env, safetensors strict load. Unix deadline 사용으로 Windows blocked. ndarray는 상대 inverse-depth proxy이고 mm가 아니다. alpha는 confidence가 아니다. 동일 CPU repeat raw bytes 일치, 장치 간/모든 모델은 미검증.

추가 의존성: npm/lockfile 불변. 기존 PyTorch2.8과 Python deps를 사용하고 torchvision0.23(BSD3, wheel약1.9MB)만 disposable `/tmp/morphloom-depth-experiment-venv`에 --no-deps 설치했다. upstream Small/model card Apache2 선언, DINOv2 Apache2 주석 확인. 기본 앱 의존성이 아니며 전체 공급망·모델 배포 승인 판정은 하지 않았다. 원본 .env/key는 출력하지 않았다. UNI_AI models1회403, completion not-run, 로컬 fallback이다.

실제 검수: 구형2크기×matte/checker4개, 동일 정사영 camera·known analytic z·고정indexmod97 anchors/heldout. 각 사례 normalized MAE .036~.051, luma 진단 .190~.199 대비73~82% 감소; 사전 .10 MAE 및10% 개선 계약 통과. 이는 기존 primary IR generator와 비교한 성능 수치가 아니다. 별도 토러스 관통 holdout MAE .150>.100 실패; luma 대비10.5% 개선만으로 통과시키지 않았다. 전체 자동 형상 채택은 **보류**. 구형 평균으로 실패를 숨기지 않았다. 내장미세표면 높이장도 깊이 모델로 대체하지 않는다.

이미지: outputs/depth-small-20261003/comparison.png(동일 카메라 입력/knowntruth/luma진단/depth 표시), outputs/reference-provenance-20261003/browser/*.png. 증거: 두 outputs의 verification.json, 현재 study/evaluation-current.json, worker manifests, 현재 source/입출력SHA. 가중치99,165,428bytes는 로컬 실험용이며 Git에 넣지 않는다. RSS/시간은 현재 Mac CPU5합성입력에 한정, FPS/모든 기기 보장 없음.

미완료: 실제 제품 사진 ground-truth, non-square aspect-preserving 전처리 비교, raw artifact의 엔진/UI import, IR fitting·geometry/clay/wire/export·Blender, normal/tangent·불투명/반사/투명 물체, hidden surfaces와 metric scale. independent production 비교 부족/전문가 평가 없음은 유지한다. 이번 토러스 실패는 모델/기하 prior와 원자료 제약을 재진단할 다음 단계이며 threshold를 낮추지 않는다.

현재 원본범위 검증: npm run check/build, npm test90files637tests, benchmark PASS. quality:production은 독립비교 evidence0/3 때문에 FAIL이며 기준을 유지한다. 게시 체크아웃에서 현재 변경만 재검증한다.

게시 범위 재검증:87files618tests/check/build/benchmark PASS. quality:production exit1(quality gate 통과, independent comparison evidence0/3 FAIL). 공개 증거: benchmarks/modeling-slices-20261003/photo-depth, 실패 토러스 torus-failure.png와 현재 publish-checks/results.json 포함.
