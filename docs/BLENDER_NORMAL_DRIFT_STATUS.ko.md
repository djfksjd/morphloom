# Blender 노멀 드리프트 원인 분리 결과

기준 커밋 016c5bd. 현재 실제 GLB `1494f424092c5cddc61f65c5d825062fdc01151bbc8944280386ba2b7f516d5b`를 사용했다. 원본 NORMAL 자기 비교는 통과했지만 Blender 첫 import에서 볼의 최대 차이가 0.0338954°, export 0.0355566°, 두 번째 export 0.0435722°였다. 고정 기준은 계속 0.01°다.

설치된 Blender 5.2.1 importer는 NORMALS 모드에서만 원본 노멀을 읽고 custom normal로 설정한다. 같은 원본 데이터의 직접 setter 실험은 smooth reference 0.033896° 실패, flat reference 0.002496° 통과였다. 단순 FLAT import는 원본 NORMAL을 버리므로 4.682795° 실패했다. 따라서 FLAT import를 보존 기능으로 제공하지 않는다.

검증된 source NORMAL과 import vertex 대응을 사용한 실험적 setter는 볼에서 개선됐지만 전체 왕복 외륜이 0.011733°로 실패했다. adaptive/isolated 후보에서도 실패가 반복돼 원인 재검토 후 중단했다. 기본 component-edit helper는 HEAD 바이트로 복원했다. 진단용 prototype은 실험 상태이며 UI·기본 납품 경로에 등록하지 않았다. 전체 드리프트 해결 또는 납품 완료로 보고하지 않는다.

`compare-native-normal-payload.ts`는 실제 NORMAL 또는 원본 SHA에 연결된 Blender 표본을 비교한다. 실제 거리 1µm 이내의 유일한 좌표 대응과 양방향 최대 각도를 검사한다. 7개 bounded conformance에서 자기 비교 통과, 잘못된 SHA·좌표 계약·policy·mesh·선언 translation 및 실제 import 실패가 기대대로 검출됐다. 초기 좌표 bin 오판과 prototype 실패 로그도 보존한다. npm run check 통과, 기존 전체 테스트 결과를 이번 수정본의 결과로 재사용하지 않는다.

30분+20분 계약을 초과했다. 시작 약 20:08 KST, 원인 정리 21:08 KST로 약 60분이며 추가 실험을 통과로 포장하지 않는다. API/Claude 추가 호출 0, 의존성 추가 0. 다음 단계는 순수 translation만 실제 Blender 상태로 검증하고 원본 버퍼를 유지하는 별도 adapter다. source IR은 원본 참고 자료이며 수정된 변환을 자동 반영했다고 주장하지 않는다. 연속 goal ACTIVE.
