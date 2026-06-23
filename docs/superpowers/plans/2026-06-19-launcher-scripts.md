# Launcher Scripts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add double-clickable setup scripts for end-users (install tool) and contributors (set up dev environment), each with `.bat` (Windows) and `.command` (macOS) launchers delegating to `.ps1`/`.sh` scripts.

**Architecture:** Root-level `.bat` and `.command` files are thin wrappers (3–5 lines) that delegate to `scripts/*.ps1` and `scripts/*.sh` respectively. All real logic lives in `scripts/` alongside existing hook scripts. `.bat` files call `powershell.exe -ExecutionPolicy Bypass -File` so Windows users can double-click without changing system policy.

**Tech Stack:** PowerShell (PS1), Bash (SH), CMD batch (BAT)

---

## File Map

| File                    | Status | Purpose                                                                        |
| ----------------------- | ------ | ------------------------------------------------------------------------------ |
| `setup.bat`             | Create | CMD wrapper → `scripts/setup.ps1`                                              |
| `setup.command`         | Create | Bash wrapper → `scripts/setup.sh` (macOS double-click)                         |
| `scripts/setup.ps1`     | Create | End-user: Node check, Ollama check, model pull, npm global install, smoke test |
| `scripts/setup.sh`      | Create | Same as above, bash                                                            |
| `dev-setup.bat`         | Create | CMD wrapper → `scripts/dev-setup.ps1`                                          |
| `dev-setup.command`     | Create | Bash wrapper → `scripts/dev-setup.sh` (macOS double-click)                     |
| `scripts/dev-setup.ps1` | Create | Contributor: Node check, npm install, build, link, smoke test                  |
| `scripts/dev-setup.sh`  | Create | Same as above, bash                                                            |
| `README.md`             | Modify | Add "Setup Scripts" section after Requirements                                 |

---

## Task 1: `scripts/setup.ps1` — end-user PowerShell script

**Files:**

- Create: `scripts/setup.ps1`

- [ ] **Step 1: Create the file**

```powershell
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
```

- [ ] **Step 2: Verify the script runs without error (with Ollama running)**

```powershell
pwsh scripts/setup.ps1
```

Expected: five green checkmarks, final "Setup complete." line, exit 0.

- [ ] **Step 3: Verify the Ollama-not-running error path**

Stop Ollama, then run:

```powershell
pwsh scripts/setup.ps1
```

Expected: `[ERROR] Ollama is not running` message and exit 1.

- [ ] **Step 4: Commit**

```bash
git add scripts/setup.ps1
git commit -m "feat(scripts): add end-user setup script (PowerShell)"
```

---

## Task 2: `scripts/setup.sh` — end-user bash script

**Files:**

- Create: `scripts/setup.sh`

- [ ] **Step 1: Create the file**

```bash
#!/usr/bin/env bash
set -euo pipefail

echo ""
echo "=== AI Review Agent — User Setup ==="
echo ""

# Step 1: Node.js check
echo "Checking Node.js..."
if ! command -v node &>/dev/null; then
  echo "[ERROR] Node.js not found."
  echo "        Download: https://nodejs.org"
  exit 1
fi
NODE_MAJOR=$(node --version | sed 's/v\([0-9]*\).*/\1/')
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "[ERROR] Node.js v$NODE_MAJOR found — v18 or higher required."
  echo "        Download: https://nodejs.org"
  exit 1
fi
echo "  Node.js $(node --version)"

# Step 2: Ollama running check
echo "Checking Ollama..."
if ! curl -sf http://localhost:11434 &>/dev/null; then
  echo "[ERROR] Ollama is not running on http://localhost:11434."
  echo "        Start Ollama, then re-run this script."
  echo "        Install: https://ollama.com"
  exit 1
fi
echo "  Ollama running"

# Step 3: Pull model
echo ""
echo "Pulling devstral:latest (may take a few minutes on first run)..."
ollama pull devstral:latest

# Step 4: Global install
echo ""
echo "Installing ai-review-agent globally..."
npm install -g ai-review-agent

# Step 5: Smoke test
echo ""
echo "Smoke test..."
VERSION=$(ai-review-agent --version 2>&1) || {
  echo "[ERROR] ai-review-agent --version failed. Check npm global bin is in PATH."
  exit 1
}
echo "  ai-review-agent $VERSION"

echo ""
echo "Setup complete. Run: ai-review-agent"
echo ""
```

