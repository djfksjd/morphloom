The smallest safe change is to extend the existing **position-welded edge audit**, leave the legacy closure calculation untouched, and expose winding failure through a separate blocking quality check.

### 1. Add optional report fields

Add these to both `MeshTopologyReport` and its detail entry type:

```ts
/** Two-incident edges whose triangles traverse the edge in the same direction. */
inconsistentWindingEdges?: number;
/** Local winding coherence only; does not establish outward orientation. */
orientationConsistent?: boolean;
```

Keep them optional for existing report producers and fixtures, but always populate them in newly analyzed reports.

### 2. Count incidence and signed direction together

Replace the edge map value with:

```ts
type EdgeIncidence = {
  count: number;
  balance: number;
};

const edges = new Map<string, EdgeIncidence>();
```

Within the existing triangle loop:

```ts
for (const [from, to] of [[ia, ib], [ib, ic], [ic, ia]]) {
  const key = edgeKey(from, to);
  let edge = edges.get(key);
  if (!edge) {
    edge = { count: 0, balance: 0 };
    edges.set(key, edge);
  }

  edge.count += 1;
  edge.balance += from < to ? 1 : from > to ? -1 : 0;
}
```

Then classify edges:

```ts
let meshBoundary = 0;
let meshNonManifold = 0;
let meshInconsistentWinding = 0;

for (const { count, balance } of edges.values()) {
  if (count === 1) meshBoundary += 1;
  if (count > 2) meshNonManifold += 1;
  if (count === 2 && balance !== 0) meshInconsistentWinding += 1;
}
```

Add an aggregate counter and populate both levels:

```ts
// Function scope:
let inconsistentWindingEdges = 0;

// Per mesh:
inconsistentWindingEdges += meshInconsistentWinding;

// In details.push(...):
inconsistentWindingEdges: meshInconsistentWinding,
orientationConsistent: meshInconsistentWinding === 0,

// In the returned aggregate:
inconsistentWindingEdges,
orientationConsistent: inconsistentWindingEdges === 0,
```

**Do not add winding to `watertight`, `watertightMeshes`, `pass`, or `topologyScore`.** Their existing meaning remains intact.

### 3. Add a separate blocking quality check

For backward compatibility, absent winding fields should mean **unreported**, not failure or verified coherence:

```ts
const windingFailed =
  topology?.orientationConsistent === false
  || (topology?.inconsistentWindingEdges ?? 0) > 0;

const windingKnown =
  topology?.orientationConsistent !== undefined
  || topology?.inconsistentWindingEdges !== undefined;

const windingCheck: QualityCheck = {
  id: 'winding',
  label: '삼각형 방향 일관성',
  score: windingFailed ? 0 : 100,
  status: windingFailed ? 'blocked' : windingKnown ? 'pass' : 'warn',
  detail: windingFailed
    ? `삼각형 방향 불일치 · 문제 에지 ${topology?.inconsistentWindingEdges ?? '—'}개`
    : windingKnown
      ? '두 삼각형 공유 에지의 방향 일관성 확인 · 외향 여부는 판정하지 않음'
      : '방향 일관성 검사 정보 없음',
};
```

The check must participate in the existing blocked-status path feeding `qualityBlocked`; do not rely on its numeric score to stop delivery.

If “not averaged” means preserving the existing numeric average exactly, calculate that average from the original checks, then append `windingCheck` **before** computing blocking status:

```ts
const base = checks.reduce((sum, check) => sum + check.score, 0)
  / checks.length;

checks.push(windingCheck);

const hasBlockingCheck = checks.some((check) => check.status === 'blocked');
// Retain the existing blocked cap and downstream qualityBlocked logic.
```

Apply this at the relevant evaluator’s actual finalization point—the excerpt does not show the end of `evaluateProductQuality`. No new gate threshold or schema field is needed.

### Small implementation pitfalls

- **Preserve position-only welding.** `mergeVertices` considers attributes. Welding the original geometry would retain hard-normal/UV splits and incorrectly treat shared physical edges as boundaries. The current position-only copy is the correct basis.
- **Use the cyclic triangle edges:** `a→b`, `b→c`, `c→a`. Using `a→c` for the final edge introduces false winding failures.
- **Classify only `count === 2`.** A boundary edge has nonzero balance naturally. Non-manifold edges remain a separate condition regardless of their balance.
- **Do not skip degenerate triangles as part of this patch.** That would alter legacy incidence counts. Equal endpoints contribute zero direction; degeneration remains independently reported.
- **Do not infer direction from normals.** Authored normals, smooth shading, and material sidedness do not establish triangle winding.
- **Do not change welding tolerance or mutate source geometry.** This remains a positional topology audit with the existing coincident-surface and tolerance limitations.
- **Coherence is not outwardness or closure.** Globally reversed components remain coherent; coherent open surfaces may also report `orientationConsistent: true`.
- Existing cleanup can separately dispose `positionsOnly` after `mergeVertices`; avoid broadening this fix into geometry-processing changes.

### Targeted regression tests

| Fixture | Expected winding result | Legacy behavior |
|---|---|---|
| Standard `BoxGeometry`, retaining hard normals and UV seams | `0`, consistent | Existing closed/pass result unchanged |
| Same box with exactly one triangle reversed | **`3`**, inconsistent | Boundary/non-manifold counts remain `0`; legacy `pass` stays true |
| Every triangle of a closed box reversed | `0`, consistent | Legacy report unchanged; no outward claim |
| Coherent open two-triangle patch | `0`, consistent | Boundary edges still reported |
| Same patch with one triangle reversed | **`1`**, inconsistent | Same boundary count |
| Single triangle | `0`, consistent | Three boundaries; no winding error |
| Three triangles sharing one edge, otherwise distinct edges | Shared edge excluded from winding count | One non-manifold edge |
| Indexed and non-indexed versions of these fixtures | Equivalent results | Equivalent legacy fields |
| Multiple meshes, one inconsistent | Aggregate equals detail sum; aggregate false | Existing per-mesh accounting unchanged |

Also cover:

- Deliberately duplicated positions with different normals/UVs, including a reversed triangle across a seam.
- Degenerate/repeated-index triangles without changing prior degeneracy/incidence results.
- Visibility and mesh-filter exclusions affecting the new totals identically to existing totals.
- Source index and attribute arrays unchanged by analysis.
- Old report fixtures lacking both fields: no new blocker and no “verified” claim.
- One winding failure among otherwise perfect quality checks: winding status `blocked`, existing `qualityBlocked` true, existing blocked cap retained.
- Coherent winding: original numeric average unchanged if the check is excluded from averaging.

These are proposed implementation and test expectations; no execution or verification is claimed.
