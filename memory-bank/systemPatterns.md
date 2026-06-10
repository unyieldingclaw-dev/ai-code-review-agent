---
authority: stable
review-cycle: 90d
retention: permanent
staleness-threshold: 180d
tags:
  - architecture/decisions
  - patterns/code
  - anti-patterns
last-reviewed: 2026-06-04
compaction_generation: 0
source_type: canonical
confidence: high
lineage: []
---

# System Patterns & Architecture Decisions

**Last Updated**: 2026-06-04

## Architecture Patterns

### 11-Agent Swarm (10 Specialists + 1 Orchestrator)

**Decision**: One abstract `BaseAgent`, ten concrete specialist subclasses, one `Orchestrator`, driven by `SwarmRunner`.

**Rationale**:
- Specialist agents don't bias each other (each sees only the diff + its own system prompt)
- Orchestrator deduplicates and cross-references after all agents complete
- Matches how humans divide code review by domain

**Implementation**:
```
SwarmRunner
  └─ ping check (Ollama live?)
  └─ sequential: Agent[] → Finding[][]
       ├─ SecurityAgent
       ├─ PerformanceAgent
       ├─ CorrectnessAgent
       ├─ DesignAgent
       ├─ DependenciesAgent
       ├─ AdversarialAgent
       ├─ IntegrationScoutAgent
       ├─ BreakingChangeAgent
       ├─ LicenseComplianceAgent
       ├─ CoverageAnalystAgent   (returns gaps + findings)
       └─ TestGenAgent           (produces test file content)
  └─ Orchestrator → deduplicated Finding[]
```

### Sequential Execution

**Decision**: Agents run one-at-a-time, not in parallel.

**Rationale**: Ollama is single-threaded; parallel requests queue anyway and add overhead.

### Option B — Coexistence with PMB `/code-review`

**Decision**: `/ai-review` is a separate slash command that does NOT replace `/code-review`.

**Rationale**: PMB's `/code-review` spawns cloud subagents. `/ai-review` is local-only. Different tradeoffs; keep both.

## Code Patterns

### BaseAgent — 3-Stage JSON Parse

LLMs produce messy output. Parse in order:
1. Parse entire response as JSON array
2. Parse `{"findings": [...]}` wrapped object
3. Regex-extract first JSON array from fenced block

**Never** fail hard on parse — fall back to empty array and log a warning.

### OllamaProvider — Think-Tag Stripping

`devstral` emits `<think>...</think>` blocks before the JSON answer. Strip these before any parse attempt. Adapted from `Google-Organizer/src/workers/ollamaClient.ts`.

### Agent Config

All agents use `think: true`. Unlike Google-Organizer (which uses `think: false`), reasoning depth matters for code review quality.

### Finding Schema

All agents return `Finding[]`. Key fields: `severity`, `category`, `file`, `line`, `message`, `suggestion`. Defined in `src/core/schema.ts`.

## Data Flow

1. User runs `ai-review` on a git diff
2. SwarmRunner pings Ollama (fail fast if down)
3. Each specialist agent receives the diff + its system prompt
4. Agent calls OllamaProvider, strips think-tags, 3-stage parses JSON
5. Orchestrator deduplicates across agents, applies cap, escalates cross-references
6. Formatter renders findings as markdown or JSON

## Git & Version Control

### Commit Message Format

```
<type>: <short description>

Types: feat, fix, chore, docs, refactor, test, style
```

### Branch Strategy

- `master` — active development (single-dev project, no PR workflow yet)
- `main` — target for PRs when distribution is set up

## Never Do This

- ❌ Add parallel agent execution (Ollama can't use it)
- ❌ Hard-fail on JSON parse errors (degrade gracefully)
- ❌ Call Anthropic/OpenAI APIs in the review pipeline
- ❌ Replace PMB's `/code-review` — both coexist
- ❌ Use `think: false` for agents (reasoning depth required)
- ❌ Re-litigate Option B (coexistence decision is final)
