# Agent 2 — PMB Test Suite & CI Audit

**Date:** 2026-06-26
**Status:** Complete
**Finding count:** 7 (1 High, 3 Medium, 2 Low, 1 Advisory)

---

## Check 1: Full test suite run result

**Empirical result:** All 11 suites, 124 tests passed. Exit code 0.

```
Results: 17 passed, 0 failed   (mb plan)
Results: 8 passed, 0 failed    (mb preflight)
Results: 8 passed, 0 failed    (mb change-check)
Results: 15 passed, 0 failed   (mb status)
Results: 7 passed, 0 failed    (mb verify-integrity)
Results: 7 passed, 0 failed    (mb query)
Results: 11 passed, 0 failed   (mb init)
Results: 5 passed, 0 failed    (mb clean)
Results: 5 passed, 0 failed    (mb commit)
Results: 9 passed, 0 failed    (mb upgrade)
Results: 32 passed, 0 failed   (mb doctor)
All test suites passed.
```

**However:** The suite took **4 minutes 4 seconds** on Windows Git Bash (real time). The doctor suite alone took 3m45s. See Finding 1.

---

### Finding 1: Test suite takes 4+ minutes on Windows (CI wall-time risk)

- **Tag:** [NEW]
- **Severity:** Medium
- **Confidence:** Verified
- **Repository:** PMB
- **Evidence:** `bash tests/run.sh` — real: 4m4.202s; doctor suite alone: real 3m45.346s (measured on Windows Git Bash)
- **Reproduction:** `cd "C:/Users/Mizzo/Claude/Personal-Memory-Bank" && time bash tests/run.sh`
- **Root Cause:** The doctor test suite runs `mb doctor` 25+ times across 24 check tests. Each `mb doctor` invocation on Windows Git Bash pays significant process-spawn overhead per bash subprocess call. Checks 22/23 inner loops still spawn `echo | grep -qF` subprocesses per cached item even though the outer pre-normalization was moved out. On Linux CI (GitHub Actions ubuntu-latest) this will be significantly faster, but it remains a local DX problem.
- **Fix:** (a) For local Windows DX only: no action needed if CI is Linux. (b) If the doctor test suite is expected to run locally on Windows: refactor test-mb-doctor.sh to test multiple checks per `mb doctor` invocation where the test setup is compatible, rather than one invocation per check. (c) Longer term: replace `echo "$x" | grep -qF` inner-loop patterns in mb.sh with bash `[[ $var == *"$pattern"* ]]` to eliminate subprocess forks.
- **Impact:** 4-minute local test runs discourage developers from running tests before committing. CI (Linux) is unaffected.
- **Effort:** M

---

## Check 2: Test isolation

> CHECK: Do tests create temporary directories isolated from the real repo? Do any tests mutate the real PMB repo? Is there cleanup?

**Verified from source:**

- All 11 test scripts call `mktemp -d` for their test directory and use `trap 'rm -rf "$TMPDIR_X"' EXIT` for cleanup.
- `setup.sh` creates a fully isolated git repo inside the tmpdir.
- `tests/test-mb-doctor.sh` is the only suite that mutates `$REPO_ROOT` (the real PMB repo). It does so in three tests: check 0 (renames `$REPO_ROOT/VERSION`), check 2 (renames `$REPO_ROOT/templates/memory-bank/`), check 13 (renames `$REPO_ROOT/fixtures/security/SEC-001-hardcoded-secret`), and check 14 (creates 15 extra files in `$REPO_ROOT/standards/`).

### Finding 2: Doctor tests mutate real repo directory with fragile restore logic

- **Tag:** [NEW]
- **Severity:** High
- **Confidence:** Verified
- **Repository:** PMB
- **Evidence:** `tests/test-mb-doctor.sh` lines 93–96, 122–127, 361–366, 373–382. Example: check 0 renames `$REPO_ROOT/VERSION` to `$REPO_ROOT/VERSION.bak`, runs doctor, then restores. Check 2 renames `$REPO_ROOT/templates/memory-bank/` to `$REPO_ROOT/templates/memory-bank.bak/`.
- **Reproduction:**
  1. Kill the test process while it is between the rename and restore in check 0, 2, 13, or 14.
  2. `$REPO_ROOT/VERSION` or `$REPO_ROOT/templates/memory-bank/` will be absent from the real repo permanently until manually restored.
  3. Any parallel test run will also corrupt the shared `$REPO_ROOT/standards/` directory (check 14 leaves 15 extra `EXTRA-STD-*.md` files if it crashes before cleanup).
