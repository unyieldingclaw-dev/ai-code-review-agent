# AI Review Agent — VS Code / Cursor Extension

Run an 11-agent local AI code review swarm on your staged git changes, directly from the command palette. Findings appear as inline editor squiggles (Problems panel) and a full markdown report in the Output panel.

**Requires [Ollama](https://ollama.ai) running locally.** No API keys, no cloud, no cost.

---

## Install

### From .vsix (manual install)

1. Download `ai-review-agent-0.5.0.vsix` from the [GitHub Releases](https://github.com/unyieldingclaw-dev/ai-code-review-agent/releases) page.
2. In Cursor or VS Code: open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) → **Extensions: Install from VSIX…** → select the downloaded file.

### Prerequisites

1. [Install Ollama](https://ollama.ai)
2. Pull the default model:
   ```bash
   ollama serve          # start Ollama (keep this running)
   ollama pull devstral:latest
   ```

---

## Usage

1. Stage the changes you want reviewed:
   ```bash
   git add -p            # or: git add <files>
   ```
2. Open Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
3. Run: **AI Review: Review Staged Changes**
4. Wait 30–120 s for the swarm to finish
5. Findings appear as squiggles in your editor and in the **Problems** panel
6. The full report opens in the **AI Review** output channel

---

## Configuration

All settings are under **Preferences → Settings → AI Review**:

| Setting | Default | Description |
|---------|---------|-------------|
| `aiReview.ollamaUrl` | `http://localhost:11434` | Ollama base URL |
| `aiReview.model` | `devstral:latest` | Model name |
| `aiReview.agents` | `[]` (all 11) | Subset of agents to run |
| `aiReview.maxLines` | `2000` | Max diff lines sent for review |
| `aiReview.timeout` | `120` | Per-agent timeout (seconds) |

**Available agents:** `security`, `performance`, `correctness`, `design`, `dependencies`, `coverage`, `testgen`, `adversarial`, `integration`, `breaking-change`, `license`

To run only security and performance checks:
```json
"aiReview.agents": ["security", "performance"]
```

---

## Troubleshooting

| Error | Fix |
|-------|-----|
| "Ollama is not running" | Run `ollama serve` in a terminal, keep it open |
| "No staged changes found" | Run `git add <files>` before invoking the extension |
| "git not found" | Ensure `git` is on your PATH |
| Findings don't appear after run | Check the "AI Review" output panel for details |

---

## Agents

| Agent | What it checks |
|-------|----------------|
| Security | Injection, auth, secrets, input validation |
| Performance | N+1 queries, blocking I/O, O(n²) loops |
| Correctness | Off-by-one, null dereference, edge cases |
| Design | SOLID violations, coupling, naming |
| Dependencies | Outdated packages, CVEs, license conflicts |
| Coverage | Untested paths, missing assertions |
| TestGen | Generates test stubs for new code |
| Adversarial | Prompt injection, misuse scenarios |
| Integration | Contract mismatches, API breakage |
| Breaking Change | Removed exports, signature changes |
| License | GPL/AGPL/SSPL incompatible dependencies |
