# 베어링 시각화·편집·납품 검수 기록

2026-10-02, 기준 커밋 `a200aa4593aa14a9f0348b014962d144d119c741`. 현재 미커밋 수정본의 소스 SHA-256은 `outputs/bearing-slice-20261002/current/evidence.json`에 있다. 기존 사용자 변경과 요소 플랫폼을 확장했으며 커밋·push·배포하지 않았다.

## 실제 변경

| 기능 | 구현 위치 | 확인 상태 | 제한·사용자 영향 | 다음 우선순위 |
|---|---|---|---|---|
| 선언형 sphere/lathe/extrude 부품 | `part-geometry.ts`, `assembly-compiler.ts` | 생성 정점·UV·법선·topology 확인 | bounded 연산만 허용, CAD 솔리드 아님 | 연산별 특징 ID |
| 내외륜·볼·관통 케이지 생성 | `bearing-pack.ts` | 3개 크기와 실제 bore/pocket raycast 통과 | 원자료 없는 창작, 제조 clearance 미검증 | 자료 기반 구조 검수 |
| identity 조립 계층·home 복원 | `element-project.ts`, `element-renderer.ts` | 비대상 10개 mesh fingerprint 보존 | 중첩 변환·구속 solver 없음 | 복합 프로젝트 계약 |
| 반경·프로파일·PBR draft 편집 | `PartInspector.tsx`, `ElementEditor.tsx` | Apply/Cancel/Undo/Redo/저장·재열기 실제 UI 통과 | 생성 Pack 재실행은 새 프로젝트 | Pack 추가 시 기존 편집 보존 |
| 선택/전체 GLB | `element-renderer.ts`, `ElementEditor.tsx` | 실제 다운로드·Khronos·Blender 통과 | 절차 의미는 companion JSON 필요 | 다른 표현의 정보 손실 계약 |
| 새 스키마·마이그레이션 | `element-project-v2.schema.json`, `migrateElementProject` | 0.1 유지·0.2 명시적 migration·잘못된 입력 거부 | 런타임이 닫힌 profile·단위 axis 등을 추가 검사 | SDK conformance 확장 |

0.2는 선언 기하의 scale을 무차원 배율로 사용한다. 기존 ellipsoid/beak의 scale은 mm 치수이며 0.1 직렬화는 유지한다. 0.2는 객체 키를 정렬해 복원 전후의 동등한 상태가 같은 직렬화가 되도록 한다. 기존 AssemblyIR·job·component patch의 버전과 releaseAllowed 의미를 바꾸지 않았다. 추가 의존성과 텍스처는 없다.

## 합격 범위와 측정

[사전 품질 계약](BEARING_QUALITY_CONTRACT.ko.md)을 적용했다. 기본 20/40/12mm, 볼 직경 6mm×8의 11부품 조립체는 43,808삼각형·기하 버퍼 2,476,800bytes다. Node 24.13.1/macOS arm64/Apple M5에서 한 번 측정한 Detail 생성 시간은 약 102ms다. 두 다른 크기는 40,572/56,752삼각형이며 각각 topology와 100,000삼각형 계약을 통과했다. fps·제조 정확도 보장은 아니다.

볼 하나의 반경을 3→2.8mm, PBR을 변경한 뒤 분리·JSON 재열기·복원을 확인했다. geometry/normal/UV/index/PBR/world transform/부모를 해시해 비대상 10부품의 보존을 검사했다. 브라우저에서는 Cancel(3), Undo(3), Redo(2.8), 분리 위치 X45mm, 복원 위치 X15mm와 assembly 소속, 저장·업로드, isolate, 선택/전체 파일 다운로드를 확인했다. 실제 흐름 기록은 `browser-verification.json`이다.

Blender 5.2.1 LTS에서 전체 파일을 열고 `ball_0000`을 X2mm 이동해 export·두 차례 재열기했다. 나머지 10부품 중심 이동 0mm, 최대 크기 오차 약 0.00000745mm, UV·PBR·이름·계층 보존 검사를 통과했다. 브라우저에서 내려받은 선택 볼도 실제 재열기했다. Blender의 seam 재인덱싱과 exporter bytes 변화는 보고서에 남기며 byte-identical 왕복을 주장하지 않는다. 텍스처가 없는 사례이므로 텍스처 납품 검증은 not-run이다.

## 실행 결과

