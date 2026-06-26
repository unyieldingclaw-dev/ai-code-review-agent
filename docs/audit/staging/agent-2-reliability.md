# Agent 2 — Reliability & Failure Modes Findings
**Date:** 2026-06-25
**Status:** Complete
**Finding count:** 8

---

## Check 1: Ollama-down failure path

**File:** `src/core/llm/ollamaProvider.ts`, `src/core/runner.ts`

**Analysis:**
- `ping()` has a 5-second timeout via `AbortSignal.timeout(5_000)` (line 38).
- On Ollama unreachable, `ping()` catches the fetch exception and returns `{ ok: false, error: "Ollama not reachable at http://localhost:11434: <native error message>" }`.
- In `runner.ts` line 127: `if (!ping.ok) throw new Error(ping.error ?? 'LLM provider not available')`.
- That thrown error is NOT caught within `SwarmRunner.run()` — it propagates to `cli/index.ts` where Commander's `.action()` handler does not wrap it in try/catch, so Node.js handles it as an unhandled promise rejection, printing a stack trace and exiting with code 1 (non-zero, but not a clean `process.exit(1)`).
- The error message IS actionable: `"Ollama not reachable at http://localhost:11434: fetch failed"`. However, the model-not-found error message IS explicitly actionable: `"Model devstral:latest not found. Run: ollama pull devstral:latest"`.

### Finding: Ollama-down throws unhandled rejection instead of clean process.exit
- **Severity:** Medium
- **Confidence:** Verified
- **Repository:** ACR
- **Evidence:** `src/core/runner.ts:127` — `throw new Error(ping.error)` is not caught by CLI action handler. `src/cli/index.ts` lines 85–249 show the `.action()` async callback has no try/catch.
- **Reproduction:** Run `ai-review-agent` with Ollama stopped. Observe Node.js unhandled rejection stack trace instead of a clean error message and exit.
- **Root Cause:** `SwarmRunner.run()` propagates the ping failure as an uncaught thrown error. Commander does not automatically catch async action errors in all Node.js versions; the behavior varies by Node version — some exit 1 with a stack trace, others may hang.
- **Fix:** Wrap the `.action()` body in `try { ... } catch (err) { console.error(err instanceof Error ? err.message : String(err)); process.exit(1); }`. The error message itself is actionable; the wrapping is what needs fixing.
- **Impact:** CI pipelines get a noisy stack trace rather than a clean one-line error message. Exit code is non-deterministic across Node versions.
- **Effort:** XS

---

## Check 2: Retry logic — scope and limits

**File:** `src/core/runner.ts` lines 48–70

**Analysis:**
- `withRetryTimeout` wraps `withTimeout(fn(), ...)`, so it retries on **any** error that `fn()` throws — including parse failures, network errors, and timeouts alike.
- Maximum retry cap: `retryAttempts` defaults to `2` (config.ts line 63), configurable via `--retry-attempts`. Cap is finite and bounded.
- After max retries, `withRetryTimeout` re-throws `lastErr`. The caller (`runner.ts` agent loop) catches this in a `try/catch` block, logs a warning, and contributes `[]` findings — the agent is skipped cleanly.
- No partial LLM output leakage: `parseFindings` is only called inside the agent's `run()` method; if that throws (e.g., from a timeout), `parseFindings` is never reached for that attempt.

> CHECK 2 (parse vs network retry): No distinct finding. Retry fires on all error types including parse failure (because `parseFindings` returns `[]` on failure rather than throwing — so bad JSON never triggers a retry). This means a parse failure is silently eaten as an empty result without retrying. This is a latent issue but addressed under Check 3 below.

> CHECK 2 (partial output leakage): No finding — partial output is never leaked. The `allFindings.push()` only executes on successful return from `withRetryTimeout`.

---

## Check 3: BaseAgent parse failure path

**File:** `src/core/agents/base.ts` lines 52–83