- **Root Cause:** The doctor checks test behaviour that is contingent on files in the PMB template repo itself (VERSION, templates/, fixtures/). Rather than staging a private copy of those files in the tmpdir, the tests rename real repo assets. A `trap` on `EXIT` protects against clean exits, but not against SIGKILL, machine hibernation, or test suite parallelism.
- **Fix:** Copy (not rename) the target files/directories to a backup path within the tmpdir before each check, then restore from the copy. For check 14, write extra standards files to a temp standards dir and point `MB_HOME` at that temp copy rather than writing to the real `$REPO_ROOT/standards/`.
- **Impact:** Eliminates risk of corrupting the real PMB repo during interrupted test runs. Also makes future parallelization of the test suite safe.
- **Effort:** M

---

## Check 3: Doctor check coverage (24 checks)

**Verified by reading test-mb-doctor.sh in full.**

The test file explicitly covers:

- Baseline (clean project — no ERROR)
- Check 0 (VERSION missing)
- Check 1 (not a git repo)
- Check 2 (templates missing)
- Check 3 (memory-bank files missing)
- Check 3b (CLAUDE.md missing)
- Check 4 (no settings.json)
- Check 4b (settings.json without PostToolUse)
- Check 4c (.githooks/pre-push missing)
- Check 4d (core.hooksPath not set)
- **Check 5: SKIPPED** (platform incompatibility)
- Check 6 (file size over limit)
- Check 7 (handoff.md found)
- Check 8 (compaction_generation >= 3)
- Check 9 (stale files)
- Check 10 (placeholder text)
- Check 11 (missing standards file)
- Check 12 (no .pmb-version)
- Check 13 (fixtures/security missing)
- Check 14 (standards count > 20)
- Check 15 (startup context > 15 KB)
- Check 16 (hook error log)
- Check 17 (semantic drift signals)
- Check 18 (stable decisions old)
- Check 19 (authority hierarchy violation)
- Check 20 (integrity checksum mismatch)
- Check 21 (git-vs-reviewed lag)
- Check 22 (completed-but-still-planned)
- Check 23 (stale next steps)
- Check 24 (docs/plans/ not found)

### Finding 3: Check 5 (Token Budget drift) permanently skipped on Windows Git Bash

- **Tag:** [NEW]
- **Severity:** Medium
- **Confidence:** Verified
- **Repository:** PMB
- **Evidence:** `tests/test-mb-doctor.sh` lines 236–239: explicit `SKIP` with `PASS=$((PASS + 1))`. Reproduction of the underlying bug confirmed empirically:
  ```
  LOCAL_HAS=$(grep -c "NOMATCH" file.md 2>/dev/null || echo 0)
  # On Windows Git Bash: grep exits 1 (no match) → || fires → output is "0\n0"
  # LOCAL_HAS="0\n0" → [ "$LOCAL_HAS" -eq 0 ] → "integer expected" error
  ```
- **Reproduction:**
  ```bash
  bash -c 'result=$(grep -c "NOMATCH_XYZ" /dev/null 2>/dev/null || echo 0); echo "result=|$result|"; [ "$result" -eq 0 ] && echo OK || echo FAIL'
  ```
  Output: `result=|0\n0|` and `bash: [: 0\n0: integer expected`
- **Root Cause:** `grep -c` in Git Bash exits with code 1 when there are zero matches (POSIX-compliant), causing the `|| echo 0` fallback to fire even though grep already emitted `0`. The result is `0\n0` stored in the variable. The `[ "$x" -eq 0 ]` test then fails because `0\n0` is not an integer.
- **Fix in mb.sh:** Replace `$(grep -c "PATTERN" file 2>/dev/null || echo 0)` with `$(grep -c "PATTERN" file 2>/dev/null; echo -n "")` — this does not suppress the count when grep exits 1, but avoids the double-0. Better fix: `$(grep -c "PATTERN" file 2>/dev/null || true)` and test with `[ "${x:-0}" -gt 0 ]`. Or use `awk` instead: `$(awk '/PATTERN/{c++}END{print c+0}' file)`.
- **Fix in test:** Once mb.sh is fixed, remove the SKIP and replace it with an actual test.
- **Impact:** Check 5 is currently untested. The bug also means any user running `mb doctor` on Windows who has `~/.claude/CLAUDE.md` but not the local autocompact line will get a bash error output rather than a clean warning.
- **Effort:** S

