# check-contract.ps1 — PreToolUse hook for Write/Edit (PowerShell)
# Checks the active task contract and warns if the target file is out of scope.
# Always exits 0 (WARN tier). Exits silently if no contract found.

param()

$ContractFile = ".claude/contracts/active-task.json"

# --- Contract existence check ---
if (-not (Test-Path $ContractFile)) {
    exit 0
}

# --- Parse contract ---
try {
    $contract = Get-Content $ContractFile -Raw | ConvertFrom-Json
} catch {
    exit 0  # Malformed contract — fail open
}

$status    = $contract.status
$task      = $contract.task
$expiresAt = $contract.expires_at
$scopeFiles = $contract.scope.files

# --- Status check ---
if ($status -ne "active") {
    exit 0
}

# --- Expiry check ---
if ($expiresAt) {
    try {
        $expires = [datetime]::Parse($expiresAt, $null, [System.Globalization.DateTimeStyles]::RoundtripKind)
        if ([datetime]::UtcNow -gt $expires) {
            Write-Host "⚠️  CONTRACT EXPIRED: The active task contract has expired."
            Write-Host "    Task: $task"
            Write-Host "    Propose a new contract before continuing."
            exit 0
        }
    } catch {
        # Ignore parse errors — fail open
    }
}

# --- Extract target file from tool input ---
$toolInput = $env:CLAUDE_TOOL_INPUT
if (-not $toolInput) {
    exit 0
}

try {
    $inputData = $toolInput | ConvertFrom-Json
    $targetFile = $inputData.file_path
} catch {
    exit 0
}

if (-not $targetFile) {
    exit 0
}

# --- Scope check ---
$inScope = $false
foreach ($pattern in $scopeFiles) {
    if (-not $pattern) { continue }

    # Exact match
    if ($targetFile -eq $pattern) {
        $inScope = $true
        break
    }

    # Directory prefix match (pattern ends with /)
    if ($pattern.EndsWith("/") -and $targetFile.StartsWith($pattern)) {
        $inScope = $true
        break
    }

    # Glob match (simple wildcard via -like operator)
    if ($targetFile -like $pattern) {
        $inScope = $true
        break
    }
}

if (-not $inScope) {
    $scopeSummary = $scopeFiles -join ", "
    Write-Host "⚠️  CONTRACT SCOPE: Writing to '$targetFile' is outside the active contract."
    Write-Host "    Task: $task"
    Write-Host "    Declared scope: $scopeSummary"
    Write-Host "    Pause and confirm with user before proceeding."
}

exit 0
