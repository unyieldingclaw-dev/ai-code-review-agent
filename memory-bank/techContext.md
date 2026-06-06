---
authority: stable
review-cycle: 30d
retention: permanent
staleness-threshold: 90d
tags:
  - stack/backend
  - stack/frontend
  - env/tools
last-reviewed: 2026-06-04
compaction_generation: 0
source_type: canonical
confidence: high
lineage: []
---

# Technical Context & Stack

**Last Updated**: 2026-06-04

## Development Environment

| Component | Value |
|-----------|-------|
| OS | Windows 11 Home 10.0.26200 |
| Shell | PowerShell (primary), Bash available via Bash tool |
| IDE | Claude Code (CLI + desktop) |
| Git remote | `master` branch, no GitHub remote yet |
| Package Manager | npm |

## Backend Stack

### Core
- **Language**: TypeScript (strict mode)
- **Runtime**: Node.js
- **Build**: `tsc` via `tsconfig.json`
- **Test runner**: Vitest

### LLM Backend
- **Provider**: Ollama (local HTTP, `http://localhost:11434`)
- **Model**: `devstral:latest` (14 GB, installed)
- **Context length**: 32k (set in Ollama settings)
- **Interface**: `LLMProvider` (src/core/llm/provider.ts)
- **Implementation**: `OllamaProvider` (src/core/llm/ollamaProvider.ts)

### Key Source Files

| File | Purpose |
|------|---------|
| `src/core/schema.ts` | All shared types: Finding, Severity, Category |
| `src/core/config.ts` | ReviewConfig + loadConfig() with project override |
| `src/core/llm/provider.ts` | LLMProvider interface |
| `src/core/llm/ollamaProvider.ts` | Ollama HTTP client + think-tag stripping |
| `src/core/agents/base.ts` | BaseAgent abstract class + 3-stage JSON parse |

### Test Files

| File | Tests |
|------|-------|
| `tests/unit/config.test.ts` | 2 passing |
| `tests/unit/ollamaProvider.test.ts` | 5 passing |
| `tests/unit/baseAgent.test.ts` | 5 passing |
| `tests/unit/orchestrator.test.ts` | 4 passing |
| `tests/unit/runner.test.ts` | 3 passing |

## Configuration

### Configuration Files

| File | Purpose |
|------|---------|
| `ai-review.config.json` | Project-level review config override |
| `package.json` | npm scripts, dependencies |
| `tsconfig.json` | TypeScript compiler options |
| `vitest.config.ts` | Vitest test runner config |

### Key npm Scripts

```bash
npm test               # run all unit tests
npm test -- baseAgent  # run specific test file
npm run typecheck      # tsc --noEmit
npm run build          # compile TypeScript
```

## Infrastructure

### Services

| Service | Port | Status |
|---------|------|--------|
| Ollama | 11434 | Must be running for reviews and integration tests |

## Current State (as of 2026-06-05)

- **Tests**: 19 passing, 0 failing
- **TypeScript**: 0 errors
- **Git**: 10 commits on `master`, clean working tree
- **Tasks complete**: 1–10 of 16

## Plan & Spec Documents

| File | Purpose |
|------|---------|
| `docs/superpowers/specs/2026-06-04-ai-code-review-agent-design.md` | Full design spec |
| `docs/superpowers/plans/2026-06-04-ai-code-review-agent.md` | 16-task implementation plan |
