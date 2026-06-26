# Pre-Production Readiness Audit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a 20-section pre-production readiness report for Personal-Memory-Bank (PMB v1.2.0) and AI-Code-Review-Agent (ACR v1.0.1) by dispatching 6 parallel domain agents followed by a consolidation agent.

**Architecture:** Tasks 1–6 are independent and MUST be dispatched in parallel (use superpowers:dispatching-parallel-agents). Task 7 runs only after all 6 staging files exist. Each domain agent reads files, runs commands, and writes findings to its staging file. The consolidation agent merges all findings into the final report.

**Tech Stack:** Bash, PowerShell, Node.js/TypeScript (ACR), shell scripts (PMB), git, vitest.

---

## Repositories

- **PMB:** `C:\Users\Mizzo\Claude\Personal-Memory-Bank`
- **ACR:** `C:\Users\Mizzo\Claude\AI-Code-Review-Agent`

## Output Paths

- Staging files: `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\docs\audit\staging\agent-N-findings.md`
- Final report: `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\docs\audit\2026-06-24-pre-production-audit-report.md`

## Finding Format (used by every agent)

Every finding MUST use this exact markdown format:

```markdown
### Finding: [Short title — imperative phrase]
- **Severity:** Critical | High | Medium | Low | Advisory
- **Confidence:** Verified | Strong Evidence | Likely | Speculative
- **Repository:** PMB | ACR | Both
- **Evidence:** [File path:line or command + exact output]
- **Reproduction:** [Exact steps to trigger]
- **Root Cause:** [Why it happens]
- **Fix:** [Specific, actionable recommendation]
- **Impact:** [What improves when fixed]
- **Effort:** XS | S | M | L | XL
```

---

## Task 0: Pre-Audit Setup

**Files:**
- Create: `docs/audit/staging/` (directory)
- Create: `docs/audit/staging/agent-1-security.md`
- Create: `docs/audit/staging/agent-2-reliability.md`
- Create: `docs/audit/staging/agent-3-architecture.md`
- Create: `docs/audit/staging/agent-4-docs-dx.md`
- Create: `docs/audit/staging/agent-5-ci-coverage.md`
- Create: `docs/audit/staging/agent-6-integration.md`

- [ ] **Step 1: Create staging directory and placeholder files**

```bash
mkdir -p "C:/Users/Mizzo/Claude/AI-Code-Review-Agent/docs/audit/staging"
for f in agent-1-security agent-2-reliability agent-3-architecture agent-4-docs-dx agent-5-ci-coverage agent-6-integration; do
  echo "# $f findings — IN PROGRESS" > "C:/Users/Mizzo/Claude/AI-Code-Review-Agent/docs/audit/staging/$f.md"
done
```

Expected: 6 files created, no errors.

- [ ] **Step 2: Verify ACR tests pass before audit begins**

```bash
cd "C:/Users/Mizzo/Claude/AI-Code-Review-Agent" && npm test 2>&1 | tail -5
```

Expected output contains: `Tests  264 passed` (or higher — record actual count in Agent 4 seed finding).

- [ ] **Step 3: Commit staging scaffolding**

```bash
cd "C:/Users/Mizzo/Claude/AI-Code-Review-Agent"
git add docs/audit/
git commit -m "chore: scaffold audit staging directory"
```

---

## Task 1: Agent 1 — Security & Secrets

> **Dispatch as subagent. Scope: both repos.**

**Files to read:**
- `C:\Users\Mizzo\Claude\Personal-Memory-Bank\.gitleaks.toml`
- `C:\Users\Mizzo\Claude\Personal-Memory-Bank\.claude\settings.json`
- `C:\Users\Mizzo\Claude\Personal-Memory-Bank\standards\SECRETS.md`
- `C:\Users\Mizzo\Claude\Personal-Memory-Bank\scripts\dangerous-commands.sh`
- `C:\Users\Mizzo\Claude\Personal-Memory-Bank\scripts\dangerous-commands.ps1`
- `C:\Users\Mizzo\Claude\Personal-Memory-Bank\scripts\mb.sh`
- `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\.claude\settings.json`
- `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\src\core\sanitizer.ts`
- `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\src\adapters\github.ts`
- `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\src\core\llm\ollamaProvider.ts`
- `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\.github\workflows\release.yml`
- `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\.gitignore`
- `C:\Users\Mizzo\Claude\Personal-Memory-Bank\.gitignore`

**Output file:** `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\docs\audit\staging\agent-1-security.md`

- [ ] **Step 1: Scan both repos for hardcoded secrets and credentials**

```bash
# Grep for common secret patterns in both repos (exclude node_modules, .git, fixtures)
grep -rn --include="*.ts" --include="*.js" --include="*.sh" --include="*.ps1" --include="*.json" --include="*.md" \
  -E "(password|passwd|secret|api_key|apikey|token|credential|private_key|BEGIN RSA|sk-[a-zA-Z0-9]{20})" \
  "C:/Users/Mizzo/Claude/AI-Code-Review-Agent/src" \
  "C:/Users/Mizzo/Claude/Personal-Memory-Bank/scripts" \
  2>/dev/null | grep -v "node_modules" | grep -v ".git" | grep -v "test" | grep -v "fixture"
```

