# Round 2 Pre-Production Readiness Audit Report
**Date:** 2026-06-26
**Auditor:** Claude Sonnet 4.6 — 6-agent parallel audit (Round 2, Approach A: Regression + Discovery)
**Repositories:** Personal-Memory-Bank | AI-Code-Review-Agent v1.1.0
**Total Findings:** 37 (6 regressions, 31 new) — 1 Critical, 10 High, 13 Medium, 9 Low, 4 Advisory
**Round 1 baseline:** 48 findings (2026-06-24)

---

## 1. Executive Summary

Round 2 confirms that the Round 1 remediation sprint was incomplete. Of the 14 Round 1 fixes tracked,
**4 regressed outright**, **2 were partially applied**, and **1 was never touched**. Only 7 held cleanly.

The most alarming regression is the PreCompact hook. HOOKS-GUIDE.md was updated in Round 1 to claim
the hook "blocks compaction" (exits 2). That claim is false on Windows — the `|| true` suffix in
`settings.json` converts every non-zero exit to 0, meaning Claude Code sees a passing hook and compacts
anyway. The governance mechanism that this entire project depends on for context continuity does not work
as documented. CLAUDE.md still says "warns," HOOKS-GUIDE.md says "blocks," and the actual runtime
behaviour is "allows" on Windows. Three documents, three different answers, all of them misleading.

The formatting regression is a release blocker: 16 files fail `npm run check`. This means no tag push
can produce a successful npm publish today, regardless of any other fix. Round 1 fixed one file. Twenty
subsequent commits added and modified files without a pre-commit format gate.

The gitleaks supply-chain risk also regressed: the action was added in Round 1 remediation but was
never SHA-pinned. It runs with `contents: write` and `id-token: write` against a mutable `@v2` tag.
This is the highest-impact finding in the pipeline.

On the discovery side, Round 2 identified 31 genuinely new findings. The most serious are: the
vscode-extension subprocess lacks a wall-clock timeout (it hangs forever if Ollama stalls); the entire
`--context-mode semantic` code path has zero test coverage and silently degrades to no-context on
embedding failure; the MCP server has no stdin/signal shutdown handlers and leaks zombie processes on
client disconnect; and `validateFindings()` silently drops findings with no diagnostic output — making
it impossible to distinguish "LLM returned nothing" from "LLM returned things that all failed schema
validation."

The PMB suite added 124 tests and they all pass, but the doctor test suite mutates real repo files with
fragile rename-and-restore logic. An interrupted run corrupts the checkout permanently. This is a
correctness risk, not a style issue.

Overall trajectory: the project has more code, more CI, more documentation, and more tests than after
Round 1. It also has more surface area, more undocumented behaviour, and a governance layer that lies
about what it enforces. Forward progress is real; production readiness is not.

---

## 2. Overall Readiness Assessment

| Domain | Round 1 | Round 2 | Delta | Key Risk |
|---|---|---|---|---|
| Security | CAUTION | CAUTION | → | gitleaks @v2 floating; 0.0.0.0 allowlist; \|\| true defeats PreCompact |
| Reliability | CAUTION | CAUTION | ↓ | 16 files fail format:check; MCP hangs; extension subprocess no wall-clock timeout |
| Architecture | CAUTION | CAUTION | ↓ | BaseAgent 19 concerns; semantic path zero coverage; silent finding drops |
| Documentation | CAUTION | NOT READY | ↓ | HOOKS-GUIDE claims block; CLAUDE.md says warn; runtime allows; CHANGELOG missing sprint |
| CI/CD | NOT READY | NOT READY | → | gitleaks @v2; CI ext test no timeout; format:check fails = release blocked |
| Integration | CAUTION | CAUTION | → | MCP no shutdown; ollama:// scheme passes allowlist; 0.0.0.0 routes externally |

**Overall: NOT READY**

---

## 3. Critical Issues

### 3.1 Round 1 Regression Summary

| Round 1 Fix | Status | Severity | Notes |
|---|---|---|---|
| npm run check fix (1 file formatted) | ❌ Regressed | Critical | 16 files now failing; 20+ commits added unformatted files |
| OllamaProvider URL validation | ⚠️ Partial | High | 0.0.0.0 routes externally on Linux; ollama:// scheme not rejected; malformed URL throws raw TypeError |
| CLI try/catch | ✅ Held | — | Guard present; fragile string-prefix match (new Low finding) |
| matchPattern export | ✅ Held | — | Import correct; typecheck clean |
| check-contract scope fix | ✅ Held | — | Both formats handled; empty scope and null scope false-positive remains (new Low/Medium) |
| CONTRACTS-GUIDE.md creation | ⚠️ Partial | Medium | expires_at documented as informational; hook enforces it; PMB format omitted |
| HOOKS-GUIDE.md creation | ❌ Broken | High | Claims "exits 2 — blocks" but settings.json `\|\| true` ensures always exits 0 on Windows |
| /change-review --diff fix | ✅ Held | — | --diff flag wired; getDiff priority correct |
| --no-sanitize warning | ✅ Held | — | Uses stderr.write; sanitize !== false logic correct |
| gitleaks in release.yml | ❌ Regressed | High | @v2 floating tag never pinned to SHA |
| vscode-extension tests in CI | ⚠️ Partial | Critical | No timeout-minutes guard; tests pass today but future hang = 6-hour block |
| runner.ts decomposition | ✅ Held | — | Decomposition intact; test count 284 ≥ threshold |
| /code-review cloud disclosure | ✅ Held | — | Disclosure in description frontmatter |
| CLAUDE.md PreCompact wording | ❌ Not fixed | Medium | Still says "warns"; HOOKS-GUIDE says "blocks" (both wrong — runtime allows on Windows) |

### 3.2 Critical Findings

### Finding: 16 files fail format:check — release pipeline blocked
- **Tag:** [REGRESSION]
- **Severity:** Critical
- **Confidence:** Verified
- **Repository:** ACR
- **Evidence:** `npm run check` exits 1. Prettier `[warn]` lines: `src/cli/index.ts`, `src/core/runner.ts`, `tests/unit/cli.test.ts`, `.claude/commands/change-review.md`, `.claude/commands/feature-dev.md`, `docs/audit/2026-06-24-pre-production-audit-report.md`, 6 audit staging files, `docs/CONTRACTS-GUIDE.md`, `docs/HOOKS-GUIDE.md`, `docs/superpowers/plans/2026-06-26-round2-audit.md`, `docs/superpowers/specs/2026-06-26-round2-audit-design.md`
- **Reproduction:** `cd "C:/Users/Mizzo/Claude/AI-Code-Review-Agent" && npm run check`
- **Root Cause:** Round 1 fixed a single file. Twenty subsequent commits added and modified files without running Prettier. No pre-commit hook enforces formatting locally; the CI `format:check` step only catches drift at release tag push time.
- **Fix:** Run `npx prettier --write .` to clear current violations. Add a PostToolUse Prettier hook in `.claude/settings.json` so every Write/Edit auto-formats the file before the next check. Wire `npm run format:check` into a pre-commit hook as a secondary gate.
- **Impact:** The `Format check` step in `release.yml` fails on every tag push before reaching `npm publish`. This is a release blocker today.
- **Effort:** S

### Finding: CI vscode-extension test step has no timeout — release hangs up to 6 hours
- **Tag:** [REGRESSION]
- **Severity:** Critical
- **Confidence:** Strong Evidence
- **Repository:** ACR
- **Evidence:** `.github/workflows/release.yml` lines 40–41: `name: VS Code extension tests` / `run: npm run test:extension` — no `timeout-minutes:` on the step, no job-level `timeout-minutes:`. Independently verified by Agents 3 and 5. Agent 3 confirmed the current vitest suite passes in under 1 second; the missing timeout remains a concrete risk for any future hang.
- **Reproduction:** Add any `await new Promise(() => {})` test to `vscode-extension/tests/`, push a `v*.*.*` tag — release job hangs for up to 6 hours before GitHub Actions kills it.
- **Root Cause:** The Round 1 fix added the test step to `release.yml` without adding a `timeout-minutes:` guard. Tests happen to use vitest (not @vscode/test-electron) and run fast today; there is no hard bound preventing future hangs.
- **Fix:** Add `timeout-minutes: 5` to the VS Code extension tests step:
  ```yaml
  - name: VS Code extension tests
    timeout-minutes: 5
    run: npm run test:extension
  ```
