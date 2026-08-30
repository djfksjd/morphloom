<div align="center">

# MORPHLOOM

### A local open-source foundry that weaves images and language into editable 3D assets

**Use either Codex or Claude. No Meshy, Tripo, dedicated 3D generator, or external 3D MCP is required.**

[한국어](./README.md) · [English](./README.en.md)

[![License](https://img.shields.io/badge/license-Apache--2.0-335cff?style=flat-square)](./LICENSE)
![Tests](https://img.shields.io/badge/tests-30%20passing-28a879?style=flat-square)
![Three.js](https://img.shields.io/badge/Three.js-r179-111111?style=flat-square)
![Model weights](https://img.shields.io/badge/3D%20model%20weights-none-f05d47?style=flat-square)

</div>

---

Morphloom uses a multimodal coding agent to translate reference images and requirements into a shared `CharacterIR` or `AssemblyIR`. A deterministic Three.js engine then compiles real geometry locally. The output is not a single flattering render: it is an **editable GLB with named components, real units, materials, topology evidence, and electrical connectivity**.

> Status: `v0.3 alpha`. The target is product visualization, game previs, and editable base meshes. Morphloom does not claim to replace manufacturing CAD, human scanning, or electrical design verification.

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

- The web UI accepts up to 24 images and 96 MB per evidence set, then checks resolution, composition, and exposure locally.
- It tracks front, rear, left, right, top, and bottom coverage and classifies exploded, component, material, and measurement photographs.
- Close-ups of the same part share a stable ASCII `component_id`. `SAVE EVIDENCE` exports file names and roles as `morphloom.evidence/0.1` JSON without embedding source pixels or local blob URLs.
- The browser does not silently call a remote LLM. Image understanding and IR authoring are performed by **Codex or Claude** working in the repository.
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

## Quick start

```bash
npm ci
npm run dev
```

Open the printed local URL and try:

- `PHONE / 01` — 164-part smartphone with 28 individual conductors
- `BLADE / 02` — ornate dagger with a variable-thickness blade
- `COOLER / 03` — image-derived electrical-connectivity regression asset
- `HUMAN` — CC0 human topology and local morphs
- `WEB HERO / 04` — mask, lenses, web suit, and reference-action single-image regression asset

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

1. Open this repository in Codex and attach front, rear, side, or exploded views.
2. Include known overall dimensions and a component list.
3. Ask:

```text
Follow AGENTS.md and turn the attached images into AssemblyIR.
Separate every visible serviceable part and give every conductor from/to ports.
Mark hidden geometry as inferred, then pass npm test, benchmark, and build.
```

4. Load the generated IR in the app, inspect components, and export GLB.

For a multi-photo product, first add the six exterior views plus exploded and component photographs in the web UI. Assign roles and `component_id` values, then choose `SAVE EVIDENCE`. Give the resulting `morphloom-evidence.json` and the original images—with matching file names—to the agent. Repeated views of a component are then merged into one AssemblyIR node. Missing views, unidentified component images, and low-quality inputs keep the `EVIDENCE` stage `BLOCKED`.

## Using Claude alone

`CLAUDE.md` carries the same vendor-neutral contract. Both agents produce `morphloom.assembly/0.1` or `morphloom.character/0.2`, so changing the agent does not change the mesh engine.

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
src/engine/reference-set.ts      multi-view and component evidence manifest
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

**Turn an image into a 3D structure you can inspect and repair—not just one convincing render.**

</div>
