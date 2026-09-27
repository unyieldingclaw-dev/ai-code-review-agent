---
authority: accumulating
review-cycle: 30d
retention: archive-after-6m
staleness-threshold: 90d
tags:
  - work/completed
  - work/in-progress
  - work/backlog
last-reviewed: 2026-09-26
compaction_generation: 0
source_type: canonical
confidence: high
lineage: []
---

# Progress Tracker

**Last Updated**: 2026-09-26

> Older completed work lives in [`archive/progress-history.md`](archive/progress-history.md).

## ✅ Three PRs merged back to back (2026-09-26): #90, #88, #85 — `main` caught up, no open PRs

**All three of this session's open PRs merged today, in this order: #90 (historical checkpoint),
#88 (timeout-plumbing fix + calibration oracle), #85 (the long-stale `earlyExit`/stderr fix).**
`gh pr list` returns empty afterward — verified directly, not assumed. Getting there took three
real, generalizable lessons, now in `systemPatterns.md`/`techContext.md` in full — summarized here
for the "what happened" record:

- **Merging one PR pushes every other open PR to `BEHIND` again, cascading.** With three PRs open,
  each of #88 and #85 needed `main` merged in twice — once after #90 merged, again after the other
  merged next. Branch protection's `strict` mode re-checks after every merge to `main`, not once.
- **`.claude/contracts/active-task.json` is single-slot, so long-lived branches collide on it.** Both
  #88-vs-#90 and #85-vs-#90 hit the identical conflict (two branches each writing their own
  completed-task record). Resolved both times by keeping the newer record — the file is scratch
  state, not an audit trail, so the older side's own durable record (already in this file, or in
  `CHANGELOG.md`) is never actually lost.
- **`ai-review` timed out three times in a row on #90** (45m56s–47m25s, over the 45-minute CI
  ceiling) while `ollama ps` showed devstral pinned at the CPU-heavy 70%/30% split documented in
  `techContext.md`'s 2026-09-01 counter-datum. Passed on the fourth retry once Ollama had gone fully
  idle and reloaded (44m34s), then comfortably on later runs (31m, 13m) — see `techContext.md` for
  the full pattern. Retrying after confirming `ollama ps` is idle is now the first move for this
  failure shape, before reaching for a CI config change.

**Also resolved in passing:** the mid-session "unexplained `.githooks/pre-commit` modification" this
project had never actually recorded anywhere — it was a legitimate `TEMPLATE_OWNED`-hook fix draft
(reported upstream to PMB as **NS-58**, parked in
`docs/superpowers/plans/2026-09-26-ns58-pre-commit-format-check-reference.md`) being worked on by
another Claude session sharing this same working directory. **This directory is confirmed shared
with concurrent peer sessions, not a theoretical risk** — worth checking `git status` for
unfamiliar-but-untracked files before assuming they're stray.

## 🔎 Historical checkpoint (PR #90): the synthetic ranking does not transfer at N=2 (2026-09-21)

**First real-code test of whether the synthetic-fixture model ranking (Ornith best recall, Qwen3.5
best restraint/runtime, Devstral weakest) holds up against real historical defects. It does not.**
Explicitly not "the historical corpus" — N=2, a checkpoint, not a corpus-scale conclusion.

**Corrected on refetch: PR #85's CI comment had 12 findings, not the inherited 11** — recounted
fresh via `gh api`, not trusted. All 12 re-adjudicated against the real code at commit `7f07fd68`;
all 12 confirmed fabricated, each traced to its own falsifying mechanism (e.g. one cites
`runner.ts:873` for a `status` field that doesn't exist anywhere near that line in the diff).
**Pre-registered a real-defect oracle for PR #84** at commit `b7634e2` (D1: `mergePolicy` missing its
`coverageIncomplete` guard; D2: `mergePolicy` returning a truthy-but-empty object instead of
`undefined`), independently re-verified against the actual snapshot before any model saw the diff.