- **Impact:** A single hanging test currently blocks an entire release for 6 hours. This is a concrete release-pipeline reliability failure.
- **Effort:** XS

---

## 4. High Priority Issues

### Finding: PreCompact `|| true` defeats block claim — compaction not blocked on Windows
- **Tag:** [REGRESSION]
- **Severity:** High
- **Confidence:** Verified
- **Repository:** Both
- **Evidence:** `docs/HOOKS-GUIDE.md` lines 85–86 (ACR): "Exits 2 — one or more checks fail. Compaction is blocked." `.claude/settings.json` (ACR) actual command: `pwsh -NonInteractive -File scripts/pre-compact-check.ps1 2>/dev/null || bash scripts/pre-compact-check.sh 2>/dev/null || true`. Same pattern in PMB `.claude/settings.json` and `templates/.claude/settings.json`. On Windows: pwsh exits 2 → bash fallback exits 127 (not found) → `|| true` fires → final exit 0. Claude Code sees 0 and compacts.
- **Reproduction:** On Windows, make `pre-compact-check.ps1` fail (remove a required memory-bank file). Verify `pre-compact-check.ps1` exits 2. Verify Claude Code still compacts (hook exit was 0 at the chain level).
- **Root Cause:** `|| true` was added as a fail-open safety net to prevent hook errors from blocking all work. This is appropriate for PostToolUse hooks. For PreCompact, it silently defeats the blocking behavior that the documentation promises. Round 1 updated HOOKS-GUIDE.md to say "blocks" without auditing whether the command chain actually produces exit 2.
- **Fix:** Remove `|| true` from the PreCompact hook command in all three `settings.json` files (ACR `.claude/settings.json`, PMB `.claude/settings.json`, PMB `templates/.claude/settings.json`). Change to: `"pwsh -NonInteractive -File scripts/pre-compact-check.ps1 2>/dev/null || bash scripts/pre-compact-check.sh 2>/dev/null"`. Also update CLAUDE.md (ACR) lines 24 and 140 from "warns" to "blocks compaction."
- **Impact:** The entire PreCompact governance mechanism — the primary safety net against context compaction without state capture — does not enforce its block on Windows. The project's principal reliability guarantee is currently documentation theatre.
- **Effort:** S

### Finding: gitleaks-action@v2 floating tag with contents:write and id-token:write
- **Tag:** [REGRESSION]
- **Severity:** High
- **Confidence:** Verified
- **Repository:** ACR
- **Evidence:** `.github/workflows/release.yml` line 44: `uses: gitleaks/gitleaks-action@v2` (mutable tag). Lines 14–16: `permissions: contents: write` and `id-token: write`. Independently verified by Agents 1 and 5.
- **Reproduction:** Inspect `.github/workflows/release.yml` line 44. No SHA pin present. The `v2` tag points to whatever commit the gitleaks maintainer most recently pushed.
- **Root Cause:** Round 1 added the gitleaks step during remediation without SHA-pinning. Floating version tags are the canonical GitHub Actions supply chain attack vector. The combination of a third-party floating action with `id-token: write` is specifically flagged in OpenSSF Scorecard checks.
- **Fix:** Resolve the current `v2` tag SHA: `gh api repos/gitleaks/gitleaks-action/git/ref/tags/v2 --jq '.object.sha'`. Replace line 44 with `uses: gitleaks/gitleaks-action@<full-40-char-sha> # v2.x.y`. Add `.github/dependabot.yml` with `package-ecosystem: github-actions` on a weekly schedule.
- **Impact:** A compromised `gitleaks/gitleaks-action` repository can execute arbitrary code in the release pipeline and gain `contents: write` + `id-token: write` — exfiltrating `NPM_TOKEN`, publishing a backdoored npm package with provenance attestation, or rewriting repo history.
- **Effort:** XS

### Finding: 0.0.0.0 in Ollama allowlist permits externally-bound Ollama instances
- **Tag:** [NEW]
- **Severity:** High
- **Confidence:** Strong Evidence
- **Repository:** ACR
- **Evidence:** `src/core/llm/ollamaProvider.ts:11` — `['localhost', '127.0.0.1', '::1', '0.0.0.0'].includes(hostname)`. The constructor error message explicitly states "Remote Ollama instances are not supported (SSRF risk)" while simultaneously allowlisting a destination that routes to non-loopback interfaces on Linux.
- **Reproduction:** On Linux, start Ollama with `OLLAMA_HOST=0.0.0.0:11434`. Set `ollamaUrl: "http://0.0.0.0:11434"` in config. The allowlist passes; diff content (potentially containing proprietary source code) is transmitted to the externally-reachable service.
- **Root Cause:** `0.0.0.0` as a bind address means "all interfaces." As a destination address on Linux it resolves to the first available non-loopback interface. The intent of the allowlist (localhost-only) is contradicted by including this address.
- **Fix:** Remove `'0.0.0.0'` from the allowlist. Add guidance in the error message: "If Ollama is bound to 0.0.0.0, connect via http://127.0.0.1:11434 instead."
- **Impact:** Closes the path where diff content is transmitted to an externally-accessible Ollama instance while the allowlist check falsely signals compliance. One-line fix.
- **Effort:** XS

### Finding: Extension subprocess has no wall-clock timeout — hangs indefinitely if Ollama stalls
- **Tag:** [NEW]
- **Severity:** High
- **Confidence:** Verified
- **Repository:** ACR
- **Evidence:** `vscode-extension/src/runner.ts` lines 60–113 — `spawnCli` creates a Promise that resolves only on `child.on('close', ...)`. No `setTimeout` or `AbortSignal` wrapping the child process. The `--timeout` CLI flag bounds per-agent Ollama request timeouts, not the total subprocess wall time.
- **Reproduction:** Configure Ollama URL to a TCP port that accepts connections but never responds. Trigger "AI Review: Review Staged Changes." Observe: spinner runs forever until VS Code window is closed.
- **Root Cause:** The cancellation token (user clicks Cancel) is the only escape path. No wall-clock guard kills the child after N seconds.
- **Fix:** In `spawnCli`, after spawning:
  ```ts
  const WALL_CLOCK_MS = (config.timeoutSecs + 30) * 1000
  const timer = setTimeout(() => {
    child.kill()
    reject(new Error(`wall-clock-timeout:${config.timeoutSecs}s`))
  }, WALL_CLOCK_MS)
  child.on('close', () => { clearTimeout(timer); /* existing logic */ })
  ```
- **Impact:** VS Code becomes unresponsive due to a frozen Ollama instance or CLI deadlock. Worst-case hang is unbounded.
- **Effort:** S

### Finding: BaseAgent violates SRP with 19 distinct concerns
- **Tag:** [NEW]
- **Severity:** High
- **Confidence:** Verified
- **Repository:** ACR
- **Evidence:** `src/core/agents/base.ts:52–149` — 2 concerns in `run()`, 1 in `buildUserPrompt()`, 9 in `parseFindings()` + `extractJsonArray()`, 10 in `validateFindings()`. Full enumeration: LLM dispatch, message array construction, prompt construction, code-fence stripping, 3 JSON parse stages, balanced-bracket extraction, error logging, structural validation, 2 field aliases, confidence clamping, confidence defaulting, ID stamping, domain defaulting, blocking defaulting, source defaulting, lineEnd clamping.
- **Reproduction:** Read `src/core/agents/base.ts` in full and count concerns per method.
- **Root Cause:** The class was grown incrementally. Each new requirement was added to existing methods rather than extracted into collaborator classes. Round 1 deferred this.
- **Fix:** Extract three collaborators: `FindingParser` (parse stages + code-fence stripping), `FindingNormalizer` (aliasing, defaulting, clamping, ID stamping), `FindingValidator` (structural type-check filter). `BaseAgent` delegates to all three.
- **Impact:** `validateFindings()` is private and cannot be tested in isolation. The 19-concern god-method makes adding new normalisation rules high-risk. Extraction unlocks direct unit tests for each collaborator.
- **Effort:** M

