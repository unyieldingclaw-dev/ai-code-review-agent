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
    $input_json = $input | Out-String
    if ([string]::IsNullOrWhiteSpace($input_json)) { exit 0 }

    $payload = $input_json | ConvertFrom-Json -ErrorAction Stop

    # WHY .tool_input.file_path, not .file_path: the real payload nests everything under
    # "tool_input" (e.g. {"tool_name":"Edit","tool_input":{"file_path":"..."}}), confirmed
    # by capturing a live hook payload (see scripts/check-contract.ps1). The prior version
    # read $payload.file_path (flat), which is always null, so this hook silently no-op'd
    # on every Write/Edit -- last-reviewed frontmatter never actually updated.
    $file_path = $payload.tool_input.file_path
    if ([string]::IsNullOrWhiteSpace($file_path)) { exit 0 }

    # WHY: Normalize path separators before checking — Claude may pass forward slashes
    # on Windows or mixed paths depending on context.
    $normalized = $file_path -replace '\\', '/'
    if ($normalized -notmatch '/memory-bank/') { exit 0 }

    if (-not (Test-Path $file_path)) { exit 0 }

    $today = Get-Date -Format "yyyy-MM-dd"
    $content = Get-Content $file_path -Raw

    # WHY: Only update if the frontmatter block exists and contains last-reviewed.
    # Don't add frontmatter to files that don't have it — that's a human decision.
    if ($content -match 'last-reviewed:') {
        $updated = $content -replace '(?m)^last-reviewed:.*$', "last-reviewed: $today"
        if ($updated -ne $content) {
            Set-Content $file_path $updated -NoNewline
        }
    }
} catch {
    # WHY: Silent failure — this hook must never block agent work. If the update
    # fails, the agent continues; the user can run mb audit to find stale files.
    # WHY: Log to .pmb-hook-errors.log so mb doctor can surface repeated failures.
    try { Add-Content ".pmb-hook-errors.log" "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] [HOOK] update-reviewed.ps1: $_" -ErrorAction SilentlyContinue } catch {}
    exit 0
}

exit 0