**Ran all three models once each against both real diffs via the real CLI** (`--timeout 300000`,
full default agent set, locked order). **Ornith — best synthetic recall (52.5%) — produced zero
findings on either real diff.** No model detected either PR #84 defect. Devstral repeated 2 of its
original 12 fabrications, added new ones, and produced a new failure mode: hallucinating that an
already-fixed historical bug still applies. Qwen3.5 had the best runtime, but 2 of its 3
`"source": "lizard"`-attributed complexity numbers were independently confirmed fabricated by
running `lizard` directly against the real files — **a separate, generalizable finding: `lizard`
attribution is not reliable provenance on its own**, even when `toolAvailability.lizard: "used"` is
genuinely true (the tool ran; the number attached to it didn't come from it).

Full write-up, all 6 raw model outputs, and both fixture diffs:
`docs/superpowers/plans/2026-09-19-acr-historical-checkpoint-pr84-pr85.md`,
`calibration/fixtures/historical-pr{84,85}.diff`,
`calibration/historical-checkpoint-raw.*.json`. **No production model change.** Extending this past
N=2 into an actual historical corpus is a separate, not-yet-made decision.

## 🔧 Timeout plumbing bug: found, fixed, verified (2026-09-19)

**Found via this repo's own `/code-review` (triggered by the pre-commit hook on
`chore/model-recall-calibration`'s uncommitted work), independently confirmed by direct source
reading and by the opposition reviewer.** `calibrate.ts`'s agent-invocation call site never passed
a `signal` to `BaseAgent.run()`, so `OllamaProvider.chat()`'s
`signal: options.signal ?? AbortSignal.timeout(options.timeout ?? DEFAULT_TIMEOUT_MS)` always fell
through to its own hardcoded 300,000ms default — regardless of `CALIBRATION_TIMEOUT_MS`,
`agentTimeoutMs`, or anything in `config.ts`. Every calibration batch run to date, in both the
restraint (`adversarial-clean`) and recall (`adversarial-dirty`) experiments, ran under the same
~300s ceiling; no batch was ever actually at 180s. This invalidates the specific causal claim
"retested Ornith at 300000ms, timeout rate dropped" as a _causal_ statement — the observed drop is
real but is run-to-run variance, not a timeout-budget effect. Corrected in place in both
`docs/superpowers/plans/2026-09-18-acr-model-comparison-devstral-ornith-qwen.md` and
`.../2026-09-18-acr-adversarial-dirty-fixture-design.md`; the raw findings, FP rates, and recall
percentages already reported are unaffected and stand as measured.

**Two self-critique passes on the remediation plan (both user-requested) before touching code**
caught: an overreach (adding a `main()`-execution guard purely for testability, rejected —
`calibrate.ts` has zero tests by deliberate project convention); a non-protective metadata field
(`effectiveTimeoutMs`, would have been derived from the same variable used to build the signal and
so could never diverge — replaced with an independently-measured `elapsedMs`); and a
data-destructive crash-safety design (silently treating a corrupted oracle log as empty, rejected
in favor of backing it up to `.corrupted-<timestamp>.json` first).

**Fix, applied to the shared call site used by every calibration case, not just the new oracle
one**: `calibrate.ts` now passes `AbortSignal.timeout(agentTimeoutMs)` explicitly. Added
`elapsedMs` (independently measured wall-clock time, not derived from `agentTimeoutMs`) to each
`oracleRuns` log entry. Wrapped the oracle-log `JSON.parse` in try/catch with a corrupted-file
backup, since it previously sat outside any try/catch and a truncated prior log would have crashed
`main()` and lost the current invocation's freshly-collected data too, not just the old history.
Added 3 regression tests to `tests/unit/ollamaProvider.test.ts` covering `OllamaProvider.chat()`'s
side of the contract — `options.signal ?? AbortSignal.timeout(options.timeout ?? DEFAULT_TIMEOUT_MS)`
(caller signal honored and forwarded unchanged; a caller timeout is actually enforced rather than
falling back to 300s; two different caller timeouts produce two measurably different enforced
deadlines). **These do not cover `calibrate.ts`'s own call site** — it has zero test coverage by
deliberate project convention (tsx-only, excluded from `vitest.config.ts`), so a future edit that
drops the `AbortSignal.timeout(agentTimeoutMs)` argument there would reintroduce this exact bug and
nothing here would catch it; caught and corrected in this session's own re-check after an earlier
comment overstated this as closing that gap. 911/915 tests passing (4 pre-existing skips, unrelated
to this change), clean typecheck/lint/format.

**Verification run — `npm run calibrate` unfiltered against `devstral:latest`, matching CI's exact
invocation, run once after the fix as planned: 23 passed, 3 failed. All three failures pre-date or
are independent of this fix, not new regressions it introduced:**

- `dependencies`: 3 real CVEs (fast-uri, hono, qs) — confirmed directly via `npm audit --json`
  against this repo's actual current dependency tree (2 moderate, 1 high). `DependenciesAgent`
  shells out to real `npm audit`, never touches Ollama, and is untouched by this fix. Environmental
  drift (new CVEs disclosed since this fixture was last green), not a code defect.
- `adversarial-clean`: one hallucinated finding on a single trial. Consistent with Devstral's
  already-measured ~70% failure rate on this exact fixture (see the model-comparison entry below);
  unrelated to timeouts.
- `adversarial-dirty`: **"agent error: The operation was aborted due to timeout."** This is the one
  failure worth flagging as a genuine, newly-exposed consequence of the fix rather than noise.
  Devstral was already measured at a 20% timeout rate on this exact fixture (4/20 in the N=20×3
  recall study) — but that study, like everything else, ran under the accidental ~300s ceiling.
  This verification run is the first time `adversarial-dirty` has ever run against the _real_
  180s default (`DEFAULT_CONFIG.agentTimeoutMs`, CI's implicit value — no `CALIBRATION_TIMEOUT_MS`
  is set in `.github/workflows/calibrate.yml`), and a single trial timing out is unsurprising given
  the fixture's already-known timeout-proneness at the longer, previously-silent budget.
  **Resolved 2026-09-19, user's call:** flagged as an operational decision rather than patched
  around unilaterally; user directed raising it. `.github/workflows/calibrate.yml`'s "Run
  calibration suite" step now sets `CALIBRATION_TIMEOUT_MS: '300000'`, pinning calibration back to
  the ~300s budget it always effectively ran under. Production's real timeout enforcement
  (`src/core/runner.ts`'s `withTimeout`) is untouched — this only affects the calibration
  harness's own budget, not `DEFAULT_CONFIG.agentTimeoutMs` (180000) or real review runs.

**Done, not paused any longer:** the re-adjudication of PR #85's findings and PR #84's pre-registered
oracle — see "Historical checkpoint" above. **This fix itself merged to `main` as PR #88 on
2026-09-26**, alongside PR #90 (the checkpoint) and PR #85 (finally clicked to merge) — see "Three
PRs merged back to back" above for what that took.

## ✅ #84/#86/#87 merged; #85's merge-conflict resolution is done and pushed, NOT merged (2026-09-18)

**Corrected 2026-09-18: this section previously claimed all four PRs were in `main`. `#85` is not**
— verified via `gh pr view 85` (`state: OPEN, mergedAt: null`), not assumed, after a later request
depended on knowing which PRs actually merged. `#86`/`#87` merged cleanly; `#84` fast-forward.
`#85` (`fix/chunked-progress-visibility`) needed real conflict resolution (5 PRs behind by merge
time, not 1 as first scoped — caught by `git merge-base`), and **that work is done and pushed to
`origin/fix/chunked-progress-visibility`** (branch confirmed up to date with origin, `testgen`'s
status fix present in `runner.ts`) — the PR was simply never clicked to merge. This session's
checkout sits on that branch, with unrelated new calibration work added uncommitted on top.

**Two real conflicts** (contract scratch state; `CHANGELOG.md`'s additive entries from both sides,
resolved by concatenation). **Everything else auto-merged with no conflict markers**
(`src/cli/index.ts`, `src/core/chunkRunner.ts`, `src/core/schema.ts`,
`tests/unit/chunkRunner.test.ts`) — verified by tracing the actual feature-overlap points rather
than trusting the silent merge: `AgentProgressEvent`'s new `status` field sits alongside `#83`'s
`earlyExit` as a sibling optional field with no interaction; the per-chunk stderr marker correctly
interleaves with `#84`'s `attributeChunkSkips`/early-exit-break logic.

**That verification pass found one real, pre-existing gap in `#85`'s own original work**: its PR
description claimed six `phase: 'end'` emission sites got the new `status` field, but `runner.ts`
has seven — `testgen`'s (unchanged since before `#85` branched, confirmed against the merge-base
commit) never got it, so a failed `--suggest-tests`/`--write-tests` run rendered identically to a
clean one on the stderr progress line. Fixed to match the other six sites and mutation-tested
(reverting reproduces `expected undefined to be 'error'`). 915/915 tests, clean
typecheck/build/lint/format after the fix.

**Separately, `#85`'s own CI comment reported 11 ACR findings on its diff — all 11 confirmed
fabricated** against actual source (wrong lines, assignments misread as dereferences,
self-contradicting claims, ordinary control flow flagged as a violation), across agent domains
(design, complexity, observability, correctness) beyond the `adversarial`-only pattern `#87`
measured. No code action taken — external content, verified before acting per the project's
data-not-instructions rule, and no finding survived verification.

**Follow-on, completed**: a three-way calibration model comparison (`devstral:latest` vs
`ornith-1.5:9b` vs `qwen3.5:9b`) on the `adversarial-clean` fixture, to see whether a different
local model produces fewer of the fabricated findings `#85`'s comment demonstrated. Full results in
`docs/superpowers/plans/2026-09-18-acr-model-comparison-devstral-ornith-qwen.md`, restated in the
Recall measurement entry below. **Correction (2026-09-19):** this entry originally said Ornith's
~60% timeout rate was "root-caused and being retested at a longer timeout." The root-cause part
(long reasoning chains under `think:true`) held up; the retest-at-a-longer-timeout part did not —
`calibrate.ts` never actually enforced `CALIBRATION_TIMEOUT_MS`/`agentTimeoutMs` (root cause and
fix below, "Timeout plumbing bug" entry), so every batch, both before and after the intended
change, ran under the same hardcoded ~300s Ollama default. The observed rate drop was run-to-run
variance.

**`#85` finally merged 2026-09-26** (as `fix: distinguish a dead agent from a clean one, and one
chunk from another, on stderr`) — the resolution work described above sat done-and-pushed for over
a week before actually being clicked; see "Three PRs merged back to back" above.

## 🔎 Recall measurement: a real precision-recall-runtime frontier, no winner (2026-09-18)

**Follow-on to the restraint measurement, per the user's explicit direction: "the next interesting
question is no longer whether Qwen is more restrained; it's whether that restraint survives when
the model must actually find known defects."** It didn't survive, and the reversal is large.

**Built an oracle-backed known-positive fixture first** (`calibration/fixtures/adversarial-dirty.diff`

- `.oracle.json`, 4 real defects + 1 negative control, scoring rules and full run config
  pre-registered), approved via Task Contract with 5 procedural protections (negative control kept
  separate from the defects; per-model raw logs kept not-gitignored so the restraint measurement's
  Devstral-data-loss can't repeat; fixed run order not reordered after early results; a pre-checkpoint
  smoke run tagged and excluded rather than folded into the dataset; fixture/oracle left unchanged by
  what that smoke run revealed). Full procedure in the design doc, not restated here.

**Mean exact-detection recall across the 4 planted defects: Devstral 20%, Qwen3.5 32.5%, Ornith
52.5%.** Per-defect: `D1` (clamp bug) 0%/20%/75%; `D2` (off-by-one→NaN) 65%/80%/85%; `D3`
(ms/seconds unit mismatch) 0%/0%/0%; `D4` (empty-array median) 15%/30%/50%.

**`D3` was missed by every one of 60 trials — a fixture design finding, not a model signal, and its
0% stays in the official score for all three, not excluded or adjusted.** Every model converged on
the same different, real, but unplanted observation instead (`chunkDurationsMs` not validating
equal array lengths, one function away from the actual bug: `formatDurationSummary` mislabeling
milliseconds as seconds). This "adjacent bug dominated attention" explanation is interpretation of
_why_ — it does not touch the number; correcting a preregistered score after seeing every model
miss it is the exact goalpost-move this methodology exists to prevent.

**The negative-control rates here (5%/30%/56%) do not cancel or update the restraint measurement's
`verified` rates (55%/25.8%/18.4%)** — not the same measurement. `adversarial-clean` had 4
already-guarded functions and nothing else to find, built specifically to provoke false positives;
this fixture has 1 control competing against 4 real defects. Ornith's 5% here says it didn't
fabricate a claim when real bugs were available elsewhere — it says nothing about a fixture with no
real bugs at all, which the restraint measurement already answered, at a high rate. Both stand.

**Honest summary is a frontier, not a winner** — Devstral: mediocre restraint, weakest recall (20%
mean), and a real new operational strike: 0/20 timeouts on `adversarial-clean` vs 4/20 (20%) here,
meaning ordinary diff-complexity variation (not just "thinking" mode) can now cost ACR an answer
entirely, invisible until a fixture this size existed to expose it. Qwen3.5: best restraint (45%
clean/18.4%
verified), best runtime (0% timeouts on both fixtures), middle recall (32.5%). Ornith: worst
restraint (15% clean/55% verified), best recall (52.5%), timeout-prone (15%, then 5%). **No
synthetic scalar score invented to force a winner** — weighting recall against dangerous-FP-rate
now, having seen both outcomes, would encode a preference into the metric after the fact rather
than measure one. **Devstral is no longer the presumed incumbent a challenger must dethrone** — one
of three candidates, currently with the weakest empirical case: no clear advantage on any of the
three axes, where Qwen3.5 and Ornith each have one.

**Next, not started, per explicit direction: stop building synthetic fixtures.** A small labeled
historical corpus (~10-20 real past review cases, established dispositions, real repo context), same
five axes (mechanism-correct recall, unsupported/verified-but-false findings, timeouts, failure
amplification), across all three models — answers what no synthetic fixture can. Not doing yet: any
model-specific guard, prompt tuning, routing, or ensemble ("Ornith for recall, Qwen for
verification") — would mask which base model is better before that's even decided.

**Classification is manual against pre-registered `minimumEvidence`, not automated** — per this
project's own standing note that claim-matcher regexes over model prose are "the fragile half."
The harness only automates the cheap part (does a cited file:line fall in a defect's range). A real
content/location cross-contamination pattern surfaced (didn't change any trial's outcome, but makes
the negative-control rate above a **lower bound**) and two disclosed leniency rules were applied
consistently — both detailed in the design doc, not restated here.

**No production model change.** Full design, oracle, scoring rules, locked configuration, and
results: `docs/superpowers/plans/2026-09-18-acr-adversarial-dirty-fixture-design.md`. Per-trial audit
trail (original finding text + human classification, kept as separate records so judgment calls can
be re-checked): `calibration/adversarial-dirty-classifications.<model-slug>.json`.

> The restraint-only comparison this recall measurement follows on from (numbers restated above) is
> fully written up in `docs/superpowers/plans/2026-09-18-acr-model-comparison-devstral-ornith-qwen.md`.

> `#84`'s merge with `#83`, two fast-follow fixes, and its full change-review (2026-09-13–17) are
> archived in [`archive/progress-history.md`](archive/progress-history.md) — superseded by the
> "`#84`/`#86`/`#87` merged; `#85` not merged" entry above, which covers the same work plus what
> came after.

## ✅ Two shipped invariants worth not re-deriving

Moved here from `activeContext.md` on 2026-08-31: shipped behaviour is what this file is for, and
holding it in the volatile file was costing the headroom that file most needs.

- **The evidence-location check (v1.14.0) flags — never corrects or drops** — a finding whose quoted
  evidence is not at its cited `file:line`, on all four **formatters** — which is four of the SIX
  surfaces that render a verdict. Verified 2026-08-31: `locationCheck` and `toolAvailability` each
  appear in all four formatters and **zero times** in `.github/workflows/review.yml` or
  `vscode-extension/src/`. So a misplaced-evidence finding is flagged on four surfaces and silently
  unflagged on the PR comment, which is the most-read of them. Not fixed; recorded because the
  six-surface rule in `systemPatterns.md` makes it visible for the first time.
- **Four hallucination classes have deterministic backstops rather than prompt wording**, because
  prompt-only fixes were measured across three agents and failed every time. Detail in
  [`archive/progress-history.md`](archive/progress-history.md).

## 🔎 `chunkRunner`'s `mergeResults` still drops `truncation` entirely — OPEN (2026-09-01)

Reported by the PMB peer 2026-09-01 and **live-reproduced by them rather than read**: a diff with
one file section larger than `--max-lines`, run `--chunk --format json`, printed the truncation
warning on the console while the emitted JSON carried **no `truncation` key at all** and the run
exited **0**. So `result.truncation?.truncated` can never be true under `--chunk`, and **exit code
3 is unreachable** — the single case it exists to catch degrades silently to exit 0 with nothing in
the body or the code. Repro is cheap: a 35-line file section against `--max-lines 20`. A second,
independent trigger for the same field-drop is recorded below via the `break` at
`chunkRunner.ts:90`. **Deliberately not fixed** — making exit 3 reachable changes what PMB's
`/change-review` Job 7 branches on, an operator decision, not a ride-along on a formatter change.
`context` also remains last-chunk-wins, by the same deliberate simplification. Full detail on the
now-fixed `policy`/`filteredFiles` merge and the `filteredFiles` invisibility investigation that
preceded it: [`archive/progress-history.md`](archive/progress-history.md).

> The `earlyExit` invisibility investigation (2026-08-31) that preceded its fix (PR #83) is archived
> in [`archive/progress-history.md`](archive/progress-history.md), along with completed work through
> 2026-08-28 (PMB corrections, #77/#78, the four "known, not fixed" follow-ups, and the 2026-08-28
> session close).

## 📊 Metrics

### Test Coverage

- **Unit Tests**: 839 passing across 47 test files, verified 2026-08-31 (run `npm test` for current
  count — this line has been stale twice, so trust the command over it)
- **Integration Tests**: 1 file, 5 tests — skip without INTEGRATION=1, run with live Ollama

### Implementation Progress

- **Tasks complete**: 16 / 16 (100%) ✅ + Phase 2 (8 tasks) ✅ + v0.8.0 (5 new agents) ✅
- **Agents implemented**: 17 / 17 (16 specialists + orchestrator) ✅
- **TypeScript errors**: 0
- **GitHub**: https://github.com/unyieldingclaw-dev/ai-code-review-agent

## 🎯 Milestones

### Phase 1: Core Infrastructure (Complete)

- ✅ Project scaffold, type system, config, LLM provider, BaseAgent
- **Completed**: 2026-06-04

### Phase 2: Agents + Orchestration (Complete)

- ✅ 9 specialist agents (Tasks 6–8)
- ✅ Orchestrator (Task 9)
- ✅ SwarmRunner (Task 10)
- **Completed**: 2026-06-05

### Phase 3: CLI + Distribution (Complete)

- ✅ CLI + formatters (Task 11)
- ✅ GitHub Actions adapter + workflow (Task 12)
- ✅ Slash command (Task 13)
- ✅ Calibration suite (Task 14)
- ✅ Integration test — E2E (Task 15)
- ✅ Final wiring + verification (Task 16)
- **Completed**: 2026-06-06

## 📈 Version History

| Version         | Date          | Changes                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.1.0-dev       | 2026-06-04    | Tasks 1–5: scaffolding, types, config, Ollama, BaseAgent                                                                                                                                                                                                                                                                                                                                  |
| 0.1.0-dev       | 2026-06-05    | Tasks 6–10: all 10 agents, orchestrator, SwarmRunner (19 tests)                                                                                                                                                                                                                                                                                                                           |
| 0.1.0           | 2026-06-06    | Tasks 11–16: CLI, GitHub Actions, slash command, calibration, e2e test, final verification                                                                                                                                                                                                                                                                                                |
| 0.1.1           | 2026-06-06    | Guardrails G1–G6: hallucination check, diff size guard, dedup merge, timeouts, severity gate, path exclusions (37 tests)                                                                                                                                                                                                                                                                  |
| 0.2.0           | 2026-06-06    | Phase 2: CLI consolidation, sanitizer, BreakingChangeAgent, LicenseComplianceAgent, confidence scoring, calibration CI (62 tests)                                                                                                                                                                                                                                                         |
| 0.3.0           | 2026-06-10    | npm distribution: package renamed `ai-review-agent`, release workflow, Node.js 24, published to npm                                                                                                                                                                                                                                                                                       |
| 0.4.0           | 2026-06-11    | prompt tuning + calibration expansion: `confidence` on all 10 agents, calibrate.ts covers all 11, new breaking-change + license fixtures                                                                                                                                                                                                                                                  |
| 0.5.0           | 2026-06-11    | Cursor/VS Code extension: subprocess architecture, bundled install, command palette trigger, DiagnosticCollection + OutputChannel (V5-1–V5-7)                                                                                                                                                                                                                                             |
| 0.5.0 (cleanup) | 2026-06-12    | vscode-extension dep → `^0.4.0` (npm), tarball removed from repo, `.gitignore` stale exception removed                                                                                                                                                                                                                                                                                    |
| 0.6.0           | 2026-06-12    | MCP server: `ai-review-mcp` binary, `review_diff` tool, stdio transport, A+C hybrid output, 10 agents (no testgen), `.cursor/mcp.json`, 77 unit tests                                                                                                                                                                                                                                     |
| 0.7.0           | 2026-06-13    | Configurable retry logic: `withRetryTimeout` wrapper, `retryAttempts`/`retryDelayMs` config fields, `--retry-attempts`/`--retry-delay` CLI flags, 3 new retry tests (80 total)                                                                                                                                                                                                            |
| 0.8.0           | 2026-06-15    | 5 new specialist agents: ErrorHandlingAgent, ObservabilityAgent, MigrationSafetyAgent, SecretsAgent, ComplexityAgent; shell.ts runTool(); conditional MigrationSafety skip; 32 new unit tests (112 total); 5 calibration fixtures; README + config updated                                                                                                                                |
| 0.9.0–0.9.4     | 2026-06-18–19 | --fail-fast, progress events, calibration tuning, --parallel flag; 120 unit tests                                                                                                                                                                                                                                                                                                         |
| 1.0.0           | 2026-06-24    | --profile (6 presets), --context memory-bank, --format sarif/github-annotations, policy layer (agentPolicy), extended Finding schema (domain/evidence/impact/recommendation/blocking/source), 15 agent prompts updated, 16/16 calibration, 248 tests                                                                                                                                      |
| 1.0.1           | 2026-06-24    | Audit remediation: sanitizer multi-pattern fix, BaseAgent defaults tests, GitHub adapter tests, vitest coverage fix, CHANGELOG, JSDoc, contextBudgetChars, lineEnd clamp, AGENT_PRIORITY docs; 264 tests                                                                                                                                                                                  |
| 1.1.0           | 2026-06-25    | --no-emoji, --context-mode semantic (nomic-embed-text), --context-budget, .aiignore negation, ESLint (0 warnings), coverage parser fixed, orchestrator breaking-change escalation, vscode-extension v0.6.0 (profiles + context), migration-safety fixture expanded; 276 tests                                                                                                             |
| 1.2.0           | 2026-06-26    | SRP: parsing.ts extraction; semantic context warning; vscode-extension timeout; OllamaProvider SSRF hardening; MCP shutdown handlers; 295 tests; all 3-round audit findings resolved                                                                                                                                                                                                      |
| 1.3.0–1.13.0    | 2026-06–08    | Not tracked here — see `CHANGELOG.md`, which is authoritative for per-version detail. This table drifted from 1.2.0 and is kept only for the early history above.                                                                                                                                                                                                                         |
| 1.13.1          | 2026-08-26    | Truncated runs report INCOMPLETE rather than a checkmark (#51); same-agent findings repeating one title collapse, keyed on title and keeping the highest severity (#50); `npm run test:docker` (#49). SLSA v1 provenance via OIDC.                                                                                                                                                        |
| 1.14.0          | 2026-08-27    | Evidence-location invariant on all four surfaces — a finding whose quoted evidence is not at its cited `file:line` is flagged, never corrected or dropped (#55, #58, #57); a timed-out agent is no longer retried against the same exhausted budget (#63).                                                                                                                                |
| 1.15.0          | 2026-08-27    | `ReviewResult.timings` — one row per `SwarmRunner.run()` call, concatenated across chunks and never summed, each agent carrying `attemptMs` (comparable to `effectiveTimeoutMs`), `elapsedMs` and `attempts` (#65); docs audited against the binary, fixing undocumented `--ollama-url` and exit code `4` (#68) and adding `agentStatus`/`testFiles` to the JSON envelope contract (#72). |