### Finding: --context-mode semantic silently degrades to no-context when embedding fails
- **Tag:** [NEW]
- **Severity:** High
- **Confidence:** Verified
- **Repository:** ACR
- **Evidence:** `src/core/embedder.ts:14–20` — catch block and `!res.ok` both return `null` with no log. `src/core/contextLoader.ts:125–127` — `if (!diffEmbedding) return empty()` with no log. `src/core/runner.ts:394–407` — no fallback to static `loadAgentContext`; empty content → no context injected.
- **Reproduction:** Stop Ollama or unload `nomic-embed-text`. Run `ai-review-agent --context memory-bank --context-mode semantic`. Review completes silently with no context injected; no warning on stderr.
- **Root Cause:** `embed()` returns `null` on any failure; `loadAgentContextSemantic` gates on null and returns empty with no log and no fallback to static context.
- **Fix:** (1) In `loadAgentContextSemantic` when `!diffEmbedding`: emit `console.warn('[contextLoader] embedding failed — falling back to static context selection')` and call `loadAgentContext(...)`. (2) In `embed()`, log HTTP status on non-ok: `console.warn('[embed] HTTP ${res.status}')`.
- **Impact:** Users relying on `--context-mode semantic` silently receive the same review quality as `--context none`. The degradation is invisible.
- **Effort:** S

### Finding: loadAgentContextSemantic and embed() have zero test coverage
- **Tag:** [NEW]
- **Severity:** High
- **Confidence:** Verified
- **Repository:** ACR
- **Evidence:** `npm run test:coverage` output: `contextLoader.ts` lines 113–174 uncovered (the entire `loadAgentContextSemantic` function). `embedder.ts` lines 7–21 uncovered (the entire `embed()` HTTP function). `tests/unit/contextLoader.test.ts:4` imports only `loadAgentContext`, never `loadAgentContextSemantic`. No test file imports `embed`.
- **Reproduction:** `npm run test:coverage 2>&1 | grep -A 3 "contextLoader"` — 0% coverage on lines 113-174.
- **Root Cause:** `loadAgentContextSemantic` was implemented as a feature; the HTTP dependency made it harder to unit test without mocking. No tests were written.
- **Fix:** Add `tests/unit/embedder.test.ts` with mocked `fetch`. Extend `tests/unit/contextLoader.test.ts` with mocked `embed`. Cover: successful embed ranks files by cosine similarity; embed returns null → returns empty; network error → returns empty; missing memory-bank directory → returns empty.
- **Impact:** The entire `--context-mode semantic` code path — including the silent-degradation bug above — is currently unverified. Any regression ships without detection.
- **Effort:** M

### Finding: Doctor tests mutate real repo directory with fragile restore logic
- **Tag:** [NEW]
- **Severity:** High
- **Confidence:** Verified
- **Repository:** PMB
- **Evidence:** `tests/test-mb-doctor.sh` lines 93–96, 122–127, 361–366, 373–382 — check 0 renames `$REPO_ROOT/VERSION` to `VERSION.bak`; check 2 renames `$REPO_ROOT/templates/memory-bank/`; check 13 renames `$REPO_ROOT/fixtures/security/SEC-001-hardcoded-secret`; check 14 creates 15 extra files in `$REPO_ROOT/standards/`. Restore is via `trap EXIT`, not SIGKILL-safe.
- **Reproduction:** Kill the test process (SIGKILL or machine hibernation) while between rename and restore in check 0. `$REPO_ROOT/VERSION` is absent from the real repo permanently until manually restored.
- **Root Cause:** The doctor checks test behaviour contingent on files in the PMB template repo itself. Rather than staging a private copy in tmpdir, the tests rename real repo assets. `trap EXIT` protects against clean exits only.
- **Fix:** Copy (not rename) target files to a backup path within tmpdir before each check, restore from the copy. For check 14, write extra standards files to a temp standards dir and point `MB_HOME` at that temp copy.
- **Impact:** Interrupted test run corrupts the real PMB checkout. Also prevents future parallelisation of the test suite.
- **Effort:** M

---

## 5. Medium Priority Issues

### Finding: CLAUDE.md says PreCompact hook "warns" when it exits 2 (or exits 0 via || true)
- **Tag:** [REGRESSION]
- **Severity:** Medium
- **Confidence:** Verified
- **Repository:** ACR
- **Evidence:** `CLAUDE.md` line 24: "The `PreCompact` hook fires first and **warns** if neither the memory bank nor a handoff has been captured this session." `CLAUDE.md` line 140: "the `PreCompact` hook **warns** first if memory bank is stale." Both use "warns." `scripts/pre-compact-check.sh` line 66 exits 2 (intended block). `docs/HOOKS-GUIDE.md` correctly says "Compaction is blocked." The actual runtime on Windows is exit 0 (see Section 4 finding on `|| true`). Round 1 fixed HOOKS-GUIDE.md but not CLAUDE.md.
- **Reproduction:** Read `CLAUDE.md` lines 24 and 140 — both say "warns." Read `pre-compact-check.sh` line 66 — `exit 2`. Run the settings.json chain on Windows — final exit 0.
- **Root Cause:** Round 1 fix was applied only to `docs/HOOKS-GUIDE.md`, not to `CLAUDE.md`. Neither document accurately reflects the runtime behaviour (see High finding on `|| true`).
- **Fix:** In `CLAUDE.md` line 24, change "warns if" → "blocks compaction if". In `CLAUDE.md` line 140, change "warns first if" → "blocks compaction if". Then apply the `|| true` fix from Section 4 to make the documentation accurate.
- **Impact:** Claude reads CLAUDE.md every session. Believing the hook "warns" causes Claude to advise proceeding despite PreCompact failures, compacting without state capture.
- **Effort:** XS

### Finding: CONTRACTS-GUIDE.md claims expires_at is informational but hook enforces it
- **Tag:** [NEW]
- **Severity:** Medium
- **Confidence:** Verified
- **Repository:** ACR
- **Evidence:** `docs/CONTRACTS-GUIDE.md` line 101: "`expires_at` is informational; the hook does not check clock time." `scripts/check-contract.sh` lines 77–93 perform a live UTC clock check. `scripts/check-contract.ps1` lines 53–65 perform the same via `[datetime]::UtcNow`. When expired, the hook emits "CONTRACT EXPIRED" and exits 0, silently stopping scope enforcement.
- **Reproduction:** Set `expires_at` to any past ISO 8601 datetime. Trigger a Write outside declared scope. Expect scope warning — instead get expiry warning and no scope enforcement.
- **Root Cause:** Guide was written before expiry enforcement was added to the hook scripts and not updated.
- **Fix:** Replace line 101 with: "`expires_at` is actively enforced. When UTC time exceeds this value, the hook emits CONTRACT EXPIRED and scope enforcement is suspended for that session."
- **Impact:** Users believe expired contracts continue to enforce scope. Silently stops protecting scope after expiry.
- **Effort:** XS

### Finding: Silent zero-finding return when all stage-1 items fail validation
- **Tag:** [NEW]
- **Severity:** Medium
- **Confidence:** Verified
- **Repository:** ACR
- **Evidence:** `src/core/agents/base.ts:58–68` — guard `valid.length > 0 || parsed.length === 0` allows fall-through without logging when a non-empty parsed array produces 0 valid findings. The error log at line 81 is unreachable in this case.
- **Reproduction:** Mock `provider.chat` to return a finding missing the `basis` field. Call `agent.run(input)`. Returns `[]` with no console output.
- **Root Cause:** The fall-through condition does not handle the third case: "parse succeeded but validation rejected everything."
- **Fix:** After line 60, add:
  ```typescript
  if (parsed.length > 0) {
    console.error(`[${this.name}] ${parsed.length} item(s) parsed but 0 passed validation. First item: ${JSON.stringify(parsed[0]).slice(0, 200)}`)
  }
  ```
- **Impact:** Impossible to distinguish "LLM returned empty array" from "LLM returned findings with wrong schema" without this log.
- **Effort:** XS

### Finding: validateFindings drops items silently with no diagnostic output
- **Tag:** [NEW]
- **Severity:** Medium
- **Confidence:** Verified
- **Repository:** ACR
- **Evidence:** `src/core/agents/base.ts:115–148` — `.filter()` at line 117 drops invalid items with no `console.warn`/`console.error` call. No count is logged.
- **Reproduction:** Mock LLM to return 5 findings, 3 missing `basis` field. Call `agent.run()`. Observe: 2 findings returned, no indication 3 were dropped.
- **Root Cause:** The filter was written for correctness, not debuggability.
- **Fix:** After the `.filter()`, compare lengths:
  ```typescript
  if (items.length > valid.length) {
    console.warn(`[${this.name}] validateFindings: ${items.length - valid.length} of ${items.length} findings dropped (missing required fields)`)
  }
  ```
