# Decide whether a payload the classifier already labelled MERGE may be put to the user.
#
# Dot-sourced by review-reminders.ps1 only after the classifier returned MERGE. The PowerShell
# twin of _review-gate-merge.py: the two must agree on every fixture in tests/test-merge-gate.sh,
# and the WHY for each rule lives in that file's comments -- not repeated here.
#
# Returns @{ Decision = 'ASK' | 'DENY'; Reason; Audit; Cause }. The hook treats anything other
# than Decision -ceq 'ASK' -- including a throw or this file failing to load -- as deny.
#
# Every comparison is case-exact and ordinal, as in the Python twin: -cmatch for patterns and
# [string]::Equals(..., Ordinal) for equality. Never -eq or -contains (case-insensitive), and never
# -ceq or -ccontains either: they are culture-aware, so a key or value with a zero-width or other
# ignorable character appended compares equal (measured 2026-10-23, PowerShell 7). ConvertFrom-Json
# property access is case-insensitive too, so payload keys are looked up through
# Get-MergeGateProperty.

$script:MergeGateModes = @('default', 'acceptEdits', 'auto')
$script:MergeGateDescription = 'Merge pull request (verify the details in the hook reason)'
$script:MergeGateGenericDeny = "Merge gate precondition failed. Ask the user to check this checkout's Claude settings."
$script:MergeGateGhEnv = @('GH_HOST', 'GH_REPO', 'GH_CONFIG_DIR')
# The same strings as WS and END in the .py twin, used instead of \s, \b and -match's IgnoreCase,
# which differ between .NET and Python.
$script:MergeGateWs = '[\t\n\x0b\x0c\r\x1c-\x20\x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]'
# The same set as characters, as WS_CHARS in the .py twin (WHY there: a regex strip is quadratic).
$script:MergeGateWsChars = [char[]](@(0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x1c, 0x1d, 0x1e, 0x1f, 0x20, 0x85, 0xa0, 0x1680) + (0x2000..0x200a) + @(0x2028, 0x2029, 0x202f, 0x205f, 0x3000))
$script:MergeGateEnd = '(?![A-Za-z0-9_])'
# The same limits as MAX_REPOS, MAX_RULE_LENGTH and GLOB_BUDGET in the .py twin, with the WHY there.
$script:MergeGateMaxRepos = 10
$script:MergeGateMaxRuleLength = 4096
$script:MergeGateGlobBudget = 200000

function ConvertFrom-MergeGateJson {
    param([string]$Text)
    # ConvertFrom-Json alone also accepts comments, trailing commas, NaN, single quotes and bare
    # keys (measured, PowerShell 7.6), so System.Text.Json validates first. -NoEnumerate and the
    # comma keep a one-element JSON array an array; enumerated, it read as the object inside it.
    $options = [System.Text.Json.JsonDocumentOptions]::new()
    $options.MaxDepth = 1024
    [System.Text.Json.JsonDocument]::Parse($Text, $options).Dispose()
    $parsed = $Text | ConvertFrom-Json -NoEnumerate -ErrorAction Stop
    return , $parsed
}

function Get-MergeGateTrimmedText {
    param([string]$Text)
    $Text.Trim($script:MergeGateWsChars)
}

function ConvertTo-MergeGateAsciiLower {
    # ASCII letters only, as ASCII_LOWER in the .py twin; ToLowerInvariant would also fold the
    # Kelvin sign to k. Replace(char, char) is ordinal, and 26 native calls cost far less than the
    # scriptblock per upper-case letter a [regex]::Replace evaluator ran.
    param([string]$Text)
    for ($c = 65; $c -le 90; $c++) { $Text = $Text.Replace([char]$c, [char]($c + 32)) }
    $Text
}

function Get-MergeGateProbeCommand {
    param([string[]]$Repos)
    $zero = '0' * 40
    $probes = @('gh pr merge 1 --squash')
    foreach ($r in $Repos) {
        $probes += "gh pr merge 1 -R $r --squash --match-head-commit $zero"
        $probes += "gh pr merge 1 -R $r --merge --match-head-commit $zero"
        $probes += "gh api -X PUT repos/$r/pulls/1/merge"
        $probes += "gh -R $r pr merge 1 --squash"
    }
    $probes
}

