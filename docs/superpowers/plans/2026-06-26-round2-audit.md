# Round 2 Pre-Production Readiness Audit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a Round 2 20-section pre-production readiness report for Personal-Memory-Bank and AI-Code-Review-Agent, explicitly distinguishing [REGRESSION] (Round 1 fix degraded) from [NEW] (net-new finding).

**Architecture:** Tasks 1–6 are independent and MUST be dispatched in parallel (use superpowers:dispatching-parallel-agents). Task 7 runs only after all 6 staging files contain `Status: Complete`. Each domain agent reads files, runs commands, and writes findings to its own staging file with no shared state.

**Tech Stack:** Bash, PowerShell, Node.js/TypeScript (ACR), shell scripts (PMB), git, vitest.

---

## Repositories

- **PMB:** `C:\Users\Mizzo\Claude\Personal-Memory-Bank`
- **ACR:** `C:\Users\Mizzo\Claude\AI-Code-Review-Agent`

## Output Paths

- Staging files: `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\docs\audit\staging\r2-agent-N-<name>.md`
- Final report: `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\docs\audit\2026-06-26-round2-audit-report.md`

## Finding Format (used by every agent)

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

## Task 0: Pre-Audit Setup

**Files:**

- Create: `docs/audit/staging/r2-agent-1-regression.md`
- Create: `docs/audit/staging/r2-agent-2-pmb-tests.md`
- Create: `docs/audit/staging/r2-agent-3-mcp-extension.md`
- Create: `docs/audit/staging/r2-agent-4-baseagent-context.md`
- Create: `docs/audit/staging/r2-agent-5-security-reliability.md`
- Create: `docs/audit/staging/r2-agent-6-drift-docs.md`

- [ ] **Step 1: Create staging placeholder files**

```bash
mkdir -p "C:/Users/Mizzo/Claude/AI-Code-Review-Agent/docs/audit/staging"
for f in r2-agent-1-regression r2-agent-2-pmb-tests r2-agent-3-mcp-extension r2-agent-4-baseagent-context r2-agent-5-security-reliability r2-agent-6-drift-docs; do
  echo "# $f — IN PROGRESS" > "C:/Users/Mizzo/Claude/AI-Code-Review-Agent/docs/audit/staging/$f.md"
done
```

Expected: 6 files created, no errors.

- [ ] **Step 2: Verify ACR baseline**

```bash
cd "C:/Users/Mizzo/Claude/AI-Code-Review-Agent" && npm test 2>&1 | grep "Tests "
```

Expected: `Tests  284 passed` (or higher — record actual count).

- [ ] **Step 3: Commit staging scaffold**

```bash
cd "C:/Users/Mizzo/Claude/AI-Code-Review-Agent"
git add docs/audit/staging/
git commit -m "chore: scaffold Round 2 audit staging files"
```

---

## Task 1: Agent 1 — Round 1 Fix Verification (Regression Inspector)

> **Dispatch as subagent. Scope: both repos. Verifies every Round 1 fix held after 20+ subsequent commits.**

**Files to read:**

- `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\src\core\llm\ollamaProvider.ts`
- `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\src\cli\index.ts`
- `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\src\core\policyFilter.ts`
- `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\src\core\ignoreFilter.ts`
- `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\src\core\runner.ts`
- `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\.github\workflows\release.yml`
- `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\.claude\commands\change-review.md`
- `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\.claude\commands\code-review.md`
- `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\docs\CONTRACTS-GUIDE.md`
- `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\docs\HOOKS-GUIDE.md`
- `C:\Users\Mizzo\Claude\Personal-Memory-Bank\scripts\check-contract.sh`
- `C:\Users\Mizzo\Claude\Personal-Memory-Bank\scripts\check-contract.ps1`
- `C:\Users\Mizzo\Claude\Personal-Memory-Bank\scripts\pre-compact-check.sh`
- `C:\Users\Mizzo\Claude\Personal-Memory-Bank\scripts\pre-compact-check.ps1`

**Output file:** `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\docs\audit\staging\r2-agent-1-regression.md`

- [ ] **Step 1: Verify npm run check (known regression)**

```bash
cd "C:/Users/Mizzo/Claude/AI-Code-Review-Agent" && npm run check 2>&1
```

Expected: should pass clean. If it fails, list every file in the `[warn]` lines. This is a [REGRESSION] finding if it fails — the fix in Round 1 only formatted one file while subsequent commits added more unformatted files.

- [ ] **Step 2: Test OllamaProvider URL validation edge cases**

Read `src/core/llm/ollamaProvider.ts`. Find the `new URL(baseUrl)` + hostname check in the constructor. Then evaluate these inputs by reading the logic (not by running — Ollama not required):

- `http://192.168.1.1:11434` → hostname = `192.168.1.1` → should throw ✓ or pass ✗?
- `http://0.0.0.0:11434` → hostname = `0.0.0.0` → is `0.0.0.0` in the allowlist?
- `http://[::1]:11434` → hostname = `::1` → is `::1` in the allowlist?
- `http://localhost@evil.com:11434` → what does `new URL(...)?.hostname` return? (`evil.com` = bypass, `localhost` = safe)
- `http://127.0.0.1.evil.com:11434` → hostname = `127.0.0.1.evil.com` → should throw
- `ollama://localhost:11434` → does `new URL(...)` throw for unknown protocol?

