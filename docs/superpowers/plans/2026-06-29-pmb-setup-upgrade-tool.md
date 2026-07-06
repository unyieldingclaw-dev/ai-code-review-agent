# PMB Setup/Upgrade Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `mb setup` to the existing `mb.ps1` CLI and replace `mb-new-project.bat` with a renamed `mb-setup.bat` that handles both INIT (new projects) and UPGRADE (existing projects with outdated PMB) from a single double-click.

**Architecture:** `mb-setup.bat` calls `mb setup [optional-path]`. `Invoke-Setup` in `mb.ps1` picks the target folder, detects INIT vs UPGRADE mode, shows a preview before any changes (UPGRADE only), executes using the existing `Invoke-Init` / `Invoke-Upgrade` functions, then verifies and prints a summary. No new files needed — everything builds on existing infrastructure.

**Tech Stack:** PowerShell 5+, Pester 5 (testing), existing `scripts/pick-folder.ps1` (GUI folder picker), existing `Invoke-Init` / `Invoke-Upgrade` in `mb.ps1`, `templates/memory-bank/` as the source of truth for required files.

> **Note:** All paths are relative to the **PMB repo root** (`C:\Users\Mizzo\Claude\Personal-Memory-Bank`). Run commands from that directory.

---

## File Map

| Action          | Path                                  | Change                                                                              |
| --------------- | ------------------------------------- | ----------------------------------------------------------------------------------- |
| Rename + modify | `mb-new-project.bat` → `mb-setup.bat` | Rename; call `mb setup %*` instead of pick-folder + `mb init`                       |
| Modify          | `scripts/mb.ps1`                      | Add `"setup"` to ValidateSet; add `Invoke-Setup` function; wire switch; update help |
| Create          | `tests/mb-setup.Tests.ps1`            | Pester tests for new `Invoke-Setup` function                                        |

No new template files, no schema file — `templates/memory-bank/` is already the source of truth and is iterated dynamically.

---

## Task 1: Rename mb-new-project.bat → mb-setup.bat

**Files:**

- Delete: `mb-new-project.bat`
- Create: `mb-setup.bat`

- [ ] **Step 1: Create mb-setup.bat**

```bat
@echo off
powershell.exe -ExecutionPolicy Bypass -File "%MB_HOME%\scripts\mb.ps1" setup %*
```

The `%*` passthrough means dragging a folder onto the bat passes it as `$Arg` to `Invoke-Setup`, enabling the drag-and-drop nice-to-have from the spec.

- [ ] **Step 2: Delete mb-new-project.bat**

```powershell
Remove-Item "mb-new-project.bat"
```

- [ ] **Step 3: Verify bat launches without error**

Double-click `mb-setup.bat`. Expected: PowerShell opens, fails with "setup is not a valid value for Command" (because we haven't added it yet). That confirms the bat wires through correctly.

- [ ] **Step 4: Commit**

```powershell
git add mb-setup.bat
git rm mb-new-project.bat
git commit -m "feat: rename mb-new-project.bat to mb-setup.bat"
```

---

## Task 2: Wire `mb setup` into mb.ps1

**Files:**

- Modify: `scripts/mb.ps1` — ValidateSet, switch, Show-Help

- [ ] **Step 1: Add "setup" to ValidateSet**

In `mb.ps1` at the `param(` block (around line 22), find:

```powershell
[ValidateSet("init", "install-hooks", "validate", "doctor", "status", "audit", "query", "compact", "update", "archive", "slim", "commit", "upgrade", "budget", "clean", "verify-integrity", "plan", "preflight", "change-check", "help")]
```

Replace with:

```powershell
[ValidateSet("init", "install-hooks", "validate", "doctor", "status", "audit", "query", "compact", "update", "archive", "slim", "commit", "upgrade", "budget", "clean", "verify-integrity", "plan", "preflight", "change-check", "setup", "help")]
```

- [ ] **Step 2: Add setup entry to the switch block**

In the `switch ($Command)` block (around line 2192), after `"upgrade" { Invoke-Upgrade }`, add:

```powershell
"setup"            { Invoke-Setup }
```

- [ ] **Step 3: Add setup to Show-Help**

In `Show-Help`, add after the `upgrade` line:

```powershell
Write-Host "  setup         Initialize or upgrade a project — folder picker, auto-detects mode"
```

- [ ] **Step 4: Run mb help to verify**

```powershell
cd "C:\Users\Mizzo\Claude\Personal-Memory-Bank"
pwsh -File scripts/mb.ps1 help
```

Expected: "setup" appears in the command list.

- [ ] **Step 5: Commit**

```powershell
git add scripts/mb.ps1
git commit -m "feat: wire mb setup command into mb.ps1 CLI"
```

---

## Task 3: Implement Invoke-Setup

**Files:**

- Modify: `scripts/mb.ps1` — add `Invoke-Setup` function before the `switch` block
- Create: `tests/mb-setup.Tests.ps1`

- [ ] **Step 1: Write failing tests**

Create `tests/mb-setup.Tests.ps1`:

```powershell
#Requires -Modules Pester

BeforeAll {
    $RepoRoot = Split-Path $PSScriptRoot -Parent

    # Helper: create a bare project directory
    function New-TestProject {
        param([string]$Base, [string]$Name)
        $path = Join-Path $Base $Name
        New-Item -ItemType Directory -Path $path -Force | Out-Null
        return $path
    }

    # Helper: create a project that already has memory-bank/ with some files
    function New-PartialMbProject {
        param([string]$Base, [string]$Name)
        $path = New-TestProject -Base $Base -Name $Name
        $mb   = Join-Path $path 'memory-bank'
        New-Item -ItemType Directory -Path $mb -Force | Out-Null
        Set-Content (Join-Path $mb 'projectbrief.md') "---`nauthority: immutable`nlast-reviewed: 2026-01-01`n---`n# Project Brief`nContent here.`nMore content.`nLine three.`nLine four."
        # systemPatterns, techContext, activeContext, progress intentionally missing
        return $path
    }
}

Describe "Get-MbMode" {
    BeforeAll {
        . (Join-Path $RepoRoot 'scripts/mb.ps1') -Command help 2>$null
    }

    It "returns 'init' when no memory-bank directory exists" {
        $p = New-TestProject -Base $TestDrive -Name 'mode-init'
        Get-MbMode -ProjectPath $p | Should -Be 'init'
    }

    It "returns 'upgrade' when memory-bank directory exists" {
        $p = New-TestProject -Base $TestDrive -Name 'mode-upgrade'
        New-Item -ItemType Directory -Path (Join-Path $p 'memory-bank') | Out-Null
        Get-MbMode -ProjectPath $p | Should -Be 'upgrade'
    }
}

Describe "Get-MbUpgradeAnalysis" {
    BeforeAll {
        . (Join-Path $RepoRoot 'scripts/mb.ps1') -Command help 2>$null
        $RepoRoot2 = $RepoRoot
        $TestProject = New-PartialMbProject -Base $TestDrive -Name 'analysis-test'
    }

    It "reports missing memory-bank files" {
        $analysis = Get-MbUpgradeAnalysis -ProjectPath $TestProject -TemplatesDir (Join-Path $RepoRoot2 'templates')
        $analysis.Missing | Should -Contain 'systemPatterns.md'
        $analysis.Missing | Should -Contain 'techContext.md'
        $analysis.Missing | Should -Contain 'activeContext.md'
        $analysis.Missing | Should -Contain 'progress.md'
    }

    It "reports present memory-bank files" {
        $analysis = Get-MbUpgradeAnalysis -ProjectPath $TestProject -TemplatesDir (Join-Path $RepoRoot2 'templates')
        $analysis.Present | Should -Contain 'projectbrief.md'
    }
}

Describe "Invoke-MbVerify" {
    BeforeAll {
        . (Join-Path $RepoRoot 'scripts/mb.ps1') -Command help 2>$null
        $RepoRoot2 = $RepoRoot

        # Healthy: copy all templates
        $HealthyProject = New-TestProject -Base $TestDrive -Name 'verify-healthy'
        $mbDst = Join-Path $HealthyProject 'memory-bank'
        New-Item -ItemType Directory -Path $mbDst | Out-Null
        Get-ChildItem (Join-Path $RepoRoot2 'templates/memory-bank') -File | ForEach-Object {
            Copy-Item $_.FullName (Join-Path $mbDst $_.Name)
        }
        # Replace YYYY-MM-DD stubs with real dates so doctor checks pass
        Get-ChildItem $mbDst -File | ForEach-Object {
            (Get-Content $_.FullName -Raw) -replace 'YYYY-MM-DD', '2026-06-29' |
                Set-Content $_.FullName -NoNewline
        }

        # Unhealthy: only projectbrief, rest missing
        $BadProject = New-TestProject -Base $TestDrive -Name 'verify-bad'
        $mbBad = Join-Path $BadProject 'memory-bank'
        New-Item -ItemType Directory -Path $mbBad | Out-Null
        Set-Content (Join-Path $mbBad 'projectbrief.md') "---`nlast-reviewed: 2026-06-29`n---`n# Stub"
    }

    It "passes for a fully initialized project" {
        $result = Invoke-MbVerify -ProjectPath $HealthyProject -TemplatesDir (Join-Path $RepoRoot 'templates')
        $result.Passed | Should -Be $true
        $result.Missing.Count | Should -Be 0
    }

    It "fails when required files are missing" {
        $result = Invoke-MbVerify -ProjectPath $BadProject -TemplatesDir (Join-Path $RepoRoot 'templates')
        $result.Passed | Should -Be $false
        $result.Missing.Count | Should -BeGreaterThan 0
    }
}
```

- [ ] **Step 2: Run to confirm failure**

```powershell
Invoke-Pester tests/mb-setup.Tests.ps1 -Output Detailed
```

Expected: FAIL — `Get-MbMode`, `Get-MbUpgradeAnalysis`, `Invoke-MbVerify` not defined.

- [ ] **Step 3: Add three private helper functions to mb.ps1**

Insert these immediately before `function Show-Help` in `mb.ps1`:

```powershell
# ─── mb setup helpers ────────────────────────────────────────────────────────

function Get-MbMode {
    param([string]$ProjectPath)
    if (Test-Path (Join-Path $ProjectPath 'memory-bank') -PathType Container) {
        return 'upgrade'
    }
    return 'init'
}

function Get-MbUpgradeAnalysis {
    param([string]$ProjectPath, [string]$TemplatesDir)
    $mbPath        = Join-Path $ProjectPath 'memory-bank'
    $templateMbDir = Join-Path $TemplatesDir 'memory-bank'

    $required = Get-ChildItem $templateMbDir -File | Select-Object -ExpandProperty Name
    $present  = @()
    $missing  = @()
    foreach ($name in $required) {
        if (Test-Path (Join-Path $mbPath $name)) { $present += $name }
        else                                     { $missing += $name }
    }

    # Governance files checked by Invoke-Upgrade (template-owned only — hardcoded in upgrade)
    $templateOwned = @(
        '.claude/settings.json',
        'scripts/dangerous-commands.ps1', 'scripts/dangerous-commands.sh',
        'scripts/check-contract.ps1',     'scripts/check-contract.sh',
        'scripts/update-reviewed.ps1',    'scripts/update-reviewed.sh',
        'scripts/pre-push-check.ps1',     'scripts/pre-push-check.sh',
        'scripts/delegation-depth-check.ps1', 'scripts/delegation-depth-check.sh',
        'scripts/pre-compact-check.ps1',  'scripts/pre-compact-check.sh'
    )
    $govMissing = $templateOwned | Where-Object { -not (Test-Path (Join-Path $ProjectPath $_)) }

    return @{
        Present    = $present
        Missing    = $missing
        GovMissing = $govMissing
    }
}

function Invoke-MbVerify {
    param([string]$ProjectPath, [string]$TemplatesDir)
    $mbPath        = Join-Path $ProjectPath 'memory-bank'
    $templateMbDir = Join-Path $TemplatesDir 'memory-bank'
    $required      = Get-ChildItem $templateMbDir -File | Select-Object -ExpandProperty Name
    $missing       = @()
    foreach ($name in $required) {
        if (-not (Test-Path (Join-Path $mbPath $name))) { $missing += $name }
    }
    return @{
        Passed  = ($missing.Count -eq 0)
        Missing = $missing
    }
}
```

- [ ] **Step 4: Run tests to confirm helpers pass**

```powershell
Invoke-Pester tests/mb-setup.Tests.ps1 -Output Detailed
```

Expected: all tests pass.

- [ ] **Step 5: Add Invoke-Setup function to mb.ps1**

Insert immediately after the three helper functions:

```powershell
function Invoke-Setup {
    $templatesDir = Join-Path $RepoRoot 'templates'

    Write-Host ""
    Write-Host "=== PMB Setup ===" -ForegroundColor Cyan
    Write-Host ""

    # Step 1: Resolve target folder
    $target = $null
    if ($Arg -and (Test-Path $Arg -PathType Container)) {
        $target = (Resolve-Path $Arg).Path
    } else {
        $pickerScript = Join-Path $RepoRoot 'scripts/pick-folder.ps1'
        $target = pwsh -NoLogo -ExecutionPolicy Bypass -File $pickerScript `
                       -Description 'Select the project folder to set up with PMB'
    }
    if (-not $target) {
        Write-Host "No folder selected. Exiting." -ForegroundColor Yellow
        Write-Host ""; Write-Host "Press any key to close..."
        $null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
        return
    }

    Write-Host "Target: $target" -ForegroundColor Gray
    Write-Host ""

    # Step 2: Detect mode
    $mode = Get-MbMode -ProjectPath $target

    if ($mode -eq 'init') {
        # ── INIT ─────────────────────────────────────────────────────────────
        Write-Host "No memory-bank found — initializing..." -ForegroundColor Cyan
        Write-Host ""
        $script:Arg = $target
        Invoke-Init

    } else {
        # ── UPGRADE ───────────────────────────────────────────────────────────
        Write-Host "Memory bank found — analyzing for upgrade..." -ForegroundColor Cyan
        Write-Host ""

        $analysis = Get-MbUpgradeAnalysis -ProjectPath $target -TemplatesDir $templatesDir

        # Show current state
        Write-Host "--- Current State ---" -ForegroundColor Yellow
        foreach ($f in $analysis.Present)    { Write-Host "  ✅ $f" -ForegroundColor Green }
        foreach ($f in $analysis.Missing)    { Write-Host "  ❌ $f (missing)" -ForegroundColor Red }
        if ($analysis.GovMissing.Count -gt 0) {
            Write-Host ""
            Write-Host "  Governance files not yet installed:" -ForegroundColor DarkYellow
            foreach ($f in $analysis.GovMissing | Select-Object -First 5) {
                Write-Host "    ⚠️  $f" -ForegroundColor DarkYellow
            }
            if ($analysis.GovMissing.Count -gt 5) {
                Write-Host "    ... ($($analysis.GovMissing.Count - 5) more)" -ForegroundColor DarkYellow
            }
        }

        # Show upgrade plan
        Write-Host ""
        Write-Host "--- Upgrade Plan ---" -ForegroundColor Yellow
        foreach ($f in $analysis.Missing) {
            Write-Host "  Will add:      $f (scaffold from template)" -ForegroundColor Green
        }
        if ($analysis.GovMissing.Count -gt 0) {
            Write-Host "  Will install:  $($analysis.GovMissing.Count) governance file(s) (hooks, settings, standards)" -ForegroundColor Cyan
        }
        if ($analysis.Present.Count -gt 0 -and $analysis.Missing.Count -eq 0 -and $analysis.GovMissing.Count -eq 0) {
            Write-Host "  All memory-bank files current. Governance files will be checked." -ForegroundColor DarkGray
        }

        Write-Host ""
        $ans = Read-Host "Proceed with upgrade? (Y/N)"
        if ($ans -notmatch '^[Yy]') {
            Write-Host "Upgrade cancelled." -ForegroundColor Yellow
            Write-Host ""; Write-Host "Press any key to close..."
            $null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
            return
        }

        Write-Host ""
        Push-Location $target
        try {
            Invoke-Upgrade
        } finally {
            Pop-Location
        }
    }

    # Step 3: Verify
    Write-Host ""
    Write-Host "--- Verification ---" -ForegroundColor Cyan
    $verify = Invoke-MbVerify -ProjectPath $target -TemplatesDir $templatesDir
    if ($verify.Passed) {
        Write-Host "  ✅ All required memory-bank files present" -ForegroundColor Green
    } else {
        Write-Host "  ❌ Missing files after $mode`:" -ForegroundColor Red
        foreach ($f in $verify.Missing) { Write-Host "    - $f" -ForegroundColor Red }
        Write-Host "  Re-run mb-setup.bat to retry." -ForegroundColor Yellow
    }

    Write-Host ""
    Write-Host "Done. Open Claude Code in $target to start your session." -ForegroundColor Green
    Write-Host ""
    Write-Host "Press any key to close..."
    $null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
}
```

- [ ] **Step 6: Run full test suite**

```powershell
Invoke-Pester tests/mb-setup.Tests.ps1 -Output Detailed
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```powershell
git add scripts/mb.ps1 tests/mb-setup.Tests.ps1
git commit -m "feat: add Invoke-Setup with analysis, preview, confirm, verify, and summary"
```

