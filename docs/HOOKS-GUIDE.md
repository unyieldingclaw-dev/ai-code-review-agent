# Hooks Guide

Hooks run deterministically at Claude Code lifecycle points. Unlike `CLAUDE.md` (which is advisory — Claude can drift), hooks **always execute** and can block or modify Claude's actions.

## Hook Types

| Hook          | When it fires                | Primary use                                 |
| ------------- | ---------------------------- | ------------------------------------------- |
| `PreToolUse`  | Before Claude runs a tool    | Block dangerous operations, validate inputs |
| `PostToolUse` | After Claude runs a tool     | Auto-format, run lint, log actions          |
| `Stop`        | When Claude pauses for input | Desktop notification                        |
| `PreCompact`  | Before context compaction    | Save state summary                          |

## Enforcement Layer Architecture

Hooks are one layer in a four-layer enforcement stack. Understanding which layer owns which concern prevents duplication and drift:

| Layer                   | Kind                     | Owns                                                                     | Does NOT own                                |
| ----------------------- | ------------------------ | ------------------------------------------------------------------------ | ------------------------------------------- |
| **CLAUDE.md**           | Advisory                 | Behavioral norms, workflow philosophy, code style                        | Anything requiring guaranteed execution     |
| **Hooks**               | Deterministic structural | Per-tool-call pattern enforcement: dangerous commands, credential access | Semantic correctness, business logic review |
| **Reviewer / Opponent** | Semantic                 | Spec compliance, scope drift, code quality                               | Mechanical pattern matching                 |
| **CI**                  | Deterministic gate       | Codebase invariants: file size, forbidden imports, secret scanning       | Real-time per-command interception          |

**Design rule:** Don't duplicate concerns across layers. If a check belongs in CI, adding it to hooks creates two places to update when patterns change. If a check is semantic, adding it to hooks creates false confidence (simple pattern matching misses context). Each layer does its job; the stack as a whole provides defense in depth.

## Default Hooks in This Standard

Configured in `.claude/settings.json`:

### 1. Dangerous-Command Blocker (`PreToolUse` — Bash + PowerShell tools)

Intercepts both Bash and PowerShell tool calls before they run using `scripts/dangerous-commands.ps1`. Enforces 3-tier safety:

**BLOCK** (16 patterns — denies the tool call, command never runs):\
_Shell:_ `rm -rf` · `mkfs` · `dd if=` · `git push --force` · `git push -f` · `DROP TABLE` · `DROP DATABASE` · `| bash` · `| sh` · `|bash` · `|sh`\
_PowerShell-native:_ `Remove-Item -Recurse -Force` · `Remove-Item -Force -Recurse` · `Format-Volume` · `| Invoke-Expression` · `|Invoke-Expression` · `| iex` · `|iex`

**CONFIRM** (7 patterns — surfaces confirmation dialog):
`git filter-branch` · `git update-ref` · `sudo rm` · `chmod -R 777` · `--no-verify` · `TRUNCATE TABLE` · `DELETE FROM` (only when no `WHERE` clause is present — a scoped, WHERE-qualified delete is not flagged)

**WARN** (4 patterns — exits 0, surfaces access alert):
`id_rsa` · `.pem` · `.env.production` · `credentials.json`

**WHY `hookSpecificOutput.permissionDecision`, not exit code:** top-level exit codes are unreliable here — `.claude/settings.json` wires this hook as `"... 2>/dev/null || bash ... 2>/dev/null || true"` for cross-platform fail-open portability, and that trailing `|| true` silently converts any nonzero exit code to 0. An earlier version of this hook used `exit 1` to signal BLOCK and never actually prevented the tool call from running — the command still executed. `Deny` instead writes `{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": "..."}}` to stdout, which Claude Code reads regardless of the wrapping shell's final exit code. CONFIRM and WARN print advisory text and exit 0 — they surface the access to Claude so it can decide, they don't deny.

**WHY the `| sh` / `| bash` patterns use regex with `\b`, not a plain substring:** a bare substring check for `"| sh"` false-positives on any command containing `"| sha256sum"` or `"| shasum"` — the hash tools the review-before-commit gate (section 7) depends on. `\|\s*sh\b` requires `sh` to end at a word boundary, so `sha256sum` (immediately followed by `a`, no boundary) doesn't match, but a literal pipe to the `sh` interpreter does.

Implemented in `scripts/dangerous-commands.ps1` (Windows/pwsh) and `scripts/dangerous-commands.sh` (POSIX/bash). Both read the command from the nested `tool_input.command` field of the hook's stdin JSON payload (`{"tool_name":"Bash","tool_input":{"command":"..."}}`) — not a flat `.command` field, which the real payload never populates. Configured in `.claude/settings.json` with two matchers — one for `Bash` (with sh fallback, shared with the review-gate hook from section 7) and one for `PowerShell` (PS-only):

