# New Specialist Agents (v0.8.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 5 new specialist agents (SecretsAgent, ErrorHandlingAgent, ObservabilityAgent, MigrationSafetyAgent, ComplexityAgent) to the AI Code Review swarm, shipping as v0.8.0.

**Architecture:** Each agent extends `BaseAgent` from `src/core/agents/base.ts`, lives in `src/core/agents/` with a camelCase filename, and is registered in the `buildAgents` Map in `src/core/runner.ts`. Two hybrid agents (SecretsAgent, ComplexityAgent) shell out to optional external tools (gitleaks/trufflehog and lizard) via a new `src/utils/shell.ts` utility, falling back to LLM-only when tools are absent. MigrationSafetyAgent is conditionally excluded from the run when the diff contains no migration files.

**Tech Stack:** TypeScript, Vitest (tests), Node.js `child_process.spawn` (shell utility), gitleaks/trufflehog/lizard (optional external tools), Ollama (LLM).

---

## File Map

| File                                         | Operation | Responsibility                                                                                                        |
| -------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------- |
| `src/core/schema.ts`                         | Modify    | Add 5 new AgentName union members                                                                                     |
| `src/core/config.ts`                         | Modify    | Add `preferredSecretsScanner?` and `complexityThreshold?` to interface; add 5 agents to DEFAULT_CONFIG in Step 9 only |
| `src/core/runner.ts`                         | Modify    | Add helpers + 5 imports + 5 buildAgents entries + migration conditional                                               |
| `src/core/agents/orchestrator.ts`            | Modify    | Append 5 new names to AGENT_PRIORITY array                                                                            |
| `src/utils/shell.ts`                         | Create    | `runTool()` — spawn helper, null on ENOENT, resolve on close event                                                    |
| `src/core/agents/errorHandling.ts`           | Create    | Pure LLM agent for swallowed exceptions and ignored rejections                                                        |
| `src/core/agents/observability.ts`           | Create    | Pure LLM agent for missing log output on new code paths                                                               |
| `src/core/agents/migrationSafety.ts`         | Create    | Pure LLM agent for migration anti-patterns (conditional execution)                                                    |
| `src/core/agents/secrets.ts`                 | Create    | Hybrid: gitleaks/trufflehog + LLM, deduped by file:line                                                               |
| `src/core/agents/complexity.ts`              | Create    | Hybrid: lizard CCN metrics + LLM, threshold configurable                                                              |
| `tests/unit/errorHandlingAgent.test.ts`      | Create    | 5 tests                                                                                                               |
| `tests/unit/observabilityAgent.test.ts`      | Create    | 5 tests                                                                                                               |
| `tests/unit/migrationSafetyAgent.test.ts`    | Create    | 5 tests                                                                                                               |
| `tests/unit/secretsAgent.test.ts`            | Create    | 5 tests (mocks shell.ts)                                                                                              |
| `tests/unit/complexityAgent.test.ts`         | Create    | 5 tests (mocks shell.ts)                                                                                              |
| `tests/unit/runner.test.ts`                  | Modify    | Fix onProgress test + add migration exclusion test                                                                    |
| `calibration/calibrate.ts`                   | Modify    | 5 new imports + 5 CASES + 5 agentMap entries                                                                          |
| `calibration/fixtures/secrets.diff`          | Create    | Fixture with hardcoded Stripe live key                                                                                |
| `calibration/fixtures/error-handling.diff`   | Create    | Fixture with empty catch block                                                                                        |
| `calibration/fixtures/observability.diff`    | Create    | Fixture with unlogged payment failure path                                                                            |
| `calibration/fixtures/migration-safety.diff` | Create    | Fixture with NOT NULL without DEFAULT                                                                                 |
| `calibration/fixtures/complexity.diff`       | Create    | Fixture with high-CCN invoice processor                                                                               |
| `package.json`                               | Modify    | Bump version to 0.8.0 (Step 9)                                                                                        |
| `README.md`                                  | Modify    | Document new agents and config fields (Step 9)                                                                        |
| `memory-bank/activeContext.md`               | Modify    | Update current focus (Step 9)                                                                                         |
| `memory-bank/progress.md`                    | Modify    | Mark v0.8.0 complete (Step 9)                                                                                         |

**CRITICAL ordering rule:** Do NOT add new agent names to `DEFAULT_CONFIG.agents` until Step 9. If added before being registered in the `buildAgents` Map, runner.ts warns and returns `[]` for unknown agents — `onProgress` is never called for them — causing the `progress.length` assertion in runner.test.ts to fail.

---

## Task 0: Write and commit design doc

**Files:**

- Create: `docs/superpowers/specs/2026-06-14-new-specialist-agents-design.md`

- [ ] **Step 1: Write the design doc**

```bash
# Content mirrors the plan header/architecture section above.
# File already exists at docs/superpowers/specs/2026-06-14-new-specialist-agents-design.md
# if brainstorming was run. If not, create it with a brief architecture summary.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-06-14-new-specialist-agents-design.md
git commit -m "docs: add v0.8.0 new specialist agents design spec"
```

---

## Task 1: Foundation — schema, config interface, shell utility

**Files:**

- Modify: `src/core/schema.ts`
- Modify: `src/core/config.ts`
- Create: `src/utils/shell.ts`

- [ ] **Step 1: Add 5 AgentName entries to `src/core/schema.ts`**

Find the current AgentName type (11 members) and append 5 new ones:

```typescript
// Before (line ~5):
export type AgentName =
  | 'security'
  | 'performance'
  | 'correctness'
  | 'design'
  | 'dependencies'
  | 'coverage'
  | 'testgen'
  | 'adversarial'
  | 'integration'
  | 'breaking-change'
  | 'license'

// After:
export type AgentName =
  | 'security'
  | 'performance'
  | 'correctness'
  | 'design'
  | 'dependencies'
  | 'coverage'
  | 'testgen'
  | 'adversarial'
  | 'integration'
  | 'breaking-change'
  | 'license'
  | 'secrets'
  | 'error-handling'
  | 'observability'
  | 'migration-safety'
  | 'complexity'
```

- [ ] **Step 2: Add 2 optional fields to `ReviewConfig` interface in `src/core/config.ts`**

```typescript
// Add to the ReviewConfig interface (do NOT touch DEFAULT_CONFIG.agents yet):
export interface ReviewConfig {
  // ... existing fields ...
  preferredSecretsScanner?: 'gitleaks' | 'trufflehog' | 'none'
  complexityThreshold?: number
}
```

- [ ] **Step 3: Create `src/utils/shell.ts`**

