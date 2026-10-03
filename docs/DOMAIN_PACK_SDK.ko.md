# Domain Pack SDK — 첫 슬라이스

로컬에서 신뢰하고 import한 TypeScript 코드만 등록합니다. 업로드한 스크립트를 실행하거나 `eval`하지 않습니다. 팩은 버전에 맞는 `morphloom.elements/0.1` 또는 `0.2` 프로젝트를 생성하며 기존 편집기·렌더러가 이를 처리합니다. 범용 기계 CAD나 종간 조립 계약이 아닙니다.

```ts
import { createElementDomainRegistry } from './src/engine/element-domain-packs.js';
import { minimalPack } from './examples/domain-packs/minimal-pack.js';

const registry = createElementDomainRegistry(); // 실험적 bird, fur 포함
registry.register(minimalPack);
const choices = registry.list(); // 선택 UI의 항목; 메타데이터 복사본
const project = registry.generate('bearing.ball.preview',
  { seed: 42, diameterMm: 8, units: 'mm', coordinates: 'right-handed-y-up' },
  ['semantic-part-editing']);
```

`ElementEditor`는 `list()`로 예제를 나열하고 `generate(id, input, requiredCapabilities)`의 결과를 기존 프로젝트 로딩 경로에 전달할 수 있습니다. 등록은 UI 수정이나 렌더러 교체를 요구하지 않습니다. 호출은 동기식입니다.

메타데이터 버전은 `morphloom.domain-pack/0.1`, 엔진 API는 정확히 `0.1`입니다. ASCII 패키지 ID는 영숫자로 시작·끝나며 내부에 점과 하이픈을 쓸 수 있습니다. `domain`은 열린 문자열입니다. 현재 표현은 native `morphloom.elements/0.1` 하나뿐이며 mm, 오른손 좌표계·Y 위쪽을 사용합니다. 입력은 최대 10개 키의 평범한 객체입니다. seed는 0 이상의 안전한 정수이고 선언된 치수 범위를 지켜야 합니다. 요청한 기능은 **한 팩이 모두** 제공해야 하며 대체 기능으로 묵시적으로 낮추지 않습니다.

생성 결과는 `validateProject`와 256 parts / 5000 elements 한도를 통과해야 합니다. 등록 메타데이터, 입력, 결과는 복사해 참조를 분리합니다. 공급자 예외의 내부 메시지는 `DomainPackError('provider-error', id)`로 감춥니다. 하지만 동기 호출의 무한 루프나 악성 로컬 코드를 격리·중단하지는 못합니다.

기존 generic inspector만 도구로 선언합니다. 임의 React 콜백을 받지 않습니다. `source-json`은 편집 가능한 원본이고 `baked-glb`는 구운 결과만 제공합니다. 선택 장면 내보내기와 닫힌 ellipsoid의 GLB 렌더링은 기존 경로를 사용합니다. `compileAssemblyIR`은 변경하지 않습니다. NURBS, 곡선, 물리, 제조 정확도, 팩 간 프로젝트 합성 및 추가 export adapter는 현재 지원을 주장하지 않습니다. `bearing.ball.preview`는 구형 시각화 예제이지 정확한 베어링 내부 조립 모델이 아닙니다.


## 0.2 추가 계약

위 0.1 Pack과 엔진 API는 유지한다. 새 `mechanical.bearing.visual`은 `morphloom.domain-pack/0.2`, engineApi `0.2`, native representation `morphloom.elements/0.2`를 함께 선언한다. 실제 생성 schema가 선언과 다르면 `invalid-project`로 거부한다. 선택적 `parameterNotes`는 최대 8개·각 256문자로 입력 간 관계를 UI에 노출한다. 불가능한 볼 packing은 typed `invalid-input`이며 임의 provider 예외의 내부 메시지는 계속 숨긴다.

0.2 `assembly-geometry`는 bounded sphere/closed lathe/simple extrude를 기존 assembly compiler로 생성한다. geometry/material/assemblyId/home.assemblyId는 0.2에서만 허용한다. 기하 치수는 mm이고 이 부품의 scale은 배율이다. assemblies는 identity datum·normalized axis만 제공한다. 런타임 validator는 Schema 외에 profile 교차·닫힘, hole 관계, 소속 참조를 검사한다. 중첩 transform·구속 solver는 지원하지 않는다.

