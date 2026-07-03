# /change-review

Review the current branch, PR, or diff as a complete change package using 9 parallel review jobs.

## Usage

```
/change-review
/change-review --diff path/to/change.diff
/change-review --base <ref>
/change-review --pr <number>
```

## Step 1: Determine the diff

**Default (no flags):** Run `git diff origin/main...HEAD` (or `git diff HEAD` if no upstream). If that yields nothing, run `git diff --cached`.

**`--diff <path>`:** Load the diff from the specified file.

**`--base <ref>`:** Run `git diff <ref>...HEAD`.

**`--pr <number>`:** Run `gh pr diff <number>` to fetch the PR diff. If `gh` is not installed, report it and fall back to local diff.

If no diff can be obtained, stop and tell the user.

## Step 2: Check for ACR

Run `which ai-review-agent 2>/dev/null` (bash) or `Get-Command ai-review-agent -ErrorAction SilentlyContinue` (PowerShell).

- **Found:** Note it for use in job 7 (security).
- **Not found:** Print exactly:
  > ACR not found in PATH. Skipping local LLM swarm. Continuing with PMB-native review.

## Step 3: Load context (if available)

Look for an active plan at `docs/plans/*.md` with `status: active`. If found, note its path — it informs claim mapping in job 2. Do not load all plans.

## Step 4: Run 9 review jobs

Work through all 9 jobs. For each finding, use this schema:

| Field              | Description                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------------ |
| **Domain**         | Security / Correctness / Performance / Testing / Maintainability / Architecture / Accessibility / Scope / Coverage |
| **Severity**       | Critical / High / Medium / Low / Info                                                                              |
| **Location**       | `file:line` or `file:line–line`                                                                                    |
| **Evidence**       | Specific lines, patterns, or absence of expected code                                                              |
| **Basis**          | `llm` / `heuristic` / `policy` / `semgrep` / `acr`                                                                 |
| **Impact**         | What breaks or degrades if not addressed                                                                           |
| **Recommendation** | Concrete fix — not "consider improving"                                                                            |
| **Blocking**       | Yes / No — should this block merge?                                                                                |
| **Confidence**     | High / Medium / Low                                                                                                |

---

### Job 1 — Scope Sanity

Check: Is the diff size proportionate to the stated change? Are there unrelated files, generated files that should be gitignored, or bulk reformatting mixed with logic changes?

Flag:

- Diff touches files that appear unrelated to the stated purpose
- Generated files (lock files, build artifacts, minified output) committed without explicit reason
- Unexplained large deletions or file renames

---

### Job 2 — Claim Mapping

Read the PR description, commit message, or plan (if loaded). Check:

- Every claim in the description maps to at least one changed file
- Every major changed file maps to at least one claim
- New public API surface has documentation or a comment explaining its contract

Flag when a claim has no corresponding change, or a significant file change has no stated justification.

---

### Job 3 — Seam Integrity

Check architectural boundaries:

- Layer violations (e.g., UI code importing from data layer directly, domain logic in a controller)
- Dependency injection broken (hardcoded singletons, global state introduced)
- API/service/data seam contracts — are inputs validated at the seam, not deep inside?
- Cross-module coupling introduced without abstraction

---

### Job 4 — Runtime Semantics

Check behavior at runtime:

- Changed defaults or env var handling — what is the effect when the env var is absent?
- Async patterns — unhandled promise rejections, missing `await`, incorrect error propagation
- Startup/shutdown ordering affected by the change
- Rollback safety — can this change be reverted without data loss or downtime?
- Race conditions or time-of-check/time-of-use issues

---

### Job 5 — Test Assertion Strength

For each new or modified test:

- Does it assert observable behavior, not just types or truthiness?
- Does it assert the _right_ thing (not a side effect that could pass even if the feature is broken)?
- Snapshot tests — is the snapshot actually meaningful, or is it testing the wrong thing?
- Mocks — are they verifed? Could they pass even if the real implementation regresses?

---

### Job 6 — Claim-to-Test Coverage

Cross-reference job 2 claims against the test changes:

- Every behavioral claim has either a test or an explicit waiver comment (`// not tested: <reason>`)
- New code paths (branches, error handlers, edge cases) have test coverage or a noted gap
- Deleted tests — were they covering something that still needs coverage elsewhere?

---

### Job 7 — Security

**If ACR is available:**

1. Write the diff from Step 1 to a temp file:
   - Bash: `git diff origin/main...HEAD > /tmp/cr-diff.patch` (or replay the Step 1 command that produced the diff)
   - If Step 1 used `--diff <path>`, copy that file to `/tmp/cr-diff.patch`
   - If Step 1 used `gh pr diff <number>`, re-run: `gh pr diff <number> > /tmp/cr-diff.patch`