- **Impact:** Cannot distinguish "agent found nothing" from "agent found things but schema broke." Critical for diagnosing prompt regressions.
- **Effort:** XS

### Finding: OllamaProvider constructor throws unhandled TypeError on malformed URLs
- **Tag:** [NEW]
- **Severity:** Medium
- **Confidence:** Verified
- **Repository:** ACR
- **Evidence:** `src/core/llm/ollamaProvider.ts:10` — `const { hostname } = new URL(baseUrl)` with no surrounding try/catch. Input like `'not-a-url'` throws `TypeError: Invalid URL` with no context-specific message.
- **Reproduction:** `new OllamaProvider('not-a-url', 'devstral:latest')` — unhandled TypeError propagates to CLI error handler with no hint about which parameter was wrong.
- **Root Cause:** URL parsing on line 10 has no try/catch. The allowlist check that follows it is the intended security gate, but unparseable inputs bypass it.
- **Fix:** Wrap `new URL(baseUrl)` in try/catch; rethrow with: `throw new Error('Invalid Ollama URL "${baseUrl}". Expected e.g. http://localhost:11434')`.
- **Impact:** Users who pass a malformed URL get a raw stack trace instead of an actionable error message.
- **Effort:** XS

### Finding: Null scope field in contract causes spurious warning or hard block on all writes
- **Tag:** [NEW]
- **Severity:** Medium
- **Confidence:** Verified
- **Repository:** PMB
- **Evidence:** `scripts/check-contract.ps1:38–45` — scope extraction falls to `else` branch for `$null`, setting `$scopeFiles = $null`. `foreach ($pattern in $null)` iterates zero times, leaving `$inScope = $false`, triggering the warning. If `PMB_CONTRACT_HARD_BLOCK=1`, the write is blocked entirely.
- **Reproduction:** Write `.claude/contracts/active-task.json` with `{"status": "active", "task": "Fix typo", "expires_at": "2099-01-01T00:00:00Z"}` (no `scope` field). Trigger any Write tool call. Hook warns "outside the active contract" with empty scope list.
- **Root Cause:** No explicit `$null` branch in scope extraction. A contract omitting `scope` (legitimate for non-file tasks or incomplete drafts) is treated as maximally restrictive.
- **Fix:** After scope extraction, add: `if (-not $scopeFiles) { exit 0 }` in the PS1 and the equivalent in the .sh. Treats missing `scope` as "no restriction declared."
- **Impact:** False-positive warnings or hard blocks on all writes for any contract without a declared scope. Trains users to dismiss scope warnings, eroding signal value.
- **Effort:** XS

### Finding: PSScriptAnalyzer enforces only Error severity — Warning/Information bypassed
- **Tag:** [NEW]
- **Severity:** Medium
- **Confidence:** Verified
- **Repository:** PMB
- **Evidence:** `.github/workflows/pmb-health.yml` line 270: `Invoke-ScriptAnalyzer -Path $_ -Severity Error`. Warning-level findings (e.g., `PSAvoidUsingCmdletAliases`, `PSUseShouldProcessForStateChangingFunctions`) are silently ignored.
- **Reproduction:** Introduce a Warning-level PSScriptAnalyzer issue in any `.ps1` file in `scripts/` or `templates/scripts/`. The CI lint job passes without flagging it.
- **Root Cause:** Severity was set conservatively to avoid noise during initial CI setup. Never revisited.
- **Fix:** Change to `-Severity Error,Warning` or add `-ExcludeRule` for specific rules intentionally accepted rather than silencing the entire Warning category.
- **Impact:** Real bugs detectable at Warning severity (alias use, incorrect string escaping) are not caught.
- **Effort:** XS

### Finding: Check 5 (Token Budget drift) permanently skipped on Windows Git Bash
- **Tag:** [NEW]
- **Severity:** Medium
- **Confidence:** Verified
- **Repository:** PMB
- **Evidence:** `tests/test-mb-doctor.sh` lines 236–239: explicit `SKIP`. `grep -c` in Git Bash exits 1 on zero matches (POSIX-compliant), causing `|| echo 0` to fire even though grep already emitted `0`. Result is `0\n0` stored in variable; `[ "$x" -eq 0 ]` fails with "integer expected."
- **Reproduction:** `bash -c 'result=$(grep -c "NOMATCH_XYZ" /dev/null 2>/dev/null || echo 0); echo "result=|$result|"; [ "$result" -eq 0 ] && echo OK || echo FAIL'` — outputs `result=|0\n0|` and `integer expected`.
- **Root Cause:** `grep -c` exits 1 on no-match per POSIX, but the `|| echo 0` fallback is intended only for "grep not found." Both paths now produce output, resulting in a two-line value.
- **Fix in mb.sh:** Replace `$(grep -c "PATTERN" file 2>/dev/null || echo 0)` with `$(awk '/PATTERN/{c++}END{print c+0}' file)`. Remove the SKIP and add an actual test.
- **Impact:** Check 5 is currently untested. On Windows, users running `mb doctor` with Token Budget drift conditions see bash errors rather than clean warnings.
- **Effort:** S

### Finding: Test suite takes 4+ minutes on Windows (CI wall-time risk)
- **Tag:** [NEW]
- **Severity:** Medium
- **Confidence:** Verified
- **Repository:** PMB
- **Evidence:** `bash tests/run.sh` — real: 4m4.202s; doctor suite alone: real 3m45.346s (measured on Windows Git Bash). Doctor suite runs `mb doctor` 25+ times across 24 check tests.
- **Reproduction:** `cd "C:/Users/Mizzo/Claude/Personal-Memory-Bank" && time bash tests/run.sh`
- **Root Cause:** Each `mb doctor` invocation on Windows Git Bash pays significant process-spawn overhead. The `grep -qF` subprocess pattern fires per cache entry per window inside the O(n) cache loop.
- **Fix:** (a) Refactor doctor tests to test multiple checks per `mb doctor` invocation where test setup is compatible. (b) Replace `echo "$x" | grep -qF "$pattern"` inner-loop patterns with bash `[[ $var == *"$pattern"* ]]`.
- **Impact:** 4-minute local test runs discourage running tests before commit. CI (Linux) unaffected.
- **Effort:** M

### Finding: ACR activeContext.md test count stale (276 vs 284 actual)
- **Tag:** [NEW]
- **Severity:** Medium
- **Confidence:** Verified
- **Repository:** ACR
- **Evidence:** `memory-bank/activeContext.md` line 23: "276 unit tests passing." `npm test` output: `Tests 284 passed (284)`. Remediation commits added 8 tests not reflected in the file.
- **Reproduction:** `npm test 2>&1 | grep "Tests "` → 284. Read `memory-bank/activeContext.md` → 276.
- **Root Cause:** Memory bank was last updated for v1.1.0. Round 1 audit remediation commits added CLI unit tests without a memory bank update.
- **Fix:** Update `memory-bank/activeContext.md` line 23 to "284 unit tests passing." Update Key Commands block. Update "276 unit tests" bullet to 284.
- **Impact:** Claude reads the memory bank at session start. Stale test count causes Claude to cite incorrect project health metrics.
- **Effort:** XS

### Finding: ACR progress.md missing remediation sprint entries and stale test count
- **Tag:** [NEW]
- **Severity:** Medium
- **Confidence:** Verified
- **Repository:** ACR
- **Evidence:** `memory-bank/progress.md` lines 68–70: "Unit Tests: 276 passing across 34 test files" and "Total: 276." Actual: 284. Version History table has no entry for the Round 1 audit remediation sprint (commits `7f87887`, `a2ac47d`, `47ea2b9`, `1243e2c` — all 2026-06-26). Frontmatter shows `last-reviewed: 2026-06-25` but prose says "Last Updated: 2026-06-15."
- **Reproduction:** Read `memory-bank/progress.md` Metrics section. Run `npm test`.
- **Root Cause:** `progress.md` prose was not updated after the remediation sprint. The PostToolUse hook updates `last-reviewed` frontmatter on any edit, masking the staleness of the prose content.
- **Fix:** Update Metrics section to 284 tests, 35 test files. Add version row for remediation sprint (v1.1.0+audit 2026-06-26) covering the 8 commits.
- **Impact:** Accumulated inaccuracy in the primary progress tracker.
- **Effort:** S

