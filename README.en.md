<div align="center">

# MORPHLOOM

### A local open-source foundry that weaves images and language into editable 3D assets

**Use either Codex or Claude. No Meshy, Tripo, dedicated 3D generator, or external 3D MCP is required.**

[한국어](./README.md) · [English](./README.en.md)

[![License](https://img.shields.io/badge/license-Apache--2.0-335cff?style=flat-square)](./LICENSE)
![Tests](https://img.shields.io/badge/tests-11%20passing-28a879?style=flat-square)
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
| Smartphone exploded view | 164 independent parts · 142,480 tris · 39 camera parts |
| Smartphone wiring | 28/28 individual conductors · 56/56 required ports · 0 dangling ends |
| Smartphone surfaces | 13 PBR finishes · micro-normal on 219/220 materials · 111 anisotropic materials |
| Ornate knife | 16 parts · 18,930 tris · 16/16 watertight |
| Image-derived cooling assembly | 24 source components → 67 rendered parts · 43/43 conductors · 86/86 required ports |
| Output | GLB · PNG · CharacterIR/AssemblyIR JSON |

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

- Dropping an image into the web UI performs local resolution, composition, and exposure checks.
- The browser does not silently call a remote LLM. Image understanding and IR authoring are performed by **Codex or Claude** working in the repository.
- Load the resulting IR through `LOAD IR`; the compiler rejects invalid topology, missing ports, incompatible signals, and floating conductors.
- OpenAI's API officially supports text/image inputs and JSON output, but the default Morphloom workflow uses the current coding agent and needs no separate API key. [Official OpenAI documentation](https://developers.openai.com/api/reference/cli/resources/responses/methods/create)

### Supplied-image regression check

The user-supplied 2038×1268 exploded electronics image is now a regression case. The `COOLER / 03` preset reconstructs the visible cold plate, contact pad, TEC1-12706, copper base, AXP90 fins and heatpipes, 92 mm fan, ESP32-S3, ADC, MUX, sensors, power monitor, and driver.

| Gate | Result |
|---|---:|
| Source resolution | 2038×1268 |
| Structural components | 24 |
| Rendered parts | 67 |
| Triangles | 124,664 |
| Individual conductors | 43/43 connected |
| Required electrical ports | 86/86 connected |
| Dangling wires / open required ports | 0 / 0 |
| Ports located on owning components | 86/86 |
| Maximum terminal-center error | below 0.0001 mm |

Hidden undersides, exact fasteners, PCB traces, and real routing cannot be measured from one exploded view and are marked `inferred`. The source image is not redistributed because its reuse rights are unknown.

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

Verification:

```bash
npm test
npm run benchmark
npm run build
```

## What “every wire is connected” means

Wires are not decorative curves. `AssemblyIR.electrical` preserves:

- ports with owning component and pin names;
- `power`, `ground`, `data`, `rf`, `audio`, `sensor`, and `control` classes;
- one `wire` per conductor with endpoint ports, net, diameter, color, and shielding;
- exact terminal positions derived from component-local coordinates and checked against owning-component bounds;
- validation for missing required ports, invalid references, signal mismatch, overload, and endpoint drift.

Each conductor is an independently selectable closed mesh. The compiler measures the start/end cap centers against the referenced terminals and fails the build when tolerance is exceeded.

## PBR micro-surfaces that control reflection angle

`surface-system.ts` compiles light response rather than stopping at a color label. Nineteen finishes are currently available.

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

## Using Claude alone

`CLAUDE.md` carries the same vendor-neutral contract. Both agents produce `morphloom.assembly/0.1` or `morphloom.character/0.1`, so changing the agent does not change the mesh engine.

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

## Current limits

- One image cannot reveal hidden components, exact thickness, tolerances, or pinout.
- Wiring validation currently checks geometry, ports, and signal classes; it is not SPICE simulation or PCB ERC.
- Humans are at the editable realistic-base stage. Identity likeness, production skin weights, facial rigs, and cloth simulation remain future gates.
- Photo de-lighting, calibrated multi-view fitting, UV atlas/baking, LODs, collision meshes, and Blender/Unity/Unreal round trips remain planned.

## Repository map

```text
src/engine/assembly-compiler.ts  shared geometry IR compiler
src/engine/connectivity.ts       ports, nets, conductors, connectivity gates
src/engine/surface-system.ts     PBR finishes, micro-normal, roughness, anisotropy
src/engine/cooling-assembly.ts   supplied-image regression asset
src/engine/product.ts            164-part smartphone example
src/engine/knife.ts              ornate knife IR example
src/engine/character.ts          CC0 human mesh and morphs
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
