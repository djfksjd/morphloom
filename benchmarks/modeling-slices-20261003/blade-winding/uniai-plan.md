**Verdict: the winding change is correct.** No blocker in the approach itself, provided the opt-in validator excludes collapsed geometry and compatibility is tested at the actual byte boundary.

### Geometry convention

Using local-space triangle normals `(b − a) × (c − a)`, ascending `y`, positive widths, and positive front/back separation:

- Front triangles point toward **+z**; back triangles toward **−z**.
- First-row cap points toward **−y**; last-row cap toward **+y**. Leave these unchanged.
- Current left walls have a **positive x** normal component; right walls have a **negative x** component: both inward.
- Swapping the second and third indices of **each side triangle only** fixes them, including tapered sections. Retain the existing diagonals.

This is a local-space winding guarantee, not a guarantee under arbitrary transforms or custom renderer culling conventions.

### Potential blockers

1. **Bounds alone do not prevent degenerate geometry.**  
   Define and validate finite numeric limits and the generated half-depth:
   ```text
   h[j] = halfApex + (halfStock − halfApex) * grindCurve[j]
   ```
   Require `h[j] > 0` for all five samples if the opt-in promises a nondegenerate closed blade. In particular, zero apex thickness plus a zero edge sample collapses a side wall; reversing indices cannot repair it. Positive stock/apex thickness is one sufficient route, but not the only one.

   Upper bounds and strictly ascending source `y` also do not prevent distinct coordinates collapsing after conversion to `Float32`. Use representable minimum dimensions/separation or reject degenerate generated triangles.

2. **“Reverse only sides” must not mean “only side normals change.”**  
   Vertices are shared with front/back surfaces and caps. Recomputing vertex normals changes averaged normals at shared boundary vertices too. That is expected; do not split vertices or introduce hard edges as part of this repair.

3. **Keep compatibility scope explicit.**  
   Apply new geometric restrictions only to the opted-in path if previously accepted no-option inputs must remain supported. With the option absent, preserve the existing generation and serialization paths. Changing the default ornamental-knife preset is an intentional opt-in fixture change—not permission to migrate existing saved knives.

### Minimal release-gating tests

- **Orientation:** constant-width and tapered/asymmetric-section fixtures with asymmetric grind samples. Assert front/back normal signs, cap signs, and outward side **x** signs using triangle cross products, not averaged vertex normals.
- **Exact edit:** enabled versus disabled has identical positions and counts; only side triangle winding differs, by one index swap per triangle. Check finite recomputed normals.
- **Closure:** for a valid positive-depth fixture, every indexed edge has two incident faces traversing it in opposite directions. This catches side-to-surface winding mismatches.
- **Validation boundaries:** 2 and 512 rows accepted; 1 and 513 rejected; duplicate/decreasing `y`, nonpositive width, nonfinite/out-of-bounds dimensions, invalid sample count/range, collapsed depth, and Float32 collapse rejected. Reject unsupported option versions/directions.
- **Compatibility and lifecycle:** golden no-option bytes; Patch0.2 set/clear round-trip; Undo restores option absence; save/reload preserves presence or absence. Default ornamental knife contains the opt-in, while its existing flat tube caps remain unchanged.

No additional CAD or reference-accuracy work is needed for this bounded winding repair.