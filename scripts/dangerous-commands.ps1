<#
.SYNOPSIS
    PreToolUse hook — 3-tier dangerous command guardrails for Claude Code.
.DESCRIPTION
    Reads the Bash tool input JSON from stdin, extracts the command string,
    and enforces BLOCK / CONFIRM / WARN tier matching via simple substring checks.
    All output goes to stdout so messages are visible even when stderr is suppressed.
    Fails open: any unexpected error prints [HOOK ERROR] and exits 0.
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
    $cmd = if ($data.command) { [string]$data.command } else { "" }
} catch {
    Write-Host "[HOOK ERROR] dangerous-commands.ps1 failed unexpectedly."
    Write-Host "Proceeding in fails-open mode."
    try { Add-Content ".pmb-hook-errors.log" "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] [HOOK] dangerous-commands.ps1: $_" -ErrorAction SilentlyContinue } catch {}
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
    @{ pattern = "| bash";           reason = "command piped to bash (curl|bash, wget|bash, etc.)" } # WHY: remote code execution vector
    @{ pattern = "| sh";             reason = "command piped to sh" }                       # WHY: remote code execution via sh
    @{ pattern = "|bash";            reason = "command piped to bash (no-space form)" }     # WHY: curl|bash without spaces is valid shell and evades space-prefixed pattern
    @{ pattern = "|sh";              reason = "command piped to sh (no-space form)" }       # WHY: wget|sh without spaces is valid shell and evades space-prefixed pattern
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
    if ($cmd.Contains($entry.pattern, [System.StringComparison]::OrdinalIgnoreCase)) {
        Write-Host ($BLOCK_MSG -f $entry.reason)
        exit 1
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
        Write-Host ($CONFIRM_MSG -f $entry.reason)
        exit 1
    }
}

# WARN: credential/secrets access — legitimate workflows exist, surface the access only
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