Record the allowlist exactly and assess each case. Any bypass = High/[NEW] finding. Invalid protocol not throwing = Medium/[NEW].

- [ ] **Step 3: Verify CLI re-throw guard**

Read `src/cli/index.ts`. Find the catch block. Verify:

- Does it contain `err.message.startsWith('process.exit(')` or equivalent?
- If a real dependency throws `new Error('process.exit(something) was called in test harness')` would that be accidentally re-thrown (masking the real error)?

Also check: `process.exit(0)` throws `Error('process.exit(0)')` from test spy. Does `startsWith('process.exit(')` match `'process.exit(0)'`? Yes. So exit-0 is re-thrown correctly. Confirm by re-reading logic.

- [ ] **Step 4: Check matchPattern for circular dependency**

```bash
cd "C:/Users/Mizzo/Claude/AI-Code-Review-Agent" && npm run typecheck 2>&1
```

Expected: 0 errors. Also read `src/core/policyFilter.ts` — verify it imports `matchPattern` from `./ignoreFilter.js` (not a local copy). Read `src/core/ignoreFilter.ts` — verify `matchPattern` is `export function`, not just `function`.

- [ ] **Step 5: Verify check-contract scope schema handling**

Read `C:\Users\Mizzo\Claude\Personal-Memory-Bank\scripts\check-contract.sh`. Find the Python block. Verify it handles:

- `scope` = `[{file: "x", op: "edit"}]` (ACR format) → extracts `["x"]`
- `scope` = `{files: ["x"]}` (PMB template) → extracts `["x"]`
- `scope` = `[]` → extracts `[]` (empty, no scope check fires)
- malformed JSON → prints `__MALFORMED__` → triggers warning message

Read `C:\Users\Mizzo\Claude\Personal-Memory-Bank\scripts\check-contract.ps1`. Find the scope extraction block. Verify the same 4 cases. Note: PowerShell `ConvertFrom-Json` on malformed JSON throws — does the catch now print a warning vs silently exit 0?

- [ ] **Step 6: Verify CONTRACTS-GUIDE.md accuracy**

Read `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\docs\CONTRACTS-GUIDE.md`. Read `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\.claude\contracts\active-task.json`. Compare:

- Does guide's schema match the actual JSON fields?
- Does guide document both scope formats or only one?
- Does guide mention `approved_by` field? Is that field in the actual contract?

- [ ] **Step 7: Verify HOOKS-GUIDE.md PreCompact claim**

Read `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\docs\HOOKS-GUIDE.md`. Find the PreCompact section. Note the claim about exit codes.

Read `C:\Users\Mizzo\Claude\Personal-Memory-Bank\scripts\pre-compact-check.sh`. Find the actual exit codes:

- On check pass: exits 0 ✓
- On check fail: exits 2 (blocks) or exits 0 (warns)?

Read `C:\Users\Mizzo\Claude\Personal-Memory-Bank\scripts\pre-compact-check.ps1`. Same check. If HOOKS-GUIDE.md says "exits 2 — compaction is blocked" but the script exits 0, that's a [REGRESSION] or [NEW] finding.

Also check: ACR's `CLAUDE.md` — does it say "warns" or "blocks" for PreCompact? Round 1 identified this as "warns where PMB says blocks" — was this ever actually fixed?

- [ ] **Step 8: Verify /change-review --diff flag exists**

Read `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\src\cli\index.ts`. Find `.option('--diff <path>', ...)`. Confirm the flag is registered and wired to `getDiff()`. This verifies the Job 7 fix is theoretically sound.

Also check: can `--diff` and `--dir` both be specified? Is there a validation error or silent precedence?

- [ ] **Step 9: Verify --no-sanitize warning fires correctly**

Read `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\src\core\runner.ts`. Find `preprocessDiff` method. Check:

- Is the warning written via `process.stderr.write` (correct) or `console.warn` (may be swallowed by stdout redirect in CI)?
- Is sanitization skipped when `config.sanitize === false` or when `config.sanitize !== true`? (edge: what is the default value?)

Read `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\src\core\config.ts` to find the default value of `sanitize`.

- [ ] **Step 10: Verify gitleaks action is pinned**

Read `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\.github\workflows\release.yml`. Find the gitleaks step. Check:

- Is it `gitleaks/gitleaks-action@v2` (mutable, supply-chain risk) or `gitleaks/gitleaks-action@SHA` (pinned)?
- A floating `@v2` tag means any push to that tag repo changes what runs with `GITHUB_TOKEN` in scope.

- [ ] **Step 11: Verify vscode-extension CI test can run headlessly**

Read `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\.github\workflows\release.yml`. Find the `npm run test:extension` step. Check:

- Is there a `xvfb-run` prefix or `DISPLAY` environment variable set?
- Is there a `uses: actions/setup-node` + headless display setup step before it?

Read `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\vscode-extension\package.json`. Find the `test` script. Does it use `@vscode/test-electron` or `vscode-test`? These require a display server unless run with `--headless` flag (VS Code 1.93+).

- [ ] **Step 12: Verify runner decomposition — test count**

