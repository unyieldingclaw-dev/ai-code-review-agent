#!/usr/bin/env pwsh
# Sets up the NPM_TOKEN GitHub Actions secret required by .github/workflows/release.yml.
# Run once before your first tag-triggered publish.
#
# Prerequisites:
#   - npm account with publish rights (npm login)
#   - gh CLI authenticated (gh auth login)

$ErrorActionPreference = 'Stop'
$REPO = 'unyieldingclaw-dev/ai-code-review-agent'

Write-Host ""
Write-Host "=== NPM_TOKEN Setup ===" -ForegroundColor Cyan
Write-Host ""

# Check npm login
Write-Host "Checking npm login..." -ForegroundColor Gray
$whoami = npm whoami 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "Not logged into npm. Run this first, then re-run this script:" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  npm login" -ForegroundColor White
    Write-Host ""
    Write-Host "No npm account yet? Sign up at https://www.npmjs.com/signup" -ForegroundColor Gray
    exit 1
}
Write-Host "  npm user: $whoami" -ForegroundColor Green

# Check gh auth
Write-Host "Checking GitHub CLI auth..." -ForegroundColor Gray
gh auth status 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: gh CLI not authenticated. Run: gh auth login" -ForegroundColor Red
    exit 1
}
Write-Host "  gh: authenticated" -ForegroundColor Green

# Create npm automation token
Write-Host ""
Write-Host "Creating npm automation token..." -ForegroundColor Cyan
Write-Host "(You may be prompted for your npm password or 2FA code)" -ForegroundColor Gray
Write-Host ""

$rawOutput = npm token create --type=automation --json 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: npm token create failed." -ForegroundColor Red
    Write-Host $rawOutput
    exit 1
}

try {
    $parsed   = $rawOutput | ConvertFrom-Json
    $token    = $parsed.token
} catch {
    Write-Host "ERROR: Could not parse npm token output:" -ForegroundColor Red
    Write-Host $rawOutput
    exit 1
}

if (-not $token) {
    Write-Host "ERROR: Token field was empty in npm output." -ForegroundColor Red
    exit 1
}

Write-Host "Token created." -ForegroundColor Green

# Set GitHub secret
Write-Host ""
Write-Host "Setting NPM_TOKEN secret on $REPO..." -ForegroundColor Cyan
$token | gh secret set NPM_TOKEN --repo $REPO
if ($LASTEXITCODE -ne 0) {
    $token = $null
    Write-Host "ERROR: gh secret set failed." -ForegroundColor Red
    exit 1
}

$token = $null

Write-Host ""
Write-Host "Done. NPM_TOKEN is live on GitHub." -ForegroundColor Green
Write-Host ""
Write-Host "To trigger the first release:" -ForegroundColor Gray
Write-Host "  git tag v0.3.0" -ForegroundColor White
Write-Host "  git push --tags" -ForegroundColor White
Write-Host ""