```json
{ "matcher": "Bash",       "hooks": [
    { "command": "pwsh -NonInteractive -File scripts/dangerous-commands.ps1 2>/dev/null || bash scripts/dangerous-commands.sh 2>/dev/null || true" },
    { "command": "pwsh -NonInteractive -File scripts/review-reminders.ps1 2>/dev/null || bash scripts/review-reminders.sh 2>/dev/null || true" }
] },
{ "matcher": "PowerShell", "hooks": [
    { "command": "pwsh -NonInteractive -File scripts/dangerous-commands.ps1 2>/dev/null || true" }
] }
```

Both hooks registered under the same matcher run on every matching tool call, even if an earlier one already denies — a denied `dangerous-commands` match does not prevent `review-reminders` from also running (and, e.g., consuming a review marker) on the same call.

**Hook error logging (G2):** if `dangerous-commands.ps1` fails unexpectedly, the catch block appends a timestamped entry to `.pmb-hook-errors.log` (gitignored). `mb doctor` Check 16 surfaces entries from this log as WARN.

### 2. Stop Notification (`Stop`) — excluded from install template

The Stop hook is excluded from `templates/.claude/settings.json` because it causes indefinite hangs in `--Remote-Control` mode (Claude in Chrome). In that mode Claude runs headless; the hook fires but no user is present to dismiss the Windows MessageBox, stalling the session permanently. PMB's own `.claude/settings.json` keeps this hook as a deliberate choice for interactive Windows sessions; it is excluded from the install template to prevent those hangs in remote/headless environments. If you need a Stop notification in an interactive-only project, add it to that project's local `.claude/settings.json` manually.

### 3. Contract Scope Check (`PreToolUse` — Write + Edit tools)

Checks whether a file being written is within the scope declared in the active task contract (`.claude/contracts/active-task.json`). Implemented in `scripts/check-contract.ps1` and `scripts/check-contract.sh`.

- **No contract / inactive contract:** exits 0 silently.
- **Out-of-scope write (default):** prints a warning and exits 0. Claude sees it and should pause.
- **Out-of-scope write (hard-block mode):** denies the tool call via `hookSpecificOutput.permissionDecision: "deny"` when `PMB_CONTRACT_HARD_BLOCK=1` is set in the `env` block of `.claude/settings.json`.

Set `PMB_CONTRACT_HARD_BLOCK=1` for sessions where scope discipline is critical, in the `env` block of `.claude/settings.json`:

```json
{
  "env": {
    "PMB_CONTRACT_HARD_BLOCK": "1"
  }
}
```

**Field paths and schema:** the hook reads the target file from the nested `tool_input.file_path` field of the hook's stdin JSON (`{"tool_name":"Edit","tool_input":{"file_path":"..."}}`), not a flat `.file_path` — the real payload never populates the flat field. Scope is read as the `scope: [{file, op}]` array documented in `docs/CONTRACTS-GUIDE.md` (each entry's `.file` property), not a `scope.files` list.

**Hook error logging (G2):** unexpected errors are logged to `.pmb-hook-errors.log` via a `trap {}` wrapper.

### 4. Auto-Reviewed Update (`PostToolUse` — Write + Edit tools)

Fires after every `Write` or `Edit` tool call. Reads the edited file path from the tool input JSON (via `$input | Out-String`), checks whether it is inside `memory-bank/`, and updates the `last-reviewed:` frontmatter line to today's date if present.

**Why silent failure?** The hook must never block agent work. If the update fails (e.g. file not found, malformed frontmatter), the agent continues and the user can run `mb audit` to find stale files. Implemented in `scripts/update-reviewed.ps1` and `scripts/update-reviewed.sh`.

**Hook error logging (G2):** unexpected errors are logged to `.pmb-hook-errors.log`.

### 5. PreCompact Memory Gate (`PreCompact`)

Fires before Claude Code compacts context. Runs two content-based quality checks on the memory bank **or** bypasses via `handoff.md`.

**Exit codes:**

- **Exits 0** — both checks pass (or `handoff.md` bypass is present). Compaction proceeds normally.
- **Warns** — the hook prints a message describing the missing/stale content but compaction proceeds. The `|| true` fail-open in the settings.json command ensures the hook never blocks compaction, even when checks fail.

**To address a warning:** fix the failing check (see below), then retry the compact. Alternatively, create `handoff.md` to bypass the gate (the handoff file signals that session state has been captured via the Handoff Protocol).

**Detection logic (content-based, not mtime):**