```bash
cd "C:/Users/Mizzo/Claude/AI-Code-Review-Agent" && npm test 2>&1 | grep "Tests "
```

Expected: ≥284 tests passing. Any reduction = [REGRESSION].

- [ ] **Step 13: Verify /code-review cloud disclosure is in frontmatter**

Read `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\.claude\commands\code-review.md`. Check:

- Is "Uses Claude (cloud API)" in the `description:` frontmatter field (visible to Claude when listing commands)?
- Or is it only in the body text (only visible when Claude reads the full file)?

Claude reads `description:` metadata for command discovery; the body is read when the command is invoked. Disclosure in body only = lower visibility.

- [ ] **Step 14: Write findings to staging file**

Write `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\docs\audit\staging\r2-agent-1-regression.md`:

```markdown
# Agent 1 — Round 1 Fix Verification (Regression Inspector)

**Date:** 2026-06-26
**Status:** Complete
**Finding count:** [N] ([R] regressions, [N] new)

---
```

Then append each finding in the standard format. For null results: `> [CHECK NAME]: No finding — [observed].`

---

## Task 2: Agent 2 — PMB Test Suite & CI Audit

> **Dispatch as subagent. Scope: PMB only. Areas barely touched in Round 1.**

**Files to read:**

- `C:\Users\Mizzo\Claude\Personal-Memory-Bank\tests\run.sh`
- `C:\Users\Mizzo\Claude\Personal-Memory-Bank\tests\test-mb-doctor.sh`
- `C:\Users\Mizzo\Claude\Personal-Memory-Bank\tests\test-mb-plan.sh`
- `C:\Users\Mizzo\Claude\Personal-Memory-Bank\tests\test-mb-preflight.sh`
- `C:\Users\Mizzo\Claude\Personal-Memory-Bank\tests\test-mb-change-check.sh`
- `C:\Users\Mizzo\Claude\Personal-Memory-Bank\tests\helpers\` (all files)
- `C:\Users\Mizzo\Claude\Personal-Memory-Bank\.github\workflows\pmb-health.yml`
- `C:\Users\Mizzo\Claude\Personal-Memory-Bank\scripts\mb.sh` (the doctor checks section)

**Output file:** `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\docs\audit\staging\r2-agent-2-pmb-tests.md`

- [ ] **Step 1: Run the full PMB test suite**

```bash
cd "C:/Users/Mizzo/Claude/Personal-Memory-Bank" && bash tests/run.sh 2>&1
```

Record: did it complete? How many tests passed/failed? Any permission errors on Windows Git Bash? If it fails, note the exact failing test and error message.

- [ ] **Step 2: Check test isolation**

Read `C:\Users\Mizzo\Claude\Personal-Memory-Bank\tests\run.sh` and any helper files in `tests/helpers/`. Check:

- Do tests create temp directories and clean up after themselves?
- Do any tests mutate the real PMB repo (e.g. write to `memory-bank/` directly)?
- Is there a shared state file that one test writes and another reads?

Any test that mutates real repo state without cleanup = High/[NEW] finding.

- [ ] **Step 3: Verify test-mb-doctor.sh covers all 24 checks**

Read `C:\Users\Mizzo\Claude\Personal-Memory-Bank\tests\test-mb-doctor.sh`. Count the distinct doctor checks being tested. Cross-reference with the 24 checks in `mb doctor` output:

- Does the test file test all 24 checks, or does it skip some?
- Does it test the "clean baseline" path (all OK)?
- Does it test failure modes for each check?

Any doctor check with no test = Medium/[NEW] finding.

- [ ] **Step 4: Verify test-mb-plan.sh — mb plan promote actually moves files**

Read `C:\Users\Mizzo\Claude\Personal-Memory-Bank\tests\test-mb-plan.sh`. Check:

- Does the test create a file in `.claude/plans/`, call `mb plan promote`, and verify the file moved to `docs/plans/`?
- Or does it just check the exit code of `mb plan promote`?

A test that only checks exit code without verifying file movement = Medium/[NEW] finding (false-positive test).

- [ ] **Step 5: Audit new commands test coverage**

Read `C:\Users\Mizzo\Claude\Personal-Memory-Bank\tests\test-mb-preflight.sh` and `test-mb-change-check.sh`. Check:

- Do they test actual behavior (output content, file changes) or just exit codes?
- Do they test failure/error paths?

Also list all `mb` subcommands in `scripts/mb.sh` by scanning for the `case` statement entries. Compare to test files in `tests/`. Any subcommand with no test file = Medium/[NEW] finding.

- [ ] **Step 6: Read pmb-health.yml — does it actually run mb as a CLI?**

Read `C:\Users\Mizzo\Claude\Personal-Memory-Bank\.github\workflows\pmb-health.yml`. Find the `mb-doctor-self-check` job. Check:

- Does it run `mb doctor` as a CLI command, or does it `source scripts/mb.sh && doctor`?
- If it runs `mb` as a CLI, how is `mb` installed? Via `PATH`? Via `npm install -g`?
- If `mb` is not installed as a CLI on the CI runner, does the job fail with a useful error or silently pass?

A CI job that tests `mb` but doesn't actually install `mb` = High/[NEW] finding.

- [ ] **Step 7: Read powershell-lint job**

Read the powershell-lint job in `pmb-health.yml`. Check:

- What PSScriptAnalyzer severity level is enforced (`-Severity Error` only, or also `Warning`)?
- Does it run on all `.ps1` files or only some?
- Run mentally: would the known CRLF warnings on `check-contract.ps1` and `check-contract.sh` (from our Round 1 commits) trigger PSScriptAnalyzer findings?

- [ ] **Step 8: Verify doctor O(n) optimization**

Read `C:\Users\Mizzo\Claude\Personal-Memory-Bank\scripts\mb.sh`. Find the doctor check section (checks 22–23, the semantic drift checks). Check:

- Is there a pre-computation step that runs BEFORE the check loop (O(1) setup)?
- Or is the expensive computation still inside the loop?

The commit message says "pre-cache O(n²) normalization" — verify this is actually implemented vs just described.

- [ ] **Step 9: Write findings to staging file**

Write `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\docs\audit\staging\r2-agent-2-pmb-tests.md`:

```markdown
# Agent 2 — PMB Test Suite & CI Audit

