---
authority: volatile
review-cycle: 7d
retention: archive-after-6m
staleness-threshold: 14d
tags:
  - session/focus
  - session/blockers
  - session/next-steps
last-reviewed: 2026-11-18
compaction_generation: 0
source_type: canonical
confidence: high
lineage: []
---

# Active Context - Current State

**Last Updated**: 2026-11-18

## Current Focus

**Retired the self-hosted runner `mizzo-local` (2026-11-09).** A public repo should not dispatch jobs
to the owner's laptop, and the `review.yml` `if:` guard can be bypassed from a fork (`pull_request`
uses the PR's workflow file). AI review and calibration are local, on-demand, for trusted code;
`review.yml` and `calibrate.yml` are disabled in GitHub, not edited. Long-term automation stays a
goal, on a path that does not use the laptop. Tracked in Bastion's `memory-bank/activeContext.md`.

**Merged 2026-10-23: #93, #94, #95, #96 and #92; no PR is open.** #93: calibration oracle runs
reported as unscored, not passed — full-suite `passed` totals are now one lower for identical
behavior. #95: the read-only Ollama server-log check (`calibration/ollamaLogCheck.ts`), PR 1 of the
calibration-envelope contract; PR 2 (per-trial provenance) has not started. #92: the
reviewer-composition contract, kept in `docs/architecture/reviewer-composition.md` behind a pointer
in `systemPatterns.md` — **not auto-read; open it before changing the reviewer set**. Detail for
each: `progress.md`.

**Merged 2026-11-18: #102.** `--fail-fast` now stops on published severity.
Prompted by PMB's issue that ACR output has no approval verdict: confirmed (none exists); ACR will
not add one (rule 6, `reviewer-composition.md`), PMB owns authorization.

**As of 2026-10-23, Claude cannot commit or push from a git worktree** — the `review-reminders.*`
gate is worktree-blind. Work happens in this checkout. Fixed on PMB `main` (`a0850a3`,
untagged); needs an `mb upgrade`, on hold (detail in `docs/architecture/pmb-integration.md`,
"PMB-owned defects").

**`npm run check` run directly 2026-09-17: green, 908 tests.** Calibration is nondeterministic —
**treat a single pass as weak evidence**. Use `grep "orchestrator] dropped"` to tell a real filter
regression from model variance, and target cases with `CALIBRATION_CASE=name1,name2` rather than
running the suite. PMB-owned defects live in `docs/architecture/pmb-integration.md` (pointer in
`techContext.md`), not here.

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
- **CI `ai-review` history (runner retired 2026-11-09; applies only if `review.yml` is re-enabled):**
  it was slow, not broken — 8 consecutive runs to 2026-08-27 succeeded (6m43s–44m53s) and it hung
  once (43 min, no step 1; environment-side, `run.cmd` is interactive). It is not a required check,
  and `review.yml` `paths-ignore`s `**/*.md`.

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
- **4 operator calls parked, unmade** (corroboration-downgrade contract, `systemPatterns.md` size,
  `ping()`'s substring guess, `--chunk` as default) — full detail in
  [`archive/activeContext-history.md`](archive/activeContext-history.md). The fifth, the PMB
  upgrade, is scheduled: see the `mb upgrade` item below.
- **`fetch failed` at ~307 s — fixed, merged as #98** (undici's 300 s `headersTimeout`; detail in
  `progress.md`). **Any calibration or timing result taken before the fix with a ceiling above
  300 s was silently capped there**; its failures at ~307 s were that cap, not the model. **Open
  operator call:** that includes the 2026-08-27 measurement behind `techContext.md`'s "per-agent
  timeout ceiling — MEASURED, CLOSED … do not re-derive it". Its one outlier (`adversarial`, 611.7 s
  against a 354.7 s ceiling, first attempt `fetch failed`) was this cap, so its "no invocation came
  near its ceiling" no longer holds (`archive/activeContext-history.md`). Re-measuring is undecided.
- **`review.yml` (disabled) runs without `--chunk`**: if re-enabled, a PR diff over `maxDiffLines`
  (2000) is reviewed truncated. Unscheduled.
- **Flaky timing test:** `tests/unit/runner.test.ts:1570` expects a 300 ms backoff to measure at
  least 300 ms; #92's CI got 299 and passed on re-run. Give it a 1 ms tolerance. Unscheduled.
- **Next: `mb upgrade`, from PMB's `main` — ON HOLD since 2026-10-24 at the user's request;
  lifting it is the user's call.** Both PMB defects behind the hold (the `settings.json`
  permissions wipe, and `mb.ps1` rejecting `--dry-run`) are fixed on PMB `main`, not yet run here:
  `docs/architecture/pmb-integration.md`, "PMB-owned defects". PMB has no release tag past
  `v1.0.4`, so the docs procedure's `git checkout v1.2.1` cannot run; PMB's `main` contains the
  worktree fix `a0850a3`. `mb upgrade` copies PMB's working tree, so right before it, check that the
  PMB checkout has no difference from `origin/main` under `templates/`, `scripts/`, `VERSION` or
  `install.*`, and no untracked files there (PMB #179 checks part of this, without fetching).
  Then run `mb upgrade --dry-run` and confirm the `settings.json` report and diff it prints keep
  ACR's `gh pr merge` deny. What it overwrites: `docs/architecture/pmb-integration.md`. The size
  check it adds is warn-only (`ENFORCE=false`).
- **`docs/CONTRACTS-GUIDE.md` says `.claude/contracts/` should be gitignored; it demonstrably isn't**
  (tracked in git — confirmed by this session's own conflicts on `active-task.json` across
  branches). Flagged, never actioned; worth fixing if it causes a third conflict.

## Environment Status

**Infrastructure**: Ollama on port 11434 — required for integration tests and calibration, not for
unit tests. **Git**: open PRs as of 2026-11-18: none — `#82`–`#102` all merged. The
four merged 2026-09-26 PR branches are gone from the remote (`git ls-remote`, 2026-10-23). Two
long-retained orphan branches remain (`chore/agent-calibration`, `claude/plan-overview-4dg42o`) —
containment unproven, so both stay. **The `main` hash is deliberately not recorded here** — read it
from `git log`; two prior PRs tried to keep it current and each went stale the moment it merged,
since a memory-bank PR moves the very commit it names. `v1.15.0` tagged at `6e2ed34` and published;
that tag hash **is** recorded, because a release tag is immutable and a branch tip is not. Commands
are in `techContext.md`; `npm run check` covers typecheck/build/format/lint/test in one pass. **This
working directory is shared with concurrent peer Claude sessions**: do not assume you are the only
session touching this checkout. Check `git status` for unfamiliar untracked files, and investigate
before assuming one is stray. The 2026-09-26 case (NS-58) is in `archive/progress-history.md`,
"Three PRs merged back to back".