function Test-MergeGateGlob {
    # Step for step the .py twin's glob_matches. Characters compare as code units, never with
    # -ceq, which is culture-aware.
    param([string]$Body, [string]$Command, [hashtable]$Budget)
    if ($Body.EndsWith(':*', [System.StringComparison]::Ordinal)) { $Body = $Body.Substring(0, $Body.Length - 2) + ' *' }
    $i = 0; $j = 0; $star = -1; $mark = 0
    while ($j -lt $Command.Length) {
        $Budget.Steps--
        if ($Budget.Steps -lt 0) { return $true }
        if ($i -lt $Body.Length -and [int]$Body[$i] -eq 42) { $star = $i; $mark = $j; $i++ }
        elseif ($i -lt $Body.Length -and [int]$Body[$i] -eq [int]$Command[$j]) { $i++; $j++ }
        elseif ($star -ge 0) { $i = $star + 1; $mark++; $j = $mark }
        else { return $false }
    }
    while ($i -lt $Body.Length -and [int]$Body[$i] -eq 42) { $i++ }
    return ($i -eq $Body.Length)
}

function Get-MergeGateProperty {
    param($Object, [string]$Name)
    if ($null -eq $Object -or $Object -isnot [System.Management.Automation.PSCustomObject]) {
        return [pscustomobject]@{ Present = $false; Value = $null }
    }
    $prop = @($Object.PSObject.Properties | Where-Object { [string]::Equals($_.Name, $Name, [System.StringComparison]::Ordinal) })
    if ($prop.Count -eq 0) { return [pscustomobject]@{ Present = $false; Value = $null } }
    [pscustomobject]@{ Present = $true; Value = $prop[0].Value }
}

function Get-MergeGateDenial {
    param([string]$Reason, [string]$Cause)
    [pscustomobject]@{ Decision = 'DENY'; Reason = $Reason; Audit = $null; Cause = $Cause }
}

function Test-MergeGateCapableRule {
    param([string]$Rule, [string[]]$Probes = @(), [hashtable]$Budget = @{ Steps = $script:MergeGateGlobBudget })
    if ($Rule.Length -gt $script:MergeGateMaxRuleLength) { return $true }
    $ws = $script:MergeGateWs; $end = $script:MergeGateEnd
    $r = Get-MergeGateTrimmedText $Rule
    if ($r -cnotmatch '(?s)\A(Bash|PowerShell)(?:\((.*)\))?\z') { return $false }
    if (-not $Matches.ContainsKey(2)) { return $true }
    $tool = $Matches[1]
    $body = Get-MergeGateTrimmedText $Matches[2]
    # Both sides, for a PowerShell rule only (WHY in the .py twin's merge_capable).
    if ([string]::Equals($tool, 'PowerShell', [System.StringComparison]::Ordinal)) {
        $body = ConvertTo-MergeGateAsciiLower $body
        $Probes = @(foreach ($p in $Probes) { ConvertTo-MergeGateAsciiLower $p })
    }
    if ([string]::Equals($body, '*', [System.StringComparison]::Ordinal) -or [string]::Equals($body, ':*', [System.StringComparison]::Ordinal)) { return $true }
    if ($body -cmatch ('\Agh(?:' + $ws + '*\*|:\*)?\z')) { return $true }
    if ($body -cmatch ('\Agh' + $ws + '+(?:api' + $end + '|-)')) { return $true }
    if ($body -cmatch ('\Agh' + $ws + '+pr(?:' + $ws + '*\*|:\*)\z') -or $body -cmatch ('\Agh' + $ws + '+pr' + $ws + '+merge' + $end)) { return $true }
    foreach ($p in $Probes) { if (Test-MergeGateGlob $body $p $Budget) { return $true } }
    if (-not $body.Contains('*')) { return $false }
    $interp = '\A(?:python3?|py|node|pwsh|powershell|bash|sh|cmd)(?:\.exe)?(?:' + $ws + '.*)?' + $ws + '(?:-c|-e|--eval|-command|-encodedcommand|/c)' + $end
    return ((ConvertTo-MergeGateAsciiLower $body) -cmatch $interp)
}

