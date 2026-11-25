# Classify a PreToolUse payload as COMMIT / PUSH / MERGE / MULTI / AMBIGUOUS / UNREAD / NONE.
# This is the PowerShell-native twin of _review-gate-classify.py. Keeping classification
# native matters on Windows, where pwsh is the primary hook path and python3 is not assumed.
# It reads a command the way the shell that runs it does (bash, pwsh, or cmd for a `cmd /c` line);
# see the Python twin's docstring for why, and for the bypasses that measured it.

$script:ReviewGateGlobalWithArg = @('-c', '-C', '--exec-path', '--git-dir', '--work-tree',
    '--namespace', '--config-env', '--super-prefix')
$script:ReviewGateGlobalFlags = @('--no-pager', '--paginate', '-p', '--bare',
    '--no-replace-objects', '--literal-pathspecs', '--no-optional-locks',
    '--glob-pathspecs', '--noglob-pathspecs', '--icase-pathspecs', '--html-path',
    '--man-path', '--info-path', '--no-lazy-fetch')
$script:ReviewGateWrappers = @('env', 'sudo', 'doas', 'command', 'builtin', 'nohup', 'time', 'nice',
    'ionice', 'stdbuf', 'setsid', 'eval', 'exec', 'timeout', 'script', 'chrt', 'taskset', 'unbuffer')
# Grammar words that may stand where an executable would; see RESERVED in the Python twin.
$script:ReviewGateReserved = @('{', '}', '!', 'if', 'then', 'else', 'elif', 'while', 'until', 'do', '.')
$script:ReviewGateShellLaunchers = @('bash', 'sh', 'dash', 'zsh', 'ksh', 'fish', 'ash')
# The shell launchers whose options after -c were not measured; see BASH_GRAMMAR_SHELLS in the Python twin.
$script:ReviewGateOtherShellLaunchers = @('dash', 'zsh', 'ksh', 'fish', 'ash')
$script:ReviewGatePowerShellLaunchers = @('pwsh', 'powershell')
# GNU xargs's getopt grammar; see XARGS_SHORT_WITH_ARG, XARGS_SHORT_OPTIONAL and XARGS_LONG in the
# Python twin (long-option kinds: 0 none, 1 required, 2 optional, given only with '=').
$script:ReviewGateXargsShortWithArg = 'adEILnPs'
$script:ReviewGateXargsShortOptional = 'eil'
# Assigned one by one, not in a loop: the hooks dot-source this file, so a loop variable would leak.
$script:ReviewGateXargsLong = [System.Collections.Generic.Dictionary[string, int]]::new([System.StringComparer]::Ordinal)
$script:ReviewGateXargsLong['null'] = 0; $script:ReviewGateXargsLong['arg-file'] = 1; $script:ReviewGateXargsLong['delimiter'] = 1
$script:ReviewGateXargsLong['eof'] = 2; $script:ReviewGateXargsLong['replace'] = 2; $script:ReviewGateXargsLong['max-lines'] = 2
$script:ReviewGateXargsLong['max-args'] = 1; $script:ReviewGateXargsLong['open-tty'] = 0; $script:ReviewGateXargsLong['interactive'] = 0
$script:ReviewGateXargsLong['no-run-if-empty'] = 0; $script:ReviewGateXargsLong['max-chars'] = 1; $script:ReviewGateXargsLong['verbose'] = 0
$script:ReviewGateXargsLong['show-limits'] = 0; $script:ReviewGateXargsLong['exit'] = 0; $script:ReviewGateXargsLong['max-procs'] = 1
$script:ReviewGateXargsLong['process-slot-var'] = 1; $script:ReviewGateXargsLong['version'] = 0; $script:ReviewGateXargsLong['help'] = 0
# The leads pwsh.exe accepts before a parameter name; see PWSH_DASHES in the Python twin.
$script:ReviewGatePwshDashes = '-' + [char]0x2013 + [char]0x2014 + [char]0x2015
$script:ReviewGateSshWithArg = @('-B', '-b', '-c', '-D', '-E', '-e', '-F', '-I', '-i', '-J',
    '-L', '-l', '-m', '-O', '-o', '-P', '-p', '-Q', '-R', '-S', '-W', '-w')
# The shells whose -c payload is also read with a lone & as an operator (N1); see AMP_SPLIT_SHELLS in
# the Python twin.
$script:ReviewGateAmpSplitShells = @('sh', 'dash', 'ash')
# See WRAPPER_TARGETS, WRAPPER_SHORT_WITH_ARG, INERT_WORD and GIT_CONTEXT_ENV in the Python twin.
$script:ReviewGateWrapperTargets = @('git', 'gh', 'cmd', 'ssh', 'xargs', 'busybox') + $script:ReviewGateShellLaunchers +
    $script:ReviewGatePowerShellLaunchers + $script:ReviewGateWrappers
$script:ReviewGateInertWord = '^[0-9][0-9A-Za-z.,:+-]*$'
# A word git or gh takes as its subcommand; see SUBCOMMAND_WORD in the Python twin. Matched whole.
$script:ReviewGateSubcommandWord = '\A[A-Za-z][A-Za-z0-9-]*\z'
# The pattern the Python twin builds from GIT_CONTEXT_ENV, written out: explicit [Aa] classes so both
# engines match exactly ASCII. Matched case-sensitively by [regex]::IsMatch.
$script:ReviewGateGitContextEnvPattern = '(?<![A-Za-z0-9_])(?:[Gg][Ii][Tt]_[Dd][Ii][Rr]|[Gg][Ii][Tt]_[Ww][Oo][Rr][Kk]_[Tt][Rr][Ee][Ee]|[Gg][Ii][Tt]_[Ii][Nn][Dd][Ee][Xx]_[Ff][Ii][Ll][Ee]|[Gg][Ii][Tt]_[Oo][Bb][Jj][Ee][Cc][Tt]_[Dd][Ii][Rr][Ee][Cc][Tt][Oo][Rr][Yy]|[Gg][Ii][Tt]_[Cc][Oo][Mm][Mm][Oo][Nn]_[Dd][Ii][Rr])(?![A-Za-z0-9_])'
# Twin of GIT_CONTEXT_STEM_RE; the parity suite compares the two strings.
$script:ReviewGateGitContextStemPattern = '(?<![A-Za-z0-9_])(?:(?<![`.])[Gg](?:[Ii](?:[Tt](?:_[A-Za-z0-9_]*)?)?)?`|[Gg](?:[Ii](?:[Tt](?:_[A-Za-z0-9_]*)?)?)?[${\x00])'

# The whitespace pwsh splits words on; bash and cmd split on space and tab only (Ws in the readings).
# See WS in the Python twin for why one shared set was wrong. Never \s or a bare Trim(): .NET's \s
# does not match U+001C-U+001F and Python's does, which made the twins disagree.
$script:ReviewGateWsChars = [char[]](@(0x20, 0x09, 0x0b, 0x0c, 0x85, 0xa0, 0x1680) + @(0x2000..0x200a) +
    @(0x2028, 0x2029, 0x202f, 0x205f, 0x3000))
$script:ReviewGateWs = -join $script:ReviewGateWsChars
$script:ReviewGateWsClass = '[' + (-join ($script:ReviewGateWsChars | ForEach-Object { '\u{0:x4}' -f [int]$_ })) + ']'
# PowerShell treats U+2018-U+201B as ' and U+201C-U+201E as "; the pwsh reading maps them first.
$script:ReviewGatePwshQuotes = @{
    0x2018 = "'"; 0x2019 = "'"; 0x201a = "'"; 0x201b = "'"; 0x201c = '"'; 0x201d = '"'; 0x201e = '"'
}
# Deleted from a command-position word before it is compared; see QUOTING in the Python twin.
$script:ReviewGateQuoting = "'" + '"\`^' + "`r`n" + (-join ([char[]](0x2018..0x201e)))
# Every character Get-ReviewGatePlain can delete, for its fast path: a word holding none is returned as is.
$script:ReviewGatePlainChars = ($script:ReviewGateQuoting + '$').ToCharArray()
# Every launcher Get-ReviewGateNestedCommand decodes, so any other executable returns before its arguments are read.
$script:ReviewGateLaunchers = @($script:ReviewGateShellLaunchers) + @($script:ReviewGatePowerShellLaunchers) +
    @('cmd', 'ssh', 'xargs', 'busybox')
$script:ReviewGateReadings = @{
    bash = @{ Ws = " `t"; Quotes = "'" + '"'; Esc = '\'; EscInDq = $true; Seps = ";&|`n()"; DollarParen = $true
        BacktickSubst = $true; Heredoc = $true; HereString = $false }
    pwsh = @{ Ws = $script:ReviewGateWs; Quotes = "'" + '"'; Esc = '`'; EscInDq = $true; Seps = ";&|`n`r(){}"; DollarParen = $true
        BacktickSubst = $false; Heredoc = $false; HereString = $true }
    cmd  = @{ Ws = " `t"; Quotes = '"'; Esc = '^'; EscInDq = $false; Seps = "&|`n`r()"; DollarParen = $false
        BacktickSubst = $false; Heredoc = $false; HereString = $false }
}
# Budgets; past any of them the verdict is AMBIGUOUS. The same three numbers as the Python twin, whose
# comment has the WHY and the measurements: this twin's hook process died of a .NET stack overflow
# between 630 and 640 nested $( (pwsh 7.6.9), so the substitution limit stays far below that.
$script:ReviewGateMaxLauncherDepth = 8
$script:ReviewGateMaxSubstitutionDepth = 32
$script:ReviewGateMaxNestedReadings = 64
# Hard caps, checked before the command is read: its size in UTF-8 bytes, and the leading cd paths
# plus git -C paths of one invocation. The Python twin's MAX_COMMAND_BYTES and MAX_CONTEXT_PATHS have
# the WHY. The UTF-8 count matches the Python twin's for every string, a lone surrogate included.
$script:ReviewGateMaxCommandBytes = 131072
$script:ReviewGateMaxContextPaths = 64
# Tag names in one tag-only push; past it no names, so the hooks take the ordinary push path. The
# hooks run several git commands per name (~0.16 s a tag, loaded Windows 11, 2026-11-06), so 64
# bounds that loop to about 10 s, well under the 600 s timeout. The Python twin's MAX_TAG_NAMES.
$script:ReviewGateMaxTagNames = 64
# The total-work budget, a backstop below the caps: UTF-16 code units read (String.Length, which the
# Python twin counts the same way) plus a charge per segment. The Python twin's MAX_WORK has the WHY.
$script:ReviewGateMaxWork = 1000000
$script:ReviewGateSegmentWork = 16
# git and gh words the unread scan reads in one segment before a verb; see MAX_UNREAD_NAMES in the Python twin.
$script:ReviewGateMaxUnreadNames = 64
# A word holding neither cannot name git or gh; see unread_segment in the Python twin.
$script:ReviewGateLetterG = [char[]]@(0x67, 0x47)
# A word holding none of p, P, c, C, m, M cannot be push, commit, pr or merge in ASCII lower case.
$script:ReviewGateVerbLetters = [char[]]@(0x70, 0x50, 0x63, 0x43, 0x6d, 0x4d)

