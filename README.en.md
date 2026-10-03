<div align="center">

<img src="./assets/brand/sceliph-hero.png" alt="SCELIPH — Shape things into existence" width="100%" />

# SCELIPH

**SHAPE THINGS INTO EXISTENCE**

### Local 3D asset generation, editing, and inspection through declarative IR

[한국어](./README.md) · [English](./README.en.md)

[![License](https://img.shields.io/badge/license-Apache--2.0-335cff?style=flat-square)](./LICENSE)
![Stage](https://img.shields.io/badge/stage-v0.4%20alpha-d69526?style=flat-square)
![Three.js](https://img.shields.io/badge/Three.js-r179-111111?style=flat-square)

</div>

Sceliph is an open-source local tool that turns photographs, drawings, measurements, and requirements into declarative IR, then generates meshes and PBR materials. A development agent such as Codex or Claude proposes structure and parameters; the engine computes geometry, patterns, and checks. The default workflow does not require a paid 3D generation API.

**This is `v0.4 alpha`. It does not guarantee accurate reconstruction from arbitrary photos, production delivery across all domains, or manufacturing CAD/BREP precision.** Passing a particular check or increasing polygon counts is not proof of overall quality.

## Current status

**Sceliph is the new name of Morphloom.** Existing `morphloom.*` schemas, pack IDs and `npm run morphloom` remain compatible.

The supplied hero image is **brand artwork**, not an engine-generated asset or quality-validation result.

Status below reflects the **2026-10-04 checkpoint**, distinguishing the translation workflow from subsequent validation fixes.

| Scope | Evidence | Limits |
|---|---|---|
| Tests/typecheck/benchmark/build | 110 files / 799 tests PASS; check, benchmark, build PASS | No arbitrary-input quality certification |
| Separate editable translated source | Small/default/large bearing and gear: 4 PASS | One embedded native source, identity parents, declared translation only |
| Actual native browser workflow | Download, fresh-session reload, repeat GLB, additional edit, Undo/Redo PASS4 | Input GLB before-edit reference metadata stays unchanged |
| Bound UV and critical features | Existing 24-tooth check and damaged-tooth FAIL retained | Unchanged 5% threshold; no aggregate substitution |
| Async invalidation | Reconstruction replacement/fault/unmount PASS6; existing delayed inspection PASS3 | Old results/downloads cannot survive a changed selection |
| Actual files | Strict validation PASS12; Blender first-import correspondence PASS4 | Raw Blender normal fidelity remains a separate FAIL |
| Overall production delivery | **Not achieved** | Current quality:gate and quality:production exit 1 at existing global receipt acceptance failures |

See [current evidence and hashes](./docs/TRANSLATED_SOURCE_STATUS.ko.md). Renderer 0.12 removes the runtime difference in corner-angle weighting; unverified older artifacts are not promoted.

Default Blender import normal drift remains. An optional source-normal importer and a single-thread benchmark profile have been verified on scoped cases. Rotated/scaled parent support has not been expanded. Existing `releaseAllowed` rules and thresholds were not weakened.

- [Latest validation fixes, 799 tests and whole-gate status](./docs/INDEPENDENT_PARSER_REJECTION_STATUS.ko.md)
- [Blender tangent determinism](./docs/BLENDER_TANGENT_DETERMINISM_STATUS.ko.md)
- [Checkpoint, modeling mathematics, and limits (Korean)](./docs/CHECKPOINT_20261003_2340.ko.md)
- [Work state (Korean)](./docs/MORPHLOOM_WORK_STATE.ko.md)
- [Bound UV status](./docs/BOUND_REFERENCE_UV_STATUS.ko.md) · [UI status](./docs/BOUND_REFERENCE_UV_UI_STATUS.ko.md)
- [Engine evidence](./benchmarks/modeling-slices-20261003/bound-reference-uv/verification.json) · [UI evidence](./benchmarks/modeling-slices-20261003/bound-reference-uv-ui/verification.json)

## Quick start

Requires Node.js **20.19 or newer**. Target-app validation requires separately installed tools such as Blender.

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:4173](http://127.0.0.1:4173). Example assets can be selected with `?asset=cooler`.

| Screen | Route | Purpose |
|---|---|---|
| Inspection viewer | `/` | Review, measure, inspect, export |
| Part/element editor | `/?editor=elements` | Domain Pack generation, ID selection, parameter edits, isolate, undo/redo, save |
| Workspace editor | `/?editor=workspace` | Per-asset editing, selection, isolate, separate editor session files |
| Visible-depth editor | `/?editor=depth` | Experimental relative-depth inspection with explicit camera and calibration data |

The web UI includes focused generation and editing workflows. It is not a general DCC or an arbitrary-prompt-to-any-object web service.

## How it works

```text
photos · drawings · measurements · requirements
                  ↓ development agent / declarative input
 CharacterIR · AssemblyIR · Elements / Workspace source
                  ↓ local engine
 parametric geometry · fields · meshes · PBR materials
                  ↓
 part edits · dimension/silhouette/topology/UV inspection
                  ↓
 source JSON + actual delivery files + reports
```

- IR preserves stable IDs, units, coordinates, and evidence. Prefer declared operations over arbitrary generated scripts.
- Geometry includes extrude, lathe, tube, limited loft/bevel, implicit surfaces, and visual hulls. This is not a complete CAD operation set or NURBS/BREP kernel.
- Gears use a constrained involute spur-gear model with module, tooth count, and pressure angle. Root geometry is approximate; manufacturing approval is out of scope.
- Bearings are authored visual assemblies with rings, grooves, pockets, and individual balls. Clearances are not manufacturer measurements or load/lifetime certification.
- A baked mesh and its procedural source are different artifacts. Arbitrary Blender edits are not automatically written back to IR.

An optional offline Distill-Any-Depth-Small worker produces relative inverse-depth evidence. It needs separately supplied weights, an environment, and measured calibration data; it is not a default dependency. It cannot establish unseen backs, interiors, or exact thickness from one photograph. See [depth surface status](./docs/DEPTH_SURFACE_STATUS.ko.md).

## Editing workflow

Open `/?editor=elements`, select a Domain Pack, and generate. Save existing edits before generating a new project.

1. Select a part or element by stable ID.
2. Apply or cancel supported numeric, geometry, and material edits.
3. Inspect with isolate and review views; compare with undo/redo.
4. Save/reopen source JSON and export selected or project GLB with reports.

Examples include gears, bearings, birds, fur, and extension packs. Tools and representations differ by pack. Registration is not delivery verification or a general assembly constraint, kinematics, or physics solver.

- [Domain Pack SDK and version contracts](./docs/DOMAIN_PACK_SDK.ko.md)
- [Workspace sessions](./docs/WORKSPACE_SESSION_STATUS.ko.md) · [isolate](./docs/WORKSPACE_ISOLATE_STATUS.ko.md)
- [Corner-angle normals and DCC limits](./docs/CORNER_NORMAL_STATUS.ko.md)

### Bound original/current GLB UV inspection

Expand **Original/current GLB UV inspection**, select original and translated files, run `Inspect bound reference UV`, and save the report. Files are read locally; the viewport project remains unchanged.

This accepts results from the [declared source-preserving translation adapter](./docs/SOURCE_SPEC_REFERENCE_STATUS.ko.md). Arbitrary DCC edits, wrong originals, and unsupported representations are rejected. Even after a UV pass, source metadata in the current GLB remains a **before-edit reference** with `currentEditableIRAvailable: false`. UV acceptance is not overall delivery approval.

The same check is available through the CLI. Use a new report path.

```bash
npx vite-node scripts/bound-reference-uv-audit.ts original.glb translated.glb new-report.json
```

## Jobs and reference surfaces

The declarative [`morphloom.job/0.1`](./schemas/morphloom-job.schema.json) contract binds local input files to SHA-256. The following paths are examples to prepare yourself.

```bash
npm run morphloom -- inspect --job work/job.json
npm run morphloom -- build --job work/job.json --out outputs/run-001
npm run surface:prepare -- --input ./reference.jpg --output ./outputs/surface.json
```

Photo-derived color, normals, roughness, and micro-height are inferred representations affected by lighting and pigmentation. They are not calibrated depth or measured material properties. Inspect evidence and execution status; `review-pass` is distinct from `delivery-pass` and `releaseAllowed: true`.

## Export and target applications

| Format | Representation and limits |
|---|---|
| GLB | Meshes, PBR, supported rigs/morphs/animation; editable IR is preserved separately as JSON |
| OBJ / PLY | Static mesh exchange; verify material/texture preservation for each format and app |
| STL | mm/Z-up mesh reference, not a manufacturing STEP/BREP solid |
| USDZ | AR exchange; unsupported surface representations require separate checks |
| SVG / PNG | 2D inspection sheets and renders |
| ZIP | Mesh/source/report bundles from supported workflows |

Export capabilities differ by workflow. Creating a file does not prove target-app compatibility. Historical Blender, Godot, and slicer cases belong to their engine versions and input hashes; they are not fresh evidence for every current asset. Unity, Unreal, and other apps are claimed only to the extent actually verified.

## Validation commands

```bash
npm run check
npm test
npm run build
npm run quality:gate
npm run quality:production
npm run gltf:validate -- path/to/asset.glb
```

Optional app checks require installed target tools. Consult [package.json](./package.json) for benchmark commands.

Tests, internal scores, and format validation do not replace independent expert review or measurements. Historical 100% results for locked fixtures are not the current production status. Evidence must match its date, engine version, inputs, outputs, and execution scope. See [benchmark policy](./benchmarks/README.md) and [comparison policy](./docs/COMPETITIVE_BENCHMARK.md).

## Known limits

- Hidden geometry from one photo is inferred; silhouettes cannot recover every concavity.
- Depth surfaces are experimental open surfaces requiring explicit camera/calibration contracts, not general delivery-approved assets.
- Characters are editing/previsualization bases; photoreal anatomy, FACS, muscle and cloth simulation are separate work.
- Electrical and architectural checks do not replace safety analysis, structural engineering, or field approval.
- PBR appearance does not establish density, strength, friction, or measured physical properties.
- Full CAD/BREP, NURBS, IFC, USD, and every representation or adapter are not claimed supported.

## Data and license

The viewer does not upload local file inputs to external servers. External model calls made separately by development agents or users require their own review. Browser memory and saved repository/download files are distinct; users manage saved local files.

Code is [Apache-2.0](./LICENSE). See [NOTICE](./NOTICE) for included data and source attribution. Optional external model code and weights have separate licenses.

### Optional Blender source-normal import

An explicit local tool tested in Blender 5.2.1 creates a source-normal-preserving `.blend` and SHA-bound receipt. It is separate from the default importer and rejects textures, rigs, animations and morphs. See [usage, limits and current evidence](docs/BLENDER_FIRST_IMPORT_STATUS.ko.md). This is not production approval or inverse reconstruction of DCC edits into IR.

The interchange repair CLI rejects overwriting sources or existing outputs. Use fresh output paths when rerunning. See [preservation contract and current file checks](docs/INTERCHANGE_OUTPUT_PRESERVATION_STATUS.ko.md).


## Brand assets

<img src="./assets/brand/sceliph-logo-light.png" alt="SCELIPH bee symbol and wordmark" width="520" />

Original supplied PNGs are preserved: [light logo](./assets/brand/sceliph-logo-light.png) · [dark outline](./assets/brand/sceliph-logo-outline-dark.png) · [symbol](./assets/brand/sceliph-symbol-dark.png) · [wordmark](./assets/brand/sceliph-wordmark-dark.png) · [hero](./assets/brand/sceliph-hero.png).

Repository: [djfksjd/sceliph](https://github.com/djfksjd/sceliph).