2. Run `ai-review-agent --profile security --diff /tmp/cr-diff.patch` and incorporate its findings here.
3. Attribute findings as `basis: acr`.

> **Why:** Without `--diff`, ACR defaults to `git diff --cached` (staged changes), which is a different surface than the PR or branch diff computed in Step 1.

**If ACR is not available:** Run the PMB `/security-review` logic inline:

- Hardcoded secrets, credentials, API keys, tokens
- Injection vectors: SQL, shell, path traversal, template injection
- Auth bypass or privilege escalation
- Unsafe deserialization, prototype pollution
- Dependency changes — are new deps audited?
- Secrets in logs, error messages, or stack traces

---

### Job 8 — Accessibility (conditional)

**Skip this job if no UI files are touched** (no `.html`, `.jsx`, `.tsx`, `.vue`, `.svelte`, `.css` in the diff). Note in the coverage footer: `Accessibility: skipped — no UI files`.

**If UI files are present:**

- Interactive elements have accessible labels (aria-label, aria-labelledby, or visible text)
- Color is not the sole conveyor of information
- Focus management correct for new modals, dialogs, or route changes
- Keyboard navigation works for new interactive components
- Images have alt text

---

### Job 9 — Opposition

Play devil's advocate against the entire change:

- What assumptions does this change make that could be wrong?
- What edge cases does it not handle?
- Are there performance implications at scale that the change doesn't address?
- Are any findings from jobs 1–8 overstated — flag false positives explicitly
- Cross-domain risks: a correctness issue that also has security implications, or a test gap that also affects a claim

---

## Step 5: Output the report

```markdown
# Change Review

## Findings

| Domain | Severity | Location | Evidence | Basis | Impact | Recommendation | Blocking | Confidence   |
| ------ | -------- | -------- | -------- | ----- | ------ | -------------- | -------- | ------------ |
| ...    | ...      | ...      | ...      | ...   | ...    | ...            | Yes/No   | High/Med/Low |

_(If no findings: "No findings. Change package looks clean.")_

## Job Summary

| Job                       | Status                              | Notes |
| ------------------------- | ----------------------------------- | ----- |
| 1 Scope Sanity            | ✅ Clean / ⚠️ N findings            | ...   |
| 2 Claim Mapping           | ...                                 | ...   |
| 3 Seam Integrity          | ...                                 | ...   |
| 4 Runtime Semantics       | ...                                 | ...   |
| 5 Test Assertion Strength | ...                                 | ...   |
| 6 Claim-to-Test Coverage  | ...                                 | ...   |
| 7 Security                | ...                                 | ...   |
| 8 Accessibility           | ✅ Clean / ⏭ Skipped — no UI files | ...   |
| 9 Opposition              | ...                                 | ...   |

## Coverage Footer

- **Review target:** local diff | branch (`<name>`) | PR #<number>
- **Base ref:** `<ref>` or unavailable
- **Files changed:** <count>
- **Plan/spec loaded:** none | `<path>`
- **Security review:** reviewed (PMB-native) | reviewed (ACR) | skipped
- **Accessibility:** reviewed | skipped — no UI files
- **ACR backend:** used | not installed | disabled
```

## Step 6: Record Review Completion

If no finding in the report has `Blocking: Yes` (including the "No findings" case), compute a hash of the reviewed diff and write it to `.claude/.change-review-ok` (create the `.claude` directory first if it doesn't exist). The marker is bound to this exact diff — a `PreToolUse` hook recomputes the same hash before the next `git push` and only allows it through if the diff hasn't changed since the review. Use the same diff command from Step 1 (`git diff origin/main...HEAD`, or `git diff HEAD` if no upstream):

Bash:
```
git diff origin/main...HEAD | sha256sum | cut -d' ' -f1 > .claude/.change-review-ok
```

PowerShell (do NOT pipe `git diff` directly into a hash cmdlet — PowerShell's pipeline re-tokenizes external-command output and will not match the hash `review-reminders.ps1` recomputes; redirect to a file first so the hash covers the exact raw bytes):
```
git diff origin/main...HEAD > "$env:TEMP\pmb-diff-hash.tmp"
(Get-FileHash "$env:TEMP\pmb-diff-hash.tmp" -Algorithm SHA256).Hash.ToLower() | Set-Content .claude/.change-review-ok
Remove-Item "$env:TEMP\pmb-diff-hash.tmp" -Force
```

If any finding has `Blocking: Yes`, do not write the marker.

## Final instruction

Stop after displaying the report. Do NOT edit files, push commits, or post PR comments unless the user explicitly asks — writing the `.claude/.change-review-ok` marker per Step 6 is the sole exception.
