---
authority: volatile
review-cycle: 7d
retention: archive-after-6m
staleness-threshold: 14d
tags:
  - session/focus
  - session/blockers
  - session/next-steps
last-reviewed: 2026-09-26
compaction_generation: 0
source_type: canonical
confidence: high
lineage: []
---

# Active Context - Current State

**Last Updated**: 2026-09-26

## Current Focus

**All four of this session's PRs are now merged and `main` is caught up — `gh pr list` returns
empty, verified directly.** In order: `#89` (calibration `agentPolicy` excludes), `#90` (historical
checkpoint — the synthetic model ranking does **not** transfer to real code at N=2, full detail in
`progress.md`), `#88` (the timeout-plumbing fix + oracle-backed calibration measurements), `#85`
(the long-stale `earlyExit`/stderr-distinguishing fix, sitting done-and-pushed for over a week
before finally being clicked). Full narrative for each: `progress.md`.

**Getting all three of #90/#88/#85 merged back-to-back surfaced two generalizable patterns, now in
`systemPatterns.md`:** merging one PR pushes every other open PR to `BEHIND` again, not just once
(branch protection's `strict` mode re-checks after each merge); and `.claude/contracts/active-task.json`
is single-slot, so long-lived branches collide on it (resolved by keeping the newer completed
record). Also: `ai-review` CI timeouts correlate with Ollama's CPU-heavy 70/30 split and clear once
Ollama goes idle and reloads — extended in `techContext.md`. And: this working directory is
confirmed **shared with concurrent peer Claude sessions**, not a theoretical risk — an untracked file
from another session's in-progress work (a `TEMPLATE_OWNED`-hook fix, reported upstream to PMB as
NS-58) appeared mid-session; investigated before assuming it was stray, per standing practice.

**`npm run check` run directly 2026-09-17: green, 908 tests.** Calibration is nondeterministic —
**treat a single pass as weak evidence**. Use `grep "orchestrator] dropped"` to tell a real filter
regression from model variance, and target cases with `CALIBRATION_CASE=name1,name2` rather than
running the suite. PMB-owned defects live in `techContext.md`, not here.

**Still open from the 2026-08-26 PMB briefs:** line attribution is unreliable from the model itself
(7/5/7 across trials, unchunked), including across files. Exit 1 outranks exit 3, so a truncated
run with a blocker reports 1 (`src/cli/index.ts:422-438`, deliberate). Four other diagnoses from
those briefs were verified wrong — do not chase them; reasons in
[`archive/activeContext-history.md`](archive/activeContext-history.md).

**Open risks, detailed in `progress.md`:**

- Claim matchers are regexes over model prose. Both audit rounds found false negatives there; the
  evidence side has produced none. That is the fragile half.
- `license-clean`/`dependencies` no longer couple to this repo's state; other cases unaudited.
- `context` is still last-chunk-wins in `chunkRunner` (deliberate). `policy`/`filteredFiles` no
  longer are — both were promoted to real cross-chunk merges by #84.
- `ai-review` is **slow, not broken**: 8 consecutive runs to 2026-08-27 succeeded (6m43s–44m53s);
  `mizzo-local` is online. It hung once (43 min, no step 1) — environment-side, because `run.cmd` is
  interactive, and `timeout-minutes: 45` is the backstop. A docs PR showing no `ai-review` check is
  by design: `review.yml` `paths-ignore`s `**/*.md`, **and it is not a required check** (both
  clauses restored — #69 added them and a later compression dropped them).

> Prior session history: [`archive/activeContext-history.md`](archive/activeContext-history.md).

## What's Working

The standing capability inventory moved to `techContext.md` ("Shipped Capabilities") on
2026-08-28 — it is what exists, not what this session is doing, and it was the bulk of this file.

## Next Steps

- **`filteredFiles`/`policy` — merged in `#84`.** `review.yml` and `vscode-extension` are the fifth
  and sixth surfaces, still not covered; `#83`'s `scripts/reviewIncompleteness.cjs` they'd need is
  in `main` now, so this can proceed without duplicating that module. Not started.
- **Fast-follow candidate, not started: share one `skippedAgents(result)` helper across the 4
  formatters** instead of each reimplementing `policy?.agentsSkipped.length > 0` — found by #84's
  final change-review (Medium, non-blocking). Same session, decouple the "N files withheld" test
  fixtures so narrowed-agent-count and distinct-file-count differ (a `narrowedFileCount` /
  `agentsWithNarrowedView().length` swap currently passes every test), and add the
  headline-stability regression test to `tests/unit/mcp/formatter.test.ts` that markdown/sarif
  already have.
- **ACR false-positive pattern — measured three times now (synthetic ×2, real code ×1 via #90's
  checkpoint), still not acted on.** Any future mitigation contract needs to separately address the
  `verified`-but-fabricated quarter; a blanket `locationCheck`-based demotion doesn't touch it.
- **Extending PR #90's historical checkpoint past N=2 into an actual historical corpus is a
  separate, not-yet-made decision** — the checkpoint explicitly was not that; see `progress.md`.
- **`chunkRunner`'s `mergeResults` drops `truncation`, so exit 3 is unreachable under `--chunk`.**
  Peer-reported and live-reproduced 2026-09-01; detail in `progress.md`. **Not fixed on purpose** —
  making exit 3 reachable changes what PMB's Job 7 branches on, so it is an operator decision.
- **`earlyExit` reached NO renderer — fixed and merged (PR #83, six surfaces not four)**, resolved,
  kept only as a pointer; detail in `progress.md`/`systemPatterns.md`.
- **5 operator calls parked, unmade** (corroboration-downgrade contract, `systemPatterns.md` size,
  `ping()`'s substring guess, `--chunk` as default, PMB upgrade) — full detail in
  [`archive/activeContext-history.md`](archive/activeContext-history.md).
- **`fetch failed` — the one open technical thread, deliberately passive.** One invocation in twelve
  (Ollama dropping the connection under load). **n=1: do not act on it.**
- **`docs/CONTRACTS-GUIDE.md` says `.claude/contracts/` should be gitignored; it demonstrably isn't**
  (tracked in git — confirmed by this session's own conflicts on `active-task.json` across
  branches). Flagged, never actioned; worth fixing if it causes a third conflict.

## Environment Status

**Infrastructure**: Ollama on port 11434 — required for integration tests and calibration, not for
unit tests. **Git**: no open PRs (`gh pr list` empty, 2026-09-26) — `#82`–`#90` all merged. Four
remote branches from this session's PRs (`chore/historical-checkpoint-pr84-pr85`,
`chore/model-recall-calibration`, `fix/chunked-progress-visibility`,
`fix/exclude-calibration-fixtures-from-acr-policy`) are merged but **not yet deleted** — routine
cleanup, not urgent, not done here since it wasn't asked for. Two long-retained orphan branches
remain (`chore/agent-calibration`, `claude/plan-overview-4dg42o`) — containment unproven, so both
stay. **The `main` hash is deliberately not recorded here** — read it from `git log`; two prior PRs
tried to keep it current and each went stale the moment it merged, since a memory-bank PR moves the
very commit it names. `v1.15.0` tagged at `6e2ed34` and published; that tag hash **is** recorded,
because a release tag is immutable and a branch tip is not. Commands are in `techContext.md`;
`npm run check` covers typecheck/build/format/lint/test in one pass. **This working directory is
shared with concurrent peer Claude sessions** — see Current Focus; do not assume you are the only
session touching this checkout.