### Finding: CHANGELOG missing Round 1 audit remediation sprint entry
- **Tag:** [NEW]
- **Severity:** Medium
- **Confidence:** Verified
- **Repository:** ACR
- **Evidence:** `CHANGELOG.md` contains entries for `[1.1.0]` (2026-06-25) and `[1.0.0]` (2026-06-24) but no `[1.1.1]` or `[1.0.1]` entry. Six remediation commits landed on 2026-06-26 covering SSRF validation, CLI error handling, gitleaks scan in release.yml, vscode-extension CI, CONTRACTS-GUIDE.md, HOOKS-GUIDE.md, SwarmRunner decomposition, 8 new CLI unit tests.
- **Reproduction:** `grep "\[1\." CHANGELOG.md` → only `[1.1.0]` and `[1.0.0]`. `git log --oneline --since="2026-06-24"` → 10+ commits not in CHANGELOG.
- **Root Cause:** Remediation sprint did not include a CHANGELOG update.
- **Fix:** Add a `[1.1.1]` CHANGELOG entry covering all remediation work including security fixes (SSRF, gitleaks).
- **Impact:** Users upgrading from 1.0.0 have no record of security fixes applied in the sprint.
- **Effort:** S

### Finding: PMB README says "mb doctor (20 checks)" but doctor has 24 checks
- **Tag:** [NEW]
- **Severity:** Medium
- **Confidence:** Verified
- **Repository:** PMB
- **Evidence:** `README.md` line 113: `mb doctor (20 checks)`. `README.md` line 75: `mb doctor  Full 24-point diagnostic`. `.claude/commands/health-check.md` description: "mb doctor (24 checks)." Two internal references say 24; the external README table says 20.
- **Reproduction:** `grep -n "20\|24" README.md` → internal inconsistency on the same page.
- **Root Cause:** `/health-check` description in README was not updated when doctor expanded from 20 to 24 checks.
- **Fix:** Update `README.md` line 113 from `mb doctor (20 checks)` to `mb doctor (24 checks)`.
- **Impact:** Internal inconsistency in the same file erodes trust in documentation accuracy.
- **Effort:** XS

### Finding: PMB README omits mb preflight and mb change-check from command documentation
- **Tag:** [NEW]
- **Severity:** Medium
- **Confidence:** Verified
- **Repository:** PMB
- **Evidence:** `README.md` Features table (line 18): "9 primary commands." `scripts/mb.ps1` ValidateSet and `scripts/mb.sh` help output both include `preflight` and `change-check`. `docs/QUICK-REFERENCE.md` documents both. README Day-to-Day Commands section and Features table: no mention of either command.
- **Reproduction:** `grep -n "preflight\|change-check" README.md` → no matches.
- **Root Cause:** Both commands were added during a sprint that updated QUICK-REFERENCE.md but not README.md.
- **Fix:** Add both commands to the Day-to-Day Commands section and update the Features table count from "9" to "11 primary commands."
- **Impact:** First-time users cannot discover two workflow-critical commands from the README.
- **Effort:** XS

---

## 6. Low Priority Issues

### Finding: check-contract empty scope array triggers spurious out-of-scope warning
- **Tag:** [NEW]
- **Severity:** Low
- **Confidence:** Verified
- **Repository:** PMB
- **Evidence:** `scripts/check-contract.sh` lines 110–132: when `SCOPE_FILES` is empty (from `"scope": []`), the `while` loop body never executes. `IN_SCOPE` stays 0. Line 134 fires "out of scope" warning with empty "Declared scope:" field.
- **Reproduction:** Write `.claude/contracts/active-task.json` with `"scope": []`. Trigger any Write tool call. Hook warns "out of scope" for every file.
- **Root Cause:** No early-exit guard for empty scope. Cannot distinguish "scope not yet declared" from "scope enforced and empty."
- **Fix:** In `check-contract.sh`, add after `SCOPE_FILES` extraction: `if [ -z "$SCOPE_FILES" ]; then exit 0; fi`. In `check-contract.ps1`, add: `if (-not $scopeFiles -or $scopeFiles.Count -eq 0) { exit 0 }`.
- **Impact:** False-positive scope warnings on every write when a contract has no declared scope. Trains users to ignore warnings.
- **Effort:** XS

### Finding: CONTRACTS-GUIDE.md omits PMB scope format
- **Tag:** [NEW]
- **Severity:** Low
- **Confidence:** Verified
- **Repository:** ACR
- **Evidence:** `docs/CONTRACTS-GUIDE.md` lines 17–29 document only `"scope": [{"file": "...", "op": "..."}]`. Hook scripts explicitly handle `"scope": {"files": ["path"]}` (PMB format) at `check-contract.sh` lines 39–40 and `check-contract.ps1` lines 41–42.
- **Reproduction:** Read CONTRACTS-GUIDE — zero mention of `scope.files`, the PMB format, or dual-format support.
- **Root Cause:** PMB scope format support was added to hooks without updating the guide.
- **Fix:** Add a "Scope Formats" subsection documenting both formats with examples. Note that ACR canonical is preferred for new contracts.
- **Impact:** Cross-repo contract portability is undocumented. Users encounter PMB-format contracts from other projects without guide context.
- **Effort:** XS

### Finding: CLI re-throw guard uses fragile string-prefix match
- **Tag:** [NEW]
- **Severity:** Low
- **Confidence:** Strong Evidence
- **Repository:** ACR
- **Evidence:** `src/cli/index.ts` line 252: `err.message.startsWith('process.exit(')`. Any real dependency throwing `Error('process.exit(1) was called unexpectedly')` propagates uncaught instead of being caught and printed via `process.stderr.write`.
- **Reproduction:** Inside the try block, `throw new Error('process.exit(0) was reported internally')` — propagates uncaught as an unhandled rejection.
- **Root Cause:** Guard was added to pass synthetic process.exit mocks in tests using a plain string match. A sentinel subclass would be unambiguous.
- **Fix:** Define `class SyntheticExitError extends Error {}` in the test mock, replace the synthetic throw, change the catch guard to `if (err instanceof SyntheticExitError) throw err`.
- **Impact:** Extremely unlikely in practice. Fragile pattern that could mask real errors.
- **Effort:** S

### Finding: basis→evidence aliasing undocumented; filter rejects evidence-only findings
- **Tag:** [NEW]
- **Severity:** Low
- **Confidence:** Verified
- **Repository:** ACR
- **Evidence:** `src/core/agents/base.ts:115–148` — filter validates `f.basis` (line 121) but map produces `evidence` via `f.evidence ?? f.detail ?? ''`. A finding with `evidence` but without `basis` is rejected even though `evidence` is the current canonical field name. The `...f` spread also propagates the raw `basis` field alongside the normalized `evidence` field on output.
- **Reproduction:** Send a finding with `{ evidence: "src/x.ts:10", ...other_required_fields_minus_basis }`. Observe: silently dropped.
- **Root Cause:** Field was renamed from `basis` to `evidence` at some point; backward compatibility aliasing was added without completing the migration or documenting the transition.
- **Fix:** (1) Document the alias in a comment. (2) Update filter to accept `basis` OR `evidence`. (3) Normalize to `evidence` in the map. (4) Remove `basis` from required filter check once all prompts emit `evidence`.
- **Impact:** Findings using the current canonical field name (`evidence`) are silently dropped. Silent data loss bug caused by incomplete migration.
- **Effort:** S

### Finding: mb preflight test suite has no failure-path test
- **Tag:** [NEW]
- **Severity:** Low
- **Confidence:** Verified
- **Repository:** PMB
- **Evidence:** `tests/test-mb-preflight.sh` — tests only: basic run exits 0, `--staged` flag exits 0, `--json` flag exits 0, unknown flag exits 0. No test for missing prerequisite or non-zero exit.
- **Reproduction:** Read `tests/test-mb-preflight.sh` in full — no `assert_exit_nonzero` call exists.
- **Root Cause:** Test was written to verify the command doesn't crash, not to verify it accurately diagnoses missing prerequisites.
- **Fix:** Add a test creating a temp project where `git` is not on PATH; invoke `mb preflight`; assert non-zero exit or tool-missing warning.
- **Impact:** A regression in preflight's tool-detection logic would go undetected.
- **Effort:** S

