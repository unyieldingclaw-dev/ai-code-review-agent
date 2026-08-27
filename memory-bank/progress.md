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

**Last Updated**: 2026-08-26

> Older completed work lives in [`archive/progress-history.md`](archive/progress-history.md).

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

## ✅ Completed (2026-08-21, third session)

**Both open risks from PR #43 closed, plus the conventions promoted to `systemPatterns.md`.**

**MCP output ignored `toolAvailability` entirely.** `formatMcpOutput` read only `agentStatus` and
`truncation`, so a partial gitleaks scan, a not-installed tool, and a fully clean tool run were
identical to the calling LLM — the reader least able to notice, having no terminal output to fall
back on. This was the same defect class MCP had already been fixed for once (agent failure and
truncation, in the 15-phase audit remediation); tool availability was simply never added.

**The fix deliberately does NOT reuse the existing `warnings` array**, and that is the design
decision worth keeping. `warnings` gates the headline (`"No findings, but the review was
incomplete"`). A failed agent or truncated diff earns that headline; a missing optional tool does
not — the agent ran in a documented degraded mode and returned a real result. Folding them together
would have marked every clean run "incomplete" for anyone who simply has not installed lizard,
training the caller to ignore the warning that actually matters. `cli/formatter.ts` already drew
that line; MCP now matches it. Tool notes render in the body without touching the headline.

**`chunkRunner` merged `toolAvailability` last-chunk-wins**, so a `'partial'` first chunk followed
by a clean second chunk reported a COMPLETED scan — re-creating at the chunk layer the exact false
claim `'partial'` had just removed at the agent layer. Now merged: any disagreement between chunks
collapses to `'partial'`, and `'not-applicable'` is neutral (ignored unless it is the only value, so
a chunk with no manifest changes cannot degrade a verdict npm audit legitimately earned elsewhere).

An earlier draft of that rule carried an `else 'unavailable-llm-fallback'` branch for mixed sets.
**No input can reach it** — a mixed set is ≥2 distinct values from
`{used, partial, unavailable-llm-fallback}`, and every such pair contains `used` or `partial`. Found
by re-reading the design before implementing, not by testing. `policy`/`filteredFiles`/`context`
stay last-chunk-wins on purpose: none of them asserts anything about coverage.

**`TOOL_LABELS` moved to `schema.ts`** next to `ToolAvailabilityMetadata`. `cli/formatter.ts`'s own
comment already warned that two hand-typed copies of the tool-key list can silently drift; adding
MCP as a third consumer with its own copy would have repeated exactly that mistake. Keying off
`keyof ToolAvailabilityMetadata` makes a new tool integration a compile error until every renderer
accounts for it.

**Falsification found a weak test.** Of six new chunk-merge tests, only two failed against
last-chunk-wins. The `'not-applicable'` neutrality test had the substantive value in the _last_
chunk, where last-chunk-wins gives the same answer — so it was a guard test, not a regression test.
Reordering it made it falsify (`expected 'not-applicable' to be 'used'`), bringing the count to
three. The five MCP tests all failed correctly. **741 tests** · typecheck/build/format/lint green.

**Conventions promoted to `systemPatterns.md`** from `activeContext.md` (volatile, and the wrong
home for stable rules): the `PreToolUse` marker-timing rule, the fact that the commit and push
markers are distinct and the push marker must be recomputed _after_ committing, and a new section on
verifying a regression test fails — including the ordering trap above and the point that the failure
_message_ matters as much as the failure.

## ✅ Completed (2026-08-21, later session)

**Both items PR #42 deferred are closed** (PR #42 merged as `a56d007` first).

**`'partial'` added to `ToolAvailability`.** PR #42 routed a partial gitleaks scan to the LLM but
labelled it `'unavailable-llm-fallback'`, which asserts the tool never ran — false, and it points a
reader at installing a tool they already have instead of asking why files were skipped. A small
honesty bug introduced while fixing a larger one. `SecretsAgent` now reports `'partial'` when
gitleaks covered some files and the LLM covered the rest.

The deferral rationale recorded in PR #42 — that `'partial'` "would ripple into the markdown/SARIF/
MCP consumers" — **was wrong, and was checked rather than inherited.** `formatter.ts` is the only
site that branches on the value; `sarif.ts:109` and `chunkRunner.ts:150` pass the object through
opaquely, `src/mcp/` never read it _at all_ (fixed in the session above — that silence was itself a
defect, just not a compile-breaking one), `runner.ts`'s `recordToolAvailability` is value-agnostic, and
no exhaustive `switch` exists (confirmed by a clean `typecheck` after widening the union). The
ripple was one `filter` plus one new note. The stale comments asserting otherwise are removed —
they would otherwise keep deferring the same work. `ComplexityAgent` deliberately gets no
`'partial'` handling: `complexity.ts:58` passes all files to lizard in one invocation, so there is
no per-file skip to report.

The formatter renders `'partial'` as its own note rather than folding it into the degraded list,
because the degraded message says the tool is not installed and tells the reader to install it —
precisely the wrong advice here.

**`license-clean` decoupled from ACR's own lockfile.** It passed only because `commander` happens
to be a real dependency of this repo, so it asserted against this repo's incidental dependency set
rather than the mechanism; dropping the dependency would have silently reverted it to the
model-recall configuration that measured 6/10 FAILING. Now runs against
`license-clean-lockfile.json` via `projectPathFixture`. This was the last of the two calibration
cases coupled to this repo's own state; `dependencies` was closed in PR #42.