`migrateElementProject(project)`는 0.1 원본을 변경하지 않고 0.2 복사본을 만든다. parse는 암묵적 migration을 하지 않는다. 0.2 serialize는 객체 키를 정렬하고 배열 순서를 유지한다. GLB에서 절차 geometry를 복원할 수 없으므로 companion JSON을 보관한다.

예제는 `src/engine/bearing-pack.ts`, 적합성 검사는 `tests/bearing-pack.test.ts`, 현재 증거는 [베어링 기록](BEARING_SLICE_STATUS.ko.md)이다. 제조·물리·전 분야 검증 상태를 올리지 않는다.

## Source 보존 workspace

`generateWorkspaceAsset(registry, request)`는 instance ID, packId, input, requiredCapabilities, positionMm, rotationRad을 선언해 현재 registry의 실제 capability를 검사한다. `appendWorkspaceAsset`는 원본 source IR을 복사해 `morphloom.workspace/0.1`에 담는다. global seed로 덮어쓰거나 생성 ID를 renumber하지 않는다. `buildWorkspaceScene`에서만 datum을 적용하고 이름을 `assetId::localId`로 scope한다. source의 generated group seed·override·분리 복원 데이터는 유지한다. source를 다른 표현으로 변환하거나 단위/좌표를 추측하는 adapter는 없다.

`schemas/element-workspace.schema.json`과 `tests/element-workspace.test.ts`가 최소 계약·conformance 예제다. `/?editor=workspace`에서 같은 공통 inspector로 편집한다. 자세한 현재 지원/정보 손실/검수는 [workspace 기록](WORKSPACE_SLICE_STATUS.ko.md)을 따른다. 로컬 provider의 임의 코드/무한 루프를 중단하는 sandbox는 지원하지 않는다.

## 0.3 연결 feature

mechanical.spur-gear.visual은 Pack/API/원본 표현0.3을 사용하며 기존0.1/0.2 계약은 유지한다. migrateElementProjectToV3는 명시적인 복사 migration이다. spur-gear는 moduleMm, toothCount, pressureAngleDeg, faceWidthMm, boreDiameterMm과 bounded toothOverrides를 받는다. raw extrude256점 제한은 유지하고 엔진의 파생 gear profile만8192점으로 제한한다.

connected-feature-editing/diagnostic-feature-extraction은 공통 편집기와 실제 GLB 경로로 연결된다. spur_gear/tooth_0003은 연결 feature이며 추출 sector는 실제 분리 부품이 아니다. undercut 위험·bore·feature ID·버전·capability 오류는 거부한다. 제조 capability는 등록하지 않았다. 구현은 src/engine/gear-pack.ts, 적합성 검사는 tests/spur-gear.test.ts, 증거는 SPUR_GEAR_SLICE_STATUS.ko.md를 따른다.

## Static UV 검사

공통 UV quality 패널/내보내기 보고서는 native static mesh를 실제 측정한다. provider가 등록됐다는 이유로 UV 검증을 통과시키지 않는다. 기존 aggregate gate를 유지하고 per-mesh/연결 tooth 결과를 별도로 표시한다. source/output SHA256이 있는 receipt0.1은 원본 IR을 바꾸지 않는다. Native uvMapping extras는 상관 선언이며 인증/texture 승인이 아니다. actual overlap이 불완전하면 unknown이다. Instanced/skinned pose, atlas/padding/shared-texture cross-mesh 검증은 not-run/blocked다. UV_QUALITY_STATUS.ko.md의 현재 증거와 제한을 따른다.

## 편집 원본0.4와 native UV 연산

명시적 migrateElementProjectToV4는0.1/0.2/0.3 source를 복사하고 UV 기본값을 삽입하지 않는다. Part.uvScale은0.001..1000의 단위 없는 native UV multiplier다. 기존 Pack/API0.1/0.2/0.3 generation 계약을 유지하며 registry0.4 등록 지원은 선언하지 않는다. workspace source schema는0.4를 허용한다. 선언형 UV 연산은 engine이 실제 matching finite UV를 확인해 적용한다. synthetic checker는 별도 diagnostic appearance이며 source PBR를 일반 export에서 보존한다. UV_SCALE_STATUS.ko.md의 actual byte/Blender evidence를 따른다.