---

## Task 4: End-to-End Smoke Tests

**Files:** None — manual testing only.

- [ ] **Step 1: Smoke test — INIT (double-click)**

Create an empty temp folder, e.g. `C:\Temp\test-new-project\`. Double-click `mb-setup.bat`. Select the temp folder.

Expected output:

```
=== PMB Setup ===
Target: C:\Temp\test-new-project

No memory-bank found — initializing...

Memory Bank
===========
  [+] memory-bank/projectbrief.md
  [+] memory-bank/systemPatterns.md
  [+] memory-bank/techContext.md
  [+] memory-bank/activeContext.md
  [+] memory-bank/progress.md
  [+] CLAUDE.md
  ...

--- Verification ---
  ✅ All required memory-bank files present

Done. Open Claude Code in C:\Temp\test-new-project to start your session.

Press any key to close...
```

- [ ] **Step 2: Smoke test — UPGRADE (drag-and-drop)**

Delete `systemPatterns.md` from the memory-bank you just created. Drag `C:\Temp\test-new-project\` onto `mb-setup.bat`.

Expected: upgrade analysis shows ❌ `systemPatterns.md`, plan says "Will add: systemPatterns.md", after Y it scaffolds the file and verification passes.

- [ ] **Step 3: Smoke test — INIT (cancel)**

Double-click `mb-setup.bat`, then click Cancel in the folder picker.

Expected: "No folder selected. Exiting." — exits cleanly without error.

- [ ] **Step 4: Smoke test — UPGRADE (decline)**

On a project with PMB already set up, run `mb-setup.bat` and type N at the confirmation prompt.

Expected: "Upgrade cancelled." — no files changed.

- [ ] **Step 5: Commit**

```powershell
git add .
git commit -m "test: confirm mb-setup.bat smoke tests pass for init and upgrade flows"
```

---

## Task 5: Update Help Text and README

**Files:**

- Modify: `scripts/mb.ps1` (Show-Help — already done in Task 2, verify it reads well)
- Modify: `README.md` (PMB repo root — update quick-start reference)

- [ ] **Step 1: Verify Show-Help output reads clearly**

```powershell
pwsh -File scripts/mb.ps1 help
```

Confirm `setup` line reads:

```
  setup         Initialize or upgrade a project — folder picker, auto-detects mode
```

- [ ] **Step 2: Update README.md**

Find the section that references `mb-new-project.bat` (or the "Quick Start" / "Getting Started" section) and update it:

````markdown
## Setting Up a Project

Double-click **`mb-setup.bat`** from Windows Explorer to set up Memory Bank in any project:

- **New project**: detects no `memory-bank/` and runs a full init
- **Existing project**: shows what's current vs. outdated, asks for confirmation, then upgrades
- **Drag-and-drop**: drag a project folder onto the `.bat` to skip the folder picker

Or from the command line:

```powershell
mb setup                        # GUI folder picker
mb setup "C:\path\to\project"  # direct path
```
````

````

- [ ] **Step 3: Run full Pester suite one final time**

```powershell
Invoke-Pester tests/ -Output Detailed
````

Expected: all tests pass.

- [ ] **Step 4: Final commit**

```powershell
git add README.md scripts/mb.ps1
git commit -m "docs: update README and help text for mb-setup.bat"
```