### Finding: mb change-check test suite has no error/invalid-ref path
- **Tag:** [NEW]
- **Severity:** Low
- **Confidence:** Verified
- **Repository:** PMB
- **Evidence:** `tests/test-mb-change-check.sh` — no `assert_exit_nonzero` call exists. No test for invalid ref.
- **Reproduction:** Read `tests/test-mb-change-check.sh` in full.
- **Root Cause:** Error paths were not considered in initial test authoring.
- **Fix:** Add a test passing `mb change-check TOTALLY_INVALID_REF` and asserting a non-zero exit or error message.
- **Impact:** A regression in change-check error handling would go undetected.
- **Effort:** XS

### Finding: --no-sanitize warning silently discarded when stderr is redirected
- **Tag:** [NEW]
- **Severity:** Low
- **Confidence:** Verified
- **Repository:** ACR
- **Evidence:** `src/core/runner.ts:151–154` — `process.stderr.write('[ai-review] WARNING: --no-sanitize is active...\n')`. Standard CI pattern `2>/dev/null` discards it silently. README documents `--no-sanitize` without a security risk callout.
- **Reproduction:** `ai-review-agent --no-sanitize --format json > report.json 2>/dev/null` — clean JSON report, no visible security alert.
- **Root Cause:** Stderr is correct but has no fallback path when suppressed. README lacks a security callout for the flag.
- **Fix:** (1) Add a security warning to README for `--no-sanitize`. (2) Optionally promote the sanitizer-disabled state into the JSON report as a `warnings` array entry for machine-enforceable gating.
- **Impact:** Operators using `--no-sanitize` in CI without understanding the risk receive no indication. Prompt injection protection is silently disabled.
- **Effort:** XS

### Finding: PMB progress.md last-reviewed 4 days behind activeContext.md
- **Tag:** [NEW]
- **Severity:** Low
- **Confidence:** Verified
- **Repository:** PMB
- **Evidence:** `memory-bank/progress.md` frontmatter: `last-reviewed: 2026-06-22`. `memory-bank/activeContext.md` frontmatter: `last-reviewed: 2026-06-24`. The 2-day gap indicates progress.md was not edited during the sprint that updated activeContext.md.
- **Reproduction:** Read both file frontmatters.
- **Root Cause:** PMB audit remediation sprint updated activeContext but not progress.
- **Fix:** Update progress.md to reflect WS1–WS4 completion, 115 new test assertions, current date.
- **Impact:** Future sessions relying on progress.md for historical state will see a gap at the 2026-06-22–2026-06-24 sprint.
- **Effort:** XS

### Finding: ollama:// scheme passes hostname allowlist but fails at runtime fetch
- **Tag:** [NEW]
- **Severity:** Low
- **Confidence:** Strong Evidence
- **Repository:** ACR
- **Evidence:** `src/core/llm/ollamaProvider.ts:10` — `new URL('ollama://localhost:11434')` does not throw in Node.js 18+; hostname `localhost` passes the allowlist. The `fetch()` call at line 29 then uses the raw `baseUrl` and rejects the `ollama:` scheme with `TypeError: fetch failed` at runtime with no clear diagnostic.
- **Reproduction:** `new OllamaProvider('ollama://localhost:11434', 'devstral:latest')` — no throw. Then `.chat([])` — throws `TypeError: fetch failed`.
- **Root Cause:** The allowlist validates hostname only, not URL scheme.
- **Fix:** Add a scheme check before the hostname check: `if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Ollama URL must use http or https. Got: ${parsed.protocol}')`.
- **Impact:** Misconfigured URLs produce a confusing runtime error rather than a clear construction-time message.
- **Effort:** XS

---

## 7. Missing Features

### Finding: No Dependabot configuration for GitHub Actions
- **Tag:** [NEW]
- **Severity:** Medium
- **Confidence:** Verified
- **Repository:** ACR
- **Evidence:** No `.github/dependabot.yml` file exists in the repository. All GitHub Actions steps are manually maintained with no automated update mechanism.
- **Reproduction:** `ls .github/` — no `dependabot.yml`.
- **Root Cause:** Dependabot was never configured. It is the standard mechanism for automated SHA pin updates after SHA-pinning third-party actions.
- **Fix:** Add `.github/dependabot.yml` with `package-ecosystem: github-actions` on a weekly schedule and `package-ecosystem: npm` for dependency updates.
- **Impact:** After SHA-pinning gitleaks-action, Dependabot is required to keep the pin current. Without it, the SHA pin will become stale and eventually the action may have unfixed vulnerabilities.
- **Effort:** XS

### Finding: MCP server has no stdin/signal shutdown handlers — leaks zombie processes
- **Tag:** [NEW]
- **Severity:** Medium
- **Confidence:** Verified
- **Repository:** ACR
- **Evidence:** `src/mcp/server.ts` — no `process.on('SIGTERM')`, `process.on('SIGINT')`, `process.stdin.on('close')`, or `process.stdin.on('end')` handler. The MCP SDK v1.29.0 stdio transport registers only `'data'` and `'error'` listeners.
- **Reproduction:** Start `node dist/mcp/server.js`. Close the parent process or pipe. The server process remains running indefinitely.
- **Root Cause:** The MCP SDK stdio transport does not handle stdin EOF. The application layer adds no signal handlers. Node.js keeps the process alive because stdin is an open stream reference.
- **Fix:** Add after `await server.connect(transport)`: `process.stdin.on('end', () => process.exit(0)); process.stdin.on('close', () => process.exit(0)); process.on('SIGTERM', () => process.exit(0)); process.on('SIGINT', () => process.exit(0))`.
- **Impact:** Zombie MCP server processes accumulate across Cursor restarts, consuming OS resources and leaving orphaned Ollama calls consuming GPU/CPU.
- **Effort:** XS

---

## 8. Missing Guardrails

### Finding: No pre-commit Prettier hook enforces format locally
- **Tag:** [NEW]
- **Severity:** Medium
- **Confidence:** Verified
- **Repository:** ACR
- **Evidence:** The format:check step in `release.yml` only runs at tag-push time. No `.claude/settings.json` PostToolUse hook runs Prettier. No git pre-commit hook enforces format. The result is the current 16-file formatting regression (see Section 3.2).
- **Reproduction:** Edit any TypeScript file, commit without formatting — no warning or block.
- **Root Cause:** Format enforcement exists only in CI, which runs too late to prevent the regression.
- **Fix:** Add a PostToolUse hook in `.claude/settings.json` that runs `npx prettier --write` on the edited file, OR add a pre-commit git hook that runs `npx prettier --check .` and blocks commit on failure.
- **Impact:** Without a local gate, every sprint of modifications will re-accumulate format drift that only surfaces as a release blocker.
- **Effort:** S

### Finding: mb-doctor-self-check does not test the installed mb CLI (PATH install)
- **Tag:** [NEW]
- **Severity:** Advisory
- **Confidence:** Verified
- **Repository:** PMB
- **Evidence:** `.github/workflows/pmb-health.yml` line 286: `bash scripts/mb.sh doctor` — no `install.sh` or symlink step precedes this. The job never calls `which mb` or invokes `mb doctor` as a CLI command.
- **Reproduction:** The job tests the script directly via `bash scripts/mb.sh`, not the installed `mb` binary.
- **Root Cause:** Testing the script directly is simpler and avoids install steps, but means the install process is never validated in CI.
- **Fix (optional):** Add a step before the doctor run that executes `bash install.sh`, then invokes `mb doctor` as a command.
- **Impact:** If `install.sh` breaks or the symlink points to the wrong path, no CI job catches it.
- **Effort:** XS

---

## 9. Incorrect Guardrails

### Finding: HOOKS-GUIDE.md claims PreCompact exits 2 to block compaction — claim is false on Windows
- **Tag:** [REGRESSION]
- **Severity:** High
- **Confidence:** Verified
- **Repository:** Both
- **Evidence:** See Section 4 "PreCompact `|| true` defeats block claim" finding. This finding is the documentation dimension of that regression. `docs/HOOKS-GUIDE.md` lines 85–86 (ACR): "Exits 2 — one or more checks fail. Compaction is blocked." Runtime on Windows: exit 0.
- **Reproduction:** Read `docs/HOOKS-GUIDE.md` lines 85–86. Read `.claude/settings.json` PreCompact command. Run on Windows. Final exit 0.
- **Root Cause:** Documentation was updated without verifying the runtime command chain produces the documented behaviour.
- **Fix:** Fix the `|| true` issue first (Section 4). Then verify HOOKS-GUIDE.md accurately reflects the corrected behaviour.
- **Impact:** Documentation describing a governance enforcement that does not exist is worse than no documentation — it creates false confidence.
- **Effort:** S (included in the Section 4 fix)

---

## 10. Security Concerns

### Finding: gitleaks-action@v2 floating tag with write permissions (supply chain risk)
- See Section 4 for full finding detail.
- **Tag:** [REGRESSION] | **Severity:** High | **Effort:** XS

### Finding: 0.0.0.0 in allowlist permits externally-bound Ollama on Linux
- See Section 4 for full finding detail.
- **Tag:** [NEW] | **Severity:** High | **Effort:** XS

### Finding: --no-sanitize warning discarded in CI pipelines
- See Section 6 for full finding detail.
- **Tag:** [NEW] | **Severity:** Low | **Effort:** XS

### Finding: ollama:// scheme bypasses allowlist at construction time
- See Section 6 for full finding detail.
- **Tag:** [NEW] | **Severity:** Low | **Effort:** XS

### Finding: OllamaProvider throws raw TypeError on malformed URLs
- See Section 5 for full finding detail.
- **Tag:** [NEW] | **Severity:** Medium | **Effort:** XS

---

## 11. Reliability Concerns

### Finding: PreCompact || true defeats blocking on Windows
- See Section 4 for full finding detail.
- **Tag:** [REGRESSION] | **Severity:** High | **Effort:** S

### Finding: 16 files fail format:check — release pipeline blocked
- See Section 3.2 for full finding detail.
- **Tag:** [REGRESSION] | **Severity:** Critical | **Effort:** S

### Finding: Extension subprocess no wall-clock timeout
- See Section 4 for full finding detail.
- **Tag:** [NEW] | **Severity:** High | **Effort:** S

### Finding: MCP server leaks zombie processes on client disconnect
- See Section 7 for full finding detail.
- **Tag:** [NEW] | **Severity:** Medium | **Effort:** XS

### Finding: Doctor tests mutate real repo with fragile restore
- See Section 4 for full finding detail.
- **Tag:** [NEW] | **Severity:** High | **Effort:** M

### Finding: CI extension test step has no timeout — 6-hour hang risk
- See Section 3.2 for full finding detail.
- **Tag:** [REGRESSION] | **Severity:** Critical | **Effort:** XS

---

## 12. Performance Concerns

### Finding: PMB test suite takes 4+ minutes on Windows
- See Section 5 for full finding detail.
- **Tag:** [NEW] | **Severity:** Medium | **Effort:** M

### Advisory: Check 22/23 inner loop still spawns grep -qF subprocesses per cache entry
- **Tag:** [NEW]
- **Severity:** Advisory
- **Confidence:** Verified
- **Repository:** PMB
- **Evidence:** `scripts/mb.sh` lines 1047–1057, 1085–1091 — pre-caching is correctly implemented, but the inner loop body at line 1070 still executes `echo "${_PLANNED_CACHE[$_ci]}" | grep -qF "$window"` — a subprocess fork per cache entry per window. The pre-normalization was moved out; the grep subprocess remains.
- **Fix:** Replace `echo "$x" | grep -qF "$pattern"` with `[[ $x == *"$pattern"* ]]` to eliminate remaining subprocess spawns.
- **Impact:** Performance advisory only. Not a correctness issue. With typical memory-bank sizes the impact is negligible.
- **Effort:** S

---

## 13. Documentation Issues

### Finding: HOOKS-GUIDE.md block claim is false on Windows (|| true)
- See Section 4 and 9 for full finding detail.
- **Tag:** [REGRESSION] | **Severity:** High

### Finding: CLAUDE.md says PreCompact "warns"
- See Section 5 for full finding detail.
- **Tag:** [REGRESSION] | **Severity:** Medium

### Finding: CONTRACTS-GUIDE expires_at documented as informational
- See Section 5 for full finding detail.
- **Tag:** [NEW] | **Severity:** Medium

### Finding: CONTRACTS-GUIDE omits PMB scope format
- See Sections 5 and 6 for full finding detail.
- **Tag:** [NEW] | **Severity:** Low

### Finding: ACR CHANGELOG missing remediation sprint
- See Section 5 for full finding detail.
- **Tag:** [NEW] | **Severity:** Medium

### Finding: ACR activeContext.md stale test count (276 vs 284)
- See Section 5 for full finding detail.
- **Tag:** [NEW] | **Severity:** Medium

### Finding: ACR progress.md stale test count and missing version history
- See Section 5 for full finding detail.
- **Tag:** [NEW] | **Severity:** Medium

### Finding: PMB README doctor check count wrong (20 vs 24)
- See Section 5 for full finding detail.
- **Tag:** [NEW] | **Severity:** Medium

### Finding: PMB README omits mb preflight and mb change-check
- See Section 5 for full finding detail.
- **Tag:** [NEW] | **Severity:** Medium

### Finding: PMB progress.md last-reviewed 4 days behind activeContext.md
- See Section 6 for full finding detail.
- **Tag:** [NEW] | **Severity:** Low

---

## 14. Developer Experience Issues

### Finding: BaseAgent 19 distinct concerns — undiagnosable silent drops
- The SRP violation (Section 4) and the two silent-drop findings (Section 5) combine to make the review agent nearly impossible to debug. When a reviewer gets fewer findings than expected, there is currently no way to determine whether the LLM returned nothing, the LLM returned invalid schema, or the parse stages silently discarded valid findings.
- **Tag:** [NEW] | **Severity:** High | **Effort:** M (SRP) + 2×XS (logging)

### Finding: Check 5 permanently skipped on Windows
- See Section 5 for full finding detail. Developers on Windows cannot run the full test suite.
- **Tag:** [NEW] | **Severity:** Medium | **Effort:** S

### Finding: 4-minute test suite on Windows discourages pre-commit testing
- See Section 5 for full finding detail.
- **Tag:** [NEW] | **Severity:** Medium | **Effort:** M

### Finding: ollama:// scheme produces confusing runtime TypeError instead of clear constructor error
- See Section 6 for full finding detail.
- **Tag:** [NEW] | **Severity:** Low | **Effort:** XS

### Finding: mb preflight and mb change-check not discoverable from README
- See Section 5 for full finding detail.
- **Tag:** [NEW] | **Severity:** Medium | **Effort:** XS

---

## 15. Integration Problems

### Finding: MCP server no shutdown handlers — IDE disconnect leaves zombie process
- See Section 7 for full finding detail.
- **Tag:** [NEW] | **Severity:** Medium | **Effort:** XS

### Finding: --context-mode semantic silently degrades on embed failure — no fallback
- See Section 4 for full finding detail.
- **Tag:** [NEW] | **Severity:** High | **Effort:** S

### Finding: 0.0.0.0 allowlist inconsistency between Windows and Linux Ollama routing
- See Section 4 for full finding detail.
- **Tag:** [NEW] | **Severity:** High | **Effort:** XS

### Finding: MCP CallToolResult missing isError:true on error path
- **Tag:** [NEW]
- **Severity:** Advisory
- **Confidence:** Strong Evidence
- **Repository:** ACR
- **Evidence:** `src/mcp/server.ts` lines 67 and 71 — the catch path returns `{ content: [{ type: 'text', text }] }` without `isError: true`. The MCP spec requires `isError: true` for tool errors. Cursor degrades gracefully; the response is a valid `CallToolResult` shape.
- **Fix:** Add `isError: true` to the error-path `CallToolResult` in `src/mcp/server.ts` line 71.
- **Impact:** Advisory only. Non-conforming but tolerated by Cursor. May cause issues with stricter MCP clients.
- **Effort:** XS

---

## 16. Architecture Critique

The core architectural debt in ACR is concentrated in `src/core/agents/base.ts`. A 150-line class with
19 distinct concerns is not a design — it is an accumulation. The class cannot be tested in parts (all
methods are private), the normalisation rules cannot be extended without risking interaction with
existing ones, and the debugging surface is nil (silent drops, unreachable error logs). The Round 1
decomposition of `SwarmRunner.run()` showed the project is willing to extract collaborators. The same
discipline needs to apply to `BaseAgent`.