Record every hit. Any real credential = Critical/Verified finding.

- [ ] **Step 2: Read .gitleaks.toml — check allow-list for over-broad patterns**

Read `C:\Users\Mizzo\Claude\Personal-Memory-Bank\.gitleaks.toml`. For each `allowlist` entry, ask: does this pattern exempt real secrets from scanning? A regex like `.*` or a path like `docs/` that contains working code examples = High finding.

- [ ] **Step 3: Check both .claude/settings.json for over-permissioned blocks**

Read both settings files. Check `permissions.allow` arrays. Flag any `Bash(rm:*)`, `Bash(*:*)`, `Bash(curl:*)`, or wildcard MCP permissions. Over-broad permissions = High/Verified finding.

- [ ] **Step 4: Verify secret scanning in CI**

Read `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\.github\workflows\release.yml`. Does it run gitleaks or equivalent before publishing? If not: High/Verified finding — secrets can be published to npm.

- [ ] **Step 5: Check .gitignore for secrets file coverage**

Read both `.gitignore` files. Verify these patterns are present: `.env`, `.env.*`, `*.pem`, `*.key`, `*.p12`, `.claude/settings.local.json`. Missing patterns = Medium finding.

- [ ] **Step 6: Read standards/SECRETS.md vs enforcement — check gap**

Read `C:\Users\Mizzo\Claude\Personal-Memory-Bank\standards\SECRETS.md`. Then read `C:\Users\Mizzo\Claude\Personal-Memory-Bank\scripts\dangerous-commands.sh`. Does the script enforce everything SECRETS.md declares? Every declared rule without a hook enforcement = Medium/Strong Evidence finding.

- [ ] **Step 7: Trace mb.sh shell input handling**

Read `C:\Users\Mizzo\Claude\Personal-Memory-Bank\scripts\mb.sh`. Find every place user input (arguments, file contents) is passed to shell commands. Check for unquoted variables, eval usage, or unsanitized path arguments. Any unquoted variable in a shell command = High/Verified finding.

- [ ] **Step 8: Review sanitizer.ts — coverage and bypass**

Read `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\src\core\sanitizer.ts`. List all 9 injection patterns it covers. Then check: (a) can an attacker embed instructions in a code comment that survives sanitization? (b) does `--no-sanitize` disable ALL sanitization with no warning? Record gaps.

- [ ] **Step 9: Inspect github.ts — token logging risk**

Read `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\src\adapters\github.ts`. Check: (a) is the GitHub token ever logged or included in error messages? (b) is the token validated for format before use? (c) what happens if the token is empty string vs undefined? Check the test at `tests/unit/adapters/github.test.ts` for coverage of these paths.

- [ ] **Step 10: Check ollamaProvider.ts — endpoint injection**

Read `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\src\core\llm\ollamaProvider.ts`. Is the Ollama base URL taken from config? Can it be set to an attacker-controlled URL via config file or CLI flag? If yes, is there any validation of the URL? An SSRF risk = High/Likely finding.

- [ ] **Step 11: Write all findings to staging file**

Write findings using the standard format to `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\docs\audit\staging\agent-1-security.md`. Start the file with:

```markdown
# Agent 1 — Security & Secrets Findings
**Date:** 2026-06-24
**Status:** Complete
**Finding count:** [N]

---
```

Then append each finding in the standard format. If a check produced no finding, write a one-line note: `> [ITEM]: No finding — [what was observed].`

---

## Task 2: Agent 2 — Reliability & Failure Modes

> **Dispatch as subagent. Scope: both repos.**

**Files to read:**
- `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\src\core\runner.ts`
- `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\src\core\agents\base.ts`
- `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\src\core\llm\ollamaProvider.ts`
- `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\src\core\ignoreFilter.ts`
- `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\src\cli\index.ts`
- `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\src\cli\exitCode.ts`
- `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\tests\unit\runner.test.ts`
- `C:\Users\Mizzo\Claude\Personal-Memory-Bank\scripts\pre-push-check.sh`
- `C:\Users\Mizzo\Claude\Personal-Memory-Bank\scripts\pre-push-check.ps1`
- `C:\Users\Mizzo\Claude\Personal-Memory-Bank\scripts\pre-compact-check.sh`
- `C:\Users\Mizzo\Claude\Personal-Memory-Bank\scripts\check-contract.sh`
- `C:\Users\Mizzo\Claude\Personal-Memory-Bank\scripts\mb.sh`
- `C:\Users\Mizzo\Claude\Personal-Memory-Bank\.claude\contracts\active-task.json`

**Output file:** `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\docs\audit\staging\agent-2-reliability.md`

- [ ] **Step 1: Trace Ollama-down failure path end-to-end**

Read `src\core\llm\ollamaProvider.ts`. Find the ping/connect logic. Then read `src\core\runner.ts` — find where OllamaProvider is used. Answer: if Ollama is not running, does the CLI (a) exit immediately with a clear error, (b) hang indefinitely, or (c) retry then exit? Is there a timeout? What is the exit code? No timeout + no clear error = High finding.

- [ ] **Step 2: Trace retry logic for LLM call failures**

