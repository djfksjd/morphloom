<div align="center">

# MORPHLOOM

### A local open-source foundry that weaves images and language into editable 3D assets

**Use either Codex or Claude. No Meshy, Tripo, dedicated 3D generator, or external 3D MCP is required.**

[한국어](./README.md) · [English](./README.en.md)

[![License](https://img.shields.io/badge/license-Apache--2.0-335cff?style=flat-square)](./LICENSE)
![Tests](https://img.shields.io/badge/tests-40%20passing-28a879?style=flat-square)
![Three.js](https://img.shields.io/badge/Three.js-r179-111111?style=flat-square)
![Model weights](https://img.shields.io/badge/3D%20model%20weights-none-f05d47?style=flat-square)

</div>

---

Morphloom uses a multimodal coding agent to translate reference images and requirements into a shared `CharacterIR` or `AssemblyIR`. A deterministic Three.js engine then compiles real geometry locally. The output is not a single flattering render: it is an **editable GLB with named components, real units, materials, topology evidence, and electrical connectivity**.

> Status: `v0.4 alpha`. The target is a low-review semi-professional editable asset from sufficient mixed evidence. Morphloom does not claim to replace manufacturing CAD, human scanning, or electrical design verification.

## Verified results

| Asset | Current result |
|---|---:|
| Realistic human base | 14,517 skin vertices · 38 macro/measurement morphs |
| Single-image web hero | 48,156 tris · 139 named details · reference action pose · separate `hex-knit`/lens/web PBR |
| Smartphone exploded view | 164 independent parts · 142,480 tris · 39 camera parts · 220/220 watertight meshes |
| Smartphone wiring | 28/28 individual conductors · 56/56 required ports · 0 dangling ends |
| Smartphone surfaces | 13 PBR finishes · micro-normal on 219/220 materials · 111 anisotropic materials |
| Ornate knife | 16 parts · 18,930 tris · 16/16 watertight |
| Image-derived cooling assembly | 97 source components → 172 rendered parts · 322/322 watertight meshes · 75/75 conductors · 150/150 physical ports |
| HABS measured building plan | 17′4″ × 13′10″ shell · 116 named elements · 108,432 tris · 116/116 watertight meshes |
| HABS multifamily typical floor | documented 4 floors/36 apartments → 9-unit floor · one U-shaped recess · opposed center wing · 321 parts · 188,748 tris |
| Output | GLB · PNG · CharacterIR/AssemblyIR · physical Netlist JSON |

## Does dropping in an image immediately create 3D?

The honest answer is a two-stage pipeline:

```text
images + known dimensions
          ↓  Codex or Claude reads the visual evidence
 CharacterIR / AssemblyIR
          ↓  Morphloom local compiler
 geometry + materials + part tree + wiring + quality gates
          ↓
      GLB + PNG + IR
```

- Give images and natural-language requirements directly to **Codex or Claude in the development/CLI conversation**, not to a browser form.
- The agent does not count photographs. It reads the shape, depth, scale, surface, and relationship evidence resolved by drawings, dimensions, datasheets, scans, existing CAD, and photographs, then authors `CharacterIR` or `AssemblyIR`.
- The local web app is a result-only viewer: asset selection, Beauty/Clay/Wire/X-Ray, ISO/TOP/REAR, component inspection, two-point measurement, and export.
- No separate API key or hidden browser LLM call is required. `OPEN RESULT` exists only to inspect an AssemblyIR JSON produced from the CLI workflow.
- `CharacterIR 0.2` keeps the agent's visual judgment as data instead of discarding it as prose: body type, abdomen, chest, glutes, forward head, balance, and hand gesture become editable controls, with screen-side and anatomical-side mappings stored separately.
- Load the resulting IR through `LOAD IR`; the compiler rejects invalid topology, missing ports, incompatible signals, and floating conductors.
- OpenAI's API officially supports text/image inputs and JSON output, but the default Morphloom workflow uses the current coding agent and needs no separate API key. [Official OpenAI documentation](https://developers.openai.com/api/reference/cli/resources/responses/methods/create)

### Supplied-image regression check

The user-supplied 2038×1268 exploded electronics image and the `new-chat` engineering view are now regression inputs. `COOLER / 03` reconstructs dual TEC branches with independent monitors, MOSFET stages and thermal fuses, an open shared fan, eight NTC points, ADC/MUX/passives, and a harness carrying physical pin labels and conductor gauge. UI counts are derived directly from AssemblyIR so stale display numbers cannot diverge from the model.

| Gate | Result |
|---|---:|
| Source resolution | 2038×1268 |
| Structural components | 97 |
| Rendered parts | 172 |
| Triangles | 272,560 |
| Individual conductors | 75/75 connected |
| Required electrical ports | 150/150 connected |
| Dangling wires / open required ports | 0 / 0 |
| Ports located on owning components | 150/150 |
| Physical labels / gauges / verification records | 150/150 · 75/75 · 75/75 |
| Wire endpoints during exploded motion | live anchored · no idle rebuild |
| Physical bench gate | 6 polarity conductors · 5 required checks pending |
| Maximum terminal-center error | below 0.0001 mm |

Digital connectivity and topology pass, but hidden undersides, exact fasteners, PCB traces, and real routing cannot be measured from one exploded view and remain `inferred`. `productionReady` therefore stays `false` until continuity, polarity, and fail-safe checks pass. The source image is not redistributed because its reuse rights are unknown.

### Measured-building regression test

The public Library of Congress HABS record [Poor Coyote’s Cabin · HABS ID-75](https://www.loc.gov/resource/hhh.id0103.sheet) is the architectural-shell regression asset. The documented `17′4″ × 13′10″` footprint, `2′0″ × 2′9″` windows, and `2′6″ × 5′11″` door remain `measured/datasheet`; wall height and roof pitch missing from the plan remain `estimated`. The current build has 116 named elements, 108,432 triangles, and zero boundary, non-manifold, or degenerate edges. The architectural shell passes; structural analysis, foundation design, MEP, and site verification remain out of scope.

The complex-building regression uses the real multifamily plans for [Laurel Homes Historic District, Building B · HABS OH-2468-A](https://tile.loc.gov/storage-services/master/pnp/habshaer/oh/oh1800/oh1847/data/oh1847data.pdf). The record documents four floors, 36 apartments, nine units per floor, and three stairwells. The preset preserves the measured `139′ × 46′4″` envelope and `27′ × 17′6″` central wing. Instead of filling the plan with one rectangular slab, four named slabs form the south connector, two north-facing end wings, and the central wing projecting from the opposite south facade. This preserves the large U-shaped recess and entrance projection as real geometry. The 45 named room zones, walls, windows, balconies, and 66 stair treads remain separate elements. The 321-part, 188,748-triangle result is watertight 321/321, with 242 plan-grounded and 79 estimated vertical/detail elements. Removing `planFootprintVerified`, collapsing the slab segmentation, or putting the side and center projections on the same facade now blocks the quality gate.

This is an architectural-visualization regression for translating a real drawing into an editable spatial model. It is not yet a construction BIM, structural calculation, MEP design, code review, or as-built tolerance record.

## Quick start

```bash
npm ci
npm run dev
```

Open the printed local URL. It starts with the Laurel Homes apartment-floor result and contains no image-upload or prompt fields.

### Measure in the local viewer

1. Measurement starts enabled; buildings default to `m` and products to `mm`.
2. Pick surface point `A`, then point `B`, and verify the in-scene markers, connecting line, and dimension label.
3. Choose 3D distance or vertical height, then read the primary result and signed `ΔX/ΔY/ΔZ` in `mm`, `cm`, or `m`.
4. The result survives Beauty/Clay/Wire/X-Ray changes. A third pick starts over, `Esc` clears, and `M` toggles the tool.

The interaction follows the two-point and coordinate-delta pattern of Fusion's [Inspect > Measure](https://help.autodesk.com/view/fusion360/ENU/?contextId=DESIGN-INSPECT-MEASURE-CMD). Values come from compiled model coordinates; they are not a site survey or construction certification.

- `Laurel Homes Apartments` — nine-unit cutaway reconstructed from a real four-floor, 36-apartment HABS record
- `Galaxy Z Fold8` — Graphite exterior grounded in official dimensions and imagery
- `HABS Measured Cabin` — architectural shell and openings grounded in a public measured drawing
- `TEC Cooling Assembly` — image-derived electrical-connectivity regression asset
- `Phone Assembly` — 164-part smartphone with 28 individual conductors
- `Ornate Blade` — ornate dagger with a variable-thickness blade
- `Web Hero / Field Human` — CC0 human topology and local morphs

Verification:

```bash
npm test
npm run benchmark
npm run build
```

## What “every wire is connected” means

Wires are not decorative curves. `AssemblyIR.electrical` preserves:

- ports with owning component, logical pin, and assembler-visible pad/connector labels;
- `power`, `ground`, `data`, `rf`, `audio`, `sensor`, and `control` classes;
- one `wire` per conductor with endpoint ports, net, diameter, color, shielding, gauge, and `datasheet/design/bench-required` evidence;
- exact terminal positions derived from component-local coordinates and checked against owning-component bounds;
- validation for missing required ports, invalid references, signal mismatch, overload, and endpoint drift.

Each conductor is an independently selectable closed mesh. The compiler measures the start/end cap centers against the referenced terminals and fails the build when tolerance is exceeded. Moving parts update only affected conductors and dispose replaced geometry; idle frames allocate nothing. Digital graph validity and physical continuity remain separate states.

`SAVE NETLIST` derives an assembler-facing connection table from the same AssemblyIR, keeping product/component/port/conductor counts, physical pin labels, gauges, verification states, passive nodes, and bench checks in one source of truth.

## Galaxy Z Fold8 exterior preset

`FOLD8 / 04` builds the unfolded exterior of the 2026 Galaxy Z Fold8 in Graphite. The official envelope is `161.4 × 123.9 × 4.5 mm` unfolded and `81.9 × 123.9 × 9.7 mm` folded. It intentionally excludes internal electronics and hinge gearing.

Overall dimensions, displays, materials, and camera specifications come from [Samsung's official product page](https://www.samsung.com/us/smartphones/galaxy-z-fold8/) and [official launch material](https://news.samsung.com/global/samsung-galaxy-z-fold8-ultra-fold8-and-flip8foldables-perfected-for-every-way-of-living). Camera orientation, port layout, NFC center, and the Ø41 wireless-charging coil placement are preserved from [Samsung's accessory-manufacturing placement drawing](https://developer.samsung.com/mobile/accessories.html). Unpublished camera-ring diameters, button protrusion, and port pitch remain marked `estimated` or `inferred`. Official imagery is retained as source URLs rather than redistributed in the repository.

## PBR micro-surfaces that control reflection angle

`surface-system.ts` compiles light response rather than stopping at a color label. Twenty finishes are currently available.

| Finish | Reflection behavior |
|---|---|
| `brushed-metal` | directional machining grain, high anisotropy, local roughness variation |
| `anodized-metal` | oxide-film clearcoat and granular micro-normal |
| `sapphire` | IOR 1.76, AR iridescence, thin-window transmission |
| `optical-glass` | IOR 1.52, low roughness, transmission and coating response |
| `pcb-soldermask` | solder-mask orange peel, low metalness, thin clearcoat |
| `machined-copper` | directional cutting grain and copper metal response |
| `rubber`, `leather`, `wood` | material-specific sheen and dielectric grain |
| `skin`, `fabric`, `hair` | skin microtexture, textile fibres, and directional hair highlights |
| `hex-knit` | hexagonal weave height, roughness variation, and sheen for angle-dependent suit response |

- Deterministic 64×64 procedural normal/roughness maps use fixed seeds and require no copyrighted texture pack.
- Camera bezels, sapphire windows, internal lenses, flash, and LiDAR use explicit surface values rather than name inference.
- Material `userData` retains finish and PBR values for traceability in exported GLB files.
- Use `Beauty` for material response, `Clay` for form, and `X-Ray` for internal structure.

These are physically plausible presets, not BRDF measurements from a gonioreflectometer. Exact product matching still needs cross-polarized reference photography, multi-light capture, or manufacturer material data.

## Image to asset with Codex alone

The repository includes the [`morphloom-asset-foundry`](./skills/morphloom-asset-foundry/SKILL.md) skill. Even a short request defaults to a **high-detail editable review asset** and expands into footprint/negative-space checks, a complete visible-feature ledger, relationship constraints, evidence boundaries, semantic parts, PBR micro-surfaces, topology, and same-view comparison. The first compile is a checkpoint: the workflow fixes the highest-impact mismatch and re-runs its proof views until every evidence-supported blocking gate passes. The default request can therefore be one line:

```text
Turn this image (or drawing) into an editable 3D asset.
```

Asset-specific architecture, product, and human rules carry the ordinary detail requirements. Inputs are judged by whether they resolve the properties needed to model the asset, not by a prescribed medium or file count. One dimensioned orthographic sheet can replace several exterior photographs, and a BOM plus part drawings can replace an exploded image. Unresolved properties remain `estimated/inferred`; unresolved core geometry returns a precise evidence request instead of a misleading low-quality result.

`Evidence Pack 0.2` records resolved `shape/depth/scale/surface/interfaces` capabilities plus domain-specific internal, spatial, or pose evidence. `buildReady` authorizes only a review draft. A semi-professional delivery candidate additionally requires `deliveryReady`, with required capabilities resolved, strong dimensions conflict-free, and photographic cameras calibrated or replaced by orthographic evidence. Repeated evidence for the same part is merged through a stable ASCII `component_id`.

## Using Claude alone

`CLAUDE.md` reads the same skill and vendor-neutral contract. Both agents produce `morphloom.assembly/0.1` or `morphloom.character/0.2`, so changing the agent does not change the mesh engine.

## Geometry operations

| Operation | Typical use |
|---|---|
| `roundedBox` | frames, chips, batteries, enclosures |
| `cylinder`, `sphere`, `torus` | lenses, fasteners, rings, gems |
| `extrude` | measured 2D plate silhouettes and ornaments |
| `lathe` | handles, pommels, turned parts |
| `tube` | cables, engravings, heatpipes, spiral wraps |
| `bladeLoft` | variable-width, variable-thickness blade profiles |

AssemblyIR uses millimetres. External input is bounded to 500 components, 2,000 ports, 2,000 wires, and safe numeric/segment limits.

## Direct img2threejs comparison

The user-selected [Talon Knife · Doppler Ruby](https://img2threejs.io/#/x/talon-doppler-ruby) is the public baseline.

| Criterion | Morphloom Ornate Knife | img2threejs Talon |
|---|---:|---:|
| Triangles | 18,930 | about 25,000 |
| Top-level editable parts | 16 | 5 |
| Variable-thickness blade | yes | yes |
| Automatic manifold evidence | 16/16 pass | no public numeric report |
| Shared geometry/electrical JSON IR | yes | per-demo TypeScript |
| Photo-traced silhouette | depends on agent input | yes, a strength of this demo |
| Projected photo finish | planned | yes, a strength of this demo |

Morphloom is stronger in **part granularity, reusable IR, electrical semantics, and automatic topology evidence**. The Talon exhibit remains stronger in **silhouette and surface matching to its specific photo**. We do not claim universal visual superiority.

## Spider-Man single-image honesty test

One [960×1280 cosplay photograph from Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Spider-Man_cosplay.jpg) (ManoSolo13241324, CC BY-SA 4.0) is a fixed regression reference. `ReferencePoseIR` stores 17 measured 2D joints separately from inferred depth. The `CharacterIR 0.2` agent interpretation retains **ordinary-person cosplay, a slim-soft build, slight abdomen/chest volume, small glutes, mild forward head, rear-biased balance, leading right hand, and web-shooting hands**, each with confidence and evidence status. It explicitly maps viewer-left to anatomical right so hands and feet cannot silently swap sides. Limbs use bone-segment rotation and length correction, while locally uploaded front-view red/blue suit lighting is projected into editable mesh vertex colours. Rear surfaces keep authored inferred materials instead of copying unseen pixels. The visible mask, optical lenses, radial webbing, panels, and chest mark compile into 139 named edit units. The suit uses procedural `hex-knit` albedo, micro-normal, and roughness maps for angle-dependent response.

| Same-view observation | Current verdict |
|---|---|
| Red mask and large white lenses | reconstructed with separate lens IOR/clearcoat |
| Red center and blue side panels | reconstructed as editable vertex colors |
| Mask/chest webbing and chest mark | reconstructed as independent closed meshes |
| Forward hands and asymmetric legs | right-hand lead, right-leg advance, and grounded rear-left support reconstructed |
| 17 pose landmarks | approximately 18.5 mm target RMS · depth marked `inferred` |
| Uploaded front surface | red/blue families projected to vertex colour · background/rear copying rejected |
| Hexagonal textile response | inferred procedural `hex-knit` PBR |
| Exact finger gesture and production skin weights | not yet production grade |
| Rear pattern, real seams, exact textile pitch | absent from the photo and marked `inferred` |

**Verdict:** this is a clear improvement over the old generic body and is usable for game previs or as an editable base, but one image does not yield a finished identity-accurate character. Add front/rear/left/right views, hand close-ups, mask/textile macro shots, and measured height to minimize production review. With one view or without a same-view comparison, the UI total is capped at `59/100` and marked `BLOCKED`; triangle or material counts cannot pass photo likeness.

## Current limits

- One image cannot reveal hidden components, exact thickness, tolerances, or pinout.
- Wiring validation checks geometry, ports, physical labels, gauges, and evidence states; it is not SPICE simulation, PCB ERC, or a physical continuity test.
- Humans are at the editable realistic-base stage. Identity likeness, production skin weights, facial rigs, and cloth simulation remain future gates.
- Photo de-lighting, calibrated multi-view fitting, UV atlas/baking, LODs, collision meshes, and Blender/Unity/Unreal round trips remain planned.

## Repository map

```text
src/engine/assembly-compiler.ts  shared geometry IR compiler
src/engine/connectivity.ts       ports, nets, conductors, connectivity gates
src/engine/surface-system.ts     PBR finishes, micro-normal, roughness, anisotropy
src/engine/reference-set.ts      source roles and resolved capabilities across photos/drawings/data
src/engine/evidence-readiness.ts conflicts plus buildReady/deliveryReady evidence gates
src/engine/cooling-assembly.ts   supplied-image regression asset
src/engine/product.ts            164-part smartphone example
src/engine/knife.ts              ornate knife IR example
src/engine/character.ts          CC0 human mesh, morphs, reference pose deformation
src/engine/reference-pose.ts     measured joints, inferred depth, agent visual interpretation
src/engine/reference-projection.ts local front-suit colour projection
src/engine/web-hero.ts           editable mask, lenses, webbing, and chest mark
src/engine/topology.ts           mesh integrity analysis
schemas/                         JSON contracts for agents
benchmarks/                      reproducible metrics and comparison policy
```

## License

Code is [Apache-2.0](./LICENSE). The bundled `oxihuman-core-v1.ohpk` data is CC0-1.0. See [`NOTICE`](./NOTICE) and the provenance file for sources and modifications.

---

<div align="center">

**Turn sufficient evidence into an editable 3D structure designed to minimize review.**

</div>
