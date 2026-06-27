# Agent 6 — Ecosystem Drift & Documentation Accuracy Post-Fixes

**Date:** 2026-06-26
**Status:** Complete
**Finding count:** 8 (7 NEW, 1 REGRESSION)

---

## Check 1: ACR Memory Bank Staleness

### Finding: activeContext.md test count stale after Round 1 remediation commits

- **Tag:** [NEW]
- **Severity:** Medium
- **Confidence:** Verified
- **Repository:** ACR
- **Evidence:** `memory-bank/activeContext.md` line 23: "276 unit tests passing"; `npm test` output: `Tests 284 passed (284)`; remediation commits `a2ac47d`, `1243e2c` (2026-06-26) added 8 tests (7 CLI tests + 1 runner test) that are absent from the file.
- **Reproduction:** Run `npm test 2>&1 | grep "Tests "` → 284. Read `memory-bank/activeContext.md` → claims 276. Delta = 8 undocumented tests.
- **Root Cause:** `activeContext.md` was last substantively updated for v1.1.0 (276 tests). The Round 1 audit remediation commits added CLI unit tests and were not reflected in the memory bank.
- **Fix:** Update `memory-bank/activeContext.md` line 23 from "276 unit tests passing" to "284 unit tests passing". Update Key Commands block: `npm test  # all unit tests (284 passing)`. Update "276 unit tests" bullet under What's Working to 284.
- **Impact:** Claude reads the memory bank at session start. A stale test count causes Claude to misjudge project health and may confidently cite incorrect numbers in outputs.
- **Effort:** XS

---

### Finding: progress.md test count and version history missing Round 1 remediation

- **Tag:** [NEW]
- **Severity:** Medium
- **Confidence:** Verified
- **Repository:** ACR
- **Evidence:** `memory-bank/progress.md` lines 68–70: "Unit Tests: 276 passing across 34 test files" and "Total: 276". Actual: 284. Version History table (lines 126–143) has no entry for the Round 1 audit remediation sprint (commits `7f87887`, `a2ac47d`, `47ea2b9`, `1243e2c` — all 2026-06-26). `progress.md` frontmatter shows `last-reviewed: 2026-06-25` but body says "Last Updated: 2026-06-15", indicating the frontmatter was auto-touched but prose was not updated.
- **Reproduction:** Read `memory-bank/progress.md` → Metrics section says 276/276. Run `npm test` → 284. Git log shows 6+ remediation commits after the last stated version (1.1.0).
- **Root Cause:** `progress.md` prose was not updated after the remediation sprint. The PostToolUse hook updates `last-reviewed` frontmatter on any edit, masking the staleness of the prose content.
- **Fix:** Update Metrics section to 284 tests, 35 test files. Add a version row for remediation work (v1.1.x or label it "1.1.0+audit 2026-06-26") covering the 8 commits in the sprint.
- **Impact:** Accumulated inaccuracy in the primary progress tracker. A new contributor or Claude in a fresh session would conclude the project has 276 tests and has not changed since v1.1.0.
- **Effort:** S

---

## Check 2: ACR CHANGELOG Coverage of Round 1 Fixes

### Finding: CHANGELOG missing entry for Round 1 audit remediation sprint

- **Tag:** [NEW]
- **Severity:** Medium
- **Confidence:** Verified
- **Repository:** ACR
- **Evidence:** `CHANGELOG.md` contains entries for `[1.1.0]` (2026-06-25) and `[1.0.0]` (2026-06-24) but has NO entry for `[1.0.1]`. `progress.md` line 142 references "v1.0.1: Audit remediation: sanitizer multi-pattern fix… 264 tests." Six remediation commits landed on 2026-06-26 (`7f87887`, `a2ac47d`, `47ea2b9`, `a5faf46`, `1243e2c`, `345697d`) covering: OllamaProvider URL validation (SSRF), CLI try/catch for Ollama errors, gitleaks in release.yml, vscode-extension tests in CI, /change-review Job 7 diff fix, CONTRACTS-GUIDE.md / HOOKS-GUIDE.md creation, SwarmRunner decomposition, 8 new CLI unit tests. None are in CHANGELOG.
- **Reproduction:** `grep "\[1\." CHANGELOG.md` → only `[1.1.0]` and `[1.0.0]`. `git log --oneline --since="2026-06-24"` → 10+ commits not reflected in any CHANGELOG entry.
- **Root Cause:** The remediation sprint did not include a CHANGELOG update. The sprint was framed as fixing pre-production audit findings, not as a versioned release — but the CHANGELOG already references v1.0.1 in progress.md, indicating an intent that was not followed through.
- **Fix:** Add a `[1.1.1]` (or `[1.0.1]`) CHANGELOG entry covering all remediation work: SSRF validation, CLI error handling, gitleaks scan in release.yml, vscode-extension CI, /change-review Job 7 fix, CONTRACTS-GUIDE.md, HOOKS-GUIDE.md, SwarmRunner.run() decomposition, 8 CLI unit tests (284 total).
- **Impact:** The CHANGELOG is the authoritative public record of what changed. Missing entries mean users upgrading from 1.0.0 have no record of security fixes (SSRF, gitleaks) applied in the sprint.
- **Effort:** S

