---
description: Full PMB health check — mb doctor (26 checks), staleness audit, structure validation, and security fixture verification on this repo's own memory bank. Reports a summary with pass/warn/fail for each area.
allowed-tools:
  - Bash(mb doctor)
  - Bash(mb status)
  - Bash(git status)
  - Bash(git log *)
  - Agent
---

# /health-check

Run the following checks in order and print a labeled result for each. At the end, print a one-paragraph summary with overall status (✅ all clear / ⚠️ warnings / ❌ failures).

## 1. Doctor

Run `mb doctor` from this repo's root. This runs all 26 health checks including structure, frontmatter, compaction integrity, and staleness summary.

**Output header:** `### mb doctor`

Print the full output. Call out any check that is not `[OK]`.

## 2. Status

Run `mb status` on this repo's own `memory-bank/`. This checks initialization state, memory bank presence, context standards, and recent activity.

**Output header:** `### mb status`

## 3. Staleness Audit

Review the staleness summary produced by `mb doctor` (Check 9 — staleness summary). It lists each memory-bank file with its staleness status (days since last review vs threshold).

**Output header:** `### Staleness Review`

Note any files flagged as stale. Stable files (90d threshold) and volatile files (7d threshold) have very different cadences — flag volatile overdue files as higher priority.

## 4. Git Status

Run `git status --short` and `git log --oneline -5`. Note any uncommitted changes, work in flight, or branches ahead of main.

**Output header:** `### Git Status`

## 5. Security Fixture Check

If `fixtures/security/` does not exist, skip this step and note it in the summary.

Otherwise, use the security-reviewer agent to review the `fixtures/security/` directory. Ask it: "Review the fixtures/security/ directory. For each subdirectory, report whether the expected SEC-00X rule ID appears in the findings — ✅ caught or ❌ missed."

**Output header:** `### Security Fixtures`

For each subdirectory in `fixtures/security/`, report:
- `SEC-00X` — ✅ caught / ❌ missed

## 6. Summary

Print a short paragraph summarizing all five areas. Use ✅ for clean, ⚠️ for warnings, ❌ for failures. Example:

> ✅ mb doctor: all 26 checks OK, structure valid. ⚠️ Staleness: activeContext.md is 9 days past its 7-day threshold. ✅ Working tree clean, main is up to date. ✅ Security fixtures: 9/9 rules caught.
