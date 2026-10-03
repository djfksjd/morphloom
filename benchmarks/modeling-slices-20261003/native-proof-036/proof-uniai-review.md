The fix correctly gates receipt readiness on current quality without claiming geometry or rooms are repaired:

```diff
- const receipt = createBrowserRoundTripAssetReceipt(definition, deliveryAudit);
+ const receipt = createBrowserRoundTripAssetReceipt({
+   ...definition,
+   qualityReleaseReady: definition.qualityReleaseReady && !qualityBlocked,
+ }, deliveryAudit);
```

Add to the dedup condition:

```js
&& previous.qualityReleaseReady === receipt.qualityReleaseReady
```

Update dependencies:

```js
}, [activeAssetId, deliveryAudit, qualityBlocked]);
```

Preserve the existing report boolean/schema and strict benchmark expectation of `true`: Laurel’s new `false` must **FAIL** until actual model quality is repaired. Passing format roundtrip does not establish quality readiness.

Async caveat: dependencies alone do not ensure freshness. Confirm the completed audit and settled quality result belong to the current asset/model revision before publishing or saving. An initial/stale `qualityBlocked === false`, retained audit during asset switching, or SAVE before the effect commits could still expose an incorrect ready receipt.
