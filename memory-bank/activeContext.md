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

**Last Updated**: 2026-08-28

## Current Focus

**The session that shipped v1.15.0 closed clean (2026-08-28), and nothing is pending.** Twelve PRs
merged (#65–#76), working tree clean, no open PRs, 826 tests green. **Do not go looking for work
here**, and do not wait on the PMB upgrade — it is blocked on unscheduled work, not on a signal.

**v1.15.0 published (2026-08-27)** — per-pass timing instrumentation (#65), the release that made
the ceiling question answerable from CI artifacts rather than local trials. Publishing is OIDC
Trusted Publishing; `NPM_TOKEN` is deleted from GitHub secrets entirely.

**Two shipped invariants worth not re-deriving.** The evidence-location check (v1.14.0) flags —
never corrects or drops — a finding whose quoted evidence is not at its cited `file:line`, on all
four surfaces — detail in `progress.md`. And four hallucination classes have deterministic backstops
rather than prompt wording, because prompt-only fixes were measured across three agents and failed
every time — that detail is in
[`archive/progress-history.md`](archive/progress-history.md), not `progress.md`.

**Verified state:** 826 unit tests · `npm audit` 0 (prod + dev) · `npm run check` green ·
calibration 21–22/22. Calibration is nondeterministic — treat a single run as weak evidence, and
use `grep "orchestrator] dropped"` to tell a real filter regression from model variance. Target one
case with `CALIBRATION_CASE=name1,name2` rather than running all 21.

**PMB-owned defects — none fixable here** (`TEMPLATE_OWNED`; `mb upgrade` overwrites them). Sixteen
reported across two briefs, all one shape: the check's _result_ is disconnected from whether it ran.
Two live examples, and it takes two to establish a shape — `update-reviewed.*` reads a flat
`.file_path` where the payload nests under `tool_input`, so `last-reviewed` is never stamped and
`mb doctor` reads a dead sensor; `pre-push-check.*` calls `mb validate`, folded into `mb doctor`, and
prints its "use mb doctor" message as evidence of inconsistency on every push.

**From the two 2026-08-26 PMB briefs — four diagnoses are verified wrong, do not chase them:** a
fetch timeout separate from `--timeout`; parallel-by-default agents; chunking damaging hunk headers;
and cross-file misattribution as a chunking artifact. Each was disproved; reasons in
[`archive/activeContext-history.md`](archive/activeContext-history.md). What survives: line
attribution is unreliable from the model itself (7/5/7 across trials, unchunked), now including
across files. Their timeout-ceiling item is measured and closed (below). Still open is exit 1
outranking exit 3, so a truncated run with a blocker reports 1 (`src/cli/index.ts:422-437`,
deliberate — the consequence is what is new).

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

- **Per-agent timeout ceiling — MEASURED, CLOSED (2026-08-27). Do not raise it, do not re-derive
  it.** 12 invocations over a 4,703-line diff, `--profile security`, `--chunk`, devstral on GPU.
  Eleven ran well under budget (slowest real attempt 213.2 s against a 315.4 s ceiling, 68%). The
  twelfth _appeared_ to exceed its ceiling — `adversarial` 611.7 s against 354.7 s — and that row
  is a **measurement artifact, not an agent running long**: stderr shows
  `failed (attempt 1/2): fetch failed — retrying`, so 611.7 s is wall time across two attempts plus
  backoff. No single invocation came near its ceiling; the real fault in that row is `fetch failed`,
  which is resource pressure, separate from our abort path. Sent to PMB, who hold it at our
  confidence level and instructed their next session not to upgrade the 616 s hedge. That
  correspondence is **suggestive, not established** and must not be promoted to "resolved" — the
  original has no source. Still untested: true CPU-only, which needs an Ollama restart with
  `OLLAMA_NUM_GPU=0` (`OllamaProvider` forwards no `options`, so `num_gpu: 0` is unreachable
  per-request).
- **`fetch failed` — the one open technical thread, deliberately passive.** One invocation in
  twelve (Ollama dropping the connection under load). **n=1: do not act on it.** Since `review.yml`
  installs the published build, every non-docs CI run now deposits `timings` rows into
  `findings.json` — the sample accumulates for free.
- **VS Code extension has no distribution channel — an open product call, not a task.** No release
  has ever carried a `.vsix`, `release.yml` has no upload step, and Marketplace publish is
  explicitly DEFERRED. #68 documented the truth (build from source) rather than choosing, so docs
  match reality either way and nothing degrades while this sits.
- **PMB upgrade — blocked on work nobody has started. This is _not_ "awaiting a tag."** The release
  policy (tag → dirty-tree guard → ref-sourcing) is **approved but not implemented**: it needs its
  own PMB contract, and scheduling it is the user's call. Verified in PMB's checkout 2026-08-28 —
  newest tag `v1.0.4`, nothing for 1.1.x or 1.2.x, `VERSION` 1.2.1, `.pmb-version` 1.1.1. **Waiting
  cannot resolve this**; only scheduling the PMB work can, so do not poll and do not treat the tag
  as in flight. Two signals arrive separately when each becomes true: "reached `main`" and "tag
  exists". Once the tag exists this is **two repos, two blocks**, and the `cd` paths are
  load-bearing — giving a cross-repo command without one sent the user to the wrong repository on
  2026-08-28.

  **Check PMB's tree is clean first — this is a precondition, not a courtesy.** `mb upgrade` copies
  from PMB's _working directory_, so uncommitted edits under `templates/` are distributed as if they
  were the release. PMB's tree was dirty in exactly that directory on 2026-08-28.

  ```powershell
  cd "C:\Users\Mizzo\Claude\Personal-Memory-Bank"; git status --short
  ```

  ```powershell
  cd "C:\Users\Mizzo\Claude\Personal-Memory-Bank"; git checkout v1.2.1
  ```

  ```powershell
  cd "C:\Users\Mizzo\Claude\AI-Code-Review-Agent"; mb upgrade
  ```

  PMB must be checked out at the tag **first**, for the working-directory reason above. That leaves
  PMB in detached HEAD — return it to its branch afterwards, or the next PMB session starts detached. Afterwards, verify `last-reviewed` actually starts stamping — the only
  proof the dead sensor is fixed — and re-read the upgrade's own output: it overwrites
  `TEMPLATE_OWNED` but never copies an existing `ADVISORY_CREATE` file (`techContext.md`).
  PMB's ACR-provenance entry is now **committed but not landed** (`2052c3c`, on their
  `fix/block-tier-case-sensitivity`, 3 commits ahead of `main`, unmerged). Background in
  `progress.md`.

## Environment Status

**Infrastructure**: Ollama on port 11434 — required for integration tests and calibration, not for
unit tests. **Git**: `main` at `c284d57`, clean, in sync, zero open PRs, no stashes, `main` the only
local branch. Remote holds `main` plus the two long-retained orphans (`chore/agent-calibration`,
`claude/plan-overview-4dg42o`) — containment cannot be proven for either, so both stay. `v1.15.0`
tagged at `6e2ed34` (the release commit, on `main`) and published; `Unreleased` is empty. Commands
are in `techContext.md`; `npm run check` covers typecheck/build/format/lint/test in one pass.
