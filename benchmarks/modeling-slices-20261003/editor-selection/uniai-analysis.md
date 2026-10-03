## Findings from the supplied code

**Yes: an old edit can commit after selection A → B → A.**

`apply()` captures A’s `component`, `draft`, and `source` before hashing. Its eventual guard checks only:

```ts
latest.current === source &&
selected.current === component.id
```

If the IR stays unchanged and the user returns to A, both comparisons pass. Neither records the intervening selection of B. The original edit can therefore commit even though returning to A has reset the panel to `draftFor(A)`.

`busy` and `inFlight` prevent another apply, not selection changes made outside this editor.

**Yes: an old error can appear in the new panel.**

The catch checks only `alive.current`. For example:

1. Apply on A pauses during hashing.
2. Select B; the effect resets B’s draft and clears its error.
3. A’s operation finishes.
4. The selection mismatch throws the stale-result error.
5. The catch writes that error into B’s panel.

After A → B → A, a downstream patch or validation failure from the original operation can similarly populate the newly reset A panel. A successful operation instead has the stale-commit problem above.

## Smallest backwards-compatible fix

Use the existing latest-intent gate to represent **ownership across selection/source transitions**, not merely across apply clicks.

- Keep one gate per editor instance.
- Cancel it on every `ir` or `selectedId` transition and on unmount.
- Begin an intent for an accepted apply.
- Require ownership before committing **and before reporting errors**.
- Keep the existing single-flight lock and its `finally` cleanup.

For example, add `useLayoutEffect` to the React imports and use:

```ts
const [intentGate] = useState(createLatestIntentGate);

useLayoutEffect(() => {
  intentGate.cancel();
  return () => intentGate.cancel();
}, [intentGate, ir, selectedId]);
```

A layout effect invalidates ownership at the committed selection/source transition, without leaving the passive-effect window. Depend on `selectedId` itself, including transitions to no selection; do not rely just on object identity of `component`.

After the existing early-return checks in `apply()`:

```ts
const token = intentGate.begin();
const source = ir;

const ownsResult = () =>
  alive.current &&
  intentGate.isCurrent(token) &&
  latest.current === source &&
  selected.current === component.id;
```

Keep the patch construction and validation unchanged. Replace the final stale-result throw and unconditional error reporting with:

```ts
validateAssemblyIR(next);

if (!ownsResult()) return;
if (next !== source) commit(next);
```

```ts
} catch (e) {
  if (ownsResult()) {
    setError(e instanceof Error ? e.message : 'Component edit failed');
  }
} finally {
  inFlight.current = false;
  if (alive.current) setBusy(false);
}
```

The identity checks remain useful defensive checks; the gate adds the missing transition history. Once A → B cancels the token, returning to A cannot restore its ownership.

Keep `finally` unconditional with respect to the token: under the existing single-flight design, the canceled operation still owns releasing the busy lock. Cancellation need not abort hashing. No public prop, patch schema, geometry, or history-format changes are required.

## Meaningful UI regression coverage

Use the actual selection UI and editor inputs in a parent harness that preserves the same IR object while changing selection. Intercept only `crypto.subtle.digest`: hold an apply-time digest, then release it with its genuine digest result. Let subsequent digests proceed normally.

### 1. ABA must not resurrect a discarded draft

1. Select A and change **Component position X** to a valid, different value.
2. Click **Apply component edit** and hold its digest.
3. Select B and wait until B is displayed.
4. Select A and wait until A displays its original, reset position.
5. Release the digest and let the apply settle.

**Fixed behavior:** no `onCommit`, no position change, no new undo entry, no alert, and busy eventually clears.

**Existing-code failure:** assuming the valid patch passes validation, the old position change commits and reappears in A’s panel despite its visible reset.

Then edit A again and apply normally to verify that cancellation did not leave the editor locked or permanently invalidate future applies.

### 2. Stale completion must not contaminate B’s error panel

Repeat the valid position edit, but select B and stay there before releasing the digest.

**Fixed behavior:** B remains unchanged, no commit, no alert, and busy clears.

**Existing-code failure:** the final selection check throws and displays the old operation’s stale-result error in B’s panel.

This second case exercises error suppression using a successful, merely delayed digest—no fabricated crypto rejection, invalid hidden draft, or injected React state is needed.

These are static findings and proposed regression tests; I have not executed them.
