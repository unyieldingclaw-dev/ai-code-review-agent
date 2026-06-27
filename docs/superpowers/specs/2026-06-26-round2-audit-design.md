# Round 2 Pre-Production Readiness Audit — Design Spec

**Date:** 2026-06-26
**Status:** Approved
**Approach:** A — Regression + Discovery
**Scope:** Personal-Memory-Bank (PMB v1.2.0+) + AI-Code-Review-Agent (ACR v1.1.0+)
**Baseline:** Round 1 audit (2026-06-24) — 48 findings, most remediated in one sprint

---

## Mission

Verify that Round 1 fixes held under 20+ subsequent commits. Find new issues in areas Round 1 skimmed or skipped entirely. Do not soften criticism. Assume nothing works until verified empirically.

---

## Architecture

Six domain agents run in parallel. One consolidation agent runs after all six complete.

```
┌───────────────────────────────────────────────────────────────────┐
│                      PARALLEL (Agents 1–6)                        │
│  Agent 1: Round 1 Fix Verification (Regression Inspector)         │
│  Agent 2: PMB Test Suite & CI Audit                               │
│  Agent 3: MCP Server & vscode-extension Deep Dive                 │
│  Agent 4: BaseAgent Architecture & contextLoader Semantic Path     │
│  Agent 5: New Security & Reliability Surface                      │
│  Agent 6: Ecosystem Drift & Documentation Accuracy Post-Fixes     │
└───────────────────────────────────┬───────────────────────────────┘
                                    │ all findings
                                    ▼
                       Agent 7: Consolidation
                       → 20-section report (labels [REGRESSION] vs [NEW])
```

---

## Finding Format

Every finding MUST use this exact format:

```markdown
### Finding: [Short imperative title]

- **Tag:** [REGRESSION] | [NEW]
- **Severity:** Critical | High | Medium | Low | Advisory
- **Confidence:** Verified | Strong Evidence | Likely | Speculative
- **Repository:** PMB | ACR | Both
- **Evidence:** [file path:line or exact command output]
- **Reproduction:** [exact steps]
- **Root Cause:** [why]
- **Fix:** [specific, actionable]
- **Impact:** [what improves]
- **Effort:** XS | S | M | L | XL
```

Null result: `> [CHECK NAME]: No finding — [what was observed].`

---

## Agent Definitions

### Agent 1 — Round 1 Fix Verification (Regression Inspector)

**Repositories:** Both.

**Empirical tasks:**

1. Run `npm run check` — document every Prettier-violating file (known to fail with 14 files at audit start)
2. OllamaProvider URL validation: test `new OllamaProvider('http://192.168.1.1:11434', 'devstral')`, `new OllamaProvider('https://example.com', 'devstral')`, `new OllamaProvider('http://0.0.0.0:11434', 'devstral')`, `new OllamaProvider('http://[::1]:11434', 'devstral')`, `new OllamaProvider('ollama://localhost', 'devstral')` — which throw vs pass?
3. CLI re-throw guard: read `src/cli/index.ts` catch block — does `err.message.startsWith('process.exit(')` re-throw reliably for `process.exit(0)` and `process.exit(1)` spy errors?
4. matchPattern export: check `src/core/policyFilter.ts` imports — is there a circular dependency? Run `npm run typecheck`.
5. `check-contract.sh` four cases: read the script and verify the Python handles `[{file, op}]`, `{files: []}`, `[]`, and malformed JSON distinctly.
6. `check-contract.ps1` same four cases: verify the PowerShell handles the same schema variants.
7. `CONTRACTS-GUIDE.md` accuracy: compare documented schema against actual `active-task.json` in both repos.
8. `HOOKS-GUIDE.md` PreCompact claim: the doc says "exits 2 — compaction is blocked." Read `scripts/pre-compact-check.sh` — does the hook actually exit 2 on failure? Read `scripts/pre-compact-check.ps1` — same check.
9. `/change-review` Job 7 `--diff` fix: read ACR's CLI `--help` output — is `--diff <path>` a real flag? Read `src/cli/index.ts` to confirm the flag is wired.
10. `--no-sanitize` warning: read `src/core/runner.ts` `preprocessDiff` — does it call `process.stderr.write` or `console.warn`? Which is captured by CI stdout redirect?
11. gitleaks action pin: read `.github/workflows/release.yml` — is `gitleaks/gitleaks-action@v2` pinned to a commit SHA or a mutable tag?
12. vscode-extension CI: read `release.yml` — does `npm run test:extension` require a display server? Check `vscode-extension/package.json` test script.
13. Runner decomposition regression: run `npm test` and record exact test count; verify equals or exceeds 284.
14. `/code-review.md` cloud disclosure: read the file — is the disclosure in the `description:` frontmatter field (where Claude reads it at invocation) or only in a comment block?