In `src\core\runner.ts`, find `withRetryTimeout` or equivalent. Read the retry implementation: (a) does it retry on parse failure or only on network error? (b) is there a maximum retry cap? (c) is partial output from a failed attempt discarded or leaked into results? Unlimited retries or leaked partial output = High finding.

- [ ] **Step 3: Check base.ts parse-failure path**

Read `src\core\agents\base.ts`. Find the 3-stage JSON parse. For each stage: (a) what is logged on failure? (b) does failure return `[]` or throw? (c) is the raw LLM output ever accessible for debugging? Silent swallow with no log = Medium finding.

- [ ] **Step 4: Test ignoreFilter with malformed .aiignore**

Read `src\core\ignoreFilter.ts`. Check: what happens if `.aiignore` contains: (a) a line with only whitespace, (b) a regex metacharacter like `[invalid`, (c) a negation pattern `!foo` when no prior pattern matches foo, (d) a pattern that matches everything `**`. Does malformed input throw, silently ignore, or produce unexpected behavior? No error surfaced to user = Medium/Verified finding.

- [ ] **Step 5: Verify exit code propagation**

Read `src\cli\exitCode.ts` and `src\cli\index.ts`. Trace: when agents produce Critical findings and `--fail-on critical` is set, does the process exit with code 1? When all findings are Low and threshold is Critical, does it exit 0? Read `tests\unit\exitCode.test.ts` — are both paths tested? Missing exit code test = Medium finding.

- [ ] **Step 6: Check --fail-fast behavior**

In `src\core\runner.ts`, find the fail-fast implementation. Check: (a) does the runner stop cleanly without corrupting partial output already written to stdout? (b) if JSON format is selected and fail-fast triggers mid-output, is the JSON valid? (c) is the exit code correct when fail-fast triggers? Invalid JSON output on fail-fast = High finding.

- [ ] **Step 7: Read pre-push-check.sh — exit code and edge cases**

Read `C:\Users\Mizzo\Claude\Personal-Memory-Bank\scripts\pre-push-check.sh`. Check: (a) does `set -e` or equivalent appear? (b) what happens when the git diff command returns empty output (no staged files, no commits)? (c) what happens when a binary file is in the diff? (d) does CRLF line endings in .ps1 version cause issues on Windows? Script that exits 0 on empty diff = Medium finding. Missing `set -e` = Medium finding.

- [ ] **Step 8: Trace contract corruption path**

Read `C:\Users\Mizzo\Claude\Personal-Memory-Bank\scripts\check-contract.sh`. Read `C:\Users\Mizzo\Claude\Personal-Memory-Bank\.claude\contracts\active-task.json`. Check: (a) if `active-task.json` is empty or malformed JSON, does the script fail with a clear error or silently pass? (b) does the contract check run on every file write or only on commit? Silently passing on corrupt contract = Medium finding.

- [ ] **Step 9: Verify mb init idempotency**

Read `C:\Users\Mizzo\Claude\Personal-Memory-Bank\scripts\mb.sh`, find the `init` subcommand. Check: (a) does running `mb init` twice overwrite existing memory-bank files? (b) does it preserve user-edited content or reset it? (c) is there a `--force` flag or confirmation prompt before overwrite? Silent overwrite on second run = High finding.

- [ ] **Step 10: Check pre-compact-check.sh for false-positive risk**

Read `C:\Users\Mizzo\Claude\Personal-Memory-Bank\scripts\pre-compact-check.sh`. Check: (a) how does it detect staleness — regex on dates? (b) can an embedded date in a code example or quoted string trigger a false positive? (c) what is the impact of a false positive — does it block compaction entirely? False positive that blocks compaction = Medium finding.

- [ ] **Step 11: Write all findings to staging file**

Write findings to `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\docs\audit\staging\agent-2-reliability.md` using standard format.

---

## Task 3: Agent 3 — Architecture & Technical Debt

> **Dispatch as subagent. Scope: both repos.**

**Files to read:**
- `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\src\core\agents\base.ts`
- `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\src\core\agents\orchestrator.ts`
- `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\src\core\runner.ts`
- `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\src\core\contextLoader.ts`
- `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\src\core\policyFilter.ts`
- `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\src\core\profiles.ts`
- `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\src\core\config.ts`
- `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\src\core\schema.ts`
- `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\src\cli\index.ts`
- `C:\Users\Mizzo\Claude\Personal-Memory-Bank\scripts\mb.sh`
- `C:\Users\Mizzo\Claude\Personal-Memory-Bank\memory-bank\systemPatterns.md`
- `C:\Users\Mizzo\Claude\Personal-Memory-Bank\.claude\settings.json`

**Commands to run:**
```bash
# Count TypeScript `any` usages, @ts-ignore, eslint-disable
grep -rn "any\b\|@ts-ignore\|eslint-disable" \
  "C:/Users/Mizzo/Claude/AI-Code-Review-Agent/src" \
  --include="*.ts" | grep -v "node_modules"

# Check for Anthropic provider residue
grep -rn "anthropic\|AnthropicProvider\|@anthropic-ai" \
  "C:/Users/Mizzo/Claude/AI-Code-Review-Agent/src" \
  --include="*.ts"

# Count lines per source file (identify oversized files)
wc -l "C:/Users/Mizzo/Claude/AI-Code-Review-Agent/src"/**/*.ts 2>/dev/null || \
  find "C:/Users/Mizzo/Claude/AI-Code-Review-Agent/src" -name "*.ts" -exec wc -l {} \; | sort -rn | head -20

# Count PMB hooks and enforcement scripts
ls "C:/Users/Mizzo/Claude/Personal-Memory-Bank/scripts/"
```

