## Verdict

The design is appropriately bounded. The smallest robust fix is an **explicit declaration plus a cap-index branch change**, not regenerated normals, duplicated vertices, or altered materials. This is a source review only; I have not executed tests or imports.

## Issues to resolve

1. **“Absence retains legacy” needs qualification.** Existing quadratic tubes already have outward caps without `capWinding`. Preserve that behavior:
   ```ts
   const outwardCaps =
     Boolean(geometry.curve) || geometry.capWinding === 'outward';
   ```
   Clearing `capWinding` restores the existing behavior for that path; it does **not** make quadratic caps inward. No-option compatibility means byte identity against the current compiler, including existing quadratic tubes.

2. **The checkbox must represent the declaration, not effective winding.** Initialize it from `capWinding === 'outward'`, independently of `curve`. Label it “Explicit outward cap winding,” with a note that quadratic paths already use outward caps. Show it for all open tubes, including multi-point paths. Unchecking means deleting the property—not storing `false`, `"legacy"`, or `undefined`.

3. **The current batch API cannot combine these edits on one component.** It rejects duplicate component targets and supports only one geometry operation per edit. Do not weaken that invariant. Apply two ordinary `/0.2` patches to a private candidate, chaining fingerprints, then commit once.

4. **The acceptance dot product must use normalized vectors.** Raw cross products scale with triangle area and cannot satisfy a scale-independent `>.99` threshold.

## Smallest implementation

- Add `capWinding?: 'outward'` to tube IR and the corresponding strict schema, without defaults or automatic migration.
- Add a small shared runtime validator:
  - absence is valid;
  - every other value except `'outward'` is rejected;
  - when declared, `closed` must be absent or exactly `false`;
  - declaration on non-tubes is rejected by the geometry schema/runtime dispatch.

  Call it from assembly validation and the tube compilation/path entry so direct compilation cannot silently ignore invalid declarations on closed tubes. Keep existing legacy validation behavior unchanged when absent; do not impose quadratic two-point restrictions on cap edits.

- Add a deep-copy migration helper that sets `'outward'` or deletes only `capWinding`, then validates the result. Preserve curve, points, segment counts, and every unrelated field.

- Extend geometry patches with:
  ```ts
  { operation: 'tube-cap-winding'; action: 'set' | 'clear' }
  ```
  No value payload is needed for the sole supported setting. Require `/0.2`, including through batch dispatch. Validate exact allowed keys and action, reject malformed runtime objects, non-tubes, and closed-tube targets for both actions. Clone, set/delete, validate. Retain existing stale-fingerprint, isolation, and no-op rejection gates.

- Change **only** the compiler’s `if (geometry.curve)` condition to `if (outwardCaps)`. Preserve allocation sizes, attributes, triangle ordering, index construction/type, side indices, and disposal.

- In the editor, construct only genuinely changed operations. Apply scalar/material changes once, curve and cap changes sequentially against the private candidate, with each subsequent expected fingerprint taken from the prior receipt. Validate the final assembly; check source, selection, and mounted state; commit once. Any failure discards everything. Preserve Cancel-before-Apply and one-step undo/redo. An invalidation generation counter would additionally prevent selection-away-and-back races that the current final ID comparison misses.

## Required evidence

- Byte-compare index and attribute buffers against baseline for undeclared legacy straight/multi-point tubes, existing quadratic tubes, and closed tubes.
- For cap-only opt-in, assert exact equality of positions, normals, UVs, side indices, materials, and unrelated components. Only cap triangle vertex order may differ.
- For every cap triangle, reject degeneracy separately, then test:
  ```text
  normalize((b-a) × (c-a)) · endpointOutwardUnitTangent > .99
  ```
  Use start negative/end positive path tangents in the same coordinate space. Cover rotated two-point and multi-point paths at three uniform scales, plus quadratic compatibility. Do not assume the two-point Catmull–Rom endpoint tangent from a world axis.
- Test invalid values, unknown patch keys, schema versions, closed targets, clear semantics, migration immutability, combined-edit failure, stale results, cancellation, and undo.
- Export actual GLB artifacts and inspect actual Blender imports for cap visibility, winding, and unchanged surrounding geometry; record evidence rather than substituting exporter mocks.

Shared rim normals can still produce imperfect cap shading. Keep splitting/shading separately scoped unless actual import evidence demonstrates it is necessary for the stated winding acceptance—not merely cosmetic improvement.
