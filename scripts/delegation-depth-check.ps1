<#
.SYNOPSIS
    PreToolUse hook — agent delegation depth enforcement.
.DESCRIPTION
    Tracks how many times the Agent tool is invoked in a session.
    Emits a WARN when depth exceeds the budget (≤1 per PERFORMANCE-BUDGET.md).
    State is stored in .pmb-delegation-depth (gitignored).
    Resets automatically after 2 hours of inactivity (session boundary).
    Always exits 0 — this is advisory, not blocking.
#>

param()

try {
    $depthFile = '.pmb-delegation-depth'
    $maxAge = 120  # minutes before resetting depth (session boundary)
    $budgetLimit = 1  # from standards/PERFORMANCE-BUDGET.md

    $depth = 0
    if (Test-Path $depthFile) {
        $content = Get-Content $depthFile -Raw -ErrorAction SilentlyContinue
        if ($content -match 'depth=(\d+)') { $depth = [int]$Matches[1] }
        if ($content -match 'timestamp=(\d{4}-\d{2}-\d{2} \d{2}:\d{2})') {
            try {
                $ts = [datetime]::ParseExact($Matches[1], 'yyyy-MM-dd HH:mm', $null)
                if (([datetime]::Now - $ts).TotalMinutes -gt $maxAge) { $depth = 0 }
            } catch {}
        }
    }

    if ($depth -ge $budgetLimit) {
        Write-Host "[WARN] Agent delegation depth: $($depth + 1) (budget: ≤$budgetLimit per standards/PERFORMANCE-BUDGET.md)"
        Write-Host "       Each nested delegation increases prompt-injection surface. Consider consolidating tasks."
    }

    $ts = Get-Date -Format 'yyyy-MM-dd HH:mm'
    try { Set-Content -Path $depthFile -Value "depth=$($depth + 1)`ntimestamp=$ts" -NoNewline -ErrorAction Stop } catch {}

    exit 0
} catch {
    try { Add-Content ".pmb-hook-errors.log" "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] [HOOK] delegation-depth-check.ps1: $_" -ErrorAction SilentlyContinue } catch {}
    exit 0
}