# PowerShell's -eq, -ceq, -contains, -ccontains and -in, and the string overloads of StartsWith and
# EndsWith, compare by culture, which ignores characters such as U+00AD (soft hyphen) and equates
# look-alikes: @('-I') -ccontains ('-I' + [char]0xAD) is True, and so is [char]0x207D -in @('(')
# (measured, pwsh 7.6). The first made this twin skip `git` in `xargs -I<U+00AD> git commit` as an
# option argument; the second split `git -c a.b=c<U+207D>x commit` before its verb. Both commits
# ran, and the Python twin, which compares code points, denied both. So every comparison here is
# ordinal (the -match regexes aside: they only add matches); characters are compared as [int], since
# char -eq ignores case. tests/test-review-gate-classify-parity.sh parses this file and refuses a
# culture-aware comparison.
function Test-ReviewGateSame([string]$A, [string]$B) { return [string]::Equals($A, $B, [System.StringComparison]::Ordinal) }
function Test-ReviewGateOneOf([string]$Text, [string[]]$List) {
    foreach ($x in $List) { if ([string]::Equals($Text, $x, [System.StringComparison]::Ordinal)) { return $true } }
    return $false
}

# The per-classification counters, shared by every reading of one command; see the Python twin's _budget.
function Get-ReviewGateBudget($Ctx) {
    if (-not $Ctx.ContainsKey('Budget')) { $Ctx.Budget = @{ Readings = 0; Nest = 0; Work = 0 } }
    return $Ctx.Budget
}

# Charge $Work to the classification's total-work budget; see the Python twin's _spend and MAX_WORK.
function Add-ReviewGateWork($Budget, [int]$Work) {
    $Budget.Work += $Work
    if ([int]$Budget.Work -gt $script:ReviewGateMaxWork) { throw 'review gate: total work over budget' }
}

# True when $Command is over the size cap; see the Python twin's too_large.
function Test-ReviewGateTooLarge([string]$Command) {
    return [int][System.Text.Encoding]::UTF8.GetByteCount($Command) -gt $script:ReviewGateMaxCommandBytes
}

# Throws once a path chain holds more than the path-count cap; see the Python twin's _context_paths_checked.
function Assert-ReviewGateContextPathCount([int]$Count) {
    if ([int]$Count -gt $script:ReviewGateMaxContextPaths) { throw 'review gate: context paths over budget' }
}

function Get-ReviewGateTrim([string]$Text) { return $Text.Trim($script:ReviewGateWsChars) }

function Get-ReviewGatePlain {
    param([string]$Word, [switch]$KeepBackslash)
    if (0 -gt $Word.IndexOfAny($script:ReviewGatePlainChars)) { return $Word }
    $out = [System.Text.StringBuilder]::new()
    for ($i = 0; $i -lt $Word.Length; $i++) {
        $c = [int]$Word[$i]
        if ($c -eq 36 -and $i + 1 -lt $Word.Length -and ([int]$Word[$i + 1] -eq 39 -or [int]$Word[$i + 1] -eq 34)) { continue }
        if ($script:ReviewGateQuoting.Contains([string]$Word[$i]) -and -not ($KeepBackslash -and $c -eq 92)) { continue }
        [void]$out.Append($Word[$i])
    }
    return $out.ToString()
}

function Get-ReviewGateBaseOf([string]$Name) {
    $base = (($Name -replace '\\', '/') -split '/')[-1].ToLowerInvariant()
    if ($base.EndsWith('.exe', [System.StringComparison]::Ordinal)) { $base = $base.Substring(0, $base.Length - 4) }
    return $base
}

# $Text with only A-Z lowered: the one case rule both twins share; see ascii_lower in the Python twin.
function ConvertTo-ReviewGateAsciiLower([string]$Text) {
    $chars = $Text.ToCharArray()
    for ($i = 0; $i -lt $chars.Length; $i++) {
        $c = [int]$chars[$i]
        if ($c -ge 65 -and $c -le 90) { $chars[$i] = [char]($c + 32) }
    }
    return [string]::new($chars)
}

# The program names a command word can mean: backslash read as a path separator, and as an escape.
# In the pwsh reading trailing whitespace is dropped (`& 'git ' commit` ran git); see names() in the
# Python twin. Memoized per reading: every segment asks it of its executable four or more times
# (wrappers, git, gh, launchers), which made a 150-line PowerShell script 2.4 times slower than before
# this file read shells (measured).
$script:ReviewGateNamesCache = [System.Collections.Generic.Dictionary[string, string[]]]::new([System.StringComparer]::Ordinal)
function Get-ReviewGateProgramName([string]$Token, [string]$Reading = 'bash') {
    $isPwsh = Test-ReviewGateSame $Reading 'pwsh'
    $key = if ($isPwsh) { 'p' + $Token } else { 'b' + $Token }
    $names = $null
    if ($script:ReviewGateNamesCache.TryGetValue($key, [ref]$names)) { return $names }
    $found = @((Get-ReviewGatePlain $Token -KeepBackslash), (Get-ReviewGatePlain $Token))
    if ($isPwsh) { $found = @($found | ForEach-Object { $_.TrimEnd($script:ReviewGateWsChars) }) }
    $names = [string[]]@($found | ForEach-Object { Get-ReviewGateBaseOf $_ })
    $script:ReviewGateNamesCache[$key] = $names
    return $names
}

function Test-ReviewGateNamed([string]$Token, [string[]]$List, [string]$Reading = 'bash') {
    foreach ($name in @(Get-ReviewGateProgramName $Token $Reading)) { if (Test-ReviewGateOneOf $name $List) { return $true } }
    return $false
}

# An escape Get-ReviewGatePlain cannot undo (bash's $'\x70ush', pwsh's "pu`u{73}h"): AMBIGUOUS.
function Test-ReviewGateOpaque([string]$Word, [string]$Reading) {
    if (Test-ReviewGateSame $Reading 'pwsh') { return $Word.Contains('`u{') }
    return $Word -match '\$''[^'']*\\'
}

function Test-ReviewGateCharIn([char]$Ch, [string]$Set) {
    foreach ($c in $Set.ToCharArray()) { if ([int]$c -eq [int]$Ch) { return $true } }
    return $false
}

# Twin of _long_prefix in the Python twin.
function Test-ReviewGateLongPrefix([string]$Name, [string]$Full) {
    return ($Name.Length -ge 3 -and $Full.StartsWith($Name, [System.StringComparison]::Ordinal))
}

# Twin of _wrapper_option in the Python twin: read one option word of $Wrapper. The letter strings and
# long names below mirror WRAPPER_SHORT_WITH_ARG, WRAPPER_CHDIR_SHORT and WRAPPER_CHDIR_LONG there.
function Get-ReviewGateWrapperOption {
    param([string]$Wrapper, [string]$Token)
    $none = [PSCustomObject]@{ Chdir = $false; Split = $null; TakesNext = $false }
    $bare = Get-ReviewGatePlain $Token
    $isEnv = Test-ReviewGateSame $Wrapper 'env'
    $isSudo = Test-ReviewGateSame $Wrapper 'sudo'
    if ($bare.StartsWith('--', [System.StringComparison]::Ordinal)) {
        $at = $bare.IndexOf('=', [System.StringComparison]::Ordinal)
        $hasEq = -not (0 -gt $at)
        $name = if ($hasEq) { $bare.Substring(0, $at) } else { $bare }
        $chdirLong = if ($isEnv) { @('--chdir') } elseif ($isSudo) { @('--chdir', '--chroot') } else { @() }
        foreach ($long in $chdirLong) {
            if (Test-ReviewGateLongPrefix $name $long) {
                return [PSCustomObject]@{ Chdir = $true; Split = $null; TakesNext = (-not $hasEq) }
            }
        }
        if ($isEnv) {
            if (Test-ReviewGateLongPrefix $name '--split-string') {
                $split = ''
                if ($hasEq) {
                    $kept = Get-ReviewGatePlain $Token -KeepBackslash
                    $split = $kept.Substring($kept.IndexOf('=', [System.StringComparison]::Ordinal) + 1)
                }
                return [PSCustomObject]@{ Chdir = $false; Split = $split; TakesNext = $false }
            }
            if (Test-ReviewGateLongPrefix $name '--unset') {
                return [PSCustomObject]@{ Chdir = $false; Split = $null; TakesNext = (-not $hasEq) }
            }
        }
        return $none
    }
    $letters = if ($isEnv) { 'uCSP' } elseif ($isSudo) { 'ugphCDrtUTR' } else { '' }
    $chdirLetters = if ($isEnv) { 'C' } elseif ($isSudo) { 'DR' } else { '' }
    $body = $bare.Substring(1)
    for ($k = 0; [int]$k -lt $body.Length; $k++) {
        $ch = $body[$k]
        if (Test-ReviewGateCharIn $ch $letters) {
            $attached = $body.Substring($k + 1)
            if ($isEnv -and [int]$ch -eq 83) {
                $kept = Get-ReviewGatePlain $Token -KeepBackslash
                return [PSCustomObject]@{ Chdir = $false; Split = $kept.Substring($kept.IndexOf('S', [System.StringComparison]::Ordinal) + 1); TakesNext = $false }
            }
            return [PSCustomObject]@{
                Chdir     = (Test-ReviewGateCharIn $ch $chdirLetters)
                Split     = $null
                TakesNext = ($attached.Length -eq 0)
            }
        }
    }
    return $none
}

# Twin of _split_value in the Python twin.
function Get-ReviewGateSplitValue {
    param([string]$Attached, [string[]]$Tokens, [int]$I)
    if ($Attached.Length -eq 0) {
        if ([int]$I + 1 -lt $Tokens.Count) {
            return [PSCustomObject]@{ Value = (ConvertFrom-ReviewGateOuterQuote $Tokens[$I + 1]); Next = $I + 2 }
        }
        return [PSCustomObject]@{ Value = ''; Next = $I + 1 }
    }
    return [PSCustomObject]@{ Value = $Attached; Next = $I + 1 }
}