**Output:** `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\docs\audit\staging\r2-agent-1-regression.md`

---

### Agent 2 — PMB Test Suite & CI Audit

**Repository:** PMB.

**Empirical tasks:**

1. Run `bash tests/run.sh` from PMB root — does it complete without errors on Windows Git Bash?
2. Check test isolation: read `tests/helpers/` — do tests use temp directories or mutate the real repo?
3. Read `test-mb-doctor.sh` — does it test all 24 checks, or skip some? Verify the check count matches `mb doctor`'s actual output.
4. Read `test-mb-plan.sh` — does `mb plan promote` actually move a file, or just print a message?
5. Read `test-mb-preflight.sh` and `test-mb-change-check.sh` — are these new commands tested end-to-end or just invoked and checked for exit code?
6. Read `.github/workflows/pmb-health.yml` — does the `mb-command-tests` job run `bash tests/run.sh`? Does it run on Windows or Linux runner?
7. Read `.github/workflows/pmb-health.yml` — the `mb-doctor-self-check` job: does it install `mb` as a command or just source the script? Would it catch a broken `mb` binary?
8. Read `.github/workflows/` `powershell-lint` job: does PSScriptAnalyzer run with `-Severity Error` only, or does it also check Warning/Information? What PSScriptAnalyzer rules are enabled?
9. Doctor performance optimization: read `scripts/mb.sh` checks 22–23 — does the pre-caching actually run before the loop, or is it still O(n²)?
10. Check PMB test coverage gaps: list all `mb` subcommands from `mb.sh` and compare to test files in `tests/`. Any subcommands with no test?

**Output:** `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\docs\audit\staging\r2-agent-2-pmb-tests.md`

---

### Agent 3 — MCP Server & vscode-extension Deep Dive

**Repository:** ACR.

**Empirical tasks:**

1. Read `src/mcp/server.ts` — what happens if stdin closes unexpectedly mid-review? Is there a shutdown handler?
2. Read `src/mcp/tool.ts` — what does it do when `diff` argument is empty string? Null? Does it call `process.exit` or return an error response?
3. Read `src/mcp/formatter.ts` — does it produce a valid MCP `CallToolResult` schema? Check the `content` array structure.
4. Run `npm pack --dry-run` — is `ai-review-mcp` binary (`dist/mcp/server.js`) included in the package?
5. Read `vscode-extension/src/runner.ts` — does it set a timeout on the `ai-review-agent` subprocess? What happens if the process hangs for 10 minutes?
6. Read `vscode-extension/src/diagnostics.ts` — does it call `diagnosticCollection.clear()` before setting new diagnostics? Or do stale squiggles accumulate across runs?
7. Read `vscode-extension/tests/runner.test.ts` — does it mock the subprocess, or does it spawn a real `ai-review-agent`?
8. Run `npm run test:extension` from repo root — does it pass, fail, or hang?
9. Read `vscode-extension/package.json` `test` script — does it require `@vscode/test-electron` which needs a display? Will it work headlessly in CI?
10. Read the release.yml vscode-extension test step added in Round 1 — is there a `xvfb-run` wrapper or `DISPLAY` env var set for headless execution?

**Output:** `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\docs\audit\staging\r2-agent-3-mcp-extension.md`

---

### Agent 4 — BaseAgent Architecture & contextLoader Semantic Path

**Repository:** ACR.

**Empirical tasks:**

