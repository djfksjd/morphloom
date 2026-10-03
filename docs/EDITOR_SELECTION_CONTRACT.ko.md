# Component selection intent contract

Next after native import step: reproduce an old A edit committing after real selection A -> B -> A while SHA-256 is pending; separately check whether stale A completion writes an error into current B panel. This is currently a static concern, not yet a confirmed UI defect.

Freeze before implementation: every committed selection/source transition permanently invalidates the previous apply intent, even if the same ID returns. Suppress stale commits and errors. Keep one in-flight operation, release busy after it settles, preserve valid future apply/Undo/Redo and non-target components. No IR/patch/compiler/geometry/schema/dependency changes. Reuse latest-intent gate; invalidate in layout effect, not render mutation. Current errors still visible.

Prove with two actual selectable components, real editor inputs/canvas clicks and SAVE IR. Hold exactly one real SHA-256 digest result; do not inject React state or replace hash bytes. Before: save obsolete apply/alert failure. After: ABA no commit, one-way change no alert, normal new edit+Undo/Redo/save/reopen and unaffected B preserved. Budget45-minute checkpoint, <=3 UNI_AI calls/step, no new GPU sessions during full tests. Actual browser unmount can be not-run if unavailable; do not equate unit cancellation with UI coverage.

Before reproduction confirmed: native A/B/A saved A changed -65 to -63mm despite reset visible draft; B preserved. Evidence outputs/editor-selection-20261003/before-reproduction.json.
