## Static review

Reviewed only the supplied diff and tests; no execution claims.

### Definite bugs

**No definite implementation bug established from the supplied excerpt.** Several important acceptance conditions remain unproven, particularly legacy byte compatibility and atomic UI edits. Unchanged compiler/editor code is needed to verify those fully.

### Geometry and resource assessment

- **Vertex-buffer bounds look correct.** Let `N = sourcePosition.count` and `R = radialSegments + 1`. Flat mode allocates `N + 2 + 2R` vertices, retains the two existing center slots, and starts duplicated rings at `N + 2` and `N + 2 + R`. The final write/index is `N + 2 + 2R − 1`, exactly the last allocated vertex. This assumes the standard TubeGeometry layout and matching position/normal/UV counts.
- **Normals and winding are internally consistent, conditionally.** Duplicated cap rims receive the endpoint tangents, and flat mode selects the existing outward fan ordering. Verify the omitted setup negates the start tangent and gives both center normals the corresponding outward tangent. The supplied face-normal assertions are useful coverage for this.
- **UV projection uses the appropriate endpoint frame.** Projecting rim offsets onto TubeGeometry’s normal/binormal plane and dividing by diameter creates disk coordinates around `(0.5, 0.5)`. Overlapping endpoint charts are explicitly documented. Using the same frame convention at both ends can give opposite handedness relative to their outward normals; that is not inherently a bug, but should be intentional for normal-mapped materials.
- **Frame validation is incomplete as a geometric invariant.** It checks finite frame values and unit tangent length, but not unit/orthogonal normal and binormal vectors, finite projected positions, or cap area. This is a hardening opportunity, not a demonstrated failure on the supplied fixtures.
- **Disposal:** the new explicit singular-frame rejection disposes `tube`. Successful disposal and cleanup on other exceptions cannot be confirmed from the truncated function. The main test’s cleanup begins after compilation, so an exception during the second compilation would bypass disposal of the first geometry.
- **16-bit boundary:** the proposed fixture has 65,520 side vertices and 65,782 total vertices, requiring 32-bit cap indices. Allocation alone does not ensure promotion; confirm final index construction uses Three.js’s adaptive `setIndex(number[])` or equivalent rather than a fixed `Uint16Array`.

### Next-step suggestions / acceptance gaps

1. **Prove mandatory no-option legacy byte compatibility.** Current fixtures all declare `capWinding: 'outward'`; comparisons are against the current compiler and use numeric arrays, not historical bytes. Add pre-change goldens for tubes with neither cap option, including straight, multi-point, quadratic, and closed paths. Compare typed-array types and raw position/normal/UV/index bytes. Also verify set-then-clear restores those exact buffers.

2. **Strengthen geometry assertions.** Assert every index is an integer in `[0, position.count)`, all attributes are finite and have matching counts, cap centers have `(0.5, 0.5)` UVs, and duplicated rims match the intended planar projection—not merely `[0,1]`. Test just below and above the index-width transition and maximum supported subdivisions.

3. **Expand malformed-input coverage.** Added validation rejects unsupported finishes, closed paths, invalid dimensions/subdivisions, and near-coincident adjacent points. Tests cover only unknown finish and closed mode. Add malformed vectors, nonfinite coordinates, repeated points, collapsed/cusped quadratic endpoints, and an endpoint-repeating path with `closed: false`. Confirm schema, runtime compiler validation, and migration behavior agree where intended.

4. **Verify atomic UI transactions.** Sequentially patching local `next` with refreshed fingerprints is compatible with atomic publication, but does not prove it. Add UI tests combining curve, winding, and finish edits: exactly one commit/history entry; no commit if a later patch fails; undo restores all changes together; selection changes, external IR updates, and unmounts suppress stale commits. Confirm clearing flat finish preserves independent winding and curve declarations.