**Date:** 2026-06-26
**Status:** Complete
**Finding count:** [N]

---
```

---

## Task 3: Agent 3 — MCP Server & vscode-extension Deep Dive

> **Dispatch as subagent. Scope: ACR src/mcp/ and vscode-extension/. Barely touched in Round 1.**

**Files to read:**

- `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\src\mcp\server.ts`
- `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\src\mcp\tool.ts`
- `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\src\mcp\formatter.ts`
- `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\vscode-extension\src\runner.ts`
- `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\vscode-extension\src\diagnostics.ts`
- `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\vscode-extension\package.json`
- `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\vscode-extension\tests\runner.test.ts`
- `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\.github\workflows\release.yml`
- `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\tests\unit\mcp\tool.test.ts`

**Commands to run:**

```bash
cd "C:/Users/Mizzo/Claude/AI-Code-Review-Agent" && npm pack --dry-run 2>&1 | grep -i "mcp\|server"
cd "C:/Users/Mizzo/Claude/AI-Code-Review-Agent" && npm run test:extension 2>&1 | tail -20
```

**Output file:** `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\docs\audit\staging\r2-agent-3-mcp-extension.md`

- [ ] **Step 1: Check MCP server shutdown handling**

Read `src/mcp/server.ts`. Check:

- Is there a `process.on('SIGTERM', ...)` or `process.on('SIGINT', ...)` handler?
- Is there a `stdin.on('close', ...)` handler to detect client disconnect?
- What happens if the MCP client disconnects mid-review — does the server hang, crash, or clean up?

No shutdown handler = Medium/[NEW] finding (server leaks on client disconnect).

- [ ] **Step 2: Test MCP tool empty/null diff handling**

Read `src/mcp/tool.ts`. Find the `review_diff` tool handler. Check:

- What happens when `diff` argument is `""` (empty string)? Does it return an error response or call SwarmRunner with empty diff?
- What happens when `diff` is not provided (undefined)? Is there input validation?
- Is the response always a valid `CallToolResult` with a `content` array?

Compare to how the CLI handles empty diff (exits with error message).

- [ ] **Step 3: Verify MCP formatter response schema**

Read `src/mcp/formatter.ts`. Check that the returned object matches MCP `CallToolResult` schema:

- `content` must be an array
- Each content item must have `type: "text"` and `text: string`
- No extra fields that MCP clients reject

- [ ] **Step 4: Verify ai-review-mcp is in npm package**

```bash
cd "C:/Users/Mizzo/Claude/AI-Code-Review-Agent" && npm pack --dry-run 2>&1 | grep -i "mcp\|server"
```

Expected: `dist/mcp/server.js` appears in pack output. If not: High/[NEW] finding (MCP binary not shipped).

- [ ] **Step 5: Check vscode-extension runner timeout**

Read `vscode-extension/src/runner.ts`. Check:

- Is there a timeout set on the `ai-review-agent` subprocess spawn?
- If ACR hangs for 10 minutes, does the extension timeout and surface an error, or does VS Code become unresponsive?

No subprocess timeout = High/[NEW] finding.

- [ ] **Step 6: Check vscode-extension diagnostics clearing**

Read `vscode-extension/src/diagnostics.ts`. Find where `diagnosticCollection.set()` is called. Check:

- Is `diagnosticCollection.clear()` or `diagnosticCollection.delete(uri)` called before setting new diagnostics?
- If not, running the extension twice on files where the first run had findings but the second run does not — do stale squiggles persist?

Stale diagnostics = Medium/[NEW] finding.

- [ ] **Step 7: Run vscode-extension test suite**

```bash
cd "C:/Users/Mizzo/Claude/AI-Code-Review-Agent" && npm run test:extension 2>&1 | tail -20
```

Record: did it pass, fail, or hang? If it hangs (requires display server), kill it after 30 seconds and record as High/[NEW] finding (CI will block on this step in release.yml).

- [ ] **Step 8: Check vscode-extension CI headless compatibility**

Read `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\.github\workflows\release.yml`. Find the `VS Code extension tests` step. Check:

- Is there `xvfb-run` wrapping the command?
- Is there `DISPLAY: :99` in the environment?
- Is there `uses: coactions/setup-xvfb@v1` or equivalent before it?

Read `vscode-extension/package.json` test script. Does it use `@vscode/test-electron`? This requires a display unless `--extensionDevelopmentPath` flag is omitted and the test runner is configured for headless. If CI step will hang = Critical/[REGRESSION] finding (we added a step that blocks the release pipeline).

- [ ] **Step 9: Write findings to staging file**

Write `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\docs\audit\staging\r2-agent-3-mcp-extension.md`:

```markdown
# Agent 3 — MCP Server & vscode-extension Deep Dive

