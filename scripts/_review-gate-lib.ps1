# scripts/_review-gate-lib.ps1 -- shared helpers for review-reminders.ps1 / review-reminders-post.ps1
# (PreToolUse / PostToolUse review-gate hook pair). Dot-sourced, not executed directly.
#
# WHY this file exists: Get-FileHashHex was duplicated verbatim in both hook files; the
# cd-chain-walk + JSON command extraction (~20 lines) was duplicated as raw inline code in
# both, never wrapped in a function at all; and review-reminders-post.ps1 never reused
# Get-CommitDiffHash/Get-PushDiffHash, instead inlining its own third, structurally
# duplicated copy of the same diff+hash pattern. See
# docs/superpowers/specs/2026-07-29-review-gate-hook-lib-dedup-design.md for the full design.
#
# WHY Resolve-CdRoot takes the already-parsed $cmd string as an explicit parameter, unlike
# bash's parameterless resolve_cd_root() (which relies on a caller-set global $input): both
# PowerShell hook files already parse $raw into $cmd near the top of the file
# (($raw | ConvertFrom-Json).tool_input.command) because their *own* subsequent case-matching
# ($cmd -match 'git\s+commit\b', etc.) operates on the parsed value, not the raw payload --
# unlike bash, PowerShell needs the parsed command string for reasons unrelated to
# root-resolution. Since the caller has already parsed $cmd for its own purposes before
# root-resolution runs, having Resolve-CdRoot re-parse the raw JSON internally would just be
# redundant, not a reduction in duplication. Taking $cmd as an explicit parameter is
# therefore the correct contract for PowerShell, not an inconsistency with bash's design --
# the two languages' surrounding scripts have genuinely different structure at this point.
#
# WHY resolve the FULL leading cd chain, not just the first cd: a chained command
# (`cd "A" && cd "B" && git commit ...`) must resolve to B's root, not A's, or a marker
# earned reviewing A wrongly authorizes a commit that actually runs in B. Reproduced
# directly against a previous single-match regex: it captured "A" and only "A" from that
# exact chained string. A single-quoted here-string (@'...'@) holds the pattern so both `"`
# and `'` can appear in it with no escaping, matching _review-gate-lib.sh's heredoc approach
# for the same reason.
function Resolve-CdRoot {
    param([string]$Cmd)
    $cdRoot = $null
    $chainPatternText = @'
^cd\s+(?:"([^"]+)"|'([^']+)')\s*&&\s*
'@
    $chainPattern = [regex]$chainPatternText
    $restCmd = $Cmd
    $curDir = (Get-Location).Path
    $matchedAny = $false
    while ($true) {
        $m = $chainPattern.Match($restCmd)
        if (-not $m.Success) { break }
        $matchedAny = $true
        $p = if ($m.Groups[1].Success) { $m.Groups[1].Value } else { $m.Groups[2].Value }
        $curDir = if ([System.IO.Path]::IsPathRooted($p)) { $p } else { [System.IO.Path]::GetFullPath((Join-Path $curDir $p)) }
        $restCmd = $restCmd.Substring($m.Length)
    }
    if ($matchedAny) {
        $candidate = git -C $curDir rev-parse --show-toplevel 2>$null
        if ($candidate) { $cdRoot = $candidate }
    }
    return $cdRoot
}

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

# WHY the empty-tree base: in a repo with no commits yet `git diff HEAD` fails with no output,
# so every first commit hashed to the empty-file constant and was denied. See commit_diff_hash in
# _review-gate-lib.sh for why the fallback is not narrowed further. The explicit empty-$base
# return matters here and not in bash: PowerShell drops an empty native argument, so
# `git diff $base` would silently become plain `git diff` (index vs working tree).
# WHY --no-ext-diff --no-textconv: see commit_diff_hash in _review-gate-lib.sh.
function Invoke-ReviewEvidenceCheck {
    param([string]$Source, [switch]$AllowMixed)
    & (Join-Path $PSScriptRoot 'review-evidence-check.ps1') -Source $Source -AllowMixed:$AllowMixed *> $null
    return $LASTEXITCODE -eq 0
}