- [ ] **Step 2: Make executable**

```bash
chmod +x scripts/setup.sh
```

- [ ] **Step 3: Verify the script runs without error (with Ollama running)**

```bash
bash scripts/setup.sh
```

Expected: five checkmarks, "Setup complete." line, exit 0.

- [ ] **Step 4: Verify the Ollama-not-running error path**

Stop Ollama, then run:

```bash
bash scripts/setup.sh
```

Expected: `[ERROR] Ollama is not running` and exit 1.

- [ ] **Step 5: Commit**

```bash
git add scripts/setup.sh
git commit -m "feat(scripts): add end-user setup script (bash)"
```

---

## Task 3: `setup.bat` + `setup.command` — end-user wrappers

**Files:**

- Create: `setup.bat`
- Create: `setup.command`

- [ ] **Step 1: Create `setup.bat`**

```batch
@echo off
powershell.exe -ExecutionPolicy Bypass -File "%~dp0scripts\setup.ps1"
```

`%~dp0` expands to the directory containing the `.bat` file, so this works regardless of where the user double-clicks it from.

- [ ] **Step 2: Create `setup.command`**

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
bash scripts/setup.sh
```

- [ ] **Step 3: Make `setup.command` executable**

```bash
chmod +x setup.command
```

- [ ] **Step 4: Verify `setup.bat` (Windows)**

Double-click `setup.bat` in Windows Explorer, or run:

```cmd
setup.bat
```

Expected: PowerShell window opens, runs `scripts/setup.ps1`, same output as Task 1 Step 2.

- [ ] **Step 5: Verify `setup.command` (macOS)**

Double-click `setup.command` in Finder, or run:

```bash
./setup.command
```

Expected: Terminal opens, runs `scripts/setup.sh`, same output as Task 2 Step 3.

- [ ] **Step 6: Commit**

```bash
git add setup.bat setup.command
git commit -m "feat: add end-user launcher wrappers (setup.bat, setup.command)"
```

---

## Task 4: `scripts/dev-setup.ps1` — contributor PowerShell script

**Files:**

- Create: `scripts/dev-setup.ps1`

- [ ] **Step 1: Create the file**

```powershell
#!/usr/bin/env pwsh
$ErrorActionPreference = 'Stop'

Write-Host ""
Write-Host "=== AI Review Agent — Contributor Setup ===" -ForegroundColor Cyan
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

# Step 2: Verify repo root
if (-not (Test-Path "package.json")) {
    Write-Host "[ERROR] package.json not found. Run this script from the repo root." -ForegroundColor Red
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
    exit 1
}

# Step 6: Smoke test
Write-Host ""
Write-Host "Smoke test..." -ForegroundColor Gray
$version = ai-review-agent --version 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] ai-review-agent --version failed." -ForegroundColor Red
    exit 1
}
Write-Host "  ai-review-agent $version" -ForegroundColor Green

Write-Host ""
Write-Host "Dev setup complete. Run: npm test" -ForegroundColor Green
Write-Host ""
```

- [ ] **Step 2: Verify the script runs end-to-end**

```powershell
pwsh scripts/dev-setup.ps1
```

Expected: Node check passes, deps install, build succeeds, link succeeds, `ai-review-agent --version` prints version, "Dev setup complete." line, exit 0.

- [ ] **Step 3: Verify the wrong-directory error**

```powershell
cd C:\Windows\Temp
pwsh C:\path\to\repo\scripts\dev-setup.ps1
```

Expected: `[ERROR] package.json not found` and exit 1.

- [ ] **Step 4: Commit**

```bash
git add scripts/dev-setup.ps1
git commit -m "feat(scripts): add contributor dev-setup script (PowerShell)"
```

---

## Task 5: `scripts/dev-setup.sh` — contributor bash script

**Files:**

- Create: `scripts/dev-setup.sh`

- [ ] **Step 1: Create the file**

```bash
#!/usr/bin/env bash
set -euo pipefail

echo ""
echo "=== AI Review Agent — Contributor Setup ==="
echo ""

# Step 1: Node.js check
echo "Checking Node.js..."
if ! command -v node &>/dev/null; then
  echo "[ERROR] Node.js not found."
  echo "        Download: https://nodejs.org"
  exit 1