**Date:** 2026-06-26
**Status:** Complete
**Finding count:** [N]

---
```

---

## Task 4: Agent 4 — BaseAgent Architecture & contextLoader Semantic Path

> **Dispatch as subagent. Scope: ACR src/core/agents/base.ts and src/core/contextLoader.ts. Both deferred in Round 1.**

**Files to read:**

- `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\src\core\agents\base.ts`
- `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\src\core\contextLoader.ts`
- `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\tests\unit\baseAgent.test.ts`
- `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\tests\unit\contextLoader.test.ts`

**Output file:** `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\docs\audit\staging\r2-agent-4-baseagent-context.md`

- [ ] **Step 1: Count BaseAgent responsibilities**

Read `src/core/agents/base.ts` in full. List every distinct responsibility:

1. System prompt construction
2. HTTP call to LLM
3. Think-tag stripping
4. Stage-1 JSON parse (direct parse)
5. Stage-2 JSON parse (bracket extraction)
6. Stage-3 JSON parse (regex extraction)
7. Schema validation via `validateFindings()`
8. Field aliasing (`basis→evidence`, `detail→description`, `suggestion→recommendation`)
9. Confidence clamping
10. ID stamping (`agentName-N`)
11. `blocking` default assignment

Count the actual responsibilities in the current code. More than 5 distinct concerns in one class = Medium/[NEW] architectural finding.

- [ ] **Step 2: Test 3-stage parse interaction**

Read the 3 parse stages. Answer:

- If stage-1 fails and stage-2 succeeds, are stage-2 findings still validated by `validateFindings()`?
- Is there a guarantee that if stage-2 returns results, stage-3 is NOT attempted (avoiding double findings)?
- What happens if stage-2 produces partial findings (some valid, some missing required fields)?

- [ ] **Step 3: Audit validateFindings silently dropping findings**

Read `validateFindings()` in `base.ts`. Check:

- What fields are required? Does it check `title`? `severity`? `file`?
- If the LLM returns a finding with all 10 required fields plus one extra unknown field, is the finding kept or dropped?
- Is there any logging when a finding is dropped by validation?

Silent finding drops with no log = Medium/[NEW] finding (makes debugging agent output impossible).

- [ ] **Step 4: Test field aliasing priority**

Read the aliasing block. Answer:

- If a finding has BOTH `basis: "x"` AND `evidence: "y"`, which wins?
- If a finding has BOTH `detail: "x"` AND `description: "y"`, which wins?
- Is the aliasing order documented?

Conflicting field resolution without documentation = Low/[NEW] finding.

- [ ] **Step 5: Test confidence clamping edge cases**

Read the confidence handling. Evaluate:

- `confidence: -1` → what happens?
- `confidence: 200` → what happens?
- `confidence: "high"` (string) → does TypeScript catch this, or does runtime coerce it?
- `confidence: null` → what is the default?

Any unhandled edge case that produces `NaN` or `undefined` confidence = Medium/[NEW] finding.

- [ ] **Step 6: Verify contextLoader semantic embedding is real**

Read `src/core/contextLoader.ts` in full. Find `loadAgentContextSemantic()` and `embed()`. Check:

- Does `embed()` actually make an HTTP call to `http://localhost:11434/api/embeddings` with model `nomic-embed-text`?
- Or does it return a fallback/mock embedding?
- What happens when `nomic-embed-text` is not installed in Ollama? Does `embed()` throw, return zeros, or fall back to keyword selection?

If semantic embedding is aspired but not implemented = High/[NEW] finding (feature advertised, not delivered).

- [ ] **Step 7: Verify cosineSimilarity mathematical correctness**

Read the `cosineSimilarity()` function. Evaluate:

- Is the numerator the dot product of the two vectors?
- Is the denominator the product of the L2 norms?
- What happens when one vector is all zeros? (division by zero → `NaN` or `Infinity`)
- What happens when two identical vectors are passed? (should return 1.0)

Division by zero risk = Medium/[NEW] finding.

- [ ] **Step 8: Check contextLoader test coverage of semantic path**

Read `tests/unit/contextLoader.test.ts`. Check:

- Does any test call `loadAgentContextSemantic()`?
- Does any test exercise `embed()` or `cosineSimilarity()`?
- Are all semantic-path functions at 0% coverage?

0% coverage on semantic path = High/[NEW] finding (confirmed in Round 1, verify it persists).

- [ ] **Step 9: Write findings to staging file**

Write `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\docs\audit\staging\r2-agent-4-baseagent-context.md`:

```markdown
# Agent 4 — BaseAgent Architecture & contextLoader Semantic Path

**Date:** 2026-06-26
**Status:** Complete
**Finding count:** [N]

---
```

