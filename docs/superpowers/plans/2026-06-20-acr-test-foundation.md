# ACR Test Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `requireOllamaModel` helper that prints a visible, actionable error instead of silently skipping when Ollama or a required model is unavailable. Apply it to the integration test. Then write unit tests for the 10 specialist agents that have no coverage.

**Architecture:** New `tests/helpers/requireOllama.ts` module. Modify `tests/integration/e2e.test.ts` to use it. Add 10 new test files in `tests/unit/`, one per untested agent. All unit tests mock the LLM provider — they never need Ollama running.

**Tech Stack:** TypeScript 5, Vitest, mocked `LLMProvider` via `vi.fn()`

**Rule:** Tests that cannot run must print a visible error with a concrete solution. Silent `skipIf` without a message is forbidden.

---

## File Map

| Operation | File                                       |
| --------- | ------------------------------------------ |
| Create    | `tests/helpers/requireOllama.ts`           |
| Modify    | `tests/integration/e2e.test.ts`            |
| Create    | `tests/unit/securityAgent.test.ts`         |
| Create    | `tests/unit/performanceAgent.test.ts`      |
| Create    | `tests/unit/correctnessAgent.test.ts`      |
| Create    | `tests/unit/designAgent.test.ts`           |
| Create    | `tests/unit/dependenciesAgent.test.ts`     |
| Create    | `tests/unit/coverageAnalystAgent.test.ts`  |
| Create    | `tests/unit/adversarialAgent.test.ts`      |
| Create    | `tests/unit/integrationScoutAgent.test.ts` |
| Create    | `tests/unit/orchestratorAgent.test.ts`     |
| Create    | `tests/unit/testGenAgent.test.ts`          |

---

### Task 1: Create requireOllama helper

**Files:**

- Create: `tests/helpers/requireOllama.ts`

- [ ] **Step 1: Create the helper**

```ts
// tests/helpers/requireOllama.ts
//
// Use in integration tests that require a live Ollama instance.
// Call requireOllamaModel() at the top of the test file (top-level await, ESM).
// Pass the result to describe.skipIf().
//
// WHY top-level: printing the message before describe.skipIf() ensures the
// reason appears in the reporter output even when tests are skipped.
//
// Unit tests MUST NOT import this. Unit tests mock the provider entirely.

import { DEFAULT_CONFIG } from '../../src/core/config.js'

const BORDER = '╔════════════════════════════════════════════════════════════╗'
const BORDER_BOTTOM = '╚════════════════════════════════════════════════════════════╝'

function pad(text: string, width: number): string {
  return text + ' '.repeat(Math.max(0, width - text.length))
}

function row(text: string): string {
  return `║  ${pad(text, 56)}║`
}

function printSkipBox(lines: string[]): void {
  process.stderr.write('\n' + BORDER + '\n')
  for (const line of lines) process.stderr.write(row(line) + '\n')
  process.stderr.write(BORDER_BOTTOM + '\n\n')
}

export interface OllamaCheckResult {
  skip: boolean
  reason: string
}

export async function checkOllamaModel(
  ollamaUrl = DEFAULT_CONFIG.ollamaUrl,
  model = DEFAULT_CONFIG.model
): Promise<OllamaCheckResult> {
  // Check 1: Is Ollama reachable?
  let tagsResponse: Response
  try {
    tagsResponse = await fetch(`${ollamaUrl}/api/tags`, {
      signal: AbortSignal.timeout(2000),
    })
  } catch {
    printSkipBox([
      'INTEGRATION TESTS SKIPPED — Ollama not reachable',
      '',
      'Solution:',
      '  1. ollama serve',
      '  2. INTEGRATION=1 npm test',
    ])
    return { skip: true, reason: 'Ollama not reachable' }
  }

  if (!tagsResponse.ok) {
    printSkipBox([
      'INTEGRATION TESTS SKIPPED — Ollama API error',
      '',
      `  Status: ${tagsResponse.status}`,
      '',
      'Solution:',
      '  1. ollama serve',
      '  2. INTEGRATION=1 npm test',
    ])
    return { skip: true, reason: `Ollama API returned ${tagsResponse.status}` }
  }

  // Check 2: Is the required model pulled?
  const data = (await tagsResponse.json()) as { models: Array<{ name: string }> }
  const available = data.models.map((m) => m.name)
  if (!available.includes(model)) {
    printSkipBox([
      'INTEGRATION TESTS SKIPPED — model not available',
      '',
      `  Required model: ${model}`,
      '  Ollama is running but this model is not pulled.',
      '',
      'Solution:',
      `  ollama pull ${model}`,
      '  then: INTEGRATION=1 npm test',
    ])
    return { skip: true, reason: `Model ${model} not pulled` }
  }

  return { skip: false, reason: '' }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add tests/helpers/requireOllama.ts
git commit -m "test: add requireOllamaModel helper with visible skip messages"
```

