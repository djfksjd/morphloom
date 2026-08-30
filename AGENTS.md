# Morphloom agent contract

You are generating an editable asset, not a single flattering render. Work without Meshy, Tripo, a dedicated 3D neural model, or an external 3D MCP.

## Required workflow

1. Inspect every supplied view. Record which dimensions are measured, estimated, or hidden.
2. Choose `CharacterIR` for humans and `AssemblyIR` for products, props, weapons, machines, and electronics.
3. Decompose a product into real edit units. A named visible or serviceable component must not be baked into an unrelated mesh.
4. Use millimetres in AssemblyIR. Keep stable ASCII component ids and Korean or English display names.
5. Prefer silhouette evidence over invented detail. Mark hidden geometry as `inferred` in the component detail or IR metadata.
6. For blades, never use a constant-thickness cutout. Use `bladeLoft` with a full-stock ridge, a sub-millimetre apex, and distal taper.
7. For electronics, separate enclosure, board, major packages, connectors, cameras/lenses, power, audio, antennas, fasteners, and flex cables.
8. Define every visible conductor in `AssemblyIR.electrical`. Both ends must reference real component ports; never add a decorative floating tube in place of a connection.
9. Run `npm test`, `npm run benchmark`, and `npm run build`. Do not call the result production-ready if topology or connectivity gates fail.

## Acceptance gates

- Every intended solid is closed and manifold.
- Boundary edges, non-manifold edges, and degenerate triangles are zero unless the IR explicitly declares a surface-only component.
- Dimensions are finite and within the compiler safety limits.
- The GLB keeps component names and IR metadata.
- Every required electrical port is connected, every wire has compatible endpoints, and measured endpoint drift stays within tolerance.
- A reference-fidelity claim needs a same-view comparison; triangle count alone is not a quality claim.

The schema is `schemas/assembly-ir.schema.json`. Import generated JSON through the app's `LOAD IR` action.
