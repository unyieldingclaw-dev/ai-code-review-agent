# check-contract.ps1 — PreToolUse hook for Write/Edit (PowerShell)
# Checks the active task contract and warns if the target file is out of scope.
# WARN tier by default (advisory, allows the write); PMB_CONTRACT_HARD_BLOCK=1
# promotes this to a real block. Exits silently if no contract found.

param()

$ContractFile = ".claude/contracts/active-task.json"

# WHY: Outer trap logs unexpected errors to .pmb-hook-errors.log so mb doctor
# can surface them. The inner logic below uses narrow catches for expected failure
# modes; this wrapper catches anything that slips through.
trap {
    try { Add-Content ".pmb-hook-errors.log" "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] [HOOK] check-contract.ps1: $_" -ErrorAction SilentlyContinue } catch {}
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
# WHY: scope is an array of {file, op} objects per docs/CONTRACTS-GUIDE.md, not an
# object with a .files property. The prior version read $contract.scope.files, which
# is always null against a real contract — the scope check never matched anything.
$scopeFiles = @($contract.scope | ForEach-Object { $_.file } | Where-Object { $_ })

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
# WHY: Claude Code PreToolUse hooks pass tool input as JSON via stdin, not env vars.
# WHY .tool_input.file_path, not .file_path: the real payload nests everything under
# "tool_input" (e.g. {"tool_name":"Edit","tool_input":{"file_path":"..."}}), confirmed
# by capturing a live hook payload. The prior version read $inputData.file_path (flat),
# which is always null against the real payload shape, so the scope check never even
# saw a target file -- it silently fell through to "exit 0" on every single write.
$toolInput = $input | Out-String
if ([string]::IsNullOrWhiteSpace($toolInput)) {
    exit 0
}

try {
    $inputData = $toolInput | ConvertFrom-Json
    $targetFile = $inputData.tool_input.file_path
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
    # WHY: PMB_CONTRACT_HARD_BLOCK=1 promotes scope warnings to a real block.
    # Default is warn-only so accidental scope drift doesn't break workflows;
    # hard-block is opt-in for strict enforcement contexts. Uses
    # hookSpecificOutput.permissionDecision, not an exit code, for the same reason
    # documented in dangerous-commands.ps1 -- exit codes are unreliable under this
    # hook's "|| true" fail-open wiring in settings.json.
    if ($env:PMB_CONTRACT_HARD_BLOCK -eq '1') {
        Deny "Writing to '$targetFile' is outside the active contract (task: $task). Hard-block active (PMB_CONTRACT_HARD_BLOCK=1)."
        exit 0
    }
    Write-Host "    Pause and confirm with user before proceeding."
}

exit 0