| 명령·검사 | 결과 | 현재 증거 |
|---|---|---|
| `npm run check` | PASS | `check.log` |
| `npm test` | PASS, 75파일·564테스트 | `tests-final.log` |
| `npm run build` | PASS | `build-final.log` |
| `npm run benchmark` | PASS | `benchmark.log` |
| `npm run quality:production` | FAIL(exit 1); 내부 quality:gate는 PASS | `production.log`, 독립 비교 사례 0/3 |
| `npx vite-node scripts/bearing-slice-evidence.ts …` | PASS, 동일 입력 replay byte 일치 | `current/evidence.json`, `replay/` |
| `npm run gltf:validate -- …` | PASS, 7파일 오류·경고 0 | `gltf-validation.log` |
| Blender component-edit/roundtrip | PASS | `current/blender-edit.json`, `browser-blender.json` |
| UNI_AI `/models/` | blocked HTTP403, completion not-run | `uniai.json` |

품질 임계값을 내리거나 검사를 끄지 않았다. 렌더 검수에서 법선 Vector3 참조 재사용에 따른 셰이딩 오류를 발견했다. 실패하는 face-normal 방향 테스트를 추가하고 각 법선을 clone해 수정했다. 실패 렌더와 red/green 로그를 보존하고 최종 GLB·렌더·전체 회귀를 새로 생성했다. 자동 검수는 독립 인간 전문가 평가가 아니다.

## 이미지와 파일

모든 경로의 기준은 `outputs/bearing-slice-20261002/`다. `before-clay.png`와 `after-clay.png`는 같은 1024×1024 camera/light/clay 조건의 **볼 국부 편집 전후**다. 기존 저장소에 없었던 조립체를 옛 구현이라고 표시하지 않는다. `axis.png`는 축 방향 PBR, `wire.png`는 wireframe, `race-closeup.png`는 사광의 실제 raceway/chamfer다. 해당 JSON에 실제 조명·카메라가 있다. 원자료 없는 시점은 구조 검수다. 이전 구형 슬라이스의 material 렌더와 이번 true clay 모드를 구분한다.

| 파일 | SHA-256 |
|---|---|
| `current/bearing-after.elements.json` | `273aa9a79738d7161cf3467fdf334607aca74ad5537d5009011d398f2b4450fa` |
| `current/bearing-after.glb` | `3f4fef1092df97ab5e0ba61e27bc61282bbb332c8917a2c31209540122d9e2df` |
| `current/selected-ball.glb` | `8ca37357e98c3b9bd27921e12c0b344b624af9ab6697f1ebc2832f8845c9f36b` |

전체 출력·소스 해시는 `current/evidence.json`, 재열기 출력 해시는 각 Blender JSON을 따른다.

## 사용 방법과 재개점

`npm run dev`로 실행하고 `/?editor=elements`에서 `mechanical.bearing.visual`을 선택한다. `ball_0000`을 선택해 `Ball radius (mm)`와 PBR을 수정하고 Apply한다. Extract/Restore와 Undo/Redo, Save project JSON/Load JSON을 사용할 수 있다. Export selected 또는 Export project는 GLB와 editable source JSON을 함께 제공한다. Blender에서는 GLB를 import해 메시/재질을 편집하고 엔진의 절차 편집은 JSON으로 재개한다.

미완료: 기어 involute/feature ID, 중첩 조립 변환·운동학, 부품 간 충돌 인증, atlas/texel density/normal-map 납품, NURBS/BREP/STEP/IFC/USD, 인간 전문가 검수, 독립 comparison 기반 production 주장. 후속 빌드 preview에서 Hide/Show를 추가 관측했다. 숨김 40,832→표시 43,808삼각형이며 해당 receipt를 갱신했다.

작업 중 `.git/index`가 macOS `dataless` 상태가 되어 최종 `git status/diff`가 타임아웃됐다. 인덱스를 삭제·재작성하지 않았다. 현재 커밋 조회와 파일 기반 검사는 가능하다. competitive 영수증은 초기 HEAD로 복원했고 quality 영수증은 HEAD blob 읽기도 타임아웃돼 보존했다. git 최종 감사와 남은 생성 영수증 정리는 파일 접근 회복 후 다시 확인해야 한다.

다음 goal은 서로 다른 Domain Pack을 기존 사용자 편집·seed·안정적 ID를 보존해 한 프로젝트로 합성하는 계약이다. 단순 배열 결합은 project seed와 ID 해시를 바꿔 기존 분포를 손상시키므로 사용하지 않는다. 먼저 실패 사례를 만들고 source IR과 표시 파생 데이터의 경계를 확정한다.
