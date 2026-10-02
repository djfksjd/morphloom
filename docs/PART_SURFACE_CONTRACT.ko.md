# Element Part 표면 재질 계약

2026-10-02. 감사·구현 첫25분, 파일/UI/DCC 검증을 포함한 총50분으로 작업 전 구분한다. 동일 실패2회 후 재진단. 기존 surface-system/reference-surface/AssemblyMaterialIR를 재사용한다. 원본 사진/외부 API/새 의존성을 추가하지 않는다.

첫 용도는 깨끗한 기계 제품의 authored 표면 appearance다. Part material.surface는 finish(brushed-metal/bead-blasted-metal/anodized-metal), channels='roughness-only', repeat=[U,V](각0.125..1024)를 선언한다. normal/tangent/anisotropy/사진 투영을 요청하면 이 연산에서 미지원으로 거부한다. 미지원 전체 finish를 조용히 근사하지 않는다. 기존 normal-enabled assembly material 경로는 그대로 유지한다.

surface-system의 실제 RGBA metallic-roughness bitmap을 사용하며 normal texture는 선언한 채널 범위에 포함하지 않는다. Brushed finish는 선택적으로 seamless periodic directional variant를 사용하여 기존 다른 재질의 패턴을 바꾸지 않는다. roughness scalar/metalness/color는 사용자 값을 유지하고 map의G와B를 사용한다. geometry/normal/UV/index/계층/비대상PBR·texture 보존이 필수다. Source schema0.6과 명시적 lossless migration은 기본 표면을 넣지 않는다. 구버전 surface필드/범위/채널/형식/잠긴부품은 거부한다.

기준 대표gear:기존 UVscale100,c.05mm. repeat8이면 planar UV100units/m에1.25mm bitmap tile,64px/51.2texels/mm. 8주기 directional pattern은 명목0.15625mm 반복을 표현하는 authored roughness 변화이며 실제 측정된 금속 가공 간격/물성이 아니다. 곡면/베벨은 실제 UVunits/m·anisotropy를 측정하며 위 평면 값으로 일반화하지 않는다. UV 자체나 source geometry를 재질 적용 과정에서 자동 수정하지 않는다. 원거리/전체1024, tooth 근거리 약5.85mm폭1024; 동일 카메라·조명·배경에서 before/after. 64px bitmap의 해상도 한계를 표시한다.

3개의64² RGBA cachemaps steady CPU49152bytes, approx mip GPU65536bytes/recipe를 포함해 예산에 기록한다. 한 asset 16MiB,프로젝트32MiB를 상한으로 삼되 기존 sharedcache 전역 상한을 낮추거나 끄지 않는다. 공유texture는 cache소유, nonshared texture는 material소유로 구분하고 dispose 회귀를 검증한다. 성능은 M5/Node24.13.1와 실제asset 크기를 함께 기록한다.

합격:실제 pixel 배열변화/재현성, stagedApply/Cancel/Undo/Redo/save/reload, selectedpart만maps/PBR 변경,actual GLB embedded image와 sampler/transform/채널/UV 보존,neutral material+roughness채널 close 검수,Blender再열기와Khronos0errors,다른두형상/크기와기존회귀검사. 기존UV/production/releaseAllowed gate 변경없음. Atlas/padding/mip bleeding/normal tangent/실측 물성/제조/전문가승인은 범위 밖으로 명시한다.
