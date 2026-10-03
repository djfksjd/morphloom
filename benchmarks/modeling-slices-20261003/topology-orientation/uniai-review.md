## Blocking finding

**Known winding failures become non-blocking when the companion optional field is missing — `evaluateProductQuality`, `windingReported` / orientation status.**

`windingReported` requires both fields, so these reports receive `warn` rather than `blocked`:

```ts
{ inconsistentWindingEdges: 3 } // Explicit conflicts, boolean absent
{ orientationConsistent: false } // Explicit failure, count absent
```

This treats affirmative failure evidence as merely an old, unmeasured report. Consequently, the orientation row does not trigger the blocking score cap even though a winding failure is reported.

**Required fix:** separate failure evidence from completeness:

```ts
const validWindingCount =
  typeof windingCount === 'number'
  && Number.isSafeInteger(windingCount)
  && windingCount >= 0;

const windingFailure =
  (validWindingCount && windingCount > 0)
  || topology?.orientationConsistent === false;

const windingPass =
  validWindingCount
  && windingCount === 0
  && topology?.orientationConsistent === true;

const windingStatus: QualityCheck['status'] =
  windingFailure ? 'blocked' : windingPass ? 'pass' : 'warn';
```

Keep both-absent historical reports as `warn` / not-run. Update the detail text so partially reported failures are not described as not-run. Add regression cases for each partial failure above and both contradictory complete pairs (`0/false`, positive count/`true`); all should block.

## Other reviewed areas

No additional blocking fix is evident in the supplied excerpt:

- Self-edges contribute zero direction balance; degeneracy independently prevents unsigned closure from passing.
- Incidence greater than two is classified as non-manifold, not additionally as a two-incident winding conflict.
- Historical `pass` / `watertight` semantics remain unchanged. Zero conflicts and global reversal have the stated local-only meaning.
- The added edge accounting remains linear in triangle count with linear edge storage; nothing shown establishes a blocking performance regression or warrants changing weld/degeneracy thresholds.
- Taking the stated `.36` metadata binding as given, no additional revision change is requested.

Static review only; no execution or test-pass claims.
