# Tech Context — archived history

Forensic detail moved out of `memory-bank/techContext.md`. The **rules** it supported stay there.

First move, 2026-10-23: `techContext.md` was at 399/400, and over the 300 lines PMB's warn-only
size check flags once the next `mb upgrade` adds it to CI. 12 whole sentences of narrative,
measurement and incident detail moved here verbatim, listed below under the section they came
from; no sentence carrying an instruction, a scope or a precondition was moved or reworded. Three
PMB reference blocks were relocated verbatim to `docs/architecture/pmb-integration.md` rather than
archived, because they are still operative. One caveat found since: the per-agent ceiling
measurement below ran under undici's 300 s `headersTimeout`, removed in PR #98: its `adversarial`
row's first attempt ended in `fetch failed` and was retried (`archive/activeContext-history.md`).
In the sentences below, "this file", "above" and "This paragraph" mean `techContext.md`; the `=50`
drift they cite is now in `docs/architecture/pmb-integration.md`.

## Moved in the first pass (2026-10-23) — verbatim sentences

### From "Model Choice — measured 2026-08-30, do not re-derive from a single pass"

- **This paragraph originally supplied an illustrative count and got it wrong** — "26 cases", from
  `grep -c "name:"`, which also matched an interface field and two type annotations; the array holds 23.
- Caught in review.
- The count is gone rather than corrected to 23, because a sentence arguing that pinned counts rot
  has no business pinning one.
- Slowest genuine attempt 213.2 s against a 315.4 s ceiling (68%); the one row that appeared to
  exceed its budget is a retry artifact.
- A PR with an unusually large diff (~3750 lines) timed out at the 45-minute job ceiling twice back
  to back (`ollama ps` showing 70%/30% both times); a third retry after Ollama had gone fully idle
  (no model loaded) passed in 44m34s, and later runs against smaller diffs on the same
  idle-then-reload cycle passed in 31m and 13m.

### From "Services"

- It was previously set in **neither** User nor Machine scope.
- **This has already cost the peer a batch of measurements** (2026-09-01): every ACR figure in their
  record labelled "1.15.0" in fact described our working tree at an indeterminate commit, and they
  have retracted the label to "linked working tree, version indeterminate".

### From "Current State"

- This section previously pinned counts as of 2026-06-06 — "19 unit tests", "20 commits on `master`"
  — and every line of it had rotted by 2026-08-28 (826 tests, 456 commits, and the branch is
  `main`).
- A dated stamp made it honest and still useless.
- Same defect as the `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=50` drift this file documents above.

### From "Shipped Capabilities"

- Moved from `activeContext.md` on 2026-08-28.
- Moved from `activeContext.md` 2026-09-01: a standing distribution fact, not session state.
