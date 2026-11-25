<#
.SYNOPSIS
    Auto-update last-reviewed frontmatter in memory-bank files after edits.

.DESCRIPTION
    Called by the PostToolUse hook after Write/Edit tool calls. Reads tool input
    JSON from stdin, checks if the edited file is inside memory-bank/, and updates
    the last-reviewed: frontmatter line with today's date. Silent on success.
#>

# WHY: Reads from stdin because Claude Code PostToolUse hooks pass tool input as JSON
# via stdin, not as command-line arguments.
try {
    # Same OEM-code-page defect fixed in dangerous-commands.ps1 on 2026-08-30, same fix. PowerShell
    # decodes piped stdin with [Console]::InputEncoding (ibm437 here), so a non-ASCII byte arrives
    # mangled. The blast radius here is narrower -- this script reads only .tool_input.file_path --
    # but a memory-bank path containing a non-ASCII character would silently fail to match, and this
    # script already fails silently by design, so nothing would report it.
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
    # NOTE: tests/test-update-reviewed.sh exercises this script with STRING payloads only. No
    # raw-byte encoding test covers this file; the matrix above was measured against
    # dangerous-commands.ps1, which shares the construct.
    $input_json = if ([Console]::IsInputRedirected) {
        (New-Object System.IO.StreamReader(
            [Console]::OpenStandardInput(),
            (New-Object System.Text.UTF8Encoding($false)),
            $true)).ReadToEnd()
    } else { "" }
    if ([string]::IsNullOrWhiteSpace($input_json)) { exit 0 }

    $parsed = $input_json | ConvertFrom-Json -ErrorAction Stop

    # WHY .tool_input.file_path, not .file_path: the real payload nests everything
    # under "tool_input" (e.g. {"tool_name":"Edit","tool_input":{"file_path":"..."}}),
    # matching the same fix already applied in check-contract.ps1 (confirmed there by
    # capturing a live hook payload). This script had the same flat-read bug and,
    # unlike check-contract.ps1/dangerous-commands.ps1, was never included in that fix
    # -- $file_path was always $null, so the script silently exited 0 on every call
    # without ever updating last-reviewed.
    $file_path = $parsed.tool_input.file_path
    if ([string]::IsNullOrWhiteSpace($file_path)) { exit 0 }

    # WHY: Normalize path separators before checking — Claude may pass forward slashes
    # on Windows or mixed paths depending on context.
    $normalized = $file_path -replace '\\', '/'
    if ($normalized -notmatch '/memory-bank/') { exit 0 }

    if (-not (Test-Path $file_path)) { exit 0 }

    $today = (Get-Date).ToString("yyyy-MM-dd", [cultureinfo]::InvariantCulture)
    $content = Get-Content $file_path -Raw

    # WHY: Only update if the frontmatter block exists and contains last-reviewed.
    # Don't add frontmatter to files that don't have it — that's a human decision.
    if ($content -match 'last-reviewed:') {
        # WHY [^\r\n]* and no trailing $: in .NET `.` matches \r and (?m)$ matches only before
        # \n, so `.*$` also replaced the \r of a CRLF line. Same fix as update-reviewed.sh.
        $updated = $content -replace '(?m)^last-reviewed:[^\r\n]*', "last-reviewed: $today"
        if ($updated -ne $content) {
            Set-Content $file_path $updated -NoNewline
        }
    }
} catch {
    # WHY: Silent failure — this hook must never block agent work. If the update
    # fails, the agent continues; the user can run mb audit to find stale files.
    # WHY: Log to .pmb-hook-errors.log so mb doctor can surface repeated failures.
    try { Add-Content ".pmb-hook-errors.log" "[$((Get-Date).ToString('yyyy-MM-dd HH:mm:ss', [cultureinfo]::InvariantCulture))] [HOOK] update-reviewed.ps1: $_" -ErrorAction SilentlyContinue } catch { Write-Verbose "Could not write .pmb-hook-errors.log; ignoring." }
    exit 0
}

exit 0
