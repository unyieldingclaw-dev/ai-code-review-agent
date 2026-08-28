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

**Last Updated**: 2026-08-28

> Older completed work lives in [`archive/progress-history.md`](archive/progress-history.md).

## ✅ Corrections from PMB, verified in their checkout (2026-08-28)

Two peer sessions (PMB, and the outgoing ACR session) sent the same three corrections after
`handoff.md` was written. **All verified directly in PMB's repo rather than accepted on assertion**
— the standing rule here, and both sides have been wrong before.

- **"Awaiting the v1.2.1 tag" was the wrong frame, and it invited polling.** The release policy is
  approved but **not implemented**; it needs its own PMB contract and is the user's call to
  schedule. Confirmed: newest tag `v1.0.4`, nothing for 1.1.x or 1.2.x. Blocked on work nobody has
  started, not work in flight — a distinction that changes what a successor should do with it.
- **The ACR-provenance entry is committed but not landed** — `2052c3c` on PMB's
  `fix/block-tier-case-sensitivity`, 3 commits ahead of `main`, unmerged. Our 616 s hedge survived:
  the entry records that we decline to call the resemblance confirmed, because a resemblance cannot
  promote an unsourced number to evidence. **One wording drift flagged back to them and accepted:**
  their entry said we judge the resemblance _strong_, an adjective we never used, where our record
  says _suggestive, not established_. PMB corrected it and left the correction visible rather than
  overwriting silently — **their stated reason**, from their message: a silent fix "would have
  erased the evidence that cross-project wording drifts, which is the thing worth keeping."
  **Their fix is uncommitted** — `2052c3c` still reads "strong" (verified); they will name the
  commit when it lands. Operative hedge was intact throughout; only the adjective was wrong.
- **`mb upgrade` synchronises less than it prints** — read in `scripts/mb.sh`. `ADVISORY_CREATE`
  (all 15 `standards/*.md`) is copied only when absent. Mechanics and the specific file pair this
  will desynchronise on our next upgrade: `techContext.md`.

## ✅ Follow-up: the four "known, not fixed" items (2026-08-28)

Two turned out to be **PMB's, and neither can reach us** — reported upstream as one defect, which
PMB confirmed in their own tree and extended:

- Their `templates/memory-bank/README.md` handoff-threshold fix (80% → 40%, in `2052c3c`) is in
  **neither** ownership array. `memory-bank/*` is init-only, so it reaches new projects only —
  silently, with no diff notice. Our copy will read 80% against a `CLAUDE.md` reading 40%
  indefinitely.
- Their `standards/MEMORY-BANK.md` `=50` fix is real and correct upstream, and `ADVISORY_CREATE`
  means it can never arrive either. We fixed our copy independently the same day; **two correct
  fixes that cannot meet.**

**Root cause, agreed with PMB:** ownership class answers "may the adopter customize this file" and
is being asked to also answer "how does a correction reach them". Those are orthogonal, and
collapsing them is why the `=50` drift survived however many upgrades. PMB added a fourth case we
had missed (`templates/AGENTS.md`, no distribution path at all) and confirmed the
`memory-bank-size.yml` collision guard is **filename-based**, so its stated intent — "a project with
its own CI keeps it" — does not hold for us, whose gate is `ci.yml`. Delivery table in
`techContext.md`. Not ours to fix; surfaced to the operator with our reasoning attached.

**One finding retracted on evidence.** We had filed `standards/MEMORY-BANK.md` pointing at
`docs/archive/` as staleness. It is correct upstream — PMB uses `docs/archive/` consistently and has
no `memory-bank/archive/`. **We** are the divergence. Retracted to PMB directly.

**The two genuinely ours are fixed.** `techContext.md` claimed the remote branch was `master` (it is
`main`) inside a "Current State (as of 2026-06-06)" block whose every line had rotted — 19 tests
against 826, 20 commits against 456. Fixed the way the threshold was: **the section no longer
restates state**, it points at `npm test`, `git`, and `progress.md`. A stale per-file test table and
a hardcoded test count in the scripts block went the same way.

**And the cap pressure is structurally resolved, not trimmed.** Moving the upgrade _procedure_ next
to the upgrade _mechanics_ in `techContext.md`, and the `BaseAgent` parse-stage mechanics and agent
thinking config out of `systemPatterns.md`, took `activeContext.md` from 149/150 to 122 and
`systemPatterns.md` from 299/300 to 276. Both now have real headroom. Neither is inside the target
range in `README.md`, and closing that gap further would mean removing live operational rules — a
judgment call left open rather than made quietly.

## ✅ Session closed (2026-08-28)