**Analysis:**
- Stage 1 (bare JSON): On failure, `catch { /* fall through */ }` — completely silent.
- Stage 2 (object with `.findings`): Same catch block as Stage 1 — silent.
- Stage 3 (bracket extraction): On failure, `catch { /* fall through */ }` — silent.
- After all three stages fail: `console.error(\`[\${this.name}] parse failure. Raw snippet: \${raw.slice(0, 200)}\`)` then returns `[]`.
- The raw response is accessible but **only the first 200 characters** are logged. For a typical LLM response of thousands of tokens, this is rarely enough context to diagnose whether the model returned prose, malformed JSON, or a completely wrong response format.
- The `console.error` goes to stderr, which is visible in the terminal. It is not swallowed.

### Finding: Parse failure logs only 200 chars of raw LLM response — insufficient for diagnosis
- **Severity:** Low
- **Confidence:** Verified
- **Repository:** ACR
- **Evidence:** `src/core/agents/base.ts:81` — `raw.slice(0, 200)`.
- **Reproduction:** Run with a model that returns prose instead of JSON. Observe `[security] parse failure. Raw snippet: <200 chars>` — the beginning of the response rarely reveals whether the problem is a trailing brace, markdown code fence, or entirely wrong format.
- **Root Cause:** The slice limit was set defensively to avoid flooding logs, but 200 chars is too short to distinguish common failure modes.
- **Fix:** Increase to `raw.slice(0, 800)` or log at debug level without truncation. Consider also logging the response length so the operator knows whether the model returned nothing, a short response, or a full response that failed to parse.
- **Impact:** When diagnosing why an agent silently produces zero findings, operators cannot determine if the model returned prose, an empty response, or a nearly-valid JSON with one malformed field.
- **Effort:** XS

### Finding: Parse failures in Stage 1/2 are silently swallowed — no log until Stage 3 exhausted
- **Severity:** Low
- **Confidence:** Verified
- **Repository:** ACR
- **Evidence:** `src/core/agents/base.ts:66–78` — both `catch { /* fall through */ }` blocks emit nothing. The operator only learns of a failure at line 81 after all three stages fail.
- **Reproduction:** Send a response that is valid JSON but contains a `.findings` key with wrong field types. Stage 1 parses successfully but `validateFindings` returns `[]`; the code then silently returns `[]` at line 60 without ever reaching the error log on line 81 — because `parsed.length === 0` is treated as a valid empty result.
- **Root Cause:** The condition `if (valid.length > 0 || parsed.length === 0) return valid` at line 60 returns an empty array even when the LLM returned findings that all failed schema validation. There is no log emitted to distinguish "LLM returned a valid empty array" from "LLM returned 14 findings that all failed validateFindings".
- **Fix:** After `validateFindings`, if `parsed.length > 0 && valid.length === 0`, log a warning: `console.warn(\`[\${this.name}] LLM returned \${parsed.length} findings but all failed schema validation\`)`. This distinguishes validation failure from a legitimately empty result.
- **Impact:** When all findings fail schema validation (e.g., the LLM drops the required `basis` field), the agent silently contributes zero findings with no diagnostic output — indistinguishable from a diff with no issues.
- **Effort:** XS

---

## Check 4: ignoreFilter malformed input

**File:** `src/core/ignoreFilter.ts`

**Analysis:**

**Whitespace-only line:** Line 19 `if (!trimmed || trimmed.startsWith('#')) continue` — whitespace-only lines are trimmed to empty string and skipped. Safe.

**Invalid glob like `[invalid`:** Line 84 in `matchPattern`: `const regexStr = normalised.replace(/[.+^${}()|[\]\\]/g, '\\$&')...`. The `[` character IS in the escape set `[\]\\]`, so it gets escaped to `\[`. The pattern `[invalid` becomes `\[invalid` in the regex, which is valid regex matching the literal string `[invalid`. No exception thrown — the pattern matches files literally named `[invalid`. This is silently incorrect behavior (the pattern is treated as a literal rather than an error) but does not throw.

**Negation `!foo` with no prior positive:** The `includes` array accumulates negation patterns; `filterDiff` checks `includes.some(...)` first. If there are no `excludes`, line 41 returns early: `if (excludes.length === 0) return diff`. So a negation-only `.aiignore` silently passes all files through. This is arguably correct gitignore semantics but is not documented.

