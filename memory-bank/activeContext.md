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

**Last Updated**: 2026-08-10

## Current Focus

**Full-codebase audit + fix effort, batch 1 of 5 landed (2026-08-10, in progress)**: continuation
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

**Remaining batches, not yet started**: Batch 2 (silent-failure observability — `shell.ts` discards
stderr with no logging, conflating "tool not installed" with "tool installed but broken";
`config.ts` silently falls back to defaults on malformed `ai-review.config.json`;
`gitleaksParser.ts`/`npmAuditParser.ts` silently return `[]` on malformed tool JSON, a false sense
of security specifically for the secrets scanner; `TestGenAgent`'s only safeguard against
fabricated generated test code is a length check). Batch 3 (dead code / config cleanup —
`complexity.ts` reimplements `extractChangedFiles` instead of importing the canonical
`policyFilter.ts` version; delete unused `adapters/github.ts` + test; remove
`preferredSecretsScanner`, wire up `complexityThreshold` via lizard's `-C`/`-w` flags; name the
`orchestrator.ts` `<=5` line-proximity magic number copy-pasted 4x; remove `OrchestratorAgent`'s
unused `LLMProvider` constructor param; remove dead `ContextMetadata` interface in
`contextLoader.ts`). Batch 4 (derive `cli/formatter.ts`'s `TOOL_LABELS` and `mcp/server.ts`'s
hardcoded agent-list description from schema/config instead of hand-maintained duplicates). Batch 5
(previously-deferred-but-approved items: semantic-embedding-call caching in `contextLoader.ts`/
`embedder.ts`; stop asking `complexity.ts`/`observability.ts` to generate `severity:"low"` findings
that `applyPublicationFilter` discards anyway).

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

## What's Working

- Full 16-agent swarm (15 default + testgen opt-in): all specialists + OrchestratorAgent
- `SwarmRunner` with policy filtering, context injection, sanitizer, sequential/parallel execution
- CLI: `--profile`, `--context`, `--context-mode`, `--context-budget`, `--format` (markdown/json/sarif/github-annotations), `--no-emoji`, `--agents`, `--dir`, `--ignore`, `--no-sanitize`, `--suggest-tests`, `--write-tests`
- Finding schema: domain, evidence, impact, recommendation, blocking, source, lineEnd (MB/PMB-aligned)
- Semantic context: `--context-mode semantic` uses nomic-embed-text to rank memory-bank files by diff similarity
- Policy layer: `agentPolicy` per-agent include/exclude glob path filtering
- `.aiignore` negation patterns: `!pattern` overrides excludes (gitignore-style)
- ESLint (`npm run lint:eslint`) — 0 warnings, included in `npm run check`
- Calibration CI: self-hosted runner, continue-on-error, 10min timeout. Was silently failing on
  every run for at least a month (missing `shell: bash`, same class of bug as review.yml's
  earlier fix below) until 2026-08-03 — see progress.md's matching entry.
- **427 unit tests** across 42 test files
- `SecretsAgent`/`DependenciesAgent` use gitleaks/`npm audit` directly when available, skipping the
  LLM entirely; `ReviewResult.toolAvailability` surfaces degraded-mode fallback (markdown + SARIF)
- `src/core/parsing.ts`: `validateAndNormalizeFindings()` extracted from BaseAgent (SRP)
- `vscode-extension/src/runner.ts`: 5-minute wall-clock subprocess timeout
- `src/core/contextLoader.ts`: emits stderr warning when `nomic-embed-text` unavailable
- **GitHub repo**: https://github.com/unyieldingclaw-dev/ai-code-review-agent
- **npm**: `ai-review-agent@1.2.0`

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

## Next Steps

- **NPM token renewal**: `github-actions-publish` token expires Sep 8 2026 — create new Automation token on npmjs.com and update `NPM_TOKEN` GitHub Actions secret before then.
- **Version 1.2.0**: Ready to publish. Run `git tag v1.2.0 && git push --tags` to trigger npm release.
- **Anthropic/Claude provider** (backlog): Alternative to Ollama using `claude-sonnet-4-6` via API.
- **Marketplace publish** (VS Code extension): Explicitly DEFERRED.

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

## Environment Status

**Infrastructure**: Ollama must be running on port 11434 for integration tests and calibration (not required for unit tests)

**Git**: `main` branch, pushed to remote

## Key Commands

```bash
npm test                    # all unit tests (297 passing)
npm run typecheck           # 0 errors
npm run build               # compile to dist/
node dist/cli/index.js --help   # smoke test CLI
```

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