**Output file:** `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\docs\audit\staging\agent-3-architecture.md`

- [ ] **Step 1: Map the ACR call graph and count abstraction layers**

Read `src\cli\index.ts` → `src\core\runner.ts` → `src\core\agents\base.ts` → `src\core\llm\ollamaProvider.ts`. Draw the call chain. Count distinct abstraction layers between CLI invocation and an HTTP request to Ollama. More than 4 layers without clear justification = Medium/Advisory finding. Document the actual chain.

- [ ] **Step 2: Evaluate BaseAgent scope — does it violate SRP?**

Read `src\core\agents\base.ts` in full. List every distinct responsibility it has (prompt construction, HTTP call, JSON parse stage 1, JSON parse stage 2, JSON parse stage 3, validation, retry, logging). If it has >3 distinct concerns = Medium/Strong Evidence finding. Note which concerns could be extracted without breaking the interface.

- [ ] **Step 3: Check for Anthropic/dead code residue**

Run:
```bash
grep -rn "anthropic\|AnthropicProvider\|@anthropic-ai" \
  "C:/Users/Mizzo/Claude/AI-Code-Review-Agent/src" \
  --include="*.ts"
```
Any hit = Medium/Verified finding. Document exact file and line.

- [ ] **Step 4: Count `any` types and lint suppressions**

Run:
```bash
grep -n ": any\b\|as any\b\|@ts-ignore\|eslint-disable" \
  "C:/Users/Mizzo/Claude/AI-Code-Review-Agent/src"/*.ts \
  "C:/Users/Mizzo/Claude/AI-Code-Review-Agent/src"/**/*.ts 2>/dev/null
```
More than 10 uses of `any` without justification = Medium finding. Every `@ts-ignore` = advisory.

- [ ] **Step 5: Read contextLoader.ts — is semantic embedding real or aspirational?**

Read `src\core\contextLoader.ts` in full. Does it actually invoke `nomic-embed-text` via Ollama? Or does it perform keyword/grep-style context selection? If semantic embedding is advertised but not implemented = High/Verified finding (false advertising). If not advertised but the name implies it = Medium/Advisory finding.

- [ ] **Step 6: Read policyFilter.ts — does it add value?**

Read `src\core\policyFilter.ts`. Count the lines. Find its test file (`tests\unit\policyFilter.test.ts`). Answer: (a) what exactly does it filter? (b) could this logic live in the orchestrator without a separate file? (c) is it actually invoked in the hot path? Untested filter with no clear value = Advisory finding.

- [ ] **Step 7: Read orchestrator.ts — dedup complexity**

Read `src\core\agents\orchestrator.ts`. Find the deduplication logic. Answer: (a) how does it determine two findings are duplicates? (b) is the dedup algorithm O(n²)? (c) is the cross-reference escalation logic readable in 5 minutes by a new developer? Complex dedup without a simpler alternative = Medium/Advisory finding.

- [ ] **Step 8: Evaluate PMB governance overhead**

Read `C:\Users\Mizzo\Claude\Personal-Memory-Bank\scripts\mb.sh`. Count the number of subcommands. Read `.claude\settings.json` — count the number of hook entries. Read `CLAUDE.md` in ACR — count governance rules (BLOCK/CONFIRM/WARN items). Calculate: total hook scripts × average lines per script. If total governance infrastructure exceeds 2000 lines for a solo developer's personal tooling = Medium/Advisory finding (overhead exceeds value).

- [ ] **Step 9: Identify PMB concept duplication**

Read the descriptions of: `mb doctor`, `mb status`, `/health-check` command, `/pmb-status` command. Write a one-sentence description of each. If any two descriptions overlap >50% = Medium finding (duplicated concept confuses users).

- [ ] **Step 10: Identify oversized source files**

List all ACR source files by line count (run the `wc -l` command above). Any file over 300 lines = flag for SRP review. Any file over 500 lines = Medium finding. Document the actual counts.

- [ ] **Step 11: Write all findings to staging file**

Write findings to `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\docs\audit\staging\agent-3-architecture.md` using standard format.

---

## Task 4: Agent 4 — Documentation & Developer Experience

> **Dispatch as subagent. Scope: both repos.**

**Files to read:**
- `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\README.md`
- `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\CHANGELOG.md`
- `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\CLAUDE.md`
- `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\.claude\commands\ai-review.md`
- `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\memory-bank\activeContext.md`
- `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\memory-bank\progress.md`
- `C:\Users\Mizzo\Claude\Personal-Memory-Bank\README.md`
- `C:\Users\Mizzo\Claude\Personal-Memory-Bank\install.sh`
- `C:\Users\Mizzo\Claude\Personal-Memory-Bank\scripts\init-memory-bank.sh`
- `C:\Users\Mizzo\Claude\Personal-Memory-Bank\memory-bank\activeContext.md`
- `C:\Users\Mizzo\Claude\Personal-Memory-Bank\CLAUDE.md`
- `C:\Users\Mizzo\Claude\Personal-Memory-Bank\docs\CONTRACTS-GUIDE.md`