**Catch-all `**`:** Becomes `.*` in the regex. With the anchored branch (`hasSlash = false`), the regex `(^|/)[^/]*(/|$)` — wait, let me re-check. `**` is converted: `\*\*` → `\x00` → `.*`. With no slash in `**`, `hasSlash = false`, pattern becomes `(^|/).*(/|$)` which matches any file path. This correctly excludes all files. Safe.

> CHECK 4 (malformed glob `[invalid`): No Critical/High finding — the behavior is safe (no crash, no exception propagated to user) though the pattern is silently misinterpreted as a literal. Documented as advisory below.

### Finding: Invalid glob patterns in .aiignore are silently misinterpreted as literals
- **Severity:** Advisory
- **Confidence:** Verified
- **Repository:** ACR
- **Evidence:** `src/core/ignoreFilter.ts:84` — `[` is escaped to `\[` before regex construction, so `[invalid` (invalid glob) becomes a literal string match rather than an error.
- **Reproduction:** Add `[invalid-pattern` to `.aiignore`. Run the tool. The pattern silently matches no files (unless a file is literally named `[invalid-pattern`). No warning is emitted.
- **Root Cause:** The pattern-to-regex conversion escapes `[` unconditionally, treating all bracket expressions as literals rather than character classes. This means valid glob character classes (e.g., `[Tt]est*`) also do not work as expected.
- **Fix:** Either document that bracket expressions are not supported, or add validation before line 17 that logs `console.warn(\`[ai-review] Invalid ignore pattern (skipped): \${trimmed}\`)` for patterns that look like they contain unclosed bracket expressions.
- **Impact:** A user who writes `[Tt]est*` expecting character-class glob matching gets no files excluded and no warning. The advisory impact is silent incorrect behavior, not a crash.
- **Effort:** XS

---

## Check 5: Exit code propagation

**Files:** `src/cli/exitCode.ts`, `src/cli/index.ts`, `tests/unit/exitCode.test.ts`

**Analysis:**
- `shouldFail(severity, failOn)` at `exitCode.ts:7–11` is correct and fully tested.
- `cli/index.ts` line 247: `const hasBlocker = result.findings.some(f => shouldFail(f.severity, options.failOn)); process.exit(hasBlocker ? 1 : 0)` — this is correct.
- The unit tests at `exitCode.test.ts` test `shouldFail` directly for all severity × failOn combinations (never, any, high, critical, medium). Both "should fail" and "should pass" paths are covered for all threshold levels.
- **Gap:** The tests test the `shouldFail` function in isolation, but there are no integration tests verifying that `process.exit(1)` is actually called when `shouldFail` returns true for a real `ReviewResult` flowing through the CLI. The wiring in `cli/index.ts` line 247 is correct by inspection, but a future refactor could break the wiring without the unit tests catching it.

### Finding: Exit code unit tests cover shouldFail in isolation but not the CLI wiring
- **Severity:** Medium
- **Confidence:** Verified
- **Repository:** ACR
- **Evidence:** `tests/unit/exitCode.test.ts` — all 13 assertions test `shouldFail(severity, level)` directly. No test in the suite exercises the path `runner.run() → findings → shouldFail() → process.exit(1)`.
- **Reproduction:** Rename `hasBlocker` to `hasBlockers` in `cli/index.ts:247` (a typo refactor) and run tests — all pass. The CLI now always exits 0.
- **Root Cause:** The exit code path (`result.findings.some(f => shouldFail(...))`) is only exercised by the unit tests in aggregate at the `shouldFail` function level, not at the CLI integration level.
- **Fix:** Add a CLI integration test (or at minimum a test for the `hasBlocker` derivation logic) that feeds a `ReviewResult` with a `critical` finding through the exit code decision, asserting `process.exit` was called with `1`. This can be done with vitest's `vi.spyOn(process, 'exit')` without spawning a subprocess.
- **Impact:** A refactor that breaks the `shouldFail(f.severity, options.failOn)` call site in `cli/index.ts` (wrong variable, wrong threshold passed) would go undetected by the test suite.
- **Effort:** S

