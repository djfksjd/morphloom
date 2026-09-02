# Default quality contract

Apply these requirements to every asset. Source sufficiency comes from [evidence-pack.md](evidence-pack.md); do not substitute a fixed photograph count for capability coverage.

## Internal completion contract

Before building geometry, derive a compact contract from the request and evidence:

- **Use:** preview, game asset, animation, 3D print, product visualization, service/exploded assembly, architectural review, or another explicit target. This determines the smallest feature that must be geometry and which domain contract must block delivery.
- **Evidence map:** source view, scale/dimension authority, occlusion, and `measured`, `datasheet`, `estimated`, or `inferred` status.
- **Signature-feature manifest:** the silhouette breaks, proportions, openings, seams, controls, decorations, material boundaries, pose landmarks, or spatial forms whose omission would make the result feel like a generic substitute.
- **Relationship constraints:** left/right and front/rear mapping, ordering, attachment, containment, symmetry/asymmetry, projection direction, port endpoints, and negative-space boundaries.
- **Proof views:** the source camera plus only the orthographic or diagnostic views needed to expose those features and relationships.
- **Acceptance:** a numeric threshold for each feature, required proof views per pass, hard gates, and bounded iteration/token ceilings. Save this as `morphloom.fidelity/0.1` and attach it to `AssemblyIR.fidelity`.

If use is unspecified, default to a high-detail editable review asset judged at the source's native resolved distance. Do not silently downgrade to preview quality. Silhouette, negative space, high-contrast details, repeated patterns, and functional features are never discarded merely because they fall below a general feature-size threshold.

Do not interrupt for ordinary quality choices. Ask only when alternatives conflict materially, a user-owned decision changes the deliverable, or required evidence cannot be recovered. Otherwise choose the most evidence-supported interpretation and keep uncertainty visible.

## Evidence

- Record the source and status (`measured`, `datasheet`, `estimated`, or `inferred`) on every edit unit.
- Judge evidence by resolved properties. A dimensioned drawing, datasheet, scan, existing CAD, or photograph may satisfy the same property; prefer the strongest source and never require a particular medium when another source resolves it.
- Compare the compiled asset against the same view as the source. Counts and watertight topology do not prove visual fidelity.
- Use UI-free browser-canvas evidence. Hide floor, fog, bounds, measurements, dimensions, labels, and selection overlays; prefer a transparent capture so foreground masks do not favor dark-background or single-mesh candidates.
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
- Block inverted normals, accidental open borders, duplicate coplanar faces, visible z-fighting, floating parts, unexplained penetrations, and triangle-level self-intersections. Run a deterministic bounded broadphase followed by exact triangle tests on every delivered solid; exceeding the candidate-pair budget is a failure, not an unchecked pass. Do not count an attribute merely because its buffer exists: UV coordinates must be finite, rigid product and architectural custom geometry must have zero zero-area UV triangles, any relaxed organic tolerance must be explicit, and normals must be finite and near unit length.
- If two or three compatible orthographic silhouette masks are available, use `geometry.op: visualHull` to intersect them on the bounded voxel grid. Require a non-empty carve, welded boundary faces, zero boundary/non-manifold edges, and an explicit list of unconstrained axes. Reproject the occupied volume into every supplied mask and record per-view IoU plus false-positive/negative fractions. Block delivery below `minimumViewIoU = 0.75` or `confidenceWeightedIoU = 0.85`, even when topology is watertight. Silhouette dilation is a bounded calibration aid (`0..2` voxels), never permission to erase a failed reprojection gate. Treat the hull as an upper bound: it cannot recover a concavity that no supplied silhouette exposes.
- Use `geometry.op: implicitSurface` for evidence-supported smooth blends, organic blockouts, recessed sockets, and continuous ergonomic forms that assembled primitives cannot represent cleanly. Keep the primitive/operation graph editable and bounded. Sampling bounds must pad the zero surface, the triangle budget must hold, and the Surface Nets result must have zero boundary and non-manifold edges, positive enclosed volume, and at least 99.5% face/field-normal agreement. Morphloom may refine the requested sampling resolution by at most four deterministic steps to resolve ambiguous cells or winding disagreements; if the result remains invalid, block it rather than exporting a visually smooth but unusable shell.

## Surface response

