<#
.SYNOPSIS
    End-user setup — installs ai-review-agent and its prerequisites.
.DESCRIPTION
    Checks Node.js >=18, verifies Ollama is running, pulls devstral:latest,
    installs ai-review-agent globally via npm, and runs a smoke test.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$OllamaModel = 'devstral:latest'   # change to use a different model

Write-Host ""
Write-Host "=== AI Review Agent — User Setup ===" -ForegroundColor Cyan
Write-Host ""

# Step 1: Node.js check
Write-Host "Checking Node.js..." -ForegroundColor Gray
try {
    $rawVersion = node --version 2>&1
    $nodeVersion = ($rawVersion | Where-Object { $_ -match 'v\d+\.' } | Select-Object -Last 1)
    if (-not $nodeVersion) {
        Write-Host "[ERROR] Node.js not found." -ForegroundColor Red
        Write-Host "        Download: https://nodejs.org" -ForegroundColor Yellow
        exit 1
    }
    $major = [int]($nodeVersion -replace 'v(\d+)\..*', '$1')
    if ($major -lt 18) {
        Write-Host "[ERROR] Node.js v$major found — v18 or higher required." -ForegroundColor Red
        Write-Host "        Download: https://nodejs.org" -ForegroundColor Yellow
        exit 1
    }
    Write-Host "  Node.js $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "[ERROR] Node.js not found." -ForegroundColor Red
    Write-Host "        Download: https://nodejs.org" -ForegroundColor Yellow
    exit 1
}

# Step 2: Ollama running check
Write-Host "Checking Ollama..." -ForegroundColor Gray
try {
    $resp = Invoke-WebRequest -Uri "http://localhost:11434" -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
    if ($resp.Content -notmatch 'Ollama') {
        throw "Port 11434 is occupied by a different service."
    }
    Write-Host "  Ollama running" -ForegroundColor Green
} catch {
    Write-Host "[ERROR] Ollama is not running on http://localhost:11434." -ForegroundColor Red
    Write-Host "        Start Ollama, then re-run this script." -ForegroundColor Yellow
    Write-Host "        Install: https://ollama.com" -ForegroundColor Yellow
    exit 1
}

# Step 3: Pull model
Write-Host ""
Write-Host "Pulling $OllamaModel (may take a few minutes on first run)..." -ForegroundColor Cyan
ollama pull $OllamaModel
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] ollama pull failed. Check your internet connection and that Ollama is still running." -ForegroundColor Red
    Write-Host "        Retry: ollama pull $OllamaModel" -ForegroundColor Yellow
    exit 1
}

# Step 4: Global install
Write-Host ""
Write-Host "Installing ai-review-agent globally..." -ForegroundColor Cyan
npm install -g ai-review-agent
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] npm install -g failed." -ForegroundColor Red
    Write-Host "        If you see a permissions error, try running this script as Administrator," -ForegroundColor Yellow
    Write-Host "        or set a user-writable npm prefix: npm config set prefix `"$env:APPDATA\npm`"" -ForegroundColor Yellow
    exit 1
}

# Refresh PATH so the newly installed binary is resolvable in this session
$env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
            [System.Environment]::GetEnvironmentVariable('Path', 'User')

# Step 5: Smoke test
Write-Host ""
Write-Host "Smoke test..." -ForegroundColor Gray
$cmd = Get-Command ai-review-agent -ErrorAction SilentlyContinue
if (-not $cmd) {
    Write-Host "[ERROR] ai-review-agent not found in PATH after install." -ForegroundColor Red
    Write-Host "        Close and reopen your terminal, then run: ai-review-agent --version" -ForegroundColor Yellow
    exit 1
}
$version = & $cmd.Source --version 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] ai-review-agent --version failed." -ForegroundColor Red
    exit 1
}
Write-Host "  ai-review-agent $version" -ForegroundColor Green

Write-Host ""
Write-Host "Setup complete. Run: ai-review-agent" -ForegroundColor Green
Write-Host ""
