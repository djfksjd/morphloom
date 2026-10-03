# 층별 선언 영역 검수 — compiler0.39

Laurel의 기존 화면이 필수 공간0%로 차단되는 결함을 재현했다. 새 architecturalProgram0.1은 고정된48개 목표 영역(9세대*5바닥 영역+3계단참)을 실제 컴파일된 삼각형에 각각 투영한다. 하나라도 실패하면 전체 프로그램 검사는 실패한다. 단순 metadata100이나 전체 평면 평균 IoU로 통과시키지 않는다.

목표의 evidence.status는 authored다. 기존 모델에서 고정한 기준이며 HABS URL은 참고자료다. 독립 실측·방의 벽체·가구·보행/피난·구조·시공 승인을 뜻하지 않는다. 기존 measured/datasheet 평면 검사는 authored 값을 계속 거부한다. 새로운 선언 프로그램의 제한된 경로만 이를 허용한다. 기존 일반 주택의 지붕·가구·설비 검사는 유지한다. 기존 파일에 계약을 자동 삽입하지 않는다.

Actual 검증:48/48 기본 통과; 욕실 바닥 하나 삭제+metadata100 위조 시47/48로 차단, 전체 slab IoU1.000 유지; 실제 브라우저 저장·재열기·복원48/48 통과. 계약 fingerprint가 달라지면 이전 결과를 승인 근거로 쓰지 않는다. 분야 검사는 실제 현재 메시를 다시 측정해 복사된 통과 메타데이터도 거부한다. 다른 치수의 바닥 이동과 실제 관통 구멍 사례, 미래 버전·누락·중복·약한 임계값·미지원 instanced 표현도 검사했다.

성능의 첫 raycast 구현은2,344.95ms/343.32ms(6.83배)로 예산 실패했다. 실패 영수증을 보존하고 경로를 opt-in triangle-raster로 수정했다. 기존48개 영역의 raycast와 결과가 정확히 동일하다. 마지막 warm 중앙값355.63ms/기존 입력334.11ms(1.064배), 정한2배/10초 한도 통과(M5/Node24.13.1). 기존 raycast 호출은 그대로다. 전체 계약의 삼각형200,000개/격자 방문16,000,000회/격자524,288개/참조128개 한도를 적용한다. 지원하지 않는 표현과 계산 초과는 해당 요구사항 실패로 보고한다.

321개 메시의 정점·normal·UV·index 해시가 전부 보존됐다.삼각형188,748개도 그대로다. 같은 카메라·조명1024px clay before/current의 RGBA 픽셀이 동일하고 최소 여백84px이다. PNG 파일 SHA는 각각 기록한다. 외관 향상으로 과장하지 않는다. 새 GLB 29,636,712bytes, SHA256 `a7ea7dc3300d8d261b50e925ce586ffb4c2580981bc05b98b91900f0c329cca2`. 큰 파일은 outputs/native-039-authored-20261003/fixtures에 보존하고 git에는 넣지 않는다.

현재 실행: 공개711/원본 사용자 추가 테스트730, npm check/build/benchmark PASS. 현재5종 GLB 두 번 생성/Khronos, Blender5종 import/edit/reopen·Godot5종·asphalt Prusa PASS.7개 실제 SAVE PROOF와 authored 프로그램 브라우저 양성/누락/복원 PASS. 현재0.39 asphalt asset pack/OBJ/STL/PLY/USDZ 검사도 통과한 파일 해시에 연결한다. 내부 quality benchmark 지표100%/필수 browser proof4/4 PASS. 정정(2026-10-03 후속 재실행): 전체 npm quality:gate는 냉각 GLB의 unused UV 정보23개로 competitive 단계에서 FAIL이고 quality:production도 여기서 먼저 중단된다. 별도 실행한 dominance도 독립 동일입력 사례 부족으로 FAIL이다. 내부 지표를 전체 명령 PASS로 묶은 이전 표기를 바로잡았다. pass/claimAllowed·임계값은 바꾸지 않았다. 이는 전 분야 완성이나 독립 전문가 평가를 뜻하지 않는다.

최소 엔진0.39. AssemblyIR0.1의 선택적인 versioned 계약이며 미래 버전·범위·중복·추가 키를 거부한다. 명시적 deep-copy set/clear 마이그레이션이 있고 미래 선언을 지우지 않는다. 기존 component patch/history는 선택적인 root 계약을 유지한다. 새 계약에 대한 별도 UIUndo/Redo 사례는 not-run이며 이번에는 실제 파일 저장·재열기·복원을 확인했다. GLB는 Blender에서 편집 가능한 baked mesh이며 IR은 별도 보존한다. Blender의 임의 메시 편집을 자동으로 IR 파라미터에 역변환했다고 주장하지 않는다.

UNI_AI gpt-6-astra 설계 협업1회896tokens 성공, 코드/짧은 검토 요청2회402 unclassified. 크레딧 전체 소진은 확인되지 않았고 Claude CLI not-run. 최종 raster·provenance 변경의 API 코드 검토와 독립 인간 전문가 검수는 not-run. 원본 git index iCloud mapping 장애는 보존했고 사용자 추가 파일·최신 benchmark를 덮어쓰지 않았다.

증거: benchmarks/modeling-slices-20261003/architectural-program/verification.json. 실제 IR·PNG·로그는 outputs/laurel-program-20261003. 이전 measured 표기의 시험본과 예산 안전장치 이전 검증은 별도 pre-provenance/pre-budget-safety 폴더에 남기며 현재 영수증으로 재사용하지 않는다. 다음은 베어링 lathe의 바깥 면 방향·단독 부품 납품 현황 감사다. 연속 goal ACTIVE.

범위 충돌은 중앙 IR검증과 JSON Schema에서 차단한다. floor-cutaway 프로그램은 building/architectural-shell-only/ceilingAndRoofIncluded=false를 명시해야 하며, full-building 요청에 조용히 적용하지 않는다.60분 체크포인트를 넘긴 추가 검수는 출처 표기와 범위 충돌 보강·최종 회귀에 한정했고 신규 모델링 기능을 늘리지 않았다.