- Choose a finish from the Morphloom surface system instead of relying on base colour alone.
- When a local photograph supplies base colour, require deterministic bounded de-light metadata on every projected material. Process in linear light on a bounded downsampled lighting field, preserve global exposure, and keep single-image confidence capped. Reject broad-colour drift, correction clipping above 2%, robust-luminance regression above 0.015, or any same-view material regression.
- Partition reference projection by signed source-facing triangle rather than geometry type. Project every genuinely source-visible cap or bevel, retain authored UVs on tangent/rear triangles, require finite non-zero projected UV area, and mark the fallback partition `unobserved-side`. Do not mirror one plate onto the hidden hemisphere or preserve a directional procedural normal that creates false barcode seams at the projection boundary.
- Set roughness and metalness by material class. Use clearcoat for coated surfaces, transmission and IOR for glass, anisotropy for brushed metal/hair, and sheen for textile/leather/skin.
- Add deterministic micro-normal and roughness variation at a scale appropriate to the real material. For photo-conditioned relief, preserve separate fine, medium, and coarse frequency bands and record their measured deviation and balance. Do not use one texture scale for every object size.
- Check Beauty under grazing light, Clay for form, Wire for topology, and X-Ray for internal structure.
- Compare highlights as shape evidence: incorrect roughness, clearcoat, normal scale, or anisotropy can make correct geometry read as the wrong material.
- Require a deliberate non-fallback material on every rendered face. Verify visible material-zone coverage, intentional UV overlap, scale-consistent texel density, normal/tangent handling, and texture colour spaces.
- Compare reference/render material crops deterministically. Gate base colour, luminance, fine/coarse local contrast, gradient-orientation distribution, entropy, periodicity, irregularity, and spatially corresponding local contrast structure separately. The spatial term may use only a one-cell local correspondence with a displacement penalty and must remain subordinate to a single global mapping. Granular references must reject overly periodic, spatially shuffled, or single-scale renders even when mean colour and total variance match; a failed material region blocks the candidate regardless of its aggregate geometry score.

## Review and self-correction loop

Lock the pass order as `blockout → structure → form → material → surface → lighting → interaction → optimization`. Do not skip or reorder passes. Each review must name the calibrated source view, comparison artifact, proof modes, feature scores, hard-gate failures, defect tags, and observed token use.

Review in this order because later polish cannot repair earlier interpretation errors:

1. **Source interpretation:** orientation, anatomical/coordinate side, scale, projection direction, and evidence labels.
2. **Camera calibration:** projection type, crop, field of view or focal-length estimate, pose, and at least four stable image/model anchors for a photographic source. Lock this camera before judging geometry so camera fitting cannot hide proportion errors. Orthographic drawings still require explicit orientation and scale.
3. **Silhouette and proportions:** outer contour, dominant masses, pose/balance, and major voids from the source camera. When orthographic masks exist, use their visual-hull intersection as a geometry constraint rather than inventing hidden depth.
4. **Feature completeness:** every visible-feature row is resolved and every signature id exists in its proof view. Align the reference/render foreground bounds, area-average onto a bounded grid, and compare named height bands so missing eyes, controls, openings, trim, or fixtures cannot hide behind an unchanged outline. Refuse the metric when no foreground cells overlap.
5. **Relationships and function:** adjacency, attachment, clearances, openings, joints, ports, conductors, circulation, and articulation.
6. **Surface response:** material boundaries, grazing highlights, fine/medium/coarse texture scale, regularity versus natural irregularity, transparency, and micro-detail.
7. **Topology and export:** closed/manifold expectations, zero verified self-intersections, completed intersection search, edit-unit names, transforms, bounds, and GLB/IR consistency. Run Khronos glTF Validator on the exact GLB bytes, then reopen those bytes and compare part/material counts, units, transforms, and bounds with the IR.

For a cross-engine winner claim, require the domain minimum number of distinct calibrated views, explicit projection/position/target/up/FOV or orthographic height, identical reference bytes and feature rectangles for both candidates, unique reference/render fingerprints per view, one local compiled scene artifact per candidate whose streamed SHA-256 remains unchanged across its views, one unique browser capture receipt per candidate and view that binds the locked input, scene, camera, reference, PNG, renderer version, canvas, and render settings, non-empty foreground in every critical region, and a balanced blind panel of at least five unique raters. Use the bounded local `morphloom.visual-capture-set/0.3` manifest and its fail-closed `--require-claim` gate. Refuse relabelled copies of one reference, reused renders, candidate-identical render pixels, caller-supplied or screenshot hashes relabelled as scene evidence, per-view scene substitution, reused or hash-mismatched capture receipts, parent-path evidence escape, per-candidate easy regions, or an average that hides one failed view. A one-view automatic lead is regression evidence only and must remain `claimAllowed: false`.