**Commands to run:**
```bash
# ACR: get actual CLI help output
cd "C:/Users/Mizzo/Claude/AI-Code-Review-Agent" && node dist/cli/index.js --help 2>&1

# ACR: get actual test count
cd "C:/Users/Mizzo/Claude/AI-Code-Review-Agent" && npm test 2>&1 | grep "Tests "

# ACR: check git tags vs package.json version
cd "C:/Users/Mizzo/Claude/AI-Code-Review-Agent" && git tag | sort -V | tail -10
cd "C:/Users/Mizzo/Claude/AI-Code-Review-Agent" && node -e "const p=require('./package.json'); console.log(p.version)"

# PMB: check if install.sh is executable
ls -la "C:/Users/Mizzo/Claude/Personal-Memory-Bank/install.sh"
```

**Output file:** `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\docs\audit\staging\agent-4-docs-dx.md`

- [ ] **Step 1: Audit ACR memory bank for staleness (known seed finding)**

Run `npm test | grep "Tests "` and record actual test count. Read `memory-bank\activeContext.md` and note what it claims. The discrepancy between claimed and actual test count is a **Verified** finding. Also check `memory-bank\progress.md` — does it reflect 264 tests and v1.0.1?

Format as:
```
### Finding: ACR memory bank actively misreports test count
- Severity: Medium
- Confidence: Verified
- Repository: ACR
- Evidence: npm test shows [actual] tests; activeContext.md claims [claimed]
```

- [ ] **Step 2: Verify all CLI flags in --help match README**

Run `node dist/cli/index.js --help`. Read the README's CLI reference section. For every flag in `--help`, check it appears in README with the same name and description. For every flag in README, check it appears in `--help`. Any mismatch = Medium/Verified finding.

- [ ] **Step 3: Follow ACR README install steps literally**

Read the README's installation section. Simulate following each step in order. Flag: (a) any step that assumes a prerequisite not stated (e.g., "Ollama must be running" before it's mentioned), (b) any command that would fail on a fresh Windows machine, (c) any flag name in examples that doesn't match actual CLI (e.g., renamed flags). Each gap = Medium finding.

- [ ] **Step 4: Read /ai-review Claude command — accuracy check**

Read `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\.claude\commands\ai-review.md`. Check: (a) do the flags it references match current CLI (`--dir`, `--max-lines`, etc.)? (b) does it mention the correct number of agents (16)? (c) does it describe any removed features (e.g., `review` subcommand, old flag names)? Any stale reference = Medium/Verified finding.

- [ ] **Step 5: Check CHANGELOG vs git tags**

Run `git tag | sort -V | tail -10`. Read `CHANGELOG.md`. For each version tag, verify a CHANGELOG entry exists. For the current `package.json` version, verify it's tagged. Missing tag for published version = High finding. Missing CHANGELOG entry for a tag = Medium finding.

- [ ] **Step 6: Follow PMB install.sh literally**

Read `install.sh` and `scripts\init-memory-bank.sh`. Simulate following each step on a fresh Windows machine. Flag: (a) any Unix-only command with no Windows equivalent provided, (b) any hardcoded path, (c) any assumption about shell availability (bash vs zsh vs PowerShell), (d) failure to mention PMB's own prerequisite (that it must be cloned first). Each unacknowledged assumption = Medium finding.

- [ ] **Step 7: Check error message quality**

Read `src\cli\index.ts`. Find every `console.error` or `process.exit` call. For each: is the error message specific and actionable? Examples of bad messages: "Error: undefined", "Failed", "Something went wrong". Any non-actionable error message = Low/Verified finding.

- [ ] **Step 8: Read PMB activeContext — check staleness**

Read `C:\Users\Mizzo\Claude\Personal-Memory-Bank\memory-bank\activeContext.md`. Check the `last-reviewed` date. Check if the "Current Focus" section reflects the last known state (PMB infrastructure complete, ACR integration in progress). If the last-reviewed date is more than 14 days ago (staleness threshold is 14d per frontmatter) = Medium/Verified finding.

- [ ] **Step 9: Verify CLAUDE.md accuracy in ACR**

Read `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\CLAUDE.md`. Check: (a) does it reference the correct number of tests? (b) does it mention the 7-phase workflow? (c) does it describe the task contract protocol? (d) are all hook script paths correct? Any factually incorrect claim = Medium finding.

- [ ] **Step 10: Assess onboarding friction for a new contributor**

Read the ACR README as if you are a developer encountering the project for the first time. Time estimate: how long would setup take? Note every prerequisite (Node, npm, Ollama, devstral model download — 14GB). Flag: (a) if prerequisites aren't listed in order, (b) if the 14GB model download isn't called out upfront, (c) if there's no "quick start" path that works without Ollama. Missing model size callout = High/Strong Evidence finding (users will start setup and hit surprise).

- [ ] **Step 11: Write all findings to staging file**

