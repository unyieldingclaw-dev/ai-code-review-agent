# Round 3 Pre-Production Readiness Audit — Design Spec

**Date:** 2026-06-26
**Status:** Approved
**Approach:** Hybrid — Regression Verification + Deferred Item Closure
**Scope:** Personal-Memory-Bank (PMB) + AI-Code-Review-Agent (ACR v1.1.0+)
**Baseline:** Round 2 audit (2026-06-26) — 37 findings, all remediated except 5 deferred items

---

## Mission

Close the 5 high-priority items deferred from Round 2. Verify all Round 2 fixes held. Produce a short
confirmation report. This is the "closing the books" round — not a broad discovery sweep.

---

## Key Difference from Rounds 1 and 2

Fix agents in Phase 2 **write working code and commit**. The report confirms fixes landed and regressions
are zero. Finding tags are `[REGRESSION]`, `[FIXED]` (deferred item now closed), and `[NEW]`.

---

## Architecture

```
Phase 1 — PARALLEL (no shared state)
┌──────────────────────────────────────────────────────┐
│  Agent 1: Regression Inspector (read-only, both repos) │
│  Agent 2: PMB Deep Fixes (writes to PMB only)          │
└─────────────────────────┬────────────────────────────┘
                          │ both complete
                          ▼
Phase 2 — SEQUENTIAL ACR fixes (one at a time — same repo)
  Agent 3: BaseAgent SRP Refactor
  Agent 4: Semantic Context Tests
  Agent 5: vscode-extension Subprocess Timeout

                          │ all committed
                          ▼
Phase 3
  Agent 6: Verification + Round 3 Report
```

---

## Finding Format

```markdown
### Finding: [Short imperative title]

- **Tag:** [REGRESSION] | [FIXED] | [NEW]
- **Severity:** Critical | High | Medium | Low | Advisory
- **Confidence:** Verified | Strong Evidence | Likely | Speculative
- **Repository:** PMB | ACR | Both
- **Evidence:** [file path:line or exact output]
- **Reproduction:** [steps]
- **Root Cause:** [why]
- **Fix:** [specific, actionable] (or "Fixed in this round — see commit <SHA>")
- **Impact:** [what improves]
- **Effort:** XS | S | M | L | XL
```

Tag definitions:

- `[REGRESSION]` — A Round 2 fix degraded after subsequent commits
- `[FIXED]` — A previously deferred item closed in this round
- `[NEW]` — Net-new issue not seen in prior rounds

---

## Phase 1 Agents (run in parallel)

### Agent 1 — Regression Inspector

**Repository:** Both (read-only).

**Verifies these Round 2 fixes:**

1. `npm run check` passes clean — no new Prettier violations
2. OllamaProvider: `0.0.0.0` removed from allowlist; scheme check active; try/catch wraps `new URL()`
3. `base.ts` `validateFindings`: accepts `evidence` OR `basis`; logs dropped items
4. MCP server: SIGTERM/SIGINT/stdin.close handlers present in `src/mcp/server.ts`
5. `release.yml`: gitleaks pinned to SHA (not `@v2`); extension test has `timeout-minutes: 5`
6. `dependabot.yml` present in `.github/`
7. PMB `check-contract.sh`: empty `[]` scope guard present (early-exit before loop)
8. PMB `check-contract.ps1`: null/empty scope guard present (early-exit before foreach)
9. PMB `pmb-health.yml`: PSScriptAnalyzer uses `-Severity Error,Warning`
10. HOOKS-GUIDE.md: PreCompact section says "warns" not "blocks"
11. CONTRACTS-GUIDE.md: has "Scope Format Compatibility" section
12. Run `npm test` — count must be ≥284
13. Run PMB `bash tests/run.sh` — must exit 0

**Output:** `docs/audit/staging/r3-agent-1-regression.md`

---

### Agent 2 — PMB Deep Fixes

**Repository:** PMB only. This agent **writes code and commits**.

**Fix 1: test-mb-doctor.sh repo mutation (High)**

Problem: `test-mb-doctor.sh` renames real directories in the PMB repo during tests. A crash mid-test leaves the repo in a broken state.

Fix: For each check that currently renames `$REPO_ROOT/X`, change it to:

