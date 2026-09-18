---
authority: volatile
review-cycle: 7d
retention: archive-after-6m
staleness-threshold: 14d
tags:
  - session/focus
  - session/blockers
  - session/next-steps
last-reviewed: 2026-09-18
compaction_generation: 0
source_type: canonical
confidence: high
lineage: []
---

# Active Context - Current State

**Last Updated**: 2026-09-18

## Current Focus

**`#83` merged 2026-09-13.** `#84`'s branch then had to absorb that merge: its own
`policy`/`filteredFiles` real-merge additions conflicted with `#83`'s `earlyExit`/`agentsPlanned`
additions in the same 10 files. Resolved by combining both (neither regresses the other) — full
domain code-review + independent opposition review + 908-test suite, pushed as `b7634e2`.

**Opposition review of that merge found a real gap**, fixed as a same-PR fast-follow:
`mergePolicy` promoted an agent to "skipped entirely" using the wrong denominator once chunking
could exit early — `mergeToolAvailability` already guarded the analogous claim via a
`coverageIncomplete` param; `mergePolicy` now takes the same param (`2039538`). A **second** bug
surfaced by a full `/change-review` of the resulting branch: `mergePolicy` could return a
truthy-but-empty `{agentsSkipped: [], reason: {}}` instead of `undefined`, a shape the non-chunked
path can never produce — fixed to mirror the `mergeToolAvailability`/`mergeFilteredFiles`
undefined-when-empty pattern (`c3b184b`). Both mutation-tested: reverting each fix reproduces the
exact test failures it resolves.

**`#84`'s final `/change-review` (9 jobs + ACR + opposition) found no Blocking findings.** Real,
non-blocking Medium findings worth a fast-follow (not yet started): `policy.agentsSkipped`'s
"fully skipped" predicate is reimplemented independently in all 4 formatters instead of sharing a
`schema.ts` helper (unlike the sibling `filteredFiles` concept, which got one); every fixture
testing "N files withheld" text has narrowed-agent-count == distinct-file-count, so a
`narrowedFileCount`/`agentsWithNarrowedView().length` copy-paste swap would pass undetected;
`tests/unit/mcp/formatter.test.ts` lacks the headline-stability regression test the other two
formatters have. Two smaller issues (stale contract scope, a stale `runner.ts:931`→`938` comment
reference) were fixed inline during the review (`b63793f`). Pushed to
`origin/fix/filtered-files-visibility` 2026-09-17.

**ACR reported 5 "high"/"blocking:true" findings on this diff — all 5 confirmed fabricated**, independently
by two separate reviewers reading the actual cited lines: every one cites a wrong line number, and
4 of 5 quote code that already null-guards via `?.`/`??`/`&&` (the guard being flagged AS the bug
is the fix). All 5 self-reported `locationCheck: mismatch`/`unknown`. Reconfirms the
local-model-under-vulnerability-hunting-pressure pattern the PMB peer flagged earlier — see Next
Steps, the formal write-up of this is still outstanding.

**`#85`** (`fix/chunked-progress-visibility`) is `mergeStateStatus: CONFLICTING` against `main`
post-`#83` — needs `gh pr update-branch` or manual resolution, not started. **`#86`**
(`fix/update-reviewed-nested-payload`) is OPEN, mergeable, both checks passing, **NOT merged**
despite an earlier session transcript suggesting `gh pr merge 86` had succeeded — verified directly
via `gh pr view 86` 2026-09-17 (`mergedAt: null`). Unexplained discrepancy, flagged rather than
guessed at. **`#87`** (`chore/acr-locationcheck-fpr-measurement`) opened 2026-09-18, clean.

**`gh pr list` as of 2026-09-18: `#82`/`#83` merged; `#84`/`#85`/`#86`/`#87` open, none merged.**
`gh pr merge` is denied to Claude by design; the user runs it after checks pass.

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