```typescript
import { spawn } from 'child_process'

export function runTool(cmd: string, args: string[], stdinData?: string): Promise<string | null> {
  return new Promise((resolve, reject) => {
    let stdout = ''
    const proc = spawn(cmd, args, {
      stdio: stdinData !== undefined ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
    })
    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    proc.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') resolve(null)
      else reject(err)
    })
    // Use 'close' (not 'exit') — gitleaks exits non-zero when secrets are found,
    // but we still want to read its output.
    proc.on('close', () => resolve(stdout.trim() || null))
    if (stdinData !== undefined && proc.stdin) {
      proc.stdin.write(stdinData)
      proc.stdin.end()
    }
  })
}
```

- [ ] **Step 4: Verify**

```bash
npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/core/schema.ts src/core/config.ts src/utils/shell.ts
git commit -m "feat: foundation for v0.8.0 — schema, config interface, shell utility"
```

---

## Task 2: ErrorHandlingAgent (pure LLM)

**Files:**

- Create: `tests/unit/errorHandlingAgent.test.ts`
- Create: `src/core/agents/errorHandling.ts`
- Modify: `src/core/runner.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/errorHandlingAgent.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { ErrorHandlingAgent } from '../../src/core/agents/errorHandling.js'
import { DEFAULT_CONFIG } from '../../src/core/config.js'
import type { LLMProvider } from '../../src/core/llm/provider.js'

const makeProvider = (response: string): LLMProvider => ({
  chat: vi.fn().mockResolvedValue(response),
  ping: vi.fn().mockResolvedValue({ ok: true }),
})

describe('ErrorHandlingAgent', () => {
  it('has name error-handling', () => {
    const agent = new ErrorHandlingAgent(makeProvider('[]'), DEFAULT_CONFIG)
    expect(agent.name).toBe('error-handling')
  })

  it('returns empty array when provider returns empty JSON array', async () => {
    const agent = new ErrorHandlingAgent(makeProvider('[]'), DEFAULT_CONFIG)
    expect(await agent.run({ diff: 'diff content' })).toEqual([])
  })

  it('parses a valid finding and stamps agent name', async () => {
    const raw = JSON.stringify([
      {
        severity: 'high',
        basis: 'VERIFIED',
        file: 'src/api.ts',
        line: 10,
        title: 'Swallowed exception in fetchUser',
        detail: 'The catch block is empty',
        suggestion: 'Rethrow the error',
      },
    ])
    const agent = new ErrorHandlingAgent(makeProvider(raw), DEFAULT_CONFIG)
    const findings = await agent.run({ diff: 'diff' })
    expect(findings).toHaveLength(1)
    expect(findings[0].agent).toBe('error-handling')
    expect(findings[0].id).toBe('error-handling-0')
  })

  it('returns empty array on parse failure', async () => {
    const agent = new ErrorHandlingAgent(makeProvider('not json'), DEFAULT_CONFIG)
    expect(await agent.run({ diff: 'diff' })).toEqual([])
  })

  it('system prompt mentions swallowed exceptions and Promise rejections', () => {
    const agent = new ErrorHandlingAgent(makeProvider('[]'), DEFAULT_CONFIG)
    expect(agent.systemPrompt).toMatch(/swallowed/i)
    expect(agent.systemPrompt).toMatch(/promise/i)
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run tests/unit/errorHandlingAgent.test.ts
```

Expected: FAIL — `Cannot find module '../../src/core/agents/errorHandling.js'`

- [ ] **Step 3: Implement `src/core/agents/errorHandling.ts`**

```typescript
import { BaseAgent } from './base.js'
import type { AgentName } from '../schema.js'

export class ErrorHandlingAgent extends BaseAgent {
  get name(): AgentName {
    return 'error-handling'
  }

  get systemPrompt(): string {
    return `You are a code reviewer specializing in error handling quality.
Analyze the diff for these patterns:
- Swallowed exceptions: empty catch blocks or catch blocks that only comment
- Ignored Promise rejections: .catch(() => {}) or unhandled async errors
- Sentinel return values: returning null/undefined/-1/false on error instead of throwing
- Log-and-continue: catching an error, logging it, then continuing as if it didn't happen

severity: "high" for swallowed exceptions or ignored Promise rejections
severity: "medium" for sentinel returns or log-and-continue patterns

Output ONLY a JSON array of findings. Empty array if no issues.
Required format:
[{"severity":"high","basis":"VERIFIED|INFERRED|SPECULATIVE","confidence":80,"file":"path/to/file","line":42,"title":"Short title","detail":"What the problem is","suggestion":"How to fix it"}]`
  }
}
```

- [ ] **Step 4: Register in `src/core/runner.ts`**

Add import after existing imports:

```typescript
import { ErrorHandlingAgent } from './agents/errorHandling.js'
```

Add entry to the `builders` Map inside `buildAgents()`:

```typescript
['error-handling', () => new ErrorHandlingAgent(provider, config)],
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
npx vitest run tests/unit/errorHandlingAgent.test.ts
```

Expected: 5 passed.

- [ ] **Step 6: Run full suite to confirm no regressions**

```bash
npm test
```

Expected: all tests pass (62 existing + 5 new = 67).

- [ ] **Step 7: Commit**

```bash
git add tests/unit/errorHandlingAgent.test.ts src/core/agents/errorHandling.ts src/core/runner.ts
git commit -m "feat: add ErrorHandlingAgent"
```

---

## Task 3: ObservabilityAgent (pure LLM)

**Files:**

- Create: `tests/unit/observabilityAgent.test.ts`
- Create: `src/core/agents/observability.ts`
- Modify: `src/core/runner.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/observabilityAgent.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { ObservabilityAgent } from '../../src/core/agents/observability.js'
import { DEFAULT_CONFIG } from '../../src/core/config.js'
import type { LLMProvider } from '../../src/core/llm/provider.js'

const makeProvider = (response: string): LLMProvider => ({
  chat: vi.fn().mockResolvedValue(response),
  ping: vi.fn().mockResolvedValue({ ok: true }),
})

describe('ObservabilityAgent', () => {
  it('has name observability', () => {
    const agent = new ObservabilityAgent(makeProvider('[]'), DEFAULT_CONFIG)
    expect(agent.name).toBe('observability')
  })

  it('returns empty array when provider returns empty JSON array', async () => {
    expect(
      await new ObservabilityAgent(makeProvider('[]'), DEFAULT_CONFIG).run({ diff: 'diff' })
    ).toEqual([])
  })

  it('parses a valid finding and stamps agent name', async () => {
    const raw = JSON.stringify([
      {
        severity: 'medium',
        basis: 'INFERRED',
        file: 'src/payment.ts',
        line: 15,
        title: 'Missing log on payment failure path',
        detail: 'The error branch returns false with no log output',
        suggestion: 'Add a structured log entry on payment failure',
      },
    ])
    const agent = new ObservabilityAgent(makeProvider(raw), DEFAULT_CONFIG)
    const findings = await agent.run({ diff: 'diff' })
    expect(findings).toHaveLength(1)
    expect(findings[0].agent).toBe('observability')
    expect(findings[0].id).toBe('observability-0')
  })

  it('returns empty array on parse failure', async () => {
    expect(
      await new ObservabilityAgent(makeProvider('not json'), DEFAULT_CONFIG).run({ diff: 'diff' })
    ).toEqual([])
  })

  it('system prompt mentions logging and observability', () => {
    const agent = new ObservabilityAgent(makeProvider('[]'), DEFAULT_CONFIG)
    expect(agent.systemPrompt).toMatch(/log/i)
    expect(agent.systemPrompt).toMatch(/observ/i)
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run tests/unit/observabilityAgent.test.ts
```

