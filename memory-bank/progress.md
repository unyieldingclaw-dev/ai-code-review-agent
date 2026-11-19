---
authority: accumulating
review-cycle: 30d
retention: archive-after-6m
staleness-threshold: 90d
tags:
  - work/completed
  - work/in-progress
  - work/backlog
last-reviewed: 2026-11-18
compaction_generation: 0
source_type: canonical
confidence: high
lineage: []
---

# Progress Tracker

**Last Updated**: 2026-11-18

> Older completed work lives in [`archive/progress-history.md`](archive/progress-history.md).

## ✅ `--fail-fast` stops on published severity (2026-11-18): merged as #102 (`81dce80`)

The stop check now runs `orchestrator.previewPublished` (quiet `synthesize`) on findings so far, so a
solo High later downgraded can no longer halt the swarm and exit 0. No new exit code. CHANGELOG.

## ✅ `techContext.md` first archive pass (2026-10-23): 155 lines moved out of 399

The three PMB reference blocks moved verbatim to `docs/architecture/pmb-integration.md` (pointer left,
naming when to read it); 12 narrative/measurement sentences to `archive/techContext-history.md`.
Done before `mb upgrade`, whose warn-only size check flags `techContext.md` past 300 lines.

## ✅ `fetch failed` fixed — merged as #98 (`2aa8c0b`, 2026-10-24): undici's 300 s cap removed

Node's default `fetch` dispatcher abandons a response whose headers take over 300 s, and with
`stream: false` Ollama sends none until generation ends. So any call past 300 s died at ~307 s as
`fetch failed` (`UND_ERR_HEADERS_TIMEOUT`), classified `error` not `timeout` (`parsing.ts`), retried,
and raising `--timeout`/`CALIBRATION_TIMEOUT_MS` past 300 s did nothing. `ollamaProvider.chat()` now
uses undici's own `fetch` with an `Agent` whose header/body timeouts are off (one package, so fetch
and Agent match on every Node); the AbortSignal every call carries is the only deadline. Off rather
than raised: agents pass only a signal, so no fixed value covers every ceiling. Local server
withholding headers 310 s: before, failed at 307,133 ms; after, answered at 310,028 ms. Adds
`undici@^7.30.1`; `engines.node`, README and setup scripts now require `>=20.18.1` (CHANGELOG
"Changed", BREAKING). Ollama logged these as 500s of 5m6s-5m7s; the 2026-09-18 recall-study
"5m7s" 500s carry the same signature.

## ✅ PR #92 merged (2026-10-23): reviewer-composition contract, kept in docs

The contract for changing the reviewer set (utilities vs orchestrator, deliberate overlap,
orthogonal axes, trust by replay, reviewer lifecycle, decision boundary, routing-collision audit)
lives in `docs/architecture/reviewer-composition.md`; `systemPatterns.md` keeps a pointer saying
when to read it. It went to docs because adding it took `systemPatterns.md` to 337/300 (now
286/300, with 15 evidence sentences also archived verbatim). **It is not auto-read at session
start**, and agents given the first 4000 characters of `systemPatterns.md` see only the pointer.
Follow-ups, unscheduled: a read trigger for changes to what ACR does with its verdict (the
contract's rule 6), the archived reason behind the separate-tool-call marker rule, and
`src/core/config.ts:98-99`'s stale "Parallel Execution" pointer.

## ✅ PR #95 merged (2026-10-23): read-only Ollama server-log check

`npx tsx calibration/ollamaLogCheck.ts --from <t> --to <t> [--log <file>]... [--expected-blob <sha>]
[--json]` explains each model request in a window from Ollama's own log: minimum queue wait, load,
prefill, maximum compute time, tokens generated, and which of queue/load/prefill/generation
dominated. Exit 3 = contention, 0 = none, 1 = the logs read cannot vouch for the window. 70 unit
tests over 15 real-log fixtures (0.34.x-0.40.4). Replaying the Sep 15-24 log explains 2,063 requests
except six 404s; on 0.34.4-0.40.4 a timed-out request's cancel line can precede its own 500, and is
now linked to it. PR 2 of the calibration-envelope contract (per-trial provenance in
`calibrate.ts`/`ollamaProvider.ts`) has not started. Its checkpoint comes first: a deliberately
created queue wait MUST be classified queue-bound by the log check, or stop and report before PR 2
(announce the live check to the PMB session first). Deferred items: #95's description.

## ✅ Oracle log is now formatted at write time; NS-58 reference filed (2026-10-23)

- `calibration/calibrate.ts` runs the oracle log through prettier before writing; a formatting failure warns and writes unformatted, so `oracleRuns` are never lost. Covers that one writer only. Merged as #96.
- Still needs `npm run format`: hand-saved output, CLI `--out` captures, `active-task.json`, plan docs.
- General commit-time check is PMB NS-58 (`.githooks/pre-commit` is TEMPLATE_OWNED). Tested reference block: `docs/superpowers/plans/2026-09-26-ns58-pre-commit-format-check-reference.md`.

## ✅ PR #93 merged (2026-10-23): calibration oracle runs are unscored, not passed

`calibrate.ts`'s `adversarial-dirty` oracle case asserts nothing (classification is manual), yet
its path did `passed++`. Now the summary reports `N oracle run(s) unscored (manual classification
required)` only when N > 0, and the exit code is unchanged (a completed oracle run never affects
it; one that errors still counts as failed). **A full-suite `passed` total is one lower than before
for identical model behavior** — the "23 passed" figures in the "Timeout plumbing bug" entry
([`archive/progress-history.md`](archive/progress-history.md)) predate this. A `CalibrationTally`
class from the first draft was dropped: it duplicated `oracleRuns.length`. Note `tsconfig.json`
covers only `src/**`, so CI's typecheck never sees `calibration/`; typecheck it standalone.

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

## 🔧 Timeout plumbing bug (2026-09-19): fixed, merged as #88 — archived

Full entry moved to [`archive/progress-history.md`](archive/progress-history.md) on 2026-11-18.
Two points from it still stand. **Every calibration batch before the fix ran under a ~300 s
ceiling**, whatever `CALIBRATION_TIMEOUT_MS` or `agentTimeoutMs` said, restraint and recall alike,
so the "Recall measurement" timeouts below were taken under it. **`calibrate.ts`'s own call site
has no test coverage** (run by `tsx`, excluded in `tsconfig.json`, no test imports it): an edit
that drops its `AbortSignal.timeout(agentTimeoutMs)` argument would bring the bug back, and no test
would catch it.

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
> "`#84`/`#86`/`#87` merged; `#85` not merged" entry, archived there too, which covers the same work plus what
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
