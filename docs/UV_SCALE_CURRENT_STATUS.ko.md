# UV 편집 현재 버전 재검수 (2026-10-03)

기존 elements0.4 opt-in 기능을 재사용했다. 새 UV 연산이나 자동 마이그레이션을 구현한 것으로 보고하지 않는다. 기준 소스86770dd, renderer0.10. 이전 증거를 현재 실행 영수증으로 바꾸지 않았다.

실제 native UI 7사례:0.3 FAIL 보존, 명시적0.4 전환/part 그대로, scalar100 Apply, UV 외 source 필드 그대로, Undo FAIL, Redo PASS, 저장·업로드 exact. 기존 1e-10/5%와 개별 tooth 검사는 유지했다. 독립 현재 입력3사례에서 기본1490→0/소형1732→0/대형0→0 UV 퇴화 삼각형; position/normal/index/PBR/변환/이름/parent 전체 비UV 해시는 exact. 각각8384/6416/16000tri, feature24/18/48. 처음 모든 legacy 크기를 실패하도록 요구한 harness 가정은 대형 기존PASS 때문에 실패했다. 실패 기록을 보존하고 해당 가정만 바로잡았다.

일반 UI 내보내기로 실제3파일을 새 다운로드 디렉터리에서 받았다. GLB magic/동반source exact/실제 파일 UV·개별feature PASS. GLB SHA256 de2ad4577274b75ffbb61543b8b358900cbb73b1d39ef8d7a7ac0c4a5cd12443; source ee2f2f28e2c12af6776e01b6cc4fd27c9655eab1878eb015187f073b71876913. Blender5.2.1 재열기 bounds drift0mm/geometry parity PASS; spur_gear를2mm 이동 후 두 roundtrip에서 canonical UV/PBR/이름/계층 보존 PASS. Khronos errors0/warnings0/infos1 UNUSED_OBJECT. UV를 삭제하거나 가짜 texture를 추가하지 않았다. editable-mesh 통과는 엄격 production benchmark 통과가 아니다.

현재 실행: npm test99files/711tests PASS(57.17s), npm run check/build PASS. 런타임 변경 없는 증거 단계이므로 full quality:gate/production은 이번 단계 not-run. 직전 현재 실행의 cooling infos23 실패와 독립 dominance0/3 부족은 해결되지 않았다. UNI_AI credit shortage/Claude weekly limit으로 외부 모델 추가 검토 blocked.

동일 Fit view/checker full-page before/after를 실제 확인했다. viewport/selector 캡처는 UI만 잘못 잘렸으므로 검수 이미지로 거부하고 기록했다. full-page에서26mm 기어가 약80px로 작게 보이는 기존 Fit view0.1m 거리 floor를 발견했다. UV 편집이 framing을 개선했다고 주장하지 않는다. 다음 단계에서 기존 camera-framing helper를 재사용한다.

사용: Domain Pack 기어 생성→spur_gear 선택→Enable UV editing(schema0.4)→UV scalar100→Apply part edit→Undo/Redo→Save project JSON→Export selected GLB + source JSON. scalar는 무차원이며 모든 mapping의 물리 타일 크기를 보장하지 않는다. PBR export에는 synthetic checker가 섞이지 않는다.

원본 IR/GLB/Blender 결과: /Users/danny/Documents/morphloom/outputs/uvscale-current-20261003. 공개 재현 스크립트 scripts/uv-scale-current-conformance.ts; 작은 영수증/이미지 및 원본파일 해시는 benchmarks/modeling-slices-20261003/uvscale-current. verification SHA25641ab9685522c6da8317a5b46a10e38405dda2abbcd4188411ebb74382804f03e. 큰 GLB는 로컬 유지, Git에는 해시를 보존했다.

미검증: unique atlas/padding/mip bleeding, 실제 texel density(금속roughness texture 없음), 제조 trochoid/공차/운동학/CAD/BREP, 인간 전문가 평가. 이는 기존 UV 계약의 좁은 현재 실행 검증이며 전 분야 고도화 완료가 아니다. 연속 goal은 active.
