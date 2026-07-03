# PreToolUse hook — blocks git commit/push until the matching review slash command has run.
# /code-review writes .claude/.code-review-ok on an Approve verdict; /change-review writes
# .claude/.change-review-ok when no finding is Blocking. Each marker authorizes exactly one
# commit or push attempt for a SPECIFIC diff -- see below.
#
# WHY the marker holds a SHA-256 hash of the reviewed diff, not an empty file: an empty
# marker is trivially fakeable with `touch` -- anyone (or a rushed agent) can satisfy the
# gate without actually reviewing anything. Binding the marker to a hash of the exact diff
# means it only authorizes committing/pushing that SPECIFIC diff; if the working tree
# changes after the review, the hash no longer matches and the gate re-engages.
#
# WHY the marker is consumed via an atomic rename (Move-Item), not a separate
# Test-Path + Remove-Item: check-then-delete has a TOCTOU window between the two steps.
# Move-Item's underlying rename is a single filesystem operation -- if the source doesn't
# exist, the move simply fails, collapsing "does it exist" and "claim it" into one step.
#
# WHY this also records a pre-state SHA before consuming the marker: see the companion
# PostToolUse hook (review-reminders-post.ps1/.sh) -- if the gated commit/push then fails,
# that hook detects the relevant git ref didn't move and reissues the marker, so a rejected
# attempt (e.g. a separate pre-commit hook) doesn't force a pointless re-review.
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

# WHY hash a file written via redirection, not a piped/captured string: PowerShell's
# pipeline re-tokenizes external-command output into a line-object array and back, which
# does not reproduce the exact byte stream (trailing newline, line endings) that piping
# the same command through bash produces. Empirically confirmed: (git diff HEAD) -join
# "`n" then hashed did NOT match `git diff HEAD | sha256sum` for the identical diff.
# Redirecting to a file (`>`) writes raw bytes with no such re-tokenization on either
# platform -- confirmed empirically to produce byte-identical files (and therefore
# identical hashes) whether written from PowerShell or from bash. This matters because
# review-reminders.ps1 is the hook that actually runs on any machine with pwsh installed
# (preferred over the .sh fallback), so its hash must match what /code-review's
# instructions produce regardless of which shell the human or agent used to write it.
function Get-FileHashHex {
    param([string]$Path)
    return (Get-FileHash -Path $Path -Algorithm SHA256).Hash.ToLower()
}

function Get-CommitDiffHash {
    $tmp = [System.IO.Path]::GetTempFileName()
    try {
        git diff HEAD > $tmp 2>$null
        return Get-FileHashHex $tmp
    } finally {
        Remove-Item $tmp -Force -ErrorAction SilentlyContinue
    }
}

function Get-PushDiffHash {
    $tmp = [System.IO.Path]::GetTempFileName()
    try {
        git diff origin/main...HEAD > $tmp 2>$null
        if ($LASTEXITCODE -ne 0) {
            git diff HEAD > $tmp 2>$null
        }
        return Get-FileHashHex $tmp
    } finally {
        Remove-Item $tmp -Force -ErrorAction SilentlyContinue
    }
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

function Test-AndConsumeMarker {
    param([string]$Marker, [string]$ExpectedHash)
    $claimed = "$Marker.claimed"
    try {
        Move-Item -Path $Marker -Destination $claimed -Force -ErrorAction Stop
    } catch {
        return $false
    }
    $content = $null
    try { $content = (Get-Content $claimed -Raw -ErrorAction Stop).Trim() } catch {}
    Remove-Item $claimed -Force -ErrorAction SilentlyContinue
    return ($content -and $content -eq $ExpectedHash)
}

if ($cmd -match 'git\s+commit\b') {
    $expected = Get-CommitDiffHash
    $marker = Join-Path $root '.claude/.code-review-ok'
    if (Test-AndConsumeMarker $marker $expected) {
        $preSha = git rev-parse HEAD 2>$null
        if ($preSha) { $preSha | Set-Content (Join-Path $root '.claude/.pending-commit-presha') }
    } else {
        Deny "Run /code-review before committing -- it writes a diff-bound review-ok marker this hook checks. If you already reviewed, the working tree changed since then; re-run /code-review."
    }
} elseif ($cmd -match 'git\s+push\b') {
    $expected = Get-PushDiffHash
    $marker = Join-Path $root '.claude/.change-review-ok'
    if (Test-AndConsumeMarker $marker $expected) {
        $preSha = git rev-parse '@{u}' 2>$null
        if ($preSha) { $preSha | Set-Content (Join-Path $root '.claude/.pending-push-presha') }
    } else {
        Deny "Run /change-review before pushing -- it writes a diff-bound review-ok marker this hook checks. If you already reviewed, the diff changed since then; re-run /change-review."
    }
}