1. Create a temp directory (`TMPDIR=$(mktemp -d)`)
2. Copy the asset to the temp directory
3. Run the check against the temp path
4. Clean up the temp directory (on EXIT via `trap`)

The test setup/teardown should never touch the real repo. Verify with `git status` after the test run — should be clean.

**Fix 2: Doctor check 5 permanently SKIP'd (Medium)**

Problem: In `scripts/mb.sh`, the Token Budget drift check uses `grep -c` which exits with code 1 when no matches are found. In Git Bash, this causes the `|| echo 0` fallback to fire and produce `"0\n0"` in the variable, breaking the arithmetic comparison `[ -eq 0 ]`.

Fix: Replace `grep -c PATTERN file` with `grep -c PATTERN file || true` (or use `grep PATTERN file | wc -l | tr -d ' '`) to always exit 0 regardless of match count.

After fix, run `bash tests/run.sh` — check 5 must show `[OK]` not `[SKIP]`.

**Commit to PMB.**

**Output:** `docs/audit/staging/r3-agent-2-pmb-fixes.md`

---

## Phase 2 Agents (sequential — ACR repo, one at a time)

### Agent 3 — BaseAgent SRP Refactor

**Repository:** ACR. **Writes code and commits.**

**Problem:** `BaseAgent.validateFindings()` carries 10 distinct sub-tasks: type-check filter, aliasing (basis→evidence, detail→description, suggestion→recommendation), confidence clamping, confidence defaulting, ID stamping, domain defaulting, blocking defaulting, source defaulting, lineEnd clamping, and the new dropped-item logging. This is a single-responsibility violation.

**Fix:** Extract into `src/core/parsing.ts`:

```typescript
// src/core/parsing.ts
export function validateAndNormalizeFindings(items: unknown[], agentName: AgentName): Finding[]
```

`BaseAgent.validateFindings()` becomes a one-line delegation:

```typescript
private validateFindings(items: unknown[]): Finding[] {
  return validateAndNormalizeFindings(items, this.name)
}
```

**Constraints:**

- All 284 existing tests must still pass after refactor
- `parseFindings()` in `base.ts` must not change its public behavior
- `validateAndNormalizeFindings` must be exported for direct testing
- Add at least 3 unit tests to `tests/unit/baseAgent.test.ts` covering the new function directly:
  - `evidence`-only finding is kept (not dropped)
  - `basis`-only finding is kept (legacy path)
  - finding with all missing required fields is dropped with log

**Commit to ACR.**

**Output:** `docs/audit/staging/r3-agent-3-baseagent-srp.md`

---

### Agent 4 — Semantic Context Tests

**Repository:** ACR. **Writes code and commits.** Runs AFTER Agent 3 commits.

**Problem:** `src/core/contextLoader.ts` lines 113–174 (`loadAgentContextSemantic`) and `src/embedder.ts` (or wherever `embed()` lives) have 0% test coverage. The `--context-mode semantic` advertised feature has no quality floor.

**Fix:** Add tests in `tests/unit/contextLoader.test.ts` (or a new `tests/unit/embedder.test.ts`):

1. **embed() — success path**: Mock `fetch` to return `{embedding: [0.1, 0.2, 0.3]}`. Call `embed('http://localhost:11434', 'text')`. Assert it returns `[0.1, 0.2, 0.3]`.

2. **embed() — Ollama unavailable**: Mock `fetch` to throw `ECONNREFUSED`. Call `embed(...)`. Assert it returns `null` (graceful degradation, no throw).

3. **embed() — non-ok HTTP response**: Mock `fetch` to return `{ok: false, status: 503}`. Assert returns `null`.

4. **cosineSimilarity() — identical vectors**: Call with `[1, 0, 0]` and `[1, 0, 0]`. Assert returns `1.0`.

5. **cosineSimilarity() — zero vector**: Call with `[0, 0, 0]` and `[1, 0, 0]`. Assert returns `0` (not `NaN`).

6. **cosineSimilarity() — orthogonal vectors**: Call with `[1, 0]` and `[0, 1]`. Assert returns `0`.

7. **loadAgentContextSemantic() — graceful fallback**: Mock `embed()` to return `null`. Call `loadAgentContextSemantic(...)`. Assert it returns an empty context (no throw, no crash).

First read `src/core/contextLoader.ts` and any embedder module to find the exact function signatures before writing tests.