# Twin of leading_executable in the Python twin, which carries the WHY: drop assignments, wrappers with
# their options, and grammar words. Executable is $null when there is no executable to classify; Chdir
# is true when a wrapper option moved the directory git runs in.
function Get-ReviewGateLeadingExecutable {
    param([string[]]$Tokens, [string]$Reading = 'bash', [int]$Depth = 0)
    $i = 0
    $chdir = $false
    $wrapper = $null
    $afterOption = $false
    while ($i -lt $Tokens.Count) {
        $token = $Tokens[$i]
        # Every skip below decides from the plain form, which cannot see into an opaque word; see the Python twin.
        if ((Test-ReviewGateOpaque $token $Reading) -and $token -cnotmatch '^[A-Za-z_][A-Za-z0-9_]*=') { break }
        $bare = Get-ReviewGatePlain $token
        if ($null -ne $wrapper -and $bare.StartsWith('-', [System.StringComparison]::Ordinal)) {
            if (Test-ReviewGateSame $bare '--') {
                $wrapper = $null
                $afterOption = $false
                $i++
                continue
            }
            $option = Get-ReviewGateWrapperOption $wrapper $token
            if ($null -ne $option.Split) {
                if ([int]$Depth -ge $script:ReviewGateMaxLauncherDepth) { throw 'review gate: env -S depth over budget' }
                $split = Get-ReviewGateSplitValue $option.Split $Tokens $i
                $inner = @(Get-ReviewGateWord ($split.Value.Replace('\_', ' ')) 'bash')
                $sub = Get-ReviewGateLeadingExecutable (@('env') + $inner + @($Tokens | Select-Object -Skip $split.Next)) $Reading ($Depth + 1)
                return [PSCustomObject]@{ Executable = $sub.Executable; Rest = $sub.Rest; Chdir = ($chdir -or $sub.Chdir) }
            }
            $chdir = $chdir -or $option.Chdir
            $afterOption = -not $option.TakesNext
            if ($option.TakesNext) { $i += 2 } else { $i++ }
            continue
        }
        # -cmatch, not -match: the case-insensitive form let U+212A (KELVIN SIGN) match [A-Za-z]. A quoted
        # assignment is skipped too; see the Python twin.
        if ($bare -cmatch '^[A-Za-z_][A-Za-z0-9_]*=' -or (Test-ReviewGateOneOf $token $script:ReviewGateReserved)) {
            $afterOption = $false
            $i++
            continue
        }
        # bash's `coproc [NAME] command`; a NAME comes only before a compound command. See the Python twin.
        if ((Test-ReviewGateSame $Reading 'bash') -and (Test-ReviewGateSame $token 'coproc')) {
            $i += if ($i + 2 -lt $Tokens.Count -and (Test-ReviewGateOneOf $Tokens[$i + 2] $script:ReviewGateReserved)) { 2 } else { 1 }
            continue
        }
        # The wrapper's name: the ordinally least of its names that is a wrapper, as the Python twin sorts.
        $hit = $null
        foreach ($name in @(Get-ReviewGateProgramName $token $Reading)) {
            if ((Test-ReviewGateOneOf $name $script:ReviewGateWrappers) -and ($null -eq $hit -or 0 -gt [string]::CompareOrdinal($name, $hit))) { $hit = $name }
        }
        if ($null -ne $hit) {
            $wrapper = $hit
            $afterOption = $false
            $i++
            continue
        }
        if ($null -ne $wrapper -and $token -cmatch $script:ReviewGateInertWord) {
            $afterOption = $false
            $i++
            continue
        }
        if ($null -ne $wrapper -and $afterOption -and (
                -not (Test-ReviewGateNamed $token $script:ReviewGateWrapperTargets $Reading) -or
                ($i + 1 -lt $Tokens.Count -and (Test-ReviewGateNamed $Tokens[$i + 1] $script:ReviewGateWrapperTargets $Reading)))) {
            $afterOption = $false
            $i++
            continue
        }
        break
    }
    if ($i -ge $Tokens.Count) {
        return [PSCustomObject]@{ Executable = $null; Rest = @(); Chdir = $chdir }
    }
    return [PSCustomObject]@{
        Executable = $Tokens[$i]
        Rest       = @($Tokens | Select-Object -Skip ($i + 1))
        Chdir      = $chdir
    }
}

