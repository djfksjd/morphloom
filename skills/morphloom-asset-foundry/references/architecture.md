# Architecture from drawings

Read plans together with sections, elevations, schedules, and written dimensions when available. Drawing dimensions and annotations outrank pixel-scaled guesses; pixel geometry outranks generic architectural priors.

For a building photograph without a plan, calibrate the visible camera and model visible massing/façades first. Mark footprint, roof, rear, and hidden sides inferred and never set `planFootprintVerified`. This photo branch may produce a detailed visible-façade asset but not a measured building model.

## Footprint first

1. Rotate and crop the drawing so labels and dimensions establish the intended orientation.
2. Trace the outer boundary and every negative space separately: courtyards, light wells, recesses, arcades, stairs, and door openings.
3. Identify returns, wings, and entrance projections before laying out rooms. Record their facade and relative direction explicitly (for example, `side-wings:north`, `center-wing:south`). A single bounding rectangle is forbidden when the source contains voids or projections.
4. Build the floor plate from a polygon with holes or from non-overlapping named slab segments. Verify that empty courts remain ray-visible from plan view.
5. Add the room and circulation layout only after the footprint overlay matches.

Record `planFootprintVerified: true` only after comparing the source plan and a plan-view render. Also attach a `morphloom.plan-footprint/0.1` contract containing source-derived occupied rectangles or simple concave polygons, protected void regions, their evidence, and the named floor carriers that must be tested. Prefer one ordered polygon for a connected non-rectangular shell so its turns and projections are explicit; reject self-intersecting outlines before raster allocation. The compiler must ray-project those actual meshes from above and block delivery when occupied-region IoU, overbuild, underbuild, or void occupancy exceeds the locked tolerance. A metadata boolean, part count, or bounding box is never footprint proof. Preserve the audit fingerprint through GLB export and reopening. Record known void and projection counts plus the directional relationship between projections in metadata. Add a regression test for each signature form feature: named slabs, expected void count, signed or relative coordinates proving that opposite-side projections did not collapse onto the same facade, and deliberately reversed and filled-negative cases that must fail the compiled projection audit.

## Architectural completeness manifest

Before compiling, account for every source-visible item in these groups:

- footprint boundary, setbacks, recesses, courts, wings, entrance projections, overhangs, and level changes;
- exterior and interior walls with actual openings rather than painted door/window textures;
- circulation: entrances, corridors, stairs, landings, lifts, ramps, and egress relationships;
- room/zone boundaries and repeated unit types without filling intentional shared or exterior voids;
- façade rhythm: bays, piers, glazing, frames, sills, heads, balconies, rails, and material transitions;
- sections/elevations: storey height, slab thickness, roof/parapet form, foundation/site relation, and vertical alignment.

If only a plan exists, vertical construction remains estimated. Do not let a detailed floor plan imply surveyed heights, structure, MEP, code compliance, or as-built tolerances.

For evidence-bearing façades, maintain an opening schedule by façade and level: type, count, center position, width/height, sill/head, reveal depth, and proof view. Reconcile plans, elevations, and sections to shared level datums and wall/slab coordinates. When interiors are in scope, validate a circulation graph: entrances reach intended occupied zones, doors create real wall apertures, and stairs/lifts connect declared levels. Unreachable rooms or floating landings block delivery.

## Dimensions and viewer inspection

- Keep drawing dimensions in their source units and convert once into AssemblyIR millimetres.
- Distinguish documented dimensions from image-scaled estimates and assumed vertical values.
- Provide two-point surface measurement for distance and vertical height. Show signed ΔX, ΔY, and ΔZ and allow mm, cm, and m display without changing model geometry.
- Keep the measurement tool enabled and discoverable in architectural review. Two surface picks must produce visible A/B markers, a dimension line, numeric result, and a clear reset/new-measurement path.
- Browser measurement reports the compiled model coordinates; it is not a site survey or construction certification.

Before delivery, smoke-test the actual viewer: reload a building/product result and confirm measurement is on; two valid surface picks show `2/2`, A/B markers, a line, and a non-zero result; changing Beauty/Clay preserves the measurement; Escape resets to `0/2`; a blank pick gives miss feedback without changing the value; M toggles off/on; and the controls/results remain usable at both wide and narrow viewer widths.

## Architectural materials

Separate masonry, concrete, plaster, glazing, metal sash, timber, tile, and room finishes. Give each a distinct PBR response and readable plan-view colour while retaining realistic grazing-angle reflection.

Review the source-aligned plan first, then at least one section-like or elevated view that exposes wall height and openings. Use Clay to catch filled voids and floating rooms; use X-Ray to catch circulation and containment errors.
