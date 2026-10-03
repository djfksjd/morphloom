1. **Preserve the absent-option path exactly.** Keep the existing facing calculation, UV values, groups, and `userData` unchanged when orientation is absent; even adding default-orientation metadata can break byte compatibility.

2. **Validate before mutating geometry.** Reject unknown schema values, directions, fields, and non-boolean `flipU`. Apply migration by deep-copying only an explicitly opted-in projection, so shared IR is not modified.

3. **Separate face selection from UV policy.** Multiply `signedFacing` by the requested direction for material selection, without changing the `0.05` cutoff. Define whether `flipU` affects only the photograph-facing triangles; reflecting rear-cap or authored edge UVs could alter the procedural fallback.

4. **Check normals and tangents.** A negative-facing choice does not require flipping geometry normals or winding. If the mesh has a `tangent` attribute, reflected U changes tangent handedness; stale tangents can break normal mapping.

5. **Fix the rejection ownership path.** For indexed input, `mesh.geometry` is assigned the new geometry before validation, but `rejectProjection` disposes it while leaving the mesh pointing at it. Restore `source` on failure (and dispose the temporary geometry); avoid disposing caller-shared source geometry on success unless ownership is guaranteed.