# Agent 1 — Round 3 Regression Inspector

**Date:** 2026-06-27
**Status:** Complete
**Regressions found:** 0

---

## Check 1: npm run check passes

> [CHECK 1]: No finding — `npm run check` completed with 0 warnings and 0 errors. All sub-steps passed: test (284/284), typecheck, build, format:check, lint:eslint.

---

## Check 2: Test count ≥ 284

> [CHECK 2]: No finding — `Tests  284 passed (284)`. Meets the ≥284 threshold exactly.

---

## Check 3: OllamaProvider allowlist and scheme check

> [CHECK 3]: No finding — `src/core/llm/ollamaProvider.ts` confirms all three fixes hold:
>
> - `0.0.0.0` is NOT in the allowlist (line 25: `['localhost', '127.0.0.1', '::1']`)
> - Scheme check is present (lines 18–23: `http:` or `https:` only)
> - `new URL()` is inside a try/catch (lines 11–17)

---

## Check 4: base.ts accepts evidence OR basis

> [CHECK 4]: No finding — `src/core/agents/base.ts` line 129 reads:
> `(typeof f.basis === 'string' || typeof f.evidence === 'string')`
> Both legacy (`basis`) and canonical (`evidence`) field names are accepted.

---

## Check 5: MCP server shutdown handlers

> [CHECK 5]: No finding — `src/mcp/server.ts` lines 90–93 confirm all four handlers are present after `server.connect(transport)`:
>
> - `process.on('SIGTERM', shutdown)`
> - `process.on('SIGINT', shutdown)`
> - `process.stdin.on('end', shutdown)`
> - `process.stdin.on('close', shutdown)`

---

## Check 6: gitleaks is SHA-pinned (ACR release.yml)

> [CHECK 6]: No finding — `.github/workflows/release.yml` line 46:
> `uses: gitleaks/gitleaks-action@dcedce43c6f43de0b836d1fe38946645c9c638dc # v2`
> The SHA is 40 hex characters. Not `@v2`.

---

## Check 7: dependabot.yml covers github-actions

> [CHECK 7]: No finding — `.github/dependabot.yml` line 3:
> `package-ecosystem: 'github-actions'` is present, weekly schedule.

---

## Check 8: Extension test step has timeout-minutes: 5

> [CHECK 8]: No finding — `.github/workflows/release.yml` lines 40–42:
> `- name: VS Code extension tests` / `  timeout-minutes: 5` — confirmed.

---

## Check 9: HOOKS-GUIDE.md says warns not blocks

> [CHECK 9]: No finding — `docs/HOOKS-GUIDE.md` PreCompact section (lines 86–88):
> "Warns — the hook prints a message describing the missing/stale content but compaction proceeds. The `|| true` fail-open in the settings.json command ensures the hook never blocks compaction."
> No "Exits 2 — compaction is blocked" language present.

---

## Check 10: check-contract empty-scope guards

> [CHECK 10]: No finding — Both scripts confirmed:
>
> - `Personal-Memory-Bank/scripts/check-contract.sh` line 71: `if [ -z "$SCOPE_FILES" ]; then exit 0; fi` — guard fires before foreach.
> - `Personal-Memory-Bank/scripts/check-contract.ps1` line 86: `if (-not $scopeFiles -or $scopeFiles.Count -eq 0) { exit 0 }` — null/empty guard before foreach.

---

## Check 11: PSScriptAnalyzer Warning severity

> [CHECK 11]: No finding — `Personal-Memory-Bank/.github/workflows/pmb-health.yml` line 270:
> `Invoke-ScriptAnalyzer -Path $_ -Severity Error,Warning`
> Both `Error` and `Warning` severities are present.

---

## Check 12: PMB test suite

> [CHECK 12]: No finding — `bash tests/run.sh` completed with exit 0. All 11 suites passed: mb plan (17), mb preflight (8), mb change-check (8), mb status (15), mb verify-integrity (7), mb query (7), mb init (11), mb clean (5), mb commit (5), mb upgrade (9), mb doctor (32). Total: 124 tests, 0 failures.

---

## Check 13: CONTRACTS-GUIDE.md has Scope Format Compatibility section

> [CHECK 13]: No finding — `docs/CONTRACTS-GUIDE.md` lines 105–113 contain "## Scope Format Compatibility" section documenting both the ACR/canonical format (`array of {file, op} objects`) and PMB template format (`scope.files` array of strings). Both are stated to be parsed correctly by both hook scripts.

---

## New Findings

### Finding: PMB gitleaks-action not SHA-pinned in pmb-health.yml

- **Tag:** [NEW]
- **Severity:** Medium
- **Confidence:** Verified
- **Repository:** PMB
- **Evidence:** `Personal-Memory-Bank/.github/workflows/pmb-health.yml` line 114: `uses: gitleaks/gitleaks-action@v2.3.9` — mutable tag, not a 40-char commit SHA
- **Reproduction:** Open `.github/workflows/pmb-health.yml` and inspect the `secret-scan` job step.
- **Root Cause:** The ACR Round 2 fix (SHA-pinning gitleaks in `release.yml`) was not applied to the equivalent step in the PMB health workflow. The two repos have diverged on this supply-chain control.
- **Fix:** Replace `@v2.3.9` with the pinned SHA used in ACR: `@dcedce43c6f43de0b836d1fe38946645c9c638dc # v2.3.9` (or verify the correct SHA for v2.3.9 and add a comment). Add a dependabot entry for github-actions in PMB if not already present.
- **Impact:** PMB secret-scan step is vulnerable to tag-mutable supply-chain attack on the gitleaks action; a compromised tag could execute arbitrary code in CI with GITHUB_TOKEN.
- **Effort:** XS
