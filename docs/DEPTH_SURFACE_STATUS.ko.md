# 상대 깊이 가시 표면 검수 — 2026-10-03

실제 구현: versioned native depth source0.1 + bounded reciprocal mm anchor fitting + 독립 검증 + 마스크 구멍 보존 메시. frame/pixel-centres/+Z normal/UV, stable source pixel indices, stride1–8,100k triangle 상한. fit 범위·positive inverse·Float32 셀 붕괴 거부. 기존 IR/컴파일러/납품 gates 불변. 별도 raw field 유지, 미분류 카메라/단위/검증점 자동 추측 없음. source native JSON과 raw NPY는 별도이며 GLB는 원본 대체물이 아니다. 신규스키마는0.1만지원, unsupported version 명시실패; 이전IR/job에 migration 요구없음.

화면: PHOTO EVIDENCE→깊이 가시 표면 검수 또는 /?editor=depth.8MiB native JSON 로컬 업로드→frame/cameraZ/stride 숫자 편집→적용/취소→Undo/Redo16단계→원본 필드+편집 상태 JSON 저장→재열기. Clay/wire/checker/front/iso. 자료교체·unmount·diagnostic 해제 후 오래된 내보내기 결과 취소, GPU/controls/observer/disposal와 viewport error isolation. 검증실패는 일반 생성 차단, explicit diagnostic preview/export만지원; 모든 GLB releaseAllowed:false.

실제입력: 앞선 pinned Small CPU field5개와 같은 authored 정사영/known visible Z(mm)·fit(index%97)/독립validation(index%89).2크기×matte/checker 구형4개 anchor MAE .0375/.0461/.0432/.0573 및 개별max<.250 통과. 토러스 .178/개별 .685 실패, luma5개 모두 실패. 값은 원자료와 MM anchor가 이미 알려진 합성 사례에만 해당한다. 실제제품/숨은면/metric 자동복원 아님.

중요한 실패: 등각에서 구형 depth 경계 돌출. 실제 GLB 전체정점 MAE는1.88–3.11mm로 luma8.71–13.03mm보다감소했지만 최대32.54–50.08mm 오류. 검증점 평균만으로 전체모델 합격시키지 않는다. 경계/전체형상은 FAIL, 자동 채택/일반납품 없음. 토러스 hole은 mask geometry에서 보존되지만 깊이형상 실패. 사진표면/primary IR 대체안함. 다음은 독립 경계 ROI 검증·명시된 깊이 envelope·기존 IR 제약 결합이며 clamp/smooth로 실패를 숨기지 않는다.

검수: 실제10GLB UV integrity/Khronos PASS, 기존 topology의degenerate/non-manifold/self-intersection0 및complete; open boundary는 의도적이며 기존watertight pass와구분. Node/browser2파일 전체바이트동일.12파일 Blender5.2.1 재열기·reexport/reopen PASS. 추가1mm 정점편집→실제파일재열기→복원, UV/명명/계층/재질/source extras보존 PASS. Native edit/save/reopen/undo/redo source samples/mask/anchors보존 브라우저 PASS. source91files642tests/check/build PASS(현재 게시 체크아웃 별도검증).

중립전후: outputs/depth-surface-20261003/comparison-mesh.png 및 fixed-renders. 동일한 fixed-metre-datum(scale10,translation0)·카메라/조명/1024²·clay 비교이며 데이터별 auto-centering하지않는다. 기존 renderer의 opt-in fixed-space 인자만확장, 이전3–5args 불변. 스파이크/실패를 포함한 진단이며 전문가검증/실무납품 합격이미지 아님.

UNI_AI: 명시적 공식 client headers 모델조회200, gpt-6-sol 검토200(4214tokens) 및 responses smoke200(15tokens). 검토제안2개를실패테스트로재현후최소수정, native保存은별도JSON으로구현됨. 원본사진/key전송없음. API제안은실행증거아님. 현재호스트대화전환/호스트과금0 주장없음.

산출물: outputs/depth-surface-20261003/{fixtures/*.depth.json,*.diagnostic.glb,evidence.json,actual-vertex-errors.json,browser,blender,blender-edit,fixed-renders,verification.json}. hash 영수증 연결. 무관한원본변경/원본Gitindex 보존. production independent evidence부족/전문가·제조·표현별adapter·실제제품·normal-map납품 미검증 유지.

현재게시범위:88files623tests/check/build/benchmark PASS;quality:production exit1(기존gates통과/독립비교 evidence0/3부족). 공개경로 benchmarks/modeling-slices-20261003/depth-surface. 현재 source/output hashes와실제파일포함, 요약UV영수증은fullpertriangle arrays생략을명시하고완전로컬원본보존.
