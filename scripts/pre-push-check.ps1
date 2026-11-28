<#
.SYNOPSIS
    Pre-push git hook — full error and warning check before any push.
.DESCRIPTION
    Called by .git/hooks/pre-push. Runs eight checks and blocks the push on
    errors; emits warnings but does not block on advisory issues.
    Parser and fingerprint errors fail closed.
#>

param()

$ErrorActionPreference = 'Stop'

# WHY three counters, not one flag: a check has three possible outcomes — it passed,
# it failed, or it could not run. The original model had only $failed, so both "warned"
# and "could not determine" rendered as success, and the summary printed
# "All pre-push checks passed" over the top of them. Four of the eight checks below are
# advisory and can never set $failed, so that summary was asserting a result it had not
# earned. $unknown exists specifically so a check that did not execute cannot be
# mistaken for one that passed.
$failed  = $false
$warned  = 0
$unknown = 0

# ENFORCE=true promotes warnings and unknowns to blocking. Default is advisory, matching
# templates/.github/workflows/memory-bank-size.yml — a gate that blocks on a stale
# template gets disabled within a week, so honesty is the default and enforcement opt-in.
# `-ceq` (case-SENSITIVE) deliberately: PowerShell's default `-eq` is case-insensitive, so
# `ENFORCE=True` would enforce here while bash's `[ "$ENFORCE" = "true" ]` would not —
# the same variable producing different gate behaviour per platform.
$enforce = if ($env:ENFORCE) { $env:ENFORCE -ceq 'true' } else { $false }

Write-Host ""
Write-Host "Pre-push checks" -ForegroundColor Cyan
Write-Host "===============" -ForegroundColor Cyan
Write-Host ""