---

## Check 4: mb plan promote file-movement verification

> RESULT: No finding — the test at `tests/test-mb-plan.sh` line 59 calls `assert_file_exists "$TMPDIR_PLAN/docs/plans/2099-01-01-test.md"` to verify the file physically exists in `docs/plans/`. It also checks that `status:` frontmatter was injected (line 62). The test is not exit-code-only; it verifies the actual file movement and content.

---

## Check 5: New command test coverage (preflight, change-check)

### Finding 4: mb preflight test suite has no failure path test

- **Tag:** [NEW]
- **Severity:** Low
- **Confidence:** Verified
- **Repository:** PMB
- **Evidence:** `tests/test-mb-preflight.sh` — tests only: basic run exits 0, `--staged` flag exits 0, `--json` flag exits 0, unknown flag exits 0. No test for: git not found, missing prerequisite producing a non-zero exit or `[WARN]` output, the actual tool-availability check content.
- **Reproduction:** Read `tests/test-mb-preflight.sh` in full — no `assert_exit_nonzero` or `assert_contains` on a warning condition.
- **Root Cause:** The test was written to verify the command doesn't crash, not to verify it accurately diagnoses missing prerequisites.
- **Fix:** Add a test that creates a temp project where `git` is not on PATH (or mock it), invokes `mb preflight`, and asserts a non-zero exit or a tool-missing warning in the output.
- **Impact:** A regression in preflight's tool-detection logic would go undetected.
- **Effort:** S

### Finding 5: mb change-check test suite has no error/invalid-ref path

- **Tag:** [NEW]
- **Severity:** Low
- **Confidence:** Verified
- **Repository:** PMB
- **Evidence:** `tests/test-mb-change-check.sh` — tests: basic run (no-op), run with a real diff, explicit `HEAD~1` ref. No test for: invalid ref (e.g., `mb change-check NONEXISTENT_SHA`), behavior when git is not initialized.
- **Reproduction:** Read `tests/test-mb-change-check.sh` in full — no `assert_exit_nonzero` call exists.
- **Root Cause:** Error paths were not considered in the initial test authoring.
- **Fix:** Add a test passing `mb change-check TOTALLY_INVALID_REF` and asserting either a non-zero exit or an error message in the output.
- **Impact:** A regression in change-check's error handling would go undetected.
- **Effort:** XS

---

## Check 6: mb-doctor-self-check CI job

> `pmb-health.yml` line 286:
>
> ```yaml
> run: MB_HOME="$(pwd)" bash scripts/mb.sh doctor
> ```

**Observations:**

1. The job invokes `bash scripts/mb.sh doctor` — it does NOT invoke an `mb` binary on PATH. It sources the script directly with `bash`. This is functionally correct and sufficient for testing `mb doctor` logic, but it does not test the installed `mb` symlink/PATH configuration that end users would actually use.
2. `MB_HOME="$(pwd)"` is set inline, which correctly points the script at the checked-out repo's templates and fixtures.
3. If `scripts/mb.sh doctor` fails (exits non-zero), the job fails. The error message will be the last lines of doctor output, which are informative.
4. The self-check on the PMB repo itself produces `[WARN]` for `core.hooksPath not set` (confirmed by empirical run), which does not cause a non-zero exit. Doctor exits 0 on WARNs.

### Finding 6: mb-doctor-self-check does not test the installed mb CLI (PATH install)

- **Tag:** [NEW]
- **Severity:** Advisory
- **Confidence:** Verified
- **Repository:** PMB
- **Evidence:** `.github/workflows/pmb-health.yml` line 286: `bash scripts/mb.sh doctor` — no `install.sh` or symlink step precedes this.
- **Reproduction:** The job never calls `which mb` or `mb doctor` as a CLI command.
- **Root Cause:** Testing the script directly via `bash scripts/mb.sh` is simpler and avoids install steps, but it means the install process (symlink creation, PATH addition) is never validated in CI.
- **Fix (optional):** Add a step before the doctor run that executes `bash install.sh` (or the equivalent install command), then invokes `mb doctor` as a command. This would catch regressions in the install path.
- **Impact:** If `install.sh` breaks or the symlink points to the wrong path, no CI job catches it. Users who install `mb` would encounter the bug but CI would remain green.
- **Effort:** XS

---

## Check 7: powershell-lint job severity enforcement

**From `.github/workflows/pmb-health.yml` lines 264–276:**

