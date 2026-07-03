<#
.SYNOPSIS
    PreToolUse hook — 3-tier dangerous command guardrails for Claude Code.
.DESCRIPTION
    Reads the Bash tool input JSON from stdin, extracts the command string,
    and enforces BLOCK / CONFIRM / WARN tier matching via simple substring checks.
    All output goes to stdout so messages are visible even when stderr is suppressed.
    Fails open: any unexpected error prints [HOOK ERROR] and exits 0.

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
$CONFIRM_MSG = "CONFIRM REQUIRED: {0}. Run manually if intentional."
$WARN_MSG    = "WARNING: {0}. Proceeding."

try {
    # WHY: $input | Out-String matches how update-reviewed.ps1 reads stdin from Claude Code hooks.
    $raw = $input | Out-String
    if ([string]::IsNullOrWhiteSpace($raw)) { exit 0 }
    $data = $raw | ConvertFrom-Json -ErrorAction Stop
    # WHY .tool_input.command, not .command: the real payload nests everything under
    # "tool_input" (e.g. {"tool_name":"Bash","tool_input":{"command":"..."}}), confirmed
    # by capturing a live hook payload. The prior version read $data.command (flat),
    # which is always null against the real payload shape -- $cmd was always "", so no
    # BLOCK/CONFIRM/WARN pattern has ever matched anything, regardless of exit code.
    $cmd = if ($data.tool_input.command) { [string]$data.tool_input.command } else { "" }
} catch {
    Write-Host "[HOOK ERROR] dangerous-commands.ps1 failed unexpectedly."
    Write-Host "Proceeding in fails-open mode."
    try { Add-Content ".pmb-hook-errors.log" "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] [HOOK] dangerous-commands.ps1: $_" -ErrorAction SilentlyContinue } catch {}
    exit 0
}

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

# BLOCK: irreversible or highly destructive — refuse unconditionally
$blockPatterns = @(
    @{ pattern = "rm -rf";           reason = "irreversible recursive deletion" }           # WHY: recursive deletion is irreversible
    @{ pattern = "mkfs";             reason = "filesystem format" }                          # WHY: formats/destroys entire filesystem
    @{ pattern = "dd if=";           reason = "disk wipe or dump" }                         # WHY: raw disk access, wipes or dumps data
    @{ pattern = "git push --force"; reason = "force push (long form)" }                    # WHY: rewrites remote history irreversibly
    @{ pattern = "git push -f";      reason = "force push (short form)" }                   # WHY: same as --force, short flag form
    @{ pattern = "DROP TABLE";       reason = "SQL table drop" }                            # WHY: irreversible schema destruction
    @{ pattern = "DROP DATABASE";    reason = "SQL database drop" }                         # WHY: destroys entire database
    @{ pattern = '\|\s*bash\b'; regex = $true; reason = "command piped to bash (curl|bash, wget|bash, etc.)" } # WHY: remote code execution vector. Regex with \b (not a plain substring): matches both spaced ("| bash") and unspaced ("|bash") forms in one pattern.
    @{ pattern = '\|\s*sh\b';   regex = $true; reason = "command piped to sh" }              # WHY: remote code execution via sh. WHY regex, not substring: a plain "| sh" substring check false-positives on any command containing "| sha256sum", "| shasum", etc. -- tools this repo's own review-gate hash verification depends on (found when fixing the field-path bug that had made this pattern a no-op made this collision real). \b requires "sh" to end at a word boundary, so "sha256sum" (sh immediately followed by "a", no boundary) doesn't match, but a literal pipe-to-sh interpreter does.
    # PowerShell-native equivalents (triggered by the PowerShell tool)
    @{ pattern = "Remove-Item -Recurse -Force"; reason = "recursive force deletion (PowerShell rm -rf equivalent)" }         # WHY: Remove-Item -Recurse -Force is the PS equivalent of rm -rf
    @{ pattern = "Remove-Item -Force -Recurse"; reason = "recursive force deletion (PowerShell rm -rf, flags reversed)" }   # WHY: same as above — flag order varies in real commands
    @{ pattern = "Format-Volume";               reason = "disk volume format (PowerShell)" }                                # WHY: destroys all data on a volume
    @{ pattern = "| Invoke-Expression";         reason = "command piped to Invoke-Expression (PS code execution)" }         # WHY: pipe-to-iex is the PS equivalent of pipe-to-bash
    @{ pattern = "|Invoke-Expression";          reason = "command piped to Invoke-Expression (no-space form)" }             # WHY: no-space form evades space-prefixed pattern
    @{ pattern = "| iex";                       reason = "command piped to iex (PS eval shorthand)" }                      # WHY: iex is the common alias for Invoke-Expression
    @{ pattern = "|iex";                        reason = "command piped to iex (no-space form)" }                          # WHY: no-space form evades space-prefixed pattern
)

foreach ($entry in $blockPatterns) {
    $isMatch = if ($entry.regex) { $cmd -imatch $entry.pattern } else { $cmd.Contains($entry.pattern, [System.StringComparison]::OrdinalIgnoreCase) }
    if ($isMatch) {
        Deny ($BLOCK_MSG -f $entry.reason)
        exit 0
    }
}

# CONFIRM: advanced ops with legitimate uses — require explicit manual invocation
$confirmPatterns = @(
    @{ pattern = "git filter-branch"; reason = "history rewriting" }                        # WHY: rewrites commit history, rarely intentional
    @{ pattern = "git update-ref";    reason = "low-level ref manipulation" }               # WHY: low-level plumbing, bypasses safety checks
    @{ pattern = "sudo rm";           reason = "privileged deletion" }                      # WHY: elevated deletion can remove system files
    @{ pattern = "chmod -R 777";      reason = "world-writable recursive chmod" }           # WHY: makes entire tree world-writable
    @{ pattern = "--no-verify";       reason = "bypasses pre-commit hooks (local governance)" } # WHY: skips safety hooks on commit
)

foreach ($entry in $confirmPatterns) {
    if ($cmd.Contains($entry.pattern, [System.StringComparison]::OrdinalIgnoreCase)) {
        Deny ($CONFIRM_MSG -f $entry.reason)
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

foreach ($entry in $warnPatterns) {
    if ($cmd.Contains($entry.pattern, [System.StringComparison]::OrdinalIgnoreCase)) {
        Write-Host ($WARN_MSG -f $entry.reason)
    }
}

exit 0
