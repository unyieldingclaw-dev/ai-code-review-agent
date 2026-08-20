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

**Last Updated**: 2026-08-18

> Older completed work lives in [`archive/progress-history.md`](archive/progress-history.md).

## ✅ Completed (2026-08-18)

### Audit remediation Batches 1-8 — Tier 1/2 fixes verified, implemented, tested, and committed

Every finding from the 15-phase audit below was re-verified against current source (not taken on
faith) before being fixed, per user instruction. 8 batches covering: severity/basis/blocking enum
validation and normalization fix (`parsing.ts`); `--agents`/`--fail-on` CLI validation plus a new
`STARTUP_FAILURE_EXIT_CODE` (4) distinguishing "tool couldn't run" from "found a blocker" (exit 1);
MCP and SARIF output now surface `agentStatus`/`truncation` failure state instead of looking
identical to a clean pass; `DETERMINISTIC_SOURCES` narrowed from 8 values to the 2 actually
code-set (`gitleaks`, `npm-audit`), closing a self-tagged source-spoofing gap in the
hallucination-corroboration safety net; `dependencies`/`license` agents now skip consistently on
non-manifest diffs; PowerShell tool wired into the commit/push review-gate hook matcher, plus new
TRUNCATE TABLE / unscoped DELETE FROM guardrails and CI silent-failure fixes in `review.yml`/
`calibrate.yml`; pre-push secret-scan pattern hardening (PEM, Bearer, JSON-style, AWS, GitHub PAT)
plus a fix for a newly-discovered pre-existing bug (`git log --not --remotes` silently no-opping
with zero remotes configured); stale-docs cleanup (README, HOOKS-GUIDE.md, and
SECURITY-GUARDRAILS.md's DROP TABLE/DATABASE tier misclassification — documented as needing
confirmation, actually implemented as an outright block). Deleted `orchestratorAgent.test.ts`
(confirmed redundant against `orchestrator.test.ts`). Regression: 575/575 unit tests, 33/33 Pester
tests, typecheck, build, format, and lint all pass. Full `/change-review` gate run before commit (2
non-blocking Low/Info notes). Tier 3 items (sanitizer overhaul, chunking redesign, vscode-extension
catch-up, Ollama concurrency handling) explicitly deferred as large, speculative redesigns.

**Shipped**: squashed local WIP commits into one clean commit (`e9312f5`, after splitting 4 fake-
secret Pester test fixtures via string concatenation so pushing the test file didn't self-trigger
the scanner it tests) → PR #29 → merged to `main`. Version bump PR #30 (`1.10.0` → `1.11.0`,
CHANGELOG finalized, README synced) → merged to `main`. Tagged `v1.11.0`, published to npm —
confirmed live (`npm view ai-review-agent version` → `1.11.0`).

### Follow-up reported by user (separate session) — deterministic false-positive filter shipped

Started as: `adversarial` agent flags parameterized Postgres function calls in RLS policies (e.g.
`is_group_member(visits.group_id)`) as SQL injection with no dynamic SQL construction anywhere in
the chain. Investigating turned up a much broader problem, measured live against Ollama rather than
guessed: `security` (4/5), `correctness` (3/5), `adversarial` (1/5), and `error-handling` (1/5) all
fabricate injection or swallowed-exception findings against this same clean fixture. Two rounds of
increasingly explicit prompt rules were applied to all five agents' prompts and re-measured; the
rate didn't drop, it changed shape — once "gid isn't parameterized" was explicitly ruled out, the
model invented a new rationalization (claiming `auth.uid()` itself was attacker-controlled),
leaving `security` at 5/8 and `error-handling` at 3/6 after both rounds. Diagnosed as a
confabulation prior (decide a finding is warranted, then justify it post-hoc), not a missing
instruction — matches this project's own prior experience with `hasCredentialShapedValue` in
`secrets.ts` (prompt-only fix measured 5/10 before, 5/10 after).

