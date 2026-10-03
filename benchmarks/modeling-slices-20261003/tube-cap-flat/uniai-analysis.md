## Recommended bounded design

Proceed as an **opt-in attribute/index split**, not a path or material change. The shown code supports outward winding only; finish support requires explicit IR, validation, compiler, patch, and UI changes.

### Contract and compatibility

- Add optional `capFinish?: 'flat-outward'`, advertised by compiler **0.35**.
- Add patch **0.2** operation `tube-cap-finish` with explicit set/clear semantics. Set writes only `capFinish`; clear deletes only that property.
- Effective outward winding becomes:
  ```ts
  geometry.capFinish === 'flat-outward'
    || geometry.capWinding === 'outward'
    || Boolean(geometry.curve)
  ```
- Never implicitly write/delete `capWinding` or `curve`. Clearing finish restores their existing behavior—including legacy winding when neither is declared.
- Keep the absent-finish generation path unchanged, with byte-level regression tests. Consumers lacking the capability must reject a declared finish rather than silently ignore it.

### Geometry implementation

Let `N = sourcePosition.count`, `R = radialSegments + 1`.

Preserve source vertices `[0, N)` and existing centers at `N` and `N+1`. For flat finish, append:

- Start cap ring at `N+2`, copied from source ring `0`.
- End cap ring at `N+2+R`, copied from source ring `tubularSegments*R`.

Copy positions exactly, including each seam duplicate. Preserve all original side attributes and center values; center UVs remain `(0.5, 0.5)`.

Use TubeGeometry’s already-computed endpoint Frenet frames, not separately reconstructed frames. Assign every appended start-ring normal the existing outward start-center normal, and likewise at the end. Verify these normals agree with the frame tangents.

For each copied ring position `p`, endpoint center `c`, frame normal `n`, binormal `b`, and radius `r` in **the same local units**:

```text
u = 0.5 + dot(p − c, n) / (2r)
v = 0.5 + dot(p − c, b) / (2r)
```

Both cap charts intentionally overlap/tile; this is not an atlas or a promise of matching outward-view texture orientation.

Leave all lateral indices untouched. Keep center indices unchanged, but redirect cap rim indices to the appended rings and use outward winding. Do not call `computeVertexNormals()` or change smoothing/material settings.

Positions, bounds, triangle count, and occupied surface remain unchanged; vertex count and cap indices change, and legacy cap orientation is intentionally corrected.

### Validation and UI

Validate before closed-tube early return. Reject unknown finish values, malformed declarations, unsupported patch fields/actions, wrong target geometry, and any declared finish on `closed` values other than absent or `false`.

Patch execution should clone, apply, then validate the **whole resulting tube**, including existing curve/winding declarations, finite path/radius, safe segment counts, and usable endpoint frames. Clear must not bypass result validation. Enforce capability/version checks transactionally.

Expose an independent **Flat cap finish** checkbox. Explain that it implies outward winding while enabled; preserve the independent winding declaration even when its effect is temporarily redundant.

### Real risks and tests

- **Curved paths:** Catmull–Rom cusps, tight bends, and self-intersections remain possible; flat shading does not repair them. Reject nonfinite/degenerate endpoint frames without rewriting the path.
- **Tangents:** UV seams require distinct cap vertices. If tangent-space materials are supported, preserve side tangents and generate cap-consistent tangents separately; never copy lateral tangents blindly.
- **Reference-projected surfaces:** downstream projection/deformation can make endpoint rings nonplanar or separate duplicates. Local flat caps do not guarantee projection conformance; test the actual pipeline before claiming support.

Test legacy/outward/quadratic absent-finish byte identity; set/clear round trips and immutability; exact preserved prefixes/centers; vertex/index counts; bounds; cap normal uniformity; winding cross-products; UV formula/seams; straight and curved endpoints; invalid/closed/unknown inputs; capability rejection; and index-width promotion when appended vertices exceed 16-bit capacity.
