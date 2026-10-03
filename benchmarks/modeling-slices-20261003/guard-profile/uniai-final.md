I found two concrete remaining defects in the changed code:

1. **A tube-point patch can collapse geometry without being rejected.** In `applyGeometryPatch`, `tube-point-deltas` calls `validateTubeQuadraticCurve(result)`, but that validator returns immediately when `curve` is absent. A valid open tube can therefore be patched so its two endpoints coincide, or its coordinates become non-finite through addition to existing values. The patch returns an IR and receipt rather than rejecting the unsafe geometry. Validate the resulting tube points and non-degenerate path independently of the optional curve.

2. **Failed browser audits leave diagnostic downloads behind.** `guard-profile-browser-evidence.js` appends a GLB link during each iteration. If a later fixture or the final preservation check fails, `finally` disposes Three.js resources but neither removes those links nor revokes their object URLs. The page can then offer downloads from an audit that did not pass. Retain the links and URLs for cleanup on failure, or publish them only after all checks succeed.

This is a review of the supplied public code, not production approval or a claim of shape accuracy.