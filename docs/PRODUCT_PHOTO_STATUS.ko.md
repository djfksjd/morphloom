# 실제 제품 사진 투영·부품 편집 검수

기준 커밋 bf8b594, compiler 0.32.0. 실제 ABO B07XMV34PX 선풍기의 원본 5개 사진을 기존 corpus SHA와 대조했다. 기존 101부품 IR은 과거 GLB에서 복구했으며, 그 과거 파일의 검수 결과를 현재 증거로 재사용하지 않았다. 원본 사진은 로컬에서만 처리했고 UNI_AI에는 관련 공개 코드만 전달했다.

| 기능 | 구현 위치 | 확인 | 실제 제한·영향 | 우선순위 |
|---|---|---|---|---|
| IR/부품 patch/fingerprint | assembly-ir, assembly-edit | 기존 구현 재사용·브라우저 적용 | 자동 조립 제약 변경 없음 | 유지 |
| 사진의 source-facing 면 | assembly-compiler | 양/음 방향·U 반전 실제 정점/UV/GLB 검수 | 카메라·ROI는 수동 추정 | 완료 범위 |
| 사진/PBR 실제 납품 | reference projection·delivery-validation | 실제 색상 사진의 미생성 지표 undefined 기록 결함 수정 | BRDF/미세 물성 실측 아님 | 완료 범위 |
| 선택 부품 수치 편집 | AssemblyComponentEditor·ViewerApp | 위치 mm, 크기 배율, PBR scalar, 적용/취소/32 Undo·Redo, native 재열기 | 연결 부품 자동 정합, 회전, 선택 숨김/복제는 이번 변경 밖 | 다음 |
| 닫힘·UV·tangent | topology·uv-delivery·portable export | 실제 파일 5개, 명시적 부품 union 닫힘/UV integrity, portable tangent | atlas/padding/mip bleed는 not-run, native tiling 허용 | 다음 |
| Blender 납품 | 기존 roundtrip/component edit | 5파일 재열기, 허브 1mm 편집 후 2회 재열기 | 정밀 CAD/BREP·제조 승인 아님 | 완료 범위 |
| 캐릭터/Domain Pack/깊이 | 기존 엔진·기존 테스트 | 회귀 테스트 범위 | 이번 작업의 새 인체/멀티뷰/Domain Pack 기능 없음 | 별도 목표 |

`referenceProjection.orientation`은 독립 schema `morphloom.reference-projection-orientation/0.1`의 선택 항목이다. 기존 assembly0.1/job/patch0.1은 유지한다. 항목이 없으면 기존 +축·UV·metadata 동작을 그대로 쓴다. `migrateReferenceProjectionOrientation`은 명시적 deep-copy opt-in이며 자동으로 카메라를 추측하지 않는다. 다른 버전/방향/타입/알 수 없는 필드는 변형 전에 거부한다. normal/winding을 뒤집지 않는다. 반전은 사진 면에만 적용하고 숨은 면 UV는 보존한다.

사진 방향이 잘못된 기준선 → 정면의 읽을 수 있는 허브 표시, 96×100 저해상도 기준선 → 보유 2560² 원본의 240×275 크롭을 확인했다. 원본의 조명·원근·프레임 일부가 남아 있어 정사영 정확 복원/실측 재질이라고 주장하지 않는다. 사진에서 파생 normal/roughness를 새로 만들지 않았다.

원래 크기와 절반 크기 포함 5파일: 59,152 triangles, texture estimate 592,152 bytes, GLB 약3.61 MB, 현재 Apple M5/Node24/Chrome 환경 compile 약52–129ms. 계약 2초/120k triangles/16MiB texture/20MiB GLB를 유지했다. 저장 IR의 비대상 100부품과 실제 mesh position/UV/normal/material/transform fingerprint는 보존됐다. 전체 자산의 source quality는 59/100 BLOCKED: 101개 치수와 사진 평면 대응은 estimated다. `releaseAllowed`/납품 검사 임계값을 낮추지 않았다. 파일 교환 성공과 원자료 형상 합격은 별개다.

