# Agent 1 — Round 1 Fix Verification (Regression Inspector)

**Date:** 2026-06-26
**Status:** Complete
**Finding count:** 8 (3 regressions, 5 new)

---

## Check 1: npm run check — Formatting Regression

### Finding: 16 files fail format:check including core source files

- **Tag:** [REGRESSION]
- **Severity:** Critical
- **Confidence:** Verified
- **Repository:** ACR
- **Evidence:** `npm run check` exits 1. Prettier `[warn]` lines:
  ```
  src/cli/index.ts
  src/core/runner.ts
  tests/unit/cli.test.ts
  .claude/commands/change-review.md
  .claude/commands/feature-dev.md
  docs/audit/2026-06-24-pre-production-audit-report.md
  docs/audit/staging/agent-1-security.md
  docs/audit/staging/agent-2-reliability.md
  docs/audit/staging/agent-3-architecture.md
  docs/audit/staging/agent-4-docs-dx.md
  docs/audit/staging/agent-5-ci-coverage.md
  docs/audit/staging/agent-6-integration.md
  docs/CONTRACTS-GUIDE.md
  docs/HOOKS-GUIDE.md
  docs/superpowers/plans/2026-06-26-round2-audit.md
  docs/superpowers/specs/2026-06-26-round2-audit-design.md
  ```
- **Reproduction:** `cd "C:/Users/Mizzo/Claude/AI-Code-Review-Agent" && npm run check`
- **Root Cause:** Round 1 fixed a single file. The 20+ subsequent commits added and modified files (`src/cli/index.ts`, `src/core/runner.ts`, audit staging docs, command files, guides) without running Prettier. No pre-commit hook enforces formatting locally — the CI `format:check` step only catches drift at release tag push time.
- **Fix:** Run `npx prettier --write .` to clear current violations. Add a PostToolUse Prettier hook in `.claude/settings.json` so every Write/Edit auto-formats the file before the next check. Alternatively wire `npm run format:check` into a pre-commit hook.
- **Impact:** `npm run check` exits 1. The `Format check` step in `release.yml` will fail on any tag push before reaching `npm publish`. This is a release blocker.
- **Effort:** S

---

## Check 2: OllamaProvider URL Validation Edge Cases

> [CHECK 2 — `http://localhost@evil.com:11434`]: No finding — `new URL('http://localhost@evil.com:11434').hostname` returns `evil.com`. The allowlist `['localhost', '127.0.0.1', '::1', '0.0.0.0']` (src/core/llm/ollamaProvider.ts line 11) does not include `evil.com`. Constructor throws. SSRF attempt is blocked.

> [CHECK 2 — `http://0.0.0.0:11434`]: No finding — hostname `0.0.0.0` is in the allowlist at line 11. Accepted.

> [CHECK 2 — `http://[::1]:11434`]: No finding — `new URL('http://[::1]:11434').hostname` returns `::1` (brackets stripped by the WHATWG URL parser). `::1` is in the allowlist. Accepted.

### Finding: `ollama://localhost:11434` passes constructor allowlist check but fails at runtime fetch

- **Tag:** [NEW]
- **Severity:** Medium
- **Confidence:** Strong Evidence
- **Repository:** ACR
- **Evidence:** `src/core/llm/ollamaProvider.ts` line 10: `const { hostname } = new URL(baseUrl)`. `new URL('ollama://localhost:11434')` does not throw in Node.js 18+ — it parses as a custom-scheme URL with hostname `localhost`. Hostname passes the allowlist. Constructor succeeds. The `fetch()` call at line 29 then uses the raw `baseUrl`, and Node's native `fetch` rejects the `ollama:` scheme with an opaque `TypeError: fetch failed` at runtime, not a clear validation error at construction time.
- **Reproduction:** `new OllamaProvider('ollama://localhost:11434', 'devstral:latest')` — no throw. Then `.chat([])` — throws `TypeError: fetch failed` with no useful diagnostic.
- **Root Cause:** The allowlist validates hostname only, not URL scheme. Custom schemes that resolve to an allowlisted hostname bypass the guard.
- **Fix:** Add a scheme check before the hostname check in the constructor: `const parsed = new URL(baseUrl); if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error(\`Ollama URL must use http or https. Got: ${parsed.protocol}\`)`.
- **Impact:** Misconfigured `ollamaUrl` values produce a confusing runtime fetch error rather than a clear construction-time validation message. Low exploitability (requires control of `ai-review.config.json`) but poor DX on misconfiguration.
- **Effort:** XS

