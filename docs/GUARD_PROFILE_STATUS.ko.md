# 앞 케이지 곡면과 wire 국부 편집

기준 c9fcc5b, compiler 0.33.0. ABO B07XMV34PX의 원본 main/네 spin 사진을 로컬에서 확인했다. 기존 앞 케이지는 평평한 torus 링과 직선 tube spoke였다. 앞 guard의 볼록한 형태는 사진에서 관측됐지만, 카메라와 치수가 미보정이므로 이번 30mm rise는 작성 추정이며 실측 복원이나 전체 형상 합격이 아니다. [사전 계약](GUARD_PROFILE_CONTRACT.ko.md)의 임계값은 유지했다.

| 실제 변경 | 위치 | 확인과 제한 |
|---|---|---|
| 두 끝점 + 2차 Bezier control point(mm) | engine/tube-quadratic-curve, assembly-ir/compiler, schema | 실제 정점 곡면, 끝점/곡률/범위/버전 검사. 다중 점·폐곡선의 새 Bezier 모드는 지원하지 않음 |
| 선언형 곡선 set/clear | assembly-edit | component/batch-patch0.2, fingerprint·원자성·비대상 보존. 기존0.1 유지 |
| 선택 wire 수치 편집 | AssemblyComponentEditor | local control mm, 적용/취소/undo/redo/native 저장·재열기. 연결 링 자동 수정 없음 |
| 대표 앞 guard profile | scripts/guard-profile-pilot | 앞 링18+spoke12+cap1 변경, 나머지70부품 보존. ID별 compiler 예외 없음 |
| 실제 GLB·중립 렌더·Blender | guard-profile-browser/file-audit/dcc scripts | 원래/절반 크기·다른 회전 cable 포함. 사진 카메라 일치·원자료 실루엣 오차는 not-run |

기존 assembly/job0.1은 그대로다. tube에 선택적 `curve: {schema:'morphloom.tube-quadratic-bezier/0.1', controlPointMm:[x,y,z]}`를 명시한다. `migrateTubeQuadraticCurve`는 deep-copy opt-in이며 인자 없이 호출하면 이 선언만 제거한다. unset이면 기존 CatmullRom 경로의 position/normal/UV/index/groups가 이전 커밋의 실제101부품과 정확히 같다. 버전·필드·점 개수·finite/range·특이 접선·뒤로 접힌 control·과도한 excursion·곡률보다 굵은 wire를 거부한다. 곡선의 control은 표면이 반드시 통과하는 점이 아니다.

새 곡선 patch는 `morphloom.component-patch/0.2`와 `geometry:{operation:'tube-quadratic-control',action:'set',curve:{...}}` 또는 `action:'clear'`를 사용한다. 기존0.1에 새 연산을 넣으면 명시적으로 실패한다. batch0.2도 동일하다. 기존0.1 연산은 자동 마이그레이션하지 않는다. 새 연산은 구 엔진에서 지원하지 않으므로 구 엔진으로 무손실 다운그레이드한다고 주장하지 않는다. set/clear와 endpoint delta는 결과 경로를 검증한다. batch JSON의 schema/fingerprint 덮어쓰기와 누락 delta 문제도 재현 후 수정했다. 초안은 source IR identity와 stable component ID에 묶어 선택/파일 변경 사이의 오래된 입력을 거부한다.

새 Bezier 경로의 cap은 실제 삼각형 winding과 normal이 모두 바깥 방향이다. 검사 중 드러난 legacy tube cap winding은 기존 버퍼 보존을 위해 이번 변경에서 그대로 유지했다. 기존 topology 통과만으로 면 방향까지 합격했다고 해석하지 않는다. 이 legacy 결함은 다음 별도 회귀·마이그레이션 항목이다.

