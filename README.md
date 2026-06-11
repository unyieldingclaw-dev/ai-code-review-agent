# AI Code Review Agent

A local, 11-agent AI code review tool powered by [Ollama](https://ollama.com). Runs against any git diff and produces structured findings across security, correctness, performance, design, dependencies, breaking changes, license compliance, adversarial patterns, integration risks, test coverage, and test generation — no cloud API calls required.

## Overview

```
git diff → sanitizer
  → [Phase 1] CoverageAnalystAgent
  → [Phase 2] 9 specialists in parallel
  → [Phase 3] TestGenAgent (only if coverage gaps found)
  → OrchestratorAgent → findings
```

Each specialist agent receives only the (sanitized) diff and its own system prompt, so agents don't bias each other. The orchestrator deduplicates, cross-references, applies confidence-aware severity gating, and caps the final finding set.

### Agents

| Agent | Domain |
|---|---|
| SecurityAgent | Injection, auth flaws, secrets, unsafe deserialization |
| PerformanceAgent | Hot paths, N+1 queries, memory pressure |
| CorrectnessAgent | Logic bugs, null dereferences, off-by-one errors |
| DesignAgent | SOLID violations, coupling, abstraction leaks |
| DependenciesAgent | Outdated/vulnerable packages, supply chain risks |
| BreakingChangeAgent | Removed exports, changed signatures, renamed public APIs |
| LicenseComplianceAgent | GPL/AGPL/SSPL/Commons Clause/EUPL/CDDL-1.0 dependencies; LGPL (dynamic linking flagged at medium severity) |
| AdversarialAgent | Adversarial inputs — null/empty/boundary values, concurrent access |
| IntegrationScoutAgent | Integration boundaries lacking tests (new HTTP calls, DB writes, queues, WebSocket connections) |
| CoverageAnalystAgent | Test coverage gaps, untested branches |
| TestGenAgent | Generates test stubs for coverage gaps |

> **Note:** `OrchestratorAgent` is internal infrastructure — it deduplicates findings, cross-references severity, applies confidence scoring, and caps the final set. It cannot be selected via `--agents` and does not appear in agent output.

## Requirements

- **Node.js** v18+ (v24 recommended)
- **Ollama** running locally at `http://localhost:11434`
- **devstral:latest** model pulled in Ollama (`ollama pull devstral:latest`)
- Windows 11, macOS, or Linux

## Installation

```bash
npm install -g ai-review
```

Pull the model if you haven't already:

```bash
ollama pull devstral:latest
```

## Quick Start

```bash
cd your-project
git add -p                      # stage the changes you want reviewed
ai-review                       # run the full 11-agent swarm
ai-review --agents security     # single-agent fast pass
ai-review --format json         # machine-readable output
```

<details>
<summary>Install from source (development)</summary>

```bash
git clone https://github.com/unyieldingclaw-dev/ai-code-review-agent.git
cd ai-code-review-agent
npm install
npm run build
npm link
```
</details>

## Usage

### CLI

```bash
# Review staged changes (default)
ai-review

# Review unstaged diff in a specific directory
ai-review --dir /path/to/repo

# Review a saved diff file
ai-review --diff my-changes.diff

# Run specific agents only
ai-review --agents security,correctness,breaking-change

# Override model
ai-review --model qwen3:latest

# JSON output (useful for CI)
ai-review --format json --out findings.json

# Limit diff to first 500 lines
ai-review --max-lines 500

# Set per-agent timeout to 120 seconds
ai-review --timeout 120000

# Gate CI only on critical findings
ai-review --fail-on critical

# Never fail CI regardless of findings
ai-review --fail-on never

# Exclude generated files and test fixtures from review
ai-review --ignore "dist/**" --ignore "**/*.snap"

# Skip prompt-injection sanitization (use if sanitizer causes false positives)
ai-review --no-sanitize

# Full help
ai-review --help
```

**Flag reference:**

| Flag | Default | Description |
|------|---------|-------------|
| `--diff <path>` | — | Review a saved .diff file |
| `--dir <path>` | cwd | Diff the given directory against HEAD |
| `--model <model>` | devstral:latest | Override Ollama model |
| `--agents <list>` | all 11 agents | Comma-separated agent list |
| `--format <fmt>` | markdown | `markdown` or `json` |
| `--out <path>` | stdout | Write report to file |
| `--max-lines <n>` | 2000 | Truncate diff before review |
| `--timeout <ms>` | 60000 | Per-agent timeout |
| `--fail-on <level>` | high | Exit 1 when severity ≥ level (`critical\|high\|medium\|any\|never`) |
| `--ignore <glob>` | — | Exclude matching files (repeatable) |
| `--no-sanitize` | — | Skip prompt injection sanitization |

Exit code `1` when any finding meets the `--fail-on` threshold (default: `high`).

### Claude Code slash command

After installing, use `/ai-review` inside any Claude Code session to run the 11-agent swarm against your current diff and stream findings into the conversation.

### GitHub Actions

See `.github/workflows/review.yml` for the full PR review workflow.

A weekly calibration workflow (`.github/workflows/calibrate.yml`) runs `npm run calibrate` on a self-hosted runner and skips gracefully when Ollama is unavailable.

## Configuration

Create `ai-review.config.json` in your project root to override defaults:

```json
{
  "model": "devstral:latest",
  "ollamaUrl": "http://localhost:11434",
  "maxFindings": 15,
  "agents": ["security", "correctness", "performance", "design", "dependencies",
             "adversarial", "integration", "breaking-change", "license",
             "coverage", "testgen"],
  "testOutputDir": "./ai-review-tests",
  "sanitize": true,
  "provider": "ollama",
  "anthropicModel": "claude-opus-4-8"
}
```

**Config field notes:**
- `provider`: `"ollama"` (default) or `"anthropic"`. The Anthropic provider is defined in the schema but **not yet implemented** — all runs use Ollama regardless of this value. Planned for a future release.
- `anthropicModel`: Model ID to use when `provider` is `"anthropic"` (e.g. `"claude-opus-4-8"`). Has no effect until the Anthropic provider is implemented.

Create `.aiignore` in your repo root to exclude files from every review (gitignore syntax):

```
dist/
build/
*.min.js
**/__snapshots__/
calibration/fixtures/
```

## Guardrails

| Guardrail | CLI flag | Default |
|-----------|----------|---------|
| Diff size limit | `--max-lines` | 2000 lines |
| Per-agent timeout | `--timeout` | 60 s |
| Severity gating | `--fail-on` | high |
| Path exclusions | `--ignore` / `.aiignore` | — |
| Prompt injection sanitization | `--no-sanitize` to disable | enabled |
| Hallucination cross-check | always on | Critical/High require corroboration or ≥60% confidence |
| Finding deduplication | always on | same file:line across agents merged with `corroboratingAgents` |

## Confidence Scoring

Each agent self-reports a `confidence` value (0–100) alongside each finding. The orchestrator uses confidence + corroboration together:

- **Corroborated** finding (≥2 agents at same file±5 lines): kept at original severity
- **Solo Critical + confidence ≥ 60**: kept as Critical
- **Solo Critical + confidence < 60**: downgraded to High
- **Solo High (any confidence)**: downgraded to Medium

Confidence is shown in the markdown report next to each finding.

## Development

```bash
npm test                     # unit tests — no Ollama needed (62 passing)
npm run typecheck            # 0 TypeScript errors
npm run build                # compile to dist/
INTEGRATION=1 npm run test:integration  # e2e — requires Ollama
npm run calibrate            # calibration suite — requires Ollama
```