- **`filteredFiles`/`policy` — merge-conflict resolved, fast-follows landed, change-review clean,
  still awaiting merge (#84).** `review.yml` and `vscode-extension` are the fifth and sixth
  surfaces; `#83`'s `scripts/reviewIncompleteness.cjs` they need is now merged, so they can follow
  once #84 lands rather than duplicating that module across open PRs.
- **Fast-follow candidate, not started: share one `skippedAgents(result)` helper across the 4
  formatters** instead of each reimplementing `policy?.agentsSkipped.length > 0` — found by #84's
  final change-review (Medium, non-blocking). Same session, decouple the "N files withheld" test
  fixtures so narrowed-agent-count and distinct-file-count differ (a `narrowedFileCount` /
  `agentsWithNarrowedView().length` swap currently passes every test), and add the
  headline-stability regression test to `tests/unit/mcp/formatter.test.ts` that markdown/sarif
  already have.
- **ACR false-positive pattern — measured, not just written up, in PR #87 (2026-09-18).** The
  Task Contract Proposal was drafted, deliberately narrowed to measurement-only after the first
  draft's own holes were poked (it would have contradicted `evidenceLocation.ts`'s explicit
  never-drop decision, and conflated `blocking` — which doesn't gate anything, `severity` does —
  with a real lever). Result: 20 real trials against a new `adversarial-clean` calibration fixture,
  31 false positives, `mismatch`/`unknown` = 74.2% — **below the 80% bar set before seeing data**,
  so recorded as measured-and-inconclusive rather than acted on. The 25.8% that came back
  `verified` are one consistent shape: the model accurately quotes an already-guarded line, then
  fabricates a claim about it anyway — `locationCheck` verifies citation accuracy, not claim truth.
  Full data in `docs/superpowers/plans/2026-09-17-acr-locationcheck-fpr-measurement.md`. Any future
  mitigation contract needs to separately address that quarter; a blanket `locationCheck`-based
  demotion doesn't touch it.
- **`chunkRunner`'s `mergeResults` drops `truncation`, so exit 3 is unreachable under `--chunk`.**
  Peer-reported and live-reproduced 2026-09-01; detail in `progress.md`. **Not fixed on purpose** —
  making exit 3 reachable changes what PMB's Job 7 branches on, so it is an operator decision.
- **`earlyExit` reached NO renderer — fixed and merged (PR #83, six surfaces not four).** Detail in
  `progress.md`; six-surface rule corrected in `systemPatterns.md`. Resolved, kept only as a pointer.
- **Operator calls parked, unmade, detail archived 2026-09-17** (full text in
  [`archive/activeContext-history.md`](archive/activeContext-history.md)): corroboration-downgrade
  measurement contract (blocked on Ollama); `systemPatterns.md` over its 100–180 target band;
  `ping()`'s substring model-presence guess (`ollamaProvider.ts:125-143`, peer-cleared fix
  available); `--chunk` as default (cost rationale weakened, not flipped); PMB upgrade (release
  policy approved, not implemented, blocked on work nobody has started — not a tag to await).
- **`fetch failed` — the one open technical thread, deliberately passive.** One invocation in twelve
  (Ollama dropping the connection under load). **n=1: do not act on it.**

## Environment Status

**Infrastructure**: Ollama on port 11434 — required for integration tests and calibration, not for
unit tests. **Git**: `#82`, `#83` merged (branches deleted); **four open PRs** (`#84` change-review
clean, `#85` CONFLICTING against `main`, `#86` mergeable but not yet merged despite an earlier
transcript suggesting otherwise, `#87` clean — see Current Focus), none merged. **The `main` hash
is deliberately not recorded
here** — read it from `git log`. Two PRs in a row tried to keep it current and each was stale the
moment it merged, because a memory-bank PR moves the very commit it names. Remote holds `main`,
four PR branches, plus the two long-retained orphans (`chore/agent-calibration`,
`claude/plan-overview-4dg42o`) — containment cannot be proven for either, so both stay. `v1.15.0`
tagged at `6e2ed34` and published, and `Unreleased` is empty. That tag hash **is** recorded, and
the distinction is the point:
a release tag is immutable, a branch tip is not. Commands are in `techContext.md`; `npm run check`
covers typecheck/build/format/lint/test in one pass.
