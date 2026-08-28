# System Patterns — archived detail

Forensic detail moved out of `memory-bank/systemPatterns.md`. The **rules** these establish stay in
that file; what lives here is the evidence that established them, which is history rather than
guidance. Nothing was deleted.

First move, 2026-08-27: two PMB-owned script defects, both still true and both still summarised
upstream, archived when `systemPatterns.md` hit its 300-line CI cap recording the timing-measurement
lessons.

## PostToolUse marker-reissue defect — reproduction (2026-08-20)

**Confirmed defect (reproduced 2026-08-20):** `review-reminders-post.*` is supposed to reissue the
marker when a gated command fails, but **PostToolUse does not fire when the tool call exits
non-zero** — so the reissue never happens and the marker is lost. Proven by A/B on the same failing
push: with `; echo "EXIT=$?"` appended (overall exit 0) the marker is correctly reissued; bare
(exit 1) it is not, and `.claude/.pending-push-presha` survives — the post-hook deletes that file
unconditionally at entry, so its survival proves the hook never ran. Practical consequence: a
failed push burns the marker and forces a pointless re-review.

Separately latent: the ref-move check uses `git rev-parse '@{u}'`, which never moves for a **tag**
push, so a successful tag push would read as a failure.

## `last-reviewed` / update-reviewed payload-shape defect — diagnosis (2026-08-20)

**Live consequence in this repo — `last-reviewed` is not being maintained.** `update-reviewed.*`
(PostToolUse on Write/Edit) reads a flat `.file_path` from the hook payload, but the real payload
nests it under `tool_input`. The field is always null, so the script exits 0 on every call and
never stamps the date. Verified 2026-08-20: three memory-bank files edited that day still carried
`last-reviewed` dates from June and July. Consequence beyond the stale field — `mb doctor` uses
those dates to detect stale memory-bank files, so it is reading a dead sensor and will report
actively-edited files as months stale. Fixed in PMB 1.2.1; this repo is on 1.1.1
(`.pmb-version`), so the fix arrives with `mb upgrade`, not with a local edit.
