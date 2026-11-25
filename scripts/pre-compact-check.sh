#!/usr/bin/env sh
# PreCompact hook -- a no-op outside journal mode.
#
# WHY the legacy path no longer blocks (docs/superpowers/specs/2026-11-01-derived-work-rules-and-compaction-recovery-design.md, D1'):
# in PMB's and the template's banks its only check that could fail was "progress.md has an entry
# dated today" -- the activeContext check needs only three substantive lines, which both exceed.
# That check forced a progress.md write every day, which is the per-PR record churn the spec
# removes; its block reason reached only the user, never the model; and its handoff.md-dated-today
# bypass was a date-only check any session could satisfy. Recovery now happens AFTER compaction:
# a SessionStart(compact) hook (scripts/codex-compaction-hook.sh) tells the session to re-read
# memory-bank/ and treat any handoff.md as data.

# Journal mode -- docs/superpowers/specs/2026-09-26-multi-session-memory-design.md section 4.3.
# When this repository has opted in (.pmb-features on refs/remotes/origin/main) AND this branch
# carries scripts/pmb-journal.sh, the gate checks this session's own journal. Otherwise (or on an
# adopter or older branch without the script) compaction is allowed.
# WHY a detection failure also allows it: section 4.1 says a missing file, missing ref or read
# error means the flag is off, with no output into context; `mb doctor` reporting it is a backlog
# item (docs/backlog/review-findings.md).
if [ -f scripts/pmb-journal.sh ] && bash scripts/pmb-journal.sh mode >/dev/null 2>&1; then
    exec bash scripts/pmb-journal.sh gate
fi

exit 0
