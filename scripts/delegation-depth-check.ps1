<#
.SYNOPSIS
    PreToolUse hook — agent spawn count advisory.
.DESCRIPTION
    Counts this session's Agent tool invocations in a rolling 60-minute window (not nesting depth).
    Emits a WARN when the count reaches the budget (≤25 per PERFORMANCE-BUDGET.md), then again at
    every further budget's worth. State is stored in .pmb-delegation-depth (gitignored), one
    "<session-id> <epoch-seconds>" line per spawn.
    Always exits 0 — this is advisory, not blocking.
    NOTE: True nesting depth cannot be tracked — no PostToolUse:Agent hook exists.
#>

param()

try {
    $depthFile = '.pmb-delegation-depth'
    $windowSeconds = 3600
    $budgetLimit = 25  # spawns per session per rolling 60 minutes; see standards/PERFORMANCE-BUDGET.md
    $futureSlack = 300  # seconds of clock skew tolerated before a future-dated line is dropped
    $pruneOver = 200    # rewrite the file to in-window lines only once it holds more lines than this

    # WHY payload first, then CLAUDE_CODE_SESSION_ID, then "unknown": see the sh twin.
    # WHY -cmatch: case-insensitive matching lets [A-Za-z] accept non-ASCII letters such as the
    # Kelvin sign, which the sh twin (C locale) rejects. WHY \z, not $: .NET's $ also matches
    # before a final newline, so an id ending in one would pass and write a broken line.
    $payload = ''
    try { $payload = [Console]::In.ReadToEnd() } catch { Write-Verbose "Could not read the hook payload; using the fallback session id." }
    $sid = ''
    if ($payload -cmatch '"session_id"\s*:\s*"([A-Za-z0-9_-]*)"') { $sid = $Matches[1] }
    if (-not $sid) { $sid = "$env:CLAUDE_CODE_SESSION_ID" }
    if ($sid -cnotmatch '^[A-Za-z0-9_-]{1,128}\z') { $sid = 'unknown' }

    $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    $lines = @()
    if (Test-Path -LiteralPath $depthFile) { $lines = @(Get-Content -LiteralPath $depthFile -ErrorAction SilentlyContinue) }

    # WHY a strict line pattern: see the sh twin ([NS-67](c)). Non-matching lines are ignored.
    $inWindow = @($lines | Where-Object {
        if ($_ -cnotmatch '^[A-Za-z0-9_-]+ [0-9]{1,12}\z') { return $false }
        $ts = [long]($_ -split ' ')[1]
        ($ts -gt ($now - $windowSeconds)) -and ($ts -le ($now + $futureSlack))
    })
    $count = @($inWindow | Where-Object { ($_ -split ' ')[0] -ceq $sid }).Count

    # WHY systemMessage-only JSON, and only at each multiple of the budget: see the sh twin.
    # EscapeNonAscii writes the "≤" as \u2264, so the JSON is pure ASCII and survives pwsh's
    # non-UTF-8 stdout encoding on Windows (which turns it into "?" otherwise).
    if ($count -ge $budgetLimit -and (($count - $budgetLimit) % $budgetLimit) -eq 0) {
        $where = if ($sid -ceq 'unknown') { 'this checkout (no session id)' } else { 'this session' }
        [ordered]@{
            systemMessage = "[WARN] Agent spawn count: $($count + 1) in $where in the last 60 minutes (budget: ≤$budgetLimit per standards/PERFORMANCE-BUDGET.md). High agent volume increases prompt-injection surface. Consider consolidating tasks."
        } | ConvertTo-Json -Compress -EscapeHandling EscapeNonAscii | Write-Output
    }

    # WHY append-only, and why a legacy depth= file is replaced outright: see the sh twin.
    $entry = "$sid $now"
    $tmp = $null
    try {
        if (@($lines | Where-Object { $_ -clike 'depth=*' }).Count -gt 0) {
            Set-Content -LiteralPath $depthFile -Value $entry -ErrorAction Stop
        } elseif ($lines.Count -gt $pruneOver) {
            $tmp = "$depthFile.tmp.$PID"
            Set-Content -LiteralPath $tmp -Value (@($inWindow) + $entry) -ErrorAction Stop
            Move-Item -LiteralPath $tmp -Destination $depthFile -Force -ErrorAction Stop
        } else {
            Add-Content -LiteralPath $depthFile -Value $entry -ErrorAction Stop
        }
    } catch {
        Write-Verbose "Could not persist $depthFile; this spawn goes uncounted."
        if ($tmp) { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }
    }

    exit 0
} catch {
    try { Add-Content ".pmb-hook-errors.log" "[$((Get-Date).ToString('yyyy-MM-dd HH:mm:ss', [cultureinfo]::InvariantCulture))] [HOOK] delegation-depth-check.ps1: $_" -ErrorAction SilentlyContinue } catch { Write-Verbose "Could not write .pmb-hook-errors.log; ignoring." }
    exit 0
}