---

## Task 5: Agent 5 — New Security & Reliability Surface

> **Dispatch as subagent. Scope: both repos. Focuses on security/reliability of Round 1 changes themselves.**

**Files to read:**

- `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\src\core\llm\ollamaProvider.ts`
- `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\src\cli\index.ts`
- `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\src\core\runner.ts`
- `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\src\core\config.ts`
- `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\.github\workflows\release.yml`
- `C:\Users\Mizzo\Claude\Personal-Memory-Bank\scripts\check-contract.ps1`
- `C:\Users\Mizzo\Claude\Personal-Memory-Bank\scripts\dangerous-commands.sh`

**Output file:** `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\docs\audit\staging\r2-agent-5-security-reliability.md`

- [ ] **Step 1: Test URL parser hostname bypass vectors**

Evaluate these URL parsing behaviors (no execution needed — use `new URL()` semantics):

- `new URL('http://localhost@evil.com:11434').hostname` → returns `evil.com` (the `@` makes `localhost` a username). OllamaProvider's allowlist checks `hostname`, so `evil.com` fails → safe. But if anyone ever changes to checking `host`, the `localhost` username bypasses.
- `new URL('http://127.0.0.1.evil.com:11434').hostname` → returns `127.0.0.1.evil.com` → fails allowlist → safe.
- `new URL('ollama://localhost:11434')` → unknown protocol causes `TypeError: Invalid URL` → does OllamaProvider constructor catch this and produce a helpful error, or does it propagate as an uncaught type error?

Record each case with confidence. The `localhost@evil.com` case is NOT a bypass (correct behavior), but the uncaught `TypeError` from unknown protocol may produce an unhelpful error.

- [ ] **Step 2: Verify sanitization order in preprocessDiff**

Read `src/core/runner.ts`, find `preprocessDiff`. Verify the order:

1. Ignore filtering (remove files matching .aiignore)
2. Sanitization (strip injection patterns)
3. Truncation (cut at maxDiffLines)

If truncation happens BEFORE sanitization: an attacker can embed injection at line 2001 of a 2001-line diff. The truncation cuts it off, so it never reaches the sanitizer. This is actually SAFE (the injected content is removed). But if order is wrong (sanitize before ignore-filter), injection in excluded files could survive. Verify the exact order.

- [ ] **Step 3: Test --no-sanitize warning channel**

Read `src/core/runner.ts` `preprocessDiff`. Find the warning for `config.sanitize === false`. Check:

- Is it `process.stderr.write(...)` (reaches CI stderr stream)?
- Is it `console.warn(...)` (routed through Node.js console, typically also to stderr but potentially suppressed)?

Then consider: in a CI pipeline that does `ai-review-agent --no-sanitize --format json > report.json 2>/dev/null`, is the warning visible? `2>/dev/null` suppresses stderr. This means the warning disappears silently when stderr is redirected. Is this acceptable? Document as Low finding.

- [ ] **Step 4: Assess gitleaks supply-chain risk**

Read `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\.github\workflows\release.yml`. Find:

```yaml
uses: gitleaks/gitleaks-action@v2
```

Check: is this `@v2` (a mutable tag — can be updated by the `gitleaks` maintainers to run arbitrary code) or `@v2.3.4` (mutable version tag) or `@SHA` (pinned, immutable)?

Any mutable reference in a workflow with `GITHUB_TOKEN` permissions = High/[NEW] security finding (GitHub Actions supply chain risk).

- [ ] **Step 5: Assess vscode-extension CI hang risk**

Read the `VS Code extension tests` step in `release.yml`. Does it have a `timeout-minutes:` field? If not, and if `npm run test:extension` hangs (requires display), the release job will run until GitHub's 6-hour workflow timeout — blocking all npm releases for 6 hours. Critical/[REGRESSION] if no timeout guard.

- [ ] **Step 6: Check check-contract.ps1 null scope edge case**

Read `check-contract.ps1`. Find the scope extraction block. Evaluate:

- If `$contract.scope` is `$null` (contract JSON has no `scope` field), what does `$rawScope -is [System.Array]` return? In PowerShell, `$null -is [System.Array]` returns `$false`. So `$rawScope` falls to `else` branch and `$scopeFiles = $rawScope` = `$null`.
- Then in the scope loop: `foreach ($pattern in $null)` — does PowerShell iterate zero times (safe) or throw?
- If it iterates zero times, every file appears out-of-scope and a spurious warning fires.

Document the exact behavior. Spurious warning with no scope = Medium/[NEW] finding.

- [ ] **Step 7: Assess dangerous-commands .pem WARN redundancy**

Read `C:\Users\Mizzo\Claude\Personal-Memory-Bank\scripts\dangerous-commands.sh`. Find the WARN tier patterns. Check if `.pem` is still there. Now that `*.pem` is in the ACR `.gitignore`, reading a `.pem` file is still potentially dangerous (you can read secrets from it), but the guardrail fires on commands that ACCESS the file, not on its existence. Assess: is the WARN still meaningful or redundant noise that trains users to ignore warnings?

- [ ] **Step 8: Write findings to staging file**

Write `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\docs\audit\staging\r2-agent-5-security-reliability.md`:

