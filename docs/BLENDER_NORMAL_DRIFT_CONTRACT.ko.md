# Blender sphere normal drift 원인 분리 (2026-10-03)

016c5bd의 실제sphere split normal 왕복최대0.039980도는새corner-angle modifier와무관하게이전GLB에서도같다. 이번30분/같은결함수정2회는모델재생성이아니라actual NORMAL accessor→Blender first import→export→reimport의숫자를분리한다. 고정0.01도검수기준유지. 실제bytes/Blender loop normals·world 좌표·명명·계층을측정하고원인전에는normal을재계산하거나UV를지우지않는다.

검사자료:기존실제source/current edited/stability GLB와동일파일의import only. 원본GLB·기존receipts보존,모든새report새directory. vertex-normal측정은normal inverse-transpose와명시적BlenderZ-up↔glTFY-up변환을사용하고기존source의translation-only edit delta2mm를명시적으로제외해대응시킨다. 모든mesh의worst-normal·좌표·corner multiplicity를확인해average에가리지않는다. unsupported transform/geometry/일치불능은실패이며silently approximate하지않는다.

출력:유한한generic rawGLB/probe 측정도구·currentinput/output SHA와Blender/engine versions·실제원인·가능한수정/blocked범위. 선언형translation에만source normal보존adapter가필요하면먼저loss/eligibility/failure정책을고정한다. 임의DCC remesh나정상적인사용자normal수정을원본normal로덮지않는다. 추가API/CLIcalls0(confirmed quotas),dependency0. 이전strictFAIL을새툴성공으로치환하지않는다.

원인분리후추가20분(최대총50분)adapter 검증: 단순import_shading=FLAT은설치된importer가NORMAL읽기를끄므로4.68도FAIL이며사용하지않는다. NORMALS import/merge_vertices=False를유지한뒤exact raw POSITION/NORMAL과실제import vertex order를검증하고flat reference로원본custom NORMAL을명시적으로설정하는선택적static adapter를시험한다. geometry/UV/PBR/계층에손을대지않는다. missing NORMAL,다른vertex order/geometry,skin/morph/time,externalURI,multi-matching mesh,resourcebudget는거부한다. 기존DCChelperdefault0.2 unchanged;optional --flat-normal-reference만report0.3을사용하며새policy를명시한다. arbitrary remesh/normal edit복원은지원하지않는다. 모든mesh worst0.01도/actualKhronos/기존namedtranslation/two reopen검사 유지하며 실패시adapter 납품은blocked다.
