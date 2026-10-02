# 구성 요소 엔진 첫 슬라이스 — 2026-10-02

범용 플랫폼 전체 완료가 아니라 **기관·미세 요소의 편집과 baked 납품 경로**를 검증한 단계다.
[요구사항](ELEMENT_PLATFORM.ko.md)의 다음 단계는 그대로 남아 있다. 기존 AssemblyIR/CharacterIR은 변경하지 않았다.

## 실행과 샘플

```bash
npm run dev
# http://127.0.0.1:4173/?editor=elements
npx vite-node scripts/element-slice-evidence.ts outputs/element-slice
npm run gltf:validate -- outputs/element-slice/selected-feather.glb
/Applications/Blender.app/Contents/MacOS/Blender --background --python-exit-code 1 \
  --python scripts/blender-glb-roundtrip.py -- \
  outputs/element-slice/selected-feather.glb \
  outputs/element-slice/selected-feather-roundtrip.glb \
  outputs/element-slice/blender-feather.json
```

`examples/elements/`의 bird/fur/bearing-ball JSON은 창작한 공개 예제다. 외부 사진·텍스처·자료를 복제하지 않았다.
JSON 스키마는 `schemas/element-project.schema.json`; 실제 소유 관계와 전체 예산은 `validateProject`가 검증한다.
Domain Pack 등록과 최소 예제는 [SDK](DOMAIN_PACK_SDK.ko.md)에 있다.

## 현재 계약

- 프로젝트 → 부위 → 표면 영역 → 그룹 → 개별 요소. 부위는 독립 월드 좌표이며 중첩 기관·관절 리그는 아직 없다.
- 깃털/strand는 그룹의 고정 slot ID를 사용한다. ID·seed별 난수는 개수와 무관하다. 소유·부착·근거·잠금·표시·override를 JSON에 보존한다. 선택 ID는 optional editor state로 저장한다.
- 개별 override가 그룹 기본값보다 우선한다. 잠긴 요소가 있는 그룹 편집은 차단한다.
- 개수 감소는 해당 slot과 override를 삭제한다. 증가 시 이전 override를 부활시키지 않는다. 추가/삭제/재매핑 영수증을 반환하며 undo가 이전 상태를 복구한다.
- 분리하면 같은 ID의 독립 명시 요소로 바꾸고 월드 부착과 유효 파라미터를 고정한다. 복원하면 기존 부착 위치로 돌아가고 분리 중 수정한 형태·재질·표시 상태를 유지한다. **분리 중의 월드 위치/회전 변경은 복원 시 버린다.**
- 부위 추출은 원래 변환을 저장한 이동과 독립 메시 내보내기를 제공한다. 계층 조립 구속 해제·재조립 기능을 의미하지 않는다.
- 몸깃·날개깃·꼬리깃은 서로 다른 길이·폭·곡률·방향 규칙을 쓴다. 현재 root는 이상적 ellipsoid 표면 표본이며 실제 삼각형 표면에 정확히 투영한 groom이 아니다.
- 화면은 공유 기하와 인스턴스를 사용하고 instance index를 원본 ID로 매핑한다. 개별 형태·재질이 달라지면 별도 batch를 만들며 128 batch 한도를 넘으면 거부한다.
- Low/Detail은 같은 ID와 원본을 유지하는 **B 단계 loft의 해상도 변경**이다. A 합성 표면/card, C 별도 깃대/깃판/주요 깃가지, D 깃소지 지원을 뜻하지 않는다.
- GLB는 선택 요소를 별도 이름의 baked 메시로 만든다. 선택한 숨김 요소도 명시적으로 내보낼 수 있다. explode 표시 위치는 납품 좌표에 적용하지 않는다. 좌표는 원본 mm/Y-up → glTF m/Y-up이다.
- GLB의 이름·재질·위치·extras는 보존되지만 native curve/groom/절차 수정은 보존하지 않는다. 원본 JSON과 선택 manifest를 함께 사용해 엔진에서 복원한다. 예제는 텍스처가 없다.
- 최대 5,000 reserved/generated+explicit 요소, 256 부위/그룹, 512 영역, 2MB JSON, 30 history 상태, 200만 표시 삼각형, 128 선택 내보내기 객체를 차단 한도로 둔다. 아래의 시험 범위와 구분한다.

## 지원과 증거

