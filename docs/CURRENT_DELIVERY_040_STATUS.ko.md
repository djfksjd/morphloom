# Compiler 0.40 실제 납품 증거 갱신

2026-10-04, 기준 코드 `0e94ded5097e6fc364c5771b7f836ab698024fb2`. 이번 단계는 직전 lathe 구현의 엔진 버전 변경으로 무효화된 납품 영수증을 **실제 실행으로** 갱신한다. 기하·검사 임계값·UV·제품 코드는 바꾸지 않았다. 예산 30분/증거 1GiB, UNI_AI/Claude 호출 0회. 이전 영수증은 별도 보존한다.

## 현재 실행

| 실행 | 실제 결과 | 주장 범위 |
|---|---|---|
| 실제 브라우저 7자산 SAVE PROOF | PASS, current compiler 0.40, release 대응 4/4 | 차단된 cooling/concept/web-hero는 release=false 유지 |
| 현재 5분야 GLB 생성 | PASS, 각 2회 전체 SHA 일치 | 현재 입력/출력에 연결된 생성 결정성 |
| Blender 5.2.1 LTS import/export/reimport | 5/5 의미 보존 PASS | raw tangent 오류를 기존 repair로 수정한 최종 파일을 별도 검증; 전체 raw normal byte 보존 완료가 아님 |
| Blender 부품 편집·재열기 | 5/5 실행 PASS | strict competitive 수락은 cooling infos 때문에 FAIL |
| Godot 4.7.2 native PackedScene import | 5/5 PASS | 기존 좌표·기하·재질·텍스처·리그·애니메이션·relief 계약 범위 |
| PrusaSlicer 2.9.6 | PASS | 선언된 650×500mm 가상 베드의 coarse toolpath; 실제 프린터 생산 승인 아님 |
| 실제 브라우저 OBJ/STL/PLY/USDZ/ZIP 다운로드 | PASS | 이번에 다운로드한 실제 파일 |
| Blender OBJ/STL/PLY, Apple usdchecker | PASS | 111936삼각형, 단위 정규화 envelope 차이 0.0000312mm; CAD/BREP·정적 형식의 리깅 보존 주장이 아님 |
| `npm run quality:gate` (browser 갱신 후) | exit 1 | 첫 quality 통과, competitive에서 오래된 native 영수증/기존 UV infos 실패 |
| `npm run quality:production` (모든 현재 native 갱신 후) | exit 1 | quality 지표100%, release browser4/4 PASS; strict competitive 실패, dominance not-run |

현재 competitive에서 Godot/Prusa/static 영수증은 수락된다. Blender cross-domain과 edit은 실행상 PASS지만 **benchmarkAccepted=false**다. cooling 최종 GLB의 infos=23, 나머지 네 사례 infos=0. 원본 UV를 삭제하거나 무의미한 텍스처를 추가하지 않았고 infos 기준을 느슨하게 바꾸지 않았다. 이 단계에서 전체 production-ready는 미충족이다. 기존 Blender 구 부품 첫 import normal 오차 0.02968046° FAIL도 남는다.

이 단계는 제품 코드가 직전 805테스트/check/benchmark/build PASS 시점과 동일하다. 해당 검사들은 이번 영수증 갱신에서 반복 실행하지 않았다. 증거를 현재 실행한 새 테스트처럼 표기하지 않는다. Unity/Unreal 실앱·전문가 평가·제조 승인은 not-run이다.

## 재현·보존

로컬 실제 파일: `/Users/danny/Documents/morphloom/outputs/current-browser-040-20261004`. 공개 보고서/명령/해시: [`benchmarks/modeling-slices-20261004/current-delivery-040`](../benchmarks/modeling-slices-20261004/current-delivery-040). manifest는 현재 실제 파일 SHA와 코드 HEAD에 연결한다. 큰 원본·재export·G-code·정적 파일은 로컬에 보존하고, Git에는 작은 보고서·로그·해시를 보존한다. 이전 자료는 `previous-*`이며 현재 성공 근거로 사용하지 않는다.

실제 명령은 `commands.json`을 따른다. export-cross-domain-fixtures → blender-cross-domain-benchmark / blender-cross-domain-edit-benchmark / godot-cross-domain-benchmark / prusaslicer-print-benchmark와 실제 browser static 다운로드 → blender-static-mesh-audit → static-delivery-benchmark를 실행했다. 외부 모델·유료 서비스 호출은 없다. Blender는 `--threads 1` 기존 프로필을 사용한다.

원본 `/Users/danny/Documents/morphloom`의 사용자 수정된 두 pinned Blender 보고서는 덮어쓰지 않는다. 다른 파일도 HEAD 기준 바이트 대응이 확인된 경우만 반영한다. 원본 git index의 dataless 문제를 삭제·재생성하지 않는다.

## 다음 확인할 실제 결함

competitive의 별도 `blender-roundtrip-latest.json` 단일 보고서는 2026-09-02 관측 자료인데 current compiler/source 대응 검사 없이 수락된다. 이번 현재 실행의 성공 증거로 이 자료를 쓰지 않았다. 다음 단계는 이 오래된 단일 보고서의 수락을 최소 실패 사례로 재현하고, 현재 입력/실제 파일 대응 없이는 수락하지 않도록 기존 검증 계약을 확장하는 것이다. 전체 Goal은 active다.