function Get-CanonicalProductPatchHash {
    param([string[]]$Revisions, [switch]$Cached)
    $tmp = [System.IO.Path]::GetTempFileName()
    try {
        $gitArgs = @('-c', 'diff.relative=false', 'diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--binary', '--full-index', '--ignore-submodules=none', '--submodule=short')
        if ($Cached) { $gitArgs += '--cached' }
        $gitArgs += $Revisions
        $gitArgs += @('--', ':(top)**', ':(exclude,top)docs/review-log/invocations/*.json', ':(exclude,top)docs/review-log/*-code-review.md', ':(exclude,top)docs/review-log/*-change-review.md')
        & git @gitArgs > $tmp 2>$null
        if ($LASTEXITCODE -ne 0) { throw 'git diff failed' }
        if ((Get-Item $tmp).Length -eq 0) { return $null }
        return Get-FileHashHex $tmp
    } finally {
        Remove-Item $tmp -Force -ErrorAction SilentlyContinue
    }
}

# A gitlink change or a Git failure refuses before marker consumption. Dirty files alone do not.
function Test-CommitTouchesGitlink {
    param([string]$Root = (Get-Location).Path)
    try {
        $staged = @(& git -C $Root diff --cached --raw --no-ext-diff --no-renames --ignore-submodules=none 2>$null)
        if ($LASTEXITCODE -ne 0) { return $true }
        $unstaged = @(& git -C $Root diff --raw --no-ext-diff --no-renames --ignore-submodules=dirty 2>$null)
        if ($LASTEXITCODE -ne 0) { return $true }
        return [bool](@($staged + $unstaged) | Where-Object { $_ -match '^:(160000 [0-7]{6}|[0-7]{6} 160000) ' })
    } catch { return $true }
}

function Get-CommitReviewFingerprint {
    param([string]$Root = (Get-Location).Path)
    Push-Location -LiteralPath $Root
    try {
        $repoRoot = (& git rev-parse --show-toplevel 2>$null)
        if ($LASTEXITCODE -ne 0 -or -not $repoRoot) { throw 'missing repository root' }
        Set-Location -LiteralPath $repoRoot
        $parent = (& git rev-parse --verify HEAD 2>$null)
        $revisions = @('HEAD')
        if ($LASTEXITCODE -ne 0 -or -not $parent) {
            $branch = (& git symbolic-ref -q HEAD 2>$null)
            if ($LASTEXITCODE -ne 0 -or $branch -notmatch '^refs/heads/.+') { throw 'missing HEAD' }
            & git show-ref --verify --quiet $branch
            if ($LASTEXITCODE -ne 1) { throw 'invalid HEAD' }
            $format = (& git rev-parse --show-object-format=storage 2>$null)
            if ($LASTEXITCODE -ne 0) { throw 'unknown object format' }
            $parent = switch ($format) {
                'sha1' { '0' * 40 }
                'sha256' { '0' * 64 }
                default { throw 'unknown object format' }
            }
            $revisions = @()
        }
        if (-not (Invoke-ReviewEvidenceCheck index -AllowMixed)) { throw 'invalid staged evidence' }
        $hash = Get-CanonicalProductPatchHash -Revisions $revisions -Cached
        if (-not $hash) { throw 'empty product patch' }
        return "v2 commit $parent $hash"
    } finally { Pop-Location }
}

function Get-PushReviewFingerprint {
    param([string]$Root = (Get-Location).Path)
    Push-Location -LiteralPath $Root
    try {
        $repoRoot = (& git rev-parse --show-toplevel 2>$null)
        if ($LASTEXITCODE -ne 0 -or -not $repoRoot) { throw 'missing repository root' }
        Set-Location -LiteralPath $repoRoot
        $bases = @(& git merge-base --all origin/main HEAD 2>$null)
        if ($LASTEXITCODE -ne 0 -or $bases.Count -ne 1 -or -not $bases[0]) { throw 'missing or ambiguous merge base' }
        $base = $bases[0]
        $baseHash = Get-CanonicalProductPatchHash -Revisions @($base, 'HEAD')
        if (-not $baseHash) { throw 'empty product diff' }
        # First-parent order with a set check, as content_history() walks it, so a GitHub "Update
        # branch" merge yields the same ordered rows the containment check recomputes.
        $commits = @(& git rev-list --first-parent --reverse "$base..HEAD" 2>$null)
        if ($LASTEXITCODE -ne 0 -or $commits.Count -eq 0) { throw 'missing content history' }
        $allCommits = @(& git rev-list "$base..HEAD" 2>$null)
        if ($LASTEXITCODE -ne 0) { throw 'missing content history' }
        if ((@($commits | Sort-Object) -join ' ') -cne (@($allCommits | Sort-Object) -join ' ')) { throw 'history outside the first-parent chain' }
        $stream = [System.IO.Path]::GetTempFileName()
        try {
            [System.IO.File]::WriteAllBytes($stream, [byte[]]@())
            foreach ($commit in $commits) {
                $parents = (& git rev-list --parents -n 1 $commit 2>$null) -split ' '
                if ($LASTEXITCODE -ne 0) { throw 'invalid commit' }
                if ($parents.Count -eq 3) {
                    & (Join-Path $PSScriptRoot 'review-evidence-check.ps1') sync-merge $commit $base *> $null
                    if ($LASTEXITCODE -eq 0) { continue }
                }
                if ($parents.Count -ne 2) { throw 'merge or invalid commit' }
                if (-not (Invoke-ReviewEvidenceCheck $commit -AllowMixed)) { throw 'invalid committed evidence' }
                $hash = Get-CanonicalProductPatchHash -Revisions @($parents[1], $commit)
                if ($hash) {
                    $line = "$commit $($parents[1]) $hash`n"
                    $bytes = [System.Text.Encoding]::UTF8.GetBytes($line)
                    $file = [System.IO.File]::Open($stream, [System.IO.FileMode]::Append)
                    try { $file.Write($bytes, 0, $bytes.Length) } finally { $file.Dispose() }
                }
            }
            if ((Get-Item $stream).Length -eq 0) { throw 'empty content history' }
            $digest = Get-FileHashHex $stream
        } finally { Remove-Item $stream -Force -ErrorAction SilentlyContinue }
        return "v2 push $base $baseHash $digest"
    } finally { Pop-Location }
}

