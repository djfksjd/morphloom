# 전선 끝단 교정 — compiler 0.38

실제 냉각 장치의 모서리 방향 충돌을 1,596→0으로 교정했다. 75개 전선의 끝단과 4개 히트파이프에 명시적인 flat-outward 마감을 적용한다. 옆면과 포트 중심, 경로, 재질·net·gauge·검증 선언을 보존한다. 삼각형 272,560개/메시 322개는 동일하고 정점 1,754개가 추가된다. 새 텍스처·의존성은 없다.

이전 저장 IR의 옵션 없는 메시 322개는 정점·normal·UV·index 해시가 그대로다. 기존 AssemblyIR0.1에 선택적인 versioned capFinish0.1을 추가했으며 기존 파일은 자동 교정하지 않는다. 명시적 set/clear와 wire-cap-patch0.1이 stale fingerprint·미지원 버전·중복 ID·잘못된 범위·추가 키를 거부한다. 새 flat 마감의 지름 범위는 기존 1µm 좌표 정밀도에 맞춘 0.01..20mm다. 이전 옵션 없는 지름 허용 범위는 유지한다.

사용: 전선을 선택 → Wire flat cap finish → Apply wire cap edit. Cancel, Undo/Redo, SAVE IR/파일 재열기와 기존 GLB 내보내기를 사용한다. 선택된 전선만 바뀐다. 전선 지름·net 편집이나 전선 단독 내보내기까지 지원한다고 주장하지 않는다. 실제 A→B→A 중 오래된 비동기 적용은 취소된다.

현재 실행: 공개 clone 700개/원본 사용자 추가 테스트 포함 719개, check/build/benchmark PASS. JSON Schema 8사례 PASS. 같은 0.38 실제 GLB의 Khronos 검증·두 번 생성 해시 일치 PASS. Blender 전체 322개 메시 방향 검사 PASS. 선택 전선 사례는 wire-alpha0/wire-beta20이며 전체 FAIL20을 유지한다. Blender5종 import/edit/reopen, Godot5종, asphalt Prusa를 새 파일로 검증했다. 현재 브라우저 asset pack과 OBJ/STL/PLY 실제 Blender 재열기, USDZ usdchecker도 PASS. 7개 실제 SAVE PROOF와 전선 편집 8사례 PASS. 정해진 예산 내 warm compile 중앙값271.53ms(MacM5/Node24.13.1), 동결 기준285.78ms의0.95배다. 다른 장치의 성능 보장은 아니다.

동일 1024px 카메라/조명 clay 전체와 heatpipe_1 사광 근접 렌더를 기록했다. 전체 실루엣은 동일하고 가려진 끝단이 많아 전체 외관 변화는 작다. 근접에서 잘못된 cap 셰이딩이 평평한 끝면으로 바뀐다. 원자료 없는 면은 구조적 검사이며 정확도 실측이 아니다. cap UV는 의도적인 반복 planar chart이며 unique bake atlas 승인으로 해석하지 않는다.

전체 production FAIL89%: Laurel 실제 브라우저 증빙 blocked, release proof3/4. 기준·기대 판정을 낮추지 않는다. dominance/competitive downstream은 앞 게이트 실패로 not-run. 전 분야 완료, 제조 CAD/BREP, 전기/열 벤치 승인, 원자료 정확도, 독립 인간 전문가 평가는 미검증이다. UNI_AI gpt-6-astra 3호출 중 긴 요청402(소진 미확인), 짧은2호출348tokens 성공; 검토는 설계 설명 범위다. Claude CLI not-run. 원본 git index iCloud mapping 장애는 변경하지 않았다.

증거: benchmarks/modeling-slices-20261003/wire-cap-finish/verification.json. 실제 IR/GLB/이미지: outputs/cooling-winding-20261003. 큰 실제 파일은 git에 넣지 않고 해시로 연결한다. 원본 사용자 변경과 최신 benchmark 파일은 덮어쓰지 않는다. 다음 단계는 Laurel 브라우저의 공간 프로그램 검사 불일치 재현이다. 연속 goal ACTIVE.
