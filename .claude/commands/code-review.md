---
description: "Deep code review covering security, correctness, maintainability, testing, and architecture drift. Uses Claude (cloud API) — sends diff content to Anthropic. For offline/local review, use /ai-review instead. Spawns separate subagents per domain so findings don't bias each other."
allowed-tools:
  - Bash(git diff *)
  - Bash(git log *)
  - Bash(git status *)
  - Read
  - Agent
---

# Code Review

You are a senior engineer orchestrating a thorough code review. Follow every step below in order. Do not skip any section. The review contract (domains, severity levels, finding schema, report sections, opposition review requirements, and failure criteria) is defined in `standards/CODE-REVIEW.md` — read it at Step 1 and apply it throughout.

## Step 1 — Load Review Contract

Read `standards/CODE-REVIEW.md` in full. This file defines:

- Required and conditional domains
- Severity levels and field value scales
- Required finding fields
- Required report sections
- Opposition review requirements
- Failure criteria
- Remediation policy

Do not proceed until you have read the standard. All subsequent steps must conform to it.

## Step 2 — Determine Scope

If the user specified a file or folder path, review that target. Otherwise run:

```
git diff HEAD
git status
```

If the diff is empty, let the user know and stop.

## Step 3 — Gather Context

```
git log --oneline -10
```

For each changed file run:

```
git log --oneline -5 -- <filename>
```

Use this to understand why the code exists and whether the change is consistent with past decisions.

Determine which conditional domains apply:

- Performance: does the diff touch tight loops, database queries, or I/O paths?
- Accessibility: does the diff touch HTML/JSX/TSX/Vue/Svelte files?

## Step 4 — Spawn Independent Domain Subagents

Spawn one subagent per required domain from the standard, plus any conditional domains that apply. Each subagent sees only the code and its own domain lens — not other subagents' findings.

For each subagent, provide:

- The diff/file being reviewed
- Pass the full text of the Severity, Blocking, and Basis field definitions from `standards/CODE-REVIEW.md` verbatim in each subagent prompt — do not paraphrase
- Instruction to populate all required finding fields: Domain, Severity, Location, Evidence, Basis, Impact, Recommendation, Blocking
- Instruction to return structured findings only — no remediation

Domains to spawn (always): Security, Correctness, Maintainability, Testing, Architecture Drift
Domains to spawn (if applicable): Performance, Accessibility

## Step 5 — Opposition Review

Spawn one final subagent as the opposition reviewer. Give it all domain findings. It must answer all four questions from the standard's Opposition Review section:

1. Is any Critical/High finding overstated? Provide counter-evidence.
2. What was not reviewed that could matter?
3. Which findings might be false positives in this codebase's context?
4. What cross-domain risk did no single domain agent catch?

A general statement that none apply is a failure — all four must be explicitly answered.

## Step 6 — Assemble Report

Produce the report using the required sections from the standard:

**Scope:** [git diff HEAD or filename]
**Files reviewed:** N

**Domain Coverage:**
| Domain | Status |
|---|---|
| Security | Reviewed |
| Correctness | Reviewed |
| Maintainability | Reviewed |
| Testing | Reviewed |
| Architecture Drift | Reviewed |
| Performance | Reviewed / Skipped (not applicable) |
| Accessibility | Reviewed / Skipped (not applicable) |

## Supported Findings

_(VERIFIED and INFERRED findings. Omit rows that belong in Predicted Risks.)_

| Domain | Severity | Location | Evidence | Basis      | Impact | Recommendation | Blocking   |
| ------ | -------- | -------- | -------- | ---------- | ------ | -------------- | ---------- |
| ...    | ...      | ...      | ...      | [VERIFIED] | ...    | ...            | true/false |

## Predicted Risks

_(SPECULATIVE findings only. Omit this entire section if none exist.)_

| Domain | Severity | Location | Evidence | Basis         | Impact | Recommendation | Blocking |
| ------ | -------- | -------- | -------- | ------------- | ------ | -------------- | -------- |
| ...    | ...      | ...      | ...      | [SPECULATIVE] | ...    | ...            | false    |

**Testing Gaps:**
List any missing tests identified by the Testing domain subagent.

**Opposition Review:**
[Answers to all four opposition review questions]

**Verdict:** Approve / Request Changes / Needs Discussion

One paragraph summary of the most important confirmed findings.

## Step 7 — Record Review Completion

If the Verdict above is **Approve** (no unresolved finding with `Blocking: true`), compute a hash of the reviewed diff and write it to `.claude/.code-review-ok` (create the `.claude` directory first if it doesn't exist). The marker is bound to this exact diff — a `PreToolUse` hook recomputes the same hash before the next `git commit` and only allows it through if the working tree hasn't changed since the review.

Bash:
```
git diff HEAD | sha256sum | cut -d' ' -f1 > .claude/.code-review-ok
```

PowerShell (do NOT pipe `git diff` directly into a hash cmdlet — PowerShell's pipeline re-tokenizes external-command output and will not match the hash `review-reminders.ps1` recomputes; redirect to a file first so the hash covers the exact raw bytes):
```
git diff HEAD > "$env:TEMP\pmb-diff-hash.tmp"
(Get-FileHash "$env:TEMP\pmb-diff-hash.tmp" -Algorithm SHA256).Hash.ToLower() | Set-Content .claude/.code-review-ok
Remove-Item "$env:TEMP\pmb-diff-hash.tmp" -Force
```

If the Verdict is **Request Changes** or **Needs Discussion**, do not write the marker.

---

Do NOT edit files, generate tests, or apply fixes during this review — writing the `.claude/.code-review-ok` marker per Step 7 is the sole exception. If the user wants remediation after seeing findings, they will ask explicitly.

---

## Usage

```
/code-review                     # reviews current git diff
/code-review src/auth/login.py   # reviews a specific file
/code-review src/api/            # reviews a whole folder
```