**Twelve PRs merged (#65–#76), `main` at `c284d57`, nothing half-done.** `npm run check` green, 826
tests across 47 files, `npm audit` clean, no open PRs, no stashes. Eight of the twelve were the
v1.15.0 release and docs audit (#65–#72); the remaining four were memory-bank corrections (#73–#76),
recorded below. `handoff.md` was merged into the memory bank and deleted on 2026-08-28.

**Merging it required archiving first, and the first attempt at that went wrong.**
`activeContext.md` was at 149/150 and `systemPatterns.md` at 299/300, so material had to move before
anything new could land. The first pass **compressed instead of moving**, and a five-lens review
caught it deleting substance outright: `pre-push-check.*` as the second PMB-defect example, `#69`'s
`run.cmd`-is-interactive and not-a-required-check clauses, the `INCOMPLETE` glyph rationale, and the
middle `elapsedMs` round — the one that carries the rule's whole point. All restored, to `archive/`
where historical and to the live file where still operative.

**The structural fix was moving the standing capability inventory out of `activeContext.md`** into
`techContext.md`, which is where an inventory of what exists belongs; that file's frontmatter scopes
it to focus, blockers and next steps. That moved 22 lines out of `activeContext.md`; archiving the
2026-08-26 section moved 104 out of `progress.md`. Deltas, not levels — the levels decay, and this
file's own rule says so. **Cap pressure was the cause
of the deletions, not an unrelated inconvenience** — compressing to fit is how substance gets lost,
which is why the rule in `memory-bank/README.md` says archive rather than trim.

## ✅ Completed (2026-08-27, third session)

**The PMB 1.2.1 upgrade was never going to resolve, and the next-step said otherwise.** Verified
directly in PMB's checkout rather than inherited: `mb upgrade` resolves
`TEMPLATES_DIR="$REPO_ROOT/templates"` from the local working directory and `mb.sh` contains **zero**
`git fetch|checkout|archive|clone|describe|tag` calls in 2,939 lines — so it distributes a snapshot
of whatever is on disk, never a release. Their tree is currently dirty on a feature branch with five
`templates/` files modified, which is exactly the source directory.

**There is also no release to wait for.** `VERSION` reads `1.2.1` but nothing is tagged past
`v1.0.4` — the version names no tag, commit or artifact. "Blocked on upstream release" and "upstream
has no release mechanism" are different states; only the second tells a successor to stop waiting.

**Resolved 2026-08-28 — PMB will cut releases, and tagging alone unblocks us.** _[Superseded later
the same day: the policy is approved but unimplemented and unscheduled. See "Corrections from PMB"
at the top. Everything below describes the decision, not its delivery.]_ The operator
decided all three open questions. Releases: **yes**, and the decisive argument was `TEMPLATE_OWNED`
— PMB forbids adopters from patching those files locally, so "you may not fix this yourself" and
"you get whatever was on my desk" cannot both hold. Working-tree sourcing: **not deliberate, just
unfinished** (zero git-ref calls and no `# WHY` comment on a load-bearing distribution choice, in a
repo carrying 180 of them); it becomes a dev-mode flag rather than the default. Dirty-tree guard:
**refuse, with `--allow-dirty`** — warn-only was rejected as another advisory layer.

**For us the tag is the actionable event, not the merge.** _[Superseded 2026-08-28: true of which
event to act on, misleading about timing — no tag exists and none is scheduled, so this must not be
read as "wait for it."]_ Once `v1.2.1` exists, PMB is checked out at the tag and `mb upgrade` runs
here — **two repos, and the `cd` paths matter**; exact commands in `activeContext.md`. The guard and
ref-sourcing are
hardening for the general case, not prerequisites for us — so our unblock costs one `git tag`
upstream and zero code either side. Sequencing PMB approved: tag first, guard second, ref-sourcing
third; "releases eventually, guard now" was rejected once the release half turned out to be the
cheap half.

**Still holding both signals:** the ACR provenance entry is still uncommitted, and nothing has
reached `main`. PMB will signal the tag separately from the merge, since the tag is what we act on.
**Superseded 2026-08-28 —** the entry is now committed (unmerged), and "wait for the tag" was the
wrong frame: the release work is unscheduled. See the corrections section at the top of this file.

**Corrected 2026-08-28, PMB caught it:** we also claimed `VERSION` and `.pmb-version` contradicted
each other. They do not — `VERSION` is PMB's own version, `.pmb-version` records which version a
consuming project was last upgraded with (verified in `mb.sh`). Two true statements. The finding
above is untouched. PMB's follow-on, which is real: their own `.pmb-version` is `1.1.1` while they
publish `1.2.1`, so PMB has not run `mb upgrade` on itself in two versions — same drift class, with
PMB downstream of itself.

Reported upstream. **A fix we proposed was withdrawn on evidence:** `git archive <tag>` is useless
when no tag exists, so the real ask is _cut releases first_. PMB confirmed independently and asked
us not to upgrade until they signal work reached `main` — only that signal is actionable.
_[Superseded 2026-08-28: there are **two** signals, "reached `main`" and "tag exists", and PMB sends
them separately. Neither has arrived.]_

**Consequence meanwhile:** `last-reviewed` stays unstamped, so `mb doctor`'s staleness check reports
actively-edited files as months stale. Not fixable locally (`TEMPLATE_OWNED`).

**One inbound claim held pending, not logged as done:** PMB earlier said the ACR provenance gap was
closed in their record. They corrected it — the entry is written, with our hedge preserved verbatim
(611.7 s as a retry artifact; the 616 s resemblance recorded as _not confirmed_), but uncommitted in
the dirty tree above. Do not treat it as landed until they confirm. **Superseded 2026-08-28:** now
committed as `2052c3c`, still unmerged — see the corrections section at the top.

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

> Completed work through 2026-08-26 is in [`archive/progress-history.md`](archive/progress-history.md).

## 📊 Metrics

### Test Coverage

- **Unit Tests**: 826 passing across 47 test files, verified 2026-08-28 (run `npm test` for current
  count)
- **Integration Tests**: 1 file, 5 tests — skip without INTEGRATION=1, run with live Ollama
- **Total**: 826

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
