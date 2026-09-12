---
authority: volatile
review-cycle: 7d
retention: archive-after-6m
staleness-threshold: 14d
tags:
  - session/focus
  - session/blockers
  - session/next-steps
last-reviewed: 2026-06-26
compaction_generation: 0
source_type: canonical
confidence: high
lineage: []
---

# Active Context - Current State

**Last Updated**: 2026-09-01

## Current Focus

**`filteredFiles` invisibility is fixed and open as #84** (2026-09-01), together with the `policy`
and `filteredFiles` chunk merges it turned out to require. Mechanism, measurement and the design
decision are in `progress.md`. Verified: 867 tests and **20/20 mutations killed** against a no-op
control that killed nothing.

**Three open PRs, none merged, all touching the same four formatters:** `#82` (this branch —
memory-bank), `#83` (`fix/early-exit-visibility`), `#84` (`fix/filtered-files-visibility`).
Whichever merges first forces `gh pr update-branch` on the others — never a rebase, since
force-push is hard-blocked. `gh pr merge` is denied to Claude by design.

**Two handoffs have been merged here** (2026-08-31, and 2026-09-01). `handoff.md` is **gitignored**,
so until each merge its facts existed on one disk and in no commit. The first merge put its
content in `techContext.md` (model choice, `OLLAMA_KEEP_ALIVE`, the `npm link` rule, the peer
protocol, PMB's exit-code contract) and `systemPatterns.md` (the proxy-assertion rule).

**Verified state (2026-08-31): `npm run check` run directly, green.** The test count is deliberately
not restated here — it lives once, in `progress.md`'s Metrics table, because restating it is how it
went stale twice. Calibration is nondeterministic — **treat a single pass as weak evidence**, now with a measured
instance: a model switch was recommended on one pass each and reversed by three (`techContext.md`).
Use `grep "orchestrator] dropped"` to tell a real filter regression from model variance, and target
cases with `CALIBRATION_CASE=name1,name2` rather than running the suite. Pass counts and suite size
are deliberately not pinned here — both have drifted before; run it.

**PMB-owned defects — none fixable here**, and the standing inventory moved to `techContext.md`
("PMB-owned defects") on 2026-08-31: it is a stable fact about an upstream dependency, not session
state, and it was being held in the file least able to afford it.

**From the two 2026-08-26 PMB briefs — four diagnoses are verified wrong, do not chase them:** a
fetch timeout separate from `--timeout`; parallel-by-default agents; chunking damaging hunk headers;
and cross-file misattribution as a chunking artifact. Reasons in
[`archive/activeContext-history.md`](archive/activeContext-history.md). What survives: line
attribution is unreliable from the model itself (7/5/7 across trials, unchunked), including across
files. Still open — exit 1 outranks exit 3, so a truncated run with a blocker reports 1
(`src/cli/index.ts:422-438`, deliberate; the consequence is what is new).

**Open risks, detailed in `progress.md`:**

- Claim matchers are regexes over model prose. Both audit rounds found false negatives there; the
  evidence side has produced none. That is the fragile half.
- `license-clean`/`dependencies` no longer couple to this repo's state; other cases unaudited.
- `policy`, `filteredFiles`, and `context` are still last-chunk-wins in `chunkRunner`. That remains
  a deliberate, documented simplification — none of them asserts anything about coverage the way
  `toolAvailability` does, which is why only that field was promoted to a real merge.
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

- **`filteredFiles` — shipped as #84, awaiting review.** `review.yml` and `vscode-extension` are
  the fifth and sixth surfaces and still follow once #83 lands the
  `scripts/reviewIncompleteness.cjs` they need; duplicating that module across open PRs would
  create the divergent-copy drift this work exists to remove.
- **`chunkRunner`'s `mergeResults` drops `truncation`, so exit 3 is unreachable under `--chunk`.**
  Peer-reported and live-reproduced 2026-09-01; detail in `progress.md`. **Not fixed on purpose** —
  making exit 3 reachable changes what PMB's Job 7 branches on, so it is an operator decision.
- **`earlyExit` reached NO renderer — fixed on `fix/early-exit-visibility` (PR #83).** It turned out
  to be **six** surfaces, not four: `review.yml` and `vscode-extension` are renderers but not
  formatters, so the old rule could never have caught them. Evidence, the exit-0 mechanism, the
  `chunkRunner` part and the INCOMPLETE-denominator trap are in `progress.md`;
  `ReviewResult.agentsPlanned` now carries the roster, and the six-surface rule is corrected in
  `systemPatterns.md`.
- **Corroboration downgrade — an approved measurement contract, not started, blocked on Ollama.**
  Re-established at
  [`2026-08-31-corroboration-downgrade-measurement.md`](../docs/superpowers/plans/2026-08-31-corroboration-downgrade-measurement.md)
  after being displaced from the contract file. That document also parks a **second, unverified**
  thread (grammar-constrained decoding costing reasoning accuracy) needing its own contract — read
  the primary sources before acting on it.
- **`systemPatterns.md` sits well above its 100–180 target band — an operator call, unmade.**
  Reaching the band means dropping ~12 **live rules**, not archiving more evidence. Two options were
  put up: accept that the file is larger than the band assumes, or split it (architecture decisions
  vs operational rules). Neither was chosen, so it continues to accrete.
- **`ping()` guesses model presence by substring — peer-cleared, operator has not ruled.**
  `ollamaProvider.ts:125-143` does `model.split(':')[0]` then `.includes()`, so `qwen2.5-coder:32b`
  reports present when only `:7b` is installed (verified live against three models). A missing model
  should fail preflight and exit **4** (`exitCode.ts` names that case explicitly); instead it passes,
  16 agents fail, and it exits **2** — which PMB routes to triage rather than retry. Fix is to
  normalise the request (`bare → :latest`) then compare for equality; the "breaks bare `devstral`"
  objection dissolves because Ollama resolves bare names the same way. PMB confirmed 2026-08-31 they
  pass no bare or registry-qualified names and want exit 4 kept with **no new code**.
- **`--chunk` as default — reopened by the model measurement, not yet decided.** It stays opt-in
  (`config.ts:25` documents why) and was deliberately **not** flipped on 2026-08-30, because
  flipping it trades one silent behaviour for another. What changed: at `qwen2.5-coder:7b` speeds
  full coverage of a real diff costs roughly 200 s, weakening the cost half of that rationale. The
  coverage evidence is not in doubt — a 6,578-line diff at default `--max-lines` reviewed 2,000
  lines and returned **0 findings** where `--chunk` returned **15, including 2 High** (recorded at
  `src/cli/formatter.ts:51`). An operator call, not a task.
- **`fetch failed` — the one open technical thread, deliberately passive.** One invocation in twelve
  (Ollama dropping the connection under load). **n=1: do not act on it.** Since `review.yml`
  installs the published build, every non-docs CI run now deposits `timings` rows into
  `findings.json` — the sample accumulates for free.
- **PMB upgrade — blocked on work nobody has started. This is _not_ "awaiting a tag."** The release
  policy (tag → dirty-tree guard → ref-sourcing) is **approved but not implemented**; scheduling it
  is the operator's call. Verified in PMB's checkout 2026-08-28 — newest tag `v1.0.4`, nothing for
  1.1.x or 1.2.x. **Waiting cannot resolve this** — do not poll, do not treat the tag as in flight.
  Two signals arrive separately: "reached `main`" and "tag exists". **The procedure lives in
  `techContext.md`**, next to the mechanics explaining each step; do not reconstruct it from memory.
  PMB's ACR-provenance entry is committed but unlanded (`2052c3c`). Background in `progress.md`.

## Environment Status

**Infrastructure**: Ollama on port 11434 — required for integration tests and calibration, not for
unit tests. **Git**: three local branches and **two open PRs** (#82, #83), neither merged; the
`fix/filtered-files-visibility` work is uncommitted. **The `main` hash is deliberately not recorded
here** — read it from `git log`. Two PRs in a row tried to keep it current and each was stale the
moment it merged, because a memory-bank PR moves the very commit it names. Remote holds `main`, the
two PR branches, plus the two long-retained orphans (`chore/agent-calibration`,
`claude/plan-overview-4dg42o`) — containment cannot be proven for either, so both stay. `v1.15.0`
tagged at `6e2ed34` and published, and `Unreleased` is empty. That tag hash **is** recorded, and
the distinction is the point:
a release tag is immutable, a branch tip is not. Commands are in `techContext.md`; `npm run check`
covers typecheck/build/format/lint/test in one pass.
