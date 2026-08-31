---
name: morphloom-asset-foundry
description: Create or improve editable 3D humans, products, electronics, and buildings in Morphloom from short natural-language requests and visual or drawing evidence. Use for image-to-3D, drawing-to-3D, AssemblyIR/CharacterIR generation, material-detail improvement, or asset quality validation.
---

# Morphloom Asset Foundry

Treat a short request such as “이 사진으로 만들어줘” as a complete request for the best evidence-supported editable asset. Infer ordinary expectations about likeness, proportions, detail, topology, surfaces, editability, and validation so the user does not have to request them twice. Do not infer unsupported facts or a higher readiness claim than the evidence permits.

## Route by asset

- For buildings, floor plans, elevations, or measured drawings, read [references/architecture.md](references/architecture.md).
- For products, mechanisms, electronics, blades, and wiring, read [references/products.md](references/products.md).
- For people or characters, read [references/humans.md](references/humans.md).
- In every mode, apply [references/quality-contract.md](references/quality-contract.md).
- Routing is additive for mixed subjects. Apply the primary reference and every attached, embedded, worn, or held subasset reference that affects the result.

## Shared workflow

1. Convert the request and evidence into an internal completion contract before modeling. Include intended use, source views, real or relative scale, signature features, a complete visible-feature ledger, negative spaces, spatial relationships, material zones, required edit units, and the views that will prove completion. When use is unspecified, target a high-detail editable review asset at the source's resolved viewing distance—not a low-detail preview. Do not ask the user to restate these normal quality expectations.
2. Identify each source by view and evidence strength. Resolve rotation, coordinate axes, anatomical/screen-side mapping, and which facade or datum each projection extends from before assigning coordinates.
3. Build a signature-feature manifest and visible-feature ledger. Every recognizable or functional feature needs a stable ASCII id, evidence status, treatment, and proof view. Every other visible feature must still resolve to geometry, material zone, decal, normal detail, inference, or an explicit evidence-based exclusion; “not signature-defining” is not an exclusion reason.
4. Convert structure into semantic edit units. Preserve holes, gaps, courtyards, seams, openings, connectors, and other negative space as geometry—not texture or prose. Use measured or manufacturer dimensions where available and mark unsupported depth or hidden construction `estimated` or `inferred`.
5. Assign physical surface finishes. Include angle-dependent roughness/specular response, correctly scaled micro-normal detail, clearcoat/transmission/IOR where applicable, and anisotropy for directional surfaces.
6. Compile and run the review set from [references/quality-contract.md](references/quality-contract.md). Compare the same source view first, then exterior-completeness views and the Clay, grazing-light, Wire, or X-Ray diagnostics needed to prove the asset. Check direction and adjacency as well as feature counts.
7. Treat the first compiling draft as a checkpoint, not a deliverable. Fix the highest-impact failed feature or relationship in the IR, rebuild, and repeat until every evidence-supported blocker passes. Stop iterating only when remaining gaps require evidence the user did not provide; label those gaps instead of inventing certainty.
8. Deliver editable GLB plus source IR, comparison renders, and an evidence-aware audit. State only the remaining survey, multi-view, bench-test, rigging, or artist work that materially affects the requested use.

Prefer correcting source interpretation and IR over hiding a mismatch with camera angle, material, fog, part count, triangle count, or a high quality number. Never report success while an obvious source-defining mismatch remains visible.