1. Read `src/core/agents/base.ts` in full — list every distinct responsibility (prompt construction, HTTP call, think-tag strip, 3-stage parse, balanced-bracket extraction, schema validation, field aliasing, confidence clamping, ID stamping, blocking default). Count them.
2. 3-stage JSON parse: what happens if stage 1 fails but stage 2 succeeds? Are stage-2 findings validated? Is there a stage ordering guarantee?
3. `validateFindings()`: does it drop findings with unknown extra fields silently? What is the exact validation logic — required-field check only, or type check too?
4. Field aliasing: `basis → evidence`, `detail → description`, `suggestion → recommendation` — if a finding has both `basis` and `evidence`, which wins?
5. Confidence clamping: read the clamp logic — what is the behavior for `confidence: -1`, `confidence: 200`, `confidence: "high"` (string instead of number)?
6. Read `src/core/contextLoader.ts` in full — does `loadAgentContextSemantic()` actually call the Ollama `/api/embeddings` endpoint? Or does it fall back to keyword selection?
7. `embed()` function: what happens if `nomic-embed-text` isn't in Ollama? Does it throw, return null, or degrade silently?
8. `cosineSimilarity()`: verify implementation is mathematically correct — numerator is dot product, denominator is product of L2 norms. Test edge: zero vector (division by zero risk).
9. Context budget enforcement: what happens when a single memory-bank file exceeds `contextBudgetChars`? Is it truncated mid-sentence or excluded entirely?
10. Read `tests/unit/contextLoader.test.ts` — does it test the semantic path at all, or only the static keyword path?

**Output:** `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\docs\audit\staging\r2-agent-4-baseagent-context.md`

---

### Agent 5 — New Security & Reliability Surface

**Repositories:** Both.

**Empirical tasks:**

1. OllamaProvider URL validation bypass: test `new URL('http://localhost@evil.com:11434')` — what does `.hostname` return? Does it return `evil.com` (bypass) or `localhost`?
2. Test `new URL('http://127.0.0.1.evil.com:11434').hostname` — does it return `127.0.0.1.evil.com` (should fail) or `127.0.0.1` (bypass)?
3. Test `new URL('ollama://localhost:11434')` — does the `URL` constructor throw? What's the catch behavior in OllamaProvider constructor?
4. CLI re-throw guard robustness: what if a real dependency throws an error with message `process.exit(something)` embedded in a stack trace? Would the catch incorrectly re-throw a real error?
5. `--no-sanitize` in CI: the warning uses `process.stderr.write` — in a CI pipeline that captures only stdout (`ai-review-agent --no-sanitize > output.txt`), is the warning visible or silently discarded?
6. gitleaks supply chain: read `release.yml` — is `gitleaks/gitleaks-action@v2` a mutable floating tag? If gitleaks-action is compromised, it runs with `GITHUB_TOKEN` in scope.
7. vscode-extension headless CI hang: `npm run test:extension` — if it requires a display server and CI doesn't provide one, does it exit non-zero (safe) or hang indefinitely (blocks release pipeline)?
8. `check-contract.ps1` edge case: `scope` as `$null` (contract has no scope field) — what does `$rawScope -is [System.Array]` return for `$null`? Would the scope check be skipped?
9. `preprocessDiff` order of operations: read the refactored method — is sanitization applied BEFORE or AFTER truncation? If after, a 2001-line diff gets truncated first, potentially cutting the injected content at the truncation boundary and bypassing sanitization.
10. PMB `dangerous-commands.sh` WARN tier: `.pem` files trigger WARN (exit 0, surface alert). Now that `*.pem` is in `.gitignore`, is reading a `.pem` file still a meaningfully dangerous operation, or is this guardrail now redundant noise?

**Output:** `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\docs\audit\staging\r2-agent-5-security-reliability.md`

---

### Agent 6 — Ecosystem Drift & Documentation Accuracy Post-Fixes

**Repositories:** Both.

**Empirical tasks:**

