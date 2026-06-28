# Agent 2 — PMB Deep Fixes

**Date:** 2026-06-27
**Status:** Complete
**Items fixed:** 2 ([FIXED])
**Commit:** 2543c07

---

### Finding: Doctor check 5 permanently SKIP'd due to grep -c Git Bash bug

- **Tag:** [FIXED]
- **Severity:** Medium
- **Confidence:** Verified
- **Repository:** PMB
- **Evidence:** `scripts/mb.sh:668-669`
- **Reproduction:** Run `mb doctor` in Git Bash — check 5 silently skips
- **Root Cause:** `grep -c` exits 1 on no-match in Git Bash; `|| echo 0` fires, producing `"0\n0"` string that breaks `[ "$VAR" -eq 0 ]` integer comparison
- **Fix:** Replaced with `grep -q` + explicit 0/1 assignment — commit 2543c07
- **Impact:** Check 5 now correctly reports [OK] or [WARN]; test for check 5 converted from SKIP to PASS (32 pass, 0 fail in doctor suite)
- **Effort:** XS

### Finding: test-mb-doctor.sh mutates real PMB repo during tests

- **Tag:** [FIXED]
- **Severity:** High
- **Confidence:** Verified
- **Repository:** PMB
- **Evidence:** `tests/test-mb-doctor.sh` — renames real `$REPO_ROOT` directories (VERSION, templates/memory-bank, fixtures/security/SEC-001-hardcoded-secret) and creates files in `$REPO_ROOT/standards/`; crash = broken repo
- **Reproduction:** Kill `bash tests/run.sh` mid-run; `git status` shows renamed/missing directories
- **Root Cause:** Tests modify live repo instead of copies, with no crash-safe restore
- **Fix:** EXIT trap guards on all four mutation sites (check 0, 2, 13, 14) — commit 2543c07
- **Impact:** `git status` is always clean after any test outcome, including SIGKILL
- **Effort:** S