fi
NODE_MAJOR=$(node --version | sed 's/v\([0-9]*\).*/\1/')
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "[ERROR] Node.js v$NODE_MAJOR found — v18 or higher required."
  echo "        Download: https://nodejs.org"
  exit 1
fi
echo "  Node.js $(node --version)"

# Step 2: Verify repo root
if [ ! -f package.json ]; then
  echo "[ERROR] package.json not found. Run this script from the repo root."
  exit 1
fi
echo "  Repo root confirmed"

# Step 3: npm install
echo ""
echo "Installing dependencies..."
npm install

# Step 4: Build
echo ""
echo "Building..."
npm run build

# Step 5: npm link
echo ""
echo "Linking..."
npm link

# Step 6: Smoke test
echo ""
echo "Smoke test..."
VERSION=$(ai-review-agent --version 2>&1) || {
  echo "[ERROR] ai-review-agent --version failed."
  exit 1
}
echo "  ai-review-agent $VERSION"

echo ""
echo "Dev setup complete. Run: npm test"
echo ""
```

- [ ] **Step 2: Make executable**

```bash
chmod +x scripts/dev-setup.sh
```

- [ ] **Step 3: Verify the script runs end-to-end**

```bash
bash scripts/dev-setup.sh
```

Expected: Node check passes, deps install, build succeeds, link succeeds, version prints, "Dev setup complete." line, exit 0.

- [ ] **Step 4: Commit**

```bash
git add scripts/dev-setup.sh
git commit -m "feat(scripts): add contributor dev-setup script (bash)"
```

---

## Task 6: `dev-setup.bat` + `dev-setup.command` — contributor wrappers

**Files:**

- Create: `dev-setup.bat`
- Create: `dev-setup.command`

- [ ] **Step 1: Create `dev-setup.bat`**

```batch
@echo off
powershell.exe -ExecutionPolicy Bypass -File "%~dp0scripts\dev-setup.ps1"
```

- [ ] **Step 2: Create `dev-setup.command`**

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
bash scripts/dev-setup.sh
```

- [ ] **Step 3: Make `dev-setup.command` executable**

```bash
chmod +x dev-setup.command
```

- [ ] **Step 4: Verify `dev-setup.bat` (Windows)**

```cmd
dev-setup.bat
```

Expected: PowerShell window opens, runs `scripts/dev-setup.ps1`, same output as Task 4 Step 2.

- [ ] **Step 5: Verify `dev-setup.command` (macOS)**

```bash
./dev-setup.command
```

Expected: Terminal opens, runs `scripts/dev-setup.sh`, same output as Task 5 Step 3.

- [ ] **Step 6: Commit**

```bash
git add dev-setup.bat dev-setup.command
git commit -m "feat: add contributor launcher wrappers (dev-setup.bat, dev-setup.command)"
```

---

## Task 7: README update

**Files:**

- Modify: `README.md`

Add a "Setup Scripts" section immediately after the `## Requirements` section (after line ~47 in the current file). Insert this block:

```markdown
## Setup Scripts

Double-click to set up without opening a terminal:

| Script              | Platform | Who          |
| ------------------- | -------- | ------------ |
| `setup.bat`         | Windows  | End-users    |
| `setup.command`     | macOS    | End-users    |
| `dev-setup.bat`     | Windows  | Contributors |
| `dev-setup.command` | macOS    | Contributors |

**End-user scripts** (`setup.*`) check Node.js, verify Ollama is running, pull `devstral:latest`, install `ai-review-agent` globally, and run a smoke test.

**Contributor scripts** (`dev-setup.*`) check Node.js, run `npm install` + `npm run build` + `npm link`, and confirm the local build is wired up correctly.

> **macOS note:** If macOS blocks `setup.command` or `dev-setup.command` on first run, right-click → Open to bypass Gatekeeper.
```

- [ ] **Step 1: Insert the section into README.md**

Open `README.md`. Find the line `## Cursor Integration (MCP)` (approximately line 81). Insert the block above immediately before that line. Do not modify any other content.

- [ ] **Step 2: Verify README renders correctly**

```bash
# Quick sanity check — confirm the new section heading appears
grep -n "Setup Scripts" README.md
```

Expected: one match at the inserted line number.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add Setup Scripts section to README"
```
