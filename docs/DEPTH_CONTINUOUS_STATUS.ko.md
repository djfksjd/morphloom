# 선언된 구면 전면의 연속 경계 — 수정 검수 2026-10-03

엔진 `morphloom.depth-surface-engine/0.3.1`은 선언된 구면과 검증된 관측 footprint에 한해 opt-in 가시 전면을 생성한다. 기존 Three.js SphereGeometry와 ConvexHull을 재사용하고, 전체 foreground pixel-centre의 선언 구면 위치와 파라메트릭 곡면·rim 샘플을 함께 삼각화한다. 임시 hull cap은 제거하므로 후면이나 닫힌 솔리드는 생성하지 않는다. 새로운 의존성은 없다.

정점이 구면 위에 있다는 것만으로 실제 삼각형 깊이가 정확하지 않았다. c8e4dba의 잠정 결과는 완료 감사에서 실제 GLB 경계 최대오차 0.7031mm와 일부 사례 전경 8픽셀 누락으로 실패했다. 그 파일과 실패 보고서는 별도 보존한다. 국부 점 삽입 방식의 뒤집힌 면, 전체 고밀도 링의 pole 퇴화도 진단한 뒤 폐기했고, 곡면 보강과 rim 분할을 분리했다. 기존 topology 용접 기준과 .100/.250/.001 임계값을 낮추지 않았다.

현재 actual Float32 GLB 삼각형을 원본 pixel-centre에 투영·보간한 결과는 다음과 같다. 깊이 검증점과 독립 경계 검증점의 위치·값을 기하 보강 입력으로 사용하지 않는다. Z 정렬은 기존 fit 경로를 재사용한다. 독립 boundary 선언만 바꿔도 geometry/normal/UV/index가 동일한 회귀 테스트를 포함한다.

| 작성 fixture | GLB 최대 anchor 오차(mm) | 전경 누락 | grid→연속 rim deficit(mm) | 삼각형 |
|---|---:|---:|---:|---:|
| 큰 구면 matte/checker | 0.000135272 | 0 | 1.737795→0.008995 | 69,436 |
| 작은 구면 matte/checker | 0.000039147 | 0 | 1.698166→0.001188 | 40,499 |
| 반지름 3mm 볼 | 0.000002447 | 0 | 0.106135→0.00007423 | 40,355 |

전체 face/edge의 구면 chord 편차, 정점 오차≤.001mm, 유한 투영 UV, unit/radial normal과 단일 열린 rim을 검사했다. GLB 10개 Khronos·UV integrity를 통과했고 퇴화/non-manifold/self-intersection은 0이다. 의도된 열린 전면이므로 일반 closed-solid topology.pass는 false이며 `releaseAllowed:false`를 유지한다. 실제 메시의 누락/깊이 검사가 실패하면 UI 적용은 기존 상태를 보존한다. 진단 파일의 실패 보고서를 합격으로 숨기지 않는다.

native0.3/depth-meshing0.1의 선언형 옵션과 실패 정책은 유지하고 엔진 revision을 올렸다. native0.1/0.2 raw/grid와 미채택 0.3 경로를 보존한다. 기존 grid GLB 5개는 f734ce0 기준선과 전체 바이트가 동일하다. 원본 samples/mask/mm calibration/quality/사진·field fingerprint 및 기존 bearing 프로젝트 바이트를 보존한다. 구면 선언이 없는 torus, 구멍/가림 mask, 잘린 frame, 예산 초과는 거부한다.

사용법: `PHOTO EVIDENCE` → 깊이 검수(`/?editor=depth`)에서 기존 depth JSON을 열고, ‘선택적 연속 구면 경계 · native0.3’의 mm 허용오차를 확인한 뒤 ‘연속 구면 전면 (대상 topology·UV 변경)’을 선택한다. 입력 취소, 실패 시 상태 보존, Undo/Redo(연산·허용오차), native 저장/재열기, checker/wire 보기와 실제 GLB 다운로드를 검수했다. 원본 native JSON을 GLB와 함께 보관한다. 브라우저와 Node의 구면/볼 GLB 2개는 전체 바이트가 같다.

Blender 5.2.1 LTS에서 현재 GLB 10개를 재열기·재내보내기했다. 볼 정점 1mm 편집 → 재열기 → 복원과 편집/복원 파일 2개 Khronos 검사를 통과했다. UV·진단용 grey PBR·명명·계층·source extras를 보존했다. 사진 texture bake나 일반 재질 납품을 검증한 것은 아니다. 정사영 UV는 실루엣 부근에서 크게 늘어나므로 checker/finite UV 통과를 atlas 품질로 해석하지 않는다. texel density는 텍스처 부재로 not-run이며 padding/mip/normal-map bake도 미검증이다. `blender-canonical`의 현재 파일 해시 영수증을 사용하며 이전 면 순서의 영수증은 현 버전 증거로 재사용하지 않는다.

동일 camera/light/fixed-space/1024² clay front·iso·wire와 공통 ROI를 비교했다. `comparison.png`는 경계 톱니 감소를 보여준다. 이미지와 영수증 해시를 확인했고 등각은 원자료 정확도 검증이 아닌 구조 검수다. M5/macOS/Node24.13.1 환경의 fixture compile은 142–231ms, ≤100k triangles·≤8MiB이며 입력≤256²와 compile≤1초 계약을 유지한다. actual-mesh 샘플러는 합계 2,000,000 pixel tests에서 명시적으로 실패한다. 기기 전반의 속도 보장은 없다.

UNI_AI 공개 코드 검토는 목표 내 2회다. 첫 호출은 55초 timeout으로 토큰/과금 unknown, 다른 수정 알고리즘 검토인 두 번째 호출은 gpt-6-sol HTTP200·2,501tokens였다. 지적된 샘플러 가시 깊이 선택·합산 연산 상한·finite sphere 입력을 로컬에서 보강했다. 키와 원본 사진은 외부 전송하지 않았다. 별도의 Gateway 연결 확인 호출은 모델 검토 증거가 아니다.

현재 원본 범위 93파일/655테스트, 게시 범위 90파일/636테스트가 통과했다. check/test/build/benchmark exit0. quality:production은 내장 quality gate 통과 후 독립 비교 evidence 0/3 부족으로 exit1이다. 전문가/실제품/일반 곡면/캐릭터/제조/CAD-BREP는 not-run이며 플랫폼 전체 완성 선언은 하지 않는다. source Git index 접근 오류128을 임의 복구하지 않고 별도 clone allowlist로 게시한다. 원본의 무관한 sim:test와 19개 sim 테스트는 보존하고 게시하지 않는다.

공개 결과 위치는 `benchmarks/modeling-slices-20261003/depth-continuous-refined`, 로컬 위치는 `outputs/depth-continuous-20261003/refined`다. verification.json은 현 engine·code·입력·native·GLB·렌더·검수 해시를 묶는다. c8e4dba 실패는 `prior-failure`에서 확인한다. 재현은 별도 출력 경로로 실행한다.

```bash
npx vite-node scripts/depth-continuous-evidence.ts /tmp/depth-continuous-replay benchmarks/modeling-slices-20261003/depth-boundary
npx vite-node scripts/depth-continuous-projected-audit.ts /tmp/depth-continuous-replay --require-pass
npx vite-node scripts/depth-continuous-compare.ts benchmarks/modeling-slices-20261003/depth-continuous-refined
```

다음 우선순위는 실제 제품의 관측 자료·부품 IR와 사진 표면의 편집/납품 보존을 연결하는 것이다. 이 작성 구면 fixture의 통과를 보이지 않는 실물 복원 능력으로 확대하지 않는다.
