# Hooks Guide

Hooks run deterministically at Claude Code lifecycle points. Unlike `CLAUDE.md` (which is advisory — Claude can drift), hooks **always execute** and can block or modify Claude's actions.

## Hook Types

| Hook | When it fires | Primary use |
|------|--------------|-------------|
| `PreToolUse` | Before Claude runs a tool | Block dangerous operations, validate inputs |
| `PostToolUse` | After Claude runs a tool | Auto-format, run lint, log actions |
| `Stop` | When Claude pauses for input | Desktop notification |
| `PreCompact` | Before context compaction | Save state summary |

## Enforcement Layer Architecture

Hooks are one layer in a four-layer enforcement stack. Understanding which layer owns which concern prevents duplication and drift:

| Layer | Kind | Owns | Does NOT own |
|-------|------|------|-------------|
| **CLAUDE.md** | Advisory | Behavioral norms, workflow philosophy, code style | Anything requiring guaranteed execution |
| **Hooks** | Deterministic structural | Per-tool-call pattern enforcement: dangerous commands, credential access | Semantic correctness, business logic review |
| **Reviewer / Opponent** | Semantic | Spec compliance, scope drift, code quality | Mechanical pattern matching |
| **CI** | Deterministic gate | Codebase invariants: file size, forbidden imports, secret scanning | Real-time per-command interception |

**Design rule:** Don't duplicate concerns across layers. If a check belongs in CI, adding it to hooks creates two places to update when patterns change. If a check is semantic, adding it to hooks creates false confidence (simple pattern matching misses context). Each layer does its job; the stack as a whole provides defense in depth.

## Default Hooks in This Standard

Configured in `.claude/settings.json`:

### 1. Dangerous-Command Blocker (`PreToolUse` — Bash + PowerShell tools)

Intercepts both Bash and PowerShell tool calls before they run using `scripts/dangerous-commands.ps1`. Enforces 3-tier safety:

**BLOCK** (19 patterns — command exits non-zero, Claude stops):\
*Shell:* `rm -rf` · `mkfs` · `dd if=` · `git push --force` · `git push -f` · `DROP TABLE` · `DROP DATABASE` · `| bash` · `| sh` · `|bash` · `|sh`\
*PowerShell-native:* `Remove-Item -Recurse -Force` · `Remove-Item -Force -Recurse` · `Format-Volume` · `| Invoke-Expression` · `|Invoke-Expression` · `| iex` · `|iex`

**CONFIRM** (7 patterns — surfaces confirmation dialog):
`git filter-branch` · `git update-ref` · `sudo rm` · `chmod -R 777` · `--no-verify` · `TRUNCATE TABLE` · `DELETE FROM`

**WARN** (4 patterns — exits 0, surfaces access alert):
`id_rsa` · `.pem` · `.env.production` · `credentials.json`

If BLOCK is triggered, Claude sees the block message and stops. The command never runs. CONFIRM and WARN surface the access to Claude so it can decide.

Implemented in `scripts/dangerous-commands.ps1` (Windows/pwsh) and `scripts/dangerous-commands.sh` (POSIX/bash). Configured in `.claude/settings.json` with two matchers — one for `Bash` (with sh fallback) and one for `PowerShell` (PS-only):

```json
{ "matcher": "Bash",       "command": "pwsh -NonInteractive -File scripts/dangerous-commands.ps1 2>/dev/null || bash scripts/dangerous-commands.sh 2>/dev/null || true" },
{ "matcher": "PowerShell", "command": "pwsh -NonInteractive -File scripts/dangerous-commands.ps1 2>/dev/null || true" }
```

**Hook error logging (G2):** if `dangerous-commands.ps1` fails unexpectedly, the catch block appends a timestamped entry to `.pmb-hook-errors.log` (gitignored). `mb doctor` Check 16 surfaces entries from this log as WARN.

### 2. Stop Notification (`Stop`) — excluded from install template

The Stop hook is excluded from `templates/.claude/settings.json` because it causes indefinite hangs in `--Remote-Control` mode (Claude in Chrome). In that mode Claude runs headless; the hook fires but no user is present to dismiss the Windows MessageBox, stalling the session permanently. PMB's own `.claude/settings.json` keeps this hook as a deliberate choice for interactive Windows sessions; it is excluded from the install template to prevent those hangs in remote/headless environments. If you need a Stop notification in an interactive-only project, add it to that project's local `.claude/settings.json` manually.

