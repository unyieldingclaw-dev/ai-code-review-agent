# AI Review Agent — VS Code / Cursor Extension

Run a **15-agent** local AI code review swarm on your staged git changes, directly from the command palette. Findings appear as inline editor squiggles (Problems panel) and a full markdown report in the Output panel.

**Requires [Ollama](https://ollama.ai) running locally.** No API keys, no cloud, no cost.

---

## Install

### Build and install the .vsix

The extension is not currently distributed anywhere -- no GitHub Release has ever carried a `.vsix`
asset, and Marketplace publishing is deferred -- so build it from this directory:

```bash
cd vscode-extension
npm install
npm run compile        # esbuild -> dist/extension.js, which package.json's `main` points at
npm run package        # vsce package -> ai-review-agent-<version>.vsix
```

`npm run compile` is a separate step because there is no `vscode:prepublish` script, so
`vsce package` will not build for you.

Then, in Cursor or VS Code: open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) →
**Extensions: Install from VSIX…** → select the file you just built.

### Prerequisites

1. [Install Ollama](https://ollama.ai)
2. Pull the default model:
   ```bash
   ollama serve                    # start Ollama (keep this running)
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

| Setting                | Default                  | Description                                                                        |
| ---------------------- | ------------------------ | ---------------------------------------------------------------------------------- |
| `aiReview.ollamaUrl`   | `http://localhost:11434` | Ollama base URL                                                                    |
| `aiReview.model`       | `devstral:latest`        | Model name                                                                         |
| `aiReview.profile`     | `` (none)                | Named agent subset: `fast`, `full`, `change-review`, `ui`, `migration`, `security` |
| `aiReview.agents`      | `[]` (all 15 defaults)   | Explicit agent list (overrides profile). testgen always excluded.                  |
| `aiReview.contextMode` | `none`                   | `none`, `memory-bank` (static), or `memory-bank-semantic` (nomic-embed-text)       |
| `aiReview.maxLines`    | `2000`                   | Max diff lines sent for review                                                     |
| `aiReview.timeout`     | `120`                    | Per-agent timeout (seconds)                                                        |

### Profiles

Use `aiReview.profile` to run a named subset of agents:

| Profile         | Agents | Time    |
| --------------- | ------ | ------- |
| `fast`          | 3      | ~3 min  |
| `change-review` | 8      | ~10 min |
| `full`          | 15     | ~30 min |
| `security`      | 4      | ~5 min  |
| `migration`     | 4      | ~5 min  |
| `ui`            | 5      | ~8 min  |

### Memory-bank context

Set `aiReview.contextMode` to `memory-bank` to load relevant `memory-bank/` files into each agent's prompt before reviewing. Requires a `memory-bank/` directory in the project root (compatible with [PMB](https://github.com/unyieldingclaw-dev/personal-memory-bank)).

---

## Troubleshooting

| Error                           | Fix                                                 |
| ------------------------------- | --------------------------------------------------- |
| "Ollama is not running"         | Run `ollama serve` in a terminal, keep it open      |
| "No staged changes found"       | Run `git add <files>` before invoking the extension |
| "git not found"                 | Ensure `git` is on your PATH                        |
| Findings don't appear after run | Check the "AI Review" output panel for details      |

---

## Agents (15 default, testgen opt-in)

| Agent                  | Domain             | What it checks                                    |
| ---------------------- | ------------------ | ------------------------------------------------- |
| SecurityAgent          | Security           | Injection, auth flaws, unsafe deserialization     |
| PerformanceAgent       | Performance        | Hot paths, N+1 queries, memory pressure           |
| CorrectnessAgent       | Correctness        | Logic bugs, off-by-one, null dereferences         |
| DesignAgent            | Architecture Drift | SOLID violations, coupling, abstraction leaks     |
| DependenciesAgent      | Dependencies       | Outdated/vulnerable packages, supply chain risks  |
| BreakingChangeAgent    | Breaking Change    | Removed exports, changed signatures               |
| LicenseComplianceAgent | License            | GPL/AGPL/SSPL/Commons Clause dependencies         |
| AdversarialAgent       | Adversarial        | Adversarial inputs, boundary/concurrency issues   |
| IntegrationScoutAgent  | Integration        | Contract mismatches, missing integration tests    |
| CoverageAnalystAgent   | Testing            | Untested paths, missing assertions                |
| ErrorHandlingAgent     | Error Handling     | Swallowed exceptions, ignored Promise rejections  |
| ObservabilityAgent     | Observability      | New code paths lacking log output                 |
| MigrationSafetyAgent   | Migration Safety   | NOT NULL without DEFAULT, missing down migrations |
| SecretsAgent           | Secrets            | Hardcoded API keys, passwords, connection strings |
| ComplexityAgent        | Complexity         | High cyclomatic complexity, deep nesting          |
| TestGenAgent           | Testing            | Generates test stubs (**opt-in** — use CLI only)  |
