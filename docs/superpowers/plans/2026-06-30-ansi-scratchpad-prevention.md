# ANSI Scratchpad Prevention — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent ANSI escape codes in PowerShell output from writing thousands of blank lines into Claude Code scratchpad files and burning context tokens.

**Architecture:** Two layers — a one-line guideline in global CLAUDE.md tells Claude to set `$PSStyle.OutputRendering = 'PlainText'` before capturing output (prevention), and a PostToolUse hook script scans all scratchpad directories after every Bash/PowerShell tool call and strips any ANSI sequences found (enforcement). The hook is registered in global `~/.claude/settings.json` so it applies to every Claude Code project.

**Tech Stack:** PowerShell 7, Claude Code hooks (PostToolUse), JSON config.

---

## File Map

| Action | File                                                       | Responsibility                                            |
| ------ | ---------------------------------------------------------- | --------------------------------------------------------- |
| Create | `C:\Users\Mizzo\.claude\scripts\strip-ansi-scratchpad.ps1` | Hook script — scans scratchpad dirs, strips ANSI in-place |
| Modify | `C:\Users\Mizzo\.claude\settings.json`                     | Global hook registration — adds PostToolUse entry         |
| Modify | `C:\Users\Mizzo\.claude\CLAUDE.md`                         | Global guideline — Shell Output Safety section            |

---

### Task 1: Create the hook script

**Files:**

- Create: `C:\Users\Mizzo\.claude\scripts\strip-ansi-scratchpad.ps1`

- [ ] **Step 1: Ensure the scripts directory exists**

```powershell
cd "C:\Users\Mizzo\.claude"
New-Item -ItemType Directory -Force -Path scripts
```

Expected: directory created or already exists, no error.

- [ ] **Step 2: Write the hook script**

Create `C:\Users\Mizzo\.claude\scripts\strip-ansi-scratchpad.ps1` with this exact content:

```powershell
# WHY: PowerShell commands that emit ANSI-colored output can produce files with
# thousands of blank lines when captured to a scratchpad file. Those lines enter
# the conversation context and burn tokens on every subsequent turn.
param()

$ErrorActionPreference = 'SilentlyContinue'

$tempBase = Join-Path $env:LOCALAPPDATA 'Temp\claude'
if (-not (Test-Path $tempBase)) { exit 0 }

$ansiPattern = [regex]'(\x1B\[[0-9;]*[mGKHFABCDJnRST]|\x1B\][^\x07]*\x07|\x1B[^[\]A-Za-z]*[A-Za-z])'
$maxBytes    = 5MB

Get-ChildItem $tempBase -Recurse -Directory -Filter 'scratchpad' |
    ForEach-Object {
        Get-ChildItem $_.FullName -File |
            Where-Object { $_.Length -lt $maxBytes } |
            ForEach-Object {
                try {
                    $raw   = [System.IO.File]::ReadAllText($_.FullName)
                    if ($raw -match '\x1B\[') {
                        $clean = $ansiPattern.Replace($raw, '')
                        [System.IO.File]::WriteAllText($_.FullName, $clean)
                    }
                } catch { }
            }
    }
```

- [ ] **Step 3: Verify the script runs without errors**

```powershell
cd "C:\Users\Mizzo\.claude"
pwsh -NonInteractive -File scripts\strip-ansi-scratchpad.ps1
echo "Exit: $LASTEXITCODE"
```