Write findings to `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\docs\audit\staging\agent-4-docs-dx.md` using standard format.

---

## Task 5: Agent 5 — CI/CD & Test Coverage

> **Dispatch as subagent. Scope: ACR (PMB has no CI).**

**Files to read:**
- `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\.github\workflows\release.yml`
- `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\.github\workflows\review.yml`
- `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\.github\workflows\calibrate.yml`
- `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\tests\integration\e2e.test.ts`
- `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\tests\helpers\requireOllama.ts`
- `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\vscode-extension\package.json`
- All 34 unit test files in `tests\unit\`

**Commands to run:**
```bash
cd "C:/Users/Mizzo/Claude/AI-Code-Review-Agent"

# Run full check suite
npm run check 2>&1 | tail -20

# Run coverage
npm run test:coverage 2>&1 | tail -40

# Check what npm pack would include
npm pack --dry-run 2>&1

# Check vscode-extension has tests
ls vscode-extension/src/test/ 2>/dev/null || echo "no test dir"

# Check node version in CI vs package.json engines
grep -n "node-version" .github/workflows/*.yml
```

**Output file:** `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\docs\audit\staging\agent-5-ci-coverage.md`

- [ ] **Step 1: Run full check suite and record results**

```bash
cd "C:/Users/Mizzo/Claude/AI-Code-Review-Agent" && npm run check 2>&1
```

Record: (a) did all tests pass? (b) did typecheck pass? (c) did build succeed? (d) did format:check pass? Any failure = Critical/Verified finding. Any warning = Low finding.

- [ ] **Step 2: Run test coverage and identify gaps**

```bash
cd "C:/Users/Mizzo/Claude/AI-Code-Review-Agent" && npm run test:coverage 2>&1
```

Record coverage percentages for: statements, branches, functions, lines. Flag any file under 60% branch coverage. Flag any source file with 0% coverage. List the top 5 least-covered files. Coverage below 80% overall = High finding. Any agent without negative-path test = Medium finding.

- [ ] **Step 3: Read release.yml — check publish-before-test risk**

Read `.github\workflows\release.yml` in full. Answer: (a) does the `publish` job depend on a `test` job? (b) is there a `needs:` clause ensuring tests pass before npm publish? (c) does it test on the minimum declared Node version (18)? (d) does it use `npm publish` or `npm publish --access public`? Publishing without test gate = Critical/Verified finding.

- [ ] **Step 4: Check secret exposure in CI workflows**

Read all three workflow files. Check: (a) are secrets passed as env vars with `${{ secrets.NAME }}` syntax only (safe) or interpolated directly into shell strings `run: curl ${{ secrets.TOKEN }}` (injection risk)? (b) is `NPM_TOKEN` exposed in a log step? Any secret in shell string interpolation = High/Verified finding.

- [ ] **Step 5: Verify calibrate.yml Ollama-absent handling**

Read `calibrate.yml`. Find where it handles the case that Ollama is not running. Is there a `continue-on-error: true` or an explicit skip? Does it fail the workflow or produce a warning? Failing CI when Ollama isn't available = Medium finding (CI is unreliable without Ollama on the runner).

- [ ] **Step 6: Check vscode-extension in CI**

Read `release.yml` and `review.yml`. Does either workflow run `npm --prefix vscode-extension test`? If the extension has tests but they don't run in CI = High finding. Check if `vscode-extension/package.json` has a `test` script.

- [ ] **Step 7: Verify npm pack output**

```bash
cd "C:/Users/Mizzo/Claude/AI-Code-Review-Agent" && npm pack --dry-run 2>&1
```

Check that the packed files match `package.json` `"files"` field (`dist/`, `README.md`, `LICENSE`). Specifically: (a) are test files excluded? (b) are calibration fixtures excluded? (c) are `.claude/` settings files excluded? (d) is `vscode-extension/` excluded? Any sensitive or unnecessary file in the package = Medium finding.

- [ ] **Step 8: Identify agents with no negative-path tests**

For each agent test file in `tests\unit\`, check: does it contain a test case where the LLM returns malformed/empty/unexpected output? List any agent test file missing a parse-failure test case. Missing negative-path test = Medium finding per agent.

- [ ] **Step 9: Read integration test — assess real coverage**

Read `tests\integration\e2e.test.ts` and `tests\helpers\requireOllama.ts`. Answer: (a) how many distinct scenarios does the e2e test cover? (b) does it test fail-fast? (c) does it test --format json vs --format markdown? (d) does it test .aiignore? A single-scenario e2e test = Medium finding (insufficient integration coverage).

- [ ] **Step 10: Check NPM_TOKEN rotation**

Read ACR `memory-bank\activeContext.md` for the NPM_TOKEN expiry note (2026-09-08). Check: (a) is there a calendar reminder or CI job that warns before expiry? (b) is token rotation documented anywhere? No automated expiry warning = Medium finding.

- [ ] **Step 11: Write all findings to staging file**

Write findings to `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\docs\audit\staging\agent-5-ci-coverage.md` using standard format.

---

## Task 6: Agent 6 — Integration & Ecosystem Conflicts

> **Dispatch as subagent. Scope: both repos together.**

**Files to read:**
- `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\.claude\commands\` (all .md files)
- `C:\Users\Mizzo\Claude\Personal-Memory-Bank\.claude\commands\` (all .md files)
- `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\CLAUDE.md`
- `C:\Users\Mizzo\Claude\Personal-Memory-Bank\CLAUDE.md`
- `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\.claude\contracts\active-task.json`
- `C:\Users\Mizzo\Claude\Personal-Memory-Bank\.claude\contracts\active-task.json`
- `C:\Users\Mizzo\Claude\Personal-Memory-Bank\templates\.claude\contracts\active-task.json.example`
- `C:\Users\Mizzo\Claude\Personal-Memory-Bank\standards\WORKFLOW.md`
- `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\memory-bank\systemPatterns.md`
- `C:\Users\Mizzo\Claude\Personal-Memory-Bank\memory-bank\systemPatterns.md`

**Commands to run:**
```bash
# List all commands in both repos
ls "C:/Users/Mizzo/Claude/AI-Code-Review-Agent/.claude/commands/"
ls "C:/Users/Mizzo/Claude/Personal-Memory-Bank/.claude/commands/"

# Diff the CLAUDE.md files for divergence
diff "C:/Users/Mizzo/Claude/Personal-Memory-Bank/CLAUDE.md" \
     "C:/Users/Mizzo/Claude/AI-Code-Review-Agent/CLAUDE.md" | head -80

# Check standards/ divergence
diff <(ls "C:/Users/Mizzo/Claude/Personal-Memory-Bank/standards/") \
     <(ls "C:/Users/Mizzo/Claude/AI-Code-Review-Agent/standards/" 2>/dev/null || echo "") 2>/dev/null

# Check ACR version in PMB memory
grep -r "ai-code-review\|ACR\|1\.0\." "C:/Users/Mizzo/Claude/Personal-Memory-Bank/memory-bank/"
```

**Output file:** `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\docs\audit\staging\agent-6-integration.md`

- [ ] **Step 1: Map all duplicate commands between ACR and PMB**

List all `.md` files in both `.claude/commands/` directories (use PowerShell `Get-ChildItem` — bash glob has issues with `.claude` on Windows). For every filename that appears in both, read both versions. Check: (a) do they do the same thing? (b) does one delegate to the other? (c) do they conflict? Identical command with different behavior = High finding. Unexplained duplication = Medium finding.

- [ ] **Step 2: Read /change-review — verify ACR bridge**

Read `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\.claude\commands\change-review.md`. Find the ACR bridge section. Check: (a) does it reference the correct binary name (`ai-review-agent`)? (b) does it use current flag names? (c) is it documented as optional or required? Broken bridge reference = High/Strong Evidence finding.

- [ ] **Step 3: Identify terminology conflicts**

PMB uses `confidence: high/medium/low` (string) in memory bank frontmatter. ACR uses `confidence: 0–100` (integer) in `Finding` schema. Check: (a) is this distinction documented anywhere? (b) does any PMB template use a numeric confidence by mistake? (c) does ACR's CLAUDE.md or README confuse the two? Undocumented terminology conflict = Medium finding.

- [ ] **Step 4: Diff CLAUDE.md files — identify divergence**

Run the diff command above. Read the output. Classify each difference as: (a) intentional (ACR-specific content), (b) PMB template not synced to ACR (stale), or (c) contradictory (rules that conflict). Any category (c) = High finding. Any category (b) where the PMB template has a newer governance rule = Medium finding.

- [ ] **Step 5: Compare memory bank frontmatter schemas**

Read `activeContext.md` from both repos. Compare frontmatter fields. Check: (a) do both have `last-reviewed`? (b) do both have `staleness-threshold`? (c) do both have `compaction_generation`? (d) are the values comparable (both use `14d` as staleness threshold)? Schema inconsistency between repos = Medium finding.

- [ ] **Step 6: Check if ACR standards/ diverged from PMB**

Run the standards diff command. List files in PMB `standards/` but not in ACR `standards/` (or vice versa). For any file that exists in both, read the first 20 lines of each and check if they're diverged. Missing standard in ACR = Medium finding. Diverged standard = Medium finding.

- [ ] **Step 7: Check contract schema compatibility**

Read both `active-task.json` files and the PMB example template. Check: (a) do they share the same top-level fields (`task`, `scope`, `status`, `expires_at`)? (b) is the `status` enum consistent (`approved/complete/cancelled`)? (c) does ACR's contract validator accept PMB-generated contracts? Schema drift between repos = Medium finding.

- [ ] **Step 8: Test /code-review vs /ai-review conceptual overlap**

Read both command definitions. Answer: (a) to a new user, is it clear when to use each? (b) does PMB's `/code-review` invoke Claude Code's built-in review (cloud) while ACR's `/ai-review` uses Ollama (local)? (c) is this distinction clearly documented in both? Unclear distinction = High/DX finding.

- [ ] **Step 9: Check ACR version reference in PMB memory bank**

Run the grep command above. Does PMB's memory bank reference a specific ACR version? If yes, does it match the actual ACR version (1.0.1)? Does it reference the old package name (`ai-review` not `ai-review-agent`)? Stale version reference = Medium finding. Old package name = High finding (will fail on npm install).

- [ ] **Step 10: Identify consolidation opportunities**

Based on all findings in this agent, list the top 3 opportunities to reduce maintenance burden by consolidating duplicated functionality. For each: (a) what is duplicated, (b) which repo should own it, (c) what would the other repo reference?

- [ ] **Step 11: Write all findings to staging file**

Write findings to `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\docs\audit\staging\agent-6-integration.md` using standard format.

---

## Task 7: Consolidation — Final Report

> **Run AFTER Tasks 1–6 are all complete. Do NOT dispatch in parallel.**
> **Prerequisite:** All 6 staging files exist and contain `Status: Complete`.

**Files to read:**
- All 6 staging files in `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\docs\audit\staging\`
- `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\docs\superpowers\specs\2026-06-24-pre-production-audit-design.md`

**Output file:** `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\docs\audit\2026-06-24-pre-production-audit-report.md`

- [ ] **Step 1: Read all 6 staging files and collect all findings**

Read each staging file. Build a flat list of all findings. Record: title, severity, confidence, repository, agent source.

- [ ] **Step 2: Deduplicate**

For each pair of findings that share the same root cause, merge them into one finding. In the `Evidence` field, list both agents that identified it. In `Confidence`, use the higher of the two.

- [ ] **Step 3: Classify into 20 sections**

Assign every finding to one or more of the 20 report sections. A finding can appear in multiple sections (e.g., a security finding appears in both section 3 and section 10). Use this mapping:

- Critical Issues (§3): Severity = Critical
- High Priority (§4): Severity = High
- Medium Priority (§5): Severity = Medium
- Low Priority (§6): Severity = Low
- Missing Features (§7): tagged `missing-feature`
- Missing Guardrails (§8): tagged `missing-guardrail`
- Incorrect Guardrails (§9): tagged `wrong-guardrail`
- Security (§10): tagged `security`
- Reliability (§11): tagged `reliability`
- Performance (§12): tagged `performance`
- Documentation (§13): tagged `docs`
- DX (§14): tagged `dx`
- Integration (§15): tagged `integration`
- Architecture (§16): tagged `architecture`
- Technical Debt (§17): tagged `tech-debt`
- Quick Wins (§18): Effort = XS or S and Severity ≥ Medium
- Long-Term (§19): Effort = L or XL
- Verdict (§20): written fresh

- [ ] **Step 4: Write the final report**

Write to `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\docs\audit\2026-06-24-pre-production-audit-report.md` using this structure:

```markdown
# Pre-Production Readiness Audit Report
**Date:** 2026-06-24
**Auditor:** Claude Sonnet 4.6 (6-agent parallel audit)
**Repositories:** Personal-Memory-Bank v1.2.0 | AI-Code-Review-Agent v1.0.1
**Total Findings:** [N] ([C] Critical, [H] High, [M] Medium, [L] Low, [A] Advisory)

---

## 1. Executive Summary
[400 words max. Key findings, overall posture, top 3 risks.]

## 2. Overall Readiness Assessment
[Table: domain → rating → rationale]
| Domain | Rating | Key Risk |
|---|---|---|
| Security | ... | ... |
| Reliability | ... | ... |
| Architecture | ... | ... |
| Documentation | ... | ... |
| CI/CD | ... | ... |
| Integration | ... | ... |

## 3. Critical Issues (Must Fix)
[Each finding in full format]

## 4. High Priority Issues
...

## 5. Medium Priority Issues
...

## 6. Low Priority Issues
...

## 7. Missing Features
...

## 8. Missing Guardrails
...

## 9. Incorrect Guardrails
...

## 10. Security Concerns
...

## 11. Reliability Concerns
...

## 12. Performance Concerns
...

## 13. Documentation Issues
...

## 14. Developer Experience Issues
...

## 15. Integration Problems
...

## 16. Architecture Critique
...

## 17. Technical Debt
...

## 18. Quick Wins
[XS/S effort, Medium+ severity — prioritized list]

## 19. Long-Term Recommendations
...

## 20. Production Readiness Verdict
[One paragraph. Blunt. Is it ready? For what definition of "production"? What must change first?]
```

- [ ] **Step 5: Commit the final report**

```bash
cd "C:/Users/Mizzo/Claude/AI-Code-Review-Agent"
git add docs/audit/
git commit -m "docs: add pre-production readiness audit report 2026-06-24"
```

Expected: commit succeeds, no hook failures.

---

## Execution Notes

**Parallel dispatch:** Tasks 1–6 MUST be dispatched simultaneously using `superpowers:dispatching-parallel-agents`. Pass each task the exact files-to-read list, the commands to run, and the output staging file path. Do not run them sequentially — that defeats the purpose and exceeds context limits.

**Task 7 gate:** Do not start Task 7 until all 6 staging files contain `Status: Complete` in their header.

**Confidence labeling:** Every finding must carry one of: Verified (command run, output seen), Strong Evidence (code read, behavior clear), Likely (pattern match, untested), Speculative (inference only). Do not write findings without a confidence label.

**Null results:** If a check produces no finding, write a one-line note in the staging file: `> [CHECK NAME]: No finding — [observation].` Do not omit checks.
