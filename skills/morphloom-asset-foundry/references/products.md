# Products and assemblies

Decompose the visible object by manufacturing and service boundaries: enclosure panels, frames, fasteners, seals, buttons, lenses, bezels, boards, connectors, flex cables, wires, and decorative layers. Preserve gaps and mating interfaces.

Use whichever evidence resolves proportions and interfaces: orthographic drawings, dimensions, datasheets, scans, existing CAD, or multi-view photographs. A dimensioned drawing may replace separate exterior photographs; a BOM and component drawing may replace an exploded image. With only one perspective image, keep hidden depth and rear features inferred. Prefer stronger engineering evidence over visual guessing.

Create a product signature manifest before geometry. Include the overall envelope and corner radii; silhouette breaks; asymmetric controls; camera/lens stack; vents and perforations; seams and panel gaps; fastener count and placement; logos or decoration that change recognition; and every part the intended edit, animation, service, or exploded view must manipulate independently.

Anchor dimensions to stable datums instead of accumulating offsets. Check repeated spacing, bilateral symmetry where evidenced, deliberate asymmetry, flush/offset relationships, minimum clearances, and whether each child part remains inside or attached to its parent. Review front, rear, both sides, top/bottom when evidenced, plus a grazing-light view that exposes edge quality and material response.

Every exterior side must exist and receive a completeness view. Missing evidence permits a neutral inferred back, underside, or rear panel; it does not permit accidental holes or an open-backed asset. Manufactured edges require evidence-appropriate bevel/chamfer treatment, circular profiles must not facet at the proof distance, and grazing highlights must remain continuous.

For electronics, declare ports in component-local coordinates and route conductors between those ports. Preserve physical pin labels, net names, conductor gauge, shielding, and verification status. Graph continuity is not a bench continuity test.

An electronics result does not pass merely because every wire has two endpoints. Confirm connector identity and orientation, pin-to-net mapping, strain relief, bend clearance, conductor attachment after component transforms, and that required ports have exactly the intended occupancy. Mark inferred routing and bench-required continuity separately.

Assign surface finishes by actual material: anodized or brushed metal, coated glass, optical glass/sapphire, solder mask, molded or soft-touch polymer, rubber, leather, wood, and semiconductor package. Inspect reflection at grazing angles and ensure texture scale follows the component size.

When projecting a transparent product photograph, do not sample transparent black RGB at antialiased boundaries. Extend the nearest admitted opaque colour within a bounded pixel budget and keep actual openings as geometry. Classify expanded triangles in assembly space with the signed source-camera axis: project the plate only onto genuinely source-facing caps and rounded bevels, while tangent walls and the hidden hemisphere retain authored UVs and a separately marked `unobserved-side` material. That fallback must not reuse strong directional micro-normal/anisotropy that turns the projection boundary into stripes. Copying or mirroring one broadside photograph around the thickness remains a fidelity defect.

A photographic plate already contains illumination. Before using it as light-responsive PBR base colour, estimate a downsampled low-frequency lighting field in linear light, remove it conservatively, preserve global exposure and high-frequency colour/detail, and record the field size, correction range, clipping fraction, and capped confidence. Reject correction clipping above 2%, robust-luminance regression above 0.015, malformed metrics, or any same-view material regression. Then apply bounded diffuse-energy compensation from authored linear luminance and metalness so the new studio rig does not wash out pale dielectrics. Keep every step deterministic and recorded; never replace normal/roughness response with an unlit screenshot merely to improve a comparison score.

Visible cameras, lenses, indicators, and displays require physical layering—bezel, recess, cover glass/window, optical or emissive layer, and source state where evidenced. A flat dark or glowing patch does not substitute for an optical stack. Inventory visible labels, legends, icons, engravings, and regulatory marks; preserve orientation/mirroring and mark unreadable copy uncertain rather than fabricating it.

For movable parts, record pivot/axis, travel limits, endpoint poses, clearances/collisions, and cable behavior after motion. Service/exploded assets additionally require an assembly dependency order and a plausible removal path.

Do not spend polygons uniformly. Prioritize source-defining silhouette, interfaces, lenses, controls, blade/edge profiles, engravings, and gaps before hidden generic board detail. A single-image exterior can be a strong visualization asset, but internal service or manufacturing claims require teardown/datasheet evidence.

For continuous ergonomic grips, molded housings, blended fillets, and evidence-supported recessed sockets that cannot be expressed as one manufactured primitive, use a bounded `implicitSurface` graph. Preserve separate functional parts instead of merging the whole assembly into one field. Require padded sampling bounds, a recorded triangle budget, and a manifold compiled result; a smooth render does not excuse an invalid shell.
