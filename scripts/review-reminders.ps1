# PreToolUse hook — blocks git commit/push until the matching review slash command has run.
# /code-review writes .claude/.code-review-ok on an Approve verdict; /change-review writes
# .claude/.change-review-ok when no finding is Blocking. Each marker authorizes exactly one
# commit or push -- this hook deletes it the moment it's consumed, so the next change needs a
# fresh review.
#
# WHY hookSpecificOutput.permissionDecision, not top-level "continue": top-level
# {"continue": false} only stops the agent's turn *after* the tool call has already run --
# it does not prevent execution. Verified empirically: an earlier version of this hook using
# {"continue": false} let a real `git commit` through untouched, then interrupted the next
# turn. hookSpecificOutput.permissionDecision = "deny" is the mechanism that actually denies
# the tool call before it executes.
try {
    $raw = [Console]::In.ReadToEnd()
    if ([string]::IsNullOrWhiteSpace($raw)) { exit 0 }
    $cmd = ($raw | ConvertFrom-Json).tool_input.command
} catch { exit 0 }

if (-not $cmd) { exit 0 }

$root = git rev-parse --show-toplevel 2>$null
if (-not $root) { exit 0 }

function Test-AndConsumeMarker {
    param([string]$Marker)
    if (Test-Path $Marker) {
        Remove-Item $Marker -Force
        return $true
    }
    return $false
}

function Deny {
    param([string]$Reason)
    @{
        hookSpecificOutput = @{
            hookEventName            = "PreToolUse"
            permissionDecision       = "deny"
            permissionDecisionReason = $Reason
        }
    } | ConvertTo-Json -Compress | Write-Output
}

if ($cmd -match '(^|[;&|]\s*)git\s+commit\b') {
    if (-not (Test-AndConsumeMarker (Join-Path $root '.claude/.code-review-ok'))) {
        Deny "Run /code-review before committing -- it writes the review-ok marker this hook checks."
    }
} elseif ($cmd -match '(^|[;&|]\s*)git\s+push\b') {
    if (-not (Test-AndConsumeMarker (Join-Path $root '.claude/.change-review-ok'))) {
        Deny "Run /change-review before pushing -- it writes the review-ok marker this hook checks."
    }
}