The export score must come from the bytes that will actually be delivered. Export the beauty asset to binary glTF, run Khronos glTF Validator on those bytes, parse the same bytes with an independently maintained glTF parser, then reopen them with the runtime loader and compare mesh count, triangle count, named-node coverage, finite transforms, neutral-pose bounds, and when relevant skeleton, animation and morph-target identities. A hard-coded export score or a successful download click is not evidence. Block delivery on validator errors, independent-parser failure, count/identity drift, non-finite transforms, less than 95% named-node coverage, or more than 0.1 mm neutral-pose bounds drift for rigid assets. A skinned character may use up to 0.5 mm neutral-bounds tolerance only when bone/action/morph identities match exactly and weighted-vertex coverage remains 100%. Surface validator warnings separately and require review or correction. Record validator/parser versions, issue codes, output byte size, and structural fingerprint.

Compile the same locked IR twice and compare structural/material fingerprints. For a delivery benchmark, canonicalize image buffer-view ordering, export the same input twice independently, and require identical GLB SHA-256 values as well. A mismatch blocks reproducibility until the nondeterministic source is identified. Benchmarks must report model-ready and delivery-ready separately; browser GLB round-trip proof is required for the latter.

Browser delivery verification is a bounded state machine, not an unbounded effect. Deduplicate the same normalized input fingerprint, serialize distinct GLB export/reopen jobs, cap the pending queue, and ignore results older than the current validation sequence. Re-selecting the active asset must preserve its valid proof instead of resetting it to `verifying`. A failed job must release its queue slot and must not prevent the next job from running.

For each failed gate, correct the IR rather than compensating with the camera or renderer, regenerate the affected proof views, and rerun the gate. Use explicit tolerances for contour/landmark reprojection, feature counts, and dimensional deviation when the evidence supports them. A pass requires every relevant feature to clear its own threshold; a high average never hides one failed critical feature. Revert to the best recorded review when a correction regresses. If the same defect survives twice, refine the specification instead of repeating the same edit. If improvement remains below the plateau threshold, or the per-pass/total iteration or token budget is exhausted, stop and request the smallest missing evidence or user decision. Missing evidence may downgrade hidden geometry, exact dimensions, internals, or readiness claims; it does not excuse lower detail in visible regions. When a blocker cannot be resolved without missing evidence, deliver only the appropriate editable-base claim and list the exact missing view, measurement, datasheet, survey, or physical test.

## Required delivery evidence

- Editable source IR and compiled GLB.
- A self-contained asset pack containing GLB, source IR, quality report, evidence boundary, preview, and measured local build/storage telemetry.
- Same-view source comparison or overlay for visual inputs.
- Exterior completeness views for every modeled side, clearly labeling evidence-free sides as inferred, plus diagnostic close-ups or X-Ray views for relevant hidden relationships.
- Machine-readable topology, surface-coverage, evidence, and domain-specific gate results.
- A concise boundary statement separating passed qualities from evidence-limited qualities.

GLB is the authoritative interchange candidate for Blender, Unity, and Unreal. Khronos validation and Three.js reopening prove format and local runtime integrity, not that a particular Blender, Unity, or Unreal version was actually imported. Mark each target application `application-import-not-run` until that application or an approved CI fixture performs the import. OBJ/STL exports are mesh references for DCC/CAD import and must never be described as parametric STEP/BREP manufacturing CAD. Figma receives a 2D SVG inspection/reference sheet; do not imply that Figma has received the editable 3D asset.

For a Blender proof, import the source GLB in a clean background session, record mesh/polygon/material/image/shape-key/armature/bone/action counts, weighted-vertex coverage, geometry moments, surface area, and world bounds, export a new GLB, and reopen that file in another clean session. Require geometry, image, and skinning parity; use the rigid or skinned bounds tolerance defined above. Run Khronos and the independent parser on the Blender-produced bytes too. If Blender regenerates zero or non-unit tangents on micro-bevels, preserve the raw validator result, normalize valid tangent spaces or remove unused tangent accessors, and rerun both validators on the repaired final bytes. The final delivery requires zero validator errors and warnings; an automatic repair must never erase the raw-failure evidence. A Blender pass does not imply Unity or Unreal passed.

The local viewer must not upload customer evidence. Imported IR is memory-only, size-bounded, explicitly clearable, and automatically expires. LLM cost is reported only when provider usage is actually present; otherwise label it unobserved instead of inventing a price. Compile time, round-trip time, GLB bytes, geometry bytes, texture bytes, and estimated render memory are measured locally.

## Stop conditions

Delivery may be called an editable base only when topology/IR and every source-visible silhouette, feature, relationship, and material gate pass. Do not call it survey-, manufacturing-, identity-, or construction-ready without the matching physical evidence and validation.