Expected: FAIL — `Cannot find module '../../src/core/agents/observability.js'`

- [ ] **Step 3: Implement `src/core/agents/observability.ts`**

```typescript
import { BaseAgent } from './base.js'
import type { AgentName } from '../schema.js'

export class ObservabilityAgent extends BaseAgent {
  get name(): AgentName {
    return 'observability'
  }

  get systemPrompt(): string {
    return `You are a code reviewer specializing in observability and logging quality.
Analyze the diff for new code paths (error branches, state transitions, significant operations) that lack log output.
Infer the logging library from imports or existing log calls in the diff context.
Focus on meaningful events: errors, warnings, significant state changes, external calls.
Do NOT flag pure utility functions, simple getters, or validation helpers.

severity: "medium" for missing logs on error paths or significant operations
severity: "low" for missing logs on informational paths

Output ONLY a JSON array of findings. Empty array if logging is adequate.
Required format:
[{"severity":"medium","basis":"INFERRED","confidence":70,"file":"path/to/file","line":42,"title":"Short title","detail":"What logging is missing","suggestion":"What to log and where"}]`
  }
}
```

- [ ] **Step 4: Register in `src/core/runner.ts`**

Add import:

```typescript
import { ObservabilityAgent } from './agents/observability.js'
```

Add entry to builders Map:

```typescript
['observability', () => new ObservabilityAgent(provider, config)],
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
npx vitest run tests/unit/observabilityAgent.test.ts
```

Expected: 5 passed.

- [ ] **Step 6: Run full suite**

```bash
npm test
```

Expected: all tests pass (72 total).

- [ ] **Step 7: Commit**

```bash
git add tests/unit/observabilityAgent.test.ts src/core/agents/observability.ts src/core/runner.ts
git commit -m "feat: add ObservabilityAgent"
```

---

## Task 4: MigrationSafetyAgent (pure LLM + conditional runner)

**Files:**

- Create: `tests/unit/migrationSafetyAgent.test.ts`
- Create: `src/core/agents/migrationSafety.ts`
- Modify: `src/core/runner.ts` (helpers + import + Map entry + conditional logic)
- Modify: `tests/unit/runner.test.ts` (fix onProgress test + add migration exclusion test)

- [ ] **Step 1: Write the failing agent tests**

Create `tests/unit/migrationSafetyAgent.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { MigrationSafetyAgent } from '../../src/core/agents/migrationSafety.js'
import { DEFAULT_CONFIG } from '../../src/core/config.js'
import type { LLMProvider } from '../../src/core/llm/provider.js'

const makeProvider = (response: string): LLMProvider => ({
  chat: vi.fn().mockResolvedValue(response),
  ping: vi.fn().mockResolvedValue({ ok: true }),
})

describe('MigrationSafetyAgent', () => {
  it('has name migration-safety', () => {
    expect(new MigrationSafetyAgent(makeProvider('[]'), DEFAULT_CONFIG).name).toBe(
      'migration-safety'
    )
  })

  it('returns empty array when provider returns empty JSON array', async () => {
    expect(
      await new MigrationSafetyAgent(makeProvider('[]'), DEFAULT_CONFIG).run({ diff: 'sql' })
    ).toEqual([])
  })

  it('parses a critical finding and stamps agent name', async () => {
    const raw = JSON.stringify([
      {
        severity: 'critical',
        basis: 'VERIFIED',
        confidence: 80,
        file: 'migrations/20260614_add_col.sql',
        line: 3,
        title: 'NOT NULL column without DEFAULT',
        detail: 'Adding NOT NULL column without DEFAULT fails on non-empty tables',
        suggestion: 'Add a DEFAULT value or make the column nullable initially',
      },
    ])
    const agent = new MigrationSafetyAgent(makeProvider(raw), DEFAULT_CONFIG)
    const findings = await agent.run({ diff: 'diff' })
    expect(findings).toHaveLength(1)
    expect(findings[0].agent).toBe('migration-safety')
    expect(findings[0].id).toBe('migration-safety-0')
  })

  it('returns empty array on parse failure', async () => {
    expect(
      await new MigrationSafetyAgent(makeProvider('not json'), DEFAULT_CONFIG).run({ diff: 'diff' })
    ).toEqual([])
  })

  it('system prompt mentions NOT NULL and DROP statements', () => {
    const agent = new MigrationSafetyAgent(makeProvider('[]'), DEFAULT_CONFIG)
    expect(agent.systemPrompt).toMatch(/NOT NULL/i)
    expect(agent.systemPrompt).toMatch(/DROP/i)
  })
})
```

- [ ] **Step 2: Run agent tests to confirm they fail**

```bash
npx vitest run tests/unit/migrationSafetyAgent.test.ts
```

Expected: FAIL — `Cannot find module '../../src/core/agents/migrationSafety.js'`

- [ ] **Step 3: Implement `src/core/agents/migrationSafety.ts`**

```typescript
import { BaseAgent } from './base.js'
import type { AgentName } from '../schema.js'

export class MigrationSafetyAgent extends BaseAgent {
  get name(): AgentName {
    return 'migration-safety'
  }

  get systemPrompt(): string {
    return `You are a database migration safety reviewer.
Analyze the diff for migration anti-patterns that can cause data loss or deployment failures:
- NOT NULL column added without a DEFAULT value (fails on non-empty tables)
- DROP TABLE or DROP COLUMN without IF EXISTS guard
- Missing index on new foreign key column (causes full table scans)
- Missing down migration / rollback script
- RENAME COLUMN or RENAME TABLE without a compatibility shim
- Adding a UNIQUE constraint on a column that may have existing duplicates

severity: "critical" for NOT NULL without DEFAULT, DROP without IF EXISTS (immediate data risk)
severity: "high" for missing FK index, missing rollback
severity: "medium" for compatibility concerns

