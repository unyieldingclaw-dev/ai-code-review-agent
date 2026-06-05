# AI Code Review Agent — Design Spec
**Date:** 2026-06-04
**Status:** Approved

## Context

The PMB project already has a `/code-review` Claude Code slash command (5 subagents, Anthropic API). A prior Claude Code session built a lightweight GitHub Actions-only prototype. This spec defines a dedicated, production-grade code review and deep testing agent that:
- Runs entirely locally via Ollama (no API cost, no data leaves the machine)
- Uses 9 specialist agents + 1 orchestrator
- Covers the full testing lifecycle: gap analysis, test generation, adversarial inputs
- Deploys across 3 surfaces: CLI, GitHub Actions, Claude Code skill
- **Coexists with PMB's `/code-review`** — different tools for different jobs

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    ai-review CORE                       │
│  LLMProvider ── OllamaProvider (devstral:latest)        │
│             └── AnthropicProvider (optional)            │
│  Agent Swarm (10 agents, sequential)                    │
│    Security · Performance · Correctness · Design        │
│    Dependencies · CoverageAnalyst · TestGen             │
│    Adversarial · IntegrationScout · Orchestrator        │
└────────────┬────────────────────────────────────────────┘
             │
    GitHub Actions · CLI (npx) · Claude Code /ai-review
```

## LLM Backend
- OllamaProvider: `http://localhost:11434/api/chat`, `devstral:latest`, `think: true`, 32k context
- AnthropicProvider: optional swap-in via config
- `<think>...</think>` tag stripping (adapted from Google-Organizer ollamaClient.ts)

## Finding Schema
```typescript
interface Finding {
  id: string
  agent: AgentName
  severity: 'critical' | 'high' | 'medium' | 'low'
  basis: 'VERIFIED' | 'INFERRED' | 'SPECULATIVE'
  file: string
  line: number
  title: string
  detail: string
  suggestion: string
  relatedFindings?: string[]
}
```

## Deployment
- `/code-review` (PMB): unchanged, quick Claude-native check
- `/ai-review` (new): deep 9-agent, test generation, free, offline-capable

## Environment
- Node v24, TypeScript strict, Vitest, npm
- Fresh project — not a merge of existing branch
