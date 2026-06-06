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

    $tool_input = $input_json | ConvertFrom-Json -ErrorAction Stop

    # WHY: Both Write (file_path) and Edit (file_path) use the same field name.
    $file_path = $tool_input.file_path
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
    exit 0
}

exit 0
