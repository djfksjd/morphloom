# Blender 선택형 normal import — 현재 결과

기반 커밋4b6faa1, Blender5.2.1 LTS 빌드9e2066aef7ef에서 검증했다. 기본 importer의 압축 custom normal 경로에서는 약0.0339° 손실이 남는다. reference 후보 역시 기어0.0160044° 실패로 중단했다. 새 선택형 도구는 FLOAT_VECTOR/CORNER 속성에 원본 normal을 보존한다. 기존0.01° 기준은 변경하지 않았다.

- 작은·기본·큰 베어링과 기어: 첫 import 오차0°, 실제 .blend 저장·재열기4 PASS.
- 재export37 meshes: 최대0.0044194237°, 모두 PASS. 실제 GLB 규격 검사4 PASS.
- 잘못된 framing/URI/normal/accessor, 이름 충돌, 기록 이후 강제 실패의 rollback, 비대상 사용자 mesh/UV/property/placement 보존: 7 PASS.
- 현재 코드 npm test779 PASS, check/benchmark/build PASS. 전체 quality:gate·quality:production은 기존 cross-domain cooling GLB UNUSED_OBJECT infos23 제한 위반으로 FAIL. production dominance는 not-run.

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --python-exit-code 1 --python scripts/blender-source-normal-import.py -- input.glb new.blend new.receipt.json
/Applications/Blender.app/Contents/MacOS/Blender --background --python-exit-code 1 --python scripts/blender-source-normal-conformance.py -- input.glb new-evidence-directory
```

저장한 .blend는 Blender에서 메시로 수정할 수 있다. sourceSpec은 수정 전 참고 자료이며 현재 편집된 IR로 취급하지 않는다. 기존 파일은 덮어쓰지 않는다. texture·rig·animation·morph·외부 URI 및 다른 Blender 버전은 이 profile에서 거부한다. 기본 앱 import 경로는 변경하지 않았다. geometry/UV/index/material slot/계층 보존은 normal 기록 전후 비교이며 재export 전체 파일 바이트 일치와 제조 정확도 승인을 뜻하지 않는다.

[사전 계약·자원 제한](BLENDER_FIRST_IMPORT_CONTRACT.ko.md), [현재 파일 SHA·환경·검증 결과](../benchmarks/modeling-slices-20261004/blender-first-normal/verification.json), [실제 재열기](../benchmarks/modeling-slices-20261004/blender-first-normal/reopen.json), [normal 채널 이미지](../benchmarks/modeling-slices-20261004/blender-first-normal/default-normal.png). 렌더는 저장본의 normal 검사이며 전후 실측 비교나 독립 전문가 승인이 아니다. 전체 플랫폼은 production-ready가 아니다.

원본 실패 로그와 .blend/GLB 실물은 `outputs/blender-first-normal-goal-20261004`에 남긴다. 다음 한 작업은 기존 전체 게이트의 cooling UNUSED_OBJECT 실패를 실제 출력과 영수증 사이에서 분리하는 것이다.
