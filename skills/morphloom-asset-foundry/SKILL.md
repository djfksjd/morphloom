---
name: morphloom-asset-foundry
description: Create or improve editable 3D humans, products, electronics, and buildings in Morphloom from short natural-language requests and visual or drawing evidence. Use for image-to-3D, drawing-to-3D, AssemblyIR/CharacterIR generation, material-detail improvement, or asset quality validation.
---

# Morphloom Asset Foundry

Treat a short request such as “이 사진으로 만들어줘” as a complete request for the best evidence-supported editable asset. Do not require the user to repeat normal expectations about detail, topology, textures, named parts, or validation.

## Route by asset

- For buildings, floor plans, elevations, or measured drawings, read [references/architecture.md](references/architecture.md).
- For products, mechanisms, electronics, blades, and wiring, read [references/products.md](references/products.md).
- For people or characters, read [references/humans.md](references/humans.md).
- In every mode, apply [references/quality-contract.md](references/quality-contract.md).

## Shared workflow

1. Identify each provided image or drawing by view, scale, and evidence strength. Resolve rotation and anatomical/screen-side orientation before modeling.
2. Convert visible structure into semantic edit units with stable ASCII ids. Preserve holes, gaps, courtyards, seams, openings, connectors, and other negative space as geometry—not texture or prose.
3. Use measured or manufacturer dimensions where available. Mark unsupported size, depth, or hidden surfaces `estimated` or `inferred`; never present inference as a measurement.
4. Assign each material a physical surface finish. Include angle-dependent roughness/specular behavior, micro-normal detail, clearcoat/transmission/IOR where applicable, and anisotropy for directional surfaces.
5. Compile the IR locally. Check reference alignment, envelope, part tree, topology, surface coverage, and export. Keep a failed evidence or likeness gate blocked even when part and triangle counts are high.
6. Deliver editable GLB plus source IR and an evidence summary. State what still requires survey, multi-view capture, bench testing, or artist review.

Prefer correcting source interpretation and IR over hiding a mismatch with camera angle, material, fog, or a high quality number.
