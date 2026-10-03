# Blender tangent 반복 결정성 — 2026-10-04

기반a57aee2. 인체의 반복 roundtrip/edit delivery GLB는 JSON과 다른 accessor가 같지만 TANGENT12/6 Float32 값이 달라졌다. 임계값 완화·양자화·기존 tangent 삭제로 통과시키지 않는다. 기존 MikkTSpace normal-map 표현과 source/POSITION/NORMAL/UV/index/material/skin/animation/계층을 유지한다.

실제 mesh.calc_tangents 최소 재현: 기본 실행 두 import에서 tangent 값16422/11707개가 최대1.788139343e-7만큼 달랐다. POSITION/NORMAL/UV/index/sign은 같았다. --threads1에서는 모든 비교가 byte exact였다. 이 근거로 두 cross-domain benchmark의 선택적 local Blender 실행을 single-thread profile0.1로 고정한다. Three tangent 재생성이나 원본 NORMAL 복원으로 이를 대체하지 않는다.

합격: 현재 인체 포함5-domain roundtrip/edit 각각2회, 같은 source와 profile에서 최종 delivery SHA 동일, 각 기존 의미·비대상·rig·UV·실파일 검사 유지. 반복 파일 불일치는 FAIL로 기록한다. 실행 옵션·Blender 버전·source SHA·elapsed 시간을 기록한다. 기존 default Blender import normal drift 및 cooling UV23/global gate 실패는 별도다. 단일 스레드 profile은 일관된 검수 실행 옵션이며 임의 GUI export의 결정성을 보장하지 않는다.

현재 단계 native benchmark당 최대2회, 출력 디스크2GB, API/Claude0. 기존 실패 probe와 반복 자료는 보존한다. app 기본 생성/IR/renderer와 gate 임계값을 변경하지 않는다. 테스트/check/benchmark/build 및 현재 quality 결과를 기록한다.