All 284 + new tests must pass.

**Commit to ACR.**

**Output:** `docs/audit/staging/r3-agent-4-semantic-tests.md`

---

### Agent 5 — vscode-extension Subprocess Timeout

**Repository:** ACR. **Writes code and commits.** Runs AFTER Agent 4 commits.

**Problem:** `vscode-extension/src/runner.ts` `spawnCli()` resolves only on `child.on('close')`. No wall-clock timeout is set. If Ollama stalls or the CLI deadlocks writing stdout, the VS Code progress spinner runs forever.

**Fix:** In `spawnCli()`, add a `setTimeout` that kills the child process and rejects the promise after a configurable wall-clock limit:

```typescript
// Default 5 minutes — enough for a full 15-agent run with slow Ollama
const SUBPROCESS_TIMEOUT_MS = options.timeoutMs ?? 5 * 60 * 1000

const timeoutHandle = setTimeout(() => {
  child.kill('SIGTERM')
  reject(new Error(`ai-review-agent timed out after ${SUBPROCESS_TIMEOUT_MS / 1000}s`))
}, SUBPROCESS_TIMEOUT_MS)

child.on('close', (code) => {
  clearTimeout(timeoutHandle)
  // existing close handler...
})
```

**Test coverage:** Add a test to `vscode-extension/tests/runner.test.ts` that:

1. Spawns a mock process that never closes
2. Passes a short `timeoutMs` (e.g., 50 ms)
3. Asserts the promise rejects with the timeout error message

Run `npm run test:extension` — must pass.

**Commit to ACR.**

**Output:** `docs/audit/staging/r3-agent-5-extension-timeout.md`

---

## Phase 3

### Agent 6 — Verification + Round 3 Report

**Repository:** Both (read-only). Runs AFTER all Phase 2 agents commit.

**Verification steps:**

```bash
cd "C:/Users/Mizzo/Claude/AI-Code-Review-Agent" && npm run check 2>&1 | tail -5
cd "C:/Users/Mizzo/Claude/AI-Code-Review-Agent" && npm test 2>&1 | tail -5
cd "C:/Users/Mizzo/Claude/AI-Code-Review-Agent" && npm run test:extension 2>&1 | tail -5
cd "C:/Users/Mizzo/Claude/Personal-Memory-Bank" && bash tests/run.sh 2>&1 | tail -10
```

**Report:** Reads all staging files (`r3-agent-1-regression.md` through `r3-agent-5-extension-timeout.md`). Produces `docs/audit/2026-06-26-round3-audit-report.md`.

Report sections (same 20-section structure, but condensed):

- §1 Executive Summary: regression count, deferred items closed, net-new findings
- §2 Overall Readiness Assessment: how ratings changed vs Round 2
- §3 Critical Issues — §3.1 Round 2 Regression Summary table
- §4–§17 Standard sections (most will say "No findings in this category.")
- §18 Quick Wins: any new XS items found while implementing fixes
- §20 Production Readiness Verdict: blunt one-paragraph assessment

**Commits** the report to ACR.

**Output:** `docs/audit/2026-06-26-round3-audit-report.md`

---

## Repositories

- **PMB:** `C:\Users\Mizzo\Claude\Personal-Memory-Bank`
- **ACR:** `C:\Users\Mizzo\Claude\AI-Code-Review-Agent`

## Staging Files

- `docs/audit/staging/r3-agent-1-regression.md`
- `docs/audit/staging/r3-agent-2-pmb-fixes.md`
- `docs/audit/staging/r3-agent-3-baseagent-srp.md`
- `docs/audit/staging/r3-agent-4-semantic-tests.md`
- `docs/audit/staging/r3-agent-5-extension-timeout.md`
- `docs/audit/2026-06-26-round3-audit-report.md`

## Deferred Items Being Closed This Round

| Item                                   | Agent   | Status  |
| -------------------------------------- | ------- | ------- |
| BaseAgent SRP (19 concerns)            | Agent 3 | Closing |
| Semantic context 0% test coverage      | Agent 4 | Closing |
| test-mb-doctor.sh mutates real repo    | Agent 2 | Closing |
| vscode-extension subprocess no timeout | Agent 5 | Closing |
| Doctor check 5 permanently SKIP'd      | Agent 2 | Closing |