Default confidence: 80 (migrations are deterministic — SQL is explicit).
Output ONLY a JSON array of findings. Empty array if no migration issues.
Required format:
[{"severity":"critical","basis":"VERIFIED","confidence":80,"file":"migrations/file.sql","line":3,"title":"Short title","detail":"Why this is dangerous","suggestion":"Safe alternative"}]`
  }
}
```

- [ ] **Step 4: Add helpers, import, Map entry, and conditional to `src/core/runner.ts`**

Add two helper functions before `buildAgents()`:

```typescript
function extractFilePaths(diff: string): string[] {
  const files: string[] = []
  for (const line of diff.split('\n')) {
    const m = line.match(/^\+\+\+ b\/(.+)$/)
    if (m) files.push(m[1])
  }
  return files
}

function hasMigrationFiles(diff: string): boolean {
  return extractFilePaths(diff).some(
    (f) =>
      /migrations\//.test(f) ||
      /\.migration\.(ts|js|sql)$/.test(f) ||
      /versions\//.test(f) ||
      /_up\.sql$/.test(f)
  )
}
```

Add import:

```typescript
import { MigrationSafetyAgent } from './agents/migrationSafety.js'
```

Add entry to builders Map:

```typescript
['migration-safety', () => new MigrationSafetyAgent(provider, config)],
```

Replace line 146 (`const agents = buildAgents(this.config, this.provider)`) with:

```typescript
const effectiveAgents = hasMigrationFiles(input.diff)
  ? this.config.agents
  : this.config.agents.filter((a) => a !== 'migration-safety')
const agents = buildAgents({ ...this.config, agents: effectiveAgents }, this.provider)
```

- [ ] **Step 5: Update `tests/unit/runner.test.ts`**

Fix the `'calls onProgress for each agent'` test to use a migration diff (so it stays correct after Step 9 when `migration-safety` is added to DEFAULT_CONFIG):

```typescript
// Replace existing test (lines 23-29):
it('calls onProgress for each agent', async () => {
  const provider = makeProvider()
  const runner = new SwarmRunner(DEFAULT_CONFIG, provider)
  const progress: string[] = []
  const diff = '+++ b/migrations/20260614_add_users.sql\n+CREATE TABLE users (id INT);'
  await runner.run({ diff }, (agent) => progress.push(agent))
  expect(progress.length).toBe(DEFAULT_CONFIG.agents.length)
})
```

Add new test after that test:

```typescript
it('excludes migration-safety when diff has no migration files', async () => {
  const config = { ...DEFAULT_CONFIG, agents: ['security', 'migration-safety'] as AgentName[] }
  const provider = makeProvider()
  const runner = new SwarmRunner(config, provider)
  const progress: string[] = []
  await runner.run({ diff: '+++ b/src/api.ts\n+const x = 1' }, (agent) => progress.push(agent))
  expect(progress).not.toContain('migration-safety')
  expect(progress).toContain('security')
})
```

- [ ] **Step 6: Run all tests**

```bash
npm test
```

Expected: all tests pass (78 total: 72 existing + 5 migrationSafety + 1 new runner test).

- [ ] **Step 7: Commit**

```bash
git add tests/unit/migrationSafetyAgent.test.ts src/core/agents/migrationSafety.ts src/core/runner.ts tests/unit/runner.test.ts
git commit -m "feat: add MigrationSafetyAgent with conditional execution"
```

---

## Task 5: SecretsAgent (hybrid — gitleaks/trufflehog + LLM)

**Files:**

- Create: `tests/unit/secretsAgent.test.ts`
- Create: `src/core/agents/secrets.ts`
- Modify: `src/core/runner.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/secretsAgent.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SecretsAgent } from '../../src/core/agents/secrets.js'
import { DEFAULT_CONFIG } from '../../src/core/config.js'
import { runTool } from '../../src/utils/shell.js'
import type { LLMProvider } from '../../src/core/llm/provider.js'

vi.mock('../../src/utils/shell.js', () => ({ runTool: vi.fn() }))

const makeProvider = (response: string): LLMProvider => ({
  chat: vi.fn().mockResolvedValue(response),
  ping: vi.fn().mockResolvedValue({ ok: true }),
})

describe('SecretsAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('has name secrets', () => {
    expect(new SecretsAgent(makeProvider('[]'), DEFAULT_CONFIG).name).toBe('secrets')
  })

  it('returns LLM findings when scanner returns null (tool not installed)', async () => {
    vi.mocked(runTool).mockResolvedValue(null)
    const raw = JSON.stringify([
      {
        severity: 'high',
        basis: 'INFERRED',
        file: 'src/config.ts',
        line: 5,
        title: 'Hardcoded credential',
        detail: 'Looks like an API key',
        suggestion: 'Use env var',
      },
    ])
    const agent = new SecretsAgent(makeProvider(raw), DEFAULT_CONFIG)
    const findings = await agent.run({ diff: '+const KEY = "abc123"' })
    expect(findings).toHaveLength(1)
    expect(findings[0].agent).toBe('secrets')
  })

  it('converts gitleaks JSON output to a critical finding', async () => {
    const gitleaksOutput = JSON.stringify([
      {
        Description: 'AWS Access Key',
        StartLine: 42,
        File: 'src/config.ts',
        Secret: 'AKIAIOSFODNN7EXAMPLE',
        RuleID: 'aws-access-key-id',
      },
    ])
    vi.mocked(runTool).mockResolvedValue(gitleaksOutput)
    const agent = new SecretsAgent(makeProvider('[]'), DEFAULT_CONFIG)
    const findings = await agent.run({ diff: '+const KEY = "AKIAIOSFODNN7EXAMPLE"' })
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe('critical')
    expect(findings[0].title).toContain('AWS Access Key')
  })

  it('deduplicates tool and LLM findings at the same file:line', async () => {
    vi.mocked(runTool).mockResolvedValue(
      JSON.stringify([
        {
          Description: 'AWS Access Key',
          StartLine: 42,
          File: 'src/config.ts',
          Secret: 'AKIAIOSFODNN7EXAMPLE',
          RuleID: 'aws-access-key-id',
        },
      ])
    )
    const llmFinding = JSON.stringify([
      {
        severity: 'high',
        basis: 'INFERRED',
        file: 'src/config.ts',
        line: 42,
        title: 'Possible secret',
        detail: 'Looks like an API key',
        suggestion: 'Use env var',
      },
    ])
    const agent = new SecretsAgent(makeProvider(llmFinding), DEFAULT_CONFIG)
    const findings = await agent.run({ diff: '+const KEY = "AKIAIOSFODNN7EXAMPLE"' })
    expect(findings).toHaveLength(1)
  })

  it('skips scanner and uses LLM only when preferredSecretsScanner is none', async () => {
    const config = { ...DEFAULT_CONFIG, preferredSecretsScanner: 'none' as const }
    const raw = JSON.stringify([
      {
        severity: 'high',
        basis: 'INFERRED',
        file: 'src/auth.ts',
        line: 3,
        title: 'Hardcoded token',
        detail: 'Base64 encoded credential',
        suggestion: 'Use env var',
      },
    ])
    const agent = new SecretsAgent(makeProvider(raw), config)
    await agent.run({ diff: '+const TOKEN = "dXNlcjpwYXNz"' })
    expect(vi.mocked(runTool)).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run tests/unit/secretsAgent.test.ts
```

