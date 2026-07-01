try {
    $j = [Console]::In.ReadToEnd() | ConvertFrom-Json
    $cmd = $j.tool_input.command
} catch { exit 0 }

if ($cmd -match '^git commit') {
    Write-Output '{"continue": false, "stopReason": "Run /code-review before committing."}'
} elseif ($cmd -match '^git push') {
    Write-Output '{"continue": false, "stopReason": "Run /change-review before pushing (then /ai-review on the PR)."}'
}
