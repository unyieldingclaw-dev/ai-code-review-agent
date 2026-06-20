#!/usr/bin/env pwsh
$ErrorActionPreference = 'Stop'

Write-Host ""
Write-Host "=== AI Review Agent — User Setup ===" -ForegroundColor Cyan
Write-Host ""

# Step 1: Node.js check
Write-Host "Checking Node.js..." -ForegroundColor Gray
try {
    $nodeVersion = node --version 2>&1
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
    $null = Invoke-WebRequest -Uri "http://localhost:11434" -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
    Write-Host "  Ollama running" -ForegroundColor Green
} catch {
    Write-Host "[ERROR] Ollama is not running on http://localhost:11434." -ForegroundColor Red
    Write-Host "        Start Ollama, then re-run this script." -ForegroundColor Yellow
    Write-Host "        Install: https://ollama.com" -ForegroundColor Yellow
    exit 1
}

# Step 3: Pull model
Write-Host ""
Write-Host "Pulling devstral:latest (may take a few minutes on first run)..." -ForegroundColor Cyan
ollama pull devstral:latest
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] ollama pull failed." -ForegroundColor Red
    exit 1
}

# Step 4: Global install
Write-Host ""
Write-Host "Installing ai-review-agent globally..." -ForegroundColor Cyan
npm install -g ai-review-agent
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] npm install -g failed." -ForegroundColor Red
    exit 1
}

# Step 5: Smoke test
Write-Host ""
Write-Host "Smoke test..." -ForegroundColor Gray
$version = ai-review-agent --version 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] ai-review-agent --version failed. Check npm global bin is in PATH." -ForegroundColor Red
    exit 1
}
Write-Host "  ai-review-agent $version" -ForegroundColor Green

Write-Host ""
Write-Host "Setup complete. Run: ai-review-agent" -ForegroundColor Green
Write-Host ""