- **Check 1 — `activeContext.md` substantive content:** counts non-frontmatter, non-heading, non-empty lines with ≥20 characters. Requires ≥3 such lines. A file that was only touched (e.g. `last-reviewed` timestamp updated) fails this check.
- **Check 2 — `progress.md` dated entry:** looks for at least one line starting with today's date (or a markdown heading/list prefix followed by today's date). The date must appear at the start of a line — embedded dates in prose do not count.
- **Bypass:** `handoff.md` present in the project root skips both checks.

**Fails open:** unexpected errors (missing runtimes, unreadable files) exit 0 silently and log to `.pmb-hook-errors.log`.

Implemented in `scripts/pre-compact-check.ps1` (Windows/pwsh) and `scripts/pre-compact-check.sh` (POSIX/sh):

```json
"PreCompact": [
  {
    "hooks": [
      {
        "type": "command",
        "command": "pwsh -NonInteractive -File scripts/pre-compact-check.ps1 2>/dev/null || bash scripts/pre-compact-check.sh 2>/dev/null || true"
      }
    ]
  }
]
```

Note: `PreCompact` hooks have no `matcher` field — the hook type applies to the compaction event itself, not to a specific tool.

### 6. Agent Delegation Depth Check (`PreToolUse` — Agent tool)

Fires before every `Agent` tool call. Tracks nested agent delegation depth and emits a WARN when depth exceeds the budget defined in `standards/PERFORMANCE-BUDGET.md` (default: ≤1 subagent deep). Implemented in `scripts/delegation-depth-check.ps1` and `scripts/delegation-depth-check.sh`.

**Runtime state file:** The hook stores its counter in `.pmb-delegation-depth` in the project root (gitignored). This file is created automatically on the first agent dispatch and resets after 2 hours of inactivity. Delete it manually to reset the depth counter mid-session without restarting.

**Hook error logging:** Unexpected errors are logged to `.pmb-hook-errors.log`.

### 7. Review-Before-Commit/Push Gate (`PreToolUse` — Bash)

Mechanically enforces that `/code-review` or `/change-review` ran on the exact diff being committed or pushed — a hook cannot verify a human read a report, but it can verify a matching diff-hash marker exists. Implemented in `scripts/review-reminders.ps1` and `scripts/review-reminders.sh`, registered under the same `Bash` matcher as the dangerous-command blocker (section 1).

**How the marker works:**

1. `/code-review` (Step 7) and `/change-review` (Step 6) each compute a SHA-256 hash of the reviewed diff and write it to `.claude/.code-review-ok` or `.claude/.change-review-ok` respectively — but only if no finding in the report is `Blocking: Yes`.
2. When Claude runs a `git commit` or `git push` command, this hook matches the command against `git\s+commit\b` / `git\s+push\b`, recomputes the hash of the diff that would actually be committed/pushed, and compares it to the marker's contents.
3. **Match:** the marker is consumed atomically via `Move-Item -Force` / `mv` (rename, not check-then-delete) so a second command racing against the first can't also claim it, then the command is allowed through.
4. **No marker, or hash mismatch (diff changed since review):** denies via `hookSpecificOutput.permissionDecision: "deny"`, instructing Claude to run `/code-review` or `/change-review` first.

**WHY a hash of the diff, not an empty marker file:** an empty marker is trivially fakeable with `touch .claude/.code-review-ok`, which defeats the control's purpose (Claude — or a user — could authorize a commit without actually reviewing it). Binding the marker to a hash of the specific diff means a stale or fabricated marker never matches the diff actually being committed.

**WHY hash a file written via redirection, not a piped command:** PowerShell's pipeline re-tokenizes external-command output when it flows through `|`, so `git diff | <hash cmdlet>` does not reproduce the same byte stream a POSIX shell pipe produces — a marker written by piping in PowerShell would never match this hook's hash. Both the hook and the documented `/code-review`/`/change-review` commands instead redirect the diff to a temp file (`git diff HEAD > $tmp`) and hash the file, which is confirmed byte-identical to a bash `sha256sum` pipe.

**Anti-fabrication note:** writing either marker file directly (without genuinely running the review) defeats the point of this control. Claude Code's own permission classifier treats a direct write to these marker paths as suspicious and requires explicit, per-instance user approval — it does not survive being chained into the same tool call as the gated commit/push.

### 8. Review Marker Reissue on Failure (`PostToolUse` — Bash)

Companion to section 7. If a gated `git commit`/`git push` is allowed through (marker consumed) but then fails for an unrelated reason — a pre-commit hook rejects it, a merge conflict blocks the push, network failure — the marker is gone and Claude would otherwise have to re-run the full review for no diff change. Implemented in `scripts/review-reminders-post.ps1` and `scripts/review-reminders-post.sh`.

