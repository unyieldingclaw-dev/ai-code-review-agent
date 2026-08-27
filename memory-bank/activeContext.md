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

**Last Updated**: 2026-08-26

## Current Focus

**v1.13.1 published (2026-08-26)**, superseding v1.13.0 four days on — 16 honesty fixes between
them. Publishing is OIDC Trusted Publishing; `NPM_TOKEN` is deleted from GitHub secrets entirely.
**v1.14.0 followed on 2026-08-27** (#55, #58, #57) — `main` and npm agree.

**Evidence-location invariant shipped in v1.14.0.** A finding whose quoted evidence is
not at its cited `file:line` is flagged on all four surfaces — markdown marker, annotation message
caveat, SARIF `properties.locationCheck`, MCP heading. It reports only: correcting the line was
tried and disproved (the same evidence string occurs 3× across 2 files in the 134-line diff that
motivated it), and dropping remains the false-negative direction. Verified by replaying run
33025650850 through `synthesize()`: 6/6 stamped, 0 dropped, and `verified` still returned when the
line is right. Details and the annotation spec trap in `progress.md`; the stacked-PR and
four-formatter rules in `systemPatterns.md`.

Four hallucination classes have deterministic backstops instead of prompt wording: injection,
swallowed-exception, SQL NULL-error, fabricated licenses. Prompt-only fixes were measured live across
three agents and failed every time — for `license` one made it _worse_ (6/10 → 9/10). Details in
`progress.md`.

**Verified state:** 789 unit tests · `npm audit` 0 (prod + dev) · `npm run check` green ·
calibration 21–22/22. Calibration is nondeterministic — treat a single run as weak evidence, and
use `grep "orchestrator] dropped"` to tell a real filter regression from model variance. Target one
case with `CALIBRATION_CASE=name1,name2` rather than running all 21.

**PMB-owned defects — none fixable here** (`TEMPLATE_OWNED`; `mb upgrade` overwrites them). Sixteen
reported to the PMB session across two briefs, all one shape: the check's _result_ is disconnected
from whether it ran. Live examples: `update-reviewed.*` reads a flat `.file_path` where the payload
nests under `tool_input`, so `last-reviewed` is never stamped and `mb doctor`'s staleness detection
reads a dead sensor; `pre-push-check.*` calls `mb validate`, folded into `mb doctor`, and prints its
"use mb doctor" message as evidence of inconsistency on every push. See `systemPatterns.md` for the
ownership rule and the working conventions (keep `git push`/`git commit` out of command text; use
`gh pr update-branch`, never a rebase, since force-push is blocked).

**ACR was reviewing the wrong side of its own diffs, and repeating itself** — all shipped: `a/`-prefixed
paths pointing 33% of findings at nonexistent files (#45), deleted code reported as current (#46),
same-agent repeats surviving dedup (Bug D, #50). **The method mattered more than any single fix:**
`gh run download` yields the real `ai-review-findings` artifact, and replaying it through
`synthesize()` caught a miswiring every unit test and a scratch probe both missed.

**Two PMB briefs on ACR, both triaged (2026-08-26).** Shipped from them: the `INCOMPLETE` headline
(the glyph is the verdict for a skimming reader — qualifying text alone had already failed once) and
`formatter.ts`'s truncation advice realigned with `runner.ts` to prefer `--chunk`. **Four of their
diagnoses are verified wrong — do not chase them:** no fetch timeout separate from `--timeout`
(`ollamaProvider.ts` uses the caller's signal); agents are sequential by default; chunking preserves
hunk headers byte-identically; and the second brief's cross-file misattribution cannot be a chunking
artifact, since `--chunk` is opt-in and their 1769-line run never triggered it. Line attribution is
unreliable from the model itself (7/5/7 across trials, unchunked), now including across files.
Confirmed and open: the timeout ceiling, and exit 1 outranking exit 3 so a truncated run with a
blocker reports 1 (`src/cli/index.ts:422-437`, deliberate — the consequence is what is new).

**Open risks, detailed in `progress.md`:**

- Claim matchers are regexes over model prose. Both audit rounds found false negatives there; the
  evidence side has produced none. That is the fragile half.
- `license-clean`/`dependencies` no longer couple to this repo's state; other cases unaudited.
- `policy`, `filteredFiles`, and `context` are still last-chunk-wins in `chunkRunner`. That remains
  a deliberate, documented simplification — none of them asserts anything about coverage the way
  `toolAvailability` does, which is why only that field was promoted to a real merge.
- The `ai-review` CI runner can hang indefinitely (observed 43 min without starting step 1). This is
  environment-side — the runner runs interactively via `run.cmd`, not as a supervised service, so
  nothing restarts it. `review.yml`'s `timeout-minutes: 45` is a backstop, not a fix.

> Prior session history: [`archive/activeContext-history.md`](archive/activeContext-history.md).

## What's Working

- Full 16-agent swarm (15 default + testgen opt-in): all specialists + OrchestratorAgent
- `SwarmRunner` with policy filtering, context injection, sanitizer, sequential/parallel execution
- CLI: `--profile`, `--context`, `--context-mode`, `--context-budget`, `--format` (markdown/json/sarif/github-annotations), `--no-emoji`, `--agents`, `--dir`, `--ignore`, `--no-sanitize`, `--suggest-tests`, `--write-tests`
- Finding schema: domain, evidence, impact, recommendation, blocking, source, lineEnd (MB/PMB-aligned)
- Semantic context: `--context-mode semantic` uses nomic-embed-text to rank memory-bank files by diff similarity
- Policy layer: `agentPolicy` per-agent include/exclude glob path filtering
- `.aiignore` negation patterns: `!pattern` overrides excludes (gitignore-style)
- ESLint (`npm run lint:eslint`) — 0 warnings, included in `npm run check`
- Calibration CI: self-hosted runner, 20min timeout (nondeterminism noted under Verified state).
- **789 unit tests**; `npm audit` clean. `npm run test:docker` is the fallback when native modules
  will not load (Smart App Control) or CI is unreliable.
- `SecretsAgent`/`DependenciesAgent` use gitleaks/`npm audit` directly when available, skipping the
  LLM entirely; `ReviewResult.toolAvailability` surfaces degraded and partial runs (markdown, SARIF,
  and MCP), merged across chunks rather than last-chunk-wins
- `src/core/parsing.ts`: `validateAndNormalizeFindings()` extracted from BaseAgent (SRP)
- `vscode-extension/src/runner.ts`: 5-minute wall-clock subprocess timeout
- `src/core/contextLoader.ts`: emits stderr warning when `nomic-embed-text` unavailable
- **GitHub repo**: https://github.com/unyieldingclaw-dev/ai-code-review-agent
- **npm**: `ai-review-agent@1.13.1` via Trusted Publishing (OIDC), SLSA v1 provenance attached;
  `main` and npm are in sync. `release.yml` has no npm secret dependency — `id-token: write` + the
  Trusted Publisher relationship on npmjs.com suffices; `npm install -g npm@latest` runs early
  (OIDC needs npm >= 11.5.1).

## Next Steps

- **Per-agent timeout ceiling — blocked; the figure behind it is UNSOURCED (2026-08-27).** The
  "616 s against a 282,240 ms ceiling" long recorded here as a PMB finding is not in PMB's record
  at all — they grepped their whole repo and found zero hits, hold no per-agent timings or chunk
  count, and declined to reconstruct it. **Do not raise the ceiling on those numbers.** The reading
  was never settled either (616 s is ambiguous between one invocation and the aggregate over ~20–36
  of them). To unblock, instrument rather than argue: log elapsed time per `SwarmRunner.run()`
  alongside `chunkLines`, reproduce CPU-only via `OLLAMA_NUM_GPU=0`. Full analysis in
  `progress.md`. **Do not pick a new number by reasoning** — unmeasured tuning here has backfired.
- **PMB 1.2.1 upgrade** — on hold: `mb upgrade` copies from PMB's **working tree**, not a tag, and
  that tree had uncommitted in-flight edits. Fixes `last-reviewed`; nothing else depends on it.
- **Marketplace publish** (VS Code extension): explicitly DEFERRED.

> Removed 2026-08-20: an "Anthropic/Claude provider (backlog)" item, contradicting `projectbrief.md`
> ("Ollama-only backend"), `systemPatterns.md` **Never Do This**, and its Sequential Execution
> rationale (which uses "no Anthropic/Claude API integration" as a load-bearing premise), plus the
> shipped identity ("zero API costs"). No decision authorizing it exists. Reinstating it needs a
> projectbrief amendment and a revisit of parallel-vs-sequential, not a backlog line.

## Environment Status

**Infrastructure**: Ollama on port 11434 — required for integration tests and calibration, not for
unit tests. **Git**: `main` at `031210c` = `v1.14.0` = npm latest. Commands are in
`techContext.md`; `npm run check` covers typecheck/build/format/lint/test in one pass.