**The fixture needed its own unit test, and the reason is worth keeping.** An opponent audit found
`licenseCompliance.ts:35` short-circuits before reading the lockfile whenever the LLM returns zero
findings — so the fixture is exercised only on runs where the model misfires, and `calibrate.yml` is
weekly, not a PR gate. Nothing deterministic pinned it. Dropping the fixture's `license` field would
have silently reverted `license-clean` to model recall (6/10 FAILING) and surfaced only as
calibration flakiness — the exact misattribution this line of work exists to prevent. Closed with a
`licenseFacts.test.ts` case, confirmed to fail (`expected null to be 'MIT'`) when the field is
removed.

Every assertion added here was confirmed to FAIL against the pre-change code before being trusted —
the partial-scan one with `expected 'unavailable-llm-fallback' to be 'partial'`, exactly one test,
no collateral. 728 tests · typecheck/build/format/lint green.

**Review notes.** A history-lens reviewer called the reversal of PR #42's decision a regression and
claimed the ripple "manifested exactly as predicted"; that was checked and is false — zero SARIF and
zero MCP files changed, 1 of 3 named consumers. Its valid half was that the code carried no rebuttal
to the one-commit-old decision, now fixed in `secrets.ts`. A bug-lens reviewer claimed the early
return leaves `lastToolAvailability` unassigned; false — the branch assigns `'used'` itself, and an
existing test covers that exact state. ACR's own security profile returned 3 findings, all triaged
as false positives or pre-existing (its "XSS" flag is on a string built from a hardcoded label map).

## ✅ Completed (2026-08-21)

**Calibration made falsifiable.** The 21–22/22 score aggregated assertions of very different
strength — three asserted on the agent's own domain vocabulary (`complexity` → `'complexity'`,
`observability` → `'logging'`, `integration` → `'integration'`), proving the agent ran, not that it
found anything. Strengthened where measured: `calculateShippingCost` 5/5, `notifyWebhook` 4/4.
`observability` reverted (`cancelOrder` 4/6 — flaky enough to read as model variance); numbers kept
in-file so it is not retried blind. Failing cases now print what the agent actually returned.

**`DependenciesAgent` had no case that could fail** — both were `expectEmpty`, so an agent returning
`[]` passed. Proven by patching it to `return []`: both still passed. Added
`dependencies-vulnerable`, which fails in that scenario, running against its own materialised
project via the new per-case `projectPathFixture` rather than this repo's incidental state. Its
lockfile is committed as `vulnerable-lockfile.json`, since Dependabot alerts key on the
`package-lock.json` filename and would otherwise raise standing alerts on a repo holding
`npm audit` 0.

**A failed `npm audit` reported a clean scan** (PR #41). Offline, `npm audit --json` writes a JSON
error object to stdout and exits non-zero; `runTool` ignores exit codes by design, so the agent
marked it `'used'` and the parser mapped the shape to `[]` — a clean report from an audit that never
ran, LLM fallback skipped because output was non-null. Offline is this tool's primary use case. It
was already half-identified in a parser comment whose response had been a stderr log — fixing the
trace, not the claim.

**`SecretsAgent` partial scans** no longer report as complete: gitleaks runs per file, and success
on some plus no output on others still claimed a finished scan. Now falls through to the LLM so
skipped files are examined. Deferred adding a `'partial'` `ToolAvailability` value on the belief it
would ripple into the markdown/SARIF/MCP consumers — **that belief was checked later the same day
and was wrong** (one call site, not three subsystems); see the section above.

**All three `runTool` callers enumerated**, not sampled: `dependencies` and `secrets` fixed;
`complexity` safe (lizard output is LLM context, never parsed into findings). **`review.yml`
bounded:** `timeout-minutes: 45` (tool worst case ~90 min; observed 4–8.5) plus `paths-ignore` for
docs-only PRs — backstops; root cause is an unsupervised runner, environment-side. Left open at the
time: `license-clean` resolving `commander` from this repo's lockfile — **closed later the same day,
see the section above.**

## ✅ Completed (2026-08-20)

**Dependabot PR #14 merged** — `gitleaks-action` v2 → v3 (`e0c47f4`), a Node 20 → Node 24 runtime
migration. Not routine: the pinned v2 already emitted a Node 20 deprecation warning on every release
run, and Node 20 leaves GitHub-hosted runners 2026-09-16 — the secret-scan step is not
`continue-on-error`, so it would have hard-failed the release pipeline. PR #37 corrected the stale
`# Pinned to v2 tag SHA` comment left above the new SHA; in a supply-chain pin that comment is the
only human-readable check that the opaque SHA is what it claims to be.

**Review-gate tooling investigation.** Dogfooding surfaced twelve defects in the PMB-owned hook
scripts, all failing toward green. Delivered to the PMB session as verbiage; none fixable here
(`TEMPLATE_OWNED`, overwritten by `mb upgrade`). Conventions and the ownership rule recorded in
`systemPatterns.md`. `mb upgrade` reads PMB's working tree rather than a tag, which is why the 1.2.1
upgrade is on hold.

## 📊 Metrics

### Test Coverage

- **Unit Tests**: 741 passing across 45 test files (run `npm test` for current count)
- **Integration Tests**: 1 file, 5 tests — skip without INTEGRATION=1, run with live Ollama
- **Total**: 741

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