**How it detects failure:** rather than parsing the tool's response payload (whose schema isn't guaranteed stable), it compares git ref state before and after. When section 7's hook consumes a marker, it records the pre-command ref (`git rev-parse HEAD` for commit, `git rev-parse @{u}` for push) to `.claude/.pending-commit-presha` / `.claude/.pending-push-presha`. This `PostToolUse` hook reads that file, checks the ref again, and:

- **Ref changed:** the command succeeded — deletes the presha file, no action needed.
- **Ref unchanged:** the command failed — recomputes the diff hash (same file-redirect method as section 7) and rewrites the marker, so the next attempt doesn't need a fresh review.

## Git Hooks (versioned)

PMB distributes two git hooks through the `.githooks/` directory, which is versioned in the project repo. `mb init` and `mb upgrade` both install these hooks and activate them via `core.hooksPath`.

### How it works

`core.hooksPath = .githooks` is a per-project git local config (stored in `.git/config`, not committed). When set, git resolves all hooks from `.githooks/` instead of `.git/hooks/`. The hook _files_ are committed and versioned; the _activation_ is a local git config that each `mb init`/`mb upgrade` run sets automatically.

`mb upgrade` treats `.githooks/pre-push` and `.githooks/pre-commit` as `TEMPLATE_OWNED` — it overwrites them unconditionally if they differ from the template, so hook logic stays current across PMB version bumps.

### The two hooks

**`.githooks/pre-push`** — delegates to the 7-check push gate:

- Unresolved merge conflicts or conflict markers
- Uncommitted working tree changes
- Missing `.gitattributes`
- Possible secrets in the push diff (AWS keys, API tokens, GitHub PATs)
- Files over 500 KB
- `mb validate` result (if `mb` is in PATH)
- Scans first pushes via `git log --not --remotes` when no upstream tracking ref exists

Dispatches to `scripts/pre-push-check.ps1` (Windows/pwsh) or `scripts/pre-push-check.sh` (POSIX/bash). Fails open — if the script errors unexpectedly, the push is allowed through.

**`.githooks/pre-commit`** — lightweight two-check gate before every commit:

- **Blocks** if `handoff.md` is staged (`handoff.md` is ephemeral and must not be committed)
- **Warns** if `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` is missing from `.claude/settings.json` (token budget auto-compaction may not be configured)

### Migration from `.git/hooks/`

Projects initialized before PMB 1.1.0 have the old PMB shim at `.git/hooks/pre-push`. Running `mb upgrade` on those projects:

1. Installs `.githooks/pre-push` and `.githooks/pre-commit` (TEMPLATE_OWNED)
2. Sets `core.hooksPath = .githooks` (git local config)
3. Removes `.git/hooks/pre-push` if it matches the PMB shim (detected by grepping for `pre-push-check`)

Custom hooks at `.git/hooks/` are unaffected — the migration only removes the PMB-managed shim.

### Verifying hook activation

```bash
git config core.hooksPath       # should print: .githooks
ls .githooks/                   # should show: pre-push  pre-commit
mb doctor                       # check 4 reports [OK] for both
```

## Adding Per-Project Hooks

Copy `.claude/settings.json` into your project, then add hooks as needed.

### Auto-Format After Edit (PostToolUse)

Add to the `PostToolUse` array in `settings.json`:

**Prettier (JavaScript/TypeScript):**

```json
{
  "matcher": "Write|Edit",
  "hooks": [
    {
      "type": "command",
      "command": "npx prettier --write \"$CLAUDE_TOOL_OUTPUT_PATH\" 2>/dev/null || true"
    }
  ]
}
```

**Black (Python):**

```json
{
  "matcher": "Write|Edit",
  "hooks": [
    {
      "type": "command",
      "command": "python -m black \"$CLAUDE_TOOL_OUTPUT_PATH\" 2>/dev/null || true"
    }
  ]
}
```

### Lint Before Commit (PreToolUse on Bash)

Add to the `PreToolUse` array (alongside the dangerous-command hook):

```json
{
  "matcher": "Bash",
  "hooks": [
    {
      "type": "command",
      "command": "HOOK_INPUT=$(cat 2>/dev/null); echo \"$HOOK_INPUT\" | grep -q 'git commit' && npm run lint 2>&1 || true"
    }
  ]
}
```

## How to Add a Hook

1. Edit `.claude/settings.json` in your project root
2. Add the hook JSON to the appropriate lifecycle key
3. Test: run a command Claude would use and verify the hook fires correctly
4. Commit `settings.json` so the hook applies to all sessions in this project

## Reference

Full hook documentation: `claude hooks --help` or see the Claude Code docs.