```markdown
# Agent 5 — New Security & Reliability Surface

**Date:** 2026-06-26
**Status:** Complete
**Finding count:** [N]

---
```

---

## Task 6: Agent 6 — Ecosystem Drift & Documentation Accuracy Post-Fixes

> **Dispatch as subagent. Scope: both repos. Verifies documentation accuracy after the Round 1 remediation sprint.**

**Files to read:**

- `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\memory-bank\activeContext.md`
- `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\memory-bank\progress.md`
- `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\CHANGELOG.md`
- `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\CLAUDE.md`
- `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\docs\CONTRACTS-GUIDE.md`
- `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\docs\HOOKS-GUIDE.md`
- `C:\Users\Mizzo\Claude\Personal-Memory-Bank\memory-bank\activeContext.md`
- `C:\Users\Mizzo\Claude\Personal-Memory-Bank\README.md`
- `C:\Users\Mizzo\Claude\Personal-Memory-Bank\.github\workflows\pmb-health.yml`

**Commands to run:**

```bash
cd "C:/Users/Mizzo/Claude/AI-Code-Review-Agent" && npm test 2>&1 | grep "Tests "
cd "C:/Users/Mizzo/Claude/AI-Code-Review-Agent" && git log --oneline -5
```

**Output file:** `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\docs\audit\staging\r2-agent-6-drift-docs.md`

- [ ] **Step 1: Audit ACR memory bank staleness**

Read `memory-bank/activeContext.md`. Check:

- What is the `last-reviewed` date?
- Today is 2026-06-26; staleness threshold is 14d. Is it stale?
- Does "Current Focus" reflect the Round 1 remediation sprint, or is it still describing v0.5.0 extension work?

Read `memory-bank/progress.md`. Check:

- Does the Metrics section say 284 tests (correct) or an older count?
- Does the Version History table include entries for v1.1.0 and the post-audit remediation commits?

- [ ] **Step 2: Verify ACR CHANGELOG covers Round 1 fixes**

Read `CHANGELOG.md`. Check:

- Is there a section for v1.1.0 or the remediation commits (after 2026-06-24)?
- Does it mention: OllamaProvider URL validation, CLI try/catch, runner decomposition, gitleaks in CI, vscode-extension tests in CI, /change-review Job 7 fix, CONTRACTS-GUIDE.md, HOOKS-GUIDE.md?

Missing CHANGELOG entries for shipped fixes = Medium/[NEW] finding.

- [ ] **Step 3: Verify ACR CLAUDE.md references resolve**

Read `CLAUDE.md`. Find every reference to a local file (paths starting with `docs/`, `standards/`, `scripts/`). For each:

- Does the file actually exist in the ACR repo?

Specifically check:

- `docs/CONTRACTS-GUIDE.md` → should now exist (created in Round 1)
- `docs/HOOKS-GUIDE.md` → should now exist (copied in Round 1)
- `standards/SECURITY-GUARDRAILS.md` → does this exist in ACR?
- `standards/CODE-QUALITY.md` → does this exist in ACR?
- `standards/WORKFLOW.md` → does this exist in ACR?
- `standards/AGENTIC-SAFETY.md` → does this exist in ACR?

Any broken reference = High/[NEW] finding (CLAUDE.md is the primary governance document).

- [ ] **Step 4: Verify CONTRACTS-GUIDE.md documents dual-format scope**

Read `docs/CONTRACTS-GUIDE.md`. After the Round 1 fix to `check-contract.sh`, the script now handles both `[{file,op}]` AND `{files:[]}` scope schemas. Does the guide:

- Document only one canonical schema (leaving users confused about which to use)?
- Or document both and explain the compatibility layer?

Undocumented dual-format support = Medium/[NEW] finding.

- [ ] **Step 5: Verify HOOKS-GUIDE.md PreCompact claim accuracy**

Read `docs/HOOKS-GUIDE.md`. Find the PreCompact section claim about exit codes. Then run:

```bash
grep -n "exit" "C:/Users/Mizzo/Claude/Personal-Memory-Bank/scripts/pre-compact-check.sh" | head -20
```

Does the script exit 2 on failure (blocks) or exit 0 (warns)? Does the guide claim match reality?

- [ ] **Step 6: Check PMB memory bank staleness**

Read `C:\Users\Mizzo\Claude\Personal-Memory-Bank\memory-bank\activeContext.md`. Check `last-reviewed` date vs today (2026-06-26). The staleness threshold is 14d. Is it within range?

- [ ] **Step 7: Check PMB README for new commands and CI**

Read `C:\Users\Mizzo\Claude\Personal-Memory-Bank\README.md`. Check:

- Does the command table include `mb preflight` and `mb change-check` (new since last audit)?
- Does the README mention that PMB has CI (pmb-health.yml with 9 jobs)?
- Does the doctor diagnostic count say 24?

Missing new commands in README = Medium/[NEW] finding.

- [ ] **Step 8: Check PMB CI job discoverability**

Read `pmb-health.yml`. Then check: is this CI workflow mentioned in README, HOOKS-GUIDE, or any user-facing documentation? A contributor cloning PMB would not know CI exists unless it's documented. Undiscoverable CI = Low/[NEW] finding.

