<#
.SYNOPSIS
    Contributor setup — wires up a cloned repo for local development.
.DESCRIPTION
    Checks Node.js >=18, verifies the working directory is the repo root,
    runs npm install, builds TypeScript, links the binary globally via npm link,
    and runs a smoke test.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Write-Host ""
Write-Host "=== AI Review Agent — Contributor Setup ===" -ForegroundColor Cyan
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

# Step 2: Verify repo root
Write-Host "Checking repo root..." -ForegroundColor Gray
if (-not (Test-Path "package.json")) {
    Write-Host "[ERROR] package.json not found." -ForegroundColor Red
    Write-Host "        Run this script from the repo root directory." -ForegroundColor Yellow
    exit 1
}
Write-Host "  Repo root confirmed" -ForegroundColor Green

# Step 3: npm install
Write-Host ""
Write-Host "Installing dependencies..." -ForegroundColor Cyan
npm install
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] npm install failed." -ForegroundColor Red
    exit 1
}

# Step 4: Build
Write-Host ""
Write-Host "Building..." -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Build failed — fix TypeScript errors above." -ForegroundColor Red
    exit 1
}

# Step 5: npm link
Write-Host ""
Write-Host "Linking..." -ForegroundColor Cyan
npm link
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] npm link failed." -ForegroundColor Red
    Write-Host "        If you see a permissions error, try running this script as Administrator." -ForegroundColor Yellow
    exit 1
}

# Refresh PATH so the newly linked binary is resolvable in this session
$env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
            [System.Environment]::GetEnvironmentVariable('Path', 'User')

# Step 6: Smoke test
Write-Host ""
Write-Host "Smoke test..." -ForegroundColor Gray
$cmd = Get-Command ai-review-agent -ErrorAction SilentlyContinue
if (-not $cmd) {
    Write-Host "[ERROR] ai-review-agent not found in PATH after link." -ForegroundColor Red
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
Write-Host "Dev setup complete. Run: npm test" -ForegroundColor Green
Write-Host ""
