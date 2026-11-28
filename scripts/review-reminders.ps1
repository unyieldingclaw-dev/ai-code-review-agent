# PreToolUse hook -- blocks git commit/push until the matching review slash command has run,
# except a tag-only push of an already-merged commit (see the PUSH case; full WHY in the .sh twin).
# Claude only peeks at typed canonical fingerprints. Native Git hooks alone
# consume authorization, and no PostToolUse callback recreates spent markers.
#
# WHY match "git\s+commit\b" anywhere in $cmd instead of anchoring to command start/operators:
# an anchored regex (^|[;&|]\s*)git\s+commit\b misses real shapes -- multi-line Bash tool
# commands (git commit after a literal newline), a bare single "&", or nested subshells. $cmd
# is already the exact, JSON-parsed command text (not raw payload noise), so an unanchored
# match is safe: the only real risk is a false positive if "git commit" appears as a substring
# elsewhere in the command, which just means an occasional unnecessary re-review -- the safe
# failure direction for a security gate.
#
# WHY a merge gets a permission prompt ("ask") instead of a third diff-bound marker: the gap at
# merge time isn't diff integrity (the commit gate, push gate and strict required checks cover
# that), it's authorization -- the user deciding, in that moment, to merge that PR -- and no
# marker the agent can write encodes that. The harness's own Allow/Deny prompt is the one
# per-action approval the agent cannot forge. It replaced an unconditional deny on 2026-10-20,
# after an in-app measurement in auto mode showed the ask stops for the user's click.
# _review-gate-merge.ps1 decides; only one exact, repo-pinned form is ever asked. Full WHY in
# review-reminders.sh; spec: docs/superpowers/specs/2026-10-20-merge-gate-user-approval-design.md.
#
# WHY hookSpecificOutput.permissionDecision, not top-level "continue": top-level
# {"continue": false} only stops the agent's turn *after* the tool call has already run --
# it does not prevent execution. Verified empirically: an earlier version of this hook using
# {"continue": false} let a real `git commit` through untouched, then interrupted the next
# turn. hookSpecificOutput.permissionDecision = "deny" is the mechanism that actually denies
# the tool call before it executes.
#
function Deny {
    param([string]$Reason)
    @{
        hookSpecificOutput = @{
            hookEventName            = 'PreToolUse'
            permissionDecision       = 'deny'
            permissionDecisionReason = $Reason
        }
    } | ConvertTo-Json -Compress | Write-Output
}

# As UTF-8, not through [Console]::In, which decodes with the console code page (IBM437, measured)
# and so turned the pwsh quotes U+2018-U+201E in Claude Code's raw UTF-8 into other characters: a
# push between them classified NONE. Inline rather than the classifier's Read-ReviewGateStdin,
# because the fallback below must read stdin even when the classifier is missing.
$raw = if ([Console]::IsInputRedirected) {
    (New-Object System.IO.StreamReader([Console]::OpenStandardInput(),
        (New-Object System.Text.UTF8Encoding($false)), $true)).ReadToEnd()
} else { '' }
if ([string]::IsNullOrWhiteSpace($raw)) { exit 0 }

# Classify before loading anything that can fail. A known guarded action must fail closed
# when its library or repository root is unavailable; read-only commands remain unaffected.
$verdict = $null
$cmd = $null
$reading = ''
$verdictFromFallback = $false
try {
    . (Join-Path $PSScriptRoot '_review-gate-classify.ps1')
    $verdict = Get-ReviewGateVerdictFromPayload $raw
    $payload = $raw | ConvertFrom-Json -ErrorAction Stop
    $toolInput = $payload.tool_input
    if ($null -eq $toolInput) { $toolInput = $payload.toolInput }
    $cmd = $toolInput.command
} catch {
    # Preserve the old conservative raw matcher for malformed payloads or a missing
    # classifier. Lowercasing closes the executable-case hole on this fallback path.
    $verdictFromFallback = $true
    $lower = $raw.ToLowerInvariant()
    $fallbackMatches = @()
    if ($lower.Contains('git commit')) { $fallbackMatches += 'COMMIT' }
    if ($lower.Contains('git push')) { $fallbackMatches += 'PUSH' }
    if ($lower.Contains('gh pr merge')) { $fallbackMatches += 'MERGE' }
    $verdict = if ($fallbackMatches.Count -gt 1) { 'MULTI' }
        elseif ($fallbackMatches.Count -eq 1) { $fallbackMatches[0] }
        else { 'NONE' }
}