function Get-MergeGateSettingsFile {
    param([string]$ProjectDir)
    $config = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $HOME '.claude' }
    @(
        (Join-Path $config 'settings.json'),
        (Join-Path (Join-Path $ProjectDir '.claude') 'settings.json'),
        (Join-Path (Join-Path $ProjectDir '.claude') 'settings.local.json')
    )
}

function Get-ReviewGateMergeDecision {
    param([string]$Raw, [string]$ProjectDir)

    # -NoEnumerate, as in ConvertFrom-MergeGateJson: enumerated, a one-element array payload read
    # as the object inside it and asked, where the .py twin denies.
    $payload = $Raw | ConvertFrom-Json -NoEnumerate -ErrorAction Stop
    if ($payload -isnot [System.Management.Automation.PSCustomObject]) {
        return Get-MergeGateDenial $script:MergeGateGenericDeny 'payload is not a JSON object'
    }
    if ((Get-MergeGateProperty $payload 'agent_id').Present) {
        return Get-MergeGateDenial 'Subagents never merge pull requests. Ask the user, in the main conversation.'
    }
    $mode = (Get-MergeGateProperty $payload 'permission_mode').Value
    if ($mode -isnot [string] -or -not ($script:MergeGateModes | Where-Object { [string]::Equals($_, $mode, [System.StringComparison]::Ordinal) })) {
        return Get-MergeGateDenial 'Merges are only put to the user in default, acceptEdits or auto mode; this session cannot show a prompt for it. Merge in the GitHub UI instead.'
    }
    foreach ($name in $script:MergeGateGhEnv) {
        if (Test-Path "Env:$name") {
            return Get-MergeGateDenial $script:MergeGateGenericDeny 'GH_HOST, GH_REPO or GH_CONFIG_DIR is set in the hook environment'
        }
    }

    # The allowlist is read first, because the settings check probes each allow rule with it.
    $notConfigured = "Merge gate is not configured: .claude/merge-gate.json must list ""repos"" as 1 to $($script:MergeGateMaxRepos) owner/repo strings. Merge in the GitHub UI instead."
    try {
        $config = ConvertFrom-MergeGateJson (Get-Content -LiteralPath (Join-Path (Join-Path $ProjectDir '.claude') 'merge-gate.json') -Raw -ErrorAction Stop)
    } catch {
        return Get-MergeGateDenial 'Merge gate is not configured: .claude/merge-gate.json is missing or malformed, so no repository is allowed. Merge in the GitHub UI instead.'
    }
    $repos = (Get-MergeGateProperty $config 'repos').Value
    if ($repos -isnot [System.Array] -or $repos.Count -eq 0 -or $repos.Count -gt $script:MergeGateMaxRepos) { return Get-MergeGateDenial $notConfigured }
    foreach ($r in $repos) {
        if ($r -isnot [string] -or $r -cnotmatch '\A[A-Za-z0-9_.-]{1,100}/[A-Za-z0-9_.-]{1,100}\z') { return Get-MergeGateDenial $notConfigured }
    }
    $probes = Get-MergeGateProbeCommand $repos
    $budget = @{ Steps = $script:MergeGateGlobBudget }
    $kept = [System.Collections.Generic.List[object]]::new()

    foreach ($path in (Get-MergeGateSettingsFile $ProjectDir)) {
        if (-not (Test-Path -LiteralPath $path)) { continue }
        try {
            $data = ConvertFrom-MergeGateJson (Get-Content -LiteralPath $path -Raw -ErrorAction Stop)
        } catch {
            return Get-MergeGateDenial $script:MergeGateGenericDeny "unreadable or malformed settings: $path"
        }
        if ($data -isnot [System.Management.Automation.PSCustomObject]) {
            return Get-MergeGateDenial $script:MergeGateGenericDeny "settings is not a JSON object: $path"
        }
        $hooks = (Get-MergeGateProperty $data 'hooks').Value
        if ($null -ne $hooks) {
            if ($hooks -isnot [System.Management.Automation.PSCustomObject]) {
                return Get-MergeGateDenial $script:MergeGateGenericDeny "hooks is not an object: $path"
            }
            $pr = (Get-MergeGateProperty $hooks 'PermissionRequest').Value
            if ($null -ne $pr -and -not ($pr -is [System.Array] -and $pr.Count -eq 0)) {
                return Get-MergeGateDenial $script:MergeGateGenericDeny "PermissionRequest hook configured: $path"
            }
        }
        $perms = (Get-MergeGateProperty $data 'permissions').Value
        # Assigned directly: `$allow = if (...) { ... }` unrolls a one-element array into a bare
        # string, which then fails the list check (measured).
        $allow = $null
        if ($perms -is [System.Management.Automation.PSCustomObject]) { $allow = (Get-MergeGateProperty $perms 'allow').Value }
        if ($null -ne $allow -and $allow -isnot [System.Array]) {
            return Get-MergeGateDenial $script:MergeGateGenericDeny "permissions.allow is not a list: $path"
        }
        foreach ($rule in @($allow)) {
            if ($null -eq $rule) { continue }
            if ($rule -isnot [string] -or (Test-MergeGateCapableRule $rule $probes $budget)) {
                return Get-MergeGateDenial $script:MergeGateGenericDeny "merge-capable allow rule in: $path"
            }
            $kept.Add([pscustomobject]@{ Path = $path; Rule = $rule })
        }
    }

    $toolInput = (Get-MergeGateProperty $payload 'tool_input').Value
    if ($toolInput -isnot [System.Management.Automation.PSCustomObject]) {
        return Get-MergeGateDenial $script:MergeGateGenericDeny 'payload has no tool_input object'
    }
    $command = (Get-MergeGateProperty $toolInput 'command').Value
    $alt = ($repos | ForEach-Object { [regex]::Escape($_) }) -join '|'
    $canonical = "\Agh pr merge (?<n>[1-9][0-9]{0,8}) -R (?<repo>$alt) (?<method>--squash|--merge) --match-head-commit (?<sha>[0-9a-f]{40})\z"
    if ($command -isnot [string] -or $command -cnotmatch $canonical) {
        return Get-MergeGateDenial ("This agent merges a pull request only in exactly this form, with nothing before or after it: gh pr merge <N> -R " + $repos[0] + " --squash --match-head-commit <full 40-hex head SHA> (or --merge in place of --squash). Use the PR number and head SHA the user asked for.")
    }
    $m = $Matches
    # Again with the matched command as the only probe (WHY in the .py twin's main).
    foreach ($k in $kept) {
        if (Test-MergeGateCapableRule $k.Rule @($command) $budget) {
            return Get-MergeGateDenial $script:MergeGateGenericDeny "allow rule matches this merge command in: $($k.Path)"
        }
    }
    $desc = Get-MergeGateProperty $toolInput 'description'
    if ($desc.Present -and -not ($desc.Value -is [string] -and [string]::Equals($desc.Value, $script:MergeGateDescription, [System.StringComparison]::Ordinal))) {
        return Get-MergeGateDenial ('Set the tool description to exactly "' + $script:MergeGateDescription + '", or omit it. The prompt shows it, so it must not describe the merge in the agent''s own words.')
    }

    $method = if ([string]::Equals($m['method'], '--squash', [System.StringComparison]::Ordinal)) { 'squash' } else { 'merge commit' }
    [pscustomobject]@{
        Decision = 'ASK'
        Reason   = "Merge PR #$($m['n']) in $($m['repo']) by $method, exactly at head $($m['sha']). Approve only if YOU asked to merge this PR just now. This approval covers this one command."
        Audit    = "$mode`t$($m['repo'])`t$($m['n'])`t$($m['sha'])"
        Cause    = $null
    }
}