Expected: no output, exit 0. (Scratchpad may be empty — that's fine.)

---

### Task 2: Register the hook in global settings.json

**Files:**

- Modify: `C:\Users\Mizzo\.claude\settings.json`

- [ ] **Step 1: Read the current settings.json**

Open `C:\Users\Mizzo\.claude\settings.json`. Current content (as of 2026-06-30):

```json
{
  "env": {
    "CLAUDE_AUTOCOMPACT_PCT_OVERRIDE": "50"
  },
  "statusLine": { ... },
  "enabledPlugins": { ... },
  "extraKnownMarketplaces": { ... },
  "autoUpdatesChannel": "latest",
  "theme": "dark-daltonized",
  "agentPushNotifEnabled": true
}
```

- [ ] **Step 2: Add the hooks section**

Add a `"hooks"` key at the top level. The full updated file should be:

```json
{
  "env": {
    "CLAUDE_AUTOCOMPACT_PCT_OVERRIDE": "50"
  },
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Bash|PowerShell",
        "hooks": [
          {
            "type": "command",
            "command": "pwsh -NonInteractive -File \"C:\\Users\\Mizzo\\.claude\\scripts\\strip-ansi-scratchpad.ps1\" 2>$null; true"
          }
        ]
      }
    ]
  },
  "statusLine": {
    "type": "command",
    "command": "npx -y ccstatusline@latest",
    "padding": 0,
    "refreshInterval": 10
  },
  "enabledPlugins": {
    "superpowers@claude-plugins-official": true,
    "context7@claude-plugins-official": true,
    "frontend-design@claude-plugins-official": true
  },
  "extraKnownMarketplaces": {
    "claude-plugins-official": {
      "source": {
        "source": "git",
        "url": "https://github.com/anthropics/claude-plugins-official.git"
      }
    }
  },
  "autoUpdatesChannel": "latest",
  "theme": "dark-daltonized",
  "agentPushNotifEnabled": true
}
```

- [ ] **Step 3: Validate JSON is well-formed**

```powershell
cd "C:\Users\Mizzo\.claude"
Get-Content settings.json | ConvertFrom-Json | Out-Null
echo "JSON valid: $?"
```

Expected: `JSON valid: True`, no parse errors.

---

### Task 3: Add guideline to global CLAUDE.md

**Files:**

- Modify: `C:\Users\Mizzo\.claude\CLAUDE.md`

- [ ] **Step 1: Add Shell Output Safety section**

Insert the following section after the `## Shell Command Style` section and before `## Karpathy Coding Principles`:

````markdown
## Shell Output Safety

Before capturing PowerShell output to a file, set `$PSStyle.OutputRendering = 'PlainText'` to prevent ANSI escape codes from writing blank lines into scratchpad files and burning context tokens.

Example:

```powershell
$PSStyle.OutputRendering = 'PlainText'
some-command-with-colored-output | Out-File $scratchFile
```
````

````

- [ ] **Step 2: Verify the file looks right**

Read `C:\Users\Mizzo\.claude\CLAUDE.md` and confirm the new section appears between `## Shell Command Style` and `## Karpathy Coding Principles`, with correct markdown formatting.

---

### Task 4: End-to-end verification

**Files:** none (manual verification only)

- [ ] **Step 1: Write an ANSI-polluted file to the current scratchpad**

```powershell
$scratchpad = "C:\Users\Mizzo\AppData\Local\Temp\claude"
$dirs = Get-ChildItem $scratchpad -Recurse -Directory -Filter 'scratchpad' -ErrorAction SilentlyContinue
if ($dirs) {
    $testFile = Join-Path $dirs[0].FullName 'ansi-test.txt'
    [System.IO.File]::WriteAllText($testFile, "`e[32mGREEN TEXT`e[0m`nNormal line`n")
    Write-Host "Wrote test file: $testFile"
    Get-Content $testFile | ForEach-Object { "  [$_]" }
} else {
    Write-Host "No scratchpad dir found — hook will run but find nothing. That's OK."
}
````

Expected: file written containing the raw ANSI bytes, content shows escape codes.

- [ ] **Step 2: Trigger the hook by running a no-op Bash command**

Ask Claude to run `echo hook-test` in a Bash tool call. The PostToolUse hook will fire automatically after the tool result.

- [ ] **Step 3: Verify the file was cleaned**

```powershell
$scratchpad = "C:\Users\Mizzo\AppData\Local\Temp\claude"
$dirs = Get-ChildItem $scratchpad -Recurse -Directory -Filter 'scratchpad' -ErrorAction SilentlyContinue
if ($dirs) {
    $testFile = Join-Path $dirs[0].FullName 'ansi-test.txt'
    $content = [System.IO.File]::ReadAllText($testFile)
    if ($content -match '\x1B\[') {
        Write-Host "FAIL: ANSI sequences still present" -ForegroundColor Red
    } else {
        Write-Host "PASS: ANSI sequences stripped. Content:" -ForegroundColor Green
        Write-Host $content
    }
}
```

Expected output:

```
PASS: ANSI sequences stripped. Content:
GREEN TEXT
Normal line
```

- [ ] **Step 4: Clean up test file**

```powershell
$scratchpad = "C:\Users\Mizzo\AppData\Local\Temp\claude"
$dirs = Get-ChildItem $scratchpad -Recurse -Directory -Filter 'scratchpad' -ErrorAction SilentlyContinue
if ($dirs) {
    Remove-Item (Join-Path $dirs[0].FullName 'ansi-test.txt') -ErrorAction SilentlyContinue
    Write-Host "Test file removed."
}
```

---

## Self-Review Checklist

- [x] **Spec coverage:** Layer 1 (CLAUDE.md guideline) → Task 3. Layer 2 hook script → Task 1. Hook registration → Task 2. Verification → Task 4.
- [x] **No placeholders:** All steps contain exact file content, commands, and expected output.
- [x] **Type consistency:** No shared types across tasks — this is config + scripting only.
- [x] **File paths:** All absolute paths match spec exactly.
- [x] **Error suppression:** Hook command ends with `2>$null; true` — can never block tool calls.
