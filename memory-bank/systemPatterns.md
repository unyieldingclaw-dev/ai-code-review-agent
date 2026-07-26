---
authority: stable
review-cycle: 90d
retention: permanent
staleness-threshold: 180d
tags:
  - architecture/decisions
  - patterns/code
  - anti-patterns
last-reviewed: 2026-07-25
compaction_generation: 0
source_type: canonical
confidence: high
lineage: []
---

# System Patterns & Architecture Decisions

**Last Updated**: 2026-07-25

## Architecture Patterns

### 10-Agent Swarm (9 Specialists + 1 Orchestrator)

**Decision**: One abstract `BaseAgent`, nine concrete specialist subclasses, one `Orchestrator`, driven by `SwarmRunner`.

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
       ├─ CoverageAnalystAgent   (returns gaps + findings)
       └─ TestGenAgent           (produces test file content)
  └─ Orchestrator → deduplicated Finding[]
```

### Sequential Execution

**Decision**: Agents run one-at-a-time by default. `--parallel` is available as an explicit,
off-by-default opt-in for hardware that's been verified to benefit from it.

**Rationale**: Ollama serializes `devstral:latest` inference on this hardware — confirmed
directly, not assumed. A 2026-07-25 investigation (prompted by a real bug report about slow
security-profile runs) tried flipping this default to parallel-by-default. An initial test (4
concurrent requests, a trivial short prompt) showed a ~1.63x wall-clock speedup and looked
promising, but that result didn't hold at the scale and prompt size the default swarm actually
uses. A follow-up test at real scale — 14 concurrent requests (matching the default agent count)
with a realistic ~30KB diff prompt — showed near-linear serialization instead: completions at
58.7s, 91.5s, 120.6s, 172.7s, 235.0s, 305.7s, then a header-timeout failure past 300s for a
still-pending request. Reproduced with `curl` directly (bypassing Node's fetch client) using the
short prompt to rule out a client-side connection-pool artifact — same staggered pattern. Since
each queued request's client-side timeout clock starts the moment it's dispatched (not when
Ollama actually begins generating for it), firing the full default swarm concurrently would have
caused most agents to spuriously time out purely from queue wait — reproducing the exact
"everything times out, 0 findings" failure mode this tool exists to prevent. The original
"parallel requests queue anyway and add overhead" rationale was correct; the parallel-by-default
change was reverted before shipping (`config.ts`'s `parallel: false` has the short version of
this note). `ai-review-agent` has no Anthropic/Claude API integration — every review run is 100%
local Ollama inference, so there's no token-cost pressure to justify accepting this reliability
risk for a modest, hardware-dependent wall-clock speedup. `--parallel` remains available for
users who've verified their own Ollama setup (e.g. more VRAM headroom, `OLLAMA_NUM_PARALLEL` > 1)
actually benefits from it.

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

- ❌ Default agent execution to parallel without verifying it actually helps on real hardware at
  real scale (see "Sequential Execution" above — a 2026-07-25 attempt looked good on a small,
  unrepresentative test and made things worse at the real default scale)
- ❌ Hard-fail on JSON parse errors (degrade gracefully)
- ❌ Call Anthropic/OpenAI APIs in the review pipeline
- ❌ Replace PMB's `/code-review` — both coexist
- ❌ Use `think: false` for agents (reasoning depth required)
- ❌ Re-litigate Option B (coexistence decision is final)