---

## Check 3: CLI Re-throw Guard

> [CHECK 3 — guard present]: No finding — `src/cli/index.ts` line 252: `if (err instanceof Error && err.message.startsWith('process.exit(')) throw err`. Guard is present.

> [CHECK 3 — process.exit(0) re-throw]: No finding — `startsWith('process.exit(')` matches `process.exit(0)` since the string starts with `process.exit(`. Synthetic exit(0) mocks propagate correctly.

### Finding: CLI re-throw guard uses fragile string-prefix match with false-positive risk

- **Tag:** [NEW]
- **Severity:** Low
- **Confidence:** Strong Evidence
- **Repository:** ACR
- **Evidence:** `src/cli/index.ts` line 252: `err.message.startsWith('process.exit(')`. Any real dependency that throws an Error whose message begins with the string literal `process.exit(` — e.g., `Error('process.exit(1) was called unexpectedly by child')` from a third-party module — will be re-thrown uncaught rather than caught and printed cleanly.
- **Reproduction:** Inside the try block, `throw new Error('process.exit(0) was reported internally')` — propagates uncaught as an unhandled rejection instead of being surfaced via `process.stderr.write`.
- **Root Cause:** The guard was added to pass synthetic `process.exit` mocks in tests, using a plain string match. A sentinel error subclass would be unambiguous.
- **Fix:** Define `class SyntheticExitError extends Error {}` in the test mock, replace the synthetic `throw new Error('process.exit(1)')` with `throw new SyntheticExitError(...)`, and change the catch guard to `if (err instanceof SyntheticExitError) throw err`. No false-positive risk.
- **Impact:** Extremely unlikely in practice. Fragile pattern that confuses future maintainers and could mask real errors from deps with verbose error messages.
- **Effort:** S

---

## Check 4: matchPattern Circular Dependency

> [CHECK 4 — policyFilter import]: No finding — `src/core/policyFilter.ts` line 6: `import { matchPattern } from './ignoreFilter.js'`. Correct external import, no local copy.

> [CHECK 4 — ignoreFilter export]: No finding — `src/core/ignoreFilter.ts` line 74: `export function matchPattern(...)`. Properly exported.

> [CHECK 4 — typecheck]: No finding — `npm run typecheck` exits 0 with no output. Zero type errors.

---

## Check 5: check-contract.sh Scope Schema Handling

> [CHECK 5 — Case 1, ACR `[{file, op}]`]: No finding — `check-contract.sh` Python block lines 37-38: `if isinstance(scope, list): files = [item["file"] if isinstance(item, dict) else item for item in scope]`. ACR format handled correctly.

> [CHECK 5 — Case 2, PMB `{files: [...]}`]: No finding — lines 39-40: `elif isinstance(scope, dict): files = scope.get("files", [])`. Object scope handled correctly.

> [CHECK 5 — Case 4, malformed JSON]: No finding — lines 47-48: `except json.JSONDecodeError: print("__MALFORMED__")`. Caught at lines 58-62 with a clear warning. Correctly handled.

### Finding: check-contract.sh empty scope array triggers spurious out-of-scope warning for every write

