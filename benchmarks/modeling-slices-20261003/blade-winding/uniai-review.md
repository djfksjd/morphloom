**One concrete compatibility defect: clearing winding on a valid two-section blade produces schema-invalid IR.**

Locations: `migrateBladeSideWinding()` and the `bladeLoft` schema’s `allOf` / `else`.

Reproduction:
```ts
const source = {
  op: 'bladeLoft' as const,
  sections: [[0, 10], [1, 10]] as [number, number][],
  thickness: 5,
  apexThickness: 0.2,
};

const enabled = migrateBladeSideWinding(source, true);
const cleared = migrateBladeSideWinding(enabled, false);
```

- `enabled` is accepted by the new schema and runtime, and two-section compilation is explicitly tested.
- Clearing deletes `sideWinding`; runtime validation returns immediately.
- `cleared` violates the published schema: without `sideWinding`, `sections.minItems` becomes **3**.

Thus the public set/clear operation can turn a valid document into an invalid one. The current round-trip test misses this because its fixture has three sections.

**Fix:** reconcile the two-section policy. Either permit two sections in the no-option schema, matching the existing runtime, or reject clearing a two-section blade explicitly and leave the source unchanged. Add a two-section set/clear test that checks the resulting document against the JSON schema.

Otherwise, I see no demonstrated blocking security or winding defect in the supplied change. Paired position/UV corner swaps are consistent with the existing triangle-expanded delivery; they do not imply physical-coordinate changes. Native GLB validation remains pending, not a demonstrated failure.