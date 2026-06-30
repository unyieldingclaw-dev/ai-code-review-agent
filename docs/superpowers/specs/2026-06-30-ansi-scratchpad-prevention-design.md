# ANSI Scratchpad Prevention — Design Spec

**Date:** 2026-06-30  
**Status:** Approved

## Problem

PowerShell commands that emit ANSI-colored output (e.g., `Invoke-Pester`, `ollama`, progress bars) can produce files with 17,500+ blank lines when their output is captured to a scratchpad temp file. Those lines enter the conversation context and burn tokens on every subsequent turn until compaction. The prior incident (session ~2026-06-29) consumed significant context budget and caused multi-session thrashing.

**Root cause:** ANSI escape sequences (`\x1B[...m`) written to a UTF-8 file render as blank/garbage lines when read back as plain text. Once the file content is included in a tool result, it is baked into the conversation transcript.

## Goals

1. Prevent ANSI codes from being written to scratchpad files in the first place (advisory layer).
2. Strip ANSI codes automatically after any Bash or PowerShell tool call (enforcement layer).
3. Neither layer should ever block a tool call on failure.

## Non-Goals

- Stripping ANSI from tool output displayed in the terminal (cosmetic, not a context problem).
- Handling files outside Claude Code's scratchpad directories.
- Covering files over 5 MB (pathological case; safety guard prevents stalls).

## Design

### Layer 1 — Guideline (global `~/.claude/CLAUDE.md`)

Add one sentence under a new "Shell Output Safety" heading:

> Before capturing PowerShell output to a file, set `$PSStyle.OutputRendering = 'PlainText'` to prevent ANSI escape codes from writing blank lines into scratchpad files.

This is the prevention layer. It instructs Claude to set plain-text rendering mode proactively before any diagnostic command whose output will be written to a file.

### Layer 2 — Hook Script

**File:** `C:\Users\Mizzo\.claude\scripts\strip-ansi-scratchpad.ps1`

**Trigger:** PostToolUse on `Bash|PowerShell` tool calls (global settings).

**Behavior:**
1. Locate all directories named `scratchpad` under `$env:LOCALAPPDATA\Temp\claude\` (Claude Code's temp root).
2. For each file in those directories under 5 MB:
   - Read as UTF-8 using `[System.IO.File]::ReadAllText`.
   - Check for ANSI escape sequences with pattern `\x1B\[`.
   - If found, replace all ANSI sequences with empty string and write back.
3. All errors are silently swallowed — the script must never fail in a way that blocks the tool call.

**ANSI pattern covered:**

```
\x1B\[[0-9;]*[mGKHFABCDJnRST]   — CSI sequences (color, cursor)
\x1B\][^\x07]*\x07               — OSC sequences (window title etc.)
\x1B[^[\]A-Za-z]*[A-Za-z]        — other single-char escapes
```

### Layer 2 — Hook Registration (global `~/.claude/settings.json`)

Add to the `hooks.PostToolUse` array:

```json
{
  "matcher": "Bash|PowerShell",
  "hooks": [
    {
      "type": "command",
      "command": "pwsh -NonInteractive -File \"C:\\Users\\Mizzo\\.claude\\scripts\\strip-ansi-scratchpad.ps1\" 2>$null; true"
    }
  ]
}
```

The `2>$null; true` ensures the hook always exits 0.

## File Locations

| File | Purpose |
|------|---------|
| `C:\Users\Mizzo\.claude\scripts\strip-ansi-scratchpad.ps1` | Hook script |
| `C:\Users\Mizzo\.claude\settings.json` | Global hook registration |
| `C:\Users\Mizzo\.claude\CLAUDE.md` | Global guideline |

## Verification

After implementation:

1. Write a file to the current session scratchpad containing a known ANSI sequence (e.g., `\x1B[32mGREEN\x1B[0m`).
2. Run a no-op Bash command (`echo test`) to trigger the PostToolUse hook.
3. Read the scratchpad file back and confirm the ANSI sequences are absent and the text content is intact.

## Trade-offs

- **Hook overhead:** Runs after every Bash/PowerShell call. The scratchpad typically has 0–5 small files, so the scan is ~1–5 ms. Acceptable.
- **5 MB guard:** Files over 5 MB are skipped. A 5 MB scratchpad file is almost certainly pathological; skipping it prevents the hook from stalling on large binary captures.
- **Global scope:** The hook and guideline apply to all Claude Code projects, not just ACR. This is intentional — the ANSI problem is not project-specific.
