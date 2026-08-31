---
name: morphloom-asset-foundry
description: Create or improve editable 3D humans, products, electronics, and buildings in Morphloom from short natural-language requests and visual or drawing evidence. Use for image-to-3D, drawing-to-3D, AssemblyIR/CharacterIR generation, material-detail improvement, or asset quality validation.
---

# Morphloom Asset Foundry

Treat a short modeling instruction as a complete statement of ordinary quality expectations, but do not treat one image or any fixed file count as the workflow target. Morphloom targets semi-professional editable assets from whatever combination of drawings, dimensions, datasheets, scans, existing CAD, and photographs resolves the required properties. Infer ordinary expectations about likeness, proportions, detail, topology, surfaces, editability, and validation so the user does not have to request them twice. Do not infer unsupported facts or a higher readiness claim than the evidence permits.

## Route by asset

- For buildings, floor plans, elevations, or measured drawings, read [references/architecture.md](references/architecture.md).
- For products, mechanisms, electronics, blades, and wiring, read [references/products.md](references/products.md).
- For people or characters, read [references/humans.md](references/humans.md).
- In every mode, apply [references/quality-contract.md](references/quality-contract.md).
- Before geometry, build and assess [references/evidence-pack.md](references/evidence-pack.md).
- Routing is additive for mixed subjects. Apply the primary reference and every attached, embedded, worn, or held subasset reference that affects the result.

## Shared workflow

1. Convert the request and evidence into an internal completion contract before modeling. Assess the Evidence Pack by resolved capabilities—shape, depth, scale, surface, interfaces, and domain-specific structure—not by counting photographs. A single dimensioned drawing may resolve several capabilities; many redundant photos may still fail. When use is unspecified, target a semi-professional high-detail editable review asset—not a low-detail preview.
2. Identify each source by view and evidence strength. Resolve rotation, coordinate axes, anatomical/screen-side mapping, and which facade or datum each projection extends from before assigning coordinates.
3. Build a signature-feature manifest and visible-feature ledger. Every recognizable or functional feature needs a stable ASCII id, evidence status, treatment, and proof view. Every other visible feature must still resolve to geometry, material zone, decal, normal detail, inference, or an explicit evidence-based exclusion; “not signature-defining” is not an exclusion reason.
4. Convert structure into semantic edit units. Preserve holes, gaps, courtyards, seams, openings, connectors, and other negative space as geometry—not texture or prose. Use measured or manufacturer dimensions where available and mark unsupported depth or hidden construction `estimated` or `inferred`.
5. Assign physical surface finishes. Include angle-dependent roughness/specular response, correctly scaled micro-normal detail, clearcoat/transmission/IOR where applicable, and anisotropy for directional surfaces.
6. Compile and run the review set from [references/quality-contract.md](references/quality-contract.md). Compare the same source view first, then exterior-completeness views and the Clay, grazing-light, Wire, or X-Ray diagnostics needed to prove the asset. Check direction and adjacency as well as feature counts.
7. Treat `buildReady` only as permission to compile a review draft. Treat the first compiling draft as a checkpoint, not a deliverable. Fix the highest-impact failed feature or relationship in the IR, rebuild, and repeat until the Evidence Pack is `deliveryReady` and every compiled-asset blocker passes. If a capability remains unresolved, request the property—not a prescribed number or type of files.
8. Deliver editable GLB plus source IR, comparison renders, and an evidence-aware audit. State only the remaining survey, multi-view, bench-test, rigging, or artist work that materially affects the requested use.

Prefer correcting source interpretation and IR over hiding a mismatch with camera angle, material, fog, part count, triangle count, or a high quality number. Never report success while an obvious source-defining mismatch remains visible.
