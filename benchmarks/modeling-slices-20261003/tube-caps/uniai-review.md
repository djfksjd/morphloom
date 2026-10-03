**No definite blocking bug found in the supplied diff.** The changes appear consistent with the stated migration contract. Some guarantees depend on unchanged code not included here; I would verify them with the regression cases below rather than report speculative defects.

### Correctness and compatibility

- The compiler changes only the cap-index branch. With `capWinding` absent, both legacy non-Bezier behavior and existing Bezier behavior retain their previous branch selection.
- Setting the option on a Bezier tube intentionally adds a declaration without changing winding; clearing it preserves Bezier’s already-outward caps.
- Migration deep-clones the geometry, and clearing deletes the property instead of serializing a default. This supports restoration of the original IR representation.
- JSON Schema permits only `"outward"` and rejects `closed: true` when declared. Allowing `closed` to be omitted is correct for an implicitly open tube.
- The new patch explicitly requires `/0.2`, validates its action and allowed keys, and rejects non-tube and closed-tube targets.

### Reachable failures and atomicity

The UI’s cap operation can fail after a scalar or curve patch has already succeeded locally. **That is not itself an atomicity bug:** the intermediate result is held in private `next`, and the cap patch fingerprints that intermediate result correctly.

Under the stated single-commit design, an exception before the final commit leaves the public IR unchanged. This remains contingent on the existing patch implementation not mutating its input and the final UI commit retaining its stale-input/unmount checks. The added lines introduce no additional commit.

Rejecting a clear operation on a closed tube is consistent with the explicitly open-tube editing contract; it need not serve as a repair API for invalid IR.

### Verification gaps—not demonstrated bugs

1. **Compiler-entry validation coverage.** The non-tube rejection is added to `validateAssemblyIR`, whereas the test invokes `compileAssemblyGeometry` directly. Its implementation is not shown. Verify that this public entry point reaches equivalent validation; otherwise the sphere test will expose a real validation hole. Likewise, confirm that tube validation calls `validateTubeQuadraticCurve` even when `curve` is absent, since that now carries cap validation.

2. **Combined UI transaction failure.** Add a test that stages scalar/curve plus cap changes, forces a later failure, and checks zero commits and unchanged source/history. A successful combined edit should commit once and undo in one step. The supplied patch test establishes successful source isolation, not UI failure atomicity.

3. **Legacy byte baseline.** Comparing explicit and undeclared geometries produced by the *new* compiler verifies attribute preservation and unchanged side indices, but does not independently prove historical byte compatibility. A pinned pre-migration fixture/hash would strengthen that promise.

4. **Bezier and negative cases.** Add Bezier set/clear buffer equality, malformed action/extra-key rejection, stale-fingerprint rejection, and closed/non-tube patch rejection.

### Optional next scope

Cap shading, hard-edge normals, degenerate-path handling, and broader topology improvements are separate work. Changing those here would expand the migration and could violate its deliberately narrow buffer-preservation contract.