---

## Check 6: --fail-fast output integrity

**Files:** `src/core/runner.ts`, `src/cli/index.ts`

**Analysis:**
- Fail-fast is implemented in the sequential loop (runner.ts lines 328–340): when `shouldEarlyExit()` returns true after an agent, `earlyExitAgent` is set and the loop `break`s. This happens **inside** the sequential loop only; the parallel path (lines 271–313) uses `Promise.allSettled` and does not support fail-fast early exit (consistent with the `--parallel` flag description which says "disables fail-fast early exit").
- `SwarmRunner.run()` always returns a `ReviewResult` — fail-fast does not throw. The result includes `earlyExit: { stoppedAt: agentName }` and the partial `findings` collected before the break.
- **JSON output on fail-fast:** `formatJson(result)` calls `JSON.stringify(result, null, 2)`. Since `result` is always a complete object (the function returns normally), the JSON output is always valid regardless of when fail-fast fires.
- **Markdown output on fail-fast:** A note is appended to the output string after the main body (cli/index.ts lines 230–237). This is also always valid.
- **Exit code on fail-fast:** The CLI still evaluates `result.findings.some(f => shouldFail(...))` at line 247, which is correct — if fail-fast triggered because a critical finding was found, exit code is still 1.

> CHECK 6: No finding — fail-fast is implemented cleanly. JSON is always valid because the runner returns a complete result object even on early exit. Exit code is correctly derived from findings, not from early-exit state.

---

## Check 7: pre-push-check.sh edge cases

**File:** `C:\Users\Mizzo\Claude\Personal-Memory-Bank\scripts\pre-push-check.sh`

**Analysis:**
- `set -euo pipefail 2>/dev/null || true` — present at line 6 with bash 3 compatibility fallback.
- **Empty diff / no staged files:** The hook's primary check is `git diff --name-only --diff-filter=U` (unresolved conflicts) and `git grep --cached` (conflict markers). If there are no staged files, both return empty output — no error, no block. The secret scan uses `PUSH_DIFF` which would be empty; `check_secret` calls `grep -E ... | head -3 || true`, so empty input returns exit 0. Large file scan iterates over empty `PUSH_FILE_LIST` — no warning. The script correctly exits 0 with "All pre-push checks passed." for an empty push. This is the correct behavior.
- **Binary file in diff:** The secret scan runs `grep -E` against the diff text. Binary files produce `Binary files a/... and b/... differ` lines in `git diff` output. These lines don't match `^\+[^+]` in the awk filter, so binary content is excluded from secret scanning. This means binary files containing embedded API keys would not be detected.
- **Exit codes:** exit 0 on success (line 146), exit 1 on any ERROR (line 141). Clear.
- **`.ps1` parity:** The PowerShell version has the same 7 checks in the same order. Logic is semantically equivalent. The PS1 wraps the entire body in a `try/catch` that exits 0 on unexpected errors (fails open), whereas the .sh version uses `|| true` patterns. Both implementations are consistent in their fail-open philosophy.

### Finding: Binary files excluded from secret scanning in pre-push-check
- **Severity:** Low
- **Confidence:** Verified
- **Repository:** PMB
- **Evidence:** `scripts/pre-push-check.sh:67–83` — the awk filter `^\+[^+]` only captures added text lines; `git diff` emits `Binary files a/x and b/x differ` for binary diffs, which does not match this pattern. Same issue in `pre-push-check.ps1:80–96`.
- **Reproduction:** Commit a binary file (e.g., a PNG) that has an API key string embedded in it. The secret scan will not detect it because `git diff` does not show binary content as `+` lines.
- **Root Cause:** `git diff` does not include binary content in the diff text output by default. The hook relies on diff text output for secret scanning and therefore misses binary files.
- **Fix:** Add a separate check using `git diff --name-only` to list binary files being pushed, then run `strings` or `git show HEAD:$file | grep -E <pattern>` on each binary file. Alternatively, add a note in the hook comments documenting this known gap so operators know to use a dedicated tool for binary secret scanning.
- **Impact:** An API key accidentally embedded in a committed binary asset (compiled artifact, image with EXIF, etc.) would not be caught by the hook.
- **Effort:** M