- **Tag:** [NEW]
- **Severity:** Low
- **Confidence:** Verified
- **Repository:** PMB
- **Evidence:** `scripts/check-contract.sh` lines 110-132: when `SCOPE_FILES` is empty (from `"scope": []`), the `while` loop body never executes. `IN_SCOPE` stays 0. Line 134: `if [ "$IN_SCOPE" -eq 0 ]` fires and prints "⚠️ CONTRACT SCOPE: Writing to '$TARGET_FILE' is outside the active contract." with an empty "Declared scope:" field. An active contract with no scope entries should be unenforced, not treated as blocking all files.
- **Reproduction:** Write `.claude/contracts/active-task.json` with `{"task":"test","status":"active","expires_at":"2099-01-01T00:00:00Z","scope":[]}`. Trigger any Write tool call. The hook warns "out of scope" for every file.
- **Root Cause:** No early-exit guard for empty scope. The code cannot distinguish "scope not yet declared" from "scope enforced and empty."
- **Fix:** In `check-contract.sh`, add after `SCOPE_FILES` extraction: `if [ -z "$SCOPE_FILES" ]; then exit 0; fi`. In `check-contract.ps1`, add before the `foreach` loop: `if (-not $scopeFiles -or $scopeFiles.Count -eq 0) { exit 0 }`.
- **Impact:** False-positive scope warnings on every write when a contract has no declared scope. Trains users to ignore scope warnings, eroding the hook's signal value.
- **Effort:** XS

---

## Check 6: check-contract.ps1 Scope Schema Handling

> [CHECK 6 — Case 1, ACR array of PSCustomObject with .file]: No finding — `check-contract.ps1` lines 39-40: array of PSCustomObject with `.file` property handled via `ForEach-Object { $_.file }`. Correct.

> [CHECK 6 — Case 2, PMB `{files: [...]}`]: No finding — lines 41-42: `elseif ($rawScope -is [PSCustomObject]) { $scopeFiles = $rawScope.files }`. Correct.

> [CHECK 6 — Case 3, empty array]: Same empty-scope issue as Check 5. `foreach ($pattern in $scopeFiles)` never executes. `$inScope` remains `$false`. Warning fires for every file. See Check 5 finding for fix.

> [CHECK 6 — Case 4, malformed JSON]: No finding — lines 23-29: `ConvertFrom-Json` throws, catch block prints warning and exits 0. Not a silent exit.

---

## Check 7: CONTRACTS-GUIDE.md Accuracy

### Finding: CONTRACTS-GUIDE.md claims expires_at is informational but hook actively enforces it

- **Tag:** [NEW]
- **Severity:** Medium
- **Confidence:** Verified
- **Repository:** ACR
- **Evidence:** `docs/CONTRACTS-GUIDE.md` line 101: `- \`expires_at\` is informational; the hook does not check clock time`. In reality, `scripts/check-contract.sh` lines 77-93 perform a live UTC clock check via Python `datetime.now(timezone.utc)`. `scripts/check-contract.ps1` lines 53-65 perform the same check via `[datetime]::UtcNow`. When expired, the hook emits "⚠️ CONTRACT EXPIRED" and exits 0, which stops scope enforcement silently.
- **Reproduction:** Set `expires_at` to any past ISO 8601 datetime. Trigger a Write outside declared scope. Expect the scope warning — instead get the expiry warning and no scope enforcement.
- **Root Cause:** Guide was written before expiry enforcement was implemented in the hook scripts. Not updated when enforcement was added.
- **Fix:** Replace `docs/CONTRACTS-GUIDE.md` line 101 with: "`expires_at` is actively enforced. When the current UTC time exceeds this value, the hook emits a CONTRACT EXPIRED warning and scope enforcement is suspended for that session."
- **Impact:** Users believe expired contracts continue to enforce scope. Silently stops protecting scope after expiry without user awareness if they read the guide.
- **Effort:** XS

### Finding: CONTRACTS-GUIDE.md omits PMB scope format

- **Tag:** [NEW]
- **Severity:** Low
- **Confidence:** Verified
- **Repository:** ACR
- **Evidence:** `docs/CONTRACTS-GUIDE.md` lines 17-29 document only `"scope": [{"file": "...", "op": "..."}]`. The hook scripts (`check-contract.sh` lines 39-40, `check-contract.ps1` lines 41-42) both handle a second format: `"scope": {"files": ["path/to/file"]}`. This PMB format is never mentioned in the guide.
- **Reproduction:** A user creating a PMB-template contract with `"scope": {"files": ["src/foo.ts"]}` has no guide documentation confirming the hook will recognize it. The hook does recognize it, but users cannot know this from the guide.
- **Root Cause:** PMB scope format support was added to the hooks without updating the guide.
- **Fix:** Add a "Scope Formats" subsection to `CONTRACTS-GUIDE.md` after the schema table, documenting both formats with examples.
- **Impact:** Cross-repo contract portability undocumented. Users copy contracts between ACR and PMB projects without knowing both formats work.
- **Effort:** XS