**Fixed** with a deterministic post-filter, same pattern as `hasCredentialShapedValue`:
`filterUnsupportedClaims` in `orchestrator.ts` (new module `src/core/claimSupport.ts`) drops an
injection/swallowed-exception claim when the finding's own file section (sliced from the diff via
the existing `splitByFileBoundary`) contains no syntax capable of producing that mechanism —
checkable by the definition of the vulnerability class. Scoped per-file, not whole-diff (whole-diff
would almost never fire on real multi-file TypeScript diffs). IDOR is explicitly out of scope (no
syntax whose absence disproves an authorization gap) and stays covered by the prompt rules plus
`--verify-evidence`. `synthesize()` gained an optional 4th `diffText` param; `runner.ts` and
`calibrate.ts` both updated to pass it through.

Live-reverified after the fix (not just unit-tested): `security` and `error-handling` both went
from 2/8 raw misfires to **0/8 surviving** on the clean fixture; `correctness`/`adversarial` stayed
at 0/8. A genuine-injection counter-test fixture (`sql-injection-vulnerable.diff`, `EXECUTE` +
string concatenation) confirmed no over-suppression — across 3 trials each, all 11 injection
findings produced survived (11/11) across
all four agents. Wired into `calibration/calibrate.ts` as `security-sql-clean`
(`expectNoInjectionOrExceptionClaims` — not `expectEmpty`, which would be flaky because the
security agent also emits out-of-scope IDOR claims on this fixture) and
`security-sql-vulnerable` (must find injection, must not blame `auth.uid()`). Kept the five prompt
fixes already applied — they measurably helped `adversarial` (20%→0%) and `correctness`; the filter
is the backstop for what wording alone couldn't close, not a replacement.

The user's earlier retest (this session's timeout/truncation fix) still holds: 292s-with-timeout →
34s clean, zero truncation.

### Follow-up round 2 (2026-08-19): license hallucination + adversarial NULL + command-injection gaps

Three further issues found and fixed after the deterministic filter landed, all measured live:

1. **`license` agent fabricates license identity** — 6/10 on a lodash fixture, asserting LGPL-3.0
   with `basis=VERIFIED` for a famously MIT package; one trial named MIT correctly and still filed
   a high-severity finding. Root cause: the prompt told the model to recall the license from
   training knowledge. Fixed with `src/core/licenseFacts.ts`, resolving every added dependency
   against the reviewed project's `package-lock.json`/`node_modules` and dropping contradicted
   findings. **Contradiction-only, fails open on unresolvable packages** — required, because the
   positive fixture's `node-lame` is deliberately not a dependency here, so a "require
   corroboration" rule would have destroyed real detection. Verified 6/10 → 0/8 clean, 5/5 positive.
   `license-clean.diff` now uses `commander` (a real dependency, so actually resolvable) instead of
   `lodash`, making the case test the mechanism rather than model recall.

