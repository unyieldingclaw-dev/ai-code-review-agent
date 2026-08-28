---
authority: accumulating
review-cycle: 30d
retention: archive-after-6m
staleness-threshold: 90d
tags:
  - work/completed
  - work/in-progress
  - work/backlog
last-reviewed: 2026-06-26
compaction_generation: 0
source_type: canonical
confidence: high
lineage: []
---

# Progress Tracker

**Last Updated**: 2026-08-27

> Older completed work lives in [`archive/progress-history.md`](archive/progress-history.md).

## ✅ Completed (2026-08-27, third session)

**v1.15.0 released, and the repo's outward-facing information audited against the binary.** Eight
PRs (#65–#72). Releasing was the point rather than tidiness: `review.yml` installs the _published_
package, so until 1.15.0 shipped every CI run emitted a `findings.json` with no `timings`. The
collection this instrumentation exists for starts now.

**Three tagging incidents in one session, all recorded in `systemPatterns.md` with a guard.**
`v1.15.0` was tagged onto `main` after a merge branch protection had rejected, naming a commit
still reading `1.14.0`; then the _good_ tag was deleted by re-running the cleanup written minutes
earlier for the bad one, flipping the published Release to a draft. **npm's refusal to republish an
existing version is what limited the damage — the registry compensating for the process, not the
process working.** Recovered by re-tagging `6e2ed34` and re-publishing.

**Docs audited by diffing documentation against the binary, not by reading.** The README flag table
matched code 27/27 both directions; agent counts, `engines.node: ">=18"` (runtime deps genuinely
require 18) and CHANGELOG all held. Two real gaps found and fixed: `--ollama-url` and exit code `4`
were undocumented (#68), and `agentStatus`/`testFiles` were missing from the "stable envelope"
contract (#72) — `agentStatus` being the field that drives exit 2 and the only thing separating "no
findings, clean" from "no findings, every agent failed". Also fixed a `.vsix`-from-Releases install
instruction that had never been true. GitHub description, homepage and topics updated.

**Branch cleanup found that squash-merge blinds git's own detection** — 0 of 11 landed branches
reported as merged. Verified each local tip against its merged PR's `headRefOid`; one differed and
was merely _behind_. Rule in `systemPatterns.md`.

## ✅ Completed (2026-08-27, second session)

**Timing instrumentation shipped — `ReviewResult.timings`, one row per `SwarmRunner.run()` call.**
Each row carries `diffLines`, the scaled `effectiveTimeoutMs`, `durationMs`, and every agent's
`elapsedMs` paired with its `status`. Written to stderr as each pass completes and into the
envelope, so it reaches the `ai-review-findings` artifact. **810 tests** (19 new), `npm run check`
green.

**The measurement already existed; only the persistence was missing.** `AgentProgressEvent.elapsedMs`
has been set on every execution path -- coverage, sequential, parallel, testgen, on both the success
and the failure branch -- and printed to stderr all along. It was a fire-and-forget callback, so it
survived nowhere. The runner now taps that channel with a recording proxy instead of adding a second
timer, so **no agent execution path changed at all**. Generalisable: _emitted is not recorded_, and
a number that only ever reaches a terminal is a number you will be unable to cite later.

**Concatenate, never sum -- the one decision the field rests on.** `mergeResults` sums
`summary.durationMs`, which is right for "how long did this take" and fatal for "did any agent
approach its ceiling": the ceiling applies per `run()` call, so a sum exceeds every ceiling without
any agent having done so. That is precisely why "616 s" was unreadable. `status` is stored beside
`elapsedMs` for the mirror-image reason -- a timed-out agent's elapsed _is_ the ceiling, and reads
as a completion time sitting just under the limit unless it is labelled.

**A five-lens code review found two real defects in it, and the second measurement confirmed one
live.** (1) `elapsedMs` was captured outside `withRetryTimeout`, so it spanned every attempt plus
backoff while `effectiveTimeoutMs` governs one attempt — a parse-error-then-success rendered as an
agent past its own ceiling with `status: 'ok'` (measured 1015 ms vs a 300 ms ceiling). `AgentTiming`
now carries `attemptMs` + `attempts` alongside wall time, and a retried agent is named in the line.
(2) `buildTimingLines` opened with a bare `---`, which in CommonMark is a **setext heading
underline**, not a rule — it silently promoted the verdict line ("No issues found." / "INCOMPLETE
— reviewed 2000/12599 lines") to an `<h2>`. Two prior commits were spent on that exact line. Every
existing assertion used `toContain`, so all of them passed while the render was wrong; the new tests
assert on line adjacency instead.

**The review also found twelve false claims in the new WHY comments** — `locationCheck` called a
`ReviewResult` field (it is on `Finding`), a `slowestAgent` docblock describing "three consumers"
that a refactor had already removed, an invented "mcp must not import cli" rule enforced by nothing,
and an "earlier draft" cited from no commit. All corrected. Root cause: comments written against a
draft, then not re-read after the refactor that invalidated them. **And, worst: the unsourced 616 s
constants had been baked into four test fixtures and the README envelope example**, where a reader
takes them for a real measurement — the exact failure `10355d6` had just finished correcting.
Replaced with neutral values.

**Self-review caught a duplicate renderer before commit.** The stderr line first composed its own
string from the same four fields that `timingSentence` renders, and the two were already drifting --
one parenthesised the ceiling, only one labelled a timed-out agent. `formatRunTiming` now delegates,
so there is a single renderer behind stderr, the markdown footer and the MCP note. This is the
`TOOL_LABELS` rule applied to a field added specifically to stop people misreading a number.

**Verified through the real pipeline, not a probe.** A real `--chunk` CLI run produced three rows
with **different per-chunk ceilings** (288 s / 360 s / 360 s, scaled from 18 / 30 / 30 lines) --
which alone shows why one aggregate ceiling would have been wrong. All four surfaces confirmed
end-to-end: JSON envelope, markdown footer, SARIF `properties.timings`, and MCP (by replaying the
real captured artifact through `formatMcpOutput`). GitHub annotations excludes it deliberately,
with the three reasons recorded above the function so the absence reads as a decision.

**14 of 19 new tests fail against the unfixed code; the other 5 are guards and are not counted.**
Confirmed by mutating each change in turn and checking the message, not just the failure -- e.g.
`expected [ { chunkLines: 2700 } ] to have a length of 3 but got 1` for the summing mutation, and
`expected '...⚠️ No findings, b...' to contain '✅ No findings'` for folding timing into the
headline gate. One test moved from "guard" to "regression" only after a mutation was written that
could falsify it.

**The falsification harness lied first, and uniformly.** Its first run reported 0 failures for all
13 mutations. `--reporter=basic` was removed in vitest 4, so vitest errored before running a single
test and the parser read the empty output as "everything passed". A uniform verdict from a
verification harness is a harness bug until proven otherwise -- the same rule as distrusting a probe
that agrees with you, in the direction that would have discarded good tests instead of keeping bad
ones.

## ✅ Completed (2026-08-27)

**The timeout-ceiling figure is unsourced, and the item is blocked on measurement rather than on
effort.** This repo recorded, as a PMB finding, that on a CPU-only host reviewing a 10,039-line
`--chunk` diff "agents legitimately ran 616 s" against a 282,240 ms ceiling, with 2/4 dying on
`fetch failed` and ~46 min wall time. Asked to clarify one detail, PMB searched their entire record
— `memory-bank/`, `docs/`, `docs/archive/`, the 1.13.1 brief — for `616`, `282,240`,
`agentTimeoutMs` and `fetch failed`, and found **zero hits**. They hold no per-agent timings, no
chunk count, and no record of whether the number was measured or derived, and they declined to
reconstruct it from the formula on the grounds that it would be inventing the number we had already
refused to guess. Their recommendation, adopted: treat it as unattributed, not as evidence.

**The question it was blocking was never answerable as written.** 616 s is ambiguous between one
agent invocation and the aggregate. The timeout is computed per `SwarmRunner.run()`, so under
`--chunk` that is per chunk: 282,240 ms implies `ratio` 0.568, i.e. a ~1136-line chunk, and 10,039
lines at `maxDiffLines` 2000 is ~5–9 chunks × 4 agents ≈ 20–36 invocations. On the aggregate
reading, per-invocation sits well under the ceiling and there is nothing to raise. Only on the
single-invocation reading does the ceiling matter — and then it matters a lot, because
`TIMEOUT_SCALE_CAP` is 2, so the formula's absolute maximum is 360 s and no diff-size scaling can
reach 616 s. The deciding variable would be inference speed, not diff size.

**Instrument, do not argue** (PMB's suggestion): log elapsed time per `SwarmRunner.run()` call
alongside `chunkLines`; per-invocation vs aggregate then falls out of the data with no
interpretation. CPU-only is reproducible on this GPU box via `OLLAMA_NUM_GPU=0`.

**Part of the symptom is already fixed.** A timed-out agent is no longer retried against the same
exhausted budget — measured 2217 ms → 108 ms on a forced 100 ms timeout, so ~566 s → ~282 s per
failing agent at the scaled ceiling. Some of the observed ~46 min was likely that, which is a
further reason not to move the ceiling on an unsourced number.

**v1.14.0 shipped, and the session closed clean.** PRs #61–#64 merged; `main` at `10355d6` with
zero open PRs and `npm` agreeing at `1.14.0`. **791 tests**, `npm run check` green. The tag was
pushed from the release branch before #60 merged, so its provenance attests a commit not on `main`
— identical content, not worth fixing, recorded in `systemPatterns.md` so it is not repeated.

**Process note:** this is the same shape as the lesson already recorded here — a rationale inherited
without checking its source is a claim, not a finding. It sat in `activeContext.md` for days reading
as measured evidence, and the only reason it was caught is that acting on it required knowing which
of two readings was meant.

## ✅ Completed (2026-08-26)

**Evidence-location invariant shipped (#55, #58, #57).** A finding whose quoted evidence is not at
its cited `file:line` is now flagged on all four surfaces. `evidenceLocation.ts` builds a
post-image line map from hunk headers — numbering from `+start`, skipping removed lines, because an
offset-into-the-diff-body implementation passes the happy path and drifts one per deletion, the
exact shape of the defect. `synthesize()` stamps `locationCheck` last, on the published set only.

**It reports; it does not correct or drop.** Correcting was the first design and the real PR #53
diff killed it: `"version": "1.13.1",` occurs 3× across 2 files in 134 lines, so all three
self-refuting findings are ambiguous and a corrector would never have fired on the only evidence
available. Picking an occurrence would assert a location more confidently than the model did.
Dropping stays off the table as the false-negative direction.

**A spec detail reversed the annotation design mid-flight.** The first attempt omitted `line=` on a
mismatch, assuming GitHub would attach the annotation to the file. It does not: every property is
optional but `line` **defaults to 1**, so omitting it repins to line 1 — usually outside the diff,
where GitHub does not render inline. That is #45's "annotations land nowhere" by another route. The
line now stays and the message leads with the caveat (messages get clipped; a warning nobody
scrolls to is not one). SARIF keeps its region and records the tri-state in `properties`; MCP marks
the heading.

**Verified by replay, not by probe:** the real `findings.json` from run 33025650850, through
`OrchestratorAgent.synthesize()`, stamps 6/6 mismatch with 0 dropped — and the same evidence at its
true line returns `verified`, so the check discriminates rather than flagging everything. Across
the three PRs, 8 of 14 new tests fail against their pre-change code; the other 6 are guards and are
not counted as evidence.

**A third-party reviewer prompted two of these fixes without being right about either.** Across two
rounds it produced five findings: one factually wrong (it claimed the markdown formatter lacked the
marker while citing the lines containing it), one whose classification was right but whose
mechanism was wrong (`file-level annotation` vs the documented default of 1), one already fixed in
a commit it had not seen, and two accurate citations that mattered — `sarif.ts` and
`mcp/formatter.ts` had zero references to `locationCheck`. Useful as a prompt to verify; not usable
as conclusions. Both rounds reviewed stale snapshots without saying so.

**v1.13.1 published** (npm serves it, SLSA v1 provenance, OIDC needed no npm secret). `main` sat
three commits past `v1.13.0` with #50 (duplicate-collapse) and #51 (the INCOMPLETE headline)
stranded, plus #49. The handoff said to batch them with the timeout fix; overturned on two measured
facts — 2,185 downloads/month (749/week) were on a build where a truncated run renders `✅`, and the
batch partner is **slow, not blocked**: the CPU-only measurement is reproducible here via
`OLLAMA_NUM_GPU=0`, but ~46 min per trial over several trials makes it a half-day task.

**ACR emits findings whose own evidence refutes them (2026-08-26).** The `ai-review` run on the
release PR (`gh run download 33025650850`) returned 6 findings on a diff of four version strings and
a changelog entry. Five are false; three are **self-refuting** at `basis=VERIFIED, confidence=90` —
"Empty version string in package.json" cites as its evidence `"version": "1.13.1",`, and "Empty
description" cites the full description. Two more carry only the `diff --git` header as evidence and
recommend what the repo already has (`engines.node` at `package.json:24`).
`toolVersion` was `1.13.0` — CI reviews with the _published_ build, not the PR's code. Both shapes
are deterministically detectable, which is the only lever that has ever worked here (prompt wording
has failed four times): flag an emptiness/absence claim whose evidence shows the field populated,
and flag evidence that is only a `diff --git` header.

**PMB brief on 1.13.1 — triaged, one cause disproved.** On a 1769-line, 21-file `--profile security`
run, PMB reports all 4 agents ran with real quoted evidence, but **all 3 findings cited a wrong
`file:line`**, one attributing `tests/test-dangerous-commands.sh` content to
`scripts/dangerous-commands.sh`. Their proposed cause — chunking losing the per-file frame — is
**wrong**: `--chunk` is opt-in and was not passed, and 1769 < the 2000 `maxDiffLines` default, so it
was one unchunked pass. This corroborates the standing conclusion (attribution is unreliable from
the model itself) and extends it to _cross-file_. Their §3 is confirmed as behaviour:
`src/cli/index.ts:422-437` checks `hasBlocker` (exit 1) before truncation (exit 3), so a truncated
run with a blocker reports 1 and carries no coverage signal — deliberate and commented, so the
consequence is new, not a bug. **Next task, needs its own contract:** their invariant — assert the
quoted evidence occurs at the cited `file:line` before emitting. Their run fails it 3/3; the
artifact above fails it too (`package.json:2` holds `"name"`).

**Second remote branch cleanup — 10 deleted, 2 kept.** Each `#42`–`#51` branch verified by matching
its PR's merged `headRefOid` to the live tip, then deleted via `gh api -X DELETE` (as below).
Deleting a `release/*` **branch** does not disturb its **tag**. `chore/agent-calibration` (no common
ancestor with `main`) and `claude/plan-overview-4dg42o` (never-PR'd, touches a file `main` lacks, so
nothing proves containment) retained again, per the prior cleanup's intent. Merges now pass
`--delete-branch`, so this stops recurring.

**Bug D closed — same-agent repeated findings no longer reach the report** (shipped in 1.13.1).
`deduplicate()` keeps same-agent same-location findings on purpose — one agent can report two
different issues on one line — but could not tell that from one issue emitted repeatedly. Measured
on PR #44's real `findings.json`: `adversarial` emitted 5 findings at `src/core/schema.ts:196` that
were 2 concerns repeated; that run now yields 11 instead of 15, both titles intact, `high` preserved.

**Two design decisions the real artifact forced, both of which the obvious implementation gets
wrong.** Key on **title, never evidence** — all 5 findings carried byte-identical evidence across two
legitimate titles, so an evidence-keyed collapse deletes a finding class outright, a false negative
and the direction that costs something. And **keep the highest-severity member** — severity varied
_within_ a title group, so taking first-or-last silently downgrades a high to a medium as a side
effect of "removing duplicates".

**`basis` is in the collapse key, and an existing test is why.** The first implementation keyed on
title alone and broke `excludes SPECULATIVE findings below high severity` — a SPECULATIVE high and a
VERIFIED medium sharing a title collapsed into one, and since `collapseRepeats` runs _before_
`applyPublicationFilter`, the survivor decided that finding's fate. Adding `basis` is strictly more
conservative and costs no real coverage: every repeated group in the measured sample shares one
basis. The failing test was a genuine signal, not a fixture artifact.

**The deferral rationale was wrong and was corrected before implementing.** When deferring this the
stated risk was that tightening the predicate "touches the corroboration path that feeds severity
escalation." Investigation showed `corroboratingAgents`/`relatedFindings` are only ever _set_ in the
multi-agent branch, and the fix unions them rather than discarding them. Blast radius smaller than
claimed. The collapse also had to apply to **both** branches — `kept` in the multi-agent path is
`group.filter(...)`, plural, so it leaked duplicates too.

3 of 4 new tests fail against the old behaviour; the fourth (two distinct titles survive) passes
under both by design — a guard against over-suppression, not regression coverage. **757 tests.**

## ✅ Completed (2026-08-21, fourth session)

**ACR was reviewing the wrong side of its own diffs.** Investigating two false findings that
`ai-review` produced on PR #44 turned up not one bug but four, of which two were fixed (#45, and the
pre-image filter). The investigation's most useful move was `gh run download` on the CI run to get
the real `ai-review-findings` artifact — what the tool actually emitted, rather than what a fixture
author imagined. That single file exposed two bugs nobody was looking for.

**(A) Finding paths did not resolve — PR #45, merged `d781dcb`.** `filterNonexistentFiles` stripped
the echoed `a/` diff-header prefix only for its membership test and never corrected the stored
value. **5 of 15 real findings (33%)** carried an `a/` prefix; SARIF's `artifactLocation.uri` and
the GitHub annotations take `finding.file` verbatim, so GitHub could not map those results to a file
and **the annotations silently landed nowhere** while the run exited normally. The strip is
deliberately conditional — a repo may genuinely have a top-level `a/` directory, so the unstripped
form is tested first. The pre-existing test asserted the finding _survived_ but never that the path
was _correct_, which is exactly why this shipped.

**(B) Agents reported deleted code as a current defect.** Measured 8/8 on a fixture whose post-image
is clean: the `performance` agent reported the removed N+1 loop, quoting the deleted lines verbatim.
On the real PR #44 artifact it did the same for real — flagged the last-chunk-wins merge that the
diff _removes_, and recommended as the fix the function the diff _adds_. `filterUnsupportedClaims`
now drops findings whose evidence is provably quoted from deleted lines and absent from the
resulting code. Fail-open by construction: paraphrased evidence matches nothing and is kept.

**The prompt fix was measured and rejected — and the prediction going in was wrong.** The argument
for trying it: the three prior prompt failures in this project were _hallucination_, whereas this
looked like a _missing frame_ the prompt could supply. An explicit instruction measured **7/7 still
reporting the deleted defect**. Reverted rather than kept as decoration. Recorded in
`systemPatterns.md` as the fourth confirmation.

**The filter's first wiring was inert, and unit tests could not see it.** It was handed the section
from `sliceDiffByFile`, which stores `diffSectionCode(section)` — post-image by construction — so it
could never fire. The predicate was correct, so all its unit tests passed; a scratch probe also
reported success because it extracted removed lines from the raw diff instead of going through
`sliceDiffByFile`. Only replaying the real artifact through `synthesize()` showed `dropped: 0`.
Fixed with a parallel `sliceRemovedCodeByFile` (additive — changing what `sliceDiffByFile` returns
would silently alter what every existing CLAIM_RULE matches against) and pinned with an
orchestrator-level test that fails on the exact miswiring while 109 unit tests still pass.

**Two bugs found and deliberately NOT fixed**, both recorded rather than guessed at:

- `breaking-change` flagged a **function-local** const as a removed public API (verified indented,
  never exported at `8618c0f^`). A filter would have to prove a symbol was _never_ exported — a
  negative, defeated by `export { X }` lists, re-exports and default exports — and the harm
  direction is dropping a real breaking change.
- **Same-agent duplicates survive dedup**: 5 real findings that should be 2, with identical agent,
  title, file, line, and evidence. `orchestrator.ts` keeps same-agent same-location findings
  deliberately, since one agent can report two distinct issues on one line; the predicate is too
  coarse, but tightening it touches the corroboration path feeding severity escalation, so it wants
  its own PR and review.

## 📊 Metrics

### Test Coverage

- **Unit Tests**: 810 passing across 46 test files (run `npm test` for current count)
- **Integration Tests**: 1 file, 5 tests — skip without INTEGRATION=1, run with live Ollama
- **Total**: 810

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

| Version         | Date          | Changes                                                                                                                                                                                                                                                                       |
| --------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.1.0-dev       | 2026-06-04    | Tasks 1–5: scaffolding, types, config, Ollama, BaseAgent                                                                                                                                                                                                                      |
| 0.1.0-dev       | 2026-06-05    | Tasks 6–10: all 10 agents, orchestrator, SwarmRunner (19 tests)                                                                                                                                                                                                               |
| 0.1.0           | 2026-06-06    | Tasks 11–16: CLI, GitHub Actions, slash command, calibration, e2e test, final verification                                                                                                                                                                                    |
| 0.1.1           | 2026-06-06    | Guardrails G1–G6: hallucination check, diff size guard, dedup merge, timeouts, severity gate, path exclusions (37 tests)                                                                                                                                                      |
| 0.2.0           | 2026-06-06    | Phase 2: CLI consolidation, sanitizer, BreakingChangeAgent, LicenseComplianceAgent, confidence scoring, calibration CI (62 tests)                                                                                                                                             |
| 0.3.0           | 2026-06-10    | npm distribution: package renamed `ai-review-agent`, release workflow, Node.js 24, published to npm                                                                                                                                                                           |
| 0.4.0           | 2026-06-11    | prompt tuning + calibration expansion: `confidence` on all 10 agents, calibrate.ts covers all 11, new breaking-change + license fixtures                                                                                                                                      |
| 0.5.0           | 2026-06-11    | Cursor/VS Code extension: subprocess architecture, bundled install, command palette trigger, DiagnosticCollection + OutputChannel (V5-1–V5-7)                                                                                                                                 |
| 0.5.0 (cleanup) | 2026-06-12    | vscode-extension dep → `^0.4.0` (npm), tarball removed from repo, `.gitignore` stale exception removed                                                                                                                                                                        |
| 0.6.0           | 2026-06-12    | MCP server: `ai-review-mcp` binary, `review_diff` tool, stdio transport, A+C hybrid output, 10 agents (no testgen), `.cursor/mcp.json`, 77 unit tests                                                                                                                         |
| 0.7.0           | 2026-06-13    | Configurable retry logic: `withRetryTimeout` wrapper, `retryAttempts`/`retryDelayMs` config fields, `--retry-attempts`/`--retry-delay` CLI flags, 3 new retry tests (80 total)                                                                                                |
| 0.8.0           | 2026-06-15    | 5 new specialist agents: ErrorHandlingAgent, ObservabilityAgent, MigrationSafetyAgent, SecretsAgent, ComplexityAgent; shell.ts runTool(); conditional MigrationSafety skip; 32 new unit tests (112 total); 5 calibration fixtures; README + config updated                    |
| 0.9.0–0.9.4     | 2026-06-18–19 | --fail-fast, progress events, calibration tuning, --parallel flag; 120 unit tests                                                                                                                                                                                             |
| 1.0.0           | 2026-06-24    | --profile (6 presets), --context memory-bank, --format sarif/github-annotations, policy layer (agentPolicy), extended Finding schema (domain/evidence/impact/recommendation/blocking/source), 15 agent prompts updated, 16/16 calibration, 248 tests                          |
| 1.0.1           | 2026-06-24    | Audit remediation: sanitizer multi-pattern fix, BaseAgent defaults tests, GitHub adapter tests, vitest coverage fix, CHANGELOG, JSDoc, contextBudgetChars, lineEnd clamp, AGENT_PRIORITY docs; 264 tests                                                                      |
| 1.1.0           | 2026-06-25    | --no-emoji, --context-mode semantic (nomic-embed-text), --context-budget, .aiignore negation, ESLint (0 warnings), coverage parser fixed, orchestrator breaking-change escalation, vscode-extension v0.6.0 (profiles + context), migration-safety fixture expanded; 276 tests |
| 1.2.0           | 2026-06-26    | SRP: parsing.ts extraction; semantic context warning; vscode-extension timeout; OllamaProvider SSRF hardening; MCP shutdown handlers; 295 tests; all 3-round audit findings resolved                                                                                          |
| 1.3.0–1.13.0    | 2026-06–08    | Not tracked here — see `CHANGELOG.md`, which is authoritative for per-version detail. This table drifted from 1.2.0 and is kept only for the early history above.                                                                                                             |
| 1.13.1          | 2026-08-26    | Truncated runs report INCOMPLETE rather than a checkmark (#51); same-agent findings repeating one title collapse, keyed on title and keeping the highest severity (#50); `npm run test:docker` (#49). SLSA v1 provenance via OIDC.                                            |
| 1.14.0          | 2026-08-27    | Evidence-location invariant on all four surfaces — a finding whose quoted evidence is not at its cited `file:line` is flagged, never corrected or dropped (#55, #58, #57); a timed-out agent is no longer retried against the same exhausted budget (#63).                    |
