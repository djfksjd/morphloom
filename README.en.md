<div align="center">

# MORPHLOOM

### Editable local 3D assets with Codex or Claude

[한국어](./README.md) · [English](./README.en.md)

[![License](https://img.shields.io/badge/license-Apache--2.0-335cff?style=flat-square)](./LICENSE)
![Tests](https://img.shields.io/badge/tests-88%20passing-28a879?style=flat-square)
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
| Electronics | TEC cooling assembly with 75 conductors and 150 physical ports |
| Architecture | Measured HABS cabin · nine-unit apartment floor · editable two-storey concept residence |
| Character | 14,517-vertex human base · posed Web Hero |

Product and architecture accuracy improves with measured drawings and datasheets. Characters currently target game previs and editable post-production bases.

## Quality gate

```bash
npm test
npm run quality:gate
npm run benchmark:competitive
npm run build
```

Current locked benchmark:

- Overall pass: **100% (5/5)**
- Technical integrity: **100% (5/5)**
- Release/block decision accuracy: **100% (5/5)**
- Release-intended model and browser GLB: **100% (2/2)**
- Insufficient-evidence rejection safety: **100% (3/3)**

This does not mean every generated asset is a finished deliverable. Model completeness and source confidence are separate. The ornate blade and verified architectural shell are positive release cases. The concept residence, cooling assembly, and single-view character are technical passes that are correctly blocked for insufficient evidence.

Before generation, Morphloom locks detail, material, proof-view, and per-feature acceptance requirements, then enforces regression, repeated-defect, and cost ceilings across eight review passes.

With two or more compatible orthographic silhouettes, Morphloom now carves a welded, closed visual hull. It also aligns reference/render foreground bounds for banded interior checks and compares material colour, luminance, microstructure, and directional response separately. These implementations adapt and modify strong Apache-2.0 img2threejs components for bounded TypeScript execution; provenance and modifications are recorded in [`NOTICE`](./NOTICE).

Details: [`benchmarks/quality-latest.json`](./benchmarks/quality-latest.json) · [benchmark policy](./benchmarks/README.md) · [verified img2threejs comparison](./docs/COMPETITIVE_BENCHMARK.md)

We also ran a real same-input Talon comparison. Morphloom now compiles asymmetric profiles with multiple true through-holes into closed meshes; that case has 26 editable parts, zero boundary/non-manifold edges, and 0.000 mm GLB round-trip drift. img2threejs still wins the broadside photographic match because it projects the admitted source pixels. Morphloom's current advantage is semi-professional editability, inspection, and delivery—not photographic copying.

## Current limits

- One photograph cannot measure hidden geometry, exact thickness, or the rear surface.
- Identity-accurate faces, precise fingers, production skin weights, and cloth simulation are not finished.
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