---

## Check 3: ACR CLAUDE.md Broken File References

> [CHECK 3: STANDARDS FILES]: No finding — all referenced standards files exist under `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\standards\`: ACCESSIBILITY.md, AGENTIC-SAFETY.md, CODE-QUALITY.md, LOGGING.md, MCP-SECURITY.md, SECURITY-GUARDRAILS.md, WORKFLOW.md. Both `docs/CONTRACTS-GUIDE.md` and `docs/HOOKS-GUIDE.md` also exist. No broken references detected.

---

## Check 4: CONTRACTS-GUIDE.md Documents Dual-Format Scope?

### Finding: CONTRACTS-GUIDE documents only one scope format; dual-format hook support is undocumented

- **Tag:** [NEW]
- **Severity:** Low
- **Confidence:** Verified
- **Repository:** ACR
- **Evidence:** `docs/CONTRACTS-GUIDE.md` documents only the ACR canonical format: `scope: [{file, op}]`. The scripts `scripts/check-contract.sh` lines 33–42 and `scripts/check-contract.ps1` lines 35–44 explicitly handle BOTH formats with comments: "PMB template: scope.files (array of strings)" and "ACR/canonical: scope (array of {file, op} objects)". CONTRACTS-GUIDE has zero mention of `scope.files`, the PMB format, or that dual formats are supported.
- **Reproduction:** Read `docs/CONTRACTS-GUIDE.md` → Schema section shows only `scope: [{file, op}]`. Read `scripts/check-contract.sh` lines 33–46 → dual-format parser comment and code. No cross-reference.
- **Root Cause:** CONTRACTS-GUIDE was written when only the ACR canonical format existed. The dual-format support was added to the scripts (during PMB integration) without a corresponding documentation update.
- **Fix:** Add a "Alternate Scope Format" note to CONTRACTS-GUIDE.md under the Schema section: document that the hook also accepts `scope: { files: ["path1", "path2"] }` (the PMB template format), and note that ACR canonical is preferred for new contracts.
- **Impact:** A contributor writing contracts manually and reading only the guide will produce ACR-format contracts (correct), but will be confused when they encounter PMB-format contracts from other projects in the ecosystem. The hook behavior becomes a surprise discovery.
- **Effort:** XS

---

## Check 5: HOOKS-GUIDE.md PreCompact Exit Code Claim

### Finding: HOOKS-GUIDE claims PreCompact exits 2 to block compaction, but settings.json wires in `|| true` that suppresses the exit code — compaction cannot actually be blocked

- **Tag:** [REGRESSION]
- **Severity:** High
- **Confidence:** Verified
- **Repository:** Both (ACR + PMB)
- **Evidence:**
  - `docs/HOOKS-GUIDE.md` (ACR) lines 85–86: "**Exits 2** — one or more checks fail. **Compaction is blocked.** Claude Code treats a non-zero exit from a PreCompact hook as a block signal."
  - `scripts/pre-compact-check.sh` line 6: `# Exits 2 to block compaction; exits 0 to allow.` Line 66: `exit 2`
  - `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\.claude\settings.json` lines 59–64 (actual command): `"pwsh -NonInteractive -File scripts/pre-compact-check.ps1 2>/dev/null || bash scripts/pre-compact-check.sh 2>/dev/null || true"`
  - `C:\Users\Mizzo\Claude\Personal-Memory-Bank\.claude\settings.json` (same command, same `|| true`)
  - `C:\Users\Mizzo\Claude\Personal-Memory-Bank\templates\.claude\settings.json` line 105: same `|| true`
  - `ACR CLAUDE.md` line 140: "the `PreCompact` hook **warns** first if memory bank is stale" — uses "warns" not "blocks", implicitly acknowledging the || true behavior but without explanation.
  - The `|| true` at the end of the shell command chain means: if pwsh succeeds, use its exit; if pwsh fails (ENOENT), fall through to bash; if bash also fails or returns non-zero, `true` unconditionally returns exit 0. In practice on this Windows machine, pwsh runs and the `.ps1` can return 2 — but the shell chain's `||` operator means `true` only activates on failure. **However**: the sh fallback `|| bash ... || true` is a chain that, if pwsh exits 2 (success-branch not taken), would not invoke bash. But on the pwsh path alone: `pwsh ... 2>/dev/null` returning exit 2 → the outer `||` chain evaluates the next term `bash ... 2>/dev/null` → if bash also exits 2, then `|| true` returns 0. Conclusion: on any path where both runners exit 2, the final exit is 0. On Windows where only pwsh is present, pwsh exits 2, then `|| bash ... || true` → bash absent (ENOENT, exits non-zero via 127), then `|| true` → exits 0. The block is defeated on Windows.
