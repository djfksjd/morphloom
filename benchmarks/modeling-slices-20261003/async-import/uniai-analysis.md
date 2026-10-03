### Minimal fix: a synchronous intent generation

Use a ref counter, not an abort controller: `File.text()` continues, but obsolete results and errors become inert.

```tsx
const importIntentRef = useRef(0);
const invalidatePendingImport = useCallback(
  () => ++importIntentRef.current,
  [],
);

useEffect(() => () => {
  invalidatePendingImport();
  if (importExpiryTimerRef.current !== undefined) {
    window.clearTimeout(importExpiryTimerRef.current);
    importExpiryTimerRef.current = undefined;
  }
}, [invalidatePendingImport]);
```

Place this after the existing timer-ref declaration; consolidate with existing unmount cleanup if present. Cleanup invalidation also handles Strict Mode’s effect replay without a permanently false mounted flag.

### File handler

Replace only the asynchronous wrapper; retain the existing successful-import setters:

```tsx
onChange={(event) => {
  const file = event.currentTarget.files?.[0];
  event.currentTarget.value = ''; // Also reset oversized selections.
  if (!file) return;

  const intent = invalidatePendingImport();
  const isCurrent = () => importIntentRef.current === intent;

  // Invalidate BEFORE validation: invalid latest still supersedes older.
  if (file.size > 2_000_000) {
    setViewerNote('AssemblyIR은 최대 2MB입니다.');
    return;
  }

  void file.text().then((text) => {
    if (!isCurrent()) return;
    try {
      const value: unknown = JSON.parse(text);
      validateAssemblyIR(value);
      if (!isCurrent()) return;

      // Existing successful-import setters, scheduleImportedExpiry(),
      // and success note, unchanged.
    } catch (error) {
      if (!isCurrent()) return;
      setViewerNote(
        error instanceof Error
          ? error.message
          : 'AssemblyIR을 읽지 못했습니다.',
      );
    }
  }).catch((error: unknown) => {
    if (!isCurrent()) return;
    setViewerNote(
      error instanceof Error
        ? error.message
        : '로컬 파일을 읽지 못했습니다.',
    );
  });
}}
```

Canceling the picker without selecting a file need not count as an intent.

### Invalidation sites

Call `invalidatePendingImport()` synchronously:

- **Asset switch:** after both existing early returns, before the first setter. Same-ID and unknown-ID selections remain no-ops.
- **Clear session:** first statement, even when no imported asset is currently active. A second increment through `selectAsset()` is harmless.
- **TTL:** first statement inside the expiry callback, before fallback mutations.
- **Layout edit:** after `selectedPart`/`assemblyIR` checks, before applying the edit; add the callback to dependencies.
- **Component edit:** first statement of `onCommit`, before existing setters.
- **Unmount:** cleanup above.

Do **not** bind expiry validity to the import-intent counter: editing should cancel pending reads, not disable the current session’s TTL.

### Browser regression test

In the test harness, wrap `File.prototype.text`, retaining and calling the original. Gate returned promises by unique fixture filename and expose release controls; do not inject React state or substitute parsed IR.

1. Upload native IR **A**, holding its read completion.
2. Upload distinguishable native IR **B**, also held.
3. Release **B**; await its visible imported result.
4. Release **A**; await its promise handlers draining.
5. Click **SAVE IR**, parse the actual download, and assert B’s identity/components—not A’s.

Add focused cases for oversized and malformed latest selections, stale read rejection, real versus same-ID asset selection, clear session, TTL, both edits, and unmount. Assert stale callbacks change neither exported content nor viewer notes.
