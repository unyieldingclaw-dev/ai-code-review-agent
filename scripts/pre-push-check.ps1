<#
.SYNOPSIS
    Pre-push git hook — full error and warning check before any push.
.DESCRIPTION
    Called by .git/hooks/pre-push. Runs six checks and blocks the push on
    errors; emits warnings but does not block on advisory issues.
    Fails open: unexpected errors print [HOOK ERROR] and allow the push.
#>

param()

$ErrorActionPreference = 'Continue'
$failed = $false

Write-Host ""
Write-Host "Pre-push checks" -ForegroundColor Cyan
Write-Host "===============" -ForegroundColor Cyan
Write-Host ""

try {

# Check 1: Unresolved merge conflicts (block)
$conflicts = git diff --name-only --diff-filter=U 2>&1
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
$dirty = git status --porcelain 2>&1
if ($dirty) {
    Write-Host "[WARN] Uncommitted changes in working tree:" -ForegroundColor Yellow
    $dirty | Select-Object -First 10 | ForEach-Object { Write-Host "       $_" -ForegroundColor Yellow }
    if ($dirty.Count -gt 10) { Write-Host "       ... and $($dirty.Count - 10) more" -ForegroundColor Yellow }
    Write-Host "       Commit or stash before pushing if these should be included." -ForegroundColor Yellow
    Write-Host ""
}

# Check 4: .gitattributes present (warn)
if (-not (Test-Path ".gitattributes")) {
    Write-Host "[WARN] No .gitattributes — line-ending normalization not enforced." -ForegroundColor Yellow
    Write-Host "       Create .gitattributes with '* text=auto eol=lf' to suppress CRLF warnings." -ForegroundColor Yellow
    Write-Host ""
} else {
    Write-Host "[OK]   .gitattributes present" -ForegroundColor Green
}

# Check 5: Possible secrets in commits being pushed (block)
# When a tracking ref exists, diff against it. When there is none (first push or
# untracked branch), scan all commits not yet on any known remote so first pushes
# are covered rather than silently skipped.
$remote = git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>&1
$hasUpstream = ($LASTEXITCODE -eq 0 -and $remote -notmatch 'fatal')
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
if ($hasUpstream) {
    $pushDiff = git diff "$remote..HEAD" 2>&1 | ForEach-Object {
        if ($_ -match '^\+\+\+ b/') { $inExcluded = $_ -match '^\+\+\+ b/(fixtures/|docs/)' }
        if (-not $inExcluded -and $_ -match '^\+[^+]') { $_ }
    }
} else {
    # WHY: --not --remotes finds every commit reachable from HEAD but not from any
    # remote-tracking ref — this is exactly the set of commits a first push would
    # send. --format="" suppresses commit headers; only the patch lines remain.
    $pushDiff = git log --not --remotes --format="" -p 2>&1 | ForEach-Object {
        if ($_ -match '^\+\+\+ b/') { $inExcluded = $_ -match '^\+\+\+ b/(fixtures/|docs/)' }
        if (-not $inExcluded -and $_ -match '^\+[^+]') { $_ }
    }
    if (-not $pushDiff) {
        Write-Host "[SKIP] Secret scan — no commits to push (all already on a remote)." -ForegroundColor DarkGray
        Write-Host ""
    }
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
$pushFileList = if ($hasUpstream) {
    git diff --name-only "$remote..HEAD" 2>&1
} else {
    git log --not --remotes --format="" --name-only 2>&1 | Where-Object { $_ -match '\S' } | Sort-Object -Unique
}
$pushFileList | ForEach-Object {
    if ($_ -and (Test-Path $_)) {
        $bytes = (Get-Item $_).Length
        if ($bytes -gt 512000) {
            $largeFiles += "$_ ($([math]::Round($bytes / 1KB)) KB)"
        }
    }
}
if ($largeFiles) {
    Write-Host "[WARN] Large files in push (>500 KB):" -ForegroundColor Yellow
    $largeFiles | ForEach-Object { Write-Host "       $_" -ForegroundColor Yellow }
    Write-Host "       Consider .gitignore or Git LFS for binary/generated files." -ForegroundColor Yellow
    Write-Host ""
}

# Check 7: mb validate (warn if mb available)
if (Get-Command mb -ErrorAction SilentlyContinue) {
    $validateOut = & mb validate 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[WARN] mb validate reported issues — memory bank may be inconsistent:" -ForegroundColor Yellow
        $validateOut | ForEach-Object { Write-Host "       $_" }
        Write-Host ""
    } else {
        Write-Host "[OK]   mb validate passed" -ForegroundColor Green
    }
} else {
    Write-Host "[SKIP] mb not in PATH — skipping mb validate." -ForegroundColor DarkGray
}

} catch {
    Write-Host "[HOOK ERROR] pre-push-check.ps1 failed: $_" -ForegroundColor Yellow
    Write-Host "Proceeding in fails-open mode." -ForegroundColor Yellow
    exit 0
}

Write-Host ""
if ($failed) {
    Write-Host "[BLOCKED] Push aborted. Fix the errors above, then push again." -ForegroundColor Red
    Write-Host ""
    exit 1
} else {
    Write-Host "[PASS] All pre-push checks passed." -ForegroundColor Green
    Write-Host ""
    exit 0
}