---

## Check 8: Contract corruption handling

**File:** `C:\Users\Mizzo\Claude\Personal-Memory-Bank\scripts\check-contract.sh`, `check-contract.ps1`

**Analysis:**
- **`.sh` version (lines 24–45):** Parses contract via embedded Python. The `try/except Exception: pass` in the Python script means malformed JSON (including truncated writes) prints nothing to stdout. Back in bash, `if [ -z "$CONTRACT_DATA" ]; then exit 0; fi` (line 43) — a parse failure produces empty output and the script exits 0, silently passing.
- **`.ps1` version (lines 23–27):** `$contract = Get-Content $ContractFile -Raw | ConvertFrom-Json` inside `try { ... } catch { exit 0 }` — malformed JSON triggers the catch, script exits 0 silently.
- **Consequence of silent pass on corrupt contract:** If `active-task.json` is truncated mid-write (e.g., Claude Code crashes while writing the contract), the hook silently exits 0, treating every file write as in-scope. The contract enforcement is completely bypassed until the file is manually repaired or deleted.

### Finding: Corrupt active-task.json causes silent contract bypass
- **Severity:** Medium
- **Confidence:** Verified
- **Repository:** PMB
- **Evidence:** `scripts/check-contract.sh:39–44` — Python `except Exception: pass` prints nothing; bash `[ -z "$CONTRACT_DATA" ]` exits 0. `scripts/check-contract.ps1:26` — `catch { exit 0 }`.
- **Reproduction:** Write `{ "status": "active", "task": "test", "scope": {"files":` (truncated) to `.claude/contracts/active-task.json`. Run any Write/Edit hook. The hook exits 0 with no output — no warning that the contract is corrupt.
- **Root Cause:** Both implementations treat JSON parse failure as "no contract" (fail open) rather than "contract present but corrupt" (warn). The distinction matters because a corrupt contract provides false confidence — the user believes scope enforcement is active but it is not.
- **Fix:** In the `.sh` version, change `except Exception: pass` to `except Exception as e: import sys; print("CORRUPT", file=sys.stderr)` and check for that sentinel in bash, printing a warning. In the `.ps1` version, the `catch` block should `Write-Host "⚠️  CONTRACT FILE CORRUPT: .claude/contracts/active-task.json cannot be parsed. Scope enforcement bypassed."` before exiting 0.
- **Impact:** A mid-write crash on the contract file silently disables scope enforcement for all subsequent Write/Edit operations until noticed. The user believes the guard is active when it is not.
- **Effort:** XS

---

## Check 9: mb init idempotency

**File:** `C:\Users\Mizzo\Claude\Personal-Memory-Bank\scripts\mb.sh`, function `invoke_init` (lines 374–507)

**Analysis:**
- The `copy_if_new()` function (lines 399–408) uses `if [ ! -e "$dst" ]; then cp "$src" "$dst"` — it **only copies if the destination does not exist**.
- Running `mb init` twice: the second run skips all existing files, printing `[=] filename (kept existing)` for each. User-edited content is preserved.
- On second run, the `.gitignore` block (lines 471–483) checks whether each entry already exists via `grep -q` before appending — idempotent.
- The `.pmb-version` file (lines 486–490) is written unconditionally: `printf '%s\n' "$LOCAL_VERSION" > "$TARGET/.pmb-version"` uses `>` (overwrite, not append). This is a version file, not user-edited content, so overwriting is acceptable.
- No `--force` flag exists, but none is needed — the script is already safe by design.

> CHECK 9: No finding — `mb init` is idempotent. All user-edited files are preserved on re-run via the `copy_if_new` pattern.

---

## Check 10: pre-compact-check.sh false-positive risk

**File:** `C:\Users\Mizzo\Claude\Personal-Memory-Bank\scripts\pre-compact-check.sh`

