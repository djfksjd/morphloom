# Front guard wire profile: bounded verification

The new optional quadratic tube path and local editor are verified. The fan remains an estimated reference asset; global release is blocked. See [verification.json](verification.json) and [status](../../../docs/GUARD_PROFILE_STATUS.ko.md).

[assets.zip](assets.zip) contains native IRs, actual exported GLBs, UI undo/redo states, Blender wire edit outputs and source attribution. [SHA256SUMS](SHA256SUMS) covers every public artifact. Input canonical hashes use JSON.stringify(parsed IR); input file hashes are recorded separately.

Same camera, light and 1024-square render pairs:

| View | Before | After |
|---|---|---|
| Side clay | [flat](flat-side-clay.png) | [domed](domed-side-clay.png) |
| Isometric clay | [flat](flat-front-iso-clay.png) | [domed](domed-front-iso-clay.png) |
| Wireframe | [flat](flat-front-iso-wire.png) | [domed](domed-front-iso-wire.png) |
| Actual wire close-up | [flat](flat-wire-closeup.png) | [domed](domed-wire-closeup.png) |

30 mm rise is authored/estimated, not measured from photos. Render side/rear inspection does not certify unseen geometry.

Commands actually run: npm test; npm run check; npm run build; npm run benchmark; npm run quality:gate; npm run quality:production; npm run benchmark:dominance -- --require-claim. Pilot and browser/file/DCC scripts are in scripts/guard-profile-*. Logs include failed attempts and final results. Native app regressions are in regression-*.json.

PASS: published 655 tests; source workspace 674 tests; build/check; Khronos five actual files; Blender four variants plus regular UI GLB; individual wire edit and two reopens; seven browser and five cross-domain native regressions.

FAIL: unchanged cooling UV infos=23 vs existing infos=0 gate; production dominance has no comparison cases. NOT-RUN: calibrated photo fit, full fan fidelity, fan-specific apps besides Blender, Unity current, CAD and independent expert approval. Legacy tube cap winding is a known remaining defect; existing buffers were preserved. No thresholds were lowered.
