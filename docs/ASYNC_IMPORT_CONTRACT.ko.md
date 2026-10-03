# Last-intent-wins native import contract

Next step after flat cap verification: prevent an earlier File.text result/error from overwriting the latest imported asset, current user edit or real asset switch. Reproduce with two actual local native IR uploads whose file read promises are controlled in a browser test; use actual UI selection/save to inspect state. No React state injection.

Before implementation: latest accepted input intent owns publication. Stale successes and failures are ignored; invalid newer input invalidates old pending input while preserving current IR. Real asset switches, edits, clear-session/TTL and unmount invalidate prior input. No source geometry/IR/schema/gate changes and no new dependencies. Existing imported session TTL and no-upload behavior are preserved.

Acceptance: reverse-order A/B resolve leaves B; old failure cannot replace B status; newer invalid input cannot be replaced by old A; intervening edit/switch stays current; unmount cannot publish. Fresh unit test plus actual browser native saves and source hashes. No extra GPU sessions; resource checks are sequential. <=3 UNI_AI completions;45-minute checkpoint. Continue next measured defect after proof.
