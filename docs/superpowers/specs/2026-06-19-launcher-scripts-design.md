# Launcher Scripts Design

## Goal

Add double-clickable setup scripts for two audiences: end-users installing the tool for the first time, and contributors setting up a local development environment.

## Structure

```
setup.bat              ← 3-line CMD wrapper → scripts/setup.ps1
setup.command          ← 5-line bash wrapper → scripts/setup.sh
dev-setup.bat          ← 3-line CMD wrapper → scripts/dev-setup.ps1
dev-setup.command      ← 5-line bash wrapper → scripts/dev-setup.sh

scripts/
  setup.ps1            ← end-user logic (new)
  setup.sh             ← end-user logic (new)
  dev-setup.ps1        ← contributor logic (new)
  dev-setup.sh         ← contributor logic (new)
```

Root-level `.bat` / `.command` files exist solely for double-click discoverability. All logic lives in `scripts/` alongside existing hook scripts.

`.command` files must be `chmod +x` so macOS Finder treats them as executable rather than opening them as text.

## Windows Strategy

`.bat` files are 3-line CMD wrappers that call `powershell.exe -ExecutionPolicy Bypass -File scripts/setup.ps1` (or `dev-setup.ps1`). Real logic stays in `.ps1`, consistent with all existing scripts in `scripts/`.

## End-User Script (`setup.ps1` / `setup.sh`)

Installs the tool for someone who wants to use `ai-review-agent` globally.

Steps (exit 1 with a clear message on any failure):

1. **Node.js check** — verify `node` is in PATH and version ≥18. On failure: print Node.js download URL and exit 1.
2. **Ollama running check** — HTTP GET `http://localhost:11434`. On failure: print "Start Ollama and re-run this script" and exit 1. _(Cannot auto-install Ollama — requires an OS-level installer.)_
3. **Pull model** — `ollama pull devstral:latest`. Idempotent — no-op if already present.
4. **Global install** — `npm install -g ai-review-agent`.
5. **Smoke test** — `ai-review-agent --version`. On success: print success message and exit 0.

## Contributor Script (`dev-setup.ps1` / `dev-setup.sh`)

Sets up a local development environment from a cloned repo.

Steps (exit 1 with a clear message on any failure):

1. **Node.js check** — verify `node` is in PATH and version ≥18. On failure: print Node.js download URL and exit 1.
2. **npm install** — `npm install` in repo root. Fails loudly if `package.json` not found (wrong directory).
3. **Build** — `npm run build`. Exits 1 on TypeScript errors.
4. **npm link** — `npm link` so `ai-review-agent` resolves to the local build globally.
5. **Smoke test** — `ai-review-agent --version`. Confirms the linked binary resolves correctly.

No Ollama step — contributors run `npm test` (unit tests) without Ollama.

## Error Handling

- All failures print a clear `[ERROR]` message explaining what failed and what to do next.
- No silent failures — same pattern as existing `scripts/pre-push-check.ps1`.
- Scripts are fail-fast: first failure exits immediately (no point continuing if Node is missing).

## Out of Scope

- Installing Ollama (requires OS-level installer — winget/msi on Windows, brew/pkg on macOS)
- Installing Node.js (same reason)
- Windows `.bat` containing real logic (delegation to `.ps1` only)