```powershell
$results = $files | ForEach-Object {
    Invoke-ScriptAnalyzer -Path $_ -Severity Error
}
```

**Observations:**

1. `-Severity Error` — only `Error`-level PSScriptAnalyzer rules are enforced. `Warning` and `Information` severity findings are silently ignored.
2. Scope: `Get-ChildItem -Recurse -Filter "*.ps1" -Path "scripts","templates/scripts"` — covers all `.ps1` files in both script directories (15 files confirmed). Correct scope.
3. CRLF line endings: PSScriptAnalyzer does not have a rule for CRLF vs LF line endings. The CRLF warnings visible in the test run output are from `git add` on Windows, not from the scripts themselves, and would not appear in the CI `ubuntu-latest` runner. The lint job would not catch CRLF issues.

### Finding 7: PSScriptAnalyzer enforces only Error severity — Warning/Information bypassed

- **Tag:** [NEW]
- **Severity:** Medium
- **Confidence:** Verified
- **Repository:** PMB
- **Evidence:** `.github/workflows/pmb-health.yml` line 270: `Invoke-ScriptAnalyzer -Path $_ -Severity Error`
- **Reproduction:** A PSScriptAnalyzer `Warning`-level finding (e.g., `PSAvoidUsingCmdletAliases`, `PSUseShouldProcessForStateChangingFunctions`, `PSAvoidUsingPositionalParameters`) in any `.ps1` file will not cause the job to fail.
- **Root Cause:** The severity was set conservatively to avoid noise from Warning-level rules during initial CI setup.
- **Fix:** Change to `-Severity Error,Warning` or add `-ExcludeRule` for specific noisy rules you intentionally accept (e.g., `PSAvoidUsingWriteHost`), rather than silencing the entire Warning category.
- **Impact:** Real bugs detectable at Warning severity (alias use, incorrect string escaping, common mistakes) will not be caught. `PSAvoidUsingCmdletAliases` alone would catch aliases like `ls`, `cat`, `rm` that behave differently on Linux (if the script were ever ported).
- **Effort:** XS

---

## Check 8: Doctor O(n) optimization for checks 22 and 23

> Commit message claimed "pre-cache O(n²) normalization". Verification:

**Verified from source (`scripts/mb.sh` lines 1043–1124):**

- Check 22: Lines 1047–1057 — `_PLANNED_CACHE=()` is pre-populated with all `⏸` lines from all memory-bank files **before** the outer loop. The comment reads: `# Pre-normalize all ⏸ lines once — avoids O(n²) subprocess spawning in inner loop`. This is present and correct.
- Check 23: Lines 1085–1091 — `_DONE_CACHE=()` is pre-populated with all `✅` lines from progress.md **before** the inner loop. Also present and correct.

**Caveat (advisory, not a bug):** The inner loop body at line 1070 still executes `echo "${_PLANNED_CACHE[$_ci]}" | grep -qF "$window"` — a subprocess fork per cache entry per window. With typical memory-bank sizes this is not an issue, but the comment's claim of "avoids O(n²) subprocess spawning" is partially inaccurate: the normalization subprocess (`_mb_normalize`) is moved out, but the `grep -qF` subprocess is still inside both loops. A pure bash `[[ ${_PLANNED_CACHE[$_ci]} == *"$window"* ]]` would eliminate the remaining subprocess spawns.

> CHECK 8: No finding — the pre-caching is implemented as claimed. The inner grep-qF subprocess is a performance advisory only, not a correctness issue.

---

## Summary Table

| #   | Finding                                                        | Tag | Severity | Confidence | Effort |
| --- | -------------------------------------------------------------- | --- | -------- | ---------- | ------ |
| 1   | Test suite takes 4+ minutes on Windows                         | NEW | Medium   | Verified   | M      |
| 2   | Doctor tests mutate real repo with fragile restore             | NEW | High     | Verified   | M      |
| 3   | Check 5 (Token Budget drift) permanently skipped — grep -c bug | NEW | Medium   | Verified   | S      |
| 4   | mb preflight has no failure-path test                          | NEW | Low      | Verified   | S      |
| 5   | mb change-check has no invalid-ref test                        | NEW | Low      | Verified   | XS     |
| 6   | mb-doctor-self-check does not test installed mb CLI            | NEW | Advisory | Verified   | XS     |
| 7   | PSScriptAnalyzer enforces only Error severity                  | NEW | Medium   | Verified   | XS     |
