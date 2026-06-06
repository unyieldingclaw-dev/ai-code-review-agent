# AI Code Review Agent

A local, 9-agent AI code review tool powered by [Ollama](https://ollama.com). Runs against any git diff and produces structured findings across security, correctness, performance, design, dependencies, adversarial patterns, integration risks, test coverage, and test generation — no cloud API calls required.

## Overview

```
git diff → SwarmRunner → 9 specialist agents (sequential) → OrchestratorAgent → findings
```

Each specialist agent receives only the diff and its own system prompt, so agents don't bias each other. The orchestrator deduplicates, cross-references, and caps the final finding set. A CLI, GitHub Actions adapter, and Claude Code slash command provide three distinct surfaces for the same core library.

### Agents

| Agent | Domain |
|---|---|
| SecurityAgent | Injection, auth flaws, secrets, unsafe deserialization |
| PerformanceAgent | Hot paths, N+1 queries, memory pressure |
| CorrectnessAgent | Logic bugs, null dereferences, off-by-one errors |
| DesignAgent | SOLID violations, coupling, abstraction leaks |
| DependenciesAgent | Outdated/vulnerable packages, license risks |
| AdversarialAgent | Adversarial inputs — null/empty/boundary values, unicode edge cases, concurrent access |
| IntegrationScoutAgent | API contract breaks, schema mismatches |
| CoverageAnalystAgent | Test coverage gaps, untested branches |
| TestGenAgent | Generates test stubs for coverage gaps |
| OrchestratorAgent | Dedup, cross-reference escalation, severity cap |

## Requirements

- **Node.js** v18+ (v24 recommended)
- **Ollama** running locally at `http://localhost:11434`
- **devstral:latest** model pulled in Ollama (`ollama pull devstral:latest`)
- Windows 11, macOS, or Linux

## Installation

```bash
git clone https://github.com/unyieldingclaw-dev/ai-code-review-agent.git
cd ai-code-review-agent
npm install
npm run build
```

To use as a global CLI:

```bash
npm link
# or: node dist/cli/index.js --help
```

## Usage

### CLI

```bash
# Review staged changes (default)
ai-review

# Review unstaged diff
ai-review --path .

# Review a saved diff file
ai-review --diff my-changes.diff

# Run specific agents only
ai-review --agents security,correctness

# Override model
ai-review --model qwen3:latest

# JSON output (useful for CI)
ai-review --format json --out findings.json

# Limit diff to first 500 lines
ai-review --max-diff-lines 500

# Set per-agent timeout to 120 seconds
ai-review --timeout 120000

# Gate CI only on critical findings
ai-review --fail-on critical

# Never fail CI regardless of findings
ai-review --fail-on never

# Full help
ai-review --help
```

Exit code `1` when any finding meets the `--fail-on` threshold (default: `high`). Use `--fail-on never` to always exit 0, or `--fail-on critical` to gate only on critical findings.

### Claude Code slash command

After installing, use `/ai-review` inside any Claude Code session to run the full 9-agent swarm against your current diff and stream findings into the conversation.

### GitHub Actions

Add to `.github/workflows/review.yml`:

```yaml
- name: Run AI Review
  run: |
    npm ci && npm run build
    node dist/cli/index.js --format json --out findings.json
  env:
    OLLAMA_HOST: http://localhost:11434
```

The `src/adapters/github.ts` adapter handles PR comment upsert (idempotent) and GitHub Step Summary output.

## Configuration

Create `ai-review.config.json` in your project root to override defaults:

```json
{
  "model": "devstral:latest",
  "ollamaUrl": "http://localhost:11434",
  "maxFindings": 20,
  "agents": ["security", "correctness", "performance", "design", "dependencies",
             "adversarial", "integration", "coverage", "testgen"],
  "testOutputDir": "ai-review-tests"
}
```

## Development

```bash
npm test                    # 19 unit tests (no Ollama needed)
npm run typecheck           # 0 TypeScript errors
npm run build               # compile to dist/
INTEGRATION=1 npm run test:integration  # e2e — requires Ollama
npm run calibrate           # calibration suite — requires Ollama
```

### Project structure

```
src/
  core/
    schema.ts          # Finding type, ReviewInput, CoverageGap
    config.ts          # ReviewConfig + loadConfig()
    llm/
      provider.ts      # LLMProvider interface
      ollamaProvider.ts
    agents/
      base.ts          # BaseAgent (3-stage JSON parse)
      security.ts      # … 8 more specialist agents
      orchestrator.ts
    runner.ts          # SwarmRunner (sequential execution)
  cli/
    index.ts           # Commander entry point
    formatter.ts       # markdown + JSON formatters
  adapters/
    github.ts          # PR comment upsert + Step Summary
tests/
  unit/               # 19 passing tests
  integration/        # e2e against live Ollama (INTEGRATION=1 to run)
calibration/
  fixtures/           # 9 reference diffs with real findings and false-positive baits
  calibrate.ts        # calibration runner (npm run calibrate)
.claude/
  commands/
    ai-review.md      # /ai-review slash command (Task 13)
.github/
  workflows/
    review.yml        # CI workflow
```

## Status

**All 16 tasks complete. 19/19 unit tests passing. 0 TypeScript errors.**

| Task | Description |
|---|---|
| 1 | Project scaffolding — package.json, tsconfig, vitest |
| 2 | Core types — Finding schema, LLMProvider interface |
| 3 | Config loading — ReviewConfig + loadConfig() |
| 4 | OllamaProvider — HTTP client, think-tag stripping, ping |
| 5 | BaseAgent — abstract class with 3-stage JSON parse |
| 6 | SecurityAgent, PerformanceAgent, CorrectnessAgent |
| 7 | DesignAgent, DependenciesAgent, AdversarialAgent, IntegrationScoutAgent |
| 8 | CoverageAnalystAgent + TestGenAgent |
| 9 | OrchestratorAgent — dedup, cross-reference escalation, cap |
| 10 | SwarmRunner — sequential orchestration, coverage-first ordering |
| 11 | CLI entry point + markdown/JSON formatters |
| 12 | GitHub Actions adapter + PR comment upsert + Step Summary |
| 13 | Claude Code slash command `.claude/commands/ai-review.md` |
| 14 | Calibration suite — 9 fixture diffs + false-positive baits + calibrate.ts runner |
| 15 | Integration test — E2E against live Ollama, skippable via `INTEGRATION=1` |
| 16 | Final verification — build, typecheck, CLI smoke-test, all tests green |

## Guardrails

| Guardrail | Behaviour |
|---|---|
| Hallucination cross-check | Critical/High findings require corroboration from ≥ 2 independent agents at the same file + line region (±5 lines). Solo findings are downgraded to Medium. Skipped when only one agent runs. |
| Diff size guard | If the diff exceeds `maxDiffLines` (default 2000), it is truncated and a warning is printed. Override with `--max-diff-lines <n>` or `"maxDiffLines"` in `ai-review.config.json`. |
| Finding deduplication | When multiple agents flag the same file+line, the finding is merged into one entry. All agents that caught it are listed in `corroboratingAgents`. |
| Per-agent timeouts | Each agent call is wrapped in a timeout (default 60 s). A timed-out agent logs a warning and the review continues with the remaining agents' results. Override with `--timeout <ms>` or `"agentTimeoutMs"` in `ai-review.config.json`. |
| Configurable severity gating | `--fail-on <level>` controls when exit code 1 is returned. Options: `critical`, `high` (default), `medium`, `any`, `never`. |

## Design decisions

- **Ollama-only** — no Anthropic/OpenAI API calls in the review pipeline
- **Sequential execution** — Ollama is single-threaded; parallel requests queue anyway
- **`think: true` for all agents** — reasoning depth matters for code review quality
- **3-stage JSON parse** — handles messy LLM output gracefully (full parse → wrapped object → regex-extract)
- **Coexists with PMB `/code-review`** — both slash commands are active; they serve different needs (local vs. cloud)

## License

MIT