The `--context-mode semantic` feature was shipped without a single test. The code path that makes ACR
more than a wrapper around Ollama — semantic context selection, embedding, cosine ranking — has zero
coverage. A feature with zero test coverage and a documented silent-failure mode (silently degrades to
no-context) is not a shipped feature; it is a stub that happens to compile.

The PreCompact hook architecture has a structural problem that documentation cannot fix. The `|| true`
suffix exists because the hook subsystem needs to fail open on hook infrastructure errors (missing
interpreter, script errors unrelated to the check). PreCompact has a different requirement: it must fail
closed on check failures while still failing open on infrastructure errors. The current command chain
cannot distinguish these two failure modes. The fix is not removing `|| true` blindly; it is
restructuring the scripts to only exit non-zero on genuine check failures, not on bash infrastructure
issues, and then removing `|| true`.

The PMB doctor test suite is architecturally unsound: it uses rename-and-restore patterns on production
files as a proxy for testing file-absence conditions, rather than creating isolated test fixtures. This
pattern made sense as a quick prototype but should not persist into a production test suite for a tool
users install on their machines.

---

## 17. Technical Debt

1. **basis→evidence alias migration is incomplete.** The filter validates `basis`; the canonical output
   field is `evidence`; the guide documents neither. The migration was started and abandoned. Until
   completed, findings using `evidence` (the documented field name) are silently dropped.

2. **3-stage JSON parse fallthrough logic has an unlogged case.** When stage-1 parses successfully but
   validates to 0 findings, execution falls through to stage-2, which re-processes the same JSON and
   produces the same empty result. The error path at line 81 is never reached. The second pass is
   wasted work and the failure is silent.

3. **PSScriptAnalyzer Warning severity bypassed.** This is not a style choice — it is a CI coverage
   gap. Warning-level rules catch real bugs, and silencing the entire severity tier to avoid noise is
   the wrong tradeoff. The correct fix is `ExcludeRule` for specific acceptable warnings, not
   `-Severity Error` alone.

4. **MCP server ships without lifecycle management.** The stdin EOF and SIGTERM/SIGINT gaps are a known
   pattern in Node.js MCP servers and have a standard fix (4 lines). They were not included in the
   initial implementation.

5. **Format enforcement exists only at release time.** The 16-file formatting regression is a direct
   consequence of this. Format enforcement that only fires on `git push --tags` is enforcement that
   arrives too late to prevent drift.

---

## 18. Quick Wins

Effort XS or S, Severity Medium or higher, prioritized by impact:

| Finding | Effort | Severity | Repo |
|---|---|---|---|
| Add `timeout-minutes: 5` to CI extension test step | XS | Critical | ACR |
| Pin gitleaks-action to SHA; add dependabot.yml | XS | High | ACR |
| Remove 0.0.0.0 from Ollama allowlist | XS | High | ACR |
| Remove `\|\| true` from PreCompact command (3 files) | S | High | Both |
| Add stdin/SIGTERM handlers to MCP server | XS | Medium | ACR |
| Fix OllamaProvider raw TypeError on malformed URL | XS | Medium | ACR |
| Fix null scope field in contract (3-line guard) | XS | Medium | PMB |
| Fix expires_at documentation in CONTRACTS-GUIDE | XS | Medium | ACR |
| Add ollama:// scheme check before hostname allowlist | XS | Low→Medium | ACR |
| Update activeContext.md and progress.md test count | XS | Medium | ACR |
| Add CHANGELOG entry for remediation sprint | S | Medium | ACR |
| Update CLAUDE.md "warns" → "blocks compaction" | XS | Medium | ACR |
| Fix README doctor check count (20→24) | XS | Medium | PMB |
| Add mb preflight and mb change-check to README | XS | Medium | PMB |
| Add silent-drop warning log to validateFindings | XS | Medium | ACR |
| Add zero-finding log when all stage-1 items fail | XS | Medium | ACR |
| PSScriptAnalyzer: add Warning severity | XS | Medium | PMB |
| Fix empty scope array false-positive in contract scripts | XS | Low | PMB |
| Fix --no-sanitize README security callout | XS | Low | ACR |
| Update PMB progress.md last-reviewed | XS | Low | PMB |

---

## 19. Long-Term Recommendations

1. **Extract BaseAgent collaborators (FindingParser, FindingNormalizer, FindingValidator).** This is a
   multi-file refactor (Effort M/L) that is prerequisite to making the core review pipeline testable
   and debuggable. Until done, all diagnostic improvements (logging, coverage) are fighting symptoms
   rather than the structural cause.

2. **Write tests for the entire semantic context path.** `loadAgentContextSemantic`, `embed()`, and
   `cosineSimilarity` integration need a proper test suite with mocked HTTP. This is not optional: a
   flagship feature with zero coverage has no quality floor. Effort M.

3. **Implement format enforcement at tool-call time, not release time.** A PostToolUse Prettier hook or
   a pre-commit git hook would have prevented the current 16-file formatting regression entirely. The
   format:check CI gate is not a substitute for a local gate that catches drift before it accumulates.
   Effort S.

4. **Restructure PreCompact hook to distinguish check failures from infrastructure failures.** The
   current `|| true` pattern is a symptom of a script that does not cleanly separate "check failed"
   exits from "script crashed" exits. Restructure the scripts to emit a specific exit code only on
   genuine check failures, then remove `|| true`. This is a governance correctness fix, not a
   nice-to-have. Effort M.

5. **Rewrite PMB doctor tests to use isolated fixtures instead of repo mutations.** The rename-and-
   restore pattern is a prototype pattern. As the test suite expands, the risk of an interrupted run
   corrupting the checkout grows. Proper fixture isolation is standard for test suites that test
   file-system state. Effort M.

6. **Complete the basis→evidence alias migration.** Choose one canonical field name, update all agent
   prompts to emit it, update the filter to accept either during transition, and document the migration
   in a comment block. A half-completed field rename that silently drops findings using the canonical
   field name is a correctness bug, not a naming style issue.

7. **Add OpenSSF Scorecard to CI.** The gitleaks SHA-pin gap was identified in this audit. Scorecard
   would have caught it automatically and continuously. It is a free GitHub Action that provides ongoing
   supply chain security scoring. Effort XS (add the action) + S (act on findings).

8. **Establish a memory bank update protocol enforced by CI.** The current pattern is that progress.md
   and activeContext.md drift during sprints and are updated inconsistently. A CI check that flags when
   the test count in activeContext.md diverges from the actual test output by more than a threshold
   would catch stale counts before they compound. Effort M.

---

## 20. Production Readiness Verdict

Round 2 is worse than Round 1 in one critical dimension: the ratio of documented guarantees to actual
enforcement has widened. Round 1 at least had the honesty of not claiming the PreCompact hook blocked
anything. After Round 1, HOOKS-GUIDE.md was updated to claim it blocks, CLAUDE.md still says it warns,
and the runtime still exits 0 on Windows. The project now has three authoritative documents describing
the same mechanism in three incompatible ways, none of which matches the observed behaviour.

The release pipeline is currently blocked by the formatting regression. No `v*.*.*` tag push produces a
successful npm publish today. This is not a latent risk; it is an active failure state.

The two highest-impact supply chain risks — gitleaks floating tag with write permissions, and the
formatting CI gate that would have caught drift — were both identified in Round 1 and neither was fully
addressed. The gitleaks action was added but not SHA-pinned. The format:check gate runs in CI but has
no local enforcement.

What must change before any release:

1. Run `npx prettier --write .` and add a local format enforcement hook. (Release blocker.)
2. Add `timeout-minutes: 5` to the CI extension test step. (Release blocker by risk.)
3. SHA-pin gitleaks-action and add dependabot.yml. (Security requirement.)
4. Remove `|| true` from PreCompact in all three settings.json files. (Governance correctness.)
5. Update CLAUDE.md "warns" → "blocks compaction." (Documentation correctness.)
6. Remove 0.0.0.0 from Ollama allowlist. (One-line security fix.)
7. Fix null scope in contract scripts. (Reliability fix, 3 lines.)
8. Add MCP server shutdown handlers. (Reliability fix, 4 lines.)

Items 3–8 are each under 10 lines of change. Items 1–2 are medium-effort tasks. None of these require
architectural decisions. The project is not in a bad architectural position — but it is in a bad
governance and CI reliability position, and that must be fixed before releasing to users who depend on
the documented guarantees.
