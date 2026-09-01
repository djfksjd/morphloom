# Benchmark policy

`npm run benchmark` measures properties that can be reproduced from geometry and material state: triangles, named parts, category coverage, watertight components, boundary/non-manifold edges, degenerate triangles, declared modeling operations, connected ports/conductors, dangling ends, owning-component port placement, terminal-center drift, physical pin labels, conductor gauges, verification records, pending bench gates, live endpoint anchoring, authored PBR finishes, micro-normal/roughness coverage, anisotropy, clearcoat, and transmission.

`npm run quality:gate` recompiles product, architecture, service-assembly, and character cases twice, compares deterministic fingerprints, applies evidence and micro-surface thresholds, and writes `quality-latest.json`. It then runs the eight-stage Fidelity Contract benchmark and writes `competitive-latest.json`. Each locked case declares whether the correct outcome is release or block. The overall rate requires both technical integrity and the correct decision; expected rejections count only when their named blocker is observed. Model/browser release rates use only release-intended cases, while expected rejections have a separate safety rate.

The current suite locks eight decisions: five release-intended contracts (industrial design, measured architecture, animation, game, and 3D print) plus three evidence-limited rejections. Domain readiness is not one shared beauty score:

- architecture requires a verified plan footprint, closed shells, evidence ≥85, and ≥80% micro-normal coverage;
- industrial design requires closed topology, evidence ≥80, ≥95% UV coverage, and ≥75% micro-normal coverage;
- animation requires closed skinned LOD meshes, at least 45 real bones, 30 named finger bones with actually weighted hand vertices and animated finger tracks, normalized ≤4-influence weights, measured non-zero joint deformation, UVs, and GLB preservation;
- game requires the delivered triangle budget, no non-manifold or degenerate geometry, UVs, normals, a real skeleton, an actual skinned LOD1, collision primitives, and PBR surfaces;
- 3D print requires a closed positive-volume mesh, explicit millimetres, an IR-declared minimum feature of at least 0.8 mm, and measured generic 45° overhang area. Printer-specific orientation and support generation remain downstream process checks.

A browser proof requires the viewer to export and reopen the actual GLB. The proof is bound to a normalized input fingerprint containing the relevant asset inputs and compiler revision. The viewer records both the pre-export build fingerprint and the exporter-normalized source fingerprint for same-runtime diagnostics; platform-level floating-point noise is not used as a cross-runtime cache key. Both browser fingerprints must be present and valid, while the revision-bound input fingerprint invalidates stale engine evidence. A fixed score, stale compiler revision, stale input proof, or download click is not evidence.

It does not convert triangle count into a beauty score. Reference fidelity needs the same admitted images and camera calibration. Morphloom computes same-size reference/render silhouette IoU, interior pixel similarity, feature-region scores, material response, and frame fingerprints. A winner claim is refused unless both engines use the locked identical input, matched calibrated cameras, actual browser WebGL captures, declared critical regions, and at least five unique blind raters with balanced presentation order. Automatic metrics alone may report a lead, never superiority. See [`../docs/COMPETITIVE_BENCHMARK.md`](../docs/COMPETITIVE_BENCHMARK.md).

A digitally connected harness is not automatically production-ready. Any `bench-required` conductor, pending bench check, or inferred component keeps the physical-release flag false even when every 3D endpoint is snapped.

The Spider-Man single-image case therefore records two separate results: the compiled asset can pass closed-topology and editable-part gates while the one-view likeness gate remains blocked. `gamePrevisBaseReady` must never be presented as `productionLikenessReady`.

The Galaxy Z Fold8 exterior case records Samsung's published folded and unfolded envelopes separately from the compiled camera-bump envelope. Official dimensions, screen ratios, camera count, material families, and accessory-placement drawing values are `datasheet`; unpublished ring diameters, button protrusion, port pitch, and crease response remain `estimated` or `inferred`. Its exterior-only scope must not be reported as an internal engineering model.

When a new baseline is added, store its public URL, version, visible metrics, and the date observed. Never copy a proprietary asset into this directory.

`talon-same-reference-latest.json` is the first real same-input render case. It keeps the public URL and measured delivery facts only; the third-party reference bitmap and competitor render are not redistributed. The result deliberately separates photographic likeness from editable delivery quality.

`asphalt-reference-latest.json` records the local-photo surface path without redistributing the bitmap. The gate binds the image fingerprint to the embedded height field, projected albedo, browser-derived normal/roughness maps, closed topology, and GLB reopen result. Its 100% model-completeness score means that declared visual-material checks passed; the separate source-confidence score remains below production measurement confidence because one photograph cannot determine absolute height.