try {
. (Join-Path $PSScriptRoot '_review-gate-lib.ps1')
function Deny-Push([string]$Reason) { throw "Review gate: $Reason" }
$content = 0
$tuples = 0
$pushPatch = @()
$pushFileList = @()
$headOid = & git rev-parse --verify HEAD 2>$null
if ($LASTEXITCODE -ne 0) { Deny-Push 'missing HEAD' }
$objectFormat = & git rev-parse --show-object-format 2>$null
if ($LASTEXITCODE -ne 0) { Deny-Push 'unknown object format' }
$oidLength = switch ($objectFormat) { 'sha1' { 40 } 'sha256' { 64 } default { Deny-Push 'unsupported object format' } }
$oidPattern = "^[0-9a-f]{$oidLength}$"
while ($null -ne ($tuple = [Console]::In.ReadLine())) {
    $fields = $tuple -split '\s+'
    if ($fields.Count -ne 4 -or $fields[0] -eq '') { Deny-Push 'malformed tuple' }
    $localRef, $localOid, $remoteRef, $remoteOid = $fields
    if ($tuple -cne "$localRef $localOid $remoteRef $remoteOid") { Deny-Push 'malformed tuple spacing' }
    if ($localOid -cnotmatch $oidPattern -or $remoteOid -cnotmatch $oidPattern) { Deny-Push 'invalid oid' }
    & git check-ref-format $remoteRef *> $null
    if ($LASTEXITCODE -ne 0) { Deny-Push 'invalid remote ref' }
    $tuples++
    if ($localOid -match '^0+$') {
        if ($localRef -cne '(delete)' -or $remoteOid -match '^0+$') { Deny-Push 'invalid deletion' }
        continue
    }
    & git check-ref-format $localRef *> $null
    if ($LASTEXITCODE -ne 0) { Deny-Push 'invalid local ref' }
    $resolved = & git rev-parse --verify $localRef 2>$null
    if ($LASTEXITCODE -ne 0 -or $resolved -cne $localOid) { Deny-Push 'local ref mismatch' }
    if ($localRef -clike 'refs/tags/*' -and $remoteRef -clike 'refs/tags/*') {
        & git symbolic-ref -q $localRef *> $null
        if ($LASTEXITCODE -eq 0) { Deny-Push 'symbolic tag' }
        & git --no-replace-objects merge-base --is-ancestor $localOid refs/remotes/origin/main 2>$null
        if ($LASTEXITCODE -ne 0) { Deny-Push 'tag target not merged to main' }
        continue
    }
    if ($localRef -cnotlike 'refs/heads/*' -or $remoteRef -cnotlike 'refs/heads/*') { Deny-Push 'unsupported refs' }
    $headRef = & git symbolic-ref -q HEAD 2>$null
    if ($LASTEXITCODE -ne 0) { Deny-Push 'detached HEAD' }
    if ($localRef -cne $headRef -or $localOid -cne $headOid) { Deny-Push 'non-HEAD source' }
    if ($remoteOid -notmatch '^0+$') {
        & git cat-file -e "$remoteOid^{commit}" 2>$null
        if ($LASTEXITCODE -ne 0) { Deny-Push 'unknown remote object' }
        & git merge-base --is-ancestor $remoteOid $localOid 2>$null
        if ($LASTEXITCODE -ne 0) { Deny-Push 'non-fast-forward update' }
    }
    if ($localOid -ceq $remoteOid) { continue }
    $contentOid = $localOid
    $content++
    if ($content -ne 1) { Deny-Push 'multiple content refs' }
    $range = if ($remoteOid -match '^0+$') { $localOid } else { "$remoteOid..$localOid" }
    $pushPatch = @(& git log $range --format= -p 2>$null)
    if ($LASTEXITCODE -ne 0) { Deny-Push 'history scan failed' }
    $pushFileList = @(& git log $range --format= --name-only 2>$null)
    if ($LASTEXITCODE -ne 0) { Deny-Push 'file scan failed' }
}
if ($tuples -eq 0) { Deny-Push 'empty stdin' }


# Check 1: Unresolved merge conflicts (block)
$conflicts = git diff --name-only --diff-filter=U 2>$null
if ($conflicts) {
    Write-Host "[ERROR] Unresolved merge conflicts:" -ForegroundColor Red
    $conflicts | ForEach-Object { Write-Host "        $_" -ForegroundColor Red }
    $failed = $true
    Write-Host ""
}

# Check 2: Conflict markers in tracked files (block)
# WHY: git grep --cached finds <<< markers staged for commit, catching conflicts
# that slipped through without being flagged by --diff-filter=U.
$null = git grep -l "^<<<<<<< " --cached 2>&1
if ($LASTEXITCODE -eq 0) {
    $markerFiles = git grep -l "^<<<<<<< " --cached 2>&1
    Write-Host "[ERROR] Conflict markers found in staged files:" -ForegroundColor Red
    $markerFiles | ForEach-Object { Write-Host "        $_" -ForegroundColor Red }
    $failed = $true
    Write-Host ""
}

# Check 3: Uncommitted changes in working tree (warn)
$dirty = git status --porcelain 2>$null
if ($dirty) {
    Write-Host "[WARN] Uncommitted changes in working tree:" -ForegroundColor Yellow
    $dirty | Select-Object -First 10 | ForEach-Object { Write-Host "       $_" -ForegroundColor Yellow }
    if ($dirty.Count -gt 10) { Write-Host "       ... and $($dirty.Count - 10) more" -ForegroundColor Yellow }
    Write-Host "       Commit or stash before pushing if these should be included." -ForegroundColor Yellow
    $warned++
    Write-Host ""
}

# Check 4: .gitattributes present (warn)
if (-not (Test-Path ".gitattributes")) {
    Write-Host "[WARN] No .gitattributes — line-ending normalization not enforced." -ForegroundColor Yellow
    Write-Host "       Create .gitattributes with '* text=auto eol=lf' to suppress CRLF warnings." -ForegroundColor Yellow
    $warned++
    Write-Host ""
} else {
    Write-Host "[OK]   .gitattributes present" -ForegroundColor Green
}

# Check 5: Possible secrets in commits being pushed (block)
# Scan the actual outgoing commit range; a new branch scans its full reachable history.
$secretPatterns = @(
    @{ label = "AWS access key";            pattern = 'AKIA[0-9A-Z]{16}' }
    @{ label = "OpenAI/Anthropic API key";  pattern = 'sk-[a-zA-Z0-9]{32,}' }
    @{ label = "GitHub personal token";     pattern = 'ghp_[a-zA-Z0-9]{36}' }
    @{ label = "Generic password assignment"; pattern = 'password\s*=\s*["\x27][^"\x27\s]{8,}' }
    @{ label = "Generic secret assignment";  pattern = 'secret\s*=\s*["\x27][^"\x27\s]{8,}' }
)
# WHY: fixtures/security/ and docs/ are excluded from secret scanning:
# fixtures/security/ intentionally contains vulnerable code for regression testing;
# docs/ (specs, plans) may quote fixture content as documentation examples.
$inExcluded = $false
$pushDiff = $pushPatch | ForEach-Object {
    if ($_ -match '^\+\+\+ b/') { $inExcluded = $_ -match '^\+\+\+ b/(fixtures/|docs/)' }
    if (-not $inExcluded -and $_ -match '^\+[^+]') { $_ }
}
foreach ($entry in $secretPatterns) {
    $hits = $pushDiff | Where-Object { $_ -match $entry.pattern }
    if ($hits) {
        Write-Host "[ERROR] Possible $($entry.label) in push diff:" -ForegroundColor Red
        $hits | Select-Object -First 3 | ForEach-Object { Write-Host "        $_" -ForegroundColor Red }
        $failed = $true
        Write-Host ""
    }
}

# Check 6: Files over 500 KB in push (warn)
$largeFiles = @()
$pushFileList | ForEach-Object {
    if ($_ -and (Test-Path $_)) {
        $bytes = (Get-Item -Force -LiteralPath $_).Length
        if ($bytes -gt 512000) {
            $largeFiles += "$_ ($([math]::Round($bytes / 1KB)) KB)"
        }
    }
}
if ($largeFiles) {
    Write-Host "[WARN] Large files in push (>500 KB):" -ForegroundColor Yellow
    $largeFiles | ForEach-Object { Write-Host "       $_" -ForegroundColor Yellow }
    Write-Host "       Consider .gitignore or Git LFS for binary/generated files." -ForegroundColor Yellow
    $warned++
    Write-Host ""
}

# Check 7: memory-bank integrity via mb doctor
#
# WHY this no longer calls `mb validate`: that command was deprecated into `mb doctor` and
# now resolves to a shim that prints a redirect notice and exits 2 (measured, not assumed).
# The old check treated any non-zero $LASTEXITCODE as a memory-bank problem, so every push in
# every managed project emitted "[WARN] mb validate reported issues — memory bank may be
# inconsistent:" and then quoted the redirect notice underneath it as though that were the
# evidence. Nothing could clear it: the warning did not describe the memory bank at all, and
# it was immediately followed by "[PASS] All pre-push checks passed" — a self-contradicting
# gate. Observed on ai-code-review-agent, which is pinned at PMB 1.1.1 and still runs the old
# check. An exit code cannot distinguish "ran and passed" from "ran and failed" from "never
# ran" — that is the general trap, and every deprecated alias inherits it.
#
# WHY the verdict is parsed from output rather than taken from an exit code: doctor exits 1
# only for a FATAL finding; its advisory [ERROR] lines (checksum mismatch, startup-context
# ceiling) leave the exit code at 0, so the exit code cannot carry the verdict this check
# reports. Its output is structured — every check emits [OK], [WARN] or [ERROR] — so
# counting those lines yields both the verdict AND a positive assertion that the command
# actually ran. Zero result lines means no checks executed (deprecated shim, crash, missing
# binary, or an mb.ps1 old enough to reject --check), which is UNKNOWN, never success.
# Measured: a real run emits ~51 result lines; the shim emits 0.
#
# WHY `--check`, and why the marker is required: plain `mb doctor` rewrites .pmb-checksums at
# the end of every run, so calling it here re-baselined on every push — a memory-bank
# mismatch was reported once, by the run that then erased it. `--check` compares without
# writing, and confirms so with a fixed ASCII marker line. An mb.sh that predates --check
# (reached from here via install.sh's launcher when pwsh runs on Linux/macOS) ignores the
# flag and rewrites silently; the missing marker is how that run is caught, as UNKNOWN.
#
# WHY the checksum mismatch gets its own line: it would otherwise be folded into the generic
# error count and can fall outside the first-five echo. It counts as a warning, so
# ENFORCE=true blocks until the mismatch is accepted with `mb verify-integrity`.
if (Get-Command mb -ErrorAction SilentlyContinue) {
    $doctorOut = (& mb doctor --check 2>&1 | Out-String)
    $doctorLines = $doctorOut -split "`r?`n"
    # Count LINES carrying a marker, not marker occurrences — bash uses `grep -c`, which is
    # line-based. Counting matches here would double-count any line bearing two markers and
    # silently diverge from the POSIX path.
    $resultLines = ($doctorLines | Where-Object { $_ -match '\[(OK|WARN|ERROR)\]' }).Count
    if ($resultLines -eq 0) {
        Write-Host "[UNKNOWN] mb doctor produced no check results — memory bank NOT verified." -ForegroundColor Yellow
        Write-Host "          The command ran but emitted no [OK]/[WARN]/[ERROR] lines."
        # WHY the fix names the clone, not just `mb upgrade`: upgrade copies templates FROM the
        # PMB clone behind `mb` (MB_HOME), so run from an outdated clone it reinstalls the old
        # hook — clearing this message by bringing back the silent re-baseline.
        Write-Host "          One cause: an mb older than this hook, which rejects --check."
        Write-Host "          Fix: update the PMB clone that MB_HOME points at, then run: mb upgrade"
        $unknown++
        Write-Host ""
    } else {
        # .Contains / -cmatch rather than -match: grep in the POSIX twin is case-sensitive, and
        # PowerShell's -match is not, so -match would let the twins disagree on the same output.
        $checkModeSeen = [bool]($doctorLines | Where-Object { $_.Contains('Integrity check mode:') })
        if (-not $checkModeSeen) {
            Write-Host "[UNKNOWN] mb doctor did not confirm check mode — integrity NOT verified." -ForegroundColor Yellow
            Write-Host "          The mb on PATH predates 'doctor --check' and may have re-baselined .pmb-checksums."
            Write-Host "          Fix: update the PMB clone that MB_HOME points at, then run: mb upgrade"
            $unknown++
            Write-Host ""
        }
        $mismatchLines = @($doctorLines | Where-Object { $_ -cmatch '\[ERROR\].*hash mismatch' })
        $otherErrors = @($doctorLines | Where-Object { $_ -cmatch '\[ERROR\]' -and $_ -cnotmatch 'hash mismatch' })
        if ($mismatchLines.Count -gt 0) {
            Write-Host "[WARN] memory-bank changed since the last accepted integrity baseline: $($mismatchLines.Count) file(s)" -ForegroundColor Yellow
            $mismatchLines | ForEach-Object { Write-Host "       $($_.Trim())" }
            Write-Host "       Review the changes, then accept them with: mb verify-integrity"
            $warned++
            Write-Host ""
        }
        if ($otherErrors.Count -gt 0) {
            Write-Host "[WARN] mb doctor reported $($otherErrors.Count) error(s) across $resultLines result lines:" -ForegroundColor Yellow
            $otherErrors | Select-Object -First 5 | ForEach-Object { Write-Host "       $($_.Trim())" }
            $warned++
            Write-Host ""
        }
        if ($doctorLines | Where-Object { $_.Contains('Integrity checksums: no baseline') }) {
            # INFO, not a warning: a fresh clone or worktree has no baseline (.pmb-checksums is
            # gitignored) and --check never creates one, so counting it would warn — and with
            # ENFORCE, block — on every push until someone ran a command unrelated to the push.
            Write-Host "[INFO] No memory-bank integrity baseline yet — run 'mb verify-integrity' to start tracking edits."
            Write-Host ""
        }
        if ($checkModeSeen -and $mismatchLines.Count -eq 0 -and $otherErrors.Count -eq 0) {
            # "result lines", not "checks": this counts emitted [OK]/[WARN]/[ERROR] markers,
            # which exceeds the number of named doctor checks. Claiming a check count this
            # figure does not represent would repeat the unearned-assertion bug being fixed.
            Write-Host "[OK]   mb doctor: $resultLines result lines, no errors" -ForegroundColor Green
        }
    }
} else {
    Write-Host "[UNKNOWN] mb not in PATH — memory bank NOT verified." -ForegroundColor Yellow
    $unknown++
}

# Check 8: review-evidence containment, the check CI's Trusted Review Containment job runs.
# WHY: see Check 8 in pre-push-check.sh. Not being able to run it is UNKNOWN, never a pass.
if ($content -eq 1) {
    $evidencePython = (Get-Command python3 -ErrorAction SilentlyContinue) ?? (Get-Command python -ErrorAction SilentlyContinue)
    $shallow = & git rev-parse --is-shallow-repository 2>$null
    & git rev-parse --verify -q refs/remotes/origin/main *> $null
    $hasOriginMain = $LASTEXITCODE -eq 0
    if (-not $evidencePython) {
        Write-Host "[UNKNOWN] Review evidence NOT checked: Python is not on PATH (CI checks it only where the repo runs a containment job)." -ForegroundColor Yellow
        $unknown++
    } elseif ($shallow -cne 'false') {
        Write-Host "[UNKNOWN] Review evidence NOT checked: the clone is shallow (CI checks it only where the repo runs a containment job)." -ForegroundColor Yellow
        $unknown++
    } elseif (-not $hasOriginMain) {
        Write-Host "[UNKNOWN] Review evidence NOT checked: no origin/main to compare against (CI checks it only where the repo runs a containment job)." -ForegroundColor Yellow
        $unknown++
    } else {
        $evidenceOut = & (Join-Path $PSScriptRoot 'review-evidence-check.ps1') contain refs/remotes/origin/main $contentOid 2>&1 | Out-String
        if ($LASTEXITCODE -eq 0) {
            Write-Host "[OK]   Review evidence covers every commit since origin/main" -ForegroundColor Green
        } else {
            Write-Host "[ERROR] Review evidence does not cover this push:" -ForegroundColor Red
            foreach ($line in ($evidenceOut.TrimEnd() -split "`r?`n")) { Write-Host "        $line" }
            Write-Host "        If a commit changed after its /code-review (amend, rebase, squash), review it again."
            Write-Host "        Otherwise run /change-review on this branch and commit its record before pushing."
            Write-Host "        If main moved since your last fetch, run: git fetch origin main, then push again."
            $failed = $true
        }
    }
    Write-Host ""
}

# Spend approval only after every blocking health check.
if (-not $failed -and (-not $enforce -or ($unknown -eq 0 -and $warned -eq 0)) -and $content -eq 1) {
    $expected = Get-PushReviewFingerprint
    $currentHead = & git rev-parse --verify HEAD 2>$null
    if ($LASTEXITCODE -ne 0 -or $currentHead -cne $contentOid) { Deny-Push 'HEAD changed during checks' }
    $marker = Join-Path (Get-Location) '.claude/.change-review-ok'
    $claim = Join-Path (Split-Path $marker) ([IO.Path]::GetRandomFileName())
    if ([IO.File]::ReadAllText($marker) -cne ($expected + [char]10)) { Deny-Push 'stale or wrong-type marker' }
    [IO.File]::Move($marker, $claim)
    $actual = [IO.File]::ReadAllText($claim)
    if ($actual -cne ($expected + [char]10)) { Deny-Push "marker changed during claim; retained at $claim" }
    [IO.File]::Delete($claim)
}
} catch {
    Write-Host "[BLOCKED] pre-push-check failed: $_" -ForegroundColor Red
    exit 1
}
# WHY the summary distinguishes three states: "[PASS] All pre-push checks passed" may
# only print when every check actually passed. Previously it printed whenever no
# BLOCKING check failed, so it appeared directly beneath warnings it contradicted, and
# beneath a check that had not run at all. A summary that cannot express "warned" or
# "could not verify" will always overstate the result.
if ($failed) {
    Write-Host "[BLOCKED] Push aborted. Fix the errors above, then push again." -ForegroundColor Red
    Write-Host ""
    exit 1
} elseif ($unknown -ne 0) {
    Write-Host "[DEGRADED] $unknown check(s) could not run; $warned warning(s). Not all checks were verified." -ForegroundColor Yellow
    if ($enforce) {
        Write-Host "           ENFORCE=true — treating unverified checks as blocking." -ForegroundColor Red
        Write-Host ""
        exit 1
    }
    Write-Host ""
    exit 0
} elseif ($warned -ne 0) {
    Write-Host "[PASS with $warned warning(s)] No blocking issues; review the warnings above." -ForegroundColor Yellow
    if ($enforce) {
        Write-Host "           ENFORCE=true — treating warnings as blocking." -ForegroundColor Red
        Write-Host ""
        exit 1
    }
    Write-Host ""
    exit 0
} else {
    Write-Host "[PASS] All pre-push checks passed." -ForegroundColor Green
    Write-Host ""
    exit 0
}