---

## Check 8: HOOKS-GUIDE.md PreCompact Exit Code Claim

> [CHECK 8 — pre-compact-check.sh exit codes]: No finding — `scripts/pre-compact-check.sh` line 66: `exit 2` on check failure. Line 58: `exit 0` on pass. Correct.

> [CHECK 8 — pre-compact-check.ps1 exit codes]: No finding — `scripts/pre-compact-check.ps1` line 65: `exit 2` on failure. Line 59: `exit 0` on pass. Catch block: `exit 0` (fails open). Correct.

> [CHECK 8 — HOOKS-GUIDE.md exit code claim]: No finding — `docs/HOOKS-GUIDE.md` lines 85-87: "Exits 0 — both checks pass... Exits 2 — one or more checks fail. Compaction is blocked." Guide matches implementation.

### Finding: CLAUDE.md says PreCompact hook "warns" when it actually blocks (exits 2)

- **Tag:** [REGRESSION]
- **Severity:** Medium
- **Confidence:** Verified
- **Repository:** ACR
- **Evidence:** `CLAUDE.md` line 24: "The `PreCompact` hook fires first and **warns** if neither the memory bank nor a handoff has been captured this session." `CLAUDE.md` line 140: "the `PreCompact` hook **warns** first if memory bank is stale." Both occurrences use "warns." `scripts/pre-compact-check.sh` line 66 exits 2 (block). `scripts/pre-compact-check.ps1` line 65 exits 2 (block). `docs/HOOKS-GUIDE.md` correctly says "Compaction is blocked." Round 1 identified this mismatch. The remediation updated HOOKS-GUIDE.md but left CLAUDE.md unchanged.
- **Reproduction:** Read `CLAUDE.md` line 24 and line 140. Both say "warns." Read `pre-compact-check.sh` line 66 — `exit 2`.
- **Root Cause:** Round 1 fix was applied only to `docs/HOOKS-GUIDE.md`, not to `CLAUDE.md`.
- **Fix:** In `CLAUDE.md` line 24, change "warns" to "blocks compaction." In `CLAUDE.md` line 140, change "warns first" to "blocks compaction." Exact replacements: line 24 `"warns if"` → `"blocks compaction if"`, line 140 `"warns first if"` → `"blocks compaction if"`.
- **Impact:** Claude reads CLAUDE.md every session. Believing the hook merely warns means Claude may advise users to proceed despite PreCompact failures, leading to context compaction without state capture.
- **Effort:** XS

---

## Check 9: /change-review --diff Flag Wiring

> [CHECK 9 — --diff option]: No finding — `src/cli/index.ts` line 27: `.option('--diff <path>', 'Path to a .diff file to review')`. Present.

> [CHECK 9 — getDiff priority]: No finding — `src/cli/index.ts` lines 275-288 (`getDiff` function): `if (diffFile)` block returns early before checking `dir`. When both `--diff` and `--dir` are provided, `--diff` wins. Behavior is correct.

---

## Check 10: --no-sanitize Warning Channel

> [CHECK 10 — warning channel]: No finding — `src/core/runner.ts` lines 151-153: `process.stderr.write('[ai-review] WARNING: --no-sanitize is active...\n')`. Uses `process.stderr.write`. Warning does not pollute stdout or any machine-readable output format.

> [CHECK 10 — sanitize !== false logic]: No finding — `src/core/runner.ts` line 136: `if (this.config.sanitize !== false)`. `src/core/config.ts` line 17: `sanitize: boolean` (non-optional). `DEFAULT_CONFIG` line 64: `sanitize: true`. The `!== false` check safely handles the current typed boolean. If the type ever becomes `boolean | undefined`, `!== false` still safely defaults to sanitize-enabled (the correct safe default). Logic is correct and marginally more robust than `=== true`.

---

## Check 11: Gitleaks Action Pin

### Finding: gitleaks-action@v2 is a mutable floating tag, not pinned to a commit SHA