- **Reproduction:** On Windows: the pwsh script exits 2 on failure. The bash fallback fails with exit 127 (not found). The `|| true` then fires → final exit 0. Claude Code sees exit 0, allows compaction. The hook's block claim in HOOKS-GUIDE is not achievable on Windows.
- **Root Cause:** The `|| true` was added as a fail-open safety net (to prevent hook errors from blocking all work). This is correct for PostToolUse hooks. For PreCompact, it silently defeats the blocking behavior that the documentation promises.
- **Fix:** Two options:
  1. (Preferred) Remove `|| true` from the PreCompact hook command. The fail-open rationale does not apply here — if both runners fail to even start (pwsh and bash missing), exit 1 is acceptable. Change to: `"pwsh -NonInteractive -File scripts/pre-compact-check.ps1 2>/dev/null || bash scripts/pre-compact-check.sh 2>/dev/null"`
  2. (Documentation patch only) Update HOOKS-GUIDE to state that PreCompact "warns but does not block" and update CLAUDE.md ACR to align. This is accurate but weakens the stated safety guarantee.
     Fix must be applied in ACR `settings.json`, PMB `settings.json`, and PMB `templates/.claude/settings.json`.
- **Impact:** The memory-gate advertised as a compaction block is actually a compaction warning on Windows. Claude can compact even when `activeContext.md` and `progress.md` are stale, defeating the principal purpose of the PreCompact hook. Users reading the docs believe their governance is enforced when it is not.
- **Effort:** S

---

## Check 6: PMB Memory Bank Staleness

> [CHECK 6: PMB ACTIVECONTEXT STALENESS]: No finding — `last-reviewed: 2026-06-24`, today is 2026-06-26, delta = 2 days, well within the 14-day staleness threshold. Current Focus accurately describes the completed audit and remediation sprint. No stale state detected.

### Finding: PMB progress.md last-reviewed frontmatter is 4 days stale relative to activeContext.md

- **Tag:** [NEW]
- **Severity:** Low
- **Confidence:** Verified
- **Repository:** PMB
- **Evidence:** `memory-bank/progress.md` frontmatter: `last-reviewed: 2026-06-22`. `memory-bank/activeContext.md` frontmatter: `last-reviewed: 2026-06-24`. The remediation sprint completed 2026-06-24 per activeContext.md. The staleness threshold for progress.md is 90 days (not triggered), but the 2-day gap between the two files indicates progress.md was not edited during the sprint that updated activeContext.md.
- **Reproduction:** Read `memory-bank/progress.md` frontmatter → `last-reviewed: 2026-06-22`. Read `memory-bank/activeContext.md` → `last-reviewed: 2026-06-24`. The PostToolUse hook updates `last-reviewed` only when the file is edited; the gap proves progress.md was not touched during the 2026-06-24 sprint.
- **Root Cause:** The PMB audit remediation sprint (WS1–WS4) updated activeContext but not progress. Progress.md body content may also be stale relative to the 115-assertion test suite added in WS2.
- **Fix:** Open progress.md and update it to reflect WS1–WS4 completion (v1.1.2 and v1.2.0 entries), 115 new test assertions, and the current date. The staleness threshold is 90d so this is not urgent but creates a documentation gap for the audit trail.
- **Impact:** Future sessions where progress.md is relied upon for historical state will see a gap at the 2026-06-22–2026-06-24 sprint.
- **Effort:** XS

---

## Check 7: PMB README Accuracy for New Commands and CI

### Finding: README Slash Commands table says "mb doctor (20 checks)" but doctor has 24 checks

