# 실제 제품 사진·부품 편집·납품 경로 — 사전 계약

기준 bf8b594. 첫 대표 사례는 기존 ABO B07XMV34PX 산업용 선풍기 101부품 AssemblyIR이다. 기존 기록 GLB의 extras에서 IR을 회수하되 과거 출력은 현재 검수 증거로 쓰지 않는다. 원본 사진5개는 기존 corpus의 SHA-256과 일치해야 한다. CC-BY4 출처/변경을 기록한다. source 치수/카메라/광학은 추정이며 제조 승인·실측 복원으로 주장하지 않는다.

사진의 전면 hub 표시를 지정된 source-facing 면에만 적용한다. 기존 +축 암묵 투영은 원본호환으로 유지하고 새 방향/UV 반전은 versioned opt-in 선언과 unknown/invalid 거부를 제공한다. hidden side에는 source marking을 복제하지 않는다. 사진 crop을 맞추는 것은 작성된 대응 설정이며 정확한 카메라 복원 인증이 아니다. 원본 파일 외부 모델 전송 없음.

기존 AssemblyIR/component-patch의 원본 보존과 fingerprint/stale검사를 재사용한다. UI는 selected stable ID의 roughness/metalness/축별 scale/translation을 제한된 수치 입력으로 stage→cancel/apply, undo/redo, native 저장/재열기를 제공한다. target projection/추정재질 상세·다른 부품/source metadata를 보존한다. 사용자 조정 외 자동 치수 변경 없음. 기존 납품 검증 임계값/releaseAllowed 의미 유지, 실패는 명시적 diagnostic 경로로 검수하고 release로 승격하지 않는다.

먼저30분 checkpoint, 같은결함2회 재진단. 현Mac compile≤2초/일반작업≤120k triangles/texture≤16MiB/GLB≤20MiB, history≤32개 및 native≤2MB를 사전에 고정한다. 기존 일반UV/geometry/texture/fingerprint/release검사와 별도 실제 export bytes를 검수한다. 두크기(원본/0.5배)의 forward/negative-facing·UV 반전 거부/상태 보존 사례, same-view 1024² front/iso clay/표면 closeup 및 wire를 사용한다. 원본source images/IR/native/GLB와 코드 해시를 기록한다. UIapply/cancel/undo/redo/save/reopen/export, Blender 실제GLB 재열기/selected부품 편집과복원을 확인한다. 원본/비대상 geometry UV PBR hierarchy 동일을 actualarrays/images로 비교한다.

UNI_AI 공식 gpt-6-sol 공개관련코드검토≤2회, 55초timeout 자동retry없음. check/test/build/benchmark/quality:production 현재코드실행. production독립비교 부족/전문가/제조/실측물성 not-run은 유지한다. 원본Gitindex128은임의교체하지않고 user sim변경보존, 별도clone allowlist meaningfulbatch만push/원격검증한다.