## 편집 원본0.5 chamfer

migrateElementProjectToV5는 modifier 기본값을 넣지 않는다. Part.axialChamferMm은 현재 spur-gear에만 제공되며 범위·root wall·실제 topology를 검사하고 atomic edit 실패를 반환한다. 생성 Pack/API0.3 계약은 그대로이며 registry0.5 선언은 지원하지 않는다. generic workspace source는0.5를 보존한다. Native source-backed gear의 엔진 파생 curve8192 경로는 raw AssemblyIR4096 guard의 대체가 아니다. Chamfered connected feature sector extraction은 unsupported를 명시한다. GEAR_CHAMFER_STATUS.ko.md의 현재 evidence를 따른다.

## 편집 원본0.6 표면

migrateElementProjectToV6는 기본값을 넣지 않는다. material.surface는 roughness-only3종 metal appearance·repeat0.125..1024의 선언형 계약이다. 생성 Pack/API 등록 지원을0.6으로 확대했다고 선언하지 않는다. generic workspace source는0.6을 보존하며 공유 inspector로 편집한다. PART_SURFACE_STATUS.ko.md의 actual RGBA/GLB/Blender 증거와 미지원 채널을 따른다.

## 실제 texel density

UV quality report0.2는 지원 가능한 static UV0의 metallic-roughness 해상도·texture matrix로 texels/mm를 측정한다. 등록된 Pack의 품질 승인 상태를 자동 올리지 않는다. 여러 material/미로드 이미지/다른UV channel은 not-run이며 feature 누락은 평균으로 숨기지 않는다. TEXEL_DENSITY_STATUS.ko.md와 actual GLB receipt를 따른다.

## API0.4: Pack API와 원본 표현 분리

기존0.1~0.3 Pack의 계약은 유지한다. 새 metadata.version0.4 / dependencies.engineApi0.4는 native representation.id를 지원 중인 elements0.1~0.6 중 명시적으로 선언한다. 실제 generator 결과 schema가 달라지면 invalid-project다. 알려지지 않은 API/schema·다른 단위/좌표·필수 capability 누락·provider 오류를 typed 오류로 거부한다. 자동 migration이나 유사 capability 대체는 없다. 등록은 여전히 experimental이다.

신규 Pack은 examples/domain-packs/surface-gear-pack.ts를 복사해 고유ID/domain/입력범위/capability를 선언하고 registry.register(pack)로 등록한다. core compiler/inspector를 바꿀 필요는 없다. UI 진입점 두 곳의 로컬 registry 등록은 필요하며 동적 파일 로딩·외부코드 sandbox는 지원하지 않는다. 예제는 기존 gear generator에 명시적 migrateElementProjectToV6·editPart uvScale/material.surface를 조합한다. metadata를0.4로 바꾸는 것만으로 원본 IR을 migration한 것으로 간주하지 않는다.

스키마: schemas/domain-pack-v4.schema.json; 타입/실행 경계: src/engine/element-domain-packs.ts; conformance: tests/domain-pack-v4.test.ts; 생성/공통편집/혼합/실제GLB/Blender 증거와 미지원 범위: DOMAIN_PACK_V4_STATUS.ko.md. JSON Schema만으로 bounds 관계·clone 가능성·실행 출력·품질을 승인할 수 없다. 기존 source-json/full와 GLB/baked-only 의미를 유지한다.


## 직접 generator 입력 경계 (2026-10-03)

validateDomainPackInput(input, metadata)는 registry의 기존 단위/좌표/seed/유한값/치수범위/plain-record 검사를 그대로 재사용한다. 성공 반환은 input 자체이며 수정/단위추측/기본값삽입을 하지 않는다. metadata는 등록 검사를 통과한 선언 계약이어야 한다. 임의 metadata의 스키마 검증이나 provider 실행 격리를 대체하지 않는다. 실패는 DomainPackError invalid-input/packId. builtin bearing의 직접 함수도 이 경계를 사용해 null을 기본값으로 바꾸지 않는다. 누락필드만 기존 generator 기본값을 적용한다. 예전 registry 경로와 source schema/version은 그대로이며, 과거 잘못 허용한 범위 밖 직접 호출은 이제 오류다. 전체 SDK가 CAD/비메시/동적 플러그인 sandbox를 지원한다는 뜻은 아니다.
