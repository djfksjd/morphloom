# PBR scalar 편집의 표면 보존

2026-10-02. PartInspector roughness/metalness handler가 material 객체를 새로 만들면서 surface를 버리는 실제 실패를 수정했다. 변경은 src/PartInspector.tsx 두 handler의 기존 material spread이며 engine editPart replacement semantics와 schema0.6은 유지했다. 두 입력만 바꿨을 때 finish/channels/repeat와 반대 PBR scalar가 유지된다.

기어·ball_0000의 실제 browser stage/cancel/apply/undo/redo/save/reload/export PASS. 기본 roughness를0.52,metalness를0.65로 수정했다. saved IR은 해당scalar 두 개 외 모든 source fields와 비대상parts가 같았다. 실제 GLB의 모든 position/normal/UV/index/node transforms/hierarchy와 비대상 PBR exact,선택 base color·surface map·repeat8 유지. 새 scalar factors는actualGLB에서0.52/0.65로 확인했다. Node에서 새IR로 생성한실제RGBA와현재GLB·Blender 왕복PNG pixels 일치. 현재2GLB Khronos errors0,2Blender reopen/bounds/geometry/image parity PASS. Bitmap은기존engine규칙으로재생성되며sourceappearance factor를실측물성으로해석하지 않는다.

check/build·전체87파일608테스트 PASS. renderer0.9와IR0.6 불변. 기존UV/standard/production/20MBguard를바꾸지 않았다. 새의존성없음. UNI_AI403/completion not-run.

실패baseline:repro-before.log의actualbrowser assertion과source fingerprint. 검수after 스크립트가같은working 파일을덮은점은보정해명시했다:reconstructed-before-source.elements.json은원래fixture+기록된edit로결정론적으로재구성한source이며실제로관측한pre-fix source SHA21e58807244cad70f9a5fe66423486021abaeb62c2368f3838e05944143c0c4d와일치했다. baseline-reconstruction.json을따른다. 원본savedfile을그대로복사했다고주장하지않는다.

증거는outputs/part-material-preservation-20261002의browser-workflow.json,file-preservation.json,pixel-expectation.json,blender/*-pixels.json,verification.json과실제gear/ball IR·GLB다. 현재UI는surface를선택한상태에서roughness/metalness를수정하고Apply·Undo/Redo·Save/Export를사용한다. 일반export gate는유효UV/실제standard검수를유지한다.

이two-handler fix는다음검증batch에묶어게시하며자잘한개별push를하지않는다. 현재main은beef8823d656fbb667462ab4fae64d6e4320c2bb. sourceoriginal index와무관변경을보존했다. 현재시점에전분야완료/실측/제조/전문가승인은없다. 후속우선순위: 기존surface cache의CPU+GPU 예산표기가실제payload accounting과일치하는지측정한다.
