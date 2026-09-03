<div align="center">

# MORPHLOOM

### Editable local 3D assets with Codex or Claude

[한국어](./README.md) · [English](./README.en.md)

[![License](https://img.shields.io/badge/license-Apache--2.0-335cff?style=flat-square)](./LICENSE)
![Tests](https://img.shields.io/badge/tests-478%20passing-28a879?style=flat-square)
![Three.js](https://img.shields.io/badge/Three.js-r179-111111?style=flat-square)
![Benchmark](https://img.shields.io/badge/model%20gate-100%25-28a879?style=flat-square)

</div>

Morphloom turns photographs, drawings, measurements, datasheets, and natural-language requirements into `CharacterIR` or `AssemblyIR`, then compiles them into Three.js meshes.

It uses **Codex or Claude alone**, without a dedicated text-to-3D model such as Meshy. Results are reviewed locally and exported to common 3D formats.

> `v0.4 alpha` targets semi-professional editable bases. It does not replace manufacturing CAD approval, human scanning, structural engineering, or electrical safety validation.

## How it works

```text
images · drawings · dimensions · datasheets · language
                         ↓ Codex / Claude
              CharacterIR / AssemblyIR
                         ↓ Morphloom
          meshes · PBR surfaces · parts · wiring
                         ↓
             local review · measure · export
```

- Give generation instructions in a Codex or Claude development conversation.
- The local website is a **result reviewer**, not a generation form.
- There is no fixed photograph count. The evidence only needs to resolve the required shape, scale, and surface.
- Unsupported claims remain `estimated` or `inferred` instead of being silently accepted.

## Quick start

Requirement: Node.js 20.19 or newer.

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:4173](http://127.0.0.1:4173).

Open a specific result directly with `?asset=cooler` or `?asset=laurel-homes`, which is convenient for CLI handoff.

Real runs use the fixed [`morphloom.job/0.1`](./schemas/morphloom-job.schema.json) JSON contract instead of model-authored generator scripts.

```bash
npm run morphloom -- inspect --job work/job.json
npm run morphloom -- build --job work/job.json --out outputs/run-001
```

Every input is bound to an actual workspace file and SHA-256. The engine verifies the bytes, size, format, decoded image dimensions, measurement provenance, two-run GLB determinism, Khronos validation, and an independent reopen. `review-pass` is review-only; a delivery candidate requires both `delivery-pass` and `releaseAllowed: true`.

To prepare a photo-conditioned surface:

```bash
npm run surface:prepare -- --input ./reference.jpg --output ./outputs/surface.json
```

Open the generated JSON with `OPEN RESULT` in the local viewer. The source image is never uploaded. Albedo projection, normal, roughness, and a photo-conditioned height field of up to 16,384 samples stay aligned in one assembly coordinate system.

Example Codex/Claude request:

```text
Build an AssemblyIR from these product drawings and photographs.
Keep measured and estimated values separate, then validate part names,
PBR surfaces, wiring connectivity, and topology.
```

## Local viewer

- Beauty, Clay, Wire, and X-Ray modes
- Front, isometric, plan/top, and rear views
- Drag to orbit, wheel optical zoom, and `Space`+drag panning
- Bottom-right `+`/`−` zoom and view reset without cross-section clipping
- Collapsible right inspector and bottom pipeline panels
- Move, rotate, and reset existing furniture in 250 mm increments
- Storey filters plus day/night lighting previews
- Arbitrary two-point distance plus width, depth, and vertical-height dimension lines in `mm`, `cm`, or `m`
- Scale-aware dimension overlays with bounded label counts, sizes, and spacing
- Automatic GLB round-trip validation starts after the initial viewer controls become usable
- GLB reopen checks for bounds, triangles, and named nodes
- Visible evidence boundaries and quality blockers
- Local job cancellation, retry, and save actions

## Export formats

| Format | Main use |
|---|---|
| GLB | Blender · Unity · Unreal · Godot · web |
| OBJ | General mesh exchange with Maya · 3ds Max · Cinema 4D |
| PLY | Blender · MeshLab · CloudCompare |
| USDZ | Apple AR Quick Look · Reality Composer |
| STL (mm, Z-up coordinates) | Fusion 360 and 3D-printing mesh reference |
| SVG | 2D Figma part-envelope review sheet |
| PNG | Transparent current render without UI, floor, or measurement helpers |
| ZIP | GLB, OBJ/STL/PLY, IR, quality report, and preview |

Before download, GLB is reopened with Khronos, glTF Transform, and Three.js; OBJ/STL/PLY are reopened with their matching loaders. STL stores explicit millimetre-valued, slicer-Z-up coordinates. The current 0.31.0 asphalt pack was downloaded from the real browser and its 111,936-triangle OBJ, STL, and PLY files were independently reopened in Blender 5.2.1 with 0.000031 mm maximum normalized envelope drift; Apple `usdchecker` also accepted the USDZ. The competitive gate now binds this proof to the matching current browser input fingerprint and release-ready receipt instead of a hard-coded asset name. Unsupported texture payloads fail closed. [Static delivery results](./benchmarks/static-delivery-latest.json) are published.

OBJ/STL are not STEP/BREP manufacturing solids, and GLB remains authoritative for PBR, rigs, and animation. Native `.blend`, `.uasset`, and FBX files require target-app conversion. Blender 5.2.1 and Godot 4.7.2 passed the five-domain GLB round trip. Godot also remeasured 165,888 imported asphalt vertices: 0.978816 mm RMS and 6.200254 mm peak-to-valley relief, within 0.000095 mm of the source GLB. PrusaSlicer 2.9.6 reopened the 111,936-facet asphalt STL as one Z-up manifold part and generated 43 toolpath layers. Unity is blocked by local licensing initialization; Unreal import is not yet proven.

## Included examples

| Domain | Examples |
|---|---|
| Product | 164-part smartphone · Galaxy Z Fold8 exterior · ornate blade |
| Surface | Asphalt with real displaced angular coarse/fine aggregate and binder troughs |
| Electronics | TEC cooling assembly with 75 conductors and 150 physical ports |
| Architecture | Measured HABS cabin · nine-unit apartment floor · editable two-storey concept residence |
| Character | Human base with a real 49-bone skeleton (30 finger bones), hand-geometry-derived skin weights, 22 idle/locomotion/turn/stance/airborne/gesture/interaction clips with 185 tracks, a real skinned LOD1, and a 16-part pose-aligned collision rig · posed Web Hero |

Product and architecture accuracy improves with measured drawings and datasheets. Characters currently target game previs and editable post-production bases.

## Quality gate

```bash
npm test
npm run quality:gate
npm run benchmark:competitive
npm run benchmark:visual-set -- --manifest captures/manifest.json --output benchmarks/visual-set-latest.json --require-claim
npm run benchmark:neutral-render -- candidate.glb candidate-front.png candidate-front.json front
npm run benchmark:neutral-audit -- --morphloom morphloom-front.json,morphloom-rear.json --competitor competitor-front.json,competitor-rear.json --output benchmarks/neutral-latest.json
npm run benchmark:fixtures -- /tmp/morphloom-fixtures
npm run benchmark:blender-cross-domain -- /tmp/morphloom-fixtures
npm run benchmark:unity-cross-domain -- /tmp/morphloom-fixtures
npm run benchmark:godot-cross-domain -- /tmp/morphloom-fixtures
npm run benchmark:prusaslicer -- /tmp/morphloom-fixtures
npm run benchmark:static-delivery -- --asset-id asphalt-surface --asset-pack asset.zip --obj-file result.obj --obj-report obj.json --stl-file result.stl --stl-report stl.json --ply-file result.ply --ply-report ply.json --usdz-file result.usdz --output benchmarks/static-delivery-latest.json
npm run benchmark:ground-truth -- --require-pass
npm run benchmark:abo-scale -- --require-pass
npm run benchmark:abo-hull
npm run benchmark:abo-semantic-lamp
npm run benchmark:dominance
npm run build
```

Current locked benchmark:

- Overall, technical, and decision pass rates: **100% (9/9)**
- Release model and browser delivery rates: **100% (6/6)**
- Safe rejection of insufficient evidence: **100% (3/3)**
- Actual browser GLB receipts: **100% (7/7), zero console errors or warnings**
- Blender isolated partial-edit and reopen receipts: **100% (5/5)**

The current partial-edit suite moves one named building window, knife ornament, USB-C connector, and separate hair mesh, plus applies a bounded asphalt relief edit. Two Blender reopen cycles preserve non-target geometry, UVs, PBR material assignments, hierarchy, and the character rig/animation payload; every final GLB passes Khronos with zero errors, warnings, or infos.

The seven browser receipts cover industrial design, measured/concept architecture, an electromechanical assembly, character previs, animation/game delivery, and a 3D-print surface. One asphalt receipt is deliberately reused to evaluate separate 3D-print and surface-delivery contracts for the same artifact. Three score-59 cases are intentional evidence rejections rather than technical failures. Texture pixels, samplers, and PBR/optical semantics must survive an actual GLB reopen. Browser-versus-Node colour conversion, script ordering, and wire-curve floating-point differences are normalized deterministically. These rates describe nine locked technical contracts, not independent blind comparisons or perfect visual quality for arbitrary input.

The external ABO pilot covers three cases, 18 assets, and two multi-view scale inferences. The semantic lamp passes its ground-truth GLB audit. The fan case delivers 101 editable parts plus deterministic Khronos-valid GLB reopen, but its four-view silhouette and ground-truth shape gates still block release. After separating a rigid capture-pose residual, its minimum whole-silhouette, primary-mass, and thin-feature scores are 0.597, 0.674, and 0.710; the 4,096-point shape audit reports 4.15% maximum dimension error, 0.0560 RMS Chamfer, 0.1162 P95 distance, and 54.1% coverage. Locked-coordinate missing/excess localization reports 0.742 minimum recall and 0.562 minimum precision. Even when semantic ablation is paired with those residual regions, an automatic 3D partial edit is withheld unless two distinct orthographic views have verified absolute pose, intrinsics, and pixel scale. When those contracts are verified, screen displacement is solved into a metric world vector and 50%, 75%, and 100% candidates are evaluated independently from the immutable source. The selected residual reaches 80° and is not independently measured, so it remains a diagnostic rather than camera or delivery evidence. The fan remains `productionReady: false`, and global superiority is not claimed.

| Semi-professional delivery contract | Score | Blocking evidence |
|---|---:|---|
| Industrial design | 99 | closed topology · evidence-bound dimensions plus hole/pin/lens/connector pitch remeasurement · UV/normals · at least 75% PBR micro-surface · evidence |
| Architecture | 99 | projected plan/void audit · world-space remeasurement of evidence-bound dimensions · closed shell · finite/non-degenerate UV · at least 80% micro-surface · drawing/measurement evidence |
| Electronics assembly | 94, physical release blocked | 75/75 conductors · 150/150 required ports · 100% pin/gauge/verification documentation · live anchors · endpoint error ≤0.05 mm · topology/UV/normals/PBR · inferred parts or pending bench work block release |
| Animation | 100 | 49-bone skeleton · normalized weights · measured joint deformation · 22 motions/185 tracks · finger weights/19 tracks · loop/in-place/semantic GLB preservation |
| Game | 100 | 100k-triangle budget · real skinned LOD0/1 · 22 locomotion/jump/gesture/interaction clips · 16-part pose-aligned collision rig · UV/normals · PBR |
| 3D print | 100 | closed mesh · millimetres · declared/global thickness ≥0.8 mm · connected-shell local wall rays ≥0.8 mm · positive volume · measured 45° overhang |

Global `2V/A` and triangle-order sampling can both hide a tiny thin shell, tab, or rib beside a dense body. Policy `morphloom-domain-readiness/0.14.0` welds UV-seam vertices at a 0.001 mm tolerance, separates edge-connected shells, and reserves ±X/±Y/±Z face probes for every shell. Remaining probes use deterministic farthest-point selection in a six-dimensional centroid-plus-normal feature space, so a low-triangle but spatially distinct feature is represented; each ray intersects only its own shell. Defaults are bounded at 256 meshes, 500,000 collected triangles, 500,000 welded vertices, one million connected edges, 96 rays per mesh, and 24 million triangle tests. A shell, memory, hit, volume, or test budget shortage fails closed. The engine now detects both a detached 12-triangle 0.3 mm shell beside a 19,200-triangle body and a 0.3 mm tab attached to one closed dense solid, including after arbitrary three-axis rotation. The broader asphalt sampling passes one connected shell and 96/96 rays with a 3.499 mm minimum and 17.683 mm fifth percentile. This decision revision remains separate from compiler bytes, so gate-only changes do not invalidate browser round-trip evidence.

Morphloom measures generally unsupported 45° overhang area from real triangle normals. Final orientation, supports, shrinkage, and tolerances still depend on the target printer and slicer, so it does not auto-approve manufacturing suitability.

Before generation, Morphloom locks detail, material, proof-view, and per-feature acceptance requirements, then enforces regression, repeated-defect, and cost ceilings across eight review passes. Cross-engine renders also lock canvas, pixel ratio, colour space, tone mapping, exposure, background, shadows, and lighting/environment hashes into one canonical protocol. Browser receipts bind that protocol to the actual PNG, scene, camera, reference, and renderer version. The reference and both candidates are downsampled from the same full canvas, so per-image foreground fitting cannot hide a wrong offset, scale, or framing. Renamed copies of one scoring rectangle or captures made with different settings cannot release a winner claim either.

Camera contracts store more than a reported error. Orthographic sources require at least four named 3D↔2D anchors; perspective sources require at least six non-coplanar anchors, each with an evidence reference. The engine recomputes either yaw/scale/offset or a normalized 3×4 perspective projection, then checks positive projective depth and pixel residuals for every anchor. Modifying anchor coordinates or a stored projection matrix while retaining the previous error is blocked.

Topology checks now include bounded exact triangle self-intersection tests, not only boundary, non-manifold, and degenerate counts. This gate exposed and repaired overshooting wire splines and hard pelvis/neck pose transitions. Conductors use straight runs with corner fillets, anatomical regions use continuous weights, and a meshoptimizer index-only LOD is admitted only when topology, skin attributes, and silhouette preservation all pass.

With two or more compatible orthographic silhouettes, Morphloom carves a welded, closed visual hull and reprojects it into every source view for an explicit fit audit. Organic blockouts and continuous forms use an editable `implicitSurface` graph with smooth-union/subtract/intersect operations and Surface Nets; ambiguous cells receive at most four deterministic resolution refinements, then fail closed if the mesh is still non-manifold. Morphloom also aligns reference/render foreground bounds for banded interior checks and compares material colour, luminance, fine/medium/coarse-scale contrast, gradient orientation, periodicity, and irregularity separately. When the reference contains spatial PBR variation, constants and generic procedural noise cannot replace it: the delivered GLB must show real variation with `reference` or `measured` provenance, weighted by visible surface area and bound to a locked input SHA-256. This verifies delivered response and provenance, not calibrated BRDF values. These implementations adapt and modify strong Apache-2.0 img2threejs components for bounded TypeScript execution; provenance and modifications are recorded in [`NOTICE`](./NOTICE).

Drawing-based architecture does not trust a `planFootprintVerified` flag alone. It projects the compiled top surface back into source-derived occupied and protected-void regions, then measures IoU, overbuild, underbuild, and void intrusion. Strong written dimensions are separately locked to the assembly or a named component and re-measured from final world-space X/Y/Z bounds as size/min/max/center. Rotated blades, raked members, and brackets can use their component-local length, width, or thickness instead of an inflated world AABB. Two component-local datum points can also lock the transformed X/Y/Z or spatial pitch between hole, pin, lens, and connector centres; each datum must remain within its compiled part bounds. A correct plan with a wrong storey, opening, sill, slab, parapet, roof datum, or interface pitch is therefore blocked. The audit fingerprint must survive GLB reopening. Laurel's undimensioned 2700 mm cutaway height remains explicitly estimated and is not promoted into a measured contract.

Details: [`benchmarks/quality-latest.json`](./benchmarks/quality-latest.json) · [benchmark policy](./benchmarks/README.md) · [multi-view capture format](./docs/VISUAL_CAPTURE_SET.md) · [verified img2threejs comparison](./docs/COMPETITIVE_BENCHMARK.md)

We also ran a real same-input Talon comparison. Morphloom aligns the admitted front image across independently editable parts and derives aligned normal and roughness maps from its local pixels. Its blade is a real closed wedge: all 14 cutting-edge segments are measured at no more than 0.12 mm. The case has 25 named parts, zero boundary/non-manifold edges or degenerate triangles, and 0.000 mm GLB round-trip drift. We exported both live scene GLBs and rendered front, rear, and isometric views with the same Blender 5.2.1 LTS camera, lighting, colour management, and 2.000-unit fit. The same-GLB receipt audit passed 3/3 views. Against the front reference, the neutral renders scored 0.924 versus 0.877 overall, 0.906 versus 0.783 for interior detail, and 0.885 versus 0.748 for material response; the competitor led silhouette IoU at 0.968 versus 0.948. An exploratory six-agent blind panel voted 4–1–1 for Morphloom with a 9.83-point mean advantage, but it missed the strict 6–0 and 10-point overwhelming thresholds. The one-reference case therefore remains `unproven` with `claimAllowed: false`, not a global superiority claim. See the [neutral render audit](./benchmarks/talon-neutral-render-latest.json) and [front diagnostic](./benchmarks/talon-neutral-front-latest.json).

Rough surfaces are not colour noise alone. `surfacePatch` builds a closed mesh with macro relief, two deterministic sizes of angular aggregate, and binder troughs, then produces albedo, normal, and roughness maps from the same aggregate rule. A dedicated surface gate remeasures RMS and peak-to-valley height from the delivered top-surface vertices instead of trusting metadata. Flattening the geometry while retaining the original audit and normal map, or removing only the roughness map, now blocks delivery. The asphalt regression sample contains 6,959 aggregate features and 111,936 triangles, with 0.98 mm RMS height, 6.20 mm peak-to-valley relief, and zero boundary/non-manifold edges or degenerate triangles. These are procedural regression values, not measurements of a particular road.

The photo-conditioned asphalt audit records the supplied 508×660 PNG SHA-256 and 0.873 irregularity, then combines a 99×128 (12,672-sample) height field with 13,229 procedural aggregate features. The v3 analyzer removes only bounded broad illumination and derives geometry height, normals, and roughness from the same corrected pixels. The real-photo evidence gate scores 97.84. The result has 124,616 triangles, 0.51 mm RMS height, 4.37 mm peak-to-valley relief, and one of one closed meshes. Compiler 0.30.0 also passes the Aside reopen with zero bounds drift and matching texture/material payloads. Image-derived height is not a scan, so site-specific materials still require calibrated height or scan evidence. See [`benchmarks/asphalt-reference-latest.json`](./benchmarks/asphalt-reference-latest.json).

The surface preparation CLI accepts bounded PNG, JPEG, and WebP inputs after header-level size checks.

## Current limits

- One photograph cannot measure hidden geometry, exact thickness, or the rear surface.
- The human base preserves 30 finger bones, real finger weights, and five editable facial morphs (`jaw_open`, `smile`, left/right blink, and brow raise) through GLB. Detailed FACS, viseme lip sync, identity-specific facial rigging, finger collision/muscle deformation, and cloth physics remain separate scope.
- Pose-driven garment folds and micro-normal detail are supported but do not replace a real textile scan.
- Electrical checks cover ports, physical labels, gauges, and 3D endpoints; they are not SPICE, PCB ERC, or physical continuity tests.
- Architectural results are drawing-based review shells without structural analysis, MEP, or site approval.

## Local data and privacy

- The viewer does not upload source files to an external server.
- Imported IR stays in browser memory and is removed on reload, explicit clear, or after 30 minutes.
- IR, code, and source material created in the repository are normal local files and are not deleted automatically.
- An exported asset is saved only after the user presses a save button.

## Repository map

```text
src/engine/        IR compilation, geometry, surfaces, topology, and gates
src/components/    Three.js result viewer and export tools
schemas/           CharacterIR and AssemblyIR contracts
skills/            Codex and Claude workflow guidance
benchmarks/        reproducibility, quality, and browser round-trip evidence
public/assets/     local human base pack
```

## License

Code is [Apache-2.0](./LICENSE). The bundled human base data is CC0-1.0; provenance is recorded in [`NOTICE`](./NOTICE).
