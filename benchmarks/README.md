# Benchmark policy

`npm run benchmark` measures properties that can be reproduced from geometry and material state: triangles, named parts, category coverage, watertight components, boundary/non-manifold edges, degenerate triangles, declared modeling operations, connected ports/conductors, dangling ends, owning-component port placement, terminal-center drift, physical pin labels, conductor gauges, verification records, pending bench gates, live endpoint anchoring, authored PBR finishes, micro-normal/roughness coverage, anisotropy, clearcoat, and transmission.

`npm run quality:gate` recompiles product, architecture, service-assembly, and character cases twice, compares deterministic fingerprints, applies evidence and micro-surface thresholds, and writes `quality-latest.json`. It then runs the eight-stage Fidelity Contract benchmark and writes `competitive-latest.json`. Each locked case declares whether the correct outcome is release or block. The overall rate requires both technical integrity and the correct decision; expected rejections count only when their named blocker is observed. Model/browser release rates use only release-intended cases, while expected rejections have a separate safety rate.

A browser proof requires the viewer to export and reopen the actual GLB. The proof is bound to a normalized input fingerprint containing the relevant asset inputs and compiler revision. Raw scene fingerprints remain in the report for same-runtime diagnostics; platform-level floating-point noise is not used as a cross-runtime cache key. A fixed score, stale compiler revision, stale input proof, or download click is not evidence.

It does not convert triangle count into a beauty score. Reference fidelity needs the same admitted images and camera calibration. Morphloom now computes same-size reference/render silhouette IoU, interior pixel similarity, feature-region scores, and frame fingerprints; it still does not claim to beat another renderer without a same-input blind visual evaluation. See [`../docs/COMPETITIVE_BENCHMARK.md`](../docs/COMPETITIVE_BENCHMARK.md).

A digitally connected harness is not automatically production-ready. Any `bench-required` conductor, pending bench check, or inferred component keeps the physical-release flag false even when every 3D endpoint is snapped.

The Spider-Man single-image case therefore records two separate results: the compiled asset can pass closed-topology and editable-part gates while the one-view likeness gate remains blocked. `gamePrevisBaseReady` must never be presented as `productionLikenessReady`.

The Galaxy Z Fold8 exterior case records Samsung's published folded and unfolded envelopes separately from the compiled camera-bump envelope. Official dimensions, screen ratios, camera count, material families, and accessory-placement drawing values are `datasheet`; unpublished ring diameters, button protrusion, port pitch, and crease response remain `estimated` or `inferred`. Its exterior-only scope must not be reported as an internal engineering model.

When a new baseline is added, store its public URL, version, visible metrics, and the date observed. Never copy a proprietary asset into this directory.