- **Tag:** [NEW]
- **Severity:** Medium
- **Confidence:** Verified
- **Repository:** PMB
- **Evidence:** `README.md` line 113: `| /health-check | PMB-only: runs mb doctor (20 checks) and prints a labeled summary |`. `README.md` line 75 (Day-to-Day Commands section): `mb doctor  Full 24-point diagnostic`. `.claude/commands/health-check.md` description field: "mb doctor (24 checks)". The internal-facing slash command description is correct at 24; the external-facing README table is wrong at 20.
- **Reproduction:** `grep -n "20\|24" README.md` → line 75 says 24-point, line 113 says 20 checks. `grep -n "24" .claude/commands/health-check.md` → "24 checks" confirmed correct.
- **Root Cause:** The `/health-check` description in README was not updated when doctor expanded from 20 to 24 checks. The Day-to-Day section was updated but the Slash Commands table was not.
- **Fix:** Update `README.md` line 113 from `mb doctor (20 checks)` to `mb doctor (24 checks)`.
- **Impact:** Users reading the Slash Commands table get an incorrect check count. Contradicts the preceding section (line 75) in the same file — internal inconsistency that erodes trust in the docs.
- **Effort:** XS

### Finding: README omits mb preflight and mb change-check from command documentation

- **Tag:** [NEW]
- **Severity:** Medium
- **Confidence:** Verified
- **Repository:** PMB
- **Evidence:** `README.md` Features table (line 18): "`mb` CLI: init, status, doctor, query, clean, commit, upgrade, verify-integrity, help (9 primary commands)". `scripts/mb.ps1` line 23 ValidateSet includes `preflight` and `change-check`. `scripts/mb.sh` lines 58–59 show both commands in the help output. `docs/QUICK-REFERENCE.md` lines 27–28 document both commands. The README's Day-to-Day Commands section and Features at a Glance table omit both commands entirely.
- **Reproduction:** `grep -n "preflight\|change-check" README.md` → no matches. `grep -n "preflight\|change-check" scripts/mb.ps1` → commands exist and are implemented.
- **Root Cause:** `mb preflight` and `mb change-check` were added during a sprint that updated QUICK-REFERENCE.md but did not update the README command list or Features table.
- **Fix:** Add both commands to the Day-to-Day Commands section in README.md:
  ```
  mb preflight   Check tool availability for /change-review (git, gh, ai-review-agent, semgrep)
  mb change-check  Post-change summary — diff stats, file types, /change-review job preview
  ```
  Also update the Features at a Glance table count from "9 primary commands" to "11 primary commands".
- **Impact:** First-time users reading the README have no way to discover two workflow-critical commands. The discoverability gap is compounded by the absence of these commands from the Day-to-Day section which is the first place users look.
- **Effort:** XS

---

## Check 8: PMB CI Discoverability

> [CHECK 8: PMB CI DISCOVERABILITY]: Finding — `pmb-health.yml` CI workflow exists and is documented in README.md's `<details>` block ("CI / governance pipeline") at line 216. It is also referenced in `docs/HOOKS-GUIDE.md` (line 23, the enforcement stack table mentions CI). However, none of PMB's memory-bank files reference the CI workflow, and neither CONTRACTS-GUIDE.md nor any other `docs/` file links to it directly. For a contributor who reads only the top-level CLAUDE.md or memory-bank files, CI existence is not discoverable. However, because README.md does document the workflow (even if buried in a collapsed `<details>` block), this does not rise to a standalone finding. The CI is discoverable via README. Severity is Advisory only.

> Advisory note: The `pmb-health` CI section is inside a collapsed `<details>` block in README.md. It is not surfaced in the main flow of the document. A contributor scanning the README linearly would not see it unless they expand the section. Consider promoting a one-liner CI badge or a CI section mention to the main README body.

---

## Summary Table

| #   | Finding                                                             | Tag | Severity                                               | Repo       | Effort |
| --- | ------------------------------------------------------------------- | --- | ------------------------------------------------------ | ---------- | ------ | ---- | --- |
| 1   | activeContext.md test count stale (276 vs 284 actual)               | NEW | Medium                                                 | ACR        | XS     |
| 2   | progress.md missing remediation sprint entries and stale test count | NEW | Medium                                                 | ACR        | S      |
| 3   | CHANGELOG missing Round 1 remediation sprint entry                  | NEW | Medium                                                 | ACR        | S      |
| 4   | CONTRACTS-GUIDE omits dual-format scope support                     | NEW | Low                                                    | ACR        | XS     |
| 5   | PreCompact `                                                        |     | true` defeats block claim in HOOKS-GUIDE and CLAUDE.md | REGRESSION | High   | Both | S   |
| 6   | PMB progress.md last-reviewed 4 days behind activeContext.md        | NEW | Low                                                    | PMB        | XS     |
| 7a  | README /health-check table says "20 checks" vs actual 24            | NEW | Medium                                                 | PMB        | XS     |
| 7b  | README omits mb preflight and mb change-check commands              | NEW | Medium                                                 | PMB        | XS     |