- [ ] **Step 9: Write findings to staging file**

Write `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\docs\audit\staging\r2-agent-6-drift-docs.md`:

```markdown
# Agent 6 — Ecosystem Drift & Documentation Accuracy Post-Fixes

**Date:** 2026-06-26
**Status:** Complete
**Finding count:** [N]

---
```

---

## Task 7: Consolidation — Final Round 2 Report

> **Run AFTER Tasks 1–6 are complete. All 6 staging files must contain `Status: Complete`.**

**Files to read:**

- All 6 staging files in `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\docs\audit\staging\r2-agent-*.md`
- `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\docs\audit\2026-06-24-pre-production-audit-report.md` (Round 1 report for cross-reference)

**Output file:** `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\docs\audit\2026-06-26-round2-audit-report.md`

- [ ] **Step 1: Read all 6 staging files**

Read each staging file. Build a flat list of all findings. Record: title, tag ([REGRESSION]/[NEW]), severity, confidence, repository, agent source.

- [ ] **Step 2: Build Round 1 Regression Summary table**

For every `[REGRESSION]` finding, create a row in this table:

```markdown
## 3.1 Round 1 Regression Summary

| Round 1 Fix                   | Status       | Finding                                            |
| ----------------------------- | ------------ | -------------------------------------------------- |
| npm run check fix             | ❌ Regressed | 14 new Prettier violations from subsequent commits |
| OllamaProvider URL validation | ✅ Held      | [or] ⚠️ Partial — [specific gap]                   |
| CLI try/catch                 | ...          | ...                                                |
| matchPattern export           | ...          | ...                                                |
| check-contract scope fix      | ...          | ...                                                |
| CONTRACTS-GUIDE.md            | ...          | ...                                                |
| HOOKS-GUIDE.md                | ...          | ...                                                |
| /change-review --diff fix     | ...          | ...                                                |
| --no-sanitize warning         | ...          | ...                                                |
| gitleaks in release.yml       | ...          | ...                                                |
| vscode-extension CI           | ...          | ...                                                |
| runner decomposition          | ...          | ...                                                |
| /code-review cloud disclosure | ...          | ...                                                |
```

Status: ✅ Held / ❌ Regressed / ⚠️ Partial

- [ ] **Step 3: Deduplicate across agents**

Merge findings that share the same root cause (e.g., "PreCompact exits 0 not 2" may appear in both Agent 1 and Agent 6). Keep higher severity, list both source agents in Evidence.

- [ ] **Step 4: Write the final report**

Write to `docs/audit/2026-06-26-round2-audit-report.md` using this structure:

```markdown
# Round 2 Pre-Production Readiness Audit Report

**Date:** 2026-06-26
**Auditor:** Claude Sonnet 4.6 — 6-agent parallel audit (Round 2)
**Repositories:** Personal-Memory-Bank | AI-Code-Review-Agent v1.1.0
**Approach:** A — Regression + Discovery
**Total Findings:** [N] ([R] regressions, [N] new) ([C] Critical, [H] High, [M] Medium, [L] Low, [A] Advisory)
**Round 1 baseline:** 48 findings (2026-06-24)

---

## 1. Executive Summary

[300–400 words. Lead with regression count. What held? What broke? What's net-new?]

## 2. Overall Readiness Assessment

| Domain   | Round 1 Rating | Round 2 Rating | Delta |
| -------- | -------------- | -------------- | ----- |
| Security | ...            | ...            | ↑/↓/= |

...

## 3. Critical Issues

### 3.1 Round 1 Regression Summary

[Table from Step 2]

### 3.2 Critical Findings

[Full finding format for Critical severity]

## 4. High Priority Issues

## 5. Medium Priority Issues

## 6. Low Priority Issues

## 7. Missing Features

## 8. Missing Guardrails

## 9. Incorrect Guardrails

## 10. Security Concerns

## 11. Reliability Concerns

## 12. Performance Concerns

## 13. Documentation Issues

## 14. Developer Experience Issues

## 15. Integration Problems

## 16. Architecture Critique

## 17. Technical Debt

## 18. Quick Wins

## 19. Long-Term Recommendations

## 20. Production Readiness Verdict

[One blunt paragraph. What changed since Round 1? Is it closer to ready?]
```

- [ ] **Step 5: Commit the final report**

```bash
cd "C:/Users/Mizzo/Claude/AI-Code-Review-Agent"
git add docs/audit/
git commit -m "docs: add Round 2 pre-production readiness audit report 2026-06-26"
```

---

## Execution Notes

**Parallel dispatch:** Tasks 1–6 MUST be dispatched simultaneously. Each agent writes to a uniquely named staging file with no shared state.

**Task 7 gate:** Do not start Task 7 until all 6 staging files have `Status: Complete` in their header.

**[REGRESSION] vs [NEW]:** Every finding must carry one tag. [REGRESSION] = a Round 1 fix degraded. [NEW] = not found in Round 1 (could be pre-existing issue newly discovered, or introduced by Round 1 changes).

**Confidence labeling:** Every finding must carry one of: Verified / Strong Evidence / Likely / Speculative.

**Null results:** If a check produces no finding, write: `> [CHECK NAME]: No finding — [observation].`
