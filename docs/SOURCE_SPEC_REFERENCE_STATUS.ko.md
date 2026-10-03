# 변환 GLB의 sourceSpec 참고 자료 처리

Source translation adapter0.2는 원본 BIN과 IR 값을 보존하고, 이동 대상의 ancestor sourceSpec을 versioned before-edit-reference 필드로 옮긴다. 파일 내부 asset.extras.morphloomBakedTransform은 실제 입력 SHA·이름·월드 mm delta·currentEditableIRAvailable:false를 기록한다. 미지원 버전·충돌·추가 nonzero chaining은 파일 생성 전에 거부하고 no-op은 기존 proof를 보존한다. schemas/baked-transform-v1 및 source-spec-reference-v1과 실제 ancestry/sha/leaf runtime guards를 제공했다. Native IR/GLB exporter/UI와 기존 schema0.1–0.7은 변경하지 않았다. Adapter0.1 파일은 자동 현재 IR로 승격하지 않고 입력 참고 자료로 보존한다.

현재 actual Blender 8사례(이전7+sourceSpec 없는 입력),14거부,2회 재열기 전 메시 normals0°,원본 BIN·IR 값·비대상 JSON/PBR/UV/이름/계층 보존. 실제8파일 JSON Schema와 raw NORMAL/선언 world translation 비교 PASS.8GLB Khronos errors0/warnings0,infos11/10/15/1/11/11/62/11로 strict info0 delivery는 FAIL이다. Source IR 현재화·일반 native DCC export·rotated/scaled-parent·raw 첫 import 노멀 정확도·제조/전문가 검수는 미지원/blocked다.

중요 추가 결함: sourceSpec을 이동하면 기존 연결 특징 UV 검사에서 이빨 검수가 사라졌다. 평균 UV로 통과시키지 않도록 UV quality revision0.3에서 reference-only/conflicting gear는 criticalFeatures:fail,integrityPass:false,partial-blocked를 표시한다. 원본 native SourceSpec의 검사와 기존 threshold는 유지했다. 실제 original GLB는24개 이빨 PASS,참고 파일은0개 검수로 PASS하지 않고 BLOCKED다. 테스트 fixture는40개다. 참고 자료를 실제 기하에 연결해 per-tooth 검수를 복원하는 기능은 아직 미구현이며 이 파일의 gear 납품은 BLOCKED다. 해당2실패 테스트 및 actual GLB byte 감사 결과를 보존했다.

현재 npm test105파일766 PASS,원본108파일785 PASS(추가19 user tests 보존),check/build PASS,Python compile PASS. 원본 경로를 잘못 지정한 이전783 실행은 before-mirror log로 구분해 현재 증거에서 제외했다. quality:gate는4688f70 단계 fresh exit1이며 UV0.3 수정본에서는 not-run; 이전 경쟁 receipts나4browser 합격을 새 버전 전체 납품 결과로 재사용하지 않는다. production blocked/not-run. 추가 의존성/외부 모델 호출0(UNI_AI/Claude quota 확인).

21:44 KST20분+추가20분 계약,검수22:24/기록·게시 정리22:44 KST로 총약60분,40분 예산을 약20분 초과했다. 동일 geometry의 새 beauty render를 품질 증거로 만들지 않았다. 위치 편집의 이전 실제4장 중립 render는 source-translation archive에 있고 이번 변경은 파일 provenance와 검수 안전성이다. 실패했던 source transform 대응 실험은 별도 prototype으로 보존했으며 기본 matrix guard는1e-7 그대로다.

사용자는 Blender background에서 기존 input/NEW-output/NEW-receipt/node/dx/dy/dz 명령을 사용한다. 출력은 baked mesh이고 참조 IR은 재생성용 현재 원본이 아니다. SourceReference GLB의 연결 특징 UV는 BLOCKED이므로 원래 editable JSON으로 검수하거나, 다음 단계의 기하 binding 구현을 기다려야 한다. UI 연결·편집 원본 자동 동기화·전 분야 완료를 선언하지 않는다. 다음 목표는 actual original/current GLB hash와 unchanged local geometry를 연결한 좁은 UV reference 검수다. 연속 goal ACTIVE.
