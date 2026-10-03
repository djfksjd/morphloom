Proposal is sound; keep metrics tied to the validated beauty artifact, not preview material.

- Await projection completion in `generateGlb`, then refresh surface metrics before detaching them. Ensure the pre-export fingerprint still describes the audited geometry if projections mutate it.
- Cache `{bytes, audit, metrics}` atomically under the source fingerprint; cache hits must return metrics too. Detach nested metric data before `finally` disposes the build.
- Guard both cache publication and callbacks against stale source/revision and unmount. A sequence guard only around callbacks still lets an older completion overwrite the cache.
- Emit `onQualityMetrics` before `onDeliveryAudit`, rechecking validity if callbacks can trigger edits.
- Clear `buildMetrics` on source-changing commits, not material switches. Use a stable callback without stale captured state.
- Confirm disposal cannot invalidate shared preview/cache resources; projection work must finish before disposal, including failure paths.

No additional compile or GLB/schema/version changes are needed.