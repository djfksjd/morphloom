# Default quality contract

Apply these requirements even when the user gives only a subject and one source.

## Internal completion contract

Before building geometry, derive a compact contract from the request and evidence:

- **Use:** preview, game asset, product visualization, service/exploded assembly, architectural review, or another explicit target. This determines the smallest feature that must be geometry.
- **Evidence map:** source view, scale/dimension authority, occlusion, and `measured`, `datasheet`, `estimated`, or `inferred` status.
- **Signature-feature manifest:** the silhouette breaks, proportions, openings, seams, controls, decorations, material boundaries, pose landmarks, or spatial forms whose omission would make the result feel like a generic substitute.
- **Relationship constraints:** left/right and front/rear mapping, ordering, attachment, containment, symmetry/asymmetry, projection direction, port endpoints, and negative-space boundaries.
- **Proof views:** the source camera plus only the orthographic or diagnostic views needed to expose those features and relationships.

If use is unspecified, default to a high-detail editable review asset judged at the source's native resolved distance. Do not silently downgrade to preview quality. Silhouette, negative space, high-contrast details, repeated patterns, and functional features are never discarded merely because they fall below a general feature-size threshold.

Do not interrupt for ordinary quality choices. Ask only when alternatives conflict materially, a user-owned decision changes the deliverable, or required evidence cannot be recovered. Otherwise choose the most evidence-supported interpretation and keep uncertainty visible.

## Evidence

- Record the source and status (`measured`, `datasheet`, `estimated`, or `inferred`) on every edit unit.
- Compare the compiled asset against the same view as the source. Counts and watertight topology do not prove visual fidelity.
- A single image cannot directly establish hidden depth, rear detail, exact scale, or internal construction. Keep those values explicit as inference.
- Do not let a plausible prior override visible evidence. When the source is ambiguous, retain the ambiguity in metadata and avoid precision claims.
- Track evidence per property when statuses differ: position, width, depth, material, and hidden construction may not share one evidence class.

## Visible-feature ledger

Account for every source-visible feature using one treatment: `geometry`, `material-zone`, `decal`, `normal-detail`, `inferred`, or `excluded-with-reason`. Attach an id and proof view. Delivery requires every row to be resolved; the signature manifest is the high-priority subset, not permission to omit the rest.

## Geometry and topology

- Use real units and independently named parts or architectural elements.
- Model silhouette-changing features, openings, seams, fasteners, trim, bezels, joints, and gaps as geometry when visible at the intended use distance.
- Verify the signature-feature manifest against the compiled part tree; a feature described only in prose is still missing.
- Verify spatial relationships numerically where possible. Counts cannot prove side, order, direction, alignment, attachment, containment, or continuity.
- Require finite dimensions, bounded segment counts, zero degenerate triangles, zero non-manifold edges, and closed meshes where the component should be solid.
- Block inverted normals, accidental open borders, duplicate coplanar faces, visible z-fighting, floating parts, unexplained penetrations, and self-intersections that affect the intended view or deformation.

## Surface response

- Choose a finish from the Morphloom surface system instead of relying on base colour alone.
- Set roughness and metalness by material class. Use clearcoat for coated surfaces, transmission and IOR for glass, anisotropy for brushed metal/hair, and sheen for textile/leather/skin.
- Add deterministic micro-normal and roughness variation at a scale appropriate to the real material. Do not use one texture scale for every object size.
- Check Beauty under grazing light, Clay for form, Wire for topology, and X-Ray for internal structure.
- Compare highlights as shape evidence: incorrect roughness, clearcoat, normal scale, or anisotropy can make correct geometry read as the wrong material.
- Require a deliberate non-fallback material on every rendered face. Verify visible material-zone coverage, intentional UV overlap, scale-consistent texel density, normal/tangent handling, and texture colour spaces.

## Review and self-correction loop

Review in this order because later polish cannot repair earlier interpretation errors:

1. **Source interpretation:** orientation, anatomical/coordinate side, scale, projection direction, and evidence labels.
2. **Camera calibration:** projection type, crop, field of view or focal-length estimate, pose, and stable image/model anchors. Lock this camera before judging geometry so camera fitting cannot hide proportion errors.
3. **Silhouette and proportions:** outer contour, dominant masses, pose/balance, and major voids from the source camera.
4. **Feature completeness:** every visible-feature row is resolved and every signature id exists in its proof view.
5. **Relationships and function:** adjacency, attachment, clearances, openings, joints, ports, conductors, circulation, and articulation.
6. **Surface response:** material boundaries, grazing highlights, texture scale, transparency, and micro-detail.
7. **Topology and export:** closed/manifold expectations, edit-unit names, transforms, bounds, and GLB/IR consistency. Reopen the GLB and compare part/material counts, units, transforms, and bounds with the IR.

For each failed gate, correct the IR rather than compensating with the camera or renderer, regenerate the affected proof views, and rerun the gate. Use explicit tolerances for contour/landmark reprojection, feature counts, and dimensional deviation when the evidence supports them. A pass requires no evidence-supported blocker, no unresolved visible-feature row, and no obvious signature mismatch at the intended viewing distance. Missing evidence may downgrade hidden geometry, exact dimensions, internals, or readiness claims; it does not excuse lower detail in visible regions. When a blocker cannot be resolved without missing evidence, deliver only the appropriate editable-base claim and list the exact missing view, measurement, datasheet, survey, or physical test.

## Required delivery evidence

- Editable source IR and compiled GLB.
- Same-view source comparison or overlay for visual inputs.
- Exterior completeness views for every modeled side, clearly labeling evidence-free sides as inferred, plus diagnostic close-ups or X-Ray views for relevant hidden relationships.
- Machine-readable topology, surface-coverage, evidence, and domain-specific gate results.
- A concise boundary statement separating passed qualities from evidence-limited qualities.

## Stop conditions

Delivery may be called an editable base only when topology/IR and every source-visible silhouette, feature, relationship, and material gate pass. Do not call it survey-, manufacturing-, identity-, or construction-ready without the matching physical evidence and validation.
