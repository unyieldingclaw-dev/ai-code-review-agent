<#
.SYNOPSIS
    PreCompact hook — quality gate before context compaction.
.DESCRIPTION
    Blocks compaction unless the memory bank shows substantive session work:
      1. activeContext.md has ≥3 substantive content lines (not just a last-reviewed touch)
      2. progress.md contains at least one entry dated today
    If either check fails, exits 2 to block compaction with an actionable message.
    A handoff.md bypasses all checks (handoff protocol already captures state).
    Fails open on unexpected errors (exits 0) and logs to .pmb-hook-errors.log.
#>

param()

try {
    $today = Get-Date -Format 'yyyy-MM-dd'

    # Bypass: handoff.md present means state is captured via handoff protocol
    if (Test-Path "handoff.md") { exit 0 }

    $blockReasons = @()

    # Check 1: activeContext.md — must have ≥3 substantive lines
    # Substantive = non-frontmatter, non-heading, non-empty, ≥20 chars
    $activeCtx = "memory-bank/activeContext.md"
    if (Test-Path $activeCtx) {
        $lines = Get-Content $activeCtx
        $inFm = $false; $fmCount = 0; $substantive = 0
        foreach ($line in $lines) {
            if ($line -eq '---') {
                $fmCount++
                $inFm = ($fmCount -eq 1)
                if ($fmCount -ge 2) { $inFm = $false }
                continue
            }
            if ($inFm) { continue }
            if ($line -match '^#{1,6}' -or [string]::IsNullOrWhiteSpace($line)) { continue }
            if ($line.Trim().Length -ge 20) { $substantive++ }
        }
        if ($substantive -lt 3) {
            $blockReasons += "activeContext.md has only $substantive substantive line(s) (need ≥3) — update it with current session state before compacting"
        }
    } else {
        $blockReasons += "activeContext.md missing — run 'mb init'"
    }

    # Check 2: progress.md — must contain at least one entry dated today
    $progressFile = "memory-bank/progress.md"
    if (Test-Path $progressFile) {
        $content = Get-Content $progressFile -Raw
        if ($content -notmatch [regex]::Escape($today)) {
            $blockReasons += "progress.md has no entry dated $today — add today's progress before compacting"
        }
    } else {
        $blockReasons += "progress.md missing — run 'mb init'"
    }

    if ($blockReasons.Count -eq 0) { exit 0 }

    Write-Host "[PreCompact] Compaction quality gate: $($blockReasons.Count) check(s) failed."
    foreach ($reason in $blockReasons) {
        Write-Host "  - $reason"
    }
    Write-Host "Fix the above, then compact. Or create handoff.md to bypass via the Handoff Protocol."
    exit 2
} catch {
    Write-Host "[HOOK ERROR] pre-compact-check.ps1 failed unexpectedly. Proceeding in fails-open mode."
    try { Add-Content ".pmb-hook-errors.log" "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] [HOOK] pre-compact-check.ps1: $_" -ErrorAction SilentlyContinue } catch {}
    exit 0
}
