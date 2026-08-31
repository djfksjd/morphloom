# Architecture from drawings

## Footprint first

1. Rotate and crop the drawing so labels and dimensions establish the intended orientation.
2. Trace the outer boundary and every negative space separately: courtyards, light wells, recesses, arcades, stairs, and door openings.
3. Identify returns, wings, and entrance projections before laying out rooms. Record their facade and relative direction explicitly (for example, `side-wings:north`, `center-wing:south`). A single bounding rectangle is forbidden when the source contains voids or projections.
4. Build the floor plate from a polygon with holes or from non-overlapping named slab segments. Verify that empty courts remain ray-visible from plan view.
5. Add the room and circulation layout only after the footprint overlay matches.

Record `planFootprintVerified: true` only after comparing the source plan and a plan-view render. Record known void and projection counts plus the directional relationship between projections in metadata. Add a regression test for each signature form feature: named slabs, expected void count, and signed or relative coordinates proving that opposite-side projections did not collapse onto the same facade.

## Dimensions and viewer inspection

- Keep drawing dimensions in their source units and convert once into AssemblyIR millimetres.
- Distinguish documented dimensions from image-scaled estimates and assumed vertical values.
- Provide two-point surface measurement for distance and vertical height. Show signed ΔX, ΔY, and ΔZ and allow mm, cm, and m display without changing model geometry.
- Browser measurement reports the compiled model coordinates; it is not a site survey or construction certification.

## Architectural materials

Separate masonry, concrete, plaster, glazing, metal sash, timber, tile, and room finishes. Give each a distinct PBR response and readable plan-view colour while retaining realistic grazing-angle reflection.