Expected: FAIL — `Cannot find module '../../src/core/agents/secrets.js'`

- [ ] **Step 3: Implement `src/core/agents/secrets.ts`**

```typescript
import { BaseAgent } from './base.js'
import { runTool } from '../../utils/shell.js'
import type { AgentName, Finding, ReviewInput } from '../schema.js'

export class SecretsAgent extends BaseAgent {
  get name(): AgentName {
    return 'secrets'
  }

  get systemPrompt(): string {
    return `You are a security reviewer specializing in secret and credential detection.
Analyze the diff for hardcoded secrets that automated scanners may miss:
- API keys and tokens embedded in source code
- Base64-encoded credentials
- Connection strings with embedded passwords
- OAuth client secrets
- Private keys and certificates

severity: "critical" for confirmed secrets (clear key format, high entropy)
severity: "high" for likely secrets (encoded, obfuscated, or unusual format)

Output ONLY a JSON array of findings. Empty array if no secrets detected.
Required format:
[{"severity":"critical","basis":"VERIFIED","confidence":90,"file":"path/to/file","line":42,"title":"Short title","detail":"What was found","suggestion":"Remove and rotate immediately, use env vars or secrets manager"}]`
  }

  async run(input: ReviewInput): Promise<Finding[]> {
    const scanner = this.config.preferredSecretsScanner ?? 'gitleaks'
    if (scanner === 'none') {
      return super.run(input)
    }
    const [toolFindings, llmFindings] = await Promise.all([
      this.runScanner(scanner, input.diff),
      super.run(input),
    ])
    return this.mergeDedup([...toolFindings, ...llmFindings])
  }

  private async runScanner(scanner: 'gitleaks' | 'trufflehog', diff: string): Promise<Finding[]> {
    if (scanner === 'gitleaks') return this.runGitleaks(diff)
    return this.runTrufflehog(diff)
  }

  private async runGitleaks(diff: string): Promise<Finding[]> {
    const output = await runTool(
      'gitleaks',
      ['detect', '--stdin', '--report-format', 'json', '--no-git', '--quiet'],
      diff
    )
    if (!output) return []
    try {
      const hits = JSON.parse(output) as Array<{
        Description: string
        StartLine: number
        File: string
        Secret: string
        RuleID: string
      }>
      return hits.map((h, i) => ({
        id: `secrets-tool-${i}`,
        agent: this.name,
        severity: 'critical' as const,
        basis: 'VERIFIED' as const,
        confidence: 95,
        file: h.File,
        line: h.StartLine,
        title: `Secret detected: ${h.Description}`,
        detail: `Rule ${h.RuleID} matched. Secret present in diff.`,
        suggestion:
          'Remove the secret from source, rotate it immediately, and use environment variables or a secrets manager.',
      }))
    } catch {
      return []
    }
  }

  private async runTrufflehog(diff: string): Promise<Finding[]> {
    const output = await runTool('trufflehog', ['stdin', '--json'], diff)
    if (!output) return []
    const findings: Finding[] = []
    let i = 0
    for (const line of output.split('\n')) {
      if (!line.trim()) continue
      try {
        const hit = JSON.parse(line) as {
          DetectorName: string
          SourceMetadata: { Data: { Filesystem: { file: string; line: number } } }
        }
        const meta = hit.SourceMetadata?.Data?.Filesystem
        findings.push({
          id: `secrets-tool-${i++}`,
          agent: this.name,
          severity: 'critical' as const,
          basis: 'VERIFIED' as const,
          confidence: 95,
          file: meta?.file ?? 'unknown',
          line: meta?.line ?? 0,
          title: `Secret detected: ${hit.DetectorName}`,
          detail: `TruffleHog detected a credential of type ${hit.DetectorName}.`,
          suggestion:
            'Remove the secret from source, rotate it immediately, and use environment variables or a secrets manager.',
        })
      } catch {
        /* skip malformed lines */
      }
    }
    return findings
  }

  private mergeDedup(findings: Finding[]): Finding[] {
    const seen = new Map<string, Finding>()
    for (const f of findings) {
      const key = `${f.file}:${f.line}`
      if (!seen.has(key)) seen.set(key, f)
    }
    return Array.from(seen.values()).map((f, i) => ({ ...f, id: `secrets-${i}` }))
  }
}
```

- [ ] **Step 4: Register in `src/core/runner.ts`**

Add import:

```typescript
import { SecretsAgent } from './agents/secrets.js'
```

Add entry to builders Map:

```typescript
['secrets', () => new SecretsAgent(provider, config)],
```

- [ ] **Step 5: Run tests**

```bash
npx vitest run tests/unit/secretsAgent.test.ts
```

Expected: 5 passed.

- [ ] **Step 6: Run full suite**

```bash
npm test
```

Expected: all tests pass (83 total).

- [ ] **Step 7: Commit**

```bash
git add tests/unit/secretsAgent.test.ts src/core/agents/secrets.ts src/core/runner.ts
git commit -m "feat: add SecretsAgent (hybrid gitleaks/LLM)"
```

---

## Task 6: ComplexityAgent (hybrid — lizard + LLM)

**Files:**