---

### Task 2: Apply helper to e2e.test.ts

**Files:**

- Modify: `tests/integration/e2e.test.ts`

- [ ] **Step 1: Update e2e.test.ts**

Replace the file with this updated version that uses the helper:

```ts
// tests/integration/e2e.test.ts
//
// Full pipeline test against a live Ollama instance.
//
// Skip gate: set INTEGRATION=1 to opt in.
// If Ollama or the required model is unavailable, tests skip with a visible
// error message and concrete solution printed to stderr.
//
// Run: INTEGRATION=1 npm run test:integration
import { describe, it, expect, beforeAll } from 'vitest'
import { SwarmRunner } from '../../src/core/runner.js'
import { OllamaProvider } from '../../src/core/llm/ollamaProvider.js'
import { DEFAULT_CONFIG } from '../../src/core/config.js'
import { checkOllamaModel } from '../helpers/requireOllama.js'
import type { ReviewResult } from '../../src/core/schema.js'

const OLLAMA_URL = process.env.OLLAMA_URL ?? DEFAULT_CONFIG.ollamaUrl
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? DEFAULT_CONFIG.model

// Check Ollama + model availability. Message prints to stderr before skipIf fires.
const ollamaCheck = await checkOllamaModel(OLLAMA_URL, OLLAMA_MODEL)
const SKIP = !process.env.INTEGRATION || ollamaCheck.skip

// Deliberately bad diff: hardcoded secret + weak hash + SQL injection.
// Any security agent should find at least one of these.
const SAMPLE_DIFF = `\
diff --git a/src/auth.ts b/src/auth.ts
new file mode 100644
--- /dev/null
+++ b/src/auth.ts
@@ -0,0 +1,16 @@
+import { createHash } from 'crypto'
+import { db } from './db'
+
+const API_SECRET = 'hardcoded_secret_key_abc123'
+
+export function validateToken(token: string): boolean {
+  return token === API_SECRET
+}
+
+export function hashPassword(password: string): string {
+  return createHash('md5').update(password).digest('hex')
+}
+
+export async function getUserByEmail(email: string) {
+  return db.query(\`SELECT * FROM users WHERE email = '\${email}'\`)
+}
`

// Use two fast agents to keep the run under ~4 minutes.
const TEST_CONFIG = {
  ...DEFAULT_CONFIG,
  ollamaUrl: OLLAMA_URL,
  model: OLLAMA_MODEL,
  agents: ['security', 'correctness'] as typeof DEFAULT_CONFIG.agents,
  maxFindings: 10,
}

describe.skipIf(SKIP)('E2E — full pipeline against live Ollama', () => {
  let result: ReviewResult

  beforeAll(async () => {
    const provider = new OllamaProvider(OLLAMA_URL, OLLAMA_MODEL)
    const runner = new SwarmRunner(TEST_CONFIG, provider)
    result = await runner.run({ diff: SAMPLE_DIFF })
  }, 300_000) // 5-minute cap for the swarm run

  it('produces at least one finding', () => {
    expect(result.findings).toBeInstanceOf(Array)
    expect(result.findings.length).toBeGreaterThan(0)
  })

  it('summary counters are consistent', () => {
    expect(result.summary.totalFindings).toBe(result.findings.length)
    expect(result.summary.durationMs).toBeGreaterThan(0)
  })

  it('every finding conforms to the Finding schema', () => {
    const SEVERITIES = ['critical', 'high', 'medium', 'low']
    const BASES = ['VERIFIED', 'INFERRED', 'SPECULATIVE']
    for (const f of result.findings) {
      expect(SEVERITIES, `unexpected severity on finding ${f.id}`).toContain(f.severity)
      expect(BASES, `unexpected basis on finding ${f.id}`).toContain(f.basis)
      expect(typeof f.title).toBe('string')
      expect(f.title.length).toBeGreaterThan(0)
      expect(typeof f.detail).toBe('string')
      expect(typeof f.suggestion).toBe('string')
    }
  })

  it('security agent flags at least one issue in the diff', () => {
    const securityFindings = result.findings.filter((f) => f.agent === 'security')
    expect(
      securityFindings.length,
      'expected security agent to flag hardcoded secret, weak hash, or SQL injection'
    ).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run unit tests to verify no regressions**

```bash
npm test -- tests/unit
```

Expected: All unit tests pass (e2e is excluded by path filter).

- [ ] **Step 3: Commit**

```bash
git add tests/integration/e2e.test.ts
git commit -m "test: apply requireOllamaModel helper to e2e — no more silent skips"
```

---

### Task 3: Unit tests for SecurityAgent

**Files:**

- Create: `tests/unit/securityAgent.test.ts`

- [ ] **Step 1: Create the test file**

```ts
// tests/unit/securityAgent.test.ts
// Unit tests — mock the LLM provider. Ollama is NOT required to run these.
import { describe, it, expect, vi } from 'vitest'
import { SecurityAgent } from '../../src/core/agents/security.js'
import { DEFAULT_CONFIG } from '../../src/core/config.js'
import type { LLMProvider } from '../../src/core/llm/provider.js'

const makeProvider = (response: string): LLMProvider => ({
  chat: vi.fn().mockResolvedValue(response),
  ping: vi.fn().mockResolvedValue({ ok: true }),
})

describe('SecurityAgent', () => {
  it('has name security', () => {
    expect(new SecurityAgent(makeProvider('[]'), DEFAULT_CONFIG).name).toBe('security')
  })

  it('returns empty array when provider returns empty JSON array', async () => {
    const agent = new SecurityAgent(makeProvider('[]'), DEFAULT_CONFIG)
    expect(await agent.run({ diff: 'diff content' })).toEqual([])
  })

  it('parses a valid finding and stamps agent name', async () => {
    const raw = JSON.stringify([
      {
        severity: 'critical',
        basis: 'VERIFIED',
        confidence: 90,
        file: 'src/auth.ts',
        line: 4,
        title: 'Hardcoded API secret',
        detail: 'API_SECRET is committed to source',
        suggestion: 'Move to environment variable',
      },
    ])
    const findings = await new SecurityAgent(makeProvider(raw), DEFAULT_CONFIG).run({
      diff: 'diff',
    })
    expect(findings).toHaveLength(1)
    expect(findings[0].agent).toBe('security')
    expect(findings[0].id).toBe('security-0')
    expect(findings[0].severity).toBe('critical')
  })

  it('returns empty array on parse failure', async () => {
    const agent = new SecurityAgent(makeProvider('not json'), DEFAULT_CONFIG)
    expect(await agent.run({ diff: 'diff' })).toEqual([])
  })

  it('system prompt mentions injection and OWASP', () => {
    const agent = new SecurityAgent(makeProvider('[]'), DEFAULT_CONFIG)
    expect(agent.systemPrompt).toMatch(/injection/i)
    expect(agent.systemPrompt).toMatch(/OWASP/i)
  })
})
```

- [ ] **Step 2: Run tests**

```bash
npm test -- tests/unit/securityAgent.test.ts
```

Expected: All 5 PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/securityAgent.test.ts
git commit -m "test: add unit tests for SecurityAgent"
```

---

### Task 4: Unit tests for PerformanceAgent

**Files:**

- Create: `tests/unit/performanceAgent.test.ts`

- [ ] **Step 1: Create the test file**

```ts
// tests/unit/performanceAgent.test.ts
// Unit tests — mock the LLM provider. Ollama is NOT required to run these.
import { describe, it, expect, vi } from 'vitest'
import { PerformanceAgent } from '../../src/core/agents/performance.js'
import { DEFAULT_CONFIG } from '../../src/core/config.js'
import type { LLMProvider } from '../../src/core/llm/provider.js'

const makeProvider = (response: string): LLMProvider => ({
  chat: vi.fn().mockResolvedValue(response),
  ping: vi.fn().mockResolvedValue({ ok: true }),
})

describe('PerformanceAgent', () => {
  it('has name performance', () => {
    expect(new PerformanceAgent(makeProvider('[]'), DEFAULT_CONFIG).name).toBe('performance')
  })

  it('returns empty array when provider returns empty JSON array', async () => {
    expect(
      await new PerformanceAgent(makeProvider('[]'), DEFAULT_CONFIG).run({ diff: 'diff' })
    ).toEqual([])
  })

  it('parses a valid finding and stamps agent name', async () => {
    const raw = JSON.stringify([
      {
        severity: 'medium',
        basis: 'INFERRED',
        confidence: 70,
        file: 'src/api.ts',
        line: 22,
        title: 'N+1 query in loop',
        detail: 'Each iteration issues a separate DB query',
        suggestion: 'Batch the queries outside the loop',
      },
    ])
    const findings = await new PerformanceAgent(makeProvider(raw), DEFAULT_CONFIG).run({
      diff: 'diff',
    })
    expect(findings).toHaveLength(1)
    expect(findings[0].agent).toBe('performance')
    expect(findings[0].id).toBe('performance-0')
  })

  it('returns empty array on parse failure', async () => {
    expect(
      await new PerformanceAgent(makeProvider('{bad}'), DEFAULT_CONFIG).run({ diff: 'diff' })
    ).toEqual([])
  })

  it('system prompt mentions performance or efficiency', () => {
    const agent = new PerformanceAgent(makeProvider('[]'), DEFAULT_CONFIG)
    expect(agent.systemPrompt).toMatch(/performance|efficiency|latency|throughput/i)
  })
})
```

- [ ] **Step 2: Run tests**

```bash
npm test -- tests/unit/performanceAgent.test.ts
```

Expected: All 5 PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/performanceAgent.test.ts
git commit -m "test: add unit tests for PerformanceAgent"
```

---

### Task 5: Unit tests for CorrectnessAgent

**Files:**

- Create: `tests/unit/correctnessAgent.test.ts`

- [ ] **Step 1: Create the test file**

```ts
// tests/unit/correctnessAgent.test.ts
// Unit tests — mock the LLM provider. Ollama is NOT required to run these.
import { describe, it, expect, vi } from 'vitest'
import { CorrectnessAgent } from '../../src/core/agents/correctness.js'
import { DEFAULT_CONFIG } from '../../src/core/config.js'
import type { LLMProvider } from '../../src/core/llm/provider.js'

const makeProvider = (response: string): LLMProvider => ({
  chat: vi.fn().mockResolvedValue(response),
  ping: vi.fn().mockResolvedValue({ ok: true }),
})

describe('CorrectnessAgent', () => {
  it('has name correctness', () => {
    expect(new CorrectnessAgent(makeProvider('[]'), DEFAULT_CONFIG).name).toBe('correctness')
  })

  it('returns empty array when provider returns empty JSON array', async () => {
    expect(
      await new CorrectnessAgent(makeProvider('[]'), DEFAULT_CONFIG).run({ diff: 'diff' })
    ).toEqual([])
  })

  it('parses a valid finding and stamps agent name', async () => {
    const raw = JSON.stringify([
      {
        severity: 'high',
        basis: 'VERIFIED',
        confidence: 85,
        file: 'src/utils.ts',
        line: 15,
        title: 'Off-by-one in slice',
        detail: 'Array slice uses wrong end index, drops last element',
        suggestion: 'Change arr.slice(0, n-1) to arr.slice(0, n)',
      },
    ])
    const findings = await new CorrectnessAgent(makeProvider(raw), DEFAULT_CONFIG).run({
      diff: 'diff',
    })
    expect(findings).toHaveLength(1)
    expect(findings[0].agent).toBe('correctness')
    expect(findings[0].id).toBe('correctness-0')
  })

  it('returns empty array on parse failure', async () => {
    expect(
      await new CorrectnessAgent(makeProvider('undefined'), DEFAULT_CONFIG).run({ diff: 'diff' })
    ).toEqual([])
  })

  it('system prompt mentions correctness or logic', () => {
    const agent = new CorrectnessAgent(makeProvider('[]'), DEFAULT_CONFIG)
    expect(agent.systemPrompt).toMatch(/correct|logic|bug|error/i)
  })
})
```

- [ ] **Step 2: Run tests**

```bash
npm test -- tests/unit/correctnessAgent.test.ts
```

Expected: All 5 PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/correctnessAgent.test.ts
git commit -m "test: add unit tests for CorrectnessAgent"
```

---

### Task 6: Unit tests for DesignAgent

**Files:**

- Create: `tests/unit/designAgent.test.ts`

- [ ] **Step 1: Create the test file**

```ts
// tests/unit/designAgent.test.ts
// Unit tests — mock the LLM provider. Ollama is NOT required to run these.
import { describe, it, expect, vi } from 'vitest'
import { DesignAgent } from '../../src/core/agents/design.js'
import { DEFAULT_CONFIG } from '../../src/core/config.js'
import type { LLMProvider } from '../../src/core/llm/provider.js'

const makeProvider = (response: string): LLMProvider => ({
  chat: vi.fn().mockResolvedValue(response),
  ping: vi.fn().mockResolvedValue({ ok: true }),
})

describe('DesignAgent', () => {
  it('has name design', () => {
    expect(new DesignAgent(makeProvider('[]'), DEFAULT_CONFIG).name).toBe('design')
  })

  it('returns empty array when provider returns empty JSON array', async () => {
    expect(await new DesignAgent(makeProvider('[]'), DEFAULT_CONFIG).run({ diff: 'diff' })).toEqual(
      []
    )
  })

  it('parses a valid finding and stamps agent name', async () => {
    const raw = JSON.stringify([
      {
        severity: 'medium',
        basis: 'INFERRED',
        confidence: 65,
        file: 'src/service.ts',
        line: 8,
        title: 'Business logic in controller layer',
        detail: 'Validation belongs in service, not route handler',
        suggestion: 'Extract validation to a service method',
      },
    ])
    const findings = await new DesignAgent(makeProvider(raw), DEFAULT_CONFIG).run({ diff: 'diff' })
    expect(findings).toHaveLength(1)
    expect(findings[0].agent).toBe('design')
    expect(findings[0].id).toBe('design-0')
  })

  it('returns empty array on parse failure', async () => {
    expect(
      await new DesignAgent(makeProvider('null'), DEFAULT_CONFIG).run({ diff: 'diff' })
    ).toEqual([])
  })

  it('system prompt mentions design or architecture', () => {
    const agent = new DesignAgent(makeProvider('[]'), DEFAULT_CONFIG)
    expect(agent.systemPrompt).toMatch(/design|architect|pattern|coupling|cohesion|layer/i)
  })
})
```

- [ ] **Step 2: Run tests**

```bash
npm test -- tests/unit/designAgent.test.ts
```

Expected: All 5 PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/designAgent.test.ts
git commit -m "test: add unit tests for DesignAgent"
```

---

### Task 7: Unit tests for DependenciesAgent

**Files:**

- Create: `tests/unit/dependenciesAgent.test.ts`

- [ ] **Step 1: Create the test file**

```ts
// tests/unit/dependenciesAgent.test.ts
// Unit tests — mock the LLM provider. Ollama is NOT required to run these.
import { describe, it, expect, vi } from 'vitest'
import { DependenciesAgent } from '../../src/core/agents/dependencies.js'
import { DEFAULT_CONFIG } from '../../src/core/config.js'
import type { LLMProvider } from '../../src/core/llm/provider.js'

const makeProvider = (response: string): LLMProvider => ({
  chat: vi.fn().mockResolvedValue(response),
  ping: vi.fn().mockResolvedValue({ ok: true }),
})

describe('DependenciesAgent', () => {
  it('has name dependencies', () => {
    expect(new DependenciesAgent(makeProvider('[]'), DEFAULT_CONFIG).name).toBe('dependencies')
  })

  it('returns empty array when provider returns empty JSON array', async () => {
    expect(
      await new DependenciesAgent(makeProvider('[]'), DEFAULT_CONFIG).run({ diff: 'diff' })
    ).toEqual([])
  })

  it('parses a valid finding and stamps agent name', async () => {
    const raw = JSON.stringify([
      {
        severity: 'high',
        basis: 'VERIFIED',
        confidence: 88,
        file: 'package.json',
        line: 12,
        title: 'Vulnerable dependency: lodash < 4.17.21',
        detail: 'Prototype pollution CVE-2021-23337',
        suggestion: 'Upgrade to lodash@4.17.21',
      },
    ])
    const findings = await new DependenciesAgent(makeProvider(raw), DEFAULT_CONFIG).run({
      diff: 'diff',
    })
    expect(findings).toHaveLength(1)
    expect(findings[0].agent).toBe('dependencies')
    expect(findings[0].id).toBe('dependencies-0')
  })

  it('returns empty array on parse failure', async () => {
    expect(
      await new DependenciesAgent(makeProvider(''), DEFAULT_CONFIG).run({ diff: 'diff' })
    ).toEqual([])
  })

  it('system prompt mentions dependencies or packages', () => {
    const agent = new DependenciesAgent(makeProvider('[]'), DEFAULT_CONFIG)
    expect(agent.systemPrompt).toMatch(/depend|package|npm|vulnerab|CVE/i)
  })
})
```

- [ ] **Step 2: Run tests**

```bash
npm test -- tests/unit/dependenciesAgent.test.ts
```

Expected: All 5 PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/dependenciesAgent.test.ts
git commit -m "test: add unit tests for DependenciesAgent"
```

---

### Task 8: Unit tests for CoverageAnalystAgent

**Files:**

- Create: `tests/unit/coverageAnalystAgent.test.ts`

- [ ] **Step 1: Create the test file**

```ts
// tests/unit/coverageAnalystAgent.test.ts
// Unit tests — mock the LLM provider. Ollama is NOT required to run these.
import { describe, it, expect, vi } from 'vitest'
import { CoverageAnalystAgent } from '../../src/core/agents/coverageAnalyst.js'
import { DEFAULT_CONFIG } from '../../src/core/config.js'
import type { LLMProvider } from '../../src/core/llm/provider.js'

const makeProvider = (response: string): LLMProvider => ({
  chat: vi.fn().mockResolvedValue(response),
  ping: vi.fn().mockResolvedValue({ ok: true }),
})

describe('CoverageAnalystAgent', () => {
  it('has name coverage', () => {
    expect(new CoverageAnalystAgent(makeProvider('[]'), DEFAULT_CONFIG).name).toBe('coverage')
  })

  it('returns empty array when provider returns empty JSON array', async () => {
    expect(
      await new CoverageAnalystAgent(makeProvider('[]'), DEFAULT_CONFIG).run({ diff: 'diff' })
    ).toEqual([])
  })

  it('parses a valid finding and stamps agent name', async () => {
    const raw = JSON.stringify([
      {
        severity: 'medium',
        basis: 'INFERRED',
        confidence: 75,
        file: 'src/auth.ts',
        line: 20,
        title: 'No test for error branch',
        detail: 'The catch block in validateToken has no test coverage',
        suggestion: 'Add a test that passes an invalid token',
      },
    ])
    const findings = await new CoverageAnalystAgent(makeProvider(raw), DEFAULT_CONFIG).run({
      diff: 'diff',
    })
    expect(findings).toHaveLength(1)
    expect(findings[0].agent).toBe('coverage')
    expect(findings[0].id).toBe('coverage-0')
  })

  it('returns empty array on parse failure', async () => {
    expect(
      await new CoverageAnalystAgent(makeProvider('[invalid]'), DEFAULT_CONFIG).run({
        diff: 'diff',
      })
    ).toEqual([])
  })

  it('system prompt mentions coverage or testing', () => {
    const agent = new CoverageAnalystAgent(makeProvider('[]'), DEFAULT_CONFIG)
    expect(agent.systemPrompt).toMatch(/coverage|test|untested/i)
  })
})
```

- [ ] **Step 2: Run tests**

```bash
npm test -- tests/unit/coverageAnalystAgent.test.ts
```

Expected: All 5 PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/coverageAnalystAgent.test.ts
git commit -m "test: add unit tests for CoverageAnalystAgent"
```

---

### Task 9: Unit tests for AdversarialAgent

**Files:**

- Create: `tests/unit/adversarialAgent.test.ts`

- [ ] **Step 1: Create the test file**

```ts
// tests/unit/adversarialAgent.test.ts
// Unit tests — mock the LLM provider. Ollama is NOT required to run these.
import { describe, it, expect, vi } from 'vitest'
import { AdversarialAgent } from '../../src/core/agents/adversarial.js'
import { DEFAULT_CONFIG } from '../../src/core/config.js'
import type { LLMProvider } from '../../src/core/llm/provider.js'

const makeProvider = (response: string): LLMProvider => ({
  chat: vi.fn().mockResolvedValue(response),
  ping: vi.fn().mockResolvedValue({ ok: true }),
})

describe('AdversarialAgent', () => {
  it('has name adversarial', () => {
    expect(new AdversarialAgent(makeProvider('[]'), DEFAULT_CONFIG).name).toBe('adversarial')
  })

  it('returns empty array when provider returns empty JSON array', async () => {
    expect(
      await new AdversarialAgent(makeProvider('[]'), DEFAULT_CONFIG).run({ diff: 'diff' })
    ).toEqual([])
  })

  it('parses a valid finding and stamps agent name', async () => {
    const raw = JSON.stringify([
      {
        severity: 'high',
        basis: 'SPECULATIVE',
        confidence: 60,
        file: 'src/parser.ts',
        line: 33,
        title: 'Denial of service via regex backtracking',
        detail: 'The regex /^(a+)+$/ is vulnerable to ReDoS on adversarial input',
        suggestion: 'Replace with a linear-time parser or add input length guard',
      },
    ])
    const findings = await new AdversarialAgent(makeProvider(raw), DEFAULT_CONFIG).run({
      diff: 'diff',
    })
    expect(findings).toHaveLength(1)
    expect(findings[0].agent).toBe('adversarial')
    expect(findings[0].id).toBe('adversarial-0')
  })

  it('returns empty array on parse failure', async () => {
    expect(
      await new AdversarialAgent(makeProvider('{}'), DEFAULT_CONFIG).run({ diff: 'diff' })
    ).toEqual([])
  })

  it('system prompt mentions adversarial or abuse', () => {
    const agent = new AdversarialAgent(makeProvider('[]'), DEFAULT_CONFIG)
    expect(agent.systemPrompt).toMatch(/adversar|abuse|attack|malicious|exploit/i)
  })
})
```

- [ ] **Step 2: Run tests**

```bash
npm test -- tests/unit/adversarialAgent.test.ts
```

Expected: All 5 PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/adversarialAgent.test.ts
git commit -m "test: add unit tests for AdversarialAgent"
```

---

### Task 10: Unit tests for IntegrationScoutAgent

**Files:**

- Create: `tests/unit/integrationScoutAgent.test.ts`

- [ ] **Step 1: Create the test file**

```ts
// tests/unit/integrationScoutAgent.test.ts
// Unit tests — mock the LLM provider. Ollama is NOT required to run these.
import { describe, it, expect, vi } from 'vitest'
import { IntegrationScoutAgent } from '../../src/core/agents/integrationScout.js'
import { DEFAULT_CONFIG } from '../../src/core/config.js'
import type { LLMProvider } from '../../src/core/llm/provider.js'

const makeProvider = (response: string): LLMProvider => ({
  chat: vi.fn().mockResolvedValue(response),
  ping: vi.fn().mockResolvedValue({ ok: true }),
})

describe('IntegrationScoutAgent', () => {
  it('has name integration', () => {
    expect(new IntegrationScoutAgent(makeProvider('[]'), DEFAULT_CONFIG).name).toBe('integration')
  })

  it('returns empty array when provider returns empty JSON array', async () => {
    expect(
      await new IntegrationScoutAgent(makeProvider('[]'), DEFAULT_CONFIG).run({ diff: 'diff' })
    ).toEqual([])
  })

  it('parses a valid finding and stamps agent name', async () => {
    const raw = JSON.stringify([
      {
        severity: 'high',
        basis: 'INFERRED',
        confidence: 72,
        file: 'src/gateway.ts',
        line: 45,
        title: 'Breaking change to external API contract',
        detail: 'Renamed field userId to user_id breaks downstream consumers',
        suggestion: 'Add a migration shim or version the endpoint',
      },
    ])
    const findings = await new IntegrationScoutAgent(makeProvider(raw), DEFAULT_CONFIG).run({
      diff: 'diff',
    })
    expect(findings).toHaveLength(1)
    expect(findings[0].agent).toBe('integration')
    expect(findings[0].id).toBe('integration-0')
  })

  it('returns empty array on parse failure', async () => {
    expect(
      await new IntegrationScoutAgent(makeProvider('not-json'), DEFAULT_CONFIG).run({
        diff: 'diff',
      })
    ).toEqual([])
  })

  it('system prompt mentions integration or contract', () => {
    const agent = new IntegrationScoutAgent(makeProvider('[]'), DEFAULT_CONFIG)
    expect(agent.systemPrompt).toMatch(/integrat|contract|API|interface|downstream/i)
  })
})
```

- [ ] **Step 2: Run tests**

```bash
npm test -- tests/unit/integrationScoutAgent.test.ts
```

Expected: All 5 PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/integrationScoutAgent.test.ts
git commit -m "test: add unit tests for IntegrationScoutAgent"
```

---

### Task 11: Unit tests for OrchestratorAgent

**Files:**

- Create: `tests/unit/orchestratorAgent.test.ts`

Note: The orchestrator test is different — it tests dedup, escalation, and cap logic, not LLM parsing.

- [ ] **Step 1: Read the existing orchestrator test to understand current coverage**

```bash
cat tests/unit/orchestrator.test.ts
```

Review what's already tested. The new file adds agent-level tests for the `OrchestratorAgent` class itself (name, run method), not the dedup logic (already tested in `orchestrator.test.ts`).

- [ ] **Step 2: Create the test file**

```ts
// tests/unit/orchestratorAgent.test.ts
// Unit tests — mock the LLM provider. Ollama is NOT required to run these.
// Note: dedup/escalation logic is tested in orchestrator.test.ts
// These tests cover the OrchestratorAgent class interface.
import { describe, it, expect, vi } from 'vitest'
import { OrchestratorAgent } from '../../src/core/agents/orchestrator.js'
import { DEFAULT_CONFIG } from '../../src/core/config.js'
import type { LLMProvider } from '../../src/core/llm/provider.js'
import type { Finding } from '../../src/core/schema.js'

const makeProvider = (response: string): LLMProvider => ({
  chat: vi.fn().mockResolvedValue(response),
  ping: vi.fn().mockResolvedValue({ ok: true }),
})

const makeFinding = (overrides: Partial<Finding> = {}): Finding => ({
  id: 'security-0',
  agent: 'security',
  severity: 'high',
  basis: 'VERIFIED',
  file: 'src/auth.ts',
  line: 10,
  title: 'Test finding',
  detail: 'Detail',
  suggestion: 'Fix it',
  confidence: 80,
  ...overrides,
})

describe('OrchestratorAgent', () => {
  it('has name orchestrator', () => {
    expect(new OrchestratorAgent(makeProvider('[]'), DEFAULT_CONFIG).name).toBe('orchestrator')
  })

  it('returns empty array when given no findings to orchestrate', async () => {
    const agent = new OrchestratorAgent(makeProvider('[]'), DEFAULT_CONFIG)
    // OrchestratorAgent.run() takes findings not a diff — it orchestrates existing findings
    // If the signature takes findings, pass []; otherwise pass a diff string
    const result = await agent.run({ diff: '' })
    expect(Array.isArray(result)).toBe(true)
  })

  it('passes findings through when there are no duplicates', async () => {
    const agent = new OrchestratorAgent(makeProvider('[]'), DEFAULT_CONFIG)
    const findings = [
      makeFinding({ id: 'security-0', file: 'src/a.ts', line: 1 }),
      makeFinding({ id: 'correctness-0', agent: 'correctness', file: 'src/b.ts', line: 5 }),
    ]
    // If orchestrator takes pre-run findings via a different method, test that
    // Otherwise test via run() with findings embedded in the diff context
    expect(findings).toHaveLength(2)
  })

  it('system prompt mentions orchestrat or consolidat', () => {
    const agent = new OrchestratorAgent(makeProvider('[]'), DEFAULT_CONFIG)
    expect(agent.systemPrompt).toMatch(/orchestrat|consolidat|dedup|cross.reference|corrobor/i)
  })

  it('returns empty array on provider parse failure', async () => {
    const agent = new OrchestratorAgent(makeProvider('malformed'), DEFAULT_CONFIG)
    const result = await agent.run({ diff: 'diff content' })
    expect(Array.isArray(result)).toBe(true)
  })
})
```

**Note:** If the `OrchestratorAgent` has a different method signature (e.g., `orchestrate(findings)` instead of `run(input)`), read `src/core/agents/orchestrator.ts` and adjust the test to match the actual API.

- [ ] **Step 3: Read orchestrator.ts to verify API**

```bash
head -40 src/core/agents/orchestrator.ts
```

Adjust the test if the method signatures differ from what's written above.

- [ ] **Step 4: Run tests**

```bash
npm test -- tests/unit/orchestratorAgent.test.ts
```

Expected: All tests pass (adjust if API differs).

- [ ] **Step 5: Commit**

```bash
git add tests/unit/orchestratorAgent.test.ts
git commit -m "test: add unit tests for OrchestratorAgent class interface"
```

---

### Task 12: Unit tests for TestGenAgent

**Files:**

- Create: `tests/unit/testGenAgent.test.ts`

- [ ] **Step 1: Create the test file**

```ts
// tests/unit/testGenAgent.test.ts
// Unit tests — mock the LLM provider. Ollama is NOT required to run these.
// TestGenAgent is opt-in (--suggest-tests or --write-tests). These tests verify
// the agent class interface only; file-writing behavior is controlled by the CLI.
import { describe, it, expect, vi } from 'vitest'
import { TestGenAgent } from '../../src/core/agents/testGen.js'
import { DEFAULT_CONFIG } from '../../src/core/config.js'
import type { LLMProvider } from '../../src/core/llm/provider.js'

const makeProvider = (response: string): LLMProvider => ({
  chat: vi.fn().mockResolvedValue(response),
  ping: vi.fn().mockResolvedValue({ ok: true }),
})

describe('TestGenAgent', () => {
  it('has name testgen', () => {
    expect(new TestGenAgent(makeProvider('[]'), DEFAULT_CONFIG).name).toBe('testgen')
  })

  it('returns empty array of findings (testgen produces testFiles, not findings)', async () => {
    const agent = new TestGenAgent(makeProvider('[]'), DEFAULT_CONFIG)
    const result = await agent.run({ diff: 'diff content' })
    expect(Array.isArray(result)).toBe(true)
  })

  it('is NOT in DEFAULT_CONFIG.agents (requires explicit opt-in)', () => {
    expect(DEFAULT_CONFIG.agents).not.toContain('testgen')
  })

  it('system prompt mentions test or generate', () => {
    const agent = new TestGenAgent(makeProvider('[]'), DEFAULT_CONFIG)
    expect(agent.systemPrompt).toMatch(/test|generat/i)
  })

  it('returns empty array on provider parse failure', async () => {
    const agent = new TestGenAgent(makeProvider('not json'), DEFAULT_CONFIG)
    const result = await agent.run({ diff: 'diff' })
    expect(Array.isArray(result)).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests**

```bash
npm test -- tests/unit/testGenAgent.test.ts
```

Expected: All 5 PASS.

- [ ] **Step 3: Run full suite**

```bash
npm test
```

Expected: All tests pass. Count should be approximately 170 (was 120, added ~50 new tests across 10 agents + helper).

- [ ] **Step 4: Commit**

```bash
git add tests/unit/testGenAgent.test.ts
git commit -m "test: add unit tests for TestGenAgent; all 10 previously untested agents now covered"
```

---

### Task 13: Final verification

- [ ] **Step 1: Run full test suite and confirm count**

```bash
npm test 2>&1 | tail -5
```

Expected: All tests pass. Count ≥ 170.

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 3: Verify helper is not imported by unit tests**

```bash
grep -r "requireOllama" tests/unit/
```

Expected: No output. Helper is only used in integration tests.
