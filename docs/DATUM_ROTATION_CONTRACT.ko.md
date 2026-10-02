# Deterministic local datum rotation 계약

2026-10-02. 첫 반복20분/동일 실패2회 후 재진단. 현재 renderer0.7/workspace-engine0.2 actual mixed GLB의 Node/browser strict comparator가 matrix4성분 마지막 자릿값 차이로 FAIL을 재현했다. 이전 파일이 아닌 이번 baseline-browser와 baseline-comparison.json을 보존한다. Position/normal/UV/index/PBR/이름/계층은 동일하며 comparator를 완화하지 않는다.

원본 workspace0.1 source 각도±2π, 단위/seed/ID/datum/스키마 보존. Math.sin/cos 대신 제한된 half-angle Taylor/Horner 계산을 사용하는 quaternion XYZ를 적용한다. argument는±π로 제한하고±π/2로 fold한다. sin21/cos20차 truncation+float오차를 보수적으로 trig≤1e-13, unit quaternion≤1e-13, matrix native deviation≤1e-12로 계약한다. 좌표반경3e6mm 기준 world point 오차≤1e-5mm; 실제 측정과범위 밖 거부가 필수다. 원본 source를 mesh/viewer 파생 데이터로 대체하지 않는다. 제조/GIS precision 인증이 아니다.

성공: source bytes 보존, actual current Node/browser strict GLB accessor/PBR/계층/matrix 비교 PASS(비교기·검사 threshold 그대로), 같은 입력 반복출력, 다양한 signed/경계 회전과 datum 크기, quaternion normalization/matrix finite/bounds, native 세계좌표 오차 예산, local edit/undo/save/reload, Blender 재열기/Khronos0 errors. 하위 호환 스키마는 변경하지 않고 엔진 revision으로 계산 변경을 연결한다. 기존 외부/원본전송 없음, UNI_AI403 fallback, push없음.

기존 static part/element 배치와 workspace datum이 같은 bounded helper를 사용한다. source 각도±2π 계약은 그대로이며 기존 group fan으로 계산되는 resolved rotation은±4π까지 helper가 수용한다(half angle±2π를±π로 range-reduce). 새 arbitrary angle/스키마를 허용하지 않는다. 임의 input은 유한값/세 성분/범위 검사를 거친다. shader/리깅/animated pose 커널 전체를 결정론화했다고 주장하지 않는다.
