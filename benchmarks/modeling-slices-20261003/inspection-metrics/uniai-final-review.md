No definite blocking lifecycle, type, renderer, or cache defect is established by this diff.

- Layout-effect invalidation closes the commit-to-passive-cleanup publication window; passive cleanup still cancels timers.
- Both cache writes and audit publication are sequence-guarded. The second check protects against synchronous invalidation inside `onQualityMetrics`.
- Quality metrics come from the beauty build, not the active preview renderer, and are detached before that build is disposed.
- Release readiness now requires a passing delivery audit and completed verification.

Two checks remain outside the supplied context: whether metrics contain any other prototype-dependent or non-cloneable values beyond the restored `Box3`/head vectors, and whether another `onBuilt` path can overwrite validated quality metrics after a renderer-mode change. Neither can be classified as a blocker from these hunks alone.

The existing audit delay is unchanged. This is static review only.