# 변환 대응 후속 실험 체크포인트

기준 4688f70. 첫 candidate TRS 조립 변경은 여전히2.384185791015625e-7 실패였다. 원본 TRS로 독립 Blender RNA 참조를 만들면 실제 import와0오차로 일치했다. 이 숫자는 현재 probe/probe-rna 파일과 입력 SHA74436cc33a0d096bf23562ade2fbf4733eea2792b68c67ed73c6d28dc745669a에 연결된다. 이것만으로 전체 adapter 합격은 아니다.

두 구현 시도에서 추가한 전 장면 matrix/shear 검사에 회귀가 있었다. 첫 시도는 기존 케이지 행렬 분해를 거부했고, 두 번째는 기존 mixed workspace의 비대상 matrix를 거부했다. 후자는 앞선6사례까지 통과했지만 mixed에서 중단했다. 고정1e-7 임계값을 키우지 않았다. 2회 수정 후 두 Python 파일을 HEAD 바이트로 복원했고 실패 prototype은 outputs/source-transform-correspondence-20261003/prototype에 보존했다. 현재 게시 CLI의 검증 범위와 회전/scale-parent BLOCKED는 그대로다. 새 full conformance/생산 합격을 주장하지 않는다. Matrix-parent 사례는 not-run.

21:31 KST/30분 계약, 약21:44 KST 체크포인트. 문제는 원본 변환 계산뿐 아니라 이동 대상에 적용할 조건과 변경하지 않는 source matrix의 보존 조건을 혼동한 데도 있다. 다음 재진단에서는 before/after 실제 비대상 JSON/BIN 보존을 기준으로 operation eligibility를 나눠야 한다. 이번에는 더 재생성하지 않는다. 원본/검증된 다른 개선을 폐기하지 않는다. 기본 URI/static/resource/translation/normal guards는 그대로다.

별도 다음 단계는 GLB에 남은sourceSpec을 현재 editable IR로 오인하지 않도록 참조 상태를 파일 자체에 기록하는 경로다. UV audit의 실제 sourceSpec 소비 위치는 src/engine/uv-quality.ts:66이고, 내보내기 sourceSpec 작성은 element-renderer.ts 및 element-workspace.ts다. 자동 IR 재열기 기능을 확인했다고 주장하지 않는다. 연속 goal ACTIVE, 외부 모델 quota로 추가 호출0.
