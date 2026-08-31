# Semi-professional Evidence Pack 0.2

The target is a low-review, editable semi-professional asset. Evidence sufficiency depends on what the sources resolve, not how many files or photographs exist.

## Source-neutral rule

Accept photographs, dimensioned drawings, plans/elevations/sections, datasheets, BOMs, scans, existing CAD, material samples, and labelled component documents. One source may resolve several capabilities. For example, a dimensioned orthographic sheet may resolve shape, depth, scale, interfaces, openings, and camera projection without six separate photographs. Conversely, many similar photographs do not resolve hidden depth or exact scale.

Six exterior photos, an exploded view, or a teardown are collection suggestions, never universal requirements. Ask for one only when the missing capability cannot be resolved by evidence already available.

## Capability assessment

Map each source to the properties it actually resolves:

- `shape`: silhouette, proportions, curvature, outline, or massing;
- `depth`: thickness, rear/side construction, section, or spatial depth;
- `scale`: at least one authoritative dimension, scale bar, survey datum, or metric scan;
- `surface`: material class, finish, colour, roughness/highlight response, and texture scale;
- `interfaces`: seams, ports, buttons, fasteners, joints, contact faces, or openings;
- `internals` and `assembly-order`: hidden parts, containment, attachment, removal, and exploded/service relationships;
- `layout`, `verticals`, `openings`, and `circulation`: architectural footprint, height system, apertures, and connectivity;
- `pose` and `identity`: human action, anatomy, silhouette, facial/costume identity, and visible asymmetry.

The profile decides which capabilities matter. Do not require product internals for an exterior visualization, or manufacturing tolerances for architectural visualization. Do require internal and assembly evidence for a service assembly, circulation/opening evidence for architectural review, and depth/identity/pose evidence for a game character.

## Two readiness levels

- `buildReady`: the evidence resolves enough shape, depth, and scale to build a review draft without arbitrary guessing. It does not authorize a semi-professional delivery claim.
- `deliveryReady`: every capability required by the profile is resolved, strong dimensions do not conflict, camera interpretation is calibrated or orthographic, named component evidence is complete when relevant, and no invalid input remains.

If `buildReady` fails, do not create an attractive but misleading low-quality asset. Return the unresolved capabilities and the smallest useful evidence request. If `buildReady` passes but `deliveryReady` fails, a review draft may be compiled, but label it as such and keep the exact next actions visible.

## Conflict handling

Bind every dimension to a source id, property, status, value, and tolerance. Compare measured/datasheet values for the same property before geometry. A conflict above the declared tolerance or 0.5%/0.1 mm fallback blocks the build until resolved. Estimated values cannot overrule measured or datasheet values.

Photographic shape comparison requires camera calibration with at least four anchors and no more than 4 px reprojection error for the locked proof view. Orthographic technical drawings and metric scans do not need a perspective-camera solve, but their scale and orientation must still be explicit.

## Delivery handoff

Save `morphloom.evidence-pack/0.2` with the source-neutral capability map, dimension observations, camera observations, stable component ids, readiness report, conflicts, and next actions. Then run the compiled-asset gates in [quality-contract.md](quality-contract.md). Evidence readiness and mesh quality are independent: both must pass.
