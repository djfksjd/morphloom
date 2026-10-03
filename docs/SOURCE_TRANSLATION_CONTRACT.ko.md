# 원본 버퍼를 보존하는 좁은 Blender 위치 편집 계약

2026-10-03 21:08 KST 시작, 45분, 같은 결함 수정 최대 2회. 실험용 명시적 CLI만 추가하고 기존 UI·GLB exporter·component-edit helper 기본 동작을 보존한다. Blender 5.2.1에서 static GLB의 이름이 유일한 leaf mesh 하나를 glTF Y-up 월드 기준 ±1000mm 이내 이동한다. 애니메이션·skin·morph·외부 URI·instancing·복수 parent·cycle·알 수 없는 변환·이름 충돌은 거부한다. arbitrary 사용자 DCC 수정 또는 재메시는 입력받지 않는다.

실제 Blender에서 이동 전후 전체 메시의 정점·loop/index·UV·corner normal·재질 참조·부모와 비대상 world matrix를 검사한다. 대상 회전/scale 및 요청한 실제 translation도 검사한다. 이 검증이 끝난 뒤 원본 JSON의 대상 node transform만 수정한다. BIN chunk 및 기타 JSON은 정확히 보존한다. 실패하면 파일을 내보내지 않으며 기존 파일 덮어쓰기를 금지한다. 최종 파일은 Blender에서 두 번 다시 가져와 전 메시 split normals 최대 0.01° 및 기존 shape/UV/PBR/계층을 확인한다. 실제 이동 오차 ≤0.001mm, 원본 BIN 동일, 비대상 JSON 동일. 임계값을 변경하지 않는다.

원본 IR·source metadata는 변경 전 참고 자료다. 결과는 baked translation 파일이며 editable IR 동기화·native Blender re-export 보존으로 표시하지 않는다. CLI receipt에 이 제한, 현재 source/output SHA, Blender 버전, 단위와 변환을 기록한다. native ordinary export와 혼동하지 않는다. 볼·다른 크기·기어 사례와 unsupported/failure 검사를 실행한다. 삼각형/텍스처 증가 0, 입력 ≤256MiB, nodes≤10000, meshes≤128, vertices≤2M, corners≤6M. 추가 의존성/외부 전송/유료 호출 0.
