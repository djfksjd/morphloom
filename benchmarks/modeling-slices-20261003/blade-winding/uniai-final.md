No remaining blocking issue in the helper or schema shown.

- Two-row sections now work for both set and clear; there is no residual `else`/three-row constraint.
- Opted-in declarations enforce the version, direction, allowed keys, and bounded inputs.
- Clearing removes the declaration without applying the new helper restrictions to legacy geometry.
- The schema’s conditional restrictions correctly apply only when `sideWinding` is present.

Strict section ordering and `thickness >= apexThickness` remain helper-enforced rather than schema-enforced, which is fine provided the helper runs on opted-in geometry before compilation.

Given your reported actual-validator, native-compile, paired position/UV, and historical-hash results, the previous blocker is resolved.