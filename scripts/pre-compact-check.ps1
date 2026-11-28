<#
.SYNOPSIS
    PreCompact hook -- a no-op outside journal mode.
.DESCRIPTION
    Journal mode (when this repository has opted in) runs its own gate. Otherwise this hook
    allows compaction: see docs/superpowers/specs/2026-11-01-derived-work-rules-and-compaction-recovery-design.md, D1'.
    Its former "progress.md dated today" check was, in PMB's and the template's banks, the only
    one that could fail; it forced a daily
    progress.md write, and reported only to the user. Recovery now happens after compaction via
    the SessionStart(compact) hook scripts/codex-compaction-hook.ps1.
    Fails open on unexpected errors (exits 0) and logs to .pmb-hook-errors.log.
#>

param()

try {
    # Journal mode -- docs/superpowers/specs/2026-09-26-multi-session-memory-design.md section 4.3.
    # When this repository has opted in (.pmb-features on refs/remotes/origin/main) AND this branch
    # carries scripts/pmb-journal.ps1, the gate checks this session's own journal. Otherwise (or on
    # an adopter or older branch without the script) compaction is allowed.
    # WHY this twin needs the branch at all: Claude Code runs this .ps1 hook, not the .sh one,
    # wherever pwsh is on PATH, so the .sh hook's own delegation never runs on such a machine.
    # WHY detection has its own try: an exception while merely detecting journal mode (git
    # missing; a profile setting $ErrorActionPreference='Stop') means "not journal mode", not a
    # hook error to log. Section 4.1 says a missing file, missing ref or read error means the flag
    # is off, with no output into context; `mb doctor` reporting it is a backlog item
    # (docs/backlog/review-findings.md).
    $pmbJournal = $false
    if (Test-Path -LiteralPath 'scripts/pmb-journal.ps1' -PathType Leaf) {
        try { . ./scripts/pmb-journal.ps1; $pmbJournal = [bool](Test-PmbFlagOn) } catch { $pmbJournal = $false }
    }
    # Once journal mode applies, Invoke-PmbGate returns 2 only for its named block conditions, and
    # any exception it throws reaches the catch below and fails open -- section 4.3's rule.
    if ($pmbJournal) { exit (Invoke-PmbGate -Payload (Read-PmbStdin)) }

    exit 0
} catch {
    Write-Host "[HOOK ERROR] pre-compact-check.ps1 failed unexpectedly. Proceeding in fails-open mode."
    try { Add-Content ".pmb-hook-errors.log" "[$((Get-Date).ToString('yyyy-MM-dd HH:mm:ss', [cultureinfo]::InvariantCulture))] [HOOK] pre-compact-check.ps1: $_" -ErrorAction SilentlyContinue } catch { Write-Verbose "Could not write .pmb-hook-errors.log; ignoring." }
    exit 0
}