- Create: `tests/unit/complexityAgent.test.ts`
- Create: `src/core/agents/complexity.ts`
- Modify: `src/core/runner.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/complexityAgent.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ComplexityAgent } from '../../src/core/agents/complexity.js'
import { DEFAULT_CONFIG } from '../../src/core/config.js'
import { runTool } from '../../src/utils/shell.js'
import type { LLMProvider } from '../../src/core/llm/provider.js'

vi.mock('../../src/utils/shell.js', () => ({ runTool: vi.fn() }))

const makeProvider = (response: string): LLMProvider => ({
  chat: vi.fn().mockResolvedValue(response),
  ping: vi.fn().mockResolvedValue({ ok: true }),
})

describe('ComplexityAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('has name complexity', () => {
    expect(new ComplexityAgent(makeProvider('[]'), DEFAULT_CONFIG).name).toBe('complexity')
  })

  it('falls back to LLM-only when lizard returns null', async () => {
    vi.mocked(runTool).mockResolvedValue(null)
    const findings = await new ComplexityAgent(makeProvider('[]'), DEFAULT_CONFIG).run({
      diff: '+++ b/src/api.ts\n+const x = 1',
    })
    expect(findings).toEqual([])
  })

  it('augments diff with COMPLEXITY METRICS when lizard finds high-CCN function', async () => {
    const csvOutput = [
      'NLOC,CCN,token_count,param_count,length,location,file_name,method_name,long_name,start_line,end_line',
      '50,15,200,3,60,src/processor.ts:10,src/processor.ts,processData,processData( input ),10,70',
    ].join('\n')
    vi.mocked(runTool).mockResolvedValue(csvOutput)
    const provider = makeProvider('[]')
    const agent = new ComplexityAgent(provider, DEFAULT_CONFIG)
    await agent.run({ diff: '+++ b/src/processor.ts\n+function processData(input) {}' })
    const messages = (provider.chat as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(messages[1].content).toContain('COMPLEXITY METRICS')
    expect(messages[1].content).toContain('CCN=15')
  })

  it('does not prepend metrics when all functions are below threshold', async () => {
    const csvOutput = [
      'NLOC,CCN,token_count,param_count,length,location,file_name,method_name,long_name,start_line,end_line',
      '10,5,50,1,12,src/utils.ts:1,src/utils.ts,helper,helper( x ),1,12',
    ].join('\n')
    vi.mocked(runTool).mockResolvedValue(csvOutput)
    const provider = makeProvider('[]')
    await new ComplexityAgent(provider, DEFAULT_CONFIG).run({
      diff: '+++ b/src/utils.ts\n+function helper(x) {}',
    })
    const messages = (provider.chat as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(messages[1].content).not.toContain('COMPLEXITY METRICS')
  })

  it('uses complexityThreshold from config', async () => {
    const csvOutput = [
      'NLOC,CCN,token_count,param_count,length,location,file_name,method_name,long_name,start_line,end_line',
      '20,8,80,2,25,src/utils.ts:1,src/utils.ts,helper,helper( x ),1,25',
    ].join('\n')
    vi.mocked(runTool).mockResolvedValue(csvOutput)
    const config = { ...DEFAULT_CONFIG, complexityThreshold: 7 }
    const provider = makeProvider('[]')
    await new ComplexityAgent(provider, config).run({
      diff: '+++ b/src/utils.ts\n+function helper(x) {}',
    })
    const messages = (provider.chat as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(messages[1].content).toContain('COMPLEXITY METRICS')
    expect(messages[1].content).toContain('CCN=8')
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run tests/unit/complexityAgent.test.ts
```

Expected: FAIL — `Cannot find module '../../src/core/agents/complexity.js'`

- [ ] **Step 3: Implement `src/core/agents/complexity.ts`**

```typescript
import { BaseAgent } from './base.js'
import { runTool } from '../../utils/shell.js'
import type { AgentName, ReviewInput, Finding } from '../schema.js'

export class ComplexityAgent extends BaseAgent {
  get name(): AgentName {
    return 'complexity'
  }

  get systemPrompt(): string {
    return `You are a code reviewer specializing in cyclomatic complexity and maintainability.
You may receive a [COMPLEXITY METRICS] block above the diff with per-function CCN values from lizard.
Focus analysis on functions where CCN exceeds the threshold.
Flag functions that: have high cyclomatic complexity, could be broken into smaller focused functions,
combine multiple responsibilities.

severity: "high" for CCN > 20 or functions > 60 lines with multiple responsibilities
severity: "medium" for CCN > 10 or functions that could be reasonably simplified

Output ONLY a JSON array of findings. Empty array if complexity is acceptable.
Required format:
[{"severity":"high","basis":"VERIFIED","confidence":80,"file":"path/to/file","line":42,"title":"Short title","detail":"Why this is complex","suggestion":"How to simplify"}]`
  }

  async run(input: ReviewInput): Promise<Finding[]> {
    const threshold = this.config.complexityThreshold ?? 10
    const changedFiles = this.extractChangedFiles(input.diff)
    const metricsLines: string[] = []

    for (const file of changedFiles) {
      const filePath = input.projectPath ? `${input.projectPath}/${file}` : file
      const output = await runTool('lizard', [filePath, '--csv'])
      if (!output) continue
      for (const row of output.split('\n').slice(1)) {
        const cols = row.split(',')
        if (cols.length < 10) continue
        const ccn = parseInt(cols[1], 10)
        const methodName = (cols[7] ?? '').trim()
        const startLine = parseInt(cols[9], 10)
        if (!isNaN(ccn) && ccn >= threshold) {
          metricsLines.push(`${file}:${startLine} ${methodName} CCN=${ccn}`)
        }
      }
    }

    const augmented: ReviewInput =
      metricsLines.length > 0
        ? {
            ...input,
            diff: `[COMPLEXITY METRICS (threshold=${threshold})]\n${metricsLines.join('\n')}\n\n${input.diff}`,
          }
        : input

    return super.run(augmented)
  }

  private extractChangedFiles(diff: string): string[] {
    const files: string[] = []
    for (const line of diff.split('\n')) {
      const m = line.match(/^\+\+\+ b\/(.+)$/)
      if (m) files.push(m[1])
    }
    return files
  }
}
```

- [ ] **Step 4: Register in `src/core/runner.ts`**

Add import:

```typescript
import { ComplexityAgent } from './agents/complexity.js'
```

Add entry to builders Map:

```typescript
['complexity', () => new ComplexityAgent(provider, config)],
```

- [ ] **Step 5: Run tests**

```bash
npx vitest run tests/unit/complexityAgent.test.ts
```

Expected: 5 passed.

- [ ] **Step 6: Run full suite**

```bash
npm test
```

Expected: all tests pass (88 total).

- [ ] **Step 7: Commit**

```bash
git add tests/unit/complexityAgent.test.ts src/core/agents/complexity.ts src/core/runner.ts
git commit -m "feat: add ComplexityAgent (hybrid lizard/LLM)"
```

---

## Task 7: OrchestratorAgent — append 5 names to AGENT_PRIORITY

**Files:**

- Modify: `src/core/agents/orchestrator.ts`

Note: OrchestratorAgent is pure algorithmic — it has NO system prompt. Only the `AGENT_PRIORITY` array needs updating.

- [ ] **Step 1: Update AGENT_PRIORITY in `src/core/agents/orchestrator.ts`**

Find the current AGENT_PRIORITY array (should be at lines 7-10) and append the 5 new names:

```typescript
// Before:
const AGENT_PRIORITY: AgentName[] = [
  'integration',
  'breaking-change',
  'coverage',
  'testgen',
  'adversarial',
  'design',
  'dependencies',
  'license',
  'correctness',
  'performance',
  'security',
]

// After:
const AGENT_PRIORITY: AgentName[] = [
  'integration',
  'breaking-change',
  'coverage',
  'testgen',
  'adversarial',
  'design',
  'dependencies',
  'license',
  'correctness',
  'performance',
  'security',
  'secrets',
  'error-handling',
  'observability',
  'migration-safety',
  'complexity',
]
```

- [ ] **Step 2: Run full suite**

```bash
npm test
```

Expected: all tests pass (88 total, no change in count).

- [ ] **Step 3: Commit**

```bash
git add src/core/agents/orchestrator.ts
git commit -m "feat: register 5 new agents in orchestrator priority list"
```

---

## Task 8: Calibration fixtures and calibrate.ts

**Files:**

- Create: `calibration/fixtures/secrets.diff`
- Create: `calibration/fixtures/error-handling.diff`
- Create: `calibration/fixtures/observability.diff`
- Create: `calibration/fixtures/migration-safety.diff`
- Create: `calibration/fixtures/complexity.diff`
- Modify: `calibration/calibrate.ts`

- [ ] **Step 1: Create `calibration/fixtures/secrets.diff`**

```diff
diff --git a/src/integrations/stripe.ts b/src/integrations/stripe.ts
--- a/src/integrations/stripe.ts
+++ b/src/integrations/stripe.ts
@@ -1,3 +1,8 @@
 import Stripe from 'stripe'
-const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)
+// Temporary hardcoded key for local testing
+const STRIPE_SECRET_KEY = 'sk_live_REPLACE_WITH_REAL_KEY_DO_NOT_COMMIT'
+const stripe = new Stripe(STRIPE_SECRET_KEY)
+export const API_ENDPOINT = 'https://api.stripe.com/v1'
```

- [ ] **Step 2: Create `calibration/fixtures/error-handling.diff`**

```diff
diff --git a/src/services/userService.ts b/src/services/userService.ts
--- a/src/services/userService.ts
+++ b/src/services/userService.ts
@@ -10,6 +10,20 @@
 import { logger } from '../utils/logger'
+export async function deleteUser(userId: string): Promise<void> {
+  try {
+    await db.users.delete({ where: { id: userId } })
+    await cache.invalidate(`user:${userId}`)
+  } catch (err) {
+    // TODO: handle this later
+  }
+}
+export async function getUser(userId: string) {
+  const user = await db.users.findById(userId)
+  if (!user) { logger.warn('User not found', { userId }); return null }
+  return user
+}
```

- [ ] **Step 3: Create `calibration/fixtures/observability.diff`**

```diff
diff --git a/src/payments/processor.ts b/src/payments/processor.ts
--- a/src/payments/processor.ts
+++ b/src/payments/processor.ts
@@ -5,6 +5,16 @@
 import { stripe } from '../integrations/stripe'
+export async function processPayment(amount: number, userId: string): Promise<boolean> {
+  const result = await stripe.charge({ amount, userId })
+  if (!result.success) { return false }
+  await db.payments.create({ userId, amount, timestamp: Date.now() })
+  return true
+}
+export function validateInput(x: string): boolean {
+  return x.length > 0 && x.length < 256
+}
```

- [ ] **Step 4: Create `calibration/fixtures/migration-safety.diff`**

```diff
diff --git a/migrations/20260614_add_subscription.sql b/migrations/20260614_add_subscription.sql
new file mode 100644
--- /dev/null
+++ b/migrations/20260614_add_subscription.sql
@@ -0,0 +1,8 @@
+ALTER TABLE users ADD COLUMN subscription_tier VARCHAR(50) NOT NULL;
+ALTER TABLE users ADD COLUMN subscribed_at TIMESTAMP;
+CREATE TABLE plans (
+  id SERIAL PRIMARY KEY,
+  name VARCHAR(100) NOT NULL,
+  price_cents INT NOT NULL
+);
+CREATE INDEX idx_plans_name ON plans(name);
```

- [ ] **Step 5: Create `calibration/fixtures/complexity.diff`**

```diff
diff --git a/src/billing/invoiceProcessor.ts b/src/billing/invoiceProcessor.ts
--- a/src/billing/invoiceProcessor.ts
+++ b/src/billing/invoiceProcessor.ts
@@ -1,5 +1,52 @@
 import { db } from '../db'
+export function processInvoice(invoice: Invoice): InvoiceResult {
+  let total = 0; let discount = 0; let tax = 0
+  for (const item of invoice.lineItems) {
+    if (item.type === 'product') {
+      if (item.quantity > 100) { discount += item.price * 0.1 }
+      else if (item.quantity > 50) { discount += item.price * 0.05 }
+      total += item.price * item.quantity
+    } else if (item.type === 'service') {
+      if (item.recurring) {
+        if (invoice.customer.plan === 'enterprise') { total += item.price * 0.8 }
+        else if (invoice.customer.plan === 'pro') { total += item.price * 0.9 }
+        else { total += item.price }
+      } else { total += item.price }
+    } else if (item.type === 'credit') { total -= item.price }
+  }
+  if (invoice.customer.country === 'US') {
+    if (invoice.customer.state === 'CA') tax = total * 0.0725
+    else if (invoice.customer.state === 'NY') tax = total * 0.08
+    else tax = total * 0.05
+  } else if (invoice.customer.country === 'UK') { tax = total * 0.2
+  } else { tax = total * 0.15 }
+  return { total: total - discount + tax, discount, tax }
+}
+export function getUser(userId: string) { return db.users.findById(userId) }
```

- [ ] **Step 6: Update `calibration/calibrate.ts`**

Add 5 imports after the existing imports:

```typescript
import { SecretsAgent } from '../src/core/agents/secrets.js'
import { ErrorHandlingAgent } from '../src/core/agents/errorHandling.js'
import { ObservabilityAgent } from '../src/core/agents/observability.js'
import { MigrationSafetyAgent } from '../src/core/agents/migrationSafety.js'
import { ComplexityAgent } from '../src/core/agents/complexity.js'
```

Append 5 entries to the `CASES` array:

```typescript
{ name: 'secrets',          fixtureFile: 'calibration/fixtures/secrets.diff',          expectedKeyword: 'key',       baitKeyword: 'API_ENDPOINT' },
{ name: 'error-handling',   fixtureFile: 'calibration/fixtures/error-handling.diff',   expectedKeyword: 'swallowed', baitKeyword: 'logger' },
{ name: 'observability',    fixtureFile: 'calibration/fixtures/observability.diff',    expectedKeyword: 'log',       baitKeyword: 'validateInput' },
{ name: 'migration-safety', fixtureFile: 'calibration/fixtures/migration-safety.diff', expectedKeyword: 'default',   baitKeyword: 'CREATE INDEX' },
{ name: 'complexity',       fixtureFile: 'calibration/fixtures/complexity.diff',       expectedKeyword: 'complex',   baitKeyword: 'getUser' },
```