**Analysis:**
- **Check 1 (activeContext.md substantive lines):** Counts lines that are non-frontmatter, non-heading, non-empty, and ≥20 chars. A code example embedded in a markdown code block would be counted as substantive, but that is correct behavior — code examples are substantive content.
- **Check 2 (progress.md today's date):** `grep -qE "(^|^#+ |^- )${today}" "$PROGRESS_FILE"` where `$today` is `date +%Y-%m-%d`. This matches lines that START with the date, a heading+date, or a list item+date.
  - **False positive vector:** A code example or quoted string containing today's date (e.g., `\`2026-06-25\``) would match if the pattern appears at the start of a line. However, the regex anchors to `^` and requires the date to be the very first characters of the line (possibly preceded by `#` or `- `), which makes false positives from inline code or quoted strings unlikely in practice — they would typically appear mid-line.
  - **False negative vector (more likely):** If today's date appears only in a section heading (`## 2026-06-25`) or a bullet, the regex correctly matches. If progress is recorded with a different format (e.g., relative dates, or ISO-8601 with time `2026-06-25T14:30:00`), the check fails and blocks compaction.
- **Impact of false positive:** Would **allow** compaction (exit 0). The check only **blocks** (exit 2) when the condition is NOT met. A false positive in the date check means the gate passes when it should block — which is the less harmful direction.
- **Impact of blocking (false negative):** The script exits 2, blocking compaction. The user sees `[PreCompact] Compaction quality gate: 1 check(s) failed. - progress.md has no entry dated 2026-06-25`. This is actionable and correct. The user adds today's date and retries.

> CHECK 10: No finding — false positives would allow compaction (benign direction). False negatives block compaction with an actionable error message. Neither case produces invisible incorrect behavior.

---

## Check 11: SwarmRunner sequential loop — partial state on uncaught exception

**File:** `src/core/runner.ts` lines 315–355

**Analysis:**
- Each agent's `run()` call is wrapped in `withRetryTimeout`, which itself has a `try/catch` loop. After max retries, `withRetryTimeout` re-throws the last error.
- The outer sequential loop (lines 315–355) wraps each `withRetryTimeout` call in its own `try/catch` block (lines 319, 342–354). On catch: a warning is logged, `onProgress` is called with `findings: []`, and the loop **continues** to the next agent.
- This means: if an agent throws an uncaught exception (e.g., a bug in the agent's `run()` method itself, not just a timeout), it is caught at the loop level, treated as zero findings, and the loop continues.
- Partial output (findings from prior agents) is preserved in `allFindings` and included in the final result.
- The same pattern applies to the parallel path (lines 274–312) via `Promise.allSettled`, which also catches all rejections individually.

> CHECK 11: No finding — the sequential loop correctly isolates agent failures. Prior results are preserved. The loop continues rather than aborting. This is intentional and correct behavior. The warning is logged to stderr. No partial state is silently discarded.

---

## Summary of Findings

| # | Title | Severity | Confidence | Repo | Effort |
|---|-------|----------|------------|------|--------|
| 1 | Ollama-down throws unhandled rejection instead of clean process.exit | Medium | Verified | ACR | XS |
| 2 | Parse failure logs only 200 chars of raw LLM response | Low | Verified | ACR | XS |
| 3 | validateFindings zero results indistinguishable from empty LLM response | Low | Verified | ACR | XS |
| 4 | Invalid glob patterns in .aiignore silently misinterpreted as literals | Advisory | Verified | ACR | XS |
| 5 | Exit code unit tests cover shouldFail in isolation but not CLI wiring | Medium | Verified | ACR | S |
| 6 | Binary files excluded from secret scanning in pre-push-check | Low | Verified | PMB | M |
| 7 | Corrupt active-task.json causes silent contract bypass | Medium | Verified | PMB | XS |

**Null results:** Checks 2 (retry limits/leakage), 6 (fail-fast JSON validity), 9 (mb init idempotency), 10 (pre-compact false positives), 11 (sequential loop partial state) — no findings.
