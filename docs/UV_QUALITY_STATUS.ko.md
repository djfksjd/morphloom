# UV 품질 검사 연결

2026-10-02. 현재 원본과 실패를 보존하면서 실제 static mesh의 UV 품질 검사를 연결했다. 기존 UV gate의0.95 coverage/finite1/퇴화0.05 기준과 area1e-10 기준은 유지했다. releaseAllowed를 변경하지 않았다. 기존 domain-readiness는 새 공통 inspectUvAttribute/signedUvDoubleArea를 재사용한다.5개 실제 GLB에서 기존 aggregate 수치가 기준선과 동일하다.

## 구현

src/engine/uv-quality.ts는 actual world area(m²), signed UV area, 유한성/퇴화, Jacobian anisotropy와 UV units/m, 실제 positive-area triangle overlap을 계산한다. shared edge는 overlap으로 세지 않는다. float32 상관 signature가 native mapping 선언과 맞는지 확인하지만 인증/texture 승인으로 쓰지 않는다. native source contour가 있는 기어는 triangle centroid의 tooth별 기준도 검사해 전체 평균에 숨은 실패를 드러낸다. 이것은 완전한 face-feature 영역 분할이 아니다.

공통 ElementEditor의 UV quality 패널은 current source/geometry SHA256과 부품별 결과를 표시한다. native IDs는 GLB extras의 asset/source ID로 유지하고 로더의 sanitized nodeName은 별도 기록한다. unknown source contour의 feature 검사는 not-run이다. 최근 검사만 게시하는 LatestUvInspection과 project identity guard로 취소/역순 완료/새 상태에 이전 보고서를 표시하는 경우를 막는다.

src/engine/uv-delivery.ts는 실제 생성 GLB bytes를 GLTFLoader로 재열고 source/output SHA256 및 상세 triangle 보고서를 생성하며 loader resource를 dispose한다. ElementEditor의 전체/선택/diagnostic export와 WorkspaceEditor의 combined export에 연결했다. 실패 보고서가 있는 preview export는 production 승인과 구분한다. 원본 IR/schema는0.1/0.2/0.3, workspace0.1 그대로이며 보고서만 morphloom.uv-inspection-receipt/0.1 및 uv-quality/0.1로 새로 제공한다. 원본 migration은 필요하지 않는다. 기존 renderer는0.5로 provenance extras를 추가했다.

## 결과

대표 gear17.7719%, small32.0137% 퇴화로 FAIL을 그대로 표시한다. large4.8077%, bearing0%, bevel extrude0%는 UV integrity 항목 PASS다. atlas/texture 품질 전체의 합격을 뜻하지 않는다. 중요한 tooth만 실제 UV를 손상시키면 aggregate0.05 이하에서도 tooth 검수는 실패하는 테스트를 통과했다. world scale 변경 후 실제 면적/지문 갱신과 Undo 원복을 브라우저에서 확인했다.

5개 실제 browser GLB의 POSITION/NORMAL/UV/index/PBR/계층은 Node와 같았다. 실제 파일별 보고서가 같이 다운로드된 source JSON/GLB hash를 인용한다. diagnostic tooth와 mixed12메시·scoped24tooth 보고서도 실제 브라우저에서 확인했다.5사례+tooth+workspace의 glTF/Blender 재열기를 확인했다.

Mixed 회전 datum의 Node/browser matrix에는 최대 약3.5e-17 차이가 있어 strict 전체 metadata comparator는 FAIL이다. UV/정점/normal 및 source/name/hierarchy 데이터는 보존됐지만 전체 파일 byte 동일성을 주장하지 않는다. 실패를 보존하고 검증된 부분과 분리했다. Source/output SHA는 각 실제 파일을 참조한다.

check/build/benchmark 및 회귀 테스트 PASS. quality:production은 기존 독립 비교 자료 부족으로 FAIL이며 threshold를 낮추지 않았다. UNI_AI403 이후 completion not-run, 독립 전문가 평가 not-run, git status/diff는 dataless index로 blocked다. 커밋·push·배포하지 않았다.

## 사용·지원 범위

UV quality를 펼쳐 source asset의 부품/연결 tooth 결과를 확인하고 Save current UV summary로 저장한다. GLB export는 원본 JSON과 UV quality JSON을 함께 저장한다. workspace export는 전체 asset datum이 적용된 실제 파일의 보고서를 제공한다. 본 패널은 현재 source asset 범위이며 viewport isolate/explode나 LOD preview를 납품 검증으로 사용하지 않는다.

static100000tri/mesh·300000tri/scene, attribute300000vertices/size<=4, overlap20000후보/mesh(최대200000), fingerprint80MB, 상세 JSON20MB 예산을 명시한다. 예산 초과 pair는 incomplete/unknown이며0으로 완료 처리하지 않는다. 관측 positive pairs는 전체 합계의 하한이다. instanced/skinned pose는 blocked. texture resolution/UV transform 계약이 없어 texels/mm는 not-run이다. native planar/periodic mapping의 overlap 의도는 선언일 뿐이며 atlas/패딩/mip bleeding/공유 texture의 cross-mesh overlap은 not-run이다. 현재 보고서를 모델 형상/UV 개선이나 제조·전 분야 실무 완료로 표시하지 않는다.

증거는 outputs/uv-quality-20261002/verification.json, 현재 Node 데이터 scope-final, 실제 browser 파일 browser, Blender 결과 blender다. baseline.json/red.log/scoped-id-red.log에 기존 실패를 보존했다. UI 이미지는 ui-gear-failure.png와 ui-large.png다. 추가 원본은 final/workspace.json이다.

변경: uv-quality.ts, uv-delivery.ts, domain-readiness.ts, element-renderer.ts, gear-picking.ts(inspection용 cached contour 판정), ElementEditor.tsx, WorkspaceEditor.tsx, tests/uv-quality.test.ts, scripts/uv-quality-evidence.ts. SDK 계약은 DOMAIN_PACK_SDK.ko.md를 따른다. 다음 우선순위는 실패한 작은 기어의 명시적 UV 편집과 텍스처 용도 계약이다.