Add 5 entries to the `agentMap` object:

```typescript
'secrets':          new SecretsAgent(provider, DEFAULT_CONFIG),
'error-handling':   new ErrorHandlingAgent(provider, DEFAULT_CONFIG),
'observability':    new ObservabilityAgent(provider, DEFAULT_CONFIG),
'migration-safety': new MigrationSafetyAgent(provider, DEFAULT_CONFIG),
'complexity':       new ComplexityAgent(provider, DEFAULT_CONFIG),
```

- [ ] **Step 7: Verify typecheck**

```bash
npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 8: Commit**

```bash
git add calibration/fixtures/secrets.diff calibration/fixtures/error-handling.diff calibration/fixtures/observability.diff calibration/fixtures/migration-safety.diff calibration/fixtures/complexity.diff calibration/calibrate.ts
git commit -m "feat: add calibration fixtures and entries for 5 new agents"
```

---

## Task 9: Wire up DEFAULT_CONFIG + docs + version bump

**Files:**

- Modify: `src/core/config.ts` (add 5 agents to DEFAULT_CONFIG.agents)
- Modify: `package.json` (bump to 0.8.0)
- Modify: `README.md`
- Modify: `memory-bank/activeContext.md`
- Modify: `memory-bank/progress.md`

**WARNING:** Only now, after all 5 agents are registered in `buildAgents`, is it safe to add them to `DEFAULT_CONFIG.agents`. Adding earlier breaks the runner test.

- [ ] **Step 1: Add 5 agents to DEFAULT_CONFIG.agents in `src/core/config.ts`**

```typescript
// Before:
agents: [
  'security', 'performance', 'correctness', 'design', 'dependencies',
  'coverage', 'testgen', 'adversarial', 'integration', 'breaking-change', 'license'
],

// After:
agents: [
  'security', 'performance', 'correctness', 'design', 'dependencies',
  'coverage', 'testgen', 'adversarial', 'integration', 'breaking-change', 'license',
  'secrets', 'error-handling', 'observability', 'migration-safety', 'complexity'
],
```

- [ ] **Step 2: Run full suite to confirm onProgress test still passes**

The `'calls onProgress for each agent'` test (fixed in Task 4 to use a migration diff) must now report `progress.length === 16`.

```bash
npm test
```

Expected: all tests pass (88 total — count unchanged since DEFAULT_CONFIG.agents length change only affects the onProgress assertion, which uses a migration diff to include migration-safety).

- [ ] **Step 3: Bump version to 0.8.0 in `package.json`**

```json
{
  "version": "0.8.0"
}
```

- [ ] **Step 4: Update README.md**

Add a row for each new agent to the agent table. Add a new "Optional Dependencies" section:

```markdown
## Optional Dependencies

These tools enhance specific agents when installed:

| Tool         | Agent           | Install                                                                                | Purpose                                         |
| ------------ | --------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `gitleaks`   | SecretsAgent    | [github.com/gitleaks/gitleaks](https://github.com/gitleaks/gitleaks)                   | High-confidence secret scanning via rule engine |
| `trufflehog` | SecretsAgent    | [github.com/trufflesecurity/trufflehog](https://github.com/trufflesecurity/trufflehog) | Alternative secrets scanner                     |
| `lizard`     | ComplexityAgent | `pip install lizard`                                                                   | Per-function cyclomatic complexity metrics      |

Agents fall back to LLM-only analysis when tools are not installed.

## New Config Fields (v0.8.0)

| Field                     | Type                                   | Default      | Description                                      |
| ------------------------- | -------------------------------------- | ------------ | ------------------------------------------------ |
| `preferredSecretsScanner` | `'gitleaks' \| 'trufflehog' \| 'none'` | `'gitleaks'` | Scanner for SecretsAgent; `'none'` uses LLM only |
| `complexityThreshold`     | `number`                               | `10`         | Minimum CCN to flag in ComplexityAgent           |
```

- [ ] **Step 5: Update memory-bank files**

In `memory-bank/activeContext.md`, update current focus to v0.8.0 complete.

In `memory-bank/progress.md`, mark v0.8.0 complete with 16 agents and 88 unit tests.

- [ ] **Step 6: Commit**

```bash
git add src/core/config.ts package.json README.md memory-bank/activeContext.md memory-bank/progress.md
git commit -m "feat: enable 5 new agents in DEFAULT_CONFIG, bump to v0.8.0"
```

---

## Task 10: Final verification + tag

**Files:** None (verification only)

- [ ] **Step 1: Run full test suite**

```bash
npm test
```

Expected: ~88 tests passing (62 original + 25 new agent tests + 1 new runner test).

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 3: Build**

```bash
npm run build
```

Expected: clean compile, no errors.

- [ ] **Step 4: Smoke test CLI**

```bash
node dist/cli/index.js --help
```

Expected: help output lists all 16 agents.

- [ ] **Step 5: Tag and push**

```bash
git tag v0.8.0
git push
git push --tags
```

Expected: CI triggers, npm publish workflow runs.

---

## Self-Review Checklist

**Spec coverage:**

- SecretsAgent (hybrid + dedup + config) — Tasks 5, 8, 9 ✓
- ErrorHandlingAgent (pure LLM) — Tasks 2, 8, 9 ✓
- ObservabilityAgent (pure LLM) — Tasks 3, 8, 9 ✓
- MigrationSafetyAgent (conditional) — Tasks 4, 8, 9 ✓
- ComplexityAgent (hybrid + threshold) — Tasks 6, 8, 9 ✓
- shell.ts utility — Task 1 ✓
- OrchestratorAgent AGENT_PRIORITY — Task 7 ✓
- runner.test.ts onProgress fix + migration exclusion test — Task 4 ✓
- DEFAULT_CONFIG ordering constraint — documented in file map and Task 9 ✓

**Type consistency:**

- `runTool` signature: `(cmd: string, args: string[], stdinData?: string): Promise<string | null>` — consistent across shell.ts, secrets.ts, complexity.ts, tests
- `AgentName` new members: `'secrets' | 'error-handling' | 'observability' | 'migration-safety' | 'complexity'` — added in schema.ts Task 1, used in all agent `get name()` returns
- `Finding` shape with explicit `id` and `agent` fields — tool-constructed findings in secrets.ts set these manually before `mergeDedup` re-assigns IDs

**No placeholders:** All steps contain actual code, actual commands, actual expected output.
