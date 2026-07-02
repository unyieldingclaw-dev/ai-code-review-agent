# PreToolUse hook — blocks git commit/push until the matching review slash command has run.
# /code-review writes .claude/.code-review-ok on an Approve verdict; /change-review writes
# .claude/.change-review-ok when no finding is Blocking. Each marker authorizes exactly one
# commit or push attempt -- consumed the moment this hook sees it, so the next change needs a
# fresh review. Known limitation: the marker is consumed even if the commit/push itself then
# fails (e.g. a separate pre-commit hook rejects it) -- an accepted false-strict tradeoff, not
# a security gap, since the failure mode is "re-run the review," not "skip it."
#
# WHY match "git\s+commit\b" anywhere in $cmd instead of anchoring to command start/operators:
# an anchored regex (^|[;&|]\s*)git\s+commit\b misses real shapes -- multi-line Bash tool
# commands (git commit after a literal newline), a bare single "&", or nested subshells. $cmd
# is already the exact, JSON-parsed command text (not raw payload noise), so an unanchored
# match is safe: the only real risk is a false positive if "git commit" appears as a substring
# elsewhere in the command, which just means an occasional unnecessary re-review -- the safe
# failure direction for a security gate.
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

if ($cmd -match 'git\s+commit\b') {
    if (-not (Test-AndConsumeMarker (Join-Path $root '.claude/.code-review-ok'))) {
        Deny "Run /code-review before committing -- it writes the review-ok marker this hook checks."
    }
} elseif ($cmd -match 'git\s+push\b') {
    if (-not (Test-AndConsumeMarker (Join-Path $root '.claude/.change-review-ok'))) {
        Deny "Run /change-review before pushing -- it writes the review-ok marker this hook checks."
    }
}
