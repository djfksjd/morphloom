# 표면 캐시 검수

CPU RGBA payload 누락을 수정했다. 32MiB/96entry 임계값은 그대로다. 256² RGBA8 세 장의 추정은1,048,576에서1,835,008bytes로 바로잡았다. Cold32asphalt 입력에서 기존 실제 payload+mip58,720,128bytes는 실패했고, 수정본18shared entries/33,030,072bytes는 상한 안이다. 작은 metal입력으로96entry 상한/실제 editor owner dispose를 검수했다.

실제 texture 픽셀과 GLB의 정점·UV·normal·index·이미지 binary payload 및 PBR/계층 참조는 baseline/cold/warm/overflow에서 동일. 전체GLB해시는 반복 중 이미지 bufferView 저장 순서 차이로 달라질 수 있다. 두 번의 해시 assertion 실패 후 실제 JSON/payload를 분해하여 이 원인을 확인했으며 source appearance 차이로 숨기지 않았다. 88files609tests/check/build PASS. Blender 재열기/roundtrip PASS. Khronos errors0,generated-tangent warning1으로 strict gltf command는 exit1이다. 신규 appearance 변경이 아니므로 신규 beauty image 대신 파일 내부 실데이터 보존을 검수했다.

검수: outputs/surface-cache-20261002/verification.json, semantic-preservation.json. 초기 fixture material.dispose만으로 texture 해제를 기대한 harness 실패는 보존하고 명시적 fixture owner 해제를 적용했다. 실제 editor dispose는 별도 테스트로 통과했다. CPU transient/총RAM/실제VRAM은 계약 밖이며 미실측이다. UNI_AI403fallback,production독립비교부족FAIL,원본gitindexblocked 유지.
