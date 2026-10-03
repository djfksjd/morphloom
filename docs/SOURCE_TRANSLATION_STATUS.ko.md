# 원본 버퍼 보존 위치 편집: 제한된 검증 결과

`blender-source-translation.py`는 실제 Blender import 후 선언한 glTF Y-up 월드 mm 이동을 수행한다. 이동 전후 메시 정점·loop·polygon·UV·corner normal·재질 참조·부모와 비대상 world matrix를 검사한다. 그 후 원본 JSON의 대상 node 변환만 갱신하며 BIN은 그대로 보존한다. 기존 파일 덮어쓰기와 실패 시 이번 호출의 부분 파일을 차단한다. 일반 Blender re-export와 기존 UI exporter는 변경하지 않았다.

현재 7개 실제 사례(베어링 3크기, 기어, Y/Z축, animal+bearing workspace) 및 11개 잘못된 입력 거부 검사가 통과했다. 각 사례 두 번 재열기의 모든 메시 split normal 최대 차이 0°, 원본 BIN과 비대상 JSON 정확히 동일. 별도 actual GLB 비교로 선언한 world translation과 원본 NORMAL을 확인했다. 같은 1024px camera/light/space의 전체·볼 클로즈업 4장으로 위치 이동을 확인했다. 이 렌더는 새 형상 정확도나 실측 베어링 설계 승인 증거가 아니다.

회전·비균일 scale·translation을 추가한 parent fixture는 import/source matrix 대응 최대 차이 2.384185791015625e-7로 고정 1e-7 검사를 실패했다. 출력 파일 없음. 진단 재실행에서도 같아 더 반복하지 않았다. 이 조합은 BLOCKED이며 7개 통과 사례로 일반화하지 않는다. 다음 단계에서 설치된 importer의 좌표계/TRS 계산과 비교한다. 현재 임계값은 변경하지 않았다.

검증 명령: `python3 scripts/source-translation-conformance.py manifest.json NEW-output-directory /Applications/Blender.app/Contents/MacOS/Blender`, `npm test` 104파일/764테스트 PASS, `npm run check` PASS, `npm run build` PASS, Python py_compile PASS. 현재 quality:gate exit1이며 경쟁 검사는 기존 compiler-bound DCC receipts를 읽는다. 전체 앱을 다시 실행한 결과가 아니다. production blocked/not-run. 현재 실제 7개 GLB Khronos errors0/warnings0이지만 infos 11/10/15/1/11/11/62로 strict infos0 납품 조건은 FAIL이다. UV를 지우거나 기준을 낮추지 않았다. 원본 저장소 전체 테스트는 이번 단계 not-run, index status/diff exit128은 보존했다.

사용법: Blender background에서 `--python-exit-code 1 --python scripts/blender-source-translation.py -- input.glb NEW.glb NEW-receipt.json ball_0000 2 0 0`을 사용한다. 마지막 세 수치는 glTF Y-up 월드 mm이다. GUI에 연결된 기능은 아니며 arbitrary DCC geometry/normal/material 수정, skin/morph/time/외부 URI는 입력받지 않는다. source IR·embedded procedural metadata는 변경 전 참고 자료이며 현재 변환의 편집 원본으로 사용하지 않는다. 결과 GLB는 baked 변환 파일이고 receipt에 이 제한을 명시한다. raw source→첫 Blender import 노멀 오차는 여전히 FAIL이며 이번 변화는 누적 왕복 드리프트 방지만 검증했다.

출력: `outputs/source-translation-20261003/release`, 중립 이미지 `render`, 공개 검수 manifest `benchmarks/modeling-slices-20261003/source-translation/verification.json`. 큰 GLB는 로컬에 유지하고 공개 manifest에 SHA를 기록한다. UNI_AI credit rejection/Claude weekly quota가 확인돼 이번 추가 호출 0, 의존성 0. 21:08 KST 시작/45분 계약. 연속 goal ACTIVE.