| 작업 × 표현 × 대상 | 상태 | 근거 |
|---|---|---|
| 새 기관·깃털 B의 단일 선택/편집/분리/복원 | editing-verified | core/renderer 테스트, 실제 브라우저 시연 |
| 털 tube 한 가닥의 선택/수정/분리/복원 | editing-verified | core 테스트와 브라우저 시연 |
| 그룹 기본값 변경과 개별 override 보존 | editing-verified | core 테스트, 브라우저 길이 override 시연 |
| 저장·재열기·undo/redo·Low/Detail ID 유지 | editing-verified | 테스트·evidence 스크립트·JSON 재업로드 |
| 선택 깃털/털/눈과 새 전체 baked GLB → Blender | delivery-verified (이 예제/형식만) | Khronos 검사 + Blender 가져오기/재출력/재열기 |
| 구형 부품 Domain Pack 등록·편집·추출 → Blender | delivery-verified (구 시각화만) | Pack 테스트·브라우저·GLB/Blender 영수증 |
| Domain Pack 버전/단위/좌표/capability 거부 | experimental, conformance-tested | `element-domain-packs.test.ts` |
| guide grooming·brush/mask/clump/curl·피부 관통 보호 | planned | 미구현 |
| 깃가지·깃소지·날개 운동·겹침/간섭 검사 | planned | 미구현 |
| gear/베어링 조립체·feature ID·기구학/정밀 설계 | planned | 구형 예제의 성공을 재사용하지 않음 |
| 서로 다른 Pack의 capability/자산 결합과 실패 sandbox | planned | 현재 trusted 동기 Pack의 예외만 처리 |
| NURBS/BREP/volume/terrain/time, USD/STEP/IFC 등 | planned | 현재 native 요소 IR + baked GLB만 검증 |

측정과 재열기 영수증: [`benchmarks/element-slice-evidence/`](../benchmarks/element-slice-evidence/).
브라우저 시연은 실측 해부학·전문 제조 승인·groom 시뮬레이션의 증거가 아니다.

## 측정 환경과 결과

Node 24.13.1 / macOS Darwin 25.4.0 / arm64 / Apple M5(10 logical CPU), Blender 5.2.1 LTS.
한 번의 측정이며 보편적 속도 보장이 아니다. 정확한 최신 숫자는 `evidence.json`을 따른다.

- 새: 13 기관 + 86 미세 요소. Detail 50,720 triangles, Low 13,568 triangles.
- 저해상도 5,000요소 단일 그룹: 563,936 triangles, 14 estimated draw calls. 5,001요소는 거부; 5,000요소 Detail은 200만 삼각형 한도로 거부.
- 최초 시험에서 새 생성 1.4–1.6ms, 5,000요소 생성 약 15ms. 이후 재실행 측정은 영수증에 갱신한다.
- 선택 raycast 30회 p50 약 0.017ms, p95 약 0.069ms는 **격리된 한 요소의 엔진 호출**이다. 화면 event→paint 시간이나 전체 5,000요소 선택 성능이 아니다.
- geometry-buffer bytes는 기하/instance buffer 크기다. heap delta는 GC 영향을 받는 JS heap 표본이며 GPU/전체 메모리가 아니다. 화면 draw call은 실제 renderer.info 값도 표시한다.
- 초기 납품 파일: 전체 새 약 1.09MB, 깃털 약 17.6KB, strand 약 12.7KB. SHA-256과 재실행 크기를 영수증으로 연결한다.
- 메시별 경계·비매니폴드·퇴화·자기 교차 게이트 통과. **서로 다른 메시/깃털 간 충돌은 미검증**이다.

## 검증과 재개점

이번 추가 core/renderer/Domain Pack 테스트 26건 통과. 전체 회귀 테스트·빌드·기존 benchmark도 실행했다.
최종 전체 74개 파일·554개 테스트 통과. 명령·파일 지문은 `verification.json`에 기록한다.

UNI_AI `gpt-6-sol`이 초안·리뷰를 작성하고 supervisor가 오류 수정과 실제 검증을 수행했다.
불완전한 최초 초안은 거부했다. 사용량과 리뷰 처리는 `uniai-usage.json`, `uniai-review.json`에 있다.
기존 회로·로봇 변경은 보존했고 커밋·push는 실행하지 않았다.

다음 한 단계: **명시적인 깃대/좌우 깃판/주요 깃가지와 선택적 C 단계 생성**을 추가하고,
형상·ID·LOD·선택 납품 게이트로 검증한다. 그 뒤 guide/분포 흐름·간섭을 구현한다.


2026-10-02 추가: 선언 기하·베어링 조립체의 현재 구현과 새 검수 영수증은 [베어링 슬라이스 기록](BEARING_SLICE_STATUS.ko.md)을 따른다. 이 문서의 과거 실행 숫자·API 성공 기록을 현재 수정본 증거로 재사용하지 않는다.
