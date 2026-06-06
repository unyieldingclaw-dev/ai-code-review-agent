---
authority: immutable
review-cycle: never
retention: permanent
staleness-threshold: 365d
tags:
  - requirements/core
  - constraints/non-negotiable
last-reviewed: 2026-06-04
compaction_generation: 0
source_type: canonical
confidence: high
lineage: []
---

# Project Brief

**Last Updated**: 2026-06-04

## Core Purpose

A local AI-powered code review agent (`/ai-review`) that runs 9 specialist sub-agents plus an orchestrator against a git diff, using Ollama as the LLM backend. Produces structured findings (security, correctness, performance, design, dependencies, adversarial, integration, coverage, test generation) without requiring any external API calls.

## Non-Negotiable Constraints

### Business Requirements
- Ollama-only backend — no Anthropic/OpenAI API calls in the review pipeline
- `/ai-review` coexists with PMB's `/code-review`; does not replace it (Option B)
- All 9 specialist agents use `think: true` (reasoning depth matters for code review)

### Technical Constraints
- Windows 11 development environment (PowerShell primary shell)
- Ollama with `devstral:latest` (14 GB) at 32k context length
- Sequential agent execution (Ollama is single-threaded)
- Node.js / TypeScript project (`npm`, `vitest` for tests)

### User Experience
- CLI entry point via Commander
- Output in markdown or JSON (formatter flag)
- GitHub Actions adapter for PR comment upsert + Step Summary

## Key Goals

### Phase 1 — Core Infrastructure (Complete: Tasks 1–5)
- [x] Project scaffolding (package.json, tsconfig, vitest)
- [x] Core types & Finding schema
- [x] Config loading with defaults and project override
- [x] OllamaProvider with think-tag stripping and ping
- [x] BaseAgent abstract class with 3-stage JSON parse

### Phase 2 — Specialist Agents + Orchestrator (Tasks 6–10) ✅ COMPLETE
- [x] Security, Performance, Correctness agents (Task 6)
- [x] Design, Dependencies, Adversarial, IntegrationScout agents (Task 7)
- [x] CoverageAnalyst + TestGen agents (Task 8)
- [x] Orchestrator — dedup, cross-reference escalation, cap (Task 9)
- [x] SwarmRunner — sequential orchestration + ping check (Task 10)

### Phase 3 — CLI, CI, Distribution (Tasks 11–16)
- [ ] CLI entry point + markdown/json formatters (Task 11)
- [ ] GitHub Actions adapter + workflow (Task 12)
- [ ] Claude Code slash command `.claude/commands/ai-review.md` (Task 13)
- [ ] Calibration suite — 9 fixture diffs + calibrate.ts (Task 14)
- [ ] Integration test — full e2e against real Ollama (Task 15)
- [ ] Final wiring + verification (Task 16)

## Success Metrics

| Metric | Target | Current |
|--------|--------|---------|
| Unit tests passing | 100% | 12/12 ✅ |
| TypeScript errors | 0 | 0 ✅ |
| Agent count | 9 specialists + 1 orchestrator | 0/10 implemented |
| Calibration score | TBD | — |

## Stakeholders

| Role | Person/Team | Responsibility |
|------|-------------|----------------|
| Primary User | Mizzo (solo) | Runs reviews on local diffs |
| Development | Mizzo + Claude | Builds the tool |

## Out of Scope

- Parallel agent execution (Ollama single-threaded; sequential only)
- Replacing PMB's `/code-review` — both coexist
- Cloud-hosted LLM inference in the hot path
- Multi-repo or monorepo orchestration
