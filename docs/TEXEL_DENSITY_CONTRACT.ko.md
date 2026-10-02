# 실제 texel density 측정 계약

2026-10-02. 첫20분 구현·검증, 같은 결함2번 재진단. 기존 UV 검사의 world-space Jacobian을 재사용한다. 단위 texels/mm, 실제 metallic-roughness map의 width/height 및 UV transform matrix를 사용한다. surface gear64²/repeat8/UV100의 평면 기대값51.2texels/mm; 1m triangle·64²·repeat1의 기대값0.064texels/mm. 비정사각/비균일 repeat/회전/world 비균일scale는 Jacobian singular values로 범위를 측정한다. 특정 density 합격 임계값은 새로 발명하지 않는다.

단일 static material·UV0·유효 실제 image·finite invertible transform부터 지원한다. 다중 material/UV channel/이미지 미로드/instanced/skinned/잘못된 UV는 not-run 또는 partial을 명시한다. per-triangle/per-feature min/max와 누락 개수를 표시하여 평균으로 결함을 숨기지 않는다. texture 변경은 geometry fingerprint를 바꾸지 않으며 source/output SHA가 전체 납품 파일을 식별한다. 보고서 revision0.2는0.1 core fields를 보존하고 measurement fields를 추가한다. geometry/PBR/IR 변경 없음. atlas/padding/mip bleeding·원자료/실측물성 승인은 별도다. 실제 browser GLB receipt와 알려진 수치 tests, 기존 regression gates를 확인한다. UNI_AI403 fallback·새 의존성/외부 원자료 전송/push 없음.

측정은 wrapping/clamping 이전의 local UV Jacobian이다. 반복 시 실제 고유 이미지 texel 수가 늘어났다고 해석하지 않는다. clamp 경계 밖의 unique coverage는 검증하지 않으며 sampler wrap modes와 transform을 보고한다.