2. **`adversarial` NULL-semantics hallucination** — 6/10 claiming a NULL uuid raises an error in a
   `language sql` function (it does not; NULL comparison filters the row). A prompt fix stating the
   correct Postgres semantics made it **worse (6/10 → 9/10)** — the model absorbed the fact and
   re-framed the complaint as "returns false, which might not be intended." That is a **third
   independent confirmation of the confabulation-prior diagnosis**, so the prompt change was
   reverted. Fixed instead with a deterministic check, restricted to `.sql` files (in an imperative
   language a null deref raises with no keyword present, so the same check there would either never
   fire or cause false negatives). Result: any-findings 7/10 → 4/10.

   **Residual re-measured 2026-08-19 (10 trials, post-`synthesize`): 5/10, and deliberately left
   there.** Every survivor reports `nullClaim=false` — the mechanism filter is working as designed
   and these fall in the class it intentionally excludes. Breakdown of the 6 surviving findings:
   4 are _contentless_ (detail restates the title, asserting no consequence at all — e.g. "Passing
   NULL as the gid parameter to the is_group_member function"); 1 is factually false but in a
   different shape ("will return NULL, not a boolean" — SQL `EXISTS` is a predicate, it returns
   FALSE); 1 is a vague intent judgment ("will not work as intended" — it returns false, denying
   access, which is fail-closed and arguably correct).

   **Why this was not broadened**, evaluated and rejected explicitly:
   - Dropping any null-ish claim in a SQL file lacking a raise-capable construct would take the
     residual near zero but also drops legitimate findings — "the LEFT JOIN produces NULLs that
     break this aggregate", "missing COALESCE lets NULL propagate into the sum". Neither contains
     a raise construct; both are real. That trades a low-harm false positive for a false negative.
   - Filtering the contentless class on empty `impact` was checked against real output and is
     **not viable**: `impact` is empty on most findings regardless of quality (all 6 security
     trials, most adversarial ones), so it is not a defect signal. The alternative — detecting
     "detail asserts no consequence" — is regex-approximated NLP and would hit terse real findings.
   - Harm asymmetry: unlike the license (legal FUD) and injection (security misdirection) cases,
     this residual asserts nothing actionable enough to send anyone toward a wrong fix. It is
     noise, not misdirection, and does not justify spending false-negative risk.
   - Scope: 5/10 is measured against one synthetic fixture. That does not establish the shape is
     common on real diffs; broadening on it would institutionalize a test-case artifact.

   **What would change this**: seeing the contentless shape at similar rates on a real-world diff
   corpus. Revisit with corpus data, not with more trials against this fixture.

3. **Cross-language injection corpus validation (2026-08-19)** — the counter-test fixture proved
   the filter's _mechanism_ but not its _coverage_, so a corpus of real injections across
   Python/JS/TS/Java/PHP/Ruby/Go/C#/shell/Perl/C/plpgsql/T-SQL/Rust/Kotlin/Scala/Groovy was run
   directly against `hasDynamicConstruction` (no LLM needed — this tests the evidence patterns, so
   it is a fast unit-level check now locked in as a regression test in `claimSupport.test.ts`).

   **Two real false negatives found and fixed** — both would have silently dropped a genuine
   vulnerability finding, the dangerous direction:
   - **C# interpolated strings** (`$"SELECT ... {id}"`) — `\$\w` requires a word character after
     `$`, but C# puts a quote there. Fixed by adding a `\$["'`]` alternative.
   - **Rust `format!(...)`** — `format\s*\(` missed the `!`. Fixed with `format!?\s*\(`.

   Result at the time: **37/37 detected** after the fix (was 35/37). The corpus committed as a
   regression test has since grown to **39 samples, all passing** — the committed test is the
   reproducible artifact; 37 is the historical run that surfaced the two false negatives.

   **Three known fail-open inertness sources**, found by the same corpus run and deliberately NOT
   tightened. Each makes the filter stop firing on a class of file (so real findings are kept —
   safe), but none can cause a wrong drop:
   - `execute` (intended for SQL's `EXECUTE` statement) also matches Python/JS `.execute(`,
     the _safe_ parameterized DB API. Effect: the filter is inert on most Python/JS database code.
   - `\$\w` matches Postgres named dollar-quote tags (`$BODY$`, `$function$`).
   - `\$\w` matches positional bind parameters (`$1`), which are the safe construct.

   Tightening any of these (e.g. `(?<!\.)execute`) would increase reach, but it _expands
   drop behavior_ over a large class of real code, which is exactly the change that needs its own
   measurement first rather than being reasoned about. Not done here on purpose.

4. **Independent audit of the fixes above (2026-08-19)** — a `/code-review` opponent pass caught
   that two of the first-round fixes were themselves wrong. Both were live false negatives:

   - `RAISES` contained `fail(s|ed|ure)?`. "A complete **failure** of tenant isolation" is ordinary
     security prose, not a raise claim; paired with the cross-sentence window it dropped real RLS
     findings against a `using (true)` policy — a world-readable table silently removed from the
     report. Removing that one alternative measured 5/12 wrong → 0/12; genuinely fabricated raise
     claims still match, because they always name an explicit verb (error/throw/raise/crash).
   - The non-string-building injection exclusion was matched unanchored against title+detail, so
     bare nouns (`html`, `dom`, `headers`, `mongo`, `deserializ`) made any finding mentioning them
     unfilterable — 4 of 5 fabricated SQLi findings escaped. Now requires an injection **class**
     term (`xss`, `nosql`, `header injection`, `crlf`, `prototype pollution`, …), not a bare noun.
   - `extractAddedDependencies` matched any `"key": "value"` line, so a `"version"` bump alongside
     a real dependency made the whole license backstop fail open — it fired almost never in
     practice, since version bumps accompany most dependency changes. Now skips known manifest
     scalar keys and requires a semver-shaped value.

   **FIXED in the post-review round (2026-08-19)** — four of the five limitations recorded above:

   - `splitByFileBoundary` moved to a new dependency-free `diffSplit.ts`; `claimSupport` no longer
     imports the orchestration wrapper, so the inverted direction (and the latent
     `cli → runner → orchestrator → claimSupport → chunkRunner → runner` cycle a value import would
     have created) is gone. `chunkRunner` re-exports it so its existing contract tests still apply.
   - `orchestrator.ts`'s parallel `reason`-assign and `reason`→text chains collapsed into a single
     `CLAIM_RULES` table, so a new claim class is one array entry and the two can no longer drift.
   - `chunkRunner` now merges `hallucinationFilter` across all chunks instead of last-chunk-wins.
   - `normalizeLicenseField` joins an array-form `license` with `AND`, not `OR`, so
     `["GPL-3.0","MIT"]` no longer resolves permissive. Regression-tested.

   Also fixed in the same round: all 14 `npm audit` vulnerabilities (5 in production dependencies,
   via `@modelcontextprotocol/sdk` — two high-severity), which required a **vitest 2 → 4** major
   upgrade and migrating 34 constructible mock factories to `function` form; the formatter's
   grouped-by-reason output gained real assertions (the prior test passed even when the text was
   wrong); and `licenseCompliance` no longer parses the lockfile when there are no findings.

   **STILL OPEN — calibration cases coupled to this repo's own state:**

   - `license-clean` calibration resolves `commander` from **this repo's** lockfile, so the case
     proves the filter reads ACR's own metadata rather than a reviewed project's. Real usage is
     unaffected (`--dir` resolves correctly); it is the calibration signal that is weaker than it
     looks. Fixing it properly needs a fixture whose package resolves in an arbitrary project under
     review, which the current single-repo calibration harness cannot express.
   - `dependencies` had the **same defect, and fixing the CVEs exposed it**: the case asserted
     against real `npm audit` output of this repo, so it was only ever green because the repo
     happened to be vulnerable. Bringing `npm audit` to 0 broke it. Converted to `expectEmpty`
     (which still guards the original hallucination bug — an LLM fallback echoing the prompt's old
     "lodash wildcard" example), but **positive-detection coverage for the npm-audit path is lost**
     until the harness supports a per-case `projectPath` pointing at a fixture project with its own
     vulnerable lockfile.

   Both are the same root cause: a calibration case whose expectation depends on the reviewed
   repo's incidental state rather than on the fixture. Worth auditing the remaining cases for it.

5. **Command-injection filter gaps** (from a live PMB run against a 14,872-line diff):
   - Bare `||` was read as SQL concatenation, but it is logical OR in shell/JS/YAML, so static
     hardcoded command lines looked dynamic and fabricated findings survived. Now requires `||` to
     abut a string literal.
   - **False negative on a real vulnerability**: shell interpolation has no `${...}`, so
     `script.sh "$USER_INPUT"` read as having no dynamic construction and a genuine
     command-injection finding would have been dropped. `$VAR`/`$(...)`/backticks now count.

**Not bugs, verified rather than assumed** — reported as suspected issues in the same brief:

- The "missing adversarial finding" and "swapped severity counts" were correct orchestrator
  behavior (dedup merge + uncorroborated-severity downgrade), invisible only because
  `corroboratingAgents` was never rendered and progress lines show pre-synthesis counts. Both are
  now surfaced rather than changed.
- The truncation exit-code taxonomy the brief asked for **already exists**: 0 clean / 1 blocker /
  2 agent failure / 3 truncated-but-complete / 4 startup failure, plus `--chunk` for full coverage
  and `--allow-truncation` to opt back into 0. The reported exit 1 was correct — a blocking finding
  outranks truncation by design, so a real blocker is never masked by "the run was also
  incomplete." Open design question, NOT changed: whether `--max-lines` should default higher for
  the security profile (profiles currently select agents only, not limits).

## 📊 Metrics

### Test Coverage

- **Unit Tests**: 295 passing across 37 test files (run `npm test` for current count)
- **Integration Tests**: 1 file, 5 tests — skip without INTEGRATION=1, run with live Ollama
- **Total**: 295

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