대표 profile은 기존 -4도 tilt 좌표계에서 `z=-42-30*(1-(r/216)^2)`다. ring 반지름과 outer rim은 그대로, inner spoke endpoint와 cap은 앞으로 이동한다. centerline 수학식 오차는 약5.7e-14mm이고 생성된 ring 중심도0.001mm 이내 확인했다. 이는 연산 검증이며 사진에 대한 정확도 측정이 아니다. 전체59,152 triangles는 유지됐다. 실제GLB 원래 크기 약3.61MB, 절반크기 약3.62MB, 별도회전 cable820tris/50KB. 현재 Apple M5/Node24/Chrome에서 compile 약65–81ms(별도 cable 약1ms), 계약2초/120k tris/16MiB texture/20MiB GLB 유지.

UI 실제 viewport 클릭으로 cage-front-spoke-7을 선택하고 local control Z=-70.5mm로 수정했다. Cancel/Undo는 원본 IR과 동일, Redo/재열기는 수정 IR과 동일, 비대상100부품은 보존됐다. 새 IR 로드 시 이력은 초기화된다. 현재 일반 GLB 버튼으로 내려받은 수정 파일도 별도 검사한다. JSON은 parametric 원본, GLB는 DCC에서 편집 가능한 메시다.

검증·명령·현재 입력/출력 SHA는 공개 `benchmarks/modeling-slices-20261003/guard-profile/verification.json`과 `SHA256SUMS`, 실제 IR/GLB는 `assets.zip`에 있다. 게시본92files/655tests와 사용자 폴더95files/674tests가 모두 PASS했고 check/build/benchmark, 실제5파일 Khronos,4원래/절반/다른회전 사례의 브라우저·UV·동일 owner topology, Blender5파일 재열기와 wire1mm 수정 후2회 재열기를 확인했다. 기존7브라우저와5분야 Blender 재열기/국부 편집·Godot, asphalt의 PrusaSlicer와 OBJ/STL/PLY·USDZ도 새 compiler 버전으로 재실행했다. 선풍기 자체를 Blender 외 앱에서 확인했다고 주장하지 않는다.

실패 기록은 보존한다. 최초 mm 곱셈 구현은 legacy fractional 정점 바이트가 달라 /1000 순서로 복원했다. cap winding 검사는 실제면 방향 결함을 찾았으며 새 경로에 수정했다. 최초 front-iso 렌더가 잘려 같은 전후 카메라의 orthographic height를3.2로 설정했고 framing 합격 임계값은 그대로다. HMR로 구 모듈을 참조한 diagnostic 영수증/파일 불일치가 있었으므로 새 페이지의 고정 코드에서 다시 생성해 두 번의 전체GLB SHA 일치를 확인했다. 의도된 최종 검수 실패 시 남은 다운로드 링크0을 확인했다. UNI_AI gpt-6-sol 분석/리뷰3회는 제안이며 실행·독립 전문가 검수 증거가 아니다. 원본 사진·키는 보내지 않았다.

사용: IR 파일 선택 → 실측 끄기 → 앞 wire 선택(Stable ID 확인) → Wire 곡선 control point X/Y/Z(mm) → Apply. Cancel/Undo/Redo → SAVE IR → 다시 파일 선택 → GLB. 원래 곡선이 없는2-point wire는 체크박스로 명시적 opt-in한다. 안전 범위 실패는 초안으로 남고 원본은 보존한다.

미완료: 전체 사진 형상 적합성, calibrated depth/camera, rear guard 곡면, blade/stand 정확도, legacy cap winding, UV atlas/padding/mip bleed, 제조/CAD/BREP와 독립 전문가 승인. `releaseAllowed=false`이며 현재 quality:gate/quality:production은 기존 cooling의 UV UNUSED_OBJECT info23과 infos0 계약 때문에 FAIL이다. UV나 임계값은 유지했다. 기존5예제의 새 전체GLB SHA도 이전과 모두 같다. 별도 production:dominance는 독립 비교 없는7분야 cases0으로 FAIL이다. Unity는 current not-run이다. 다음은 legacy cap 방향 결함을 기존 파일 보존·명시적 마이그레이션과 함께 해결하거나, 보유 다각도 사진에 실제 카메라/치수 근거를 연결하는 작업이다.