# The shell the tool runs the command in; the repository context below must read it the same way.
# Outside the try above and only if defined: an older _review-gate-classify.ps1 lacks the function,
# and a throw inside the try replaced that classifier's verdict with the substring fallback, which
# allowed `git -C . commit` (measured in review). Without it, the older context call is used as is.
if (-not $verdictFromFallback -and (Get-Command Get-ReviewGatePayloadReading -ErrorAction SilentlyContinue)) {
    $reading = Get-ReviewGatePayloadReading $payload
}

if ($verdict -eq 'NONE') { exit 0 }
if ($verdict -eq 'MULTI') {
    Deny 'Review gate: compound commands containing multiple guarded actions must be run separately so each action receives its own authorization.'
    exit 0
}
if ($verdict -eq 'AMBIGUOUS') {
    # Not MULTI's "run them separately": nothing here is two actions. See the .sh twin.
    Deny 'Review gate: the gate cannot tell what this command runs, because it reads more than one way (in bash and in PowerShell, with and without a heredoc or here-string body, or a launcher''s words as written and unquoted, as when part of an option value is quoted: -C"x"), or a command word is spelled with an escape the gate does not decode ($''\x..'' or `u{..}), or the command is too long or nested too deeply for the gate to read (launchers inside launchers, or nested $( substitutions). Spell git, gh and the subcommand plainly, with no quotes or escapes inside those words, quote whole arguments (-C "x", not -C"x"), keep heredoc text out of a command that commits or pushes, split an over-long or over-nested command into simpler ones, and run it again.'
    exit 0
}
if ($verdict -eq 'UNREAD') {
    # A deny in every mode that claims and checks no marker; see the .sh twin.
    Deny 'Review gate: the gate cannot read the program in front of git or gh in this command (it is not a wrapper or launcher the gate decodes, such as flock, nsenter or watch), so this commit, push or merge cannot be bound to a review. Run git or gh directly so it can be reviewed; if the words are text, not a command, put the whole phrase inside one pair of quotes, as one word.'
    exit 0
}
if ($verdict -eq 'MERGE') {
    # Asked only when _review-gate-merge.ps1 answers ASK; a fallback verdict, a missing helper
    # or any throw denies. See the WHY above and the .sh twin.
    $mergeDecision = $null
    if (-not $verdictFromFallback) {
        try {
            . (Join-Path $PSScriptRoot '_review-gate-merge.ps1')
            $projectDir = if ($env:CLAUDE_PROJECT_DIR) { $env:CLAUDE_PROJECT_DIR } else { (Get-Location).Path }
            $mergeDecision = Get-ReviewGateMergeDecision -Raw $raw -ProjectDir $projectDir
        } catch {
            $mergeDecision = $null
        }
    }
    if ($null -ne $mergeDecision -and $mergeDecision.Decision -ceq 'ASK') {
        @{
            hookSpecificOutput = @{
                hookEventName            = 'PreToolUse'
                permissionDecision       = 'ask'
                permissionDecisionReason = $mergeDecision.Reason
            }
        } | ConvertTo-Json -Compress | Write-Output
        # After the decision, and allowed to fail: a record of what was asked, not the answer.
        # An explicit LF, so lines match the .sh twin's in the shared log (Add-Content ends a
        # line with CRLF on Windows).
        try {
            Add-Content -LiteralPath (Join-Path (Join-Path $projectDir '.claude') 'merge-asks.log') `
                -Value ("{0}`t{1}`n" -f (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ', [cultureinfo]::InvariantCulture), $mergeDecision.Audit) `
                -NoNewline -ErrorAction Stop
        } catch {
            # Swallowed on purpose: the decision is already printed, and a throw escaping here would
            # exit non-zero, run the bash fallback and print a second JSON object (no decision).
            $null = $_
        }
    } elseif ($null -ne $mergeDecision -and $mergeDecision.Decision -ceq 'DENY' -and $mergeDecision.Reason) {
        if ($mergeDecision.Cause) { [Console]::Error.WriteLine("merge gate: $($mergeDecision.Cause)") }
        Deny $mergeDecision.Reason
    } else {
        Deny 'This agent merges a pull request only after the merge gate has checked it, and the check could not run here (no classifier verdict, or scripts/_review-gate-merge.ps1 unavailable). Merge in the GitHub UI instead.'
    }
    exit 0
}

try {
    . (Join-Path $PSScriptRoot '_review-gate-lib.ps1')
} catch {
    Deny 'Review gate cannot run: scripts/_review-gate-lib.ps1 is missing or unreadable, so the marker check is unavailable. Restore the file before committing or pushing.'
    exit 0
}

# WHY this exists: `git rev-parse --show-toplevel` below trusts the hook process's own
# ambient cwd, which is empirically wrong for some dispatched-subagent sessions. $cmd is
# already the parsed command string (via ConvertFrom-Json above), so extracting a leading cd
# path is a plain regex, no new dependency needed. Falls back to the ambient resolution on
# any failure -- a session where ambient cwd is already correct is completely unaffected.
$commandContext = if ($reading) { Get-ReviewGateCommandContext $cmd $reading } else { Get-ReviewGateCommandContext $cmd }
if ($commandContext.Unsupported) {
    Deny "Review gate cannot safely bind this command's git context to a repository: it uses --git-dir/--work-tree, a wrapper option that changes directory (env -C, sudo -D), or names GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE, GIT_OBJECT_DIRECTORY or GIT_COMMON_DIR. Run the command from that repository without them. A commit message that mentions one of those names must be passed with -F <file>, not -m."
    exit 0
}
$contextDir = (Get-Location).Path
$contextFailed = $false
foreach ($contextPath in @($commandContext.Paths)) {
    try {
        $candidate = if ([System.IO.Path]::IsPathRooted($contextPath)) {
            $contextPath
        } else {
            Join-Path $contextDir $contextPath
        }
        $contextDir = (Resolve-Path -LiteralPath $candidate -ErrorAction Stop).Path
    } catch {
        $contextFailed = $true
        break
    }
}
if ($contextFailed) {
    Deny "Review gate cannot resolve the command's explicit repository path, so it cannot verify the correct marker."
    exit 0
}
$cdRoot = Resolve-CdRoot -Cmd $cmd
$root = if (@($commandContext.Paths).Count -gt 0) {
    git -C $contextDir rev-parse --show-toplevel 2>$null
} elseif ($cdRoot) {
    $cdRoot
} else {
    git rev-parse --show-toplevel 2>$null
}
if (-not $root) {
    Deny 'Review gate cannot run: the repository root could not be resolved, so the marker check is unavailable.'
    exit 0
}

# WHY Set-Location here, not -C $root on every git call below: resolving $root fixes where
# the marker is looked FOR, but the diff-hash functions and $preSha rev-parse call further
# down still run bare git commands with no directory anchor -- the same ambient-cwd
# assumption just fixed above, at different call sites. Anchoring the rest of this script to
# $root once, here, means every git call downstream is correct by construction instead of
# needing -C $root at each individual site.
# -LiteralPath: plain Set-Location expands wildcards, so a root such as C:\x\[ab]\repo (reached
# through a junction) landed in C:\x\a\repo, and the tag route checked that repository's tags
# instead of the one the shell pushes from (measured 2026-10-30, pwsh 7).
try { Set-Location -LiteralPath $root } catch {
    Deny "Review gate cannot run: the resolved repository root '$root' is not enterable."
    exit 0
}

function Test-ReviewGateMarker {
    param([string]$Marker, [string]$Expected)
    try {
        $item = Get-Item -LiteralPath $Marker -Force -ErrorAction Stop
        if ($item.PSIsContainer -or ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) { return $false }
        $actual = [System.IO.File]::ReadAllBytes($Marker)
        $wanted = [System.Text.Encoding]::UTF8.GetBytes("$Expected`n")
        if ($actual.Length -ne $wanted.Length) { return $false }
        for ($i = 0; $i -lt $wanted.Length; $i++) {
            if ($actual[$i] -ne $wanted[$i]) { return $false }
        }
        return $true
    } catch { return $false }
}

# WHY name the root in the empty-diff denials: a command whose cd was not its first word
# (`N=...; cd "<worktree>" && git push`) fell back to the hook's working directory, the main
# checkout, whose diff was empty -- and the denial gave no hint which tree it had checked.
# The cd form named here is the one the resolvers accept: quoted, first in the command, then &&
# (_review-gate-classify.ps1 / _review-gate-lib.ps1). An unquoted cd falls back to the working directory again.
$rootHint = "The gate checked ${root}: it takes the repository from a quoted cd ""<path>"" && chain at the very start of the command plus any git -C path, else from the hook's working directory. If that is the wrong tree, start the command with cd ""<repo>"" &&."

switch ($verdict) {
    'COMMIT' {
        if (Test-CommitTouchesGitlink $root) { Deny "Review gate: a staged submodule pointer or checked-out submodule HEAD changed, or git failed; this commit is refused. $rootHint"; break }
        # Default validator mode rejects empty, malformed and mixed staged changes.
        try { $evidenceOnly = Invoke-ReviewEvidenceCheck index } catch { $evidenceOnly = $false }
        if ($evidenceOnly) { break }
        try { $expected = Get-CommitReviewFingerprint $root } catch { $expected = $null }
        if (-not $expected) {
            Deny "Review gate: no diff to review or canonical staged fingerprint unavailable. $rootHint"
        } elseif (-not (Test-ReviewGateMarker (Join-Path $root '.claude/.code-review-ok') $expected)) {
            Deny "Run /code-review before committing -- the typed marker must match the current index and parent HEAD. $rootHint"
        }
        break
    }
    'PUSH' {
        # A tag-only push is checked by where its tags point, not by a marker. See the .sh twin
        # for the WHY of each check. A fallback verdict never takes this route: either the
        # classifier, which defines Get-ReviewGateTagPushName, did not load, or $cmd is unset.
        $tagNames = @(Get-ReviewGateTagPushName $cmd)
        # The shape guarantees one absolute cd path, but on Windows a /... path is rooted and not
        # fully qualified. pwsh resolves it on the current drive (/tmp is C:\tmp), while Git Bash
        # resolves its own mount (/tmp is %TEMP%), so the two could check and push different trees.
        foreach ($contextPath in @($commandContext.Paths)) {
            if (-not [System.IO.Path]::IsPathFullyQualified($contextPath)) { $tagNames = @() }
        }
        # A remote.<name>.push refspec makes git map a refs/tags/<t> with no :<dst> onto that
        # refspec's destination, which can be a branch, with its force flag. See the .sh twin.
        $null = git config --get-regexp '^remote\..*\.push$' 2>$null
        if ($LASTEXITCODE -eq 0) { $tagNames = @() }
        if ($tagNames.Count -gt 0) {
            foreach ($tag in $tagNames) {
                $tagOk = $false
                git show-ref --verify --quiet "refs/tags/$tag" 2>$null
                $tagExists = $LASTEXITCODE -eq 0
                $null = git symbolic-ref -q "refs/tags/$tag" 2>$null
                if ($tagExists -and $LASTEXITCODE -ne 0) {
                    $tagTarget = git rev-parse --verify --quiet "refs/tags/$tag" 2>$null
                    if ($LASTEXITCODE -eq 0 -and $tagTarget) {
                        git --no-replace-objects merge-base --is-ancestor $tagTarget refs/remotes/origin/main 2>$null
                        $tagOk = $LASTEXITCODE -eq 0
                    }
                }
                if (-not $tagOk) {
                    Deny "Review gate: refs/tags/$tag does not exist, is a symbolic ref, does not point at a commit, or points at a commit that is not in refs/remotes/origin/main, so pushing it could publish unreviewed history. A tag push needs no review marker only when every tag it names is on a commit already merged to main; if the merge is recent, run git fetch origin first. $rootHint"
                    exit 0
                }
            }
            exit 0
        }
        $tagHint = 'To push a tag of a commit already on origin/main, make the whole command cd "<absolute repo path>" && git push <remote> refs/tags/<tag> (or tag <tag>), with nothing else chained.'
        try { $expected = Get-PushReviewFingerprint $root } catch { $expected = $null }
        if (-not $expected) {
            Deny "Review gate: canonical branch fingerprint unavailable (missing base, no diff to review, or invalid history/evidence). Run /change-review after restoring origin/main; no working-tree fallback authorizes a push. $tagHint $rootHint"
        } elseif (-not (Test-ReviewGateMarker (Join-Path $root '.claude/.change-review-ok') $expected)) {
            Deny "Run /change-review before pushing -- the typed marker must match the committed branch content and ordered history. $tagHint $rootHint"
        }
        break
    }
    default {
        # An unknown verdict must not fall through to exit 0, which is allow. See the .sh twin.
        Deny 'Review gate: unrecognised classifier verdict, so this command cannot be checked. The hook and scripts/_review-gate-classify.ps1 are probably from different versions; run mb upgrade from the main worktree.'
    }
}