GLTFLoader가 2재질 허브를 2primitive로 나누면 원시 메시 경계 96개가 보고된다. 명시된 동일 stable component owner 아래만 모아 기존 topology 검사(동일 tolerance)를 수행하면 101/101 닫힘, 경계·non-manifold·퇴화·자기 교차 0이다. 원시 결과를 숨기지 않았다. 전체 렌더는 기존 framing 검사를 유지하고, 고정 확대 렌더는 `inspectionComponent`를 명시해 해당 실제 부품만 isolate한다. 존재하지 않는 ID는 실패한다. 최초 확대 전체 프레이밍 실패와 검사 harness 런타임 클래스 혼용 실패는 로컬 로그에 남았다.

현재 실행: source `npm test` 94files/662tests 중 revision 기대값 1실패를 기록하고 0.32.0 기대값 수정 후 해당9tests PASS; 기대값 수정 후 최종 source94files/662tests와 게시91files/643tests가 모두 PASS했다. compiler0.32.0 실제7자산 브라우저 증거도 새로 수집했고 console errors/warnings0이다. check/build/benchmark는 PASS했고 현재 quality:gate/quality:production은 냉각 조립체의 보존된 편집용 UV에 대한 UNUSED_OBJECT info23과 통합 gate의 infos0 요구 때문에 FAIL했다. 검사와 UV를 유지했고, 이전 bf8b594의 fresh fixture에서도 같은 info23이 재현됐다. 기존 5예제 전체GLB SHA가 이전/현재에서 전부 동일해 새 geometry 회귀가 아님을 확인했다. production:dominance도 별도로 현재 실행했으며 독립 비교 없는 7분야 cases0으로 FAIL했다. 분야 전체/전문가 수준/임상·구조·제조 승인을 주장하지 않는다. 선풍기 photo GLB의 Blender 외 앱 검수는 not-run이다. 엔진 revision 변경으로 기존 영수증이 무효화되어 기존 5분야 예제를 새로 생성하고 Blender 재열기/국부 편집, Godot 실제 가져오기, PrusaSlicer의 asphalt STL, Blender OBJ/STL/PLY와 usdchecker USDZ 검사를 다시 실행해 통과했다. Unity는 현재 버전 not-run이다. UNI_AI gpt-6-sol 공개 코드 검토 2회 총4,524tokens, 실행 증거가 아닌 제안이다.

사용: `npm run dev` → JSON 파일 선택 → 실측 도구 끄기 → 허브 클릭(Stable ID front-hub-cap) → 위치 mm/배율/PBR 또는 투영 −축/U 반전 입력 → Apply. Cancel은 초안 취소, Undo/Redo는 최대32수정이다. SAVE IR은 수정한 원본을 저장하며 파일 선택으로 다시 연다. 브라우저 메모리 세션은 새로고침/30분 만료 시 삭제되고 Undo 이력은 새 IR 로드 시 초기화한다. 일반 GLB 버튼은 기존 실제 납품 검사를 통과한 파일만 저장한다. JSON은 parametric 편집 원본, GLB는 대상 앱에서 편집 가능한 메시/PBR이다.

증거: `outputs/product-photo-20261003/verification.json`; 공개 `benchmarks/modeling-slices-20261003/product-photo/verification.json`, `assets.zip`, 동일1024² 렌더 및 SHA256SUMS. 최초 실패·저해상도 기준선은 로컬 `low-resolution-baseline/`에 남는다. source iCloud git index는 map timeout 상태여서 재작성하지 않고 격리 clone의 명시된 파일만 게시한다. Raptor 및 사용자 sim 변경은 제외한다.

다음 우선순위: 보유 다각도 사진에 대한 cage/blade/stand의 부품별 실루엣·치수 계약과 형상 오차 감소. 이 부분은 이번 사진 면/편집/교환 목표의 성공으로 대체할 수 없다.
