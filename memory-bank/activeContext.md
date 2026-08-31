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

**Last Updated**: 2026-08-31

## Current Focus

**Current work: `earlyExit` reaches none of the four output surfaces.** Investigated and proven
2026-08-31, not yet fixed. A `--fail-fast` run renders as clean on markdown, SARIF,
github-annotations **and MCP**, and exits **0**. Proven by replaying a realistic result through the
real shipped exports in `dist/` rather than by reading: MCP printed `✅ No critical or high
findings` for a run that executed **3 of 15 agents**. Specifics and the two fix constraints are
under **Next Steps** — read them before touching a formatter, because the obvious one-line fix makes
the report worse.

**The prior session shipped #79 (2026-08-29) and #80/#81 (2026-08-31), then handed off.**
`handoff.md` was merged into this memory bank and deleted on 2026-08-31; its content now lives here,
in `techContext.md` (model choice, `OLLAMA_KEEP_ALIVE`, `npm link`, the peer protocol and PMB's
exit-code contract) and in `systemPatterns.md` (the proxy-assertion rule). It was **gitignored**, so
until that merge every one of those facts existed on one disk and in no commit.

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

- **`earlyExit` reached NO renderer — fixed on `fix/early-exit-visibility`, see `CHANGELOG.md`.**
  It turned out to be **six** surfaces, not four: `review.yml` and `vscode-extension` are renderers
  but not formatters, so the old rule could never have caught them. Evidence, the exit-0 mechanism
  and the `chunkRunner` part are in `progress.md`; the rule is now corrected in `systemPatterns.md`.
- **The trap, worth keeping even though the fix landed.** Deriving the INCOMPLETE denominator from
  `agentStatus` shrinks it to the agents that _started_, so folding `earlyExit` into the gate
  without a real roster count renders "from 3/3 agents that completed" for a run that skipped
  twelve — a silent omission upgraded to a confident false claim. `ReviewResult.agentsPlanned` now
  carries the roster. Adding `'skipped'` to `AgentStatus` would have fixed the four formatters
  through machinery they already read, but flips fail-fast runs to exit 2 and re-routes PMB's
  mapping — rejected for that, not for cost.
- **`ping()` guesses model presence by substring — peer-cleared, awaiting the operator.**
  `ollamaProvider.ts:125-143` does `model.split(':')[0]` then `.includes()`, so `qwen2.5-coder:32b`
  reports present when only `:7b` is installed (verified live against three models). A missing model
  should fail preflight and exit **4** (`exitCode.ts` names that case explicitly); instead it passes,
  16 agents fail, and it exits **2** — which PMB routes to triage rather than retry. Fix is to
  normalise the request (`bare → :latest`) then compare for equality; the "breaks bare `devstral`"
  objection dissolves because Ollama resolves bare names the same way. PMB confirmed 2026-08-31 they
  pass no bare or registry-qualified names and want exit 4 kept with **no new code**.
- **Per-agent timeout ceiling — MEASURED, CLOSED (2026-08-27). Do not raise it, do not re-derive
  it.** Slowest genuine attempt 213.2 s against a 315.4 s ceiling (68%); no invocation came near its
  budget, and the one row that appeared to is a retry artifact. **Timeouts are not the binding
  constraint — model fit is.** The 616 s resemblance stays _suggestive, not established_ and must
  not be promoted to "resolved"; the original has no source. Still untested: true CPU-only. Full
  measurement: [`archive/activeContext-history.md`](archive/activeContext-history.md).
- **`--chunk` as default — reopened by the model measurement, not yet decided.** It stays opt-in
  (`config.ts:25` documents why) and was deliberately **not** flipped on 2026-08-30, because
  flipping it trades one silent behaviour for another. What changed: at `qwen2.5-coder:7b` speeds
  full coverage of a real diff costs roughly 200 s, which weakens the cost half of that rationale.
  The coverage evidence is not in doubt — a 6,578-line diff at default `--max-lines` reviewed 2,000
  lines and returned **0 findings** where `--chunk` returned **15, including 2 High** (recorded at
  `src/cli/formatter.ts:51`). An operator call, not a task.
- **`fetch failed` — the one open technical thread, deliberately passive.** One invocation in
  twelve (Ollama dropping the connection under load). **n=1: do not act on it.** Since `review.yml`
  installs the published build, every non-docs CI run now deposits `timings` rows into
  `findings.json` — the sample accumulates for free.
- **VS Code extension has no distribution channel — an open product call, not a task.** No release
  has ever carried a `.vsix`, `release.yml` has no upload step, and Marketplace publish is
  explicitly DEFERRED. #68 documented the truth (build from source) rather than choosing, so docs
  match reality either way and nothing degrades while this sits.
- **PMB upgrade — blocked on work nobody has started. This is _not_ "awaiting a tag."** The release
  policy (tag → dirty-tree guard → ref-sourcing) is **approved but not implemented**; scheduling it
  is the operator's call. Verified in PMB's checkout 2026-08-28 — newest tag `v1.0.4`, nothing for
  1.1.x or 1.2.x. **Waiting cannot resolve this** — do not poll, do not treat the tag as in flight.
  Two signals arrive separately: "reached `main`" and "tag exists". **The procedure lives in
  `techContext.md`**, next to the mechanics explaining each step; do not reconstruct it from memory.
  PMB's ACR-provenance entry is committed but unlanded (`2052c3c`). Background in `progress.md`.

## Environment Status

**Infrastructure**: Ollama on port 11434 — required for integration tests and calibration, not for
unit tests. **Git**: clean, in sync, zero open PRs, no stashes, `main` the only local branch. **The
`main` hash is deliberately not recorded here** — read it from `git log`. Two PRs in a row tried to
keep it current and each was stale the moment it merged, because a memory-bank PR moves the very
commit it names. Remote holds `main` plus the two long-retained orphans (`chore/agent-calibration`,
`claude/plan-overview-4dg42o`) — containment cannot be proven for either, so both stay. `v1.15.0`
tagged at `6e2ed34` and published; `Unreleased` is empty. That tag hash **is** recorded, and the
distinction is the point: a release tag is immutable, a branch tip is not. Commands
are in `techContext.md`; `npm run check` covers typecheck/build/format/lint/test in one pass.