# Twin of names_git_context_env and its CONTINUATION_RE / ESCAPE_RE / EMPTY_EXPANSION_RE in the Python twin.
function Test-ReviewGateNamesGitContextEnv {
    param([string]$Command)
    $text = [regex]::Replace($Command, '\\\r?\n', '')
    $text = [regex]::Replace($text, '\\x([0-9A-Fa-f]{1,2})|\\u([0-9A-Fa-f]{1,4})|\\U([0-9A-Fa-f]{1,8})|\\([0-7]{1,3})|`u\{([0-9A-Fa-f]{1,6})\}', {
        param($m)
        foreach ($pair in @(@(1, 16), @(2, 16), @(3, 16), @(4, 8), @(5, 16))) {
            $group = $m.Groups[$pair[0]]
            if ($group.Success) {
                $n = [Convert]::ToInt64($group.Value, $pair[1])
                if (128 -gt $n) { return [string][char][int]$n }
                return $m.Value
            }
        }
        return $m.Value
    })
    # Before anything below removes the $ or backtick it looks for; quotes go so GI''T_$X still reads.
    if ([regex]::IsMatch([regex]::Replace($text, '["''\\^\u2018-\u201e]', ''), $script:ReviewGateGitContextStemPattern)) { return $true }
    $text = [regex]::Replace($text, '\$\(\)|\$''''|\$""|\$\{\}', '')
    # A $ straight before a quote opens $'...' or $"..."; with the quotes deleted it would stay inside the name.
    $text = [regex]::Replace($text, '\$(?=[''"])', '')
    return [regex]::IsMatch([regex]::Replace($text, '["''\\`^\u2018-\u201e]', ''), $script:ReviewGateGitContextEnvPattern)
}

# Twin of unread_segment in the Python twin, which carries the WHY: the verb ('PUSH', 'COMMIT' or
# 'MERGE') when a segment with no guarded invocation still says git ... push/commit or gh ... pr ...
# merge, else $null. Every git or gh word is charged to the work budget, and more than
# $script:ReviewGateMaxUnreadNames of them before a verb throws (AMBIGUOUS).
function Test-ReviewGateUnreadSegment {
    param([string[]]$Words, [string]$Reading, $Budget = $null)
    $gitSeen = $false; $ghSeen = $false; $prSeen = $false
    $count = 0
    foreach ($word in $Words) {
        # Both shortcuts keep the cost per other word to one search; see the Python twin.
        if (($gitSeen -or $ghSeen) -and -not (0 -gt $word.IndexOfAny($script:ReviewGateVerbLetters))) {
            $low = ConvertTo-ReviewGateAsciiLower (Get-ReviewGatePlain $word)
            if ($gitSeen -and (Test-ReviewGateSame $low 'push')) { return 'PUSH' }
            if ($gitSeen -and (Test-ReviewGateSame $low 'commit')) { return 'COMMIT' }
            if ($prSeen -and (Test-ReviewGateSame $low 'merge')) { return 'MERGE' }
            if ($ghSeen -and (Test-ReviewGateSame $low 'pr')) { $prSeen = $true }
        }
        if (0 -gt $word.IndexOfAny($script:ReviewGateLetterG)) { continue }
        $isGitWord = $false; $isGhWord = $false
        foreach ($name in @(Get-ReviewGateProgramName $word $Reading)) {
            if (Test-ReviewGateSame $name 'git') { $isGitWord = $true }
            if (Test-ReviewGateSame $name 'gh') { $isGhWord = $true }
        }
        if ($isGitWord -or $isGhWord) {
            $count++
            if ($null -ne $Budget) { Add-ReviewGateWork $Budget 1 }
            if ([int]$count -gt $script:ReviewGateMaxUnreadNames) { throw 'review gate: unread names over budget' }
            $gitSeen = $gitSeen -or $isGitWord
            $ghSeen = $ghSeen -or $isGhWord
        }
    }
    return $null
}

# Twin of unread_verb in the Python twin, which carries the WHY.
function Get-ReviewGateUnreadVerb {
    param([string]$Executable, [string[]]$Rest, [string[]]$Direct, [string]$Reading, $Budget)
    if ((Test-ReviewGateNamed $Executable @('git', 'gh') $Reading) -and $Rest.Count -gt 0 -and
        (Get-ReviewGatePlain $Rest[0]) -cmatch $script:ReviewGateSubcommandWord) {
        # gh pr with a flag after pr (`gh pr -R o/r merge 1`) takes the full scan below; the exemption holds
        # only when a plain word follows pr. `gh pr -R o/r view merge` is then an accepted false deny.
        $flagAfterPr = (Test-ReviewGateNamed $Executable @('gh') $Reading) -and
            (Test-ReviewGateSame (ConvertTo-ReviewGateAsciiLower (Get-ReviewGatePlain $Rest[0])) 'pr') -and
            -not ($Rest.Count -gt 1 -and (Get-ReviewGatePlain $Rest[1]) -cmatch $script:ReviewGateSubcommandWord)
        if (-not $flagAfterPr) { return Test-ReviewGateUnreadSegment $Rest $Reading $Budget }
    }
    $verb = Test-ReviewGateUnreadSegment $Direct $Reading $Budget
    if ($null -ne $verb) { return $verb }
    [string[]]$decoded = @($Executable) + @($Rest)
    $same = $decoded.Count -le $Direct.Count
    if ($same) {
        [string[]]$tail = $Direct[($Direct.Count - $decoded.Count)..($Direct.Count - 1)]
        $same = [System.Linq.Enumerable]::SequenceEqual($tail, $decoded)
    }
    if ($same) { return $null }
    return Test-ReviewGateUnreadSegment $decoded $Reading $Budget
}

function Get-ReviewGateGitVerbIndex {
    param([string[]]$Tokens)
    $i = 0
    while ($i -lt $Tokens.Count) {
        $token = Get-ReviewGatePlain $Tokens[$i]
        if (Test-ReviewGateOneOf $token $script:ReviewGateGlobalWithArg) {
            $i += 2
            continue
        }
        if ($token.StartsWith('--', [System.StringComparison]::Ordinal) -and $token.Contains('=') -and
            (Test-ReviewGateOneOf $token.Split('=', 2)[0] $script:ReviewGateGlobalWithArg)) {
            $i++
            continue
        }
        if ((Test-ReviewGateOneOf $token $script:ReviewGateGlobalFlags) -or
            $token.StartsWith('-', [System.StringComparison]::Ordinal)) {
            $i++
            continue
        }
        return $i
    }
    return -1
}

function Get-ReviewGateGitVerb {
    param([string[]]$Tokens)
    $i = Get-ReviewGateGitVerbIndex $Tokens
    if ($i -lt 0) { return $null }
    # ASCII lower case, as the Python twin compares it: ToLowerInvariant also folded non-ASCII forms.
    return ConvertTo-ReviewGateAsciiLower (Get-ReviewGatePlain $Tokens[$i])
}

function Get-ReviewGateLeadingCdPath {
    param([string]$Command)
    $ws = $script:ReviewGateWsClass
    $pattern = [regex]('^cd' + $ws + '+(?:"([^"]+)"|''([^'']+)'')' + $ws + '*&&' + $ws + '*')
    $paths = @()
    $rest = $Command
    while ($true) {
        $match = $pattern.Match($rest)
        if (-not $match.Success) { break }
        $paths += if ($match.Groups[1].Success) { $match.Groups[1].Value } else { $match.Groups[2].Value }
        Assert-ReviewGateContextPathCount $paths.Count
        $rest = $rest.Substring($match.Length)
    }
    return @($paths)
}

# Tag names if $Command is exactly the tag-only push shape with at most
# $script:ReviewGateMaxTagNames of them, else nothing. The pattern text is
# _review-gate-classify.py's TAG_PUSH, whose comment has the WHY. \A and \z because .NET's $
# also matches before a final newline; [regex] rather than -match, which ignores case.
function Get-ReviewGateTagPushName {
    param([string]$Command)
    $shapeText = @'
cd[ \t]+(?:"(?:[A-Za-z]:)?/[\x20\x21\x23\x25-\x29\x2B-\x3E\x40-\x5A\x5E\x5F\x61-\x7E]*"|'(?:[A-Za-z]:)?/[\x20-\x23\x25\x26\x28\x29\x2B-\x3E\x40-\x5A\x5E\x5F\x61-\x7E]*')[ \t]*&&[ \t]*git[ \t]+push[ \t]+[A-Za-z0-9_][A-Za-z0-9._-]*((?:[ \t]+(?:refs/tags/|tag[ \t]+)[A-Za-z0-9_][A-Za-z0-9._/-]*)+)
'@
    $nameText = @'
(?:refs/tags/|tag[ \t]+)([A-Za-z0-9_][A-Za-z0-9._/-]*)
'@
    if ([string]::IsNullOrEmpty($Command) -or (Test-ReviewGateTooLarge $Command)) { return @() }
    $shape = ([regex]"\A(?:$shapeText)\z").Match($Command)
    if (-not $shape.Success) { return @() }
    # NextMatch rather than Matches, so collection stops as soon as the count passes the cap.
    $names = [System.Collections.Generic.List[string]]::new()
    $name = ([regex]$nameText).Match($shape.Groups[1].Value)
    while ($name.Success) {
        $names.Add($name.Groups[1].Value)
        if ($names.Count -gt $script:ReviewGateMaxTagNames) { return @() }
        $name = $name.NextMatch()
    }
    return @($names)
}

function Get-ReviewGateGitContextPath {
    param([string[]]$Tokens)
    $paths = @()
    $i = 0
    while ($i -lt $Tokens.Count) {
        $token = $Tokens[$i].Trim([char[]]@('"', "'"))
        $word = Get-ReviewGatePlain $Tokens[$i]
        # Options are recognised on the plain word, -C's path taken from the stripped one; a -C,
        # --git-dir or --work-tree with quotes inside would make them disagree. See the Python twin.
        if (-not (Test-ReviewGateSame $word $token) -and ($word.StartsWith('-C', [System.StringComparison]::Ordinal) -or
            (Test-ReviewGateOneOf $word.Split('=', 2)[0] @('--git-dir', '--work-tree')))) {
            return [PSCustomObject]@{ Paths = @(); Unsupported = $true }
        }
        if (Test-ReviewGateSame $word '-C') {
            if ($i + 1 -ge $Tokens.Count) {
                return [PSCustomObject]@{ Paths = @(); Unsupported = $true }
            }
            $paths += $Tokens[$i + 1].Trim([char[]]@('"', "'"))
            Assert-ReviewGateContextPathCount $paths.Count
            $i += 2
            continue
        }
        if ($word.StartsWith('-C', [System.StringComparison]::Ordinal) -and $word.Length -gt 2) {
            $paths += $token.Substring(2)
            Assert-ReviewGateContextPathCount $paths.Count
            $i++
            continue
        }
        $option = $word.Split('=', 2)[0]
        if (Test-ReviewGateOneOf $option @('--git-dir', '--work-tree')) {
            return [PSCustomObject]@{ Paths = @(); Unsupported = $true }
        }
        if (Test-ReviewGateOneOf $word $script:ReviewGateGlobalWithArg) {
            $i += 2
            continue
        }
        if ($word.StartsWith('--', [System.StringComparison]::Ordinal) -and $word.Contains('=') -and
            (Test-ReviewGateOneOf $option $script:ReviewGateGlobalWithArg)) {
            $i++
            continue
        }
        if ((Test-ReviewGateOneOf $word $script:ReviewGateGlobalFlags) -or
            $word.StartsWith('-', [System.StringComparison]::Ordinal)) {
            $i++
            continue
        }
        break
    }
    return [PSCustomObject]@{ Paths = @($paths); Unsupported = $false }
}

function Get-ReviewGateVerdictFromInvocation {
    param([string]$Executable, [string[]]$Rest, [string]$Reading = 'bash')
    if (Test-ReviewGateOpaque $Executable $Reading) { return 'AMBIGUOUS' }
    if (Test-ReviewGateNamed $Executable @('git') $Reading) {
        $i = Get-ReviewGateGitVerbIndex $Rest
        if ($i -ge 0) {
            for ($k = 0; [int]$k -le $i; $k++) { if (Test-ReviewGateOpaque $Rest[$k] $Reading) { return 'AMBIGUOUS' } }
        }
        $verb = Get-ReviewGateGitVerb $Rest
        if (Test-ReviewGateSame $verb 'commit') { return 'COMMIT' }
        if (Test-ReviewGateSame $verb 'push') { return 'PUSH' }
    } elseif (Test-ReviewGateNamed $Executable @('gh') $Reading) {
        for ($k = 0; [int]$k -lt [Math]::Min(2, $Rest.Count); $k++) { if (Test-ReviewGateOpaque $Rest[$k] $Reading) { return 'AMBIGUOUS' } }
        $flat = (($Rest | ForEach-Object { Get-ReviewGatePlain $_ }) -join ' ')
        if ($flat -cmatch '^pr merge(?: |$)') { return 'MERGE' }
        # Any ASCII case, spelled out with -cmatch: -match also folds non-ASCII forms. See PULLS_MERGE.
        if ($flat -cmatch '^api(?: |$)' -and $flat -cmatch '/[pP][uU][lL][lL][sS]/\d+/[mM][eE][rR][gG][eE]') { return 'MERGE' }
    }
    return $null
}

function ConvertFrom-ReviewGateOuterQuote {
    param([string]$Value)
    $value = Get-ReviewGateTrim $Value
    if ($value.Length -ge 2 -and [int]$value[0] -eq [int]$value[$value.Length - 1] -and
        ([int]$value[0] -eq 34 -or [int]$value[0] -eq 39)) {
        return $value.Substring(1, $value.Length - 2)
    }
    return $value
}

function Get-ReviewGateBacktickBody {
    param([string]$Text, [int]$Start)
    $escaped = $false
    for ($i = $Start; $i -lt $Text.Length; $i++) {
        $c = [int]$Text[$i]
        if ($escaped) { $escaped = $false; continue }
        if ($c -eq 92) { $escaped = $true; continue }
        if ($c -eq 96) {
            return [PSCustomObject]@{ Body = $Text.Substring($Start, $i - $Start); End = $i }
        }
    }
    return [PSCustomObject]@{ Body = $Text.Substring($Start); End = $Text.Length - 1 }
}

# Commands a heredoc or here-string body runs: only its $(...) and backticks; quotes are literal there.
# Characters as ints, not a function call each: this loop runs over every unquoted body.
function Get-ReviewGateSubstitution {
    param([string]$Text, [string]$Reading, $Ctx)
    $r = $script:ReviewGateReadings[$Reading]
    $esc = [int][char]$r.Esc; $backtickSubst = $r.BacktickSubst; $len = $Text.Length
    $index = @{ V = $null }
    $out = [System.Collections.Generic.List[string]]::new()
    $i = 0
    while ($i -lt $len) {
        $c = [int]$Text[$i]
        if ($c -eq $esc) { $i += 2; continue }
        if ($c -eq 36 -and $i + 1 -lt $len -and [int]$Text[$i + 1] -eq 40) {
            $scan = Invoke-ReviewGateScan $Text $Reading ($i + 2) $true $Ctx $index
            foreach ($part in @($scan.Segments) + @($scan.Nested)) { $out.Add($part) }
            $i = $scan.End + 1
            continue
        }
        if ($backtickSubst -and $c -eq 96) {
            $sub = Get-ReviewGateBacktickBody $Text ($i + 1)
            foreach ($part in @(Split-ReviewGateCommand $sub.Body $Reading $Ctx)) { $out.Add($part) }
            $i = $sub.End + 1
            continue
        }
        $i++
    }
    return @($out)
}

function Add-ReviewGateLineStart($Map, [string]$Key, [int]$Start) {
    $starts = $null
    if (-not $Map.TryGetValue($Key, [ref]$starts)) {
        $starts = [System.Collections.Generic.List[int]]::new()
        $Map[$Key] = $starts
    }
    $starts.Add($Start)
}

# Where each line of $Command starts, so heredoc and here-string ends are found without rescanning;
# see the Python twin's _line_index. Ordinal dictionaries: a PowerShell hashtable ignores case.
function Get-ReviewGateLineIndex {
    param([string]$Command)
    $exact = [System.Collections.Generic.Dictionary[string, System.Collections.Generic.List[int]]]::new([System.StringComparer]::Ordinal)
    $untabbed = [System.Collections.Generic.Dictionary[string, System.Collections.Generic.List[int]]]::new([System.StringComparer]::Ordinal)
    $sq = [System.Collections.Generic.List[int]]::new()
    $dq = [System.Collections.Generic.List[int]]::new()
    $start = 0
    while ($true) {
        $newline = $Command.IndexOf("`n", $start, [System.StringComparison]::Ordinal)
        $end = if ([int]$newline -lt 0) { $Command.Length } else { $newline }
        $line = $Command.Substring($start, $end - $start)
        $key = if ($line.EndsWith("`r", [System.StringComparison]::Ordinal)) { $line.Substring(0, $line.Length - 1) } else { $line }
        Add-ReviewGateLineStart $exact $key $start
        Add-ReviewGateLineStart $untabbed $key.TrimStart([char]9) $start
        if ($line.StartsWith("'@", [System.StringComparison]::Ordinal)) { $sq.Add($start) }
        elseif ($line.StartsWith('"@', [System.StringComparison]::Ordinal)) { $dq.Add($start) }
        if ([int]$newline -lt 0) { break }
        $start = $newline + 1
    }
    return [PSCustomObject]@{ Exact = $exact; Untabbed = $untabbed; Sq = $sq; Dq = $dq }
}

# The first offset in the sorted list $Starts that is at least $From, or -1.
function Get-ReviewGateFirstAt($Starts, [int]$From) {
    if ($null -eq $Starts) { return -1 }
    $k = $Starts.BinarySearch($From)
    if ([int]$k -lt 0) { $k = -bnot $k }
    if ([int]$k -ge $Starts.Count) { return -1 }
    return $Starts[$k]
}

# A heredoc delimiter word after bash's quote removal; see the Python twin's _bash_unquote.
# With -DollarQuote, $'...' and $"..." open quotes too, as bash reads a -c payload word; see the Python twin.
function ConvertFrom-ReviewGateBashQuote {
    param([string]$Word, [switch]$DollarQuote)
    $out = [System.Text.StringBuilder]::new()
    $quote = 0
    for ($i = 0; $i -lt $Word.Length; $i++) {
        $c = [int]$Word[$i]
        if ($DollarQuote -and $quote -eq 0 -and $c -eq 36 -and $i + 1 -lt $Word.Length -and
            ([int]$Word[$i + 1] -eq 39 -or [int]$Word[$i + 1] -eq 34)) {
            $i++
            $quote = [int]$Word[$i]
            continue
        }
        if ($quote -eq 39) {
            if ($c -eq 39) { $quote = 0 } else { [void]$out.Append($Word[$i]) }
        } elseif ($quote -eq 34 -and $c -eq 34) {
            $quote = 0
        } elseif ($c -eq 92 -and $i + 1 -lt $Word.Length -and ($quote -eq 0 -or '$`"\'.Contains([string]$Word[$i + 1]))) {
            $i++
            [void]$out.Append($Word[$i])
        } elseif ($quote -eq 0 -and ($c -eq 39 -or $c -eq 34)) {
            $quote = $c
        } else {
            [void]$out.Append($Word[$i])
        }
    }
    return $out.ToString()
}

# Parse the operator at $Command[$Start] == '<<'; $null when no delimiter word follows.
function Get-ReviewGateHeredocWord {
    param([string]$Command, [int]$Start)
    $j = $Start + 2
    $stripTabs = [int]$j -lt $Command.Length -and [int]$Command[$j] -eq 45
    if ($stripTabs) { $j++ }
    while ([int]$j -lt $Command.Length -and ([int]$Command[$j] -eq 32 -or [int]$Command[$j] -eq 9)) { $j++ }
    $i = $j
    $quote = 0
    while ($i -lt $Command.Length) {
        $c = [int]$Command[$i]
        if ($quote -ne 0) {
            if ($c -eq $quote) { $quote = 0 }
        } elseif ($c -eq 39 -or $c -eq 34) {
            $quote = $c
        } elseif ($c -eq 92) {
            $i++
        } elseif (" `t;&|<>()`n".Contains([string]$Command[$i])) {
            break
        }
        $i++
    }
    $word = $Command.Substring($j, [Math]::Min($i, $Command.Length) - $j)
    if ($word.Length -eq 0) { return $null }
    return [PSCustomObject]@{
        Delimiter = ConvertFrom-ReviewGateBashQuote $word
        Quoted    = $word.Contains("'") -or $word.Contains('"') -or $word.Contains('\')
        StripTabs = $stripTabs
        End       = [Math]::Min($i, $Command.Length)
    }
}

# Skip the bodies of the heredocs pending at a newline; the index after them, or -1 when a delimiter
# line is missing (the lines are then read as commands; see the Python twin).
function Get-ReviewGateHeredocEnd {
    param([string]$Command, [int]$Start, $Pending, [string]$Reading, $Nested, $Ctx, $Index)
    $i = $Start
    foreach ($heredoc in @($Pending)) {
        # Plain assignments: an if-expression would unroll the dictionary, and below the list.
        $map = $Index.Exact
        if ($heredoc.StripTabs) { $map = $Index.Untabbed }
        $starts = $null
        [void]$map.TryGetValue($heredoc.Delimiter, [ref]$starts)
        $found = Get-ReviewGateFirstAt $starts $i
        if ([int]$found -lt 0) { return -1 }
        if (-not $heredoc.Quoted) {
            foreach ($part in @(Get-ReviewGateSubstitution $Command.Substring($i, $found - $i) $Reading $Ctx)) { $Nested.Add($part) }
        }
        $newline = $Command.IndexOf("`n", $found, [System.StringComparison]::Ordinal)
        $i = if ([int]$newline -lt 0) { $Command.Length } else { $newline + 1 }
    }
    return $i
}

# For pwsh @' / @" at $Start: the body's start and end and the index after the closing quote-@,
# or $null when it is not a here-string.
function Get-ReviewGateHereString {
    param([string]$Command, [int]$Start, $Index)
    $j = $Start + 2
    while ([int]$j -lt $Command.Length -and ([int]$Command[$j] -eq 32 -or [int]$Command[$j] -eq 9)) { $j++ }
    if ([int]$j -lt $Command.Length -and [int]$Command[$j] -eq 13) { $j++ }
    if ([int]$j -ge $Command.Length -or [int]$Command[$j] -ne 10) { return $null }
    $closers = $Index.Dq
    if ([int]$Command[$Start + 1] -eq 39) { $closers = $Index.Sq }
    $found = Get-ReviewGateFirstAt $closers ($j + 1)
    if ([int]$found -lt 0) { return $null }
    return [PSCustomObject]@{ Start = $j + 1; End = $found; After = $found + 2 }
}

# Split $Command from $Start on real shell operators. With -InParen the scan reads the body of a
# $(...) and stops at its closing parenthesis, whose index is End. Nested holds the segments of every
# substitution, which run as commands. $Ctx.Skip says whether heredoc and here-string bodies are
# skipped as data, and skipping one sets $Ctx.Skipped; $Index.V holds the line index, built on first
# use and shared with the $(...) scans of the same text. See the Python twin's _scan.
function Invoke-ReviewGateScan {
    param([string]$Command, [string]$Reading, [int]$Start, [bool]$InParen, $Ctx, $Index)
    # Every substitution re-enters this function, so the open scans are counted, and put back at each return.
    $budget = Get-ReviewGateBudget $Ctx
    $budget.Nest++
    if ([int]$budget.Nest -gt $script:ReviewGateMaxSubstitutionDepth + 1) { throw 'review gate: substitution nesting over budget' }
    $r = $script:ReviewGateReadings[$Reading]
    $segments = [System.Collections.Generic.List[string]]::new()
    $nested = [System.Collections.Generic.List[string]]::new()
    $buffer = [System.Text.StringBuilder]::new()
    # 0 none, 39 single, 34 double, 1 bash $'...'
    $quote = 0
    $escaped = $false
    $depth = 0
    $heredocs = [System.Collections.Generic.List[object]]::new()
    # The reading's fields as locals and characters as ints: this loop runs once per character of
    # every command the hooks see. With a PowerShell call per character a 2.8 KB heredoc commit took
    # 179 ms in the pwsh reading; with ints, 37 ms (measured, 5-run average, 2026-10-31).
    $esc = [int][char]$r.Esc; $escInDq = $r.EscInDq; $seps = $r.Seps; $quotes = $r.Quotes
    $wsChars = $r.Ws.ToCharArray(); $ws = $r.Ws
    $isBash = Test-ReviewGateSame $Reading 'bash'
    $isPwsh = Test-ReviewGateSame $Reading 'pwsh'
    $isCmd = Test-ReviewGateSame $Reading 'cmd'
    # Comments are read only in the pass that skips data; see the Python twin's _scan.
    $comments = $Ctx.Skip -and ($isBash -or $isPwsh)
    $ampSplit = [bool]$Ctx.Amp
    $len = $Command.Length
    # Where a word starts, and the unquoted < or > (as an int, 0 for none) just added in the bash and
    # cmd readings; see boundary and redirect in the Python twin's _scan.
    $boundary = $true
    $redirect = 0
    # Whether the previous character started a word; a pwsh > counts only where it starts a redirection.
    $started = $false
    $i = $Start
    while ($i -lt $len) {
        $ch = $Command[$i]
        $c = [int]$ch
        $atBoundary = $boundary; $boundary = $false
        $afterRedirect = $redirect; $redirect = 0
        $prevStarted = $started; $started = $atBoundary
        if ($escaped) {
            [void]$buffer.Append($ch); $escaped = $false; $i++; continue
        }
        if ($quote -eq 39) {
            [void]$buffer.Append($ch)
            if ($c -eq 39) { $quote = 0 }
            $i++; continue
        }
        if ($quote -eq 1) {
            [void]$buffer.Append($ch)
            if ($c -eq 92) { $escaped = $true } elseif ($c -eq 39) { $quote = 0 }
            $i++; continue
        }
        if ($c -eq $esc -and ($quote -eq 0 -or $escInDq)) {
            # A line continuation: bash deletes \ + LF or CRLF, pwsh reads a backtick + LF or CRLF
            # outside quotes as whitespace. See the Python twin.
            $newline = 0
            if ($i + 1 -lt $len -and [int]$Command[$i + 1] -eq 10) { $newline = 2 }
            elseif ($i + 2 -lt $len -and [int]$Command[$i + 1] -eq 13 -and [int]$Command[$i + 2] -eq 10) { $newline = 3 }
            if ([int]$newline -gt 0 -and $isBash) { $boundary = $atBoundary; $i += $newline; continue }
            if ([int]$newline -gt 0 -and $isPwsh -and $quote -eq 0) {
                [void]$buffer.Append(' '); $boundary = $true; $i += $newline; continue
            }
            [void]$buffer.Append($ch); $escaped = $true; $i++; continue
        }
        if ($quote -eq 34 -and $c -eq 34) {
            [void]$buffer.Append($ch); $quote = 0; $i++; continue
        }
        if ($r.DollarParen -and $c -eq 36 -and $i + 1 -lt $len -and [int]$Command[$i + 1] -eq 40) {
            $sub = Invoke-ReviewGateScan $Command $Reading ($i + 2) $true $Ctx $Index
            foreach ($part in @($sub.Segments) + @($sub.Nested)) { $nested.Add($part) }
            [void]$buffer.Append(' ')
            $i = $sub.End + 1
            continue
        }
        if ($r.BacktickSubst -and $c -eq 96) {
            $sub = Get-ReviewGateBacktickBody $Command ($i + 1)
            foreach ($part in @(Split-ReviewGateCommand $sub.Body $Reading $Ctx)) { $nested.Add($part) }
            [void]$buffer.Append(' ')
            $i = $sub.End + 1
            continue
        }
        if ($quote -eq 34) { [void]$buffer.Append($ch); $i++; continue }

        # A # that starts a word comments to the end of the line; pwsh <# ... #> may span lines.
        if ($comments -and $atBoundary) {
            if ($c -eq 35) {
                $Ctx.Skipped = $true
                $i = Get-ReviewGateLineEnd $Command $i $isPwsh
                continue
            }
            if ($isPwsh -and $c -eq 60 -and $i + 1 -lt $len -and [int]$Command[$i + 1] -eq 35) {
                $Ctx.Skipped = $true
                $end = $Command.IndexOf('#>', $i + 2, [System.StringComparison]::Ordinal)
                [void]$buffer.Append(' ')
                $boundary = $true
                $i = if ([int]$end -lt 0) { $len } else { $end + 2 }
                continue
            }
        }
        if ($Ctx.Skip -and $r.HereString -and $c -eq 64 -and $i + 1 -lt $Command.Length -and
            ([int]$Command[$i + 1] -eq 39 -or [int]$Command[$i + 1] -eq 34)) {
            if ($null -eq $Index.V) { $Index.V = Get-ReviewGateLineIndex $Command }
            $found = Get-ReviewGateHereString $Command $i $Index.V
            if ($null -ne $found) {
                $Ctx.Skipped = $true
                if ([int]$Command[$i + 1] -eq 34) {
                    foreach ($part in @(Get-ReviewGateSubstitution $Command.Substring($found.Start, $found.End - $found.Start) $Reading $Ctx)) { $nested.Add($part) }
                }
                [void]$buffer.Append(' ')
                $i = $found.After
                continue
            }
        }
        # `<<<` is one operator; see the Python twin.
        if ($r.Heredoc -and $c -eq 60 -and $i + 2 -lt $len -and [int]$Command[$i + 1] -eq 60 -and [int]$Command[$i + 2] -eq 60) {
            [void]$buffer.Append('<<<')
            $i += 3
            continue
        }
        # A heredoc is read only outside parentheses: `$((1<<x))` and `(( x <<= 1 ))` shift.
        if ($Ctx.Skip -and $r.Heredoc -and $depth -eq 0 -and $c -eq 60 -and $i + 1 -lt $len -and [int]$Command[$i + 1] -eq 60) {
            $found = Get-ReviewGateHeredocWord $Command $i
            if ($null -ne $found) {
                $heredocs.Add($found)
                [void]$buffer.Append($Command.Substring($i, $found.End - $i))
                $i = $found.End
                continue
            }
        }
        # The & after a redirection's < or >, and bash's | after > (38, 124, 62).
        if (($c -eq 38 -and [int]$afterRedirect -ne 0) -or ($c -eq 124 -and [int]$afterRedirect -eq 62 -and $isBash)) {
            [void]$buffer.Append($ch); $i++; continue
        }
        # bash's &> and &>> are one redirection operator wherever they stand (38, 62), except in the dash
        # reading ($Ctx.Amp, N1); see the Python twin.
        if ($isBash -and -not $ampSplit -and $c -eq 38 -and $i + 1 -lt $len -and [int]$Command[$i + 1] -eq 62) {
            [void]$buffer.Append($ch); $i++; continue
        }
        # && and || (38, 124).
        if (($c -eq 38 -or $c -eq 124) -and $i + 1 -lt $Command.Length -and [int]$Command[$i + 1] -eq $c) {
            $segment = $buffer.ToString().Trim($wsChars)
            if ($segment) { Add-ReviewGateWork $budget $script:ReviewGateSegmentWork; $segments.Add($segment) }
            [void]$buffer.Clear()
            $boundary = $true
            $i += 2
            continue
        }
        if ($c -eq 41 -and $InParen -and $depth -eq 0) {
            $segment = $buffer.ToString().Trim($wsChars)
            if ($segment) { Add-ReviewGateWork $budget $script:ReviewGateSegmentWork; $segments.Add($segment) }
            $budget.Nest--
            return [PSCustomObject]@{ Segments = @($segments); Nested = @($nested); End = $i }
        }
        if ($c -eq 40) { $depth++ } elseif ($c -eq 41 -and $depth -gt 0) { $depth-- }
        if ($seps.Contains($ch)) {
            $segment = $buffer.ToString().Trim($wsChars)
            if ($segment) { Add-ReviewGateWork $budget $script:ReviewGateSegmentWork; $segments.Add($segment) }
            [void]$buffer.Clear()
            $boundary = $true
            if ($c -eq 10 -and $heredocs.Count -gt 0) {
                if ($null -eq $Index.V) { $Index.V = Get-ReviewGateLineIndex $Command }
                $after = Get-ReviewGateHeredocEnd $Command ($i + 1) @($heredocs) $Reading $nested $Ctx $Index.V
                $heredocs.Clear()
                if ([int]$after -ge 0) { $Ctx.Skipped = $true }
                $i = if ([int]$after -ge 0) { $after } else { $i + 1 }
                continue
            }
            $i++
            continue
        }
        if ($quotes.Contains($ch)) {
            $quote = $c
        } elseif ($isBash -and $c -eq 36 -and $i + 1 -lt $len -and [int]$Command[$i + 1] -eq 39) {
            $quote = 1
            [void]$buffer.Append("`$'")
            $i += 2
            continue
        }
        [void]$buffer.Append($ch)
        $boundary = $ws.Contains($ch)
        if ((($c -eq 60 -or $c -eq 62) -and ($isBash -or $isCmd)) -or ($c -eq 62 -and $isPwsh -and
                ($atBoundary -or ($prevStarted -and '123456*'.Contains($Command[$i - 1]))))) { $redirect = $c }
        $i++
    }
    $segment = $buffer.ToString().Trim($wsChars)
    if ($segment) { Add-ReviewGateWork $budget $script:ReviewGateSegmentWork; $segments.Add($segment) }
    $budget.Nest--
    return [PSCustomObject]@{ Segments = @($segments); Nested = @($nested); End = $Command.Length - 1 }
}

# Where the comment at $Start ends: the next newline, which still separates; pwsh also ends a line at CR.
function Get-ReviewGateLineEnd([string]$Command, [int]$Start, [bool]$Pwsh) {
    $end = if ($Pwsh) { $Command.IndexOfAny([char[]]@(10, 13), $Start) } else { $Command.IndexOf("`n", $Start, [System.StringComparison]::Ordinal) }
    if ([int]$end -lt 0) { return $Command.Length }
    return $end
}

function Split-ReviewGateCommand {
    param([string]$Command, [string]$Reading = 'bash', $Ctx = $null)
    if ($null -eq $Ctx) { $Ctx = @{ Skip = $true; Skipped = $false } }
    $scan = Invoke-ReviewGateScan $Command $Reading 0 $false $Ctx @{ V = $null }
    return @($scan.Segments) + @($scan.Nested)
}

# The index after the redirection operator that starts at $Text[$Start], a < or >; see the Python
# twin's _redirection_end for the operators of each reading.
function Get-ReviewGateRedirectionEnd([string]$Text, [int]$Start, [bool]$Cmd) {
    $c = [int]$Text[$Start]
    $after = if ([int]$Start + 1 -lt $Text.Length) { [int]$Text[$Start + 1] } else { 0 }
    $third = if ([int]$Start + 2 -lt $Text.Length) { [int]$Text[$Start + 2] } else { 0 }
    if ($Cmd) {
        if ([int]$after -eq 38 -or ($c -eq 62 -and [int]$after -eq 62)) { return $Start + 2 }
        return $Start + 1
    }
    if ($c -eq 62) {
        if ([int]$after -eq 62 -or [int]$after -eq 124 -or [int]$after -eq 38) { return $Start + 2 }
        return $Start + 1
    }
    if ([int]$after -eq 60) {
        if ([int]$third -eq 60 -or [int]$third -eq 45) { return $Start + 3 }
        return $Start + 2
    }
    if ([int]$after -eq 62 -or [int]$after -eq 38) { return $Start + 2 }
    return $Start + 1
}

# Split a segment into shell words; adjacent quoted and unquoted pieces stay one word. In the bash and
# cmd readings a redirection is dropped with its target and a touching fd number. In the pwsh reading a
# word that starts with a quote ends at its closing quote, and a redirection that starts a word after
# the command name is dropped with its target. See the Python twin's tokens for the measurements.
function Get-ReviewGateWord {
    param([string]$Segment, [string]$Reading = 'bash')
    $r = $script:ReviewGateReadings[$Reading]
    $words = [System.Collections.Generic.List[string]]::new()
    $buffer = [System.Text.StringBuilder]::new()
    $quote = 0
    $escaped = $false
    $esc = [int][char]$r.Esc; $escInDq = $r.EscInDq; $quotes = $r.Quotes; $ws = $r.Ws
    $isCmd = Test-ReviewGateSame $Reading 'cmd'
    $isPwsh = Test-ReviewGateSame $Reading 'pwsh'
    $isBash = Test-ReviewGateSame $Reading 'bash'
    $redirects = $isCmd -or $isBash
    # The next word is a redirection's target, not an argument.
    $target = $false
    # The current word started with a quote.
    $quotedStart = $false
    $i = 0
    while ($i -lt $Segment.Length) {
        $ch = $Segment[$i]
        $c = [int]$ch
        $i++
        if ($escaped) { [void]$buffer.Append($ch); $escaped = $false; continue }
        if ($quote -ne 0) {
            [void]$buffer.Append($ch)
            if ($c -eq $quote -and $isPwsh -and $i -lt $Segment.Length -and [int]$Segment[$i] -eq $quote) {
                [void]$buffer.Append($Segment[$i]); $i++
            } elseif ($c -eq $quote) {
                $quote = 0
                if ($isPwsh -and $quotedStart) {
                    $quotedStart = $false
                    if ($target) { $target = $false } else { $words.Add($buffer.ToString()) }
                    [void]$buffer.Clear()
                }
            } elseif ($c -eq $esc -and $quote -eq 34 -and $escInDq) { $escaped = $true }
            continue
        }
        if ($c -eq $esc) { [void]$buffer.Append($ch); $escaped = $true; continue }
        if ($quotes.Contains($ch)) { $quotedStart = $buffer.Length -eq 0; $quote = $c; [void]$buffer.Append($ch); continue }
        if ($isPwsh -and $c -eq 62 -and $words.Count -gt 0 -and ($buffer.Length -eq 0 -or
                ($buffer.Length -eq 1 -and '123456*'.Contains($buffer[0])))) {
            [void]$buffer.Clear()
            if ($i -lt $Segment.Length -and [int]$Segment[$i] -eq 38) {
                # A merge (2>&1) has no target; the rest of the word is a word of its own.
                $i += if ($i + 1 -lt $Segment.Length -and '0123456789'.Contains($Segment[$i + 1])) { 2 } else { 1 }
            } else {
                if ($i -lt $Segment.Length -and [int]$Segment[$i] -eq 62) { $i++ }
                $target = $true
            }
            continue
        }
        if ($isBash -and $c -eq 38 -and $i -lt $Segment.Length -and [int]$Segment[$i] -eq 62) {
            # bash's &> and &>> take no fd number; see the Python twin's tokens.
            $quotedStart = $false
            if ($buffer.Length -gt 0) {
                if ($target) { $target = $false } else { $words.Add($buffer.ToString()) }
                [void]$buffer.Clear()
            }
            $i = Get-ReviewGateRedirectionEnd $Segment $i $false
            $target = $true
            continue
        }
        $isWs = $ws.Contains($ch)
        $isRedirect = $redirects -and ($c -eq 60 -or $c -eq 62)
        if ($isWs -or $isRedirect) {
            $quotedStart = $false
            if ($isRedirect -and -not $target -and $buffer.Length -gt 0 -and $buffer.ToString() -cmatch '\A[0-9]+\z') { [void]$buffer.Clear() }
            if ($buffer.Length -gt 0) {
                if ($target) { $target = $false } else { $words.Add($buffer.ToString()) }
                [void]$buffer.Clear()
            }
            if ($isRedirect) {
                $i = Get-ReviewGateRedirectionEnd $Segment ($i - 1) $isCmd
                $target = $true
            }
            continue
        }
        [void]$buffer.Append($ch)
    }
    if ($buffer.Length -gt 0 -and -not $target) { $words.Add($buffer.ToString()) }
    return @($words)
}

# The number of o and O characters after the first in $Word: the options in a bash cluster that
# take the next word.
function Get-ReviewGateShellOptionArgCount([string]$Word) {
    $n = 0
    for ($k = 1; [int]$k -lt $Word.Length; $k++) {
        $c = [int]$Word[$k]
        if ($c -eq 111 -or $c -eq 79) { $n++ }
    }
    return $n
}

# Index in $Bare of a shell launcher's command string, given its -c cluster at $Bare[$Start]: the first
# word after bash's options. See the Python twin's _shell_payload_index.
function Get-ReviewGateShellPayloadIndex([string[]]$Bare, [int]$Start) {
    $pending = Get-ReviewGateShellOptionArgCount $Bare[$Start]
    $j = $Start + 1
    while ([int]$j -lt $Bare.Count) {
        $word = $Bare[$j]
        if ([int]$pending -gt 0) {
            $pending--
        } elseif ((Test-ReviewGateSame $word '--') -or (Test-ReviewGateSame $word '-')) {
            return $j + 1
        } elseif ($word.StartsWith('--', [System.StringComparison]::Ordinal)) {
            $pending = if (Test-ReviewGateOneOf $word @('--rcfile', '--init-file')) { 1 } else { 0 }
        } elseif ($word.Length -gt 1 -and ([int]$word[0] -eq 45 -or [int]$word[0] -eq 43)) {
            $pending = Get-ReviewGateShellOptionArgCount $word
        } else {
            return $j
        }
        $j++
    }
    return $j
}

# True when pwsh.exe reads $Option as -Command; see the Python twin's _pwsh_command_option.
function Test-ReviewGatePwshCommandOption([string]$Option) {
    if ($Option.Length -eq 0 -or -not ($script:ReviewGatePwshDashes + '/').Contains($Option[0])) { return $false }
    $name = $Option.Substring(1)
    if ([int]$Option[0] -ne 47 -and $name.Length -gt 0 -and [int]$name[0] -eq [int]$Option[0]) { $name = $name.Substring(1) }
    return $name.Length -gt 0 -and 'command'.StartsWith((ConvertTo-ReviewGateAsciiLower $name), [System.StringComparison]::Ordinal)
}

# The index after the /c or /k in a cmd.exe switch word, or -1; see the Python twin's _cmd_command_switch_end.
function Get-ReviewGateCmdCommandSwitchEnd([string]$Option) {
    if (-not $Option.StartsWith('/', [System.StringComparison]::Ordinal)) { return -1 }
    for ($k = 0; [int]$k -lt $Option.Length - 1; $k++) {
        if ([int]$Option[$k] -eq 47 -and (Test-ReviewGateOneOf ([string]$Option[$k + 1]).ToLowerInvariant() @('c', 'k'))) { return $k + 2 }
    }
    return -1
}

# True when the xargs option word $Option takes the next word as its argument; see the Python twin's
# _xargs_takes_next.
function Test-ReviewGateXargsTakesNext([string]$Option) {
    if ($Option.StartsWith('--', [System.StringComparison]::Ordinal)) {
        if ($Option.Contains('=')) { return $false }
        $name = $Option.Substring(2)
        $kind = 0
        if ($script:ReviewGateXargsLong.TryGetValue($name, [ref]$kind)) { return [int]$kind -eq 1 }
        $kinds = [System.Collections.Generic.List[int]]::new()
        foreach ($long in $script:ReviewGateXargsLong.Keys) {
            if ($long.StartsWith($name, [System.StringComparison]::Ordinal)) { $kinds.Add($script:ReviewGateXargsLong[$long]) }
        }
        return $kinds.Count -eq 1 -and [int]$kinds[0] -eq 1
    }
    for ($k = 1; [int]$k -lt $Option.Length; $k++) {
        if ($script:ReviewGateXargsShortOptional.Contains($Option[$k])) { return $false }
        if ($script:ReviewGateXargsShortWithArg.Contains($Option[$k])) { return [int]$k -eq $Option.Length - 1 }
    }
    return $false
}

# One object per argument the launcher's syntax says is a command: its text and its reading.
function Get-ReviewGateNestedCommand {
    param([string]$Executable, [string[]]$Rest, [string]$Reading = 'bash')
    if (-not (Test-ReviewGateNamed $Executable $script:ReviewGateLaunchers $Reading)) { return @() }
    $bare = @($Rest | ForEach-Object { Get-ReviewGatePlain $_ })
    # The texts one payload is read as, folded by the caller; see the Python twin's payload_texts.
    # One word loses its outer quotes, and in the bash reading is also read after bash's quote
    # removal when that differs (see the Python twin's word_payload_texts). Several are read joined
    # unquoted (ssh and pwsh -Command join the argv the outer shell unquoted) and joined as written
    # (xargs runs its argv with no shell). Never unquote the joined text: its first and last quotes
    # belong to two words. An opaque word is kept as written, so it still reads as AMBIGUOUS.
    function ConvertTo-ReviewGateNested([string[]]$Words, [string]$NestedReading) {
        if ($Words.Count -eq 1) {
            # Twin of OPAQUE_PAYLOAD: one word that is opaque in every reading.
            if (Test-ReviewGateOpaque $Words[0] $Reading) { return [PSCustomObject]@{ Command = '$''\x`u{0}'''; Reading = $NestedReading } }
            $outer = ConvertFrom-ReviewGateOuterQuote $Words[0]
            if ((Test-ReviewGateSame $Reading 'bash') -and -not (Test-ReviewGateOpaque $Words[0] $Reading)) {
                $removed = ConvertFrom-ReviewGateBashQuote (Get-ReviewGateTrim $Words[0]) -DollarQuote
                if (-not (Test-ReviewGateSame $removed $outer)) {
                    return @([PSCustomObject]@{ Command = $outer; Reading = $NestedReading },
                        [PSCustomObject]@{ Command = $removed; Reading = $NestedReading })
                }
            }
            return [PSCustomObject]@{ Command = $outer; Reading = $NestedReading }
        }
        $unquoted = @($Words | ForEach-Object { if (Test-ReviewGateOpaque $_ $Reading) { $_ } else { Get-ReviewGatePlain $_ } }) -join ' '
        $written = $Words -join ' '
        # One text when the two are equal (no word quoted); see the Python twin's payload_texts.
        if (Test-ReviewGateSame $unquoted $written) {
            return [PSCustomObject]@{ Command = $unquoted; Reading = $NestedReading }
        }
        # Two objects on the pipeline; callers collect them with @(), never with the unary comma.
        return @([PSCustomObject]@{ Command = $unquoted; Reading = $NestedReading },
            [PSCustomObject]@{ Command = $written; Reading = $NestedReading })
    }
    if (Test-ReviewGateNamed $Executable $script:ReviewGateShellLaunchers $Reading) {
        for ($i = 0; $i + 1 -lt $bare.Count; $i++) {
            $option = $bare[$i]
            if ($option.StartsWith('-', [System.StringComparison]::Ordinal) -and
                -not $option.StartsWith('--', [System.StringComparison]::Ordinal) -and
                $option.Substring(1).Contains('c')) {
                # bash's option grammar after -c was measured on bash and sh only; every other shell's
                # payload is read as the next word too, and the caller folds both. See the Python twin.
                $j = Get-ReviewGateShellPayloadIndex $bare $i
                $at = if ([int]$j -ne $i + 1 -and (Test-ReviewGateNamed $Executable $script:ReviewGateOtherShellLaunchers $Reading)) {
                    @(($i + 1), $j) } else { @($j) }
                $texts = [System.Collections.Generic.List[object]]::new()
                foreach ($k in $at) {
                    if ([int]$k -lt $Rest.Count) { foreach ($text in @(ConvertTo-ReviewGateNested @($Rest[$k]) 'bash')) { $texts.Add($text) } }
                }
                # N1: an sh, dash or ash payload holding &> is also read as dash reads it; only dash folds
                # with the unread rule (reading 'ampsh' for sh and ash). See the Python twin.
                if (Test-ReviewGateNamed $Executable $script:ReviewGateAmpSplitShells $Reading) {
                    $ampLabel = if (Test-ReviewGateNamed $Executable @('dash') $Reading) { 'dash' } else { 'ampsh' }
                    foreach ($text in @($texts)) {
                        if ($text.Command.Contains('&>')) { $texts.Add([PSCustomObject]@{ Command = $text.Command; Reading = $ampLabel }) }
                    }
                }
                return @($texts)
            }
        }
        return @()
    }
    if (Test-ReviewGateNamed $Executable $script:ReviewGatePowerShellLaunchers $Reading) {
        # Every word pwsh could read as -Command is a candidate, and each one's payload is read; see
        # the Python twin.
        $texts = [System.Collections.Generic.List[object]]::new()
        for ($i = 0; $i -lt $bare.Count; $i++) {
            if ((Test-ReviewGatePwshCommandOption $bare[$i]) -and $i + 1 -lt $Rest.Count) {
                foreach ($text in @(ConvertTo-ReviewGateNested @($Rest | Select-Object -Skip ($i + 1)) 'pwsh')) { $texts.Add($text) }
            }
        }
        return @($texts)
    }
    if (Test-ReviewGateNamed $Executable @('cmd') $Reading) {
        for ($i = 0; $i -lt $bare.Count; $i++) {
            $option = $bare[$i]
            $at = Get-ReviewGateCmdCommandSwitchEnd $option
            if ([int]$at -lt 0) { continue }
            # The command starts right after the switch letter; see the Python twin.
            $first = if (Test-ReviewGateSame $Rest[$i].Substring(0, [Math]::Min($at, $Rest[$i].Length)) $option.Substring(0, $at)) {
                $Rest[$i].Substring($at) } else { $option.Substring($at) }
            $words = [System.Collections.Generic.List[string]]::new()
            if ($first.Length -gt 0) { $words.Add($first) }
            foreach ($word in @($Rest | Select-Object -Skip ($i + 1))) { $words.Add($word) }
            if ($words.Count -gt 0) { return @(ConvertTo-ReviewGateNested @($words) 'cmd') }
        }
        return @()
    }
    if (Test-ReviewGateNamed $Executable @('ssh') $Reading) {
        $i = 0
        while ($i -lt $Rest.Count) {
            $option = $bare[$i]
            if (Test-ReviewGateSame $option '--') { $i++; break }
            if (-not $option.StartsWith('-', [System.StringComparison]::Ordinal)) { break }
            $i += if ((Test-ReviewGateOneOf $option $script:ReviewGateSshWithArg) -and $i + 1 -lt $Rest.Count) { 2 } else { 1 }
        }
        if ($i + 1 -lt $Rest.Count) {
            return @(ConvertTo-ReviewGateNested @($Rest | Select-Object -Skip ($i + 1)) 'bash')
        }
        return @()
    }
    if (Test-ReviewGateNamed $Executable @('xargs') $Reading) {
        $i = 0
        while ($i -lt $Rest.Count) {
            $option = $bare[$i]
            if (Test-ReviewGateSame $option '--') { $i++; break }
            if (-not $option.StartsWith('-', [System.StringComparison]::Ordinal)) { break }
            $i += if ((Test-ReviewGateXargsTakesNext $option) -and $i + 1 -lt $Rest.Count) { 2 } else { 1 }
        }
        # xargs runs its words itself, with no shell, so they keep the outer reading's quoting.
        if ($i -lt $Rest.Count) {
            return @(ConvertTo-ReviewGateNested @($Rest | Select-Object -Skip $i) $Reading)
        }
        return @()
    }
    if ((Test-ReviewGateNamed $Executable @('busybox') $Reading) -and $Rest.Count -gt 0 -and
        (Test-ReviewGateNamed $Rest[0] $script:ReviewGateShellLaunchers)) {
        # The words are the argv of the shell busybox names, re-read whole, so they keep their
        # quoting: `sh -c "git push"` must stay -c and one word.
        return ,[PSCustomObject]@{ Command = ($Rest -join ' '); Reading = 'bash' }
    }
    return @()
}

