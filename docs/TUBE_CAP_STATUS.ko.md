# Explicit outward tube caps: verified step

After 6dec419, inward legacy cap winding was reproduced by 5 failing tests. Add optional tube `capWinding: 'outward'` and open-tube component-patch/0.2 `tube-cap-winding` set/clear. `migrateTubeCapWinding` deep-copies geometry; clear deletes only this option. Assembly 0.1/job compatibility stays intact. This capability requires compiler 0.34.0; an older compiler is not a verified downgrade path. Unsupported values, non-tubes, closed paths, extra patch keys and old patch versions fail.

The component editor exposes an explicit cap declaration independently of the curve option. Curve/cap/scalar updates are private candidates and commit once. Cancel/undo/redo/native reopen were checked using actual viewport selection and buttons. A combined invalid curve/position/cap draft made zero commits; a valid combined change undid in one step.

Only cap triangle index order changes. Position/normal/UV/side indices and materials remain unchanged. Rotated two- and three-point paths at 0.5/1/2 scales have normalized cap orientation >0.99 and closed manifold topology. Existing Bezier set/clear is byte-identical. Actual legacy fan 101 geometry buffers match c9fcc5b, and no-option whole fan GLB bytes match 6dec419.

Published tests: 93 files / 666 tests PASS. User workspace: 96 files / 685 tests PASS. Check/build/benchmark PASS. Khronos five actual files errors=0 warnings=0. Blender four before/after variants and the normal UI export reopened successfully. Actual Blender target directed-edge inconsistency: diagnostic tube 32 -> 0; fan cage-rear-spoke-1 12 -> 0. Fan edit preserves other100 component mesh payloads. Original failed orientation reports are retained.

This does not migrate other tubes automatically or certify whole fan fidelity. Shared rim normals still bend cap shading; flat cap normal splitting/UV is the next step. Current global gate first exposed stale browser proofs after compiler revision; fresh seven-case browser export/reopen proofs now PASS and are recorded for0.34. Cross-domain native receipts still belong to 0.33, not this revision. Existing cooling UV info23 gate failure remains unresolved. No gate thresholds are weakened.

Artifacts and commands are recorded under benchmarks/modeling-slices-20261003/tube-caps; actual native IR and exported GLB bytes are in assets.zip, hashes in SHA256SUMS. UNI_AI gpt-6-astra gave two analysis/review proposals; actual tests and imports are separate evidence. No private photos or keys were sent.
