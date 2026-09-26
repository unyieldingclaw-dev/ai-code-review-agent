---
authority: volatile
review-cycle: 7d
retention: archive-after-6m
staleness-threshold: 14d
tags:
  - session/focus
  - session/blockers
  - session/next-steps
last-reviewed: 2026-09-19
compaction_generation: 0
source_type: canonical
confidence: high
lineage: []
---

# Active Context - Current State

**Last Updated**: 2026-09-19

## Current Focus

**Today's entire calibration/measurement work moved off `#85`'s own unmerged branch onto its own
branch, `chore/model-recall-calibration` (off `main`), per explicit user direction** — it was never
part of `#85`'s feature and had no business sitting uncommitted on that branch. `#85`'s own
resolution work is untouched, still on `origin/fix/chunked-progress-visibility`, still merely
unclicked (`#84`/`#86`/`#87` merged 2026-09-18; `#85` confirmed `OPEN`/`mergedAt: null` via
`gh pr view 85`, not assumed).

**Timeout plumbing bug found via this repo's own `/code-review`, fixed, verified, and its one
operational fallout resolved — full detail in `progress.md`'s "Timeout plumbing bug" entry, not
restated here.** `calibrate.ts` never actually enforced `CALIBRATION_TIMEOUT_MS`/`agentTimeoutMs`;
every batch below ran under Ollama's hardcoded ~300s default the whole time. Fixed and verified
(`npm run calibrate` unfiltered against `devstral:latest`: 23 passed, 3 failed, none a regression
from this fix). The one flagged timeout (`adversarial-dirty` vs `devstral:latest`, exposed because
CI's real 180s default is now genuinely enforced for the first time) is resolved: user directed
raising it, `.github/workflows/calibrate.yml` now sets `CALIBRATION_TIMEOUT_MS: '300000'`, pinning
calibration back to the budget it always effectively had. Production's real timeout path
(`runner.ts`'s `withTimeout`) is untouched. `.claude/.code-review-ok` self-certified and written
(reasoning in `progress.md`) — self-check on that certification caught and fixed one real overclaim
in a test comment before it stood (see `progress.md`). **Still blocked on the actual `git commit`**
— nothing committed or pushed yet on `chore/model-recall-calibration`, the user's call to make.

**`#85`'s own CI comment reported 11 ACR findings on its diff — all 11 confirmed fabricated**,
verified against actual source. Extends the pattern already measured in `#87` (74.2%
`mismatch`/`unknown`, N=20) to domains beyond `adversarial`. **Paused, not abandoned, per explicit
direction to fix the harness first:** re-adjudicate these 11 against commit `7f07fd6`, and build
`#84`'s pre-registered pre-fix oracle at `b7634e2` — a first real-code checkpoint, explicitly NOT
"the historical corpus" at N=2. Not resumed yet.

**Restraint (2026-09-18, `adversarial-clean`, N=20×3) and recall (2026-09-18, oracle-backed
`adversarial-dirty`, N=20×3) measured — full results in `progress.md`'s two dated entries, not
restated here.** Headline: a real precision-recall-runtime frontier, no winner — Qwen3.5 best
restraint/runtime, Ornith best recall but worst restraint and timeout-prone, Devstral weakest on
recall with a new operational strike (timeouts scale with diff complexity). Deliberately no
synthetic scalar score invented to rank them. **No production model change.**

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
- **ACR false-positive pattern — measured twice, not yet acted on; detail in Current Focus.**
  `#87`'s `locationCheck` measurement and the 2026-09-18 three-way model comparison are both
  measured-not-acted-on. Any future mitigation contract needs to separately address the
  `verified`-but-fabricated quarter; a blanket `locationCheck`-based demotion doesn't touch it.
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

## Environment Status

**Infrastructure**: Ollama on port 11434 — required for integration tests and calibration, not for
unit tests. **Git**: `#82`/`#83`/`#84`/`#86`/`#87` merged, branches deleted. `#85` OPEN, not
merged, ready, on `origin/fix/chunked-progress-visibility` (see Current Focus) — **this session's
checkout is `chore/model-recall-calibration`, off `main`**, not that branch. **The `main` hash is
deliberately not recorded here** — read it from
`git log`; two prior PRs tried to keep it current and each went stale the moment it merged, since a
memory-bank PR moves the very commit it names. Two long-retained orphan branches remain
(`chore/agent-calibration`, `claude/plan-overview-4dg42o`) — containment unproven, so both stay.
`v1.15.0` tagged at `6e2ed34` and published; that tag hash **is** recorded, because a release tag is
immutable and a branch tip is not. Commands are in `techContext.md`; `npm run check` covers
typecheck/build/format/lint/test in one pass.