### 3. Contract Scope Check (`PreToolUse` — Write + Edit tools)

Checks whether a file being written is within the scope declared in the active task contract (`.claude/contracts/active-task.json`). Implemented in `scripts/check-contract.ps1` and `scripts/check-contract.sh`.

- **No contract / inactive contract:** exits 0 silently.
- **Out-of-scope write (default):** prints a warning and exits 0. Claude sees it and should pause.
- **Out-of-scope write (hard-block mode):** exits 2 (blocked) when `PMB_CONTRACT_HARD_BLOCK=1` is set in the `env` block of `.claude/settings.json`.

Set `PMB_CONTRACT_HARD_BLOCK=1` for sessions where scope discipline is critical. See `standards/SECURITY-GUARDRAILS.md` for the full env-block example.

**Hook error logging (G2):** unexpected errors are logged to `.pmb-hook-errors.log` via a `trap {}` wrapper.

### 4. Auto-Reviewed Update (`PostToolUse` — Write + Edit tools)

Fires after every `Write` or `Edit` tool call. Reads the edited file path from the tool input JSON (via `$input | Out-String`), checks whether it is inside `memory-bank/`, and updates the `last-reviewed:` frontmatter line to today's date if present.

**Why silent failure?** The hook must never block agent work. If the update fails (e.g. file not found, malformed frontmatter), the agent continues and the user can run `mb audit` to find stale files. Implemented in `scripts/update-reviewed.ps1` and `scripts/update-reviewed.sh`.

**Hook error logging (G2):** unexpected errors are logged to `.pmb-hook-errors.log`.

### 5. PreCompact Memory Gate (`PreCompact`)

Fires before Claude Code compacts context. Runs two content-based quality checks on the memory bank **or** bypasses via `handoff.md`.

**Exit codes:**
- **Exits 0** — both checks pass (or `handoff.md` bypass is present). Compaction proceeds normally.
- **Exits 2** — one or more checks fail. **Compaction is blocked.** Claude Code treats a non-zero exit from a PreCompact hook as a block signal. The hook prints an actionable message explaining what to do.

**To unblock:** address the failing check (see below), then retry. Alternatively, create `handoff.md` to bypass the gate (the handoff file signals that session state has been captured via the Handoff Protocol).

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

## Git Hooks (versioned)

PMB distributes two git hooks through the `.githooks/` directory, which is versioned in the project repo. `mb init` and `mb upgrade` both install these hooks and activate them via `core.hooksPath`.

### How it works

`core.hooksPath = .githooks` is a per-project git local config (stored in `.git/config`, not committed). When set, git resolves all hooks from `.githooks/` instead of `.git/hooks/`. The hook *files* are committed and versioned; the *activation* is a local git config that each `mb init`/`mb upgrade` run sets automatically.

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
  "hooks": [{
    "type": "command",
    "command": "npx prettier --write \"$CLAUDE_TOOL_OUTPUT_PATH\" 2>/dev/null || true"
  }]
}
```

**Black (Python):**
```json
{
  "matcher": "Write|Edit",
  "hooks": [{
    "type": "command",
    "command": "python -m black \"$CLAUDE_TOOL_OUTPUT_PATH\" 2>/dev/null || true"
  }]
}
```

### Lint Before Commit (PreToolUse on Bash)

Add to the `PreToolUse` array (alongside the dangerous-command hook):
```json
{
  "matcher": "Bash",
  "hooks": [{
    "type": "command",
    "command": "HOOK_INPUT=$(cat 2>/dev/null); echo \"$HOOK_INPUT\" | grep -q 'git commit' && npm run lint 2>&1 || true"
  }]
}
```

## How to Add a Hook

1. Edit `.claude/settings.json` in your project root
2. Add the hook JSON to the appropriate lifecycle key
3. Test: run a command Claude would use and verify the hook fires correctly
4. Commit `settings.json` so the hook applies to all sessions in this project

## Reference

Full hook documentation: `claude hooks --help` or see the Claude Code docs.
