# warn-stale-review-marker.ps1 -- PreToolUse hook for Write/Edit (PowerShell)
#
# WHY this exists: a review-gate marker (.claude/.code-review-ok or
# .claude/.change-review-ok) is bound to a SHA-256 hash of `git diff HEAD` (or
# `origin/main...HEAD`) taken at review time. Any edit to any tracked file
# changes that diff and silently invalidates the marker -- but the only place
# that currently notices is review-reminders.ps1, at the moment of the NEXT
# `git commit`/`git push` attempt, which can be many edits later. This hook
# surfaces that fact immediately, before the edit happens, instead of after.
#
# WHY warn-only, no permissionDecision/deny: the actual enforcement already
# exists and is airtight -- review-reminders.ps1 recomputes the hash fresh at
# commit/push time and denies on any mismatch. A present-but-stale marker is
# already rejected exactly the same as an absent one, so this hook adds zero
# new safety. It only makes visible, before the edit, what would otherwise
# only be discovered after a failed commit attempt.
#
# WHY additionalContext JSON, not a plain message: a PreToolUse hook's plain
# stdout never reaches the model and is not shown in the visible transcript
# (per Claude Code's docs), so the plain "Note:" this hook printed reached no
# one -- defeating its only purpose. additionalContext reaches the model (measured 2026-10-14).
# Model-only, no systemMessage: it is advice for the agent about to edit, and
# it fires on every edit while a marker exists.
#
# WHY no marker deletion: review-reminders.ps1's marker consumption is the
# sole writer/reader of these files, via an atomic rename specifically to
# avoid a TOCTOU race. Adding a second deletion path here would be a second
# writer to the same security-relevant file for zero safety benefit -- a
# stale marker is already functionally equivalent to no marker at all at
# enforcement time.
#
# WHY no per-file matching: the marker's hash covers the whole `git diff
# HEAD`/`origin/main...HEAD`, not a specific file list -- any tracked-file
# edit invalidates it, so checking whether THIS edit's file is "in the diff"
# would be solving a problem that doesn't exist. Marker presence alone is the
# entire condition -- this script does not inspect the edited file at all, so
# it also fires (harmlessly, since it's a warning) on edits outside the repo
# or to untracked files, which never actually touch the hashed diff.

param()

# WHY: same outer-trap-to-log convention as check-contract.ps1, so unexpected
# errors surface via `mb doctor` instead of silently vanishing.
trap {
    try { Add-Content ".pmb-hook-errors.log" "[$((Get-Date).ToString('yyyy-MM-dd HH:mm:ss', [cultureinfo]::InvariantCulture))] [HOOK] warn-stale-review-marker.ps1: $_" -ErrorAction SilentlyContinue } catch { Write-Verbose "Could not write .pmb-hook-errors.log; ignoring." }
    exit 0
}

$notes = @()
foreach ($marker in @(".claude/.code-review-ok", ".claude/.change-review-ok")) {
    if (Test-Path $marker) {
        $notes += "Note: $marker exists (an unconsumed review-gate marker). Editing now will invalidate it before commit/push -- if the last verdict was Approve, tell the user before editing further."
    }
}

# WHY one object even with both markers present: stdout must be nothing but one object, or Claude
# Code ignores it. [ordered] keeps the sh twin's key order, byte for byte.
if ($notes.Count -gt 0) {
    [ordered]@{
        hookSpecificOutput = [ordered]@{
            hookEventName     = "PreToolUse"
            additionalContext = ($notes -join ' ')
        }
    } | ConvertTo-Json -Compress | Write-Output
}

exit 0