function Get-ReviewGateGuardedInvocation {
    param([string]$Command, [string]$Reading = 'bash', [string[]]$InheritedPaths = @(), [int]$Depth = 0, $Ctx = $null)
    if ($null -eq $Ctx) { $Ctx = @{ Skip = $true; Skipped = $false } }
    # The readings 'dash' and 'ampsh' are the bash reading with a lone & as an operator (N1); see the Python twin.
    $amp = Test-ReviewGateOneOf $Reading @('dash', 'ampsh')
    if ($amp) { $Reading = 'bash' }
    $budget = Get-ReviewGateBudget $Ctx
    if ($Depth -gt $script:ReviewGateMaxLauncherDepth) { throw 'review gate: launcher depth over budget' }
    if ($Depth -gt 0) {
        $budget.Readings++
        if ([int]$budget.Readings -gt $script:ReviewGateMaxNestedReadings) { throw 'review gate: nested readings over budget' }
    }
    # The text's length is charged before it is read; its segments are charged as the scan finds them.
    Add-ReviewGateWork $budget $Command.Length
    if (Test-ReviewGateSame $Reading 'pwsh') {
        $mappedCommand = [System.Text.StringBuilder]::new($Command.Length)
        foreach ($ch in $Command.ToCharArray()) {
            $mapped = $script:ReviewGatePwshQuotes[[int]$ch]
            if ($null -ne $mapped) { [void]$mappedCommand.Append($mapped) } else { [void]$mappedCommand.Append($ch) }
        }
        $Command = $mappedCommand.ToString()
    }
    $prefixPaths = @($InheritedPaths) + @(Get-ReviewGateLeadingCdPath $Command)
    Assert-ReviewGateContextPathCount $prefixPaths.Count
    $guardedInvocations = [System.Collections.Generic.List[object]]::new()
    # Set before each scan of this text, which reads it whole before any launcher payload is read.
    $Ctx.Amp = $amp
    foreach ($segment in @(Split-ReviewGateCommand $Command $Reading $Ctx)) {
        if ([string]::IsNullOrEmpty($segment)) { continue }
        $tokens = @(Get-ReviewGateWord $segment $Reading)
        $leading = Get-ReviewGateLeadingExecutable $tokens $Reading
        if ($null -eq $leading.Executable) { continue }
        $verdict = Get-ReviewGateVerdictFromInvocation $leading.Executable $leading.Rest $Reading
        if ($verdict) {
            $gitContext = if (Test-ReviewGateNamed $leading.Executable @('git') $Reading) {
                Get-ReviewGateGitContextPath $leading.Rest
            } else { [PSCustomObject]@{ Paths = @(); Unsupported = $false } }
            $invocationPaths = @($prefixPaths) + @($gitContext.Paths)
            Assert-ReviewGateContextPathCount $invocationPaths.Count
            $guardedInvocations.Add([PSCustomObject]@{
                Verdict = $verdict
                Paths = $invocationPaths
                Unsupported = ($gitContext.Unsupported -or $leading.Chdir)
                Verb = $null
            })
            continue
        }
        # Alternative readings of ONE payload, folded so the gate never finds fewer than either.
        $found = $null
        foreach ($nestedCommand in @(Get-ReviewGateNestedCommand $leading.Executable $leading.Rest $Reading)) {
            $got = @(Get-ReviewGateGuardedInvocation $nestedCommand.Command $nestedCommand.Reading $prefixPaths ($Depth + 1) $Ctx)
            $found = if ($null -eq $found) { $got } else { @(Get-ReviewGateCombined $found $got -NoUnreadFold:(Test-ReviewGateSame $nestedCommand.Reading 'ampsh')) }
        }
        $foundAny = $false
        foreach ($guardedInvocation in @($found)) {
            if ($null -eq $guardedInvocation) { continue }
            $foundAny = $true
            # A wrapper option that moved the directory moves the payload's invocations too.
            if ($leading.Chdir -and -not (Test-ReviewGateSame $guardedInvocation.Verdict 'UNREAD')) {
                $guardedInvocation = [PSCustomObject]@{
                    Verdict = $guardedInvocation.Verdict
                    Paths = $guardedInvocation.Paths
                    Unsupported = $true
                    Verb = $guardedInvocation.Verb
                }
            }
            $guardedInvocations.Add($guardedInvocation)
        }
        # Only in the pass that skips heredoc and here-string bodies and comments (rule a).
        if (-not $foundAny -and $Ctx.Skip) {
            $verb = Get-ReviewGateUnreadVerb $leading.Executable $leading.Rest $tokens $Reading $budget
            if ($null -ne $verb) {
                $guardedInvocations.Add([PSCustomObject]@{ Verdict = 'UNREAD'; Paths = @(); Unsupported = $false; Verb = $verb })
            }
        }
    }
    return @($guardedInvocations)
}

function Test-ReviewGateSameInvocation($A, $B) {
    if (-not (Test-ReviewGateSame $A.Verdict $B.Verdict)) { return $false }
    if (-not (Test-ReviewGateSame ([string]$A.Verb) ([string]$B.Verb))) { return $false }
    if ([int]$A.Unsupported -ne [int]$B.Unsupported) { return $false }
    $pathsA = @($A.Paths); $pathsB = @($B.Paths)
    if ($pathsA.Count -ne $pathsB.Count) { return $false }
    for ($i = 0; $i -lt $pathsA.Count; $i++) { if (-not (Test-ReviewGateSame $pathsA[$i] $pathsB[$i])) { return $false } }
    return $true
}

# The guarded invocations of two readings of one command, never fewer than either finds; see the
# Python twin's _combine for the rule.
function Get-ReviewGateCombined($First, $Second, [switch]$NoUnreadFold) {
    $first = @($First); $second = @($Second)
    # A lone unread entry beside one real invocation of its own verb is that invocation, except between
    # the two skip passes (-NoUnreadFold; Decision 4 rule b, ruling 2026-11-08); see the Python twin.
    foreach ($pair in @(@{ A = $first; B = $second }, @{ A = $second; B = $first })) {
        $a = @($pair.A); $b = @($pair.B)
        if (-not $NoUnreadFold -and $a.Count -eq 1 -and $b.Count -eq 1 -and (Test-ReviewGateSame $a[0].Verdict 'UNREAD') -and
            (Test-ReviewGateSame $b[0].Verdict ([string]$a[0].Verb))) {
            return @($b)
        }
    }
    if ($first.Count -gt 1 -or $second.Count -gt 1) { return @($first) + @($second) }
    if ($first.Count -eq 1 -and $second.Count -eq 1 -and -not (Test-ReviewGateSameInvocation $first[0] $second[0])) {
        return @([PSCustomObject]@{ Verdict = 'AMBIGUOUS'; Paths = @(); Unsupported = $false; Verb = $null })
    }
    if ($first.Count -eq 1) { return @($first) }
    return @($second)
}

# One reading's guarded invocations, with heredoc and here-string bodies skipped and without,
# combined; see the Python twin's _read for why.
# $Budget is the classification's counters, shared by both passes.
function Get-ReviewGateReadInvocation {
    param([string]$Command, [string]$Reading, $Budget)
    $skipping = @{ Skip = $true; Skipped = $false; Budget = $Budget }
    $found = @(Get-ReviewGateGuardedInvocation $Command $Reading @() 0 $skipping)
    if (-not $skipping.Skipped) { return @($found) }
    $unskipped = @(Get-ReviewGateGuardedInvocation $Command $Reading @() 0 @{ Skip = $false; Skipped = $false; Budget = $Budget })
    return @(Get-ReviewGateCombined $found $unskipped -NoUnreadFold)
}

function Get-ReviewGateCommandContext {
    param([string]$Command, [string]$Reading = '')
    if (Test-ReviewGateTooLarge $Command) { return [PSCustomObject]@{ Verdict = 'AMBIGUOUS'; Paths = @(); Unsupported = $false } }
    $budget = @{ Readings = 0; Nest = 0; Work = 0 }
    try {
        # With no tool_name to say which shell runs it, the command is read as bash AND as pwsh.
        $guardedInvocations = if ($Reading) { @(Get-ReviewGateReadInvocation $Command $Reading $budget) } else {
            @(Get-ReviewGateCombined @(Get-ReviewGateReadInvocation $Command 'bash' $budget) @(Get-ReviewGateReadInvocation $Command 'pwsh' $budget))
        }
    } catch {
        # A refusal is a verdict, never an exception (a budget, "call depth overflow", a bug): a throw
        # sent the hooks to their substring fallback, which allowed `git -C . push`. See the Python twin.
        return [PSCustomObject]@{ Verdict = 'AMBIGUOUS'; Paths = @(); Unsupported = $false }
    }
    if ($guardedInvocations.Count -gt 1) {
        return [PSCustomObject]@{ Verdict = 'MULTI'; Paths = @(); Unsupported = $false }
    }
    if ($guardedInvocations.Count -eq 1) {
        $only = $guardedInvocations[0]
        if (((Test-ReviewGateSame $only.Verdict 'COMMIT') -or (Test-ReviewGateSame $only.Verdict 'PUSH')) -and
            (Test-ReviewGateNamesGitContextEnv $Command)) {
            return [PSCustomObject]@{ Verdict = $only.Verdict; Paths = @(); Unsupported = $true }
        }
        return $only
    }
    return [PSCustomObject]@{ Verdict = 'NONE'; Paths = @(); Unsupported = $false }
}

function Get-ReviewGateCommandVerdict {
    param([string]$Command, [string]$Reading = '')
    return (Get-ReviewGateCommandContext $Command $Reading).Verdict
}

# The reading the payload's tool runs its command with, or '' when the tool is unknown.
function Get-ReviewGatePayloadReading {
    param($Data)
    $tool = $Data.tool_name
    if ($tool -isnot [string]) { $tool = $Data.toolName }
    if (Test-ReviewGateSame $tool 'Bash') { return 'bash' }
    if (Test-ReviewGateSame $tool 'PowerShell') { return 'pwsh' }
    return ''
}

# Stdin as UTF-8. [Console]::In decodes with the console code page (IBM437 here, measured), which
# turned the pwsh quotes U+2018-U+201E in Claude Code's raw UTF-8 into other characters before the
# pwsh reading saw them. The same reader as scripts/dangerous-commands.ps1, whose comment has the
# measurements behind its BOM setting.
function Read-ReviewGateStdin {
    if (-not [Console]::IsInputRedirected) { return '' }
    return (New-Object System.IO.StreamReader([Console]::OpenStandardInput(),
        (New-Object System.Text.UTF8Encoding($false)), $true)).ReadToEnd()
}

function Get-ReviewGateVerdictFromPayload {
    param([string]$Raw)
    if ([string]::IsNullOrWhiteSpace($Raw)) { throw 'empty payload' }
    $data = $Raw | ConvertFrom-Json -ErrorAction Stop
    $toolInput = $data.tool_input
    if ($null -eq $toolInput) { $toolInput = $data.toolInput }
    if ($null -eq $toolInput) { throw 'tool input missing' }
    $command = $toolInput.command
    if ($command -isnot [string] -or [string]::IsNullOrWhiteSpace($command)) { return 'NONE' }
    return Get-ReviewGateCommandVerdict $command (Get-ReviewGatePayloadReading $data)
}

if (-not (Test-ReviewGateSame $MyInvocation.InvocationName '.')) {
    try {
        $raw = Read-ReviewGateStdin
        Get-ReviewGateVerdictFromPayload $raw
        exit 0
    } catch {
        exit 1
    }
}
