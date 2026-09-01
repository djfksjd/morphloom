<div align="center">

# MORPHLOOM

### Editable local 3D assets with Codex or Claude

[한국어](./README.md) · [English](./README.en.md)

[![License](https://img.shields.io/badge/license-Apache--2.0-335cff?style=flat-square)](./LICENSE)
![Tests](https://img.shields.io/badge/tests-117%20passing-28a879?style=flat-square)
![Three.js](https://img.shields.io/badge/Three.js-r179-111111?style=flat-square)
![Benchmark](https://img.shields.io/badge/locked%20benchmark-100%25-28a879?style=flat-square)

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

To prepare a photo-conditioned surface:

```bash
npm run surface:prepare -- --input ./reference.png --output ./outputs/surface.json
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
- Decluttered architectural dimension overlay that suppresses repeated small hardware
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
| STL | Fusion 360 and 3D-printing mesh reference |
| SVG | 2D Figma part-envelope review sheet |
| PNG | Current viewport capture |
| ZIP | GLB, OBJ/STL/PLY, IR, quality report, and preview |

OBJ and STL are not STEP/BREP manufacturing solids. Native `.blend`, `.uasset`, and FBX files require conversion in the target application.

## Included examples

| Domain | Examples |
|---|---|
| Product | 164-part smartphone · Galaxy Z Fold8 exterior · ornate blade |
| Surface | Asphalt with real displaced angular coarse/fine aggregate and binder troughs |
| Electronics | TEC cooling assembly with 75 conductors and 150 physical ports |
| Architecture | Measured HABS cabin · nine-unit apartment floor · editable two-storey concept residence |
| Character | Human base with a real 49-bone skeleton (30 finger bones), hand-geometry-derived skin weights, four GLB animation tracks, a real skinned LOD1, and collision primitives · posed Web Hero |

Product and architecture accuracy improves with measured drawings and datasheets. Characters currently target game previs and editable post-production bases.

## Quality gate

```bash
npm test
npm run quality:gate
npm run benchmark:competitive
npm run build
```

Current locked benchmark:

- Overall pass: **100% (8/8)**
- Technical integrity: **100% (8/8)**
- Release/block decision accuracy: **100% (8/8)**
- Release-intended model and browser GLB: **100% (5/5)**
- Insufficient-evidence rejection safety: **100% (3/3)**

This means all eight locked contracts made the correct decision; it does not mean every possible input has perfect visual quality. Release cases now cover industrial design, drawing-based architecture, animation, games, and 3D printing. The concept residence, cooling assembly, and single-view character remain correctly blocked when evidence is insufficient.

| Semi-professional delivery contract | Score | Blocking evidence |
|---|---:|---|
| Industrial design | 99 | closed topology · UV · at least 75% PBR micro-surface · evidence |
| Architecture | 98 | verified plan · closed shell · at least 80% micro-surface · drawing/measurement evidence |
| Animation | 99 | 49-bone skeleton · normalized weights · measured joint deformation · real finger weights/tracks · GLB reopen |
| Game | 100 | 100k-triangle budget · real skinned LOD0/1 · collision primitives · UV/normals · PBR |
| 3D print | 100 | closed mesh · millimetres · declared feature ≥0.8 mm · positive volume · measured 45° overhang |

Morphloom measures generally unsupported 45° overhang area from real triangle normals. Final orientation, supports, shrinkage, and tolerances still depend on the target printer and slicer, so it does not auto-approve manufacturing suitability.

Before generation, Morphloom locks detail, material, proof-view, and per-feature acceptance requirements, then enforces regression, repeated-defect, and cost ceilings across eight review passes.

With two or more compatible orthographic silhouettes, Morphloom now carves a welded, closed visual hull. It also aligns reference/render foreground bounds for banded interior checks and compares material colour, luminance, microstructure, and directional response separately. These implementations adapt and modify strong Apache-2.0 img2threejs components for bounded TypeScript execution; provenance and modifications are recorded in [`NOTICE`](./NOTICE).

Details: [`benchmarks/quality-latest.json`](./benchmarks/quality-latest.json) · [benchmark policy](./benchmarks/README.md) · [verified img2threejs comparison](./docs/COMPETITIVE_BENCHMARK.md)

We also ran a real same-input Talon comparison. Morphloom aligns the admitted front image across independently editable parts and derives aligned normal and roughness maps from its local pixels. Its blade is a real closed wedge rather than a cosmetic tube: all 14 cutting-edge segments traced through 15 contour points are measured at no more than 0.12 mm. The case has 25 named parts, zero boundary/non-manifold edges or degenerate triangles, and 0.000 mm GLB round-trip drift. This establishes the inspected material response, editability, and delivery checks; it does not infer unseen depth or rear geometry from one photograph.

Rough surfaces are not colour noise alone. `surfacePatch` builds a closed mesh with macro relief, two deterministic sizes of angular aggregate, and binder troughs, then produces albedo, normal, and roughness maps from the same aggregate rule. The asphalt regression sample contains 6,959 aggregate features and 111,936 triangles, with 0.98 mm RMS height, 6.20 mm peak-to-valley relief, and zero boundary/non-manifold edges or degenerate triangles. These are procedural regression values, not measurements of a particular road.

The photo-conditioned asphalt audit records the supplied 508×660 PNG SHA-256 and 0.952 irregularity, then combines a 99×128 (12,672-sample) height field with 13,229 procedural aggregate features. The result has 124,616 triangles, 0.59 mm RMS height, 4.64 mm peak-to-valley relief, one of one closed meshes, and 0.000 mm bounds drift after GLB reopen. Image-derived height is not a scan, so site-specific materials still require calibrated height or scan evidence. See [`benchmarks/asphalt-reference-latest.json`](./benchmarks/asphalt-reference-latest.json).

## Current limits

- One photograph cannot measure hidden geometry, exact thickness, or the rear surface.
- The human base includes 30 finger bones with actual weighted hand vertices, but facial rigging, expression blendshapes, finger collision/muscle deformation, and cloth physics are not finished.
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
