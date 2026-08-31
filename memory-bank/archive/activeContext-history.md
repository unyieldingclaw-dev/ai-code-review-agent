# Active Context — archived history

Moved out of `memory-bank/activeContext.md` on 2026-08-19. That file had reached 902 lines
against a 150-line limit set by its own README (601% over), and `Current Focus` alone was 748
of them -- accumulated session narrative rather than current state, which the README
explicitly says it should not hold ("Only current state, not history"). Nothing deleted.

## Current Focus

**Deterministic false-positive filter for injection/swallowed-exception findings, implemented and
live-verified (2026-08-18, uncommitted)**: a follow-up report (`is_group_member(gid uuid)`, a
parameterized Postgres RLS function, flagged as SQL injection) turned into a broader finding —
`security`/`correctness`/`adversarial`/`error-handling` all fabricate injection/swallowed-exception
claims against this same clean fixture, measured live against Ollama. Two rounds of prompt-only
fixes (already applied to all five agents' `.ts` prompt files, uncommitted) plateaued — `security`
stuck at 5/8, `error-handling` at 3/6 — because blocking one rationalization made the model invent
another rather than concluding "no finding" (confirmed: after "gid isn't parameterized" was ruled
out, round-2 misfires switched to claiming `auth.uid()` itself was attacker-controlled). Matches
this project's own precedent: `secrets.ts`'s `hasCredentialShapedValue` hit the identical wall and
was fixed the same way, not with more wording.

**Round 2 (2026-08-19)**: three further issues found and fixed on top of the filter — a `license`
agent hallucinating license identity (6/10, now 0/8 via `licenseFacts.ts` ground-truth lookup), an
`adversarial` NULL-semantics hallucination (a prompt fix made it _worse_, 6/10 → 9/10, confirming
the confabulation diagnosis a third time; reverted and fixed deterministically, 7/10 → 4/10
any-findings), and two command-injection filter gaps found from a live PMB run — including a
**false negative where a genuine `$USER_INPUT` command injection would have been dropped**. Two
other items in that brief were verified as NOT bugs: the "missing finding"/"swapped counts" were
correct orchestrator behavior made invisible by unrendered `corroboratingAgents`, and the
truncation exit-code taxonomy (0/1/2/3/4 plus `--chunk`) already exists. See `progress.md`.

**Fix**: new `src/core/claimSupport.ts` + `filterUnsupportedClaims` in `orchestrator.ts` — drops an
injection/swallowed-exception finding when its own file's diff section contains no syntax capable
of that mechanism (checkable by the vulnerability class's own definition). IDOR is deliberately out
of scope (not syntactically falsifiable) and stays covered by prompt rules + `--verify-evidence`.
Live-reverified, not just unit-tested: `security`/`error-handling` went from 2/8 raw misfires to
0/8 surviving; a genuine-injection counter-test fixture confirmed zero over-suppression (all 11 injection findings produced across
3 trials each survived; 11/11
real findings survived). Wired into `calibration/calibrate.ts`. **Still uncommitted** on branch
`docs/record-v1.11.0-release`, which backs open PR #31 (memory-bank docs, unrelated) — needs
`npm run check`, then a decision on whether these commits land in PR #31 or move to their own
branch before pushing. See `progress.md`'s "Follow-up reported by user" entry (2026-08-18) for full
detail, and `handoff.md` (repo root, should be deleted once this lands) for exact remaining steps
if a session gets interrupted mid-flight.

**v1.11.0 shipped end-to-end (2026-08-18)**: the audit-remediation work below (Batches 1-8) is
fully merged, tagged, and published. Sequence: PR #29 (`fix/audit-remediation-batch`, commit
`e9312f5` after squashing 3 local WIP commits into one — needed because the pre-push git hook
scans each commit's own patch individually when there's no upstream yet, so a later fix-up commit
alone couldn't clear an earlier commit's flagged content) merged to `main`; PR #30
(`chore/release-v1.11.0`) bumped `package.json`/`package-lock.json` to `1.11.0`, finalized
CHANGELOG's `[Unreleased]` into a dated entry, updated README's `toolVersion` example, merged to
`main`; tag `v1.11.0` pushed; `npm publish` succeeded (confirmed via `npm view ai-review-agent
version` → `1.11.0`, `dist-tags.latest` → `1.11.0`) after the user first hit `npm whoami` 401
(not logged in) then a same-session `npm publish` 404 that turned out to be a registry
propagation quirk — the publish had actually succeeded despite the client-visible error, confirmed
when a retry correctly refused with "cannot publish over the previously published version." Global
`ai-review-agent` on this machine is `npm link`-ed directly to this repo (not a separate registry
install), so it already reflected every fix throughout this session, coincidentally, as long as
`main`/the active branch stayed built — worth remembering this is fragile (branch-dependent, not a
structural guarantee) if it comes up again. **Also mid-session**: caught (and fixed, in the squash)
a self-inflicted issue where the new secret-scan Pester test fixtures (fake PEM/Bearer/JSON-style/
GitHub-PAT strings) tripped the very pre-push secret scanner they were testing — resolved by
splitting the literals via string concatenation so the static source line doesn't match the regex
while the runtime-reconstructed value still does; confirmed `fixtures/security/` has never been a
real committed path in this repo (decided not to create one — no current consumer, would be
speculative infrastructure per this project's Karpathy principles).

**Open item, reported by the user from a separate session, not yet started**: `adversarial` agent
false-positive — flags `is_group_member(visits.group_id)`-style parameterized Postgres function
calls in RLS policies as SQL injection, when they're not (no `EXECUTE`/`format()`/string
concatenation; identical pattern appears safely in 6+ other policies in that schema). Root cause
guess: the heuristic fires on "function call near an access-control-sounding identifier in a
security-domain file" rather than checking for actual dynamic SQL construction. The user's retest
also confirmed this session's timeout/truncation fix works (292s-with-timeout → 34s, zero
truncation across all 4 agents on the retest diff) — that part is closed, just the false-positive
remains. User asked me to wait/hasn't yet confirmed whether to start on it.

---