function Get-CommitDiffHash {
    $base = 'HEAD'
    git rev-parse -q --verify HEAD > $null 2>&1
    if ($LASTEXITCODE -ne 0) {
        $base = git hash-object -t tree /dev/null 2>$null
        if (-not $base) { return '' }
    }
    $tmp = [System.IO.Path]::GetTempFileName()
    try {
        git diff --no-ext-diff --no-textconv $base > $tmp 2>$null
        return Get-FileHashHex $tmp
    } finally {
        Remove-Item $tmp -Force -ErrorAction SilentlyContinue
    }
}

# WHY the four flags: see push_diff_hash in _review-gate-lib.sh.
function Get-PushDiffHash {
    $tmp = [System.IO.Path]::GetTempFileName()
    try {
        git diff --no-ext-diff --no-textconv --ignore-submodules=none --submodule=short origin/main...HEAD > $tmp 2>$null
        if ($LASTEXITCODE -ne 0) {
            git diff --no-ext-diff --no-textconv --ignore-submodules=none --submodule=short HEAD > $tmp 2>$null
        }
        return Get-FileHashHex $tmp
    } finally {
        Remove-Item $tmp -Force -ErrorAction SilentlyContinue
    }
}

# WHY this helper: review-reminders-post.ps1 reissues a review-ok marker (after a commit/push
# that consumed one then failed) by writing $Content directly to the marker path -- a plain
# Set-Content truncates-then-writes in place, which a concurrent reader racing to consume the
# same marker via Test-AndConsumeMarker's [System.IO.File]::Move could observe mid-write.
# Routes the write through the same mktemp-in-same-dir + File.Move pattern already established
# for the version cache (scripts/mb.ps1's Get-CachedPmbVersion) and the marker-consumption path
# itself (Test-AndConsumeMarker, above/in review-reminders.ps1) -- one helper instead of a third
# independent copy of the same fix, matching this file's own reason for existing.
#
# WHY no -NoNewline on the Set-Content call: this only changes HOW the write happens
# (atomically vs. in place), not WHAT gets written -- preserves the exact trailing-newline
# behavior of the `Get-CommitDiffHash | Set-Content (path)` pattern it replaces. Both
# consuming sides already strip all whitespace before comparing (bash's consume_marker() via
# `tr -d '[:space:]'`, PowerShell's Test-AndConsumeMarker via `.Trim()`), so this wouldn't
# have affected correctness either way -- but changing it would still be an unrelated,
# unrequested behavior change riding along with an atomicity fix.
function Write-MarkerAtomic {
    param([string]$Path, [string]$Content)
    $dir = Split-Path -Parent $Path
    $tmp = Join-Path $dir ([System.IO.Path]::GetRandomFileName())
    try {
        Set-Content -Path $tmp -Value $Content
        [System.IO.File]::Move($tmp, $Path, $true)
    } finally {
        if (Test-Path $tmp) { Remove-Item $tmp -Force -ErrorAction SilentlyContinue }
    }
}
