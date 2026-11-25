# Standalone native pre-commit checks; the live hook is wired only in Bundle A.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_review-gate-lib.ps1')
function Refuse([string]$Message) { throw $Message }
function Test-MemoryBankFailure {
    param([string]$Message, [string[]]$Paths = @(), [string]$Advice = "memory-bank/ is edited and committed only in the main worktree. Unstage it here`n(git restore --staged memory-bank/), make the change in the main worktree, and commit it there.")
    $details = @($Message) + @($Paths | ForEach-Object { "    $_" }) + @($Advice)
    Refuse ($details -join "`n")
}
function Get-GitText([string[]]$GitArgs) {
    $result = & git @GitArgs
    if ($LASTEXITCODE -ne 0) { Refuse "git failed: $($GitArgs -join ' ')" }
    return ($result -join "`n")
}
try {
    $root = Get-GitText @('rev-parse', '--show-toplevel')
    Set-Location -LiteralPath $root
    # NUL records survive native output as a single string; split without trimming filenames.
    try {
        $staged = @((Get-GitText @('diff', '--cached', '--name-only', '--no-renames', '-z')) -split "`0" | Where-Object { $_.Length })
    } catch {
        Test-MemoryBankFailure 'could not list staged files, so the linked-worktree memory-bank/ check could not run.'
    }
    if ($staged -ccontains 'handoff.md') {
        Refuse "handoff.md is staged for commit. This file is ephemeral and must not be committed.`nRemove it from staging: git rm --cached handoff.md"
    }
    $mb = @($staged | Where-Object { $_ -imatch '^memory-bank/' })
    if ($mb.Count) {
        try {
            $gitDir = (Resolve-Path -LiteralPath (Get-GitText @('rev-parse', '--git-dir'))).Path
            $common = (Resolve-Path -LiteralPath (Get-GitText @('rev-parse', '--git-common-dir'))).Path
        } catch {
            Test-MemoryBankFailure 'memory-bank/ changes are staged, but this hook could not tell whether this is a linked worktree.' $mb
        }
        if ($gitDir -ne $common) {
            if (Test-Path -LiteralPath (Join-Path $gitDir 'MERGE_HEAD')) {
                try {
                    $merged = @((Get-GitText @('diff', '--cached', '--name-only', '--no-renames', '-z', 'MERGE_HEAD')) -split "`0")
                } catch {
                    Test-MemoryBankFailure 'a merge is in progress but MERGE_HEAD could not be compared, so memory-bank/ changes are refused.' $mb
                }
                $offending = @($mb | Where-Object { $merged -ccontains $_ })
                if ($offending.Count) {
                    Test-MemoryBankFailure "in this linked worktree's merge, these memory-bank/ files differ from the branch being merged (edited here, or combined by git from both sides):" $offending "Take the merged branch's version of each: git checkout MERGE_HEAD -- <path>`nAny memory-bank/ change of your own belongs in the main worktree."
                }
            } else {
                Test-MemoryBankFailure "memory-bank/ changes cannot be committed from a linked worktree (main worktree: $(Split-Path -Parent $common))." $mb
            }
        }
    }
    if ((Test-Path -LiteralPath '.claude/settings.json') -and
        -not ((Get-Content -LiteralPath '.claude/settings.json' -Raw) -match 'CLAUDE_AUTOCOMPACT_PCT_OVERRIDE')) {
        Write-Warning 'CLAUDE_AUTOCOMPACT_PCT_OVERRIDE not found in .claude/settings.json.'
        Write-Host 'Token budget auto-compaction may not be configured. Add it to avoid mid-task context loss.'
    }
    if (Test-Path -LiteralPath '.githooks/format-check') {
        $base = & git rev-parse -q --verify HEAD 2>$null
        if ($LASTEXITCODE -ne 0) {
            $empty = [IO.Path]::GetTempFileName()
            try { $base = Get-GitText @('hash-object', '-t', 'tree', $empty) }
            finally { [IO.File]::Delete($empty) }
        }
        try {
            $records = (Get-GitText @('diff-index', '--cached', '-z', '--no-renames', '--diff-filter=AMT', $base)) -split "`0"
        } catch {
            Refuse "could not list staged files, so the format check (.githooks/format-check) could not run.`nFix the git error above and commit again."
        }
        $paths = @()
        for ($i = 0; $i -lt $records.Count - 1; $i += 2) {
            if ($records[$i] -notmatch '^:[0-7]{6} ([0-7]{6}) ') { Refuse 'Malformed staged format-check record.' }
            if ($Matches[1] -in @('100644', '100755')) { $paths += $records[$i + 1] }
        }
        if ($paths.Count) {
            try { $before = Get-GitText @('write-tree') }
            catch { Refuse "could not record the staged tree before the format check.`nFix the git error above and commit again." }
            # Explicit binary stdin preserves NUL delimiters and UTF-8 filenames.
            $start = [Diagnostics.ProcessStartInfo]::new()
            $start.FileName = 'bash'
            if ([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT) {
                # Windows' bash.exe may be the WSL launcher, not Git's hook interpreter.
                $gitBash = [IO.Path]::GetFullPath((Join-Path (Get-GitText @('--exec-path')) '../../../bin/bash.exe'))
                if (Test-Path -LiteralPath $gitBash) { $start.FileName = $gitBash }
            }
            $start.ArgumentList.Add('.githooks/format-check')
            $start.UseShellExecute = $false
            $start.RedirectStandardInput = $true
            $process = [Diagnostics.Process]::Start($start)
            try {
                $bytes = [Text.Encoding]::UTF8.GetBytes(($paths -join "`0") + "`0")
                $process.StandardInput.BaseStream.Write($bytes, 0, $bytes.Length)
                $process.StandardInput.Close()
                $process.WaitForExit()
                if ($process.ExitCode -ne 0) {
                    Refuse "the format check (.githooks/format-check) failed with exit $($process.ExitCode), so the commit is refused.`nIts own output above says what to fix. Re-stage the fixed files and commit again."
                }
            } finally { $process.Dispose() }
            if ((Get-GitText @('write-tree')) -cne $before) {
                Refuse "the format check (.githooks/format-check) changed the staged files, so the checks above no longer cover them.`nAfter a plain git commit, review what is staged now (git diff --cached) and commit again; the checks then run on it.`nAfter git commit -a or git commit -- <path>, git has discarded what the script staged; only its edits on disk remain (git status)."
            }
        }
    }
    if (Test-CommitTouchesGitlink $root) { Refuse 'Review gate: a staged submodule pointer or checked-out submodule HEAD changed, or git failed; this commit is refused.' }
    if (Invoke-ReviewEvidenceCheck index) { exit 0 }
    $expected = Get-CommitReviewFingerprint
    $marker = Join-Path $root '.claude/.code-review-ok'
    if (-not (Test-Path -LiteralPath $marker -PathType Leaf) -or (Get-Item -Force -LiteralPath $marker).LinkType) { Refuse 'Code review authorization missing.' }
    $wanted = [Text.Encoding]::UTF8.GetBytes($expected + "`n")
    function Test-Marker([string]$Path) {
        return [Convert]::ToBase64String([IO.File]::ReadAllBytes($Path)) -ceq [Convert]::ToBase64String($wanted)
    }
    if (-not (Test-Marker $marker)) { Refuse 'Code review authorization stale or malformed.' }
    $claim = Join-Path (Split-Path $marker) ([IO.Path]::GetRandomFileName())
    [IO.File]::Move($marker, $claim)
    if (-not (Test-Marker $claim)) {
        # Keep the unique claim without overwriting a concurrent writer's marker.
        Refuse "Code review authorization changed during claim; retained at $claim"
    }
    [IO.File]::Delete($claim)
    exit 0
} catch {
    Write-Host "ERROR: $($_.Exception.Message)"
    exit 1
}