<#
.SYNOPSIS
    PreToolUse hook — 3-tier dangerous command guardrails for Claude Code.
.DESCRIPTION
    Reads the Bash tool input JSON from stdin, extracts the command string,
    and enforces BLOCK / CONFIRM / WARN tier matching via simple substring and
    regex checks. All output is ONE JSON object on stdout: plain stdout from a
    PreToolUse hook never reaches the model and is not shown in the visible
    transcript (per Claude Code's docs; it only records it), so a deny uses
    permissionDecision, a WARN uses systemMessage (user) + additionalContext
    (model), and any text beside the object would void it. Fails open on a
    genuine read failure: exits 0 (with a [HOOK ERROR] systemMessage if the
    read itself threw). On a JSON-parse failure with non-empty
    stdin, falls back to matching tier patterns against the decoded payload instead
    of exiting immediately -- see the WHY comment on the catch block below.

    WHY hookSpecificOutput.permissionDecision, not exit code: top-level exit codes are
    unreliable here -- settings.json wires this hook as "... 2>/dev/null || bash ... || true"
    for cross-platform fail-open portability, and that "|| true" suffix silently converts any
    nonzero exit code to 0. This was empirically confirmed while building review-reminders.ps1:
    a hook using "exit 1" to signal block did not actually prevent the tool call from running.
    hookSpecificOutput.permissionDecision = "deny" is read from stdout JSON regardless of the
    wrapping shell's final exit code, so it's the only reliable way to actually block.
#>

param()

# Centralized tier messages — all pattern matches use these templates, no custom text per pattern.
$BLOCK_MSG   = "BLOCK: {0}. Refusing this command."
$CONFIRM_MSG = "CONFIRM REQUIRED: {0}. Approve only if you intend this."
$WARN_MSG    = "WARNING: {0}. Proceeding."

try {
    # WHY a raw UTF-8 read rather than `$input | Out-String`: PowerShell decodes piped stdin using
    # [Console]::InputEncoding, which on Windows is the OEM console code page -- ibm437 on the
    # machine where this was found, never UTF-8. Any non-ASCII byte in a command therefore arrived
    # mangled. Proven end-to-end 2026-08-30 by probing the child process: 45 U+3042 characters
    # (50 chars / 140 UTF-8 bytes) reached the hook as 140 single-byte CP437 characters, which
    # re-encode to 275 UTF-8 bytes -- so the size guard below over-counted by ~2x and could fire a
    # spurious CONFIRM on a command well under the limit. Fail-safe in direction, wrong regardless.
    # SCOPE OF THIS FIX, stated so it is not over-read: it corrects the DECODING of stdin. It does
    # not address TRUNCATION -- .pmb-hook-errors.log records JSON-parse failures of the form
    # "Unterminated string" and "Unexpected end when deserializing object" both before and after
    # this change, which means the payload sometimes arrives incomplete for a reason not
    # diagnosed here. On that path the catch block below falls back to decoded-payload matching, and a BLOCK
    # substring past the truncation point would not be seen. Open, not closed.
    # The sh twin is not affected, because bash hands piped bytes to the script unchanged and never
    # re-decodes them through a code page. (dangerous-commands.sh's round-8 comment is about a
    # DIFFERENT bug -- ${#cmd} counting locale characters rather than bytes -- and is cited here
    # only as evidence this pair has been bitten by character-vs-byte confusion before, NOT as
    # support for the claim about stdin decoding.)
    # IsInputRedirected guards the interactive case, where ReadToEnd() would otherwise block --
    # preserving the fail-open-on-empty-stdin behaviour the early exit below depends on.
    # detectEncodingFromByteOrderMarks is $true, and this is a TRADE, not a pure win.
    #
    # Measured across 10 byte-level cases against three variants ($true = here, $false, and main's
    # pre-branch `$input | Out-String`):
    #   $true  DENIES utf8/utf8-BOM and UTF-16 LE+BE and UTF-32 LE+BE with BOM; PASSES the malformed
    #          FF FE-or-FE FF followed by UTF-8 hybrid.
    #   $false is behaviourally IDENTICAL to main on all eight real-encoding cases, and DENIES the
    #          two hybrid cases.
    # So $true gains four genuine multi-byte encodings and loses two malformed hybrids. Both classes
    # are unreachable through the documented producer -- Claude Code writes byte 0 of this stdin and
    # emits BOM-less UTF-8 -- which is INFERRED about a third-party binary, not verified here.
    #
    # THE HISTORY, because three wrong versions were recorded before this one:
    #   (1) "A UTF-16 BOM bypasses the BLOCK tier" -- reproduced with the FF FE + UTF-8 hybrid, which
    #       no producer emits. Set $false to fix it.
    #   (2) "$false was a regression that introduced a bypass" -- also wrong. $false matches main
    #       exactly on every real encoding; it fixed nothing and broke nothing.
    #   (3) "The hybrid failed to match for a reason unrelated to the setting" -- falsified by
    #       measurement: the setting is the ONLY reason. $true passes it, $false denies it.
    # The reusable lesson is that each wrong version was asserted from a proxy rather than measured
    # against the real input, including the self-critical one.
    #
    # The fix that actually mattered is the StreamReader with UTF8Encoding replacing
    # `$input | Out-String`, which corrects OEM-code-page decoding of the common no-BOM path.
    #
    # COVERAGE, counted rather than inferred from the Describe's existence: 3 of the 10 cases above
    # are asserted in tests/dangerous-commands.Tests.ps1 "encoding pinning (raw bytes)" -- utf8
    # no-BOM, utf8+BOM, and utf16LE+BOM, plus a benign control. UTF-16 BE, UTF-32 LE/BE and BOTH
    # hybrids are asserted nowhere in tests/. So the single-setting revert IS pinned (flipping to
    # $false turns the utf16LE case red), but the breadth of the trade is not: a change that keeps
    # UTF-16 LE working while breaking BE or UTF-32 would ship green.
    # An earlier draft of this line said "all ten", inferred from the Describe rather than counted --
    # which is the same proxy-for-measurement error the paragraph above records three times.
    $raw = if ([Console]::IsInputRedirected) {
        (New-Object System.IO.StreamReader(
            [Console]::OpenStandardInput(),
            (New-Object System.Text.UTF8Encoding($false)),
            $true)).ReadToEnd()
    } else { "" }
    if ([string]::IsNullOrWhiteSpace($raw)) { exit 0 }
    $data = $raw | ConvertFrom-Json -ErrorAction Stop
    # WHY .tool_input.command, not .command: the real payload nests everything under
    # "tool_input" (e.g. {"tool_name":"Bash","tool_input":{"command":"..."}}), confirmed
    # by capturing a live hook payload. The prior version read $data.command (flat),
    # which is always null against the real payload shape -- $cmd was always "", so no
    # BLOCK/CONFIRM/WARN pattern has ever matched anything, regardless of exit code.
    $cmd = if ($data.tool_input.command) { [string]$data.tool_input.command } else { "" }
} catch {
    # WHY fall back to matching the whole payload (not exit 0 immediately) on a JSON-parse
    # failure: exiting here would silently disable the guardrail on a parse error, the wrong
    # direction for a safety gate. Its cost is that text in every other field, such as
    # `description`, is matched too. Only applies when $raw was actually captured (the
    # IsNullOrWhiteSpace early-exit above already handles the genuine "nothing to check" case,
    # which this catch block never reaches).
    #
    # CORRECTED 2026-10-14: this comment used to say raw matching "never misses a true positive"
    # and that it "mirrors dangerous-commands.sh's identical fallback exactly". Neither held. With
    # JSON escapes still encoded, a newline was the two characters `\n`, so a split pipe, a
    # continuation line, or a `git` row after a newline got no verdict -- and a bare `git merge`
    # was followed by the closing `"`, not the end of string. The payload is now decoded first,
    # as in the sh twin: escapes become their characters, `\u0000` becomes nothing, and an
    # unescaped `"` (a string delimiter) becomes a space. A non-ASCII `\uXXXX` becomes the real
    # character here, which is what this hook's own parsed path sees; the sh twin wrote `?` until
    # 2026-11-15 and now writes the UTF-8 bytes too. The trigger still differs: this hook has no python3
    # dependency, so it falls back only when parsing fails, while the sh hook also falls back
    # whenever python3 is missing.
    if ($raw) {
        $cmd = [regex]::Replace($raw, '\\(?:u([0-9A-Fa-f]{4})|(["\\/bfnrt]))|"', {
            param($m)
            if ($m.Value -eq '"') { ' ' }
            elseif ($m.Groups[1].Success) {
                $v = [Convert]::ToInt32($m.Groups[1].Value, 16)
                if ($v -eq 0) { '' } else { [string][char]$v }
            }
            else { @{ '"' = '"'; '\' = '\'; '/' = '/'; b = "`b"; f = "`f"; n = "`n"; r = "`r"; t = "`t" }[$m.Groups[2].Value] }
        })
        try { Add-Content ".pmb-hook-errors.log" "[$((Get-Date).ToString('yyyy-MM-dd HH:mm:ss', [cultureinfo]::InvariantCulture))] [HOOK] dangerous-commands.ps1: JSON parse failed, fell back to decoded-payload matching: $_" -ErrorAction SilentlyContinue } catch { Write-Verbose "Could not write .pmb-hook-errors.log; ignoring." }
    } else {
        [ordered]@{ systemMessage = "[HOOK ERROR] dangerous-commands.ps1 failed unexpectedly. Proceeding in fails-open mode." } |
            ConvertTo-Json -Compress | Write-Output
        try { Add-Content ".pmb-hook-errors.log" "[$((Get-Date).ToString('yyyy-MM-dd HH:mm:ss', [cultureinfo]::InvariantCulture))] [HOOK] dangerous-commands.ps1: $_" -ErrorAction SilentlyContinue } catch { Write-Verbose "Could not write .pmb-hook-errors.log; ignoring." }
        exit 0
    }
}

# WHY join backslash-newline continuations before any tier matching: the shell parser
# removes a backslash followed by a newline before the command ever reaches git, so
#     git config commit.gpgsign \
#       false
# executes exactly as `git config commit.gpgsign false`. The hook receives the raw two-line
# text, and no pattern's key-to-value glue matches a backslash or a newline -- so the gate
# stayed silent while signing was genuinely disabled. See dangerous-commands.sh for the live
# verification and the full rationale; this predates the commit-signing patterns and is not
# specific to them (a BLOCK substring such as "git push --force" was equally evadable).
#
# WHY $cmd globally rather than a separate copy for one tier: the goal is to make the hook's
# view match what the shell will actually run, which is correct for every tier.
#
# WHY \r? is present: the payload may carry CRLF on Windows, and the backslash must still be
# recognized as line-final. The sh twin's awk rule matches /\\[\r]?$/ for the same reason.
#
# The first attempt replaced only the backslash-newline and left the continuation line's
# indentation. That works for the signing regexes, which glue with ` *`, but silently broke
# the BLOCK tier -- those are literal substrings, so "git push \<newline>  --force" joined to
# "git push   --force" and no longer contained "git push --force".
# WHY the join DELETES rather than substitutes, with whitespace collapsed separately: shell
# backslash-newline elision inserts nothing. Substituting a space broke the no-whitespace case
# ("rm -r\<nl>f" -> "rm -r f", losing the literal "rm -rf"), while not stripping the indent broke
# the indented case ("git push \<nl>  --force" -> "git push   --force"). Both were live bypasses
# found by review. Deletion reproduces the shell; collapsing blank runs reproduces its
# tokenization. See dangerous-commands.sh for the full history.
# The property this protects, which must survive any future edit here: dangerous-commands.ps1's
# boundary regex uses \s (Unicode-aware, matches NBSP and other Unicode space separators) while
# dangerous-commands.sh's confirm_boundary() uses POSIX [[:space:]] (locale-dependent, typically
# ASCII-only). A single-character substitution -- an NBSP in place of the space after "git merge"
# -- therefore bypassed the CONFIRM gate on one platform but not the other, verified by direct
# execution. Folding tabs to a plain literal space lets both boundary checks compare against one
# ASCII character, with no character-class or locale ambiguity. This deliberately does NOT fold
# other Unicode whitespace (NBSP, em-space) to a boundary character on either side: those stay
# non-boundaries consistently everywhere, rather than a boundary on one platform only.
#
# WHY tab folding lives HERE and nowhere else, added round 8: it used to ALSO happen in a separate
# earlier step. Two sufficient mechanisms for one property meant no behavioural test could
# discriminate either -- neutering the earlier step left every tab assertion byte-identically
# green, so the regression guard for the parity bug above was already dead while still looking
# healthy. Redundant normalization in a matcher does not add safety; it removes testability.
# Keep exactly ONE folding site so the tests can prove it.
# WHY NUL is deleted, 2026-11-15: the sh twin cannot hold one -- bash command substitution drops it
# -- so `git merge main<NUL>` was a card there and, under the ASCII-only rule in Ask, a deny here.
# Deleting it makes both twins match the same text. This hook's own parse-failure fallback already
# decodes `\u0000` to nothing. It runs BEFORE the continuation fold because sh drops NUL before
# that fold too: deleted after it, `\<NUL><LF>` stayed unjoined here, so `git push origin
# \<NUL><LF>--force` lost its BLOCK match and got the card of a later CONFIRM row.
$cmd = $cmd -replace "`0", ''
$cmd = $cmd -replace '\\\r?\n', ''
$cmd = $cmd -replace '[ \t]+', ' '

# WHY a second, aggressively de-escaped view: a shell strips a backslash before ANY character,
# not only before a newline, and concatenates adjacent quoted segments with no separator. So
# `r\m -r\f` runs as `rm -rf`, and `git config "commit."'gpgsign' false` runs as
# `git config commit.gpgsign false`. The faithful view above models only backslash-NEWLINE
# elision and cannot see either. Both were live, unprompted bypasses of the BLOCK and CONFIRM
# tiers respectively, and both PRE-DATE the commit-signing work.
#
# WHY match both views rather than replacing the faithful one: this view is deliberately NOT
# faithful -- it destroys information a real shell keeps. Matching it in ADDITION can only ever
# ADD a match, never remove one, so the change is strictly fail-closed. Kept identical in intent
# with the sh twin's $cmd_loose, carriage returns included; see dangerous-commands.sh for the full
# rationale, and the CR-deleted view below.
#
# KNOWN COST, stated rather than hidden: stripping quotes creates matches a real shell would not
# produce -- `echo "rm" "-rf"` collapses to `echo rm -rf` and now trips BLOCK. Same accepted
# class as the documented quoted-invocation-as-text false positive.
$cmdLoose = ($cmd -replace '[\\"'']', '') -replace ' +', ' '

# WHY a THIRD view with carriage returns deleted, added 2026-10-14: this hook judges two shells that
# treat a CR in opposite ways. Git Bash deletes a CR while parsing (measured), so `git push --for`,
# CR, `ce` runs as a force push -- and this hook, not the sh twin, judges the Bash tool whenever
# pwsh is present. PowerShell reads a lone CR as a statement break (measured with its parser), so
# `x`, CR, `g"it" merge main` runs git. A first version deleted CRs inside $cmdLoose itself; that
# glued `x` to `git` and dropped verdicts the CR-keeping view gave, including a BLOCK, on the
# PowerShell tool (round-2 review, finding OPP-1). Keeping $cmdLoose as it was and matching this
# view IN ADDITION can only add matches, which is the rule every view here follows. The sh twin
# does the same (cmd_loose_nocr), so both hooks give the Bash tool one verdict on CR shapes.
#
# WHY $DcNoCrDiffers gates every use: without a CR this view equals $cmdLoose, so matching it again
# only repeats a pass that already failed. Measured on the ~50 KB worst case, dense `git `, it added
# about half again (medians of three interleaved runs on one machine, 2026-10-15: 19.5 s at
# e3c2f43, 28.8 s with the view ungated, 18.8 s gated). Skipping an identical string cannot change
# a verdict. A command that does hold a CR still pays the extra pass; see the worst-case figures in
# standards/SECURITY-GUARDRAILS.md.
# WHY an ordinal comparison and not -cne: PowerShell's string operators compare by culture, and a
# culture comparison ignores some code points (a soft hyphen compares equal to nothing, measured),
# so two strings that differ could compare equal and skip a view that would have matched.
$cmdLooseNoCr = ($cmdLoose -replace '\r', '') -replace ' +', ' '
$DcNoCrDiffers = -not [string]::Equals($cmdLooseNoCr, $cmdLoose, [System.StringComparison]::Ordinal)

# WHY Singleline, added round 9 alongside the `.*` gaps: under `grep -z` the sh twin treats the
# whole payload as ONE record, so its `.` matches a newline. .NET's `.` does NOT, unless
# Singleline is set. With the gaps written as `[^|;&]*` that difference was latent -- no pattern
# contained a bare `.`. Introducing `.*` would have activated it, giving opposite verdicts on any
# multi-line command: verified, `git status<LF>echo hello --no-gpg-sign` matches in grep -z and
# does not in .NET without this flag.
#
# This is the THIRD time this exact line-vs-string mismatch has come up in this file -- `sed`
# vs .NET `-replace` in round 4, `grep` vs `-imatch` in round 6 (fixed with -z), and now `.`
# vs `.`. confirm_regex()'s comment in the sh twin asked that a third instance be made harder
# to write; this is that instance, handled at the same time as the change that would cause it.
#
# WHY CultureInvariant: IgnoreCase alone folds case by the CURRENT culture's rules, and under
# tr-TR (and az) upper-case `I` does not fold to `i`. Measured on pwsh 7 with the thread culture
# set to tr-TR, on a copy of this file without CultureInvariant: an upper-case config key --
# `git config COMMIT.GPGSIGN false`, `git -c COMMIT.GPGSIGN=false commit`, which git accepts --
# got no CONFIRM, and `| IEX` did not match the [NS-38] iex regexes below, a BLOCK regression
# against the OrdinalIgnoreCase literals they replace. Invariant folding can only ADD matches for
# these ASCII patterns. The sh twin narrows the same gap by running its regex rows under C.UTF-8
# and C, with its de-escaped view rewritten to count one unit per character -- see dc_grep and cmd_loose
# there, and standards/SECURITY-GUARDRAILS.md.
$DcRegexOpts = [System.Text.RegularExpressions.RegexOptions]'IgnoreCase, Singleline, CultureInvariant'

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

# WHY the CONFIRM rows ask rather than deny, changed 2026-11-14: a deny told the agent to hand the
# user a command to run, which the user cannot do from the phone over Remote Control. An "ask"
# shows an Allow/Deny card with this reason, and the user's click is a per-action approval the
# agent cannot write. Measured 2026-11-14 in auto mode: the card appeared and waited for a click
# even though settings.json allows `Bash(git *)`. Two things this depends on:
# - $blockPatterns runs BEFORE $confirmPatterns. A CONFIRM match exits with ask, so a BLOCK row
#   after it would never be reached and a BLOCK command would become a prompt.
# - The deny that says the guard could not analyze a command (the length limit) stays deny: an
#   unanalyzed command may hold a BLOCK pattern.
function Ask {
    param([string]$Reason)
    # WHY a command holding anything outside printable ASCII (plus tab, LF, CR) is denied instead of
    # asked, 2026-11-15: .NET and the sh twin's grep disagree on non-ASCII input (gap units, \s vs
    # [[:space:]], case folding), so a BLOCK row could match in one twin and not the other and the
    # same command became a deny in one and a card in the other. See ask() in dangerous-commands.sh.
    if ($cmd -cmatch '[^\x20-\x7E\t\n\r]') {
        Deny (($Reason -replace ' Approve only if you intend this\.$', '') + " The command holds a character outside printable ASCII, which this guard cannot match the same way in its sh and PowerShell versions, so it is refused rather than offered as an approval card. Run manually if intentional.")
        return
    }
    @{
        hookSpecificOutput = @{
            hookEventName            = "PreToolUse"
            permissionDecision       = "ask"
            permissionDecisionReason = $Reason
        }
    } | ConvertTo-Json -Compress | Write-Output
}

# WHY a length bound before any matching, and why it is defined AFTER Deny: the CONFIRM regexes
# contain gap groups of the shape `git (<gap>)config (<gap>)`, and .NET's backtracking engine
# blows up on a long run containing many `config` tokens and none of `|`, `;` or `&`. GNU grep
# uses a DFA and stays flat, so this blowup is .NET-side -- but the bound is applied identically
# in BOTH shells, because a guard that behaves differently per platform is precisely the defect
# class this file has already shipped twice.
#
# ROUND 8: growth was measured to be CUBIC, not quadratic (~8x per doubling), making the real
# worst case at this bound ~47 minutes rather than the "roughly 8 seconds" previously claimed.
# Only the two NESTED-gap `config` patterns blow up; they are bounded to {0,255} -- not 300,
# because POSIX guarantees repetition bounds only up to 255 and the sh twin's grep must compile
# the same regex; see the WHY-255 note in dangerous-commands.sh. The two
# single-gap patterns are deliberately left unbounded -- bounding them broke the --no-gpg-sign
# CONFIRM for any ordinary commit message, because that gap holds the message rather than flags.
# See dangerous-commands.sh for the per-pattern measurements and why test assertions were
# preferred to a regex timeout.
#
# WHY it denies rather than truncating: truncation is fail-OPEN -- a dangerous substring
# straddling the cut point would simply vanish.
#
# WHY UTF8.GetByteCount and not .Length: .NET's .Length counts UTF-16 code units, so this side
# used to count LOW on any non-ASCII command and admit payloads the sh twin refused -- a fail-open
# divergence. Counting UTF-8 BYTES fixes this half.
#
# CORRECTED round 8: an earlier version of this comment claimed the change made the two shells
# "agree by construction". It did not -- it inverted the divergence. The sh twin was using
# `${#cmd}`, which counts characters in the CURRENT LOCALE, so under the UTF-8 locales CI actually
# runs under bash counted LOW while this side counted bytes. The sh side now measures with
# `wc -c`, which is byte-based in every locale; only that made the two units genuinely equal.
$DcMaxCmd = if ($env:DC_MAX_CMD) { [int]$env:DC_MAX_CMD } else { 50000 }
$cmdLen = [System.Text.Encoding]::UTF8.GetByteCount($cmd)
if ($cmdLen -gt $DcMaxCmd) {
    Deny "CONFIRM REQUIRED: command is $cmdLen bytes, above the $DcMaxCmd-byte limit this guard can analyze reliably. Run manually if intentional."
    exit 0
}

# BLOCK: irreversible or highly destructive — refuse unconditionally
$blockPatterns = @(
    @{ pattern = "rm -rf";           reason = "irreversible recursive deletion" }           # WHY: recursive deletion is irreversible
    @{ pattern = "mkfs";             reason = "filesystem format" }                          # WHY: formats/destroys entire filesystem
    @{ pattern = "dd if=";           reason = "disk wipe or dump" }                         # WHY: raw disk access, wipes or dumps data
    @{ pattern = "git push --force"; reason = "force push (long form)" }                    # WHY: rewrites remote history irreversibly
    @{ pattern = "git push -f";      reason = "force push (short form)" }                   # WHY: same as --force, short flag form
    @{ pattern = "DROP TABLE";       reason = "SQL table drop" }                            # WHY: irreversible schema destruction
    @{ pattern = "DROP DATABASE";    reason = "SQL database drop" }                         # WHY: destroys entire database
    # Each `regex = $true` row needs one example in tests/test-dangerous-commands.sh's `_dc_ex`
    # table, keyed by row order within its tier array; renumber after an inserted row.
    #
    # WHY `\|&?`, [NS-38]: bash's `|&` pipes stdout AND stderr into the interpreter, and this hook
    # also guards the Bash tool whenever pwsh is present, so `curl x |& bash` must block here too.
    # `\s*` already spans a newline after the pipe -- the continuation form the sh twin missed.
    # WHY `([^a-z]|$)` and not `\b` after the interpreter name: `\b` counts a digit or `_` as part of
    # the word, so `| bash5` and `| bash_x` passed here while the sh twin, which uses this boundary,
    # blocked them. Same boundary on both sides now for ASCII; .NET's IgnoreCase also folds the Kelvin
    # sign (U+212A) to `k`, so `| bash<Kelvin>` passes here and blocks in the sh twin -- the sh side
    # is the stricter one, and no shell resolves that word to bash. It still excludes `| sha256sum`.
    @{ pattern = '\|&?\s*bash([^a-z]|$)'; regex = $true; reason = "command piped to bash (curl|bash, wget|bash, etc.)" } # WHY: remote code execution vector. Regex with a trailing ([^a-z]|$) boundary (not a plain substring): matches both spaced ("| bash") and unspaced ("|bash") forms in one pattern.
    @{ pattern = '\|&?\s*sh([^a-z]|$)'; regex = $true; reason = "command piped to sh" }              # WHY: remote code execution via sh. WHY regex, not substring: a plain "| sh" substring check false-positives on any command containing "| sha256sum", "| shasum", etc. -- tools this repo's own review-gate hash verification depends on (found when fixing the field-path bug that had made this pattern a no-op made this collision real). The ([^a-z]|$) boundary requires "sh" to be followed by a non-letter or the end, so "sha256sum" (sh immediately followed by "a") doesn't match, but a literal pipe-to-sh interpreter does.
    # PowerShell-native equivalents (triggered by the PowerShell tool)
    @{ pattern = "Remove-Item -Recurse -Force"; reason = "recursive force deletion (PowerShell rm -rf equivalent)" }         # WHY: Remove-Item -Recurse -Force is the PS equivalent of rm -rf
    @{ pattern = "Remove-Item -Force -Recurse"; reason = "recursive force deletion (PowerShell rm -rf, flags reversed)" }   # WHY: same as above — flag order varies in real commands
    @{ pattern = "Format-Volume";               reason = "disk volume format (PowerShell)" }                                # WHY: destroys all data on a volume
    # WHY regexes and not the four literals they replace ("| Invoke-Expression", "|Invoke-Expression",
    # "| iex", "|iex"), [NS-38]: PowerShell continues a pipeline after a trailing `|` onto the next
    # line, including across blank lines (verified live), so `iwr x |` + newline + `iex` executes
    # the download -- and no literal can span that newline. `\s*` covers the no-space, one-space and
    # newline forms in one row. NO trailing boundary, deliberately: the literals had none, so the
    # regexes are a strict superset of them. Adding `\b` would have narrowed the tier.
    @{ pattern = '\|\s*Invoke-Expression'; regex = $true; reason = "command piped to Invoke-Expression (PS code execution)" }   # WHY: pipe-to-iex is the PS equivalent of pipe-to-bash
    @{ pattern = '\|\s*iex';               regex = $true; reason = "command piped to iex (PS eval shorthand)" }                # WHY: iex is the common alias for Invoke-Expression
    # WHY three STRUCTURAL rows beside the literals above: they match reordered, split and
    # abbreviated forms the literals miss (`git push origin main --force`, `rm -r -f x`), and the
    # shipped `Bash(git *)` allow rule approves a force push or a `!` git alias before Claude Code's
    # auto-mode classifier sees it. See dangerous-commands.sh for the rationale, the measurements,
    # the accepted false positives and the known gaps. Same regexes as the sh twin, except that the
    # segment class is spelled `[^;&|\x00-\x1F\x7F]` -- .NET has no [:cntrl:] -- for the same bytes.
    # Gaps are bounded {0,255} and flag-letter runs {0,32} because this engine backtracks; which of
    # those bounds the measurements actually need, and the figures, are in the sh twin.
    # Here `rm` is also Remove-Item's alias, so the rm row reads `rm -r -fo x` and `rm x -Recurse -Force`
    # too. The row needs the word `rm`, so other Remove-Item spellings are not matched by it.
    @{ pattern = '(^|[^a-z0-9_-])rm(\.exe)? ([^;&|\x00-\x1F\x7F]{0,255} )?(-(-|[a-z]{0,32})r[^;&|\x00-\x1F\x7F]{0,255} -(-|[a-z]{0,32})f|-(-|[a-z]{0,32})f[^;&|\x00-\x1F\x7F]{0,255} -(-|[a-z]{0,32})r|-[a-z]{0,32}(r[a-z]{0,32}f|f[a-z]{0,32}r))'; regex = $true; reason = "irreversible recursive deletion (rm with recursive and force flags, in any order)" }
    @{ pattern = '(^|[^a-z])git(\.exe)? ([^;&|\x00-\x1F\x7F]{0,255}([^;&|\x00-\x1F\x7Fh]|[^;&|\x00-\x1F\x7Fs]h|[^;&|\x00-\x1F\x7Fa]sh|[^;&|\x00-\x1F\x7Ft]ash|[^;&|\x00-\x1F\x7Fs]tash|[^;&|\x00-\x1F\x7F ]stash) |[^;&|\x00-\x1F\x7F]{0,255}=)?push( [^;&|\x00-\x1F\x7F]{0,255})? (--force|--mir|-[a-z0-9]{0,32}f|\+[^ \x00-\x1F\x7F])'; regex = $true; reason = "force push (--force, --mirror or -f in any position, or a +refspec)" }
    @{ pattern = 'alias\.[a-z0-9_.-]+(=| +)!|(^|[^a-z0-9_-])[gmn]?awk .{0,255}([^.a-z0-9_]system ?\(|\|&? ?getline)'; regex = $true; reason = "arbitrary command execution through a tool's own arguments (git alias !cmd, awk system() or cmd | getline)" }
)

foreach ($entry in $blockPatterns) {
    $isMatch = if ($entry.regex) { [regex]::IsMatch($cmd, $entry.pattern, $DcRegexOpts) -or [regex]::IsMatch($cmdLoose, $entry.pattern, $DcRegexOpts) -or ($DcNoCrDiffers -and [regex]::IsMatch($cmdLooseNoCr, $entry.pattern, $DcRegexOpts)) } else { $cmd.Contains($entry.pattern, [System.StringComparison]::OrdinalIgnoreCase) -or $cmdLoose.Contains($entry.pattern, [System.StringComparison]::OrdinalIgnoreCase) -or ($DcNoCrDiffers -and $cmdLooseNoCr.Contains($entry.pattern, [System.StringComparison]::OrdinalIgnoreCase)) }
    if ($isMatch) {
        Deny ($BLOCK_MSG -f $entry.reason)
        exit 0
    }
}

# CONFIRM: advanced ops with legitimate uses — ask the user to approve each one (see Ask above)
$confirmPatterns = @(
    @{ pattern = "git filter-branch"; reason = "history rewriting" }                        # WHY: rewrites commit history, rarely intentional
    @{ pattern = "git update-ref";    reason = "low-level ref manipulation" }               # WHY: low-level plumbing, bypasses safety checks
    @{ pattern = "sudo rm";           reason = "privileged deletion" }                      # WHY: elevated deletion can remove system files
    @{ pattern = "chmod -R 777";      reason = "world-writable recursive chmod" }           # WHY: makes entire tree world-writable
    @{ pattern = "--no-verify";       reason = "bypasses pre-commit hooks (local governance)" } # WHY: skips safety hooks on commit
    # WHY these sit beside the hook-skip flag above: same class of action -- routing around
    # local governance. See dangerous-commands.sh for the full rationale and the incident.
    # WHY regex and not plain substrings: `-c key=value` and `git config key value` are the
    # same action with different separators, and neither is expressible as one literal. The
    # REGEX is identical to the sh twin's, using only the subset valid in both .NET and GNU ERE
    # -- no [[:space:]], which .NET does not support. The escaped string LITERALS are NOT
    # byte-identical: sh double-quotes need \" where PowerShell single-quotes need ''. See the
    # note below the pattern list; the parity block asserts equal behaviour, not equal text.
    # WHY these require a `config` subcommand or a `-c` flag and not merely a `git` token:
    # requiring only `git` made every git command carrying the key as TEXT fire, including
    # `git commit -m "...commit.gpgsign false..."` -- which meant this feature could not be
    # committed with a message describing it. See the sh twin for the measured cases, the
    # --unset-all and quoted-value gaps this closes, and the full KNOWN LIMITS list
    # (GIT_CONFIG_* env vars, direct .git/config writes, tag.gpgsign/push.gpgSign).
    # WHY the escaping differs from the sh twin while the regex does not: sh double-quotes
    # need \" and PowerShell single-quotes need '' for the same two characters. The
    # engine-visible pattern is identical; the parity test asserts behaviour, not text.
    @{ pattern = '(^|[^a-z])git (.*)-c *["'']?commit\.gpgsign["'']? *= *["'']?(false|no|off|0)([^a-z0-9]|$)'; regex = $true; reason = "bypasses commit signing (local governance)" }
    @{ pattern = '(^|[^a-z])git (.{0,255})config (.{0,255})["'']?commit\.gpgsign["'']? *[= ] *["'']?(false|no|off|0)([^a-z0-9]|$)'; regex = $true; reason = "bypasses commit signing (local governance)" }
    @{ pattern = '(^|[^a-z])git (.{0,255})config (.{0,255})--unset(-all)? +["'']?commit\.gpgsign'; regex = $true; reason = "bypasses commit signing (local governance)" }
    @{ pattern = '(^|[^a-z])git (.*)--no-gpg-sign'; regex = $true; reason = "bypasses commit signing (local governance)" }
    # WHY regex, not a plain substring: "git merge" as a bare substring also matches
    # "git merge-base", a common, harmless read-only command — the character after
    # "merge" there is "-", not a word boundary in the usual sense. Requiring a space,
    # a newline, a CR or the end of the string after "merge" excludes that case while still matching
    # "git merge <branch>", "git merge --no-ff <branch>", and bare "git merge". WHY a
    # literal space, not \s, on the trailing side: $cmd already had tabs normalized to
    # spaces before this pattern ever runs (see the blank-run collapse above), and
    # dangerous-commands.sh does the same normalization -- so both sides only ever need
    # to check for a plain ASCII space, a newline or a CR here, with no \s-vs-[[:space:]] Unicode/locale
    # ambiguity to keep in parity (an earlier version used \s, which -- unlike bash's
    # [[:space:]] under the C/POSIX locale -- also matches NBSP and other Unicode space
    # separators; that mismatch let an NBSP-substituted "git merge" silently bypass the
    # CONFIRM gate on bash but not PowerShell, found by code review and verified by
    # direct execution).
    # WHY a leading boundary too (^|[^a-zA-Z]) (found by code review, not present in
    # the original version): without one, the pattern also matches as a substring of
    # a longer word — e.g. "git commit -m 'legit merge of feature A'" contains the
    # literal substring "git merge " inside "le-GIT- -MERGE-of", which would wrongly
    # trigger CONFIRM. Requiring the character before "git" to be absent (start of
    # string) or not a letter closes that gap. Mirrors dangerous-commands.sh's
    # confirm_boundary() leading-boundary fix exactly, for sh/ps1 parity.
    # WHY `\n` on the trailing side, added 2026-10-14: newlines are not folded to spaces, and
    # without Multiline `$` matches only at the end or before a FINAL newline, so `git merge`, a
    # newline, then another command -- which runs a bare `git merge` -- got no verdict here or in
    # the sh twin. WHY `\r` too: PowerShell reads a lone CR as a statement break (measured), so
    # `git merge`, CR, `ls` on the PowerShell tool is a bare merge. On Git Bash, which deletes the
    # CR, that one runs `git mergels`: an accepted false positive, kept so both hooks give one
    # verdict. A CR before a space, a newline or the end is a true positive there, which the
    # CR-deleted view catches as well.
    @{ pattern = '(^|[^a-zA-Z])git merge( |\r|\n|$)'; regex = $true; reason = "merge into a shared/base branch — standards/SECURITY-GUARDRAILS.md CONFIRM tier" } # WHY: precipitating incident for that CONFIRM-tier row was a plain `git merge`, not `gh pr merge` (already denied elsewhere)
)

foreach ($entry in $confirmPatterns) {
    $isMatch = if ($entry.regex) { [regex]::IsMatch($cmd, $entry.pattern, $DcRegexOpts) -or [regex]::IsMatch($cmdLoose, $entry.pattern, $DcRegexOpts) -or ($DcNoCrDiffers -and [regex]::IsMatch($cmdLooseNoCr, $entry.pattern, $DcRegexOpts)) } else { $cmd.Contains($entry.pattern, [System.StringComparison]::OrdinalIgnoreCase) -or $cmdLoose.Contains($entry.pattern, [System.StringComparison]::OrdinalIgnoreCase) -or ($DcNoCrDiffers -and $cmdLooseNoCr.Contains($entry.pattern, [System.StringComparison]::OrdinalIgnoreCase)) }
    if ($isMatch) {
        Ask ($CONFIRM_MSG -f $entry.reason)
        exit 0
    }
}

# WARN: credential/secrets access — legitimate workflows exist, surface the access only
# (advisory only — no permissionDecision set, so the command proceeds)
$warnPatterns = @(
    @{ pattern = "id_rsa";           reason = "SSH private key access" }                    # WHY: SSH private key — may be intentional (key setup)
    @{ pattern = ".pem";             reason = "certificate or key file access" }            # WHY: cert/key files — may be intentional (TLS mgmt)
    @{ pattern = ".env.production";  reason = "production secrets file" }                   # WHY: production secrets — surface access, don't block
    @{ pattern = "credentials.json"; reason = "credential file access" }                    # WHY: credential file — may be intentional (auth setup)
)

$warnReasons = @()
foreach ($entry in $warnPatterns) {
    # Checks the de-escaped view too, [NS-40]: this loop tested $cmd alone, exactly like the sh
    # twin's warn(), so `id\_rsa` and `"id"_rsa` warned on neither shell. The -or keeps one if
    # body, so a command matching several views warns once -- this tier does not exit.
    if ($cmd.Contains($entry.pattern, [System.StringComparison]::OrdinalIgnoreCase) -or
        $cmdLoose.Contains($entry.pattern, [System.StringComparison]::OrdinalIgnoreCase) -or
        ($DcNoCrDiffers -and $cmdLooseNoCr.Contains($entry.pattern, [System.StringComparison]::OrdinalIgnoreCase))) {
        $warnReasons += $entry.reason
    }
}

# WHY one JSON object, not a Write-Host line per match: a PreToolUse hook's plain stdout never
# reaches the model and is not shown in the visible transcript (per Claude Code's docs; it only
# records it) -- neither the user nor the model ever saw a WARN -- and stdout must be nothing but
# one object, so every match shares it. systemMessage reaches the user per Claude
# Code's docs (a headless run cannot show it); additionalContext the model (measured 2026-10-14,
# main agent and subagent). The model-facing text omits "WARNING:" so each match still yields
# exactly one. [ordered] keeps the keys in the sh twin's order, byte for byte.
if ($warnReasons.Count -gt 0) {
    [ordered]@{
        systemMessage      = (($warnReasons | ForEach-Object { $WARN_MSG -f $_ }) -join ' ')
        hookSpecificOutput = [ordered]@{
            hookEventName     = "PreToolUse"
            additionalContext = "dangerous-commands hook: this command matches $($warnReasons -join ', ') (WARN tier: surfaced, not blocked)."
        }
    } | ConvertTo-Json -Compress | Write-Output
}

exit 0