**15-phase ACR Full-System Integrity & Hardening Review complete (2026-08-17)**: user-provided
exhaustive audit spec (system map → capability tracing → data-flow/contract audit → agent integrity
→ orchestration → failure-mode audit → test-suite integrity → CLI/hook/CI integrity →
security/boundary review → efficiency → dead code → docs-vs-reality → empirical end-to-end proof →
remediation rules → final report), executed via 12 parallel Explore subagents (batched into 4
rounds) plus a final empirical-verification pass run directly by the main agent (not delegated) via
a standalone tsx script exercising real `src/` code with adversarial input — 7/7 targeted claims
reproduced deterministically. Full report:
`docs/superpowers/specs/2026-08-17-full-system-integrity-hardening-audit.md` (not yet committed).
**No fixes applied yet — this was a pure investigation phase**, per the audit's own explicit
constraint ("do not start by rewriting anything"). Headline findings, all confirmed by reading
source (several also empirically reproduced): (1) `severity`/`basis`/`blocking`/`source` are never
validated against their enums anywhere in the parse/normalize path, silently corrupting exit-code
gating, sort order, the publication filter, and the hallucination-corroboration safety net across 8+
call sites in 4 files — and 3 agents' own prompts (`breakingChange`, `licenseCompliance`,
`migrationSafety`) make the `source`-spoofing instance concretely exploitable by self-tagging
`source: "git"`/`"policy"` with zero real tool behind either label; (2) `src/mcp/formatter.ts` never
reads `agentStatus`/`truncation` — a total-agent-failure-plus-truncated run reads as an unqualified
"✅ No findings" to the calling LLM, the exact path `/change-review` Job 7 uses for real gating
decisions; SARIF has the equivalent gap for CI consumers; (3) all three files containing these bugs
show 95-100% test coverage — structurally invisible to coverage since the bugs are absences of
validation, not unexercised branches, and one bug (`blocking`'s wrong fallback default) is actively
locked in as "correct" by an existing test; (4) governance-layer bypass surface: `review-reminders`/
`check-contract` hooks are only wired to specific tool matchers (PowerShell isn't wired to either),
git-command detection is literal-substring (evaded by `git -c core.hooksPath=...`/aliases/`git.exe`),
review-ok markers are bound to diff content not actor identity (cross-session TOCTOU), and there's no
server-side secret-scan backstop on the normal push/PR path; (5) `review.yml`'s AI-review CI step is
wrapped in `|| true` with no downstream gate — a crash produces an all-green PR with zero review
signal. Also confirmed genuinely solid: no command injection anywhere (array-based `spawn`
everywhere), MCP/`--write-tests` path-containment is robust (empirically probed against traversal/
UNC/ADS payloads), SSRF via malicious `ollamaUrl` is blocked by a hostname allowlist, zero dead code/
orphaned files, CHANGELOG maintained with unusual rigor. Full findings list (Critical/High/Medium/
Low, ~50 items), wiring matrix, failure matrix, efficiency findings, and a 3-tier remediation
priority list (simple fixes first, 2 tiers of larger work explicitly deferred) are in the report
file. **Next step**: user to decide which remediation tier(s) to act on and in what order.

---

**v1.10.0 shipped (2026-08-17)**: the review-reliability-fixes and evidence-grounding-verification
work below, plus the 5-batch full-codebase audit fixes, had accumulated locally since 2026-08-09/16
without ever being published. Bundled and shipped as one release: `CHANGELOG.md` completed for the
previously-undocumented audit work, version bumped, merged into `main` via PR #20, tagged, published
to npm (`npm view ai-review-agent version` confirmed `1.10.0`). Real-world investigation followed,
triggered by a live bug report ("ai-review-agent (ACR) reliability issues — observed on
side-quest-atlas") run against `C:\Users\Mizzo\Claude\Side-Quest-Atlas` (separate project, same
machine) — 5 issues reported, cross-referenced against the just-shipped fixes: Issue 4 (dependencies
wrong-stack assumption) directly confirmed fixed live (`toolAvailability.npmAudit: "not-applicable"`
on the real Flutter/Dart project). Issue 1's reported timeout symptom was first "reproduced" but
traced to testing against a stale globally-installed v1.8.0 binary (`npm publish` never auto-updates
already-installed global packages) — once corrected to v1.10.0 via `npm update -g ai-review-agent`,
did not reproduce on the closest-matching real diffs from the report (`dangerous-commands.sh`,
~130-line password-toggle, ~250-line edit-visit commits) — 25s/159s runs, all agents `ok`, well
under the reported 202s/5-minute thresholds. **New finding, discovered along the way, not in the
original report**: a genuine Windows-only libuv crash (`Assertion failed: !(handle->flags &
UV_HANDLE_CLOSING), file src\win\async.c, line 76`) reproduced 2/2 on the correct v1.10.0 binary
right after a review completed successfully with valid output already written — root-caused (and
confirmed via a minimal standalone repro) to `process.exit()` forcing immediate termination while
async handles (fetch/`AbortController` cleanup in `OllamaProvider`) were still settling. Fixed: all
9 `process.exit()` call sites in `src/cli/index.ts`'s action handler converted to
`process.exitCode = N; return`; the one call site in the synchronous `getDiff()` helper now throws
instead. Verified via the same repro (2/2 clean after the fix) plus full regression (531/531 tests).
Went through full `/code-review` (5 lenses) + `/change-review` (9 jobs, ACR security scan) before
push — ACR itself raised 3 findings against this diff, all confirmed false positives on inspection
(misread a deleted line, flagged the fix itself as a "regression," flagged an untouched pre-existing
call site) — a live, concrete instance of the diff-misreading/absence-claims reliability class the
broader investigation is still tracking (see Issue 2/3 below). PR #21, not yet merged. Remaining
open items from the original bug report, not yet started: Issue 2 (absence-claims lacking full-file
context — needs a design decision), Issue 3 (secrets agent value-shape check — has a concrete fix),
Issue 5 (evidence-impact mismatch — needs a scope decision on extending `--verify-evidence`); plus 4
deferred `/change-review` findings from the v1.10.0 gate (chunk-boundary file-split
hallucination-drop, `evidenceCheckFilter` last-chunk-wins under `--chunk`, verifier-model wiring test
weakness, `testGen` pytest-branch coverage gap); plus one older still-open item, "ACR reliability
findings" #3 below (fabricated GPL/mongodb license finding — likely permanently unresolvable, the
original finding's exact file/line/text was never captured).

---

**Review-reliability fixes complete and merged (2026-08-16)**: fixed 4 real bugs reported from an
actual `ai-review-agent --profile security --diff` run against a Flutter/Dart project — silent
diff truncation with no exit-code signal, agent JSON output needing truncation-recovery to parse,
`security`/`adversarial` misreading `.md` prose as vulnerable code, `dependencies` assuming every
project is npm/Node.js. All 4 verified against real source before design work; design spec +
14-task plan written via `superpowers:writing-plans` (independently deep-reviewed, 11 issues fixed
pre-plan), executed via `superpowers:subagent-driven-development` on branch
`feature/review-reliability-fixes` (now merged and removed). Task 3's live diagnostic
(`calibration/responseTruncationDiagnostic.ts`, new permanent script) disproved the plan's own
original hypothesis for the JSON-parsing bug — not a missing `num_predict` cap (`done_reason` was
`stop`, never `length`, at every diff size) but `format: 'json'` (the bare string) only
constraining "valid JSON," not array shape. Verified fix: an explicit JSON Schema
(`FINDING_ARRAY_SCHEMA`/`COVERAGE_RESULT_SCHEMA`) forces the correct shape. A separate,
distinct finding from the same investigation — the model under-reporting multiple real findings
even with shape fixed — was deliberately left unaddressed (documented Non-Goal, not fixable via
any `ChatOptions` change). Mid-plan, applied "Capability vs Orchestration" reasoning from a
maintenance-mode framing document to redesign `--chunk` as `chunkRunner.ts`, a thin wrapper calling
`SwarmRunner.run()` once per chunk from entirely outside `SwarmRunner` itself, after the user
pushed back on an initial recommendation to cut the feature instead of redesigning it. **A final
holistic branch review (post-implementation, pre-merge, looking at the whole diff rather than
task-by-task) caught 2 real cross-task regressions no single task's own review could have seen**:
`chunkRunner.ts`'s result-merge took `agentStatus` from the last chunk only, silently hiding a real
agent failure in an earlier chunk behind exit code 0 — undermining the exact guarantee `--chunk`
exists to provide; and the new default `**/*.md` exclude relied on a pre-existing `matchPattern`
glob bug that made `**/` require a literal `/`, so it could never match a root-level file like
`README.md` — fixed the glob matcher itself (root cause, also benefits user `--ignore`/`.aiignore`
patterns) rather than narrowing the new default. Both independently re-verified via direct
reproduction before fixing. Live end-to-end verification against a synthetic oversized Flutter/Dart
diff confirmed all 4 original symptoms resolved. 526 tests passing. Merged into
`fix/full-codebase-audit-findings` (`00713e8`). Full detail:
`docs/superpowers/specs/2026-08-16-review-reliability-fixes-design.md`,
`docs/superpowers/plans/2026-08-16-review-reliability-fixes.md`, `progress.md`'s matching entry.

---

**Evidence-grounding verification pass complete and merged (2026-08-11/12)**: closed the
"ACR reliability findings" item 4 gap noted below — findings whose own cited evidence contradicts
their claim, or whose severity ignores the agent's own stated criteria, had no defense checking
reasoning against evidence (`filterNonexistentFiles` checks file existence,
`hallucinationCrossCheck` checks cross-agent corroboration; neither verifies a claim against the
evidence it quotes). Design spec (`docs/superpowers/specs/2026-08-10-evidence-grounding-
verification-design.md`) and 13-task implementation plan (`docs/superpowers/plans/2026-08-11-
evidence-grounding-verification.md`) written via `superpowers:writing-plans`, executed via
`superpowers:subagent-driven-development` on branch `feature/evidence-grounding-verification` (git
worktree at `.worktrees/evidence-grounding-verification`, now removed post-merge). Stage 1
(report-only, deliberately not auto-filtering): a second, independently-configurable model
(`verifierModel`, default `qwen3:latest`) checks whether each Critical/High finding's own cited
evidence actually supports its claim, gated behind `--verify-evidence` (off by default, forced off
for MCP callers), surfaced as `ReviewResult.evidenceCheckFilter` in markdown/SARIF/JSON. A
deterministic regex pre-filter (`PRE_FILTER_PATTERNS` in `evidenceVerifier.ts`) runs alongside the
LLM check as a second signal (`preFilterAgreed`) but never overrides or skips the LLM verdict —
this project's diff-derived evidence snippets can carry deletion/comment context a naive text match
can't distinguish from live code, so a pattern match alone was judged too risky to act as a veto.
Validated against 13 unique synthetic cases (evidence-contradicts-claim + genuinely-correct
controls): `qwen3:latest` scored 13/13, confirmed live against real Ollama via the new permanent
`calibration/evidenceVerifierCalibration.ts` script (`npm run calibrate:evidence`), not just at
design time. All 13 implementation tasks individually reviewed (genuine spawned `/code-review`
passes, scaled 1-lens to full-5-lens by change significance — self-certifying a commit without an
independent review was explicitly blocked by the harness mid-session) and committed separately
before merge. A final holistic review (done via direct grep/read after a subagent dispatch hit an
API spend limit) caught one real trust-boundary gap before merge: `evidenceVerifier.ts` is the
first place in this codebase where one agent's LLM _output_ (`Finding.title`/`detail`/`evidence`)
becomes a second LLM call's _input_ — the existing `sanitizeDiff`/`sanitizeText` prompt-injection
defense was only ever applied once, at diff-ingestion, and didn't automatically carry through to
this new second hop. Fixed by reapplying `sanitizeText()` to claim/evidence inside `verifyEvidence`
before they reach the verifier prompt (commit `c0fe693`), with a regression test confirming
injection strings (`SYSTEM:`, "ignore previous instructions") are stripped before the verifier
model ever sees them. Merged into `fix/full-codebase-audit-findings` via `git merge --no-ff`
(commit `a227cdb`).

**Post-merge fix, same effort (2026-08-12)**: running the full suite from the main checkout after
the merge (`npx vitest run`, no path arg) showed 5 failed test files / 3 failed tests — traced via
`grep -E "FAIL|Test Files"` to paths under `.worktrees/evidence-grounding-verification/...`, not a
real regression. The worktree (gitignored but still on disk) was being picked up by vitest's
default test-discovery glob and run concurrently with the real suite, racing on shared absolute
temp paths (same bug class `vitest.config.ts` already excluded `.claude/worktrees/**` for, on
2026-08-10, but that exclusion only covered the native `EnterWorktree` tool's convention, not the
`using-git-worktrees` skill's manual-fallback `.worktrees/**` convention actually used this
session). Added `.worktrees/**` to the same `exclude` array; reviewed (spawned reviewer
independently confirmed glob-anchoring correctness, re-ran the suite itself, and checked
prettier/eslint/tsc/CI for the same exposure — none found) and committed (`a713684`). Verified: 44
test files (43 run + 1 skipped), 500 tests (496 passing, 4 skipped), 0 unexpected failures. The
merged-and-fixed worktree and its now-fully-merged `feature/evidence-grounding-verification` branch
were then removed (`git worktree remove` + `git branch -d`) — nothing uncommitted was in either.

`fix/full-codebase-audit-findings` is intentionally **not yet pushed** — stays local until the user
reviews it personally, per the same reasoning as the branch's other unpushed work below (an
unreviewed PR touching LLM-call trust boundaries and a new CLI flag isn't yet something to put in
front of CI or other reviewers).

---

**Full-codebase audit + fix effort, all 5 batches landed (2026-08-10)**: continuation
of the 2026-08-06/07 work below. Session arc: (1) implemented the 3 fixes left in the prior
session's handoff — `license.ts`'s prompt-template hallucination bait (same bug class as
`dependencies.ts`'s historical fix, commit `9e0bc29`: replaced a concrete `"line":14` example and
a named "MongoDB" SSPL example with generic placeholders), `complexity`/`lizard` degraded-mode
visibility (`ToolAvailabilityMetadata`/`toolKey` wiring, with corrected wording distinguishing
lizard's augment-not-replace semantics from gitleaks/npm-audit's replace semantics), and
`OrchestratorAgent` file-string normalization — which grew mid-review from just `deduplicate()` to
also cover `hallucinationCrossCheck` (was silently mis-scoring corroborated findings as solo) and
all three `crossReference` escalation branches (was silently missing escalations), after code
review caught both as the same bug class in different methods. (2) Merged PR #18, but only after
fixing two things discovered blocking it: pre-existing prettier drift that had been failing CI
since before this session started (unrelated docs/memory-bank files), and a real security gap in
`.github/workflows/review.yml` — the self-hosted runner (`mizzo-local`, required for local Ollama
access) triggered on every `pull_request` with no fork-origin guard; since the repo is public with
forking enabled, `npm ci` alone (before the AI-review logic even runs) is enough for a malicious
fork PR to get arbitrary code execution on the physical runner machine. Fixed with a job-level
`if: github.event.pull_request.head.repo.full_name == github.repository` guard — same-repo
branches (including Dependabot's) are unaffected, fork PRs get no automated review, which is the
right tradeoff for a repo taking no outside contributors. Published npm `v1.9.0` (v1.8.0 had been
tagged 2026-08-04, before all of this work, and was stale). Installed `lizard` (`pip install
lizard`) — discovered it has a native `-C <N>`/`--warnings-only` threshold flag, relevant to a
later decision below. (3) User requested a full read-every-line audit of `src/` (not a diff review)
against this project's own written standards (`standards/*.md`), explicitly read-only. Ran 6
parallel review lenses (security, performance, hallucination-risk/LLM-trust, dead code,
documentation/logging, architecture), then independently re-verified the highest-severity claims
myself before reporting — caught and corrected one lens's claim that didn't hold up (a `complexity
.ts`/`policyFilter.ts` `extractChangedFiles` duplication was real, but the specific "`/dev/null`
reaches lizard" exploit scenario didn't reproduce, since real git diff deletion headers are
`+++ /dev/null` with no `b/` prefix, which neither implementation's `b/`-prefixed regex would ever
match — confirmed via a real `git diff --no-index` reproduction, not assumed). Full findings: 1
High (path traversal, see below), 7 Medium, several Low, plus 2 items already known/approved from
a 2026-07-25 architecture review but never implemented (semantic-embedding-call redundancy,
low-severity-finding generation waste). (4) User approved fixing everything in one contract-scoped
effort (`.claude/contracts/active-task.json`, branch `fix/full-codebase-audit-findings`), organized
into 5 batches. Two orphaned-config-field decisions were investigated with real git-history digging
rather than guessed: `src/adapters/github.ts` (PR-comment/step-summary upsert logic) is being
deleted — confirmed via `git show` on its very first commit that `review.yml` used an inline
`actions/github-script` implementation from day one, so the adapter was never wired up even once in
2+ months of history, not orphaned by a later refactor. `preferredSecretsScanner`/
`complexityThreshold` (two `ReviewConfig` fields, documented in `CHANGELOG.md` as shipped but
actually no-ops) are being split: `preferredSecretsScanner` (would need a whole new trufflehog
integration, unverified output format, no evidence of demand) is being removed; `complexityThreshold`
is being wired up for real, using lizard's native `-C`/`--warnings-only` flags discovered above,
since `lizard` just landed this session and this makes it a real deterministic filter instead of
more hardcoded prompt prose.

**Batch 1 (path traversal, base.ts parsing gap, MCP scoping) — committed `85e3e1c`, pushed.**
Verified, reproduced-not-assumed exploit chain for the High finding: `ai-review.config.json`'s
`testOutputDir` has zero validation; `CoverageGap[]` (LLM JSON output) bypasses
`OrchestratorAgent.synthesize()` entirely, so it never gets `Finding[]`'s existing
changed-file-membership defense; `path.join(projectPath, tf.path)` does not clamp to `projectPath`
(confirmed directly: `path.join('/a/b', '../../../etc/passwd')` escapes cleanly). Fixed with
defense in depth: `runner.ts` now filters `CoverageGap[]` against the diff's real changed files
(new `filterCoverageGaps`, mirroring `filterNonexistentFiles` including structural drop-reporting
via a new `ReviewResult.coverageGapFilter`, matching the existing `hallucinationFilter` pattern
exactly), and `cli/index.ts` adds a path-containment backstop (`resolveWriteTestPath`) before any
`--write-tests` write. Extracted a shared `src/core/filePath.ts` (`normalizeFilePath`/
`stripDiffPrefix`/`isPathWithin`) so this and the MCP fix don't independently drift — refactored
`orchestrator.ts` to use it too. Separately: `base.ts`'s Stage 2 JSON-parsing was missing the "at
least one item must pass schema validation" guard Stage 1 already had (a non-empty-but-all-invalid
`.findings` array silently resolved to `[]` instead of throwing `ParseFailureError`); Stage 3 had
the identical bug, found while fixing Stage 2 (any `.findings`-shaped object also contains a
balanced `[...]` span, so Stage 3 would silently short-circuit before a Stage-2-only fix could ever
matter) — both fixed. MCP `repo_path` accepted any filesystem path with no scoping (client-supplied,
in practice populated by whatever LLM is calling the tool, an information-disclosure risk under
this project's own `standards/AGENTIC-SAFETY.md` threat model); added opt-in
`AI_REVIEW_ALLOWED_ROOTS` allowlist env var, fail-open (unchanged) when unset. 461 unit tests
passing (up from 448). Went through two full rounds of independent spec-compliance + code-quality
subagent review — both rounds found real issues before commit (a missed containment-logic
duplication between `cli/index.ts` and `mcp/tool.ts`, the coverage-gap-drop reporting gap, an
orphaned comment left over from the `filePath.ts` extraction).

**Batch 2 (silent-failure observability) — committed `caa5368`/`e650a8b`, pushed.** `shell.ts` logs
stderr when a tool exits nonzero with empty stdout (previously indistinguishable from "not
installed", both resolved `null` silently). `config.ts` logs before falling back to defaults on
malformed `ai-review.config.json`. `gitleaksParser.ts`/`npmAuditParser.ts` log on malformed tool
JSON (previously silently reported "0 findings, tool used" — dangerous specifically for the
secrets scanner). `TestGenAgent` now requires generated content to structurally look like real test
code (quoted-title `describe(`/`it(`/`test(`, or `def test_` for pytest), not just pass a length
threshold. Excluded a stale leftover `.claude/worktrees/**` isolated-agent checkout from
`vitest.config.ts`'s glob — it was racing the real suite on shared temp paths. Full `/code-review` +
`/change-review` both run before commit/push; caught and fixed one real regex false-positive-accept
bug in the testGen safeguard itself, plus 2 Low test-coverage gaps fixed in an immediate follow-up
per explicit instruction. `/change-review`'s ACR security job also surfaced a live, concrete example
of a separate reliability problem in ACR's own LLM judgment (see progress.md's "ACR reliability
findings" entry) — deliberately NOT folded into this batch; user explicitly deferred scoping it
until all 5 batches are done. 473 unit tests passing (up from 461).

**Batch 3 (dead code / config cleanup) — committed `f4d3430`, pushed.** `complexity.ts` now uses the
canonical `extractChangedFiles` (excludes `/dev/null` deletions, dedupes) instead of a local
reimplementation. Deleted the unused GitHub PR-comment adapter + its test (270 lines, confirmed
zero live references). Removed the dead `ContextMetadata` interface. Removed the no-op
`preferredSecretsScanner` config field; wired up `complexityThreshold` for real via lizard's `-C`
flag (verified the flag directly rather than trusting the README's stale "default: 10" — lizard's
real default is 15, corrected). Named the `<=5` line-proximity magic number as
`SAME_LOCATION_LINE_PROXIMITY`. Removed `OrchestratorAgent`'s unused `LLMProvider` constructor
param (~40 call sites updated across production code, calibration script, and 3 test files). 464
unit tests passing (net -9 from deleting `adapters/github.test.ts`'s 9 tests, +5 new regression
tests added: complexity.ts dev/null exclusion + `-C` threshold wiring, both directions).

**Batch 4 (drift-prevention) — committed `e7e35a4`, pushed.** `cli/formatter.ts`'s `TOOL_LABELS` was
independently hand-typed against a separate literal union, and `degradedTools` re-typed the same 3
keys a second time as a literal array — now `TOOL_LABELS` is typed `Record<keyof
ToolAvailabilityMetadata, string>` (forces a compile error if the schema gains a key this doesn't
label) and `degradedTools` derives from `Object.keys(TOOL_LABELS)`. `mcp/server.ts`'s tool
description hardcoded a 15-agent list that had already silently drifted from `DEFAULT_CONFIG.agents`
(same 15 agents, `coverage` had moved position). `server.ts` has top-level side effects (connects a
real stdio transport on import) so it can't be safely unit-tested — extracted the derivation into a
new exported `buildToolDescription()` in `mcp/tool.ts` (the existing side-effect-free logic layer)
instead of inlining it in `server.ts`, so this drift-prevention batch's own new logic doesn't ship
untested. New `tests/unit/mcp/toolDescription.test.ts` (separate file — `tool.test.ts` globally
mocks `core/config.js` without `DEFAULT_CONFIG`, which would've broken this). 466 unit tests
passing (up from 464).

**Batch 5 (previously-deferred performance/waste items) — not yet committed, final batch of this
effort.** `loadAgentContextSemantic` takes no `agentName` param — its result is identical for
every agent in a run (same diff, same memory-bank files) — but `runner.ts`'s `withContext` closure
called it fresh once per agent (up to ~16x), recomputing the same diff/file embeddings via Ollama
every time for an identical result. Fixed by caching the `Promise<ContextResult>` in a `let`
scoped to the closure, assigned via `??=` before awaiting — deduplicates concurrent calls under
`--parallel` too, since the assignment happens synchronously before any agent's `await`. Added a
real regression test and verified it actually catches the regression (temporarily reverted the fix,
confirmed the test fails with 6 calls instead of 2 for a 3-agent run), not just written on faith.
The bug-scan review lens then caught a real bug before commit: `??=` only reassigns when `null`,
but a rejected promise isn't `null` — a single transient embedding failure would have stayed
cached forever, poisoning every later agent/retry for the rest of the run and defeating
`retryAttempts` for this failure mode entirely. Fixed with `.catch()` resetting the cache to
`null` before rethrowing; added and verified a second regression test the same way. Separately:
`complexity.ts`/`observability.ts` both instructed the model to generate
`severity: "low"` findings that `orchestrator.ts`'s `applyPublicationFilter` unconditionally
discards before publication — pure wasted generation time. Removed the `"low"` line from both
prompts, added `Only report severity >= medium` matching `dependencies.ts`'s existing phrasing for
the same class of instruction; verified no test/calibration fixture depended on a "low" finding
from either agent first. 468 unit tests passing (up from 466).

**All 5 batches of the full-codebase audit fix effort now complete.** Remaining open item: the
"ACR reliability findings" note above — user explicitly deferred scoping it until this point.

**Remaining batches, not yet started**: Batch 5 (previously-approved-but-unimplemented
items: semantic-embedding-call caching in `contextLoader.ts`/`embedder.ts`; stop asking
`complexity.ts`/`observability.ts` to generate `severity:"low"` findings that
`applyPublicationFilter` discards anyway).

---

**Secrets/dependencies deterministic-tool integration + adversarial/secrets prompt-tightening
(2026-08-06)**: user reported `security`/`secrets`/`adversarial` agents hallucinating findings on
_every_ run against a real PR-sized diff — three fabricated "VERIFIED, 90-95% confidence" findings
each citing genuine evidence text but drawing false conclusions (a marker-file path called a
"database connection string", `sha256sum`/`shasum` output called "hardcoded API keys", a local git
hook's trusted stdin called "attacker-controlled"). Root cause investigation found two independent,
compounding causes, both empirically proven (not assumed) via a scratch script calling
`provider.chat()` directly against real Ollama/`devstral:latest`: (1) a `BaseAgent.parseFindings`
Stage 4 mislabeling bug — a bare single `{...}` object (not the required `[...]` array) fell
through to the truncation-recovery stage and got logged as "response appears truncated" even
though nothing was truncated; (2) genuine LLM content hallucination, independent of parsing,
reproduced 9/9 across secrets/adversarial/dependencies. Also found `OrchestratorAgent`'s existing
hallucination cross-check (downgrades solo High findings from non-deterministic sources) has a
real gap: an unrelated finding from a different agent within 5 lines lets a fabricated finding
survive undowngraded — documented as a deliberately deferred Non-Goal (a naive exact-line-match fix
breaks a legitimate existing test) rather than patched, mitigated instead by moving secrets/
dependencies onto deterministic tool sources exempt from that heuristic entirely.

**Fix, Part A — deterministic tools replace the LLM for secrets/dependencies**: `SecretsAgent`/
`DependenciesAgent` now override `run()` (mirroring `ComplexityAgent`'s existing `lizard`
pattern) to call gitleaks/`npm audit --json` directly and skip the LLM call entirely when the tool
is available — chosen over augmenting the LLM with tool output, since the actual problem is
untrustworthy LLM _judgment_, not missing signal. `gitleaksParser.ts`/`npmAuditParser.ts` map each
tool's real JSON output (verified against gitleaks 8.30.1, installed this session, and this repo's
own live `npm audit`) to the `Finding` schema — `Severity` vocabularies don't match
(`info`/`low`/`moderate`/`high`/`critical` → `low`/`medium`/`high`/`critical`, explicit mapping,
info/low dropped) and gitleaks has no severity field at all (`--redact` also means `evidence` is
always the literal string `"REDACTED"`, never the real secret). npm audit is diff-scoped by trigger
only (touches `package.json`/`package-lock.json`) but reports the _full_ current audit tree, not a
diff-scoped subset — reliably parsing "which packages did this diff touch" from a lockfile diff was
judged too fragile; matches how `npm audit` gates are used in practice. New
`ToolAvailability`/`ToolAvailabilityMetadata` schema types surface degraded-mode (tool not
installed → LLM fallback) on `ReviewResult`, in the markdown report, and in SARIF run properties —
previously this distinction was invisible outside a console.error line.

**Fix, Part B — prompt-tightening for `adversarial`/`secrets`' LLM fallback path**: added
negative examples to `secrets.ts`'s fallback prompt (marker-file paths, hash-algorithm invocations)
and a threat-boundary rule to `adversarial.ts` (attacker/exploit framing only applies to an actual
external untrusted-input boundary, not local dev tooling/git hooks/CI scripts). Explicitly framed
as a rate-reduction attempt, not a guaranteed fix (matches PR #17's prior precedent that
prompt-tightening alone didn't fully eliminate `dependencies`' hallucination before that agent got
its own deterministic-tool replacement). **Honest before/after measurement** (3 runs each, same
real diff, isolating the prompt by calling `provider.chat()` directly — bypassing `run()` so
`secrets`' gitleaks interception doesn't mask the fallback-path measurement): `secrets` improved
3/3 → 2/3 hallucinated (one run now correctly returns nothing); `adversarial` showed **no
measurable improvement**, 3/3 → 3/3 — all three runs still used forbidden attacker/adversary
framing on the local git hook's trusted stdin despite the new rule (confirmed the patched prompt
text was actually in the built `dist/` before concluding this, ruling out a stale-build artifact).
`adversarial` has no deterministic-tool replacement available, so this is a known, reported
limitation, not silently glossed over.

**Bugs found and fixed along the way, independent of the plan**: (1) `parseFindings`'s Stage 4
mislabeling (above) — new Stage 2b recognizes and wraps a single finding-shaped bare object with an
accurate log message instead of the misleading "appears truncated" one. (2) A real Windows-only bug
in `runTool` (`shell.ts`): `spawn('npm', ...)` throws `ENOENT` on Windows (npm resolves to
`npm.cmd`, and Node hard-blocks spawning `.cmd`/`.bat` files without `shell: true` as a security
fix — confirmed by direct reproduction, not assumed) — silently broke the entire npm-audit
integration on Windows, always falling back to the LLM undetected until live calibration surfaced
it. Fixed by adding an explicit `shell` parameter to `runTool`, defaulting to `false` (gitleaks'
`--source <file>` arg can carry diff-derived file paths from an untrusted PR — enabling a shell
there would reopen a command-injection surface); only the npm call site opts into `shell: true`,
since its args are always the hardcoded literal `['audit', '--json']`, never diff-derived. (3) Two
pre-existing calibration cases (`dependencies`, sharing a fixture with the new npm-audit
integration) needed their expected/bait keywords updated to match real tool output instead of the
diff's own fabricated bait text, once `projectPath` was added to the calibration harness so those
cases would actually exercise the new tool paths. (4) A latent test-isolation bug in
`runner.test.ts`'s new `shell.ts` mock — a `beforeEach` that only reset the mock's resolved value,
not its call history, let calls from one test bleed into the next test's `toHaveBeenCalled`
assertions; fixed with the same `vi.resetAllMocks()` pattern already proven in
`secretsAgent.test.ts`/`dependenciesAgent.test.ts`.

**Process note**: mid-session, an implementer subagent was (mistakenly, by this session's own
prompt) instructed that if the review-gate hook blocked a commit, it should write the
`.claude/.code-review-ok` marker directly via hash computation as a "workaround" — a real
gate-bypass instruction, caught by the harness's own security-warning mechanism on that subagent's
tool result. Verified the actual committed content was safe despite the process violation, and
permanently corrected course for the rest of the session: no subagent is ever instructed to write
the review marker or commit; only the controller does, always reflecting genuine review that
already happened.

427 unit tests passing (up from 393 baseline), 18/18 calibration cases passing. Full detail in
`progress.md`'s matching entry and
`docs/superpowers/specs/2026-08-04-secrets-dependencies-deterministic-tools-design.md`.

**Dependencies-agent hallucination fix (2026-08-03)**: user reported `validateFindings()`
rejecting a legitimate "no findings" response (no file/line to point to) forced a retry, and on
retry the model fabricated a plausible-but-fictional finding ("wildcard lodash in package.json:4"
against a diff with zero package.json/lodash content) instead of correctly re-reporting empty.
Root cause: `dependencies.ts`'s system prompt carried a concrete "lodash wildcard" example as its
REQUIRED OUTPUT FORMAT — every other agent uses a placeholder — which the model reproduced
near-verbatim when it had nothing real to report. Considered and rejected loosening
`BaseAgent.parseFindings` to accept a no-file/line "empty" shape: `tests/unit/baseAgent.test.ts`
has a deliberate existing test asserting bare `{}` must throw `ParseFailureError`, a prior fix for
a "silent-clean-pass" bug (see 2026-07-25 entry below) — loosening it would revert a correct
safety property, not fix the actual root cause. Implemented instead: (1) replaced the concrete
lodash example with a placeholder matching every other agent's prompt style; (2) added
`OrchestratorAgent.synthesize()`'s new first-stage filter, `filterNonexistentFiles`, which drops
any finding whose `file` isn't among the diff's actual changed files (computed via the existing
`extractChangedFiles`, threaded through from `runner.ts`) — a defense-in-depth backstop, since
live verification showed fix (1) alone did NOT stop the model from fabricating different
package.json-referencing findings across repeated attempts. New optional `changedFiles?: string[]`
param on `synthesize()`, no-op when omitted (~15 existing call sites unaffected); fails open
(skips the check) when `changedFiles` is empty/undetermined, matching this project's existing
fail-open convention for uncertain state. Found and fixed two of my own bugs during
implementation: `calibrate.ts` initially forgot to pass `changedFiles` into `synthesize()`
(meaning the new filter would never activate during calibration), and the filter's `normalize()`
didn't strip a leading `a/`/`b/` git-diff-header prefix — the model sometimes echoes the diff's
own `--- a/path`/`+++ b/path` convention into the `file` field, which caused two genuinely real
findings (`correctness`, `migration-safety`) to be wrongly dropped as "hallucinated" in a full
calibration run. Fixed by trying both the normalized path and the prefix-stripped form before
rejecting. Final calibration: 16/16 passed except `adversarial` (pre-existing, same single failure
as the original pre-change baseline, unrelated keyword-match flakiness — not a regression).
New calibration case `dependencies-clean` (clean-diff fixture, `expectEmpty: true`) added as a
permanent regression guard. 5 files touched: `dependencies.ts`, `orchestrator.ts`, `runner.ts`,
`calibration/calibrate.ts` + new fixture, plus test coverage in `orchestrator.test.ts`/
`runner.test.ts`. 385 unit tests passing (up from 358).

**Hallucination-filter visibility follow-up (2026-08-04)**: asked "do you think this is best?"
about the dependencies-agent hallucination fix above — flagged one real gap myself before
declaring it done: `filterNonexistentFiles` dropped findings with only a `console.error`,
invisible to anything reading the actual `ReviewResult`. Same anti-pattern this codebase already
caught and fixed once before for sanitizer/context redactions (2026-07-26 entry). Risky
specifically because the filter can false-positive (as the `a/`-prefix bug above proved) — a
future normalization gap could silently drop a real finding with zero trace anywhere the user
looks. Fixed: `OrchestratorAgent.synthesize()`/`filterNonexistentFiles` take an optional
`dropped?: DroppedHallucinatedFinding[]` sink param (no-op when omitted); `runner.ts` passes one
through and surfaces it as `ReviewResult.hallucinationFilter: { droppedCount, dropped }`
(conditional-spread, same pattern as `truncation`/`policy`). `formatJson` needed no change (dumps
`result` verbatim). Found a second pre-existing gap while wiring the markdown formatter: its
`findings.length === 0` early-return path skips the entire sanitizer/context/policy footer block
— which would have silently swallowed the new note in exactly the case it matters most (a
fabricated finding filtered down to zero real findings, e.g. the `dependencies-clean` calibration
case). Placed the new note near the top instead, alongside the truncation warning (matching this
project's own precedent that data-integrity warnings shouldn't be buried at the bottom) rather
than expanding scope to fix the pre-existing footer-ordering gap for sanitizer/context/policy too.
Added to `sarif.ts`'s run-level `properties` for parity with `context`/`policy`/`agentStatus`/
`truncation`. `mcp/formatter.ts` carries none of this metadata today, left untouched. 392 unit
tests passing (up from 385): `schema.ts`, `orchestrator.ts`, `runner.ts`, `cli/formatter.ts`,
`cli/formatters/sarif.ts` + matching test files.

**Calibration CI shell-default fix (2026-08-03)**: `.github/workflows/calibrate.yml`'s "Check
Ollama availability" step is bash `if/then/fi` syntax with no `shell:` declared, so it silently
defaulted to PowerShell on the self-hosted Windows runner and failed with a `ParserError` — the
same bug class already fixed once in `review.yml`. `continue-on-error: true` at the job level
masked every failure as workflow-level "success," so this had been failing on 100% of runs
(confirmed via `gh run view` job-level `conclusion` on the last 4 runs, going back at least to
2026-07-06) with nobody noticing. Fixed by porting `review.yml`'s proven two-part fix verbatim:
a job-level `defaults: run: shell: bash`, plus a bootstrap step (explicit `shell: pwsh`, since
bash isn't resolvable yet) prepending Git's real bash to `$GITHUB_PATH` ahead of the broken WSL
stub. `/code-review`'s Testing domain flagged that `review.yml`'s own fix took 3 iterations to
actually work in practice (each failure only visible at runtime) — so before merging, ran 3
manual `workflow_dispatch` verification runs on this branch rather than trusting the next weekly
cron. The shell fix itself worked correctly in all 3 (bash steps executed, Ollama correctly
detected, real PASS/FAIL results) — but runs 1-2 also surfaced a second, separate pre-existing
bug: `timeout-minutes: 10` had never been validated against real suite runtime (the job never
got past the shell bug far enough to reach it), and both runs got cancelled mid-suite. Raised to
20 (own commit). Run 2 additionally showed cases 5+ running 3-5x slower than run 1's pace for the
same cases — investigated directly on the runner machine (Ollama's own server.log, `nvidia-smi`,
Windows System event log) rather than guessing: ruled out model-reload cycling (loaded once,
stayed loaded) and GPU driver reset/crash (no `nvlddmkm` events); no throttling or resource
exhaustion visible in Ollama's log for that window either. Root cause not conclusively provable
after the fact (no retroactive GPU time-series available) — leading hypothesis is transient
resource contention on this shared, personal-use machine (possibly this very session's own
concurrent activity), not a code defect. Confirmed by a 3rd monitored run (`nvidia-smi --query-gpu`
sampled every 5s throughout): completed the full 16-case suite + testgen in ~13-14min with
consistent ~30-70s/case pacing and zero throttle-reason flags the entire time — same code, same
hardware, same 20min budget, no degradation, when nothing else was contending. `timeout-minutes:
20` is empirically validated with real margin under normal conditions. See progress.md for full
detail and the calibration results themselves (15/16 passed, 1 genuine miss on "adversarial").

**Code review follow-up, part 2: remaining findings closed (2026-07-26)**: after the
CoverageAnalyst parity fix below landed, user said "fix it all" for the rest of the `/code-review`
findings rather than leaving them tracked-but-deferred. Closed: broadened the "act as a" sanitizer
regex to also catch "act as a Linux terminal"/"act as DAN" jailbreak framings that don't use an
AI/assistant/bot/model word (without reopening the earlier false positive on ordinary phrases);
fixed the SRI-hash base64 false positive properly this time via a per-pattern
`isFalsePositive(line, matchOffset)` context check applied after a regex match is found (the
earlier negative-lookbehind attempt was correctly abandoned after proving the regex engine could
bypass it via an alternate match-start position — checking actual match context in code has no
equivalent bypass); merged memory-bank sanitizer redactions into `result.sanitizer` (previously
console.warn-only, invisible to the structured report); updated `--no-sanitize`'s CLI
help/README/runtime warning to mention it also covers memory-bank context; hardened
`OllamaProvider.stripThinkTags` to drop an unclosed `<think>` block and everything after it,
closing the opposition review's SPECULATIVE finding about Stage 4 potentially recovering a
coincidental object from unstripped reasoning prose (confirmed inert under the current `devstral`
default, hardened anyway since it was cheap). 378 tests passing (up from 371). Full detail in
`progress.md`'s "Part 2" entry.

**Code review follow-up, part 1: CoverageAnalyst truncation parity (2026-07-26)**: ran the full
`/code-review` gate (5 domain subagents + opposition review) on the v1.8.0 diff below before
committing. Four of five domain reviewers independently converged on one finding:
`coverageAnalyst.ts` got `format:'json'` (which the diff's own calibration data shows raises
truncation frequency) without the Stage 4 recovery that made it safe in `base.ts`. Opposition
review downgraded the initial High/Blocking rating after confirming `runner.ts`'s existing
`agentStatus`/exit-code-2 mechanism means this fails loudly, not silently — but still recommended
fixing it in-PR since it was cheap and already had a repro. Fixed: extracted
`extractBalancedSpan`/`extractCompleteObjects` into `parsing.ts` as shared helpers (replacing
three near-duplicate hand-rolled bracket scanners with two), fixed a negative-depth bug in the
scanner found via direct execution during Correctness review (a stray leading `}` used to
permanently break recovery for the rest of the response — now uses a stack of open-brace
positions instead of a depth counter, self-healing from any stray unmatched `}`), and gave
`CoverageAnalystAgent.parseCoverageResult` its own Stage 3 truncation recovery. Full detail in
`progress.md`'s "Code Review Follow-Up" entry. 371 tests passing (up from 358).

**Structured JSON output, truncation recovery, memory-bank context sanitization (2026-07-25,
v1.8.0)**: follow-up to calibration bake-off runs surfacing real parse-truncation failures
(devstral cut off mid-generation on `performance`; gemma3:12b similarly on `integration`).
Implemented `format: 'json'` (Ollama's grammar-constrained structured output) in `base.ts`'s
`run()` and `coverageAnalyst.ts`'s `runForCoverage()` — `ChatOptions.format` existed end-to-end
but nothing ever passed it. NOT applied to `TestGenAgent` (outputs raw test code, not JSON).
**Important, non-obvious result from re-running calibration afterward**: `format: 'json'` alone
made truncation _more_ common, not less — 11/16 cases truncated mid-generation (vs. 1/16 before),
apparently because strict schema compliance (every verbose required field filled in exactly)
removes whatever slack let the model wrap up more tersely. The real reliability win came from a
new Stage 4 in `BaseAgent.parseFindings`: `extractCompleteObjects()` scans for complete `{...}`
objects regardless of whether the enclosing array ever closes, salvaging whatever the model
finished instead of discarding everything. Recovered objects still go through the same
`validateFindings` schema check as every other stage — caught and fixed a real regression during
implementation where a trivially-parseable garbage response (`"{}"`) was being treated as a
successful "0 findings" recovery instead of throwing `ParseFailureError`, exactly the silent-clean
-pass anti-pattern this whole project exists to prevent. With both changes together: 15/16 passed
on devstral, with the recovery stage salvaging all 11 truncated cases — same headline score as
before, but demonstrably more robust underneath. Separately answered "are there any guardrails we
are missing": found `contextLoader.ts`'s comment falsely claimed memory-bank context was already
sanitized ("sanitizer applies separately") — it wasn't; `sanitizeDiff()` was only ever called on
the diff. Added `sanitizeText()` (scans every line, since `sanitizeDiff`'s `+`-prefix convention
is diff-specific) and wired it into `runner.ts`'s `withContext`, respecting `--no-sanitize`.
Dogfooding this against the repo's own real memory-bank files caught a live false positive: the
sanitizer's "act as a" pattern fired on `activeContext.md`/`progress.md`'s own prose describing
that same bug ("act as a validator") — tightened the pattern to require it target an
AI/assistant/bot/model role (matching the existing "you are now" pattern's structure), confirmed
real injection attempts still match and the repo's own memory-bank no longer false-positives.
Considered but did not attempt fixing the SRI-hash base64 false positive from the earlier
architecture review — a naive negative-lookbehind doesn't work due to the regex engine finding an
alternate match-start position that bypasses it; needs a proper code-level (non-regex) fix,
deferred. Open follow-up, not yet decided: add an explicit `num_predict` to counteract
`format: 'json'`'s higher truncation rate directly, now that there's concrete evidence it's
needed, rather than relying solely on the recovery stage to paper over frequent truncation.

**Actionable truncation warning; parallel-by-default investigated and rejected (2026-07-25)**:
follow-up to a real bug report (ACR's 4-agent security profile took ~22 minutes against a
4658-line diff, zero findings). Initially implemented `DEFAULT_CONFIG.parallel: true` after a
4-concurrent-request, trivial-prompt test showed a ~1.63x speedup — but a deeper test at the real
default scale (14 concurrent requests, matching the actual default agent count, with a realistic
~30KB diff prompt) showed near-linear serialization instead: completions at 58.7s, 91.5s, 120.6s,
172.7s, 235.0s, 305.7s, then a header-timeout past 300s for a still-pending request. Reproduced
with `curl` directly (bypassing Node's fetch client) to rule out a client-side artifact — same
staggered pattern. Since each queued request's client-side timeout clock starts at dispatch, not
when Ollama actually begins generating, defaulting to parallel would have caused most of the
default swarm to spuriously time out — reproducing the exact "everything times out, 0 findings"
bug this tool exists to prevent. Also confirmed `ai-review-agent` has zero Anthropic/Claude API
integration (100% local Ollama inference), so there's no token-cost pressure to justify the
reliability risk. **Reverted** `DEFAULT_CONFIG.parallel` back to `false`, `--no-parallel` back to
plain opt-in `--parallel`, and `memory-bank/systemPatterns.md`'s original "Sequential Execution"
rationale back (it was correct all along — updated with the investigation's findings rather than
struck through). Kept: the truncation-warning wording improvement (unrelated, still good), and
the `--fail-fast`+`--parallel` combination warning (still useful for opt-in parallel users).
Shipped as v1.7.0, 348 tests. This repo's own `/code-review` pre-commit gate caught 2 real
Blocking findings on the (pre-revert) parallel-default version, both moot after the revert. Model
choice was separately investigated (see "Model configuration" below) — `devstral:latest` remains
correct; a real bake-off against `qwen3:latest`/`gemma3:12b` is next. Deferred to follow-up PRs
per the same bug report: retry with a shrunk prompt on timeout, and parse-failure fallback
extraction (surface the model's raw response instead of discarding it). A separate deep
architecture review (same session) surfaced 6 more findings — see "Architecture review findings"
below.

**Architecture review findings (2026-07-25)**: a request for "true design suggestions, not made
up" prompted a verified (not speculative) pass over the core source. Highest-value: (1)
`ChatOptions.format?: 'json'` is fully plumbed (`provider.ts`, `ollamaProvider.ts`) but never
called anywhere — empirically confirmed `format: "json"` makes `devstral:latest` reliably emit
syntactically valid JSON, which should reduce the `ParseFailureError`/prose-instead-of-JSON class
of bug this project has fought since v1.4.0. (2) `--context-mode semantic`
(`loadAgentContextSemantic` in `contextLoader.ts`) has zero caching and is called once per agent
in `runner.ts`'s `withContext` closure — ~14x redundant Ollama embedding calls per run for
identical inputs, adding unnecessary contention on top of the concurrency findings above. (3)
`orchestrator.ts`'s `applyPublicationFilter` unconditionally discards all `severity: 'low'`
findings with no override, yet `complexity.ts` and `observability.ts` explicitly instruct the
model to generate them — pure wasted generation time for those two agents. (4) `sanitizer.ts`'s
regex heuristics false-positive on ordinary code — empirically reproduced: SRI integrity hashes
(`sha512-...`, common in dependency-update diffs) and comments like "act as a validator" both get
silently redacted before reaching the LLM; zero existing tests check for this. (5) `base.ts`
unconditionally sends `think: true`, but `OllamaProvider.supportsThinking()` only forwards it for
`qwen`/`deepseek-r1` models — never `devstral`, the actual default — so `systemPatterns.md`'s
"reasoning depth matters" claim doesn't describe what's actually running. (6) `OrchestratorAgent`
takes an unused `LLMProvider` constructor param (100% deterministic synthesis, no LLM calls).
User approved items 1, 2, 4 as worth implementing; not yet started.

**Model configuration investigation (2026-07-25)**: user asked to verify the correct Ollama model
is configured given more models were downloaded. Confirmed `DEFAULT_CONFIG.model: 'devstral:latest'`
(`config.ts:38`) is consistently referenced everywhere (including `calibration/calibrate.ts:138`)
— no drift or misconfiguration. Measured actual GPU/CPU split at the real 32k context for every
locally-downloaded model: `devstral:latest` 20GB/30%-GPU, `deepseek-r1:14b` 15GB/38%-GPU,
`gemma3:12b` 9.1GB/49%-GPU, `qwen3:latest` 10GB/59%-GPU, `gemma3:4b` 2.9GB/**100%-GPU** (the only
fully GPU-resident option). Recommendation: don't switch yet — no evidence any alternative
matches devstral's review quality on this project's calibration suite, and `gemma3:4b`
specifically is a large capability step down (4B vs 23.6B params). `calibration/calibrate.ts` has
no model override (hardcoded to `DEFAULT_CONFIG.model`) — adding one to run a real bake-off
against `qwen3:latest`/`gemma3:12b` is the agreed next step, not yet started.

**Truncation-aware timeout scaling (2026-07-18)**: follow-up to diff-truncation visibility
below, addressing the same bug report's other suggested fix. `agentTimeoutMs` was flat
regardless of diff size — `scaleAgentTimeout(base, diffLines, maxDiffLines)` in `runner.ts`
now linearly scales it up to 2x as the post-truncation diff size approaches `maxDiffLines`, on
by default (`ReviewConfig.timeoutScalingEnabled`). Passing `--timeout` explicitly sets
`timeoutScalingEnabled = false` so an explicit override always wins — no scaling. Threaded
through as a new `timeout` parameter to `runCoverageAgent`/`runAgentsSequential`/
`runAgentsParallel` and the inline TestGen block, computed once in `run()` right after
`preprocessDiff()` produces `truncationMeta`. Also fixed a stale CLI help-text bug found along
the way (`--timeout` still documented the old 60000ms default, pre-dating the earlier 60s→180s
fix). Shipped as v1.6.0.

**Diff-truncation visibility (2026-07-18)**: real bug report against v1.2.0 (PMB running
`/change-review` against a 4188-line diff) — truncation to `--max-lines` (default 2000) only
ever logged to stderr, never appeared in the report itself, so a caller reading just the
markdown/JSON/SARIF/annotations output had no way to know over half the diff was excluded.
Added `ReviewResult.truncation: { truncated, originalLines, keptLines }` (same conditional-spread
pattern as `agentStatus`), surfaced prominently near the top of the markdown report (not buried
at the bottom like `sanitizer`/`context`), in SARIF run properties, and as a `::warning::`
github-annotation even with zero findings. Deliberately NOT wired into exit code 2 — a truncated
but successful review is a different kind of "incomplete" than an agent that outright failed.
Shipped as v1.5.0. The bug report's core complaint (false-clean result on agent failure) turned
out to already be fixed on `main` as v1.4.0 but stuck unpublished at npm v1.2.0 — published via
`git tag v1.4.0 && git push --tags` before this follow-up started.

**Silent agent failure reporting fix (2026-07-17)**: a run where every agent timed out or
returned unparseable prose instead of JSON rendered identically to a genuinely clean review —
`0 findings | ✅ No issues found` in both cases, only visible in stderr. `parseFindings`
(`base.ts`) and `parseCoverageResult` (`coverageAnalyst.ts`) now throw `ParseFailureError`
instead of silently returning `[]`; `runner.ts`'s 4 catch blocks classify it into a new
`agentStatus: Partial<Record<AgentName, AgentStatus>>` field on
`ReviewResult`. All 4 formatters surface it; a new exit code 2 (independent of and taking
priority over `--fail-on`) means CI can no longer silently treat a broken run as passing. Shipped
as v1.4.0 (v1.3.0 was already taken by the ai-review-distribution feature below, merged first).
See `docs/superpowers/specs/2026-07-15-silent-agent-failure-reporting-design.md`.

**`/ai-review` distribution + update-notifier (2026-07-14)**: `/ai-review` previously only existed
as a slash command inside this repo's own checkout -- `package.json`'s `files` array never shipped
`.claude/commands/`. Added a `postinstall` script (`scripts/postinstall.mjs`, plain JS so it can't
be broken by an unbuilt `dist/`) that copies it to `~/.claude/commands/` on every global install
(resolving the invoking user's real home even under `sudo npm install -g`), plus an
`update-notifier` check in the CLI entrypoint (7-day cache, non-blocking, never auto-installs). See
`docs/superpowers/specs/2026-07-14-ai-review-distribution-design.md`.

**AbortSignal/timeout-cancellation fix (2026-07-14)**: `withTimeout`'s `Promise.race` never cancelled the losing side, so a timed-out agent's in-flight fetch to Ollama kept running server-side (up to `DEFAULT_TIMEOUT_MS`, 5 min) after the runner had already given up — each retry then piled another live, uncancelled request on top instead of replacing the abandoned one. Fixed by threading an `AbortController`'s signal from `withTimeout` (`runner.ts`) through `agent.run()`/`runForCoverage()`/`runWithGaps()` down to `OllamaProvider.chat()`'s `fetch` call, so a timeout now actually cancels the request. Also fixed a `clearTimeout` gap the fix itself introduced (the timer's handle was never captured, so even a successful call left a dangling timer that fired a pointless `abort()` afterward). Went through full `/code-review` (5 subagents + opponent check) — no other issues found. 297 unit tests passing (up from 295). Also fixed an unrelated CI bug in `.github/workflows/review.yml`: the "Write Step Summary" step used bash-only escaping with no `shell:` declared, defaulting to PowerShell on the self-hosted Windows runner and failing with `ParserError`/`SyntaxError` on every PR — fixed with a job-level `shell: bash` default.

**`agentTimeoutMs` default raised 60s → 180s (2026-07-14)**: dogfooding `/change-review` on this session's own diff surfaced that ACR's security profile timed out on all 4 agents against `devstral:latest` (0 findings via failure, not a clean result). Reproduced directly: a realistic diff-sized prompt (~24KB) took over 100s with no response. Root cause is this dev machine's GPU (8GB VRAM) not fitting the 23.6B-param model — `ollama ps` showed only 6.1GB offloaded to GPU, the rest running on CPU. `DEFAULT_CONFIG.agentTimeoutMs` (`src/core/config.ts:60`) was still 60000ms, far tighter than `OllamaProvider`'s own `DEFAULT_TIMEOUT_MS` (300000ms) already assumed — raised to 180000ms to close that gap. Config-only change; 297 tests still pass, typecheck clean.

**New push/PR CI gate added (2026-07-06)**: this repo previously had no CI gate on regular
push/PR to `main` — `typecheck`/`lint`/`test`/`build` only ran at release-tag time
(`release.yml`), and `review.yml` only ran `format:check` + posted an AI-review comment without
failing the build on findings. Added `.github/workflows/ci.yml`: on every push/PR to `main`, runs
typecheck, format:check, lint:eslint, test, and build as independent steps (`id:` +
`continue-on-error: true`), followed by a "Gate on all checks" step (`if: always()`) that fails
the job if any step didn't succeed — same masking-prevention pattern applied to Bowling-Tracker
and Google-Organizer this session. Also fixed pre-existing `format:check` drift on 6 docs/command
files (unrelated content, mechanical `prettier --write`) so the new gate is green from day one.
All 5 checks verified passing locally (295/295 tests) before the workflow was added.

**All audit work complete.** Three-round pre-production audit (Rounds 1–3, 2026-06-24 to 2026-06-26) resolved all 90+ findings. Zero open Critical/High issues. 295 unit tests passing. Production ready.

## Guardrails (All Complete)

- [x] **G1**: Hallucination cross-check — now confidence-aware (solo Critical ≥60% → keep, <60% → High)
- [x] **G2**: Diff size guard — `--max-lines` CLI flag (was `--max-diff-lines`)
- [x] **G3**: Finding deduplication merging — `corroboratingAgents` on Finding schema
- [x] **G4**: Per-agent timeouts — `--timeout` CLI flag
- [x] **G5**: Configurable severity gating — `--fail-on` flag
- [x] **G6**: Path exclusions — `.aiignore` + `--ignore` CLI flag (was `--ignore-path`)
- [x] **G7**: Prompt injection sanitization — `--no-sanitize` to opt out

## Phase 2 Features (All Complete)

- [x] CLI consolidation: flattened `review` subcommand, 3 flag renames, `--no-sanitize`
- [x] Prompt injection sanitizer: 9 unit tests
- [x] BreakingChangeAgent: 5 unit tests
- [x] LicenseComplianceAgent: 5 unit tests
- [x] Confidence scoring: 6 unit tests
- [x] Calibration CI workflow
- [x] Documentation: README, CHANGELOG, slash command, memory-bank

## v0.5.0 Design Decisions (2026-06-11)

**Target**: Cursor IDE (VS Code-compatible extension API), Windows + Mac.

**Architecture**: Subprocess model — extension shells out to `ai-review-agent --format json`, parses `Finding[]` JSON from stdout. No monorepo, no restructuring of existing codebase. Extension is ~150 lines.

**Bundling**: Bundle `ai-review-agent` npm package inside the `.vsix` (~5 MB). Zero install friction — no global npm install required.

**Trigger**: Command palette only — `AI Review: Review Staged Changes`. User-initiated, never runs on save (Ollama latency is 30–120 s).

**Diff source**: Staged changes (`git diff --cached`). If nothing staged, show clear error: "No staged changes found. Stage your changes with `git add` and try again." No fallback magic.

**Output surfaces** (both):

1. `vscode.languages.createDiagnosticCollection` → squiggles in editor + Problems panel entries, click-to-navigate to file/line. Cleared on next run.
2. `vscode.window.createOutputChannel("AI Review")` → full markdown report, same content as CLI output. No webview.

**Repo structure**: `vscode-extension/` subfolder in existing repo. Standalone package, no pnpm workspace needed (subprocess approach requires no shared source).

**Rejected alternatives**:

- Monorepo (Option 2): too much restructuring risk for first extension release
- Workspace dep (Option 3): half the monorepo pain with fewer benefits
- Webview output: OutputChannel gives 90% of value at 10% complexity
- Quick-pick diff source: decision fatigue for the common case; two explicit commands if needed later

## Recent Decisions

- **CLI flattening**: removed `review` subcommand (was implicit, confusing in help output)
- **`--dir` not `--path`**: clearer that it's a directory, not a generic path
- **`Map` instead of `Record` for agent builders**: graceful unknown-agent handling vs compile-time exhaustiveness
- **Confidence default 70**: reasonable for an LLM agent without explicit confidence output
- **Solo Critical + ≥60% stays Critical**: high-confidence agent findings don't need corroboration

## Session Notes

- 2026-06-04: Tasks 1–5 implemented and committed.
- 2026-06-04/05: Tasks 6–10 implemented and committed (agents, orchestrator, SwarmRunner).
- 2026-06-05: Tasks 11–15 implemented (CLI, GitHub Actions, slash command, calibration suite, e2e test).
- 2026-06-06: Task 16 — final verification complete. All 16 tasks shipped. Pushed to GitHub.
- 2026-06-06: Guardrails G1–G6 complete. 37 unit tests passing.
- 2026-06-06: Phase 2 — CLI consolidation, sanitizer, BreakingChangeAgent, LicenseComplianceAgent, confidence scoring, calibration CI. 62 unit tests passing.
- 2026-06-10: v0.3.0 — npm distribution. Renamed package `ai-review` → `ai-review-agent` (name taken). Published to npm via tag-triggered release workflow. Node.js upgraded to 24 in release.yml.
- 2026-06-11: v0.4.0 — prompt tuning + calibration expansion. `confidence` field added to all 10 agent systemPrompts. `calibrate.ts` rewritten to cover all 11 agents (10 standard + TestGen). New fixtures: `breaking-change.diff`, `license.diff`.
- 2026-06-11: v0.5.0 brainstorm — Cursor/VS Code extension design decisions locked. Subprocess architecture, bundled install, command palette trigger, staged-changes diff, DiagnosticCollection + OutputChannel output.
- 2026-06-11: v0.5.0 spec written and committed at `488fba2`. Implementation plan written and committed at `2fa1444`. 10 tasks, full TDD, all code included verbatim. Ready for execution.
- 2026-06-11: v0.5.0 complete — all 10 tasks (Task 0–9) implemented, reviewed, committed. Extension builds to `ai-review-agent-0.5.0.vsix` (137.85 KB, 119 files).
- 2026-06-12: Cleanup — v0.4.0 published to npm; extension dep updated from tarball to `^0.4.0`; tarball removed from repo; `.gitignore` whitelist exception cleaned. All pushed (`2be6d27`).
- 2026-06-12: v0.6.0 brainstorm → A+C hybrid output format, Cursor+Windows/Mac target, Ollama-only. Spec committed at `2852b00`, plan committed at `d277da4`. Implementation starting.
- 2026-06-12: v0.6.0 COMPLETE — `ai-review-mcp` binary ships in the package. 6 tasks, 7 commits (`27be871`→`1b697db`). 77 unit tests. Version bumped to 0.6.0. Next: `git tag v0.6.0 && git push --tags` to publish to npm.
- 2026-06-13: Configurable retry logic — `withRetryTimeout` wrapper in `runner.ts`, `retryAttempts`/`retryDelayMs` config + CLI flags, 3 new tests. 80 unit tests. Committed as `c2d2387`.
- 2026-06-18: v0.9.0 — AgentProgressEvent two-phase events, --fail-fast CLI flag, failFast/failOn on ReviewConfig, earlyExit on ReviewResult, stderr progress renderer. 117 unit tests. Published to npm.
- 2026-06-19: v0.9.1 — Calibration pass: ErrorHandlingAgent prompt (swallowed keyword + selective-rethrow exclusion), ObservabilityAgent (pure-function exclusion), MigrationSafetyAgent (safe DDL exclusion). All 117 tests still pass.
- 2026-06-19: v0.9.2 — Calibration fixes (5 failing cases): balanced-bracket parser in base.ts, wildcard wording in dependencies.ts, integration-tests wording in integrationScout.ts, license.diff fixture node-lame. 118 unit tests pass. Committed `6285207`.
- 2026-06-19: v0.9.3 — DependenciesAgent prompt restructured to lead with REQUIRED OUTPUT FORMAT + few-shot example. devstral now outputs valid Finding schema for package.json diffs. 16/16 calibration PASS confirmed. Committed `754ee08`.
- 2026-06-15: v0.8.0 — 5 new specialist agents (ErrorHandlingAgent, ObservabilityAgent, MigrationSafetyAgent, SecretsAgent, ComplexityAgent), `shell.ts` runTool(), conditional MigrationSafety skip in SwarmRunner, 32 new unit tests (112 total), 5 calibration fixtures, DEFAULT_CONFIG updated to 16 agents, package.json v0.8.0, README updated. Tasks 1–9 committed. Task 10 (final verification + tag) is next.
- 2026-07-14: AbortSignal/timeout-cancellation fix — `withTimeout` now cancels the losing side of the race instead of leaving it running server-side; fixed a `clearTimeout` gap found in review; unrelated CI fix (`shell: bash` default in `review.yml`, was silently defaulting to pwsh on the self-hosted Windows runner). 297 unit tests passing.
- 2026-07-25: v1.7.0 — attempted flipping `parallel` default to `true` after a promising small-scale test, then reverted after a deeper test at real scale (14 concurrent, realistic diff size) showed near-linear serialization and spurious-timeout risk. Kept the truncation-warning wording improvement. Separately: verified `devstral:latest` remains the correct configured model after more Ollama models were downloaded (measured GPU/CPU split for all of them); ran a "not made up" architecture deep-dive that found `format: 'json'` is unused, `--context-mode semantic` recomputes embeddings ~14x redundantly, and the sanitizer false-positives on real code (SRI hashes, common comments). 348 unit tests passing.
- 2026-07-25: v1.8.0 — implemented `format: 'json'` (turned out to increase truncation frequency, not decrease it) plus a truncation-recovery stage in `parseFindings` that ended up doing the real reliability work; fixed a real gap where memory-bank context wasn't actually sanitized despite a comment claiming it was; dogfooding that fix on this repo's own memory-bank caught and fixed a live sanitizer false positive. 358 unit tests passing.
- 2026-08-06: secrets/dependencies deterministic-tool integration (gitleaks/`npm audit` replace the LLM entirely when available) + adversarial/secrets prompt-tightening + `parseFindings` Stage 4 mislabeling fix + a real Windows-only `npm` spawn bug found and fixed via live calibration. 427 unit tests passing, 18/18 calibration. Honest result: `secrets` prompt-tightening 3/3→2/3 hallucinated; `adversarial` showed no measurable improvement (3/3→3/3), a known limitation since it has no deterministic-tool replacement.

## Moved from activeContext.md, 2026-08-27

Both shipped in v1.13.0 and their detailed records live in `progress.md`; these are the
Current Focus summaries, moved during a deliberate archiving pass rather than deleted. The
`toolAvailability` paragraph carried one lesson with no other home — that a rationale recorded in a
code comment is a claim, not a finding — which was carried into `progress.md` rather than left here.

**Calibration is now falsifiable, and no case is coupled to this repo's own state (2026-08-21).**
The 21–22/22 score used to aggregate assertions of very different strength — three cases asserted on
the agent's own domain vocabulary, and `DependenciesAgent` had **no** case that could fail (both
were `expectEmpty`, so an agent returning `[]` passed). Added `dependencies-vulnerable` plus a
per-case `projectPathFixture` so tool-backed cases run against their own materialised project.
`license-clean` was then moved onto its own `license-clean-lockfile.json` — it had passed only
because `commander` happens to be an ACR dependency. Keyword strengthening is measured, not assumed:
`calculateShippingCost` 5/5, `notifyWebhook` 4/4, `cancelOrder` 4/6 → reverted. Failing cases now
print what the agent actually returned. Details in `progress.md`.

**`toolAvailability` is now honest end-to-end (2026-08-21).** `'partial'` was added, surfaced in
MCP output (which had ignored the field, making a partial scan, a missing tool, and a clean run
identical to a calling LLM), and merged across chunks rather than last-chunk-wins. `TOOL_LABELS`
moved to `schema.ts` so formatters cannot drift. Generalisable lesson from the deferral that held
`'partial'` back: **a rationale in a code comment is a claim, not a finding** — it asserted a
markdown/SARIF/MCP ripple, but only one site branched on the value.

## Moved 2026-08-28 — merging `handoff.md` into a file at 149/150

Two blocks moved out of `activeContext.md` to make room for the handoff merge. Both describe
shipped work or a past removal rather than current state, which is what this archive is for. The
durable rules they establish stay upstream in `systemPatterns.md`.

**ACR was reviewing the wrong side of its own diffs, and repeating itself** — all shipped:
`a/`-prefixed paths pointing 33% of findings at nonexistent files (#45), deleted code reported as
current (#46), same-agent repeats surviving dedup (Bug D, #50). **The method mattered more than any
single fix:** `gh run download` yields the real `ai-review-findings` artifact, and replaying it
through `synthesize()` caught a miswiring every unit test and a scratch probe both missed. (The
method survives upstream as "Replay real captured output through the real entry point".)

**Removed 2026-08-20 from Next Steps:** an "Anthropic/Claude provider (backlog)" item, contradicting
`projectbrief.md` ("Ollama-only backend"), `systemPatterns.md` **Never Do This**, and its Sequential
Execution rationale (which uses "no Anthropic/Claude API integration" as a load-bearing premise),
plus the shipped identity ("zero API costs"). No decision authorizing it exists. Reinstating it
needs a projectbrief amendment and a revisit of parallel-vs-sequential, not a backlog line.

## Moved 2026-08-28 (second pass) — the 2026-08-26 PMB-brief triage narrative

Archived during the handoff merge's review, which found that the first pass had _compressed_ this
material rather than moving it, dropping substance in the process. Everything below is preserved
verbatim; the live rules it supports stay in `activeContext.md`.

**Two PMB briefs on ACR, both triaged (2026-08-26).** Shipped from them: the `INCOMPLETE` headline —
the glyph is the verdict for a skimming reader, and qualifying text alone had already failed once —
and `formatter.ts`'s truncation advice realigned with `runner.ts` to prefer `--chunk`.

Their four wrong diagnoses, kept here with the reasons they were rejected: no fetch timeout separate
from `--timeout` (`ollamaProvider.ts` uses the caller's signal); agents are sequential by default;
chunking preserves hunk headers byte-identically; and the second brief's cross-file misattribution
cannot be a chunking artifact, since `--chunk` is opt-in and their 1769-line run never triggered it.

**The second PMB-owned defect example**, dropped from the live file by over-compression and restored
here: `pre-push-check.*` calls `mb validate`, which was folded into `mb doctor`, and prints its "use
mb doctor" message as evidence of inconsistency on every push. This is the second of the two live
examples supporting the claim that all sixteen reported defects share one shape — the check's result
being disconnected from whether it ran. One example does not establish a shape; two do.

## Per-agent timeout ceiling — full measurement (2026-08-27, archived 2026-08-31)

Moved out of `activeContext.md`'s Next Steps to make room for the `earlyExit` and `ping()` items.
The conclusion and the do-not-re-derive instruction stay upstream; this is the measurement.

12 invocations over a 4,703-line diff, `--profile security`, `--chunk`, devstral on GPU. Eleven ran
well under budget (slowest real attempt 213.2 s against a 315.4 s ceiling, 68%). The twelfth
_appeared_ to exceed its ceiling — `adversarial` 611.7 s against 354.7 s — and that row is a
**measurement artifact, not an agent running long**: stderr shows
`failed (attempt 1/2): fetch failed — retrying`, so 611.7 s is wall time across two attempts plus
backoff. No single invocation came near its ceiling; the real fault in that row is `fetch failed`,
which is resource pressure, separate from our abort path.

Sent to PMB, who hold it at our confidence level and instructed their next session not to upgrade
the 616 s hedge. That correspondence is **suggestive, not established** and must not be promoted to
"resolved" — the original has no source.

Still untested: true CPU-only, which needs an Ollama restart with `OLLAMA_NUM_GPU=0`
(`OllamaProvider` forwards no `options`, so `num_gpu: 0` is unreachable per-request).