- **Tag:** [REGRESSION]
- **Severity:** High
- **Confidence:** Verified
- **Repository:** ACR
- **Evidence:** `.github/workflows/release.yml` line 44: `uses: gitleaks/gitleaks-action@v2`. The `@v2` tag is mutable — any push to that tag by the maintainer or a compromised maintainer account runs arbitrary code in the release pipeline. The workflow has `permissions: contents: write` (line 15) and `id-token: write` (line 16), making a supply chain compromise able to publish malicious npm packages with provenance attestation or write directly to the repository.
- **Reproduction:** Observe `.github/workflows/release.yml` line 44. No SHA pin present.
- **Root Cause:** Round 1 identified this finding. No fix was applied in subsequent commits.
- **Fix:** Resolve the current `v2` tag to its commit SHA (e.g., via `gh api repos/gitleaks/gitleaks-action/git/ref/tags/v2 --jq .object.sha`). Replace line 44 with `uses: gitleaks/gitleaks-action@<full-40-char-sha> # v2.x.y`. Enable Dependabot for GitHub Actions to keep the pin current.
- **Impact:** A compromised `gitleaks/gitleaks-action` repository can execute arbitrary code in the release pipeline with write permissions. Could exfiltrate `NPM_TOKEN`, publish malicious npm packages with provenance attestation, or rewrite repository history. Highest-impact supply chain risk in the repo.
- **Effort:** XS

---

## Check 12: VS Code Extension CI Headless Compatibility

> [CHECK 12 — test run]: No finding — `npm run test:extension` passes: 3 test files, 31 tests, 804ms. No hang.

> [CHECK 12 — headless requirement]: No finding — `vscode-extension/package.json` line 103: `"test": "vitest run"`. Tests use `vitest` with a `vscode` mock (`vscode-extension/tests/__mocks__/vscode.ts`). No `@vscode/test-electron`, no real VS Code instance, no display server needed. The CI step in `release.yml` lines 40-41 runs without `xvfb-run` or a `DISPLAY` env var, which is correct.

---

## Check 13: Runner Decomposition Test Count

> [CHECK 13 — test count]: No finding — `npm test` output: `Tests: 284 passed (284)`. Meets the ≥284 threshold. No regression from the runner decomposition sprint.

---

## Check 14: /code-review Cloud Disclosure Visibility

> [CHECK 14 — disclosure location]: No finding — `.claude/commands/code-review.md` lines 1-3: the `description:` frontmatter field contains "Uses Claude (cloud API) — sends diff content to Anthropic." The disclosure is in frontmatter, visible at command discovery time (command listing/hover), not buried in the body. Correct placement for a privacy-relevant disclosure.

---

## Summary Table

| # | Check | Tag | Severity | Status |
|---|-------|-----|----------|--------|
| 1 | 16 files fail format:check including core source files | REGRESSION | Critical | FAIL |
| 2 | `ollama://` scheme passes hostname allowlist, fails at runtime fetch | NEW | Medium | FAIL |
| 3 | CLI re-throw guard has false-positive risk on real error messages | NEW | Low | FAIL |
| 4 | matchPattern import/export and typecheck | — | — | PASS |
| 5 | check-contract.sh empty scope triggers spurious out-of-scope warning | NEW | Low | FAIL |
| 6 | check-contract.ps1 same empty-scope false-positive | — | Low | FAIL (same as 5) |
| 7a | CONTRACTS-GUIDE documents expires_at as informational; hook enforces it | NEW | Medium | FAIL |
| 7b | CONTRACTS-GUIDE omits PMB scope format | NEW | Low | FAIL |
| 8 | CLAUDE.md says PreCompact "warns"; it exits 2 (blocks) | REGRESSION | Medium | FAIL |
| 9 | --diff wiring and getDiff priority correct | — | — | PASS |
| 10 | --no-sanitize uses stderr.write; sanitize !== false logic correct | — | — | PASS |
| 11 | gitleaks-action@v2 floating tag not pinned to SHA | REGRESSION | High | FAIL |
| 12 | VS Code extension tests pass headlessly (vitest, no xvfb) | — | — | PASS |
| 13 | Test count 284 — meets ≥284 threshold | — | — | PASS |
| 14 | /code-review cloud disclosure in description frontmatter | — | — | PASS |