1. ACR `memory-bank/activeContext.md`: read it — does "Current Focus" reflect the Round 1 audit remediation sprint? Is `last-reviewed` within the 14d staleness threshold (audit date: 2026-06-26)?
2. ACR `memory-bank/progress.md`: does the Metrics section now say 284 tests? Does the Version History table include entries for v1.1.0 and the remediation commits?
3. PMB `memory-bank/activeContext.md`: same staleness check.
4. ACR `CHANGELOG.md`: does it have entries for the Round 1 fix commits? Does it describe the OllamaProvider URL validation, CLI try/catch, runner decomposition?
5. ACR `CLAUDE.md` references: `docs/CONTRACTS-GUIDE.md` — does the file exist? `docs/HOOKS-GUIDE.md` — does the file exist? Both should now exist after Round 1 fixes.
6. `CONTRACTS-GUIDE.md` vs `check-contract.sh` after fix: the guide documents `scope` as `[{file, op}]`. The script now handles both formats. Does the guide document the dual-format support, or does it imply one canonical schema?
7. `HOOKS-GUIDE.md` vs actual `pre-compact-check` behavior: the guide says PreCompact "exits 2 — compaction is blocked." Verify this is true by reading the script. The Round 1 audit flagged "warns" in CLAUDE.md — was that fixed?
8. PMB new CI jobs: read `pmb-health.yml` and check if these jobs are mentioned in `README.md` or `HOOKS-GUIDE.md`. A contributor would not know CI exists unless it's documented.
9. PMB `mb doctor` Check 24 (plan hygiene): verify it's documented — in `README.md`, `HOOKS-GUIDE.md`, or somewhere a user would find it. Was it added to the check count in the README badge?
10. New PMB commands (`mb preflight`, `mb change-check`): are they in the README command table? Are they in `mb help`?

**Output:** `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\docs\audit\staging\r2-agent-6-drift-docs.md`

---

### Agent 7 — Consolidation

Reads all 6 staging files. Deduplicates by root cause. Labels every finding `[REGRESSION]` or `[NEW]`. Produces:

- §3.1 "Round 1 Regression Summary" — table of every Round 1 fix that degraded
- Full 20-section report at `docs/audit/2026-06-26-round2-audit-report.md`
- Commits

---

## Report Structure (20 sections, same as Round 1)

1. Executive Summary
2. Overall Readiness Assessment
3. Critical Issues — §3.1 Round 1 Regression Summary (new sub-section)
4. High Priority Issues
5. Medium Priority Issues
6. Low Priority Issues
7. Missing Features
8. Missing Guardrails
9. Incorrect Guardrails
10. Security Concerns
11. Reliability Concerns
12. Performance Concerns
13. Documentation Issues
14. Developer Experience Issues
15. Integration Problems
16. Architecture Critique
17. Technical Debt
18. Quick Wins
19. Long-Term Recommendations
20. Production Readiness Verdict

---

## Confidence Definitions

| Label           | Meaning                                    |
| --------------- | ------------------------------------------ |
| Verified        | Command run, output seen, defect confirmed |
| Strong Evidence | Code read; behavior clearly implied        |
| Likely          | Pattern match; not directly tested         |
| Speculative     | Reasonable inference; unverified           |

---

## Execution Constraints

- Ollama not confirmed running — Ollama-live tests labeled Speculative/Likely
- GitHub Actions cannot be triggered — CI analysis is Strong Evidence from code read
- Cross-platform (Linux/macOS) behavior unverifiable on Windows — labeled accordingly

---

## Repositories

- **PMB:** `C:\Users\Mizzo\Claude\Personal-Memory-Bank`
- **ACR:** `C:\Users\Mizzo\Claude\AI-Code-Review-Agent` (v1.1.0, 284 tests)

---

## Known Round 1 Fixes Being Verified (Agent 1 Seed)

| Fix                           | What to verify                                                 |
| ----------------------------- | -------------------------------------------------------------- |
| npm run check                 | Fixed for plan file; 14 new violations from subsequent commits |
| OllamaProvider URL validation | Localhost check behavior; edge cases                           |
| CLI try/catch                 | Re-throw guard correctness                                     |
| matchPattern export           | No circular deps                                               |
| check-contract scope fix      | Both schema formats handled                                    |
| CONTRACTS-GUIDE.md            | Matches actual contract JSON                                   |
| HOOKS-GUIDE.md                | PreCompact exits 2 claim is accurate                           |
| /change-review --diff fix     | `--diff` flag actually exists in CLI                           |
| --no-sanitize warning         | Reaches CI stderr                                              |
| gitleaks in release.yml       | Action is pinned                                               |
| vscode-extension tests in CI  | Works headlessly                                               |
| runner.ts decomposition       | No regressions                                                 |
| /code-review cloud disclosure | Visible to Claude at invocation                                |
