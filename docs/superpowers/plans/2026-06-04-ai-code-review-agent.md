# AI Code Review Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a 10-agent local code review and test-generation tool running on Ollama (devstral:latest) with CLI, GitHub Actions, and Claude Code slash command surfaces.

**Architecture:** Sequential agent swarm — 9 specialists analyze a git diff independently, an orchestrator deduplicates and cross-references findings, TestGen produces test stubs for coverage gaps. Single TypeScript core library consumed by three thin adapters.

**Tech Stack:** Node v24, TypeScript (strict), Vitest, Commander.js, Ollama REST API (devstral:latest)

---

## File Map

```
src/
  core/
    schema.ts              # All shared types (Finding, ReviewInput, CoverageGap, etc.)
    config.ts              # ReviewConfig interface + loadConfig() + defaults
    llm/
      provider.ts          # LLMProvider interface + Message/ChatOptions types
      ollamaProvider.ts    # OllamaProvider (adapted from Google-Organizer ollamaClient.ts)
      anthropicProvider.ts # AnthropicProvider (optional)
    agents/
      base.ts              # BaseAgent abstract class (prompt build + JSON parse)
      security.ts          # SecurityAgent
      performance.ts       # PerformanceAgent
      correctness.ts       # CorrectnessAgent
      design.ts            # DesignAgent
      dependencies.ts      # DependenciesAgent
      coverageAnalyst.ts   # CoverageAnalystAgent (returns findings + CoverageGap[])
      testGen.ts           # TestGenAgent (produces GeneratedTestFile[], not findings)
      adversarial.ts       # AdversarialAgent
      integrationScout.ts  # IntegrationScoutAgent
      orchestrator.ts      # OrchestratorAgent (dedup + cross-ref + cap)
    runner.ts              # SwarmRunner — sequential orchestration
  cli/
    index.ts               # Commander CLI entry point
    formatter.ts           # markdown + json output formatters
  adapters/
    github.ts              # GitHub PR comment upsert
    claudeCode.ts          # Claude Code output formatter
tests/
  unit/
    ollamaProvider.test.ts
    baseAgent.test.ts
    orchestrator.test.ts
    runner.test.ts
    config.test.ts
  integration/
    e2e.test.ts
calibration/
  fixtures/
    security.diff          # diff with 1 real vuln + 1 false-positive bait
    performance.diff
    correctness.diff
    design.diff
    dependencies.diff
    coverage.diff
    testgen.diff
    adversarial.diff
    integration.diff
  calibrate.ts             # Calibration runner script
.claude/
  commands/
    ai-review.md           # /ai-review slash command
.github/
  workflows/
    review.yml
ai-review.config.json
package.json
tsconfig.json
vitest.config.ts
```

---

## Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `ai-review.config.json`

- [ ] **Step 1: Initialize git repo**

```bash
cd "C:\Users\Mizzo\Claude\AI-Code-Review-Agent"
git init
```

- [ ] **Step 2: Create package.json**

```json
{
  "name": "ai-review",
  "version": "0.1.0",
  "description": "AI-powered code review and deep testing agent using local LLMs",
  "type": "module",
  "bin": {
    "ai-review": "./dist/cli/index.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/cli/index.ts",
    "test": "vitest run tests/unit",
    "test:watch": "vitest tests/unit",
    "test:integration": "vitest run tests/integration",
    "test:coverage": "vitest run --coverage tests/unit",
    "calibrate": "tsx calibration/calibrate.ts",
    "typecheck": "tsc --noEmit",
    "lint": "tsc --noEmit"
  },
  "dependencies": {
    "commander": "^12.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@vitest/coverage-v8": "^2.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  },
  "optionalDependencies": {
    "@anthropic-ai/sdk": "^0.30.0"
  }
}
```

- [ ] **Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests", "calibration"]
}
```

- [ ] **Step 4: Create vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json'],
      include: ['src/**/*.ts'],
      exclude: ['src/cli/**', 'src/adapters/**']
    }
  }
})
```

- [ ] **Step 5: Create default ai-review.config.json**

```json
{
  "model": "devstral:latest",
  "provider": "ollama",
  "ollamaUrl": "http://localhost:11434",
  "maxFindings": 15,
  "agents": [
    "security", "performance", "correctness", "design",
    "dependencies", "coverage", "testgen", "adversarial", "integration"
  ],
  "contextLines": 10,
  "testOutputDir": "./ai-review-tests"
}
```

- [ ] **Step 6: Create .gitignore**

```
node_modules/
dist/
coverage/
ai-review-tests/
*.env
.env*
```

- [ ] **Step 7: Install dependencies**

```bash
npm install
```

Expected: `node_modules/` created, no errors.

- [ ] **Step 8: Create src directory structure**

```bash
mkdir -p src/core/llm src/core/agents src/cli src/adapters
mkdir -p tests/unit tests/integration
mkdir -p calibration/fixtures
mkdir -p .claude/commands .github/workflows
```

- [ ] **Step 9: Commit**

```bash
git add .
git commit -m "chore: project scaffolding — package.json, tsconfig, vitest"
```

---

## Task 2: Core Types & Schema

**Files:**
- Create: `src/core/schema.ts`
- Create: `src/core/llm/provider.ts`

- [ ] **Step 1: Write src/core/schema.ts**

```typescript
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

export type Severity = 'critical' | 'high' | 'medium' | 'low'
export type Basis = 'VERIFIED' | 'INFERRED' | 'SPECULATIVE'
export type TestFramework = 'vitest' | 'jest' | 'mocha' | 'pytest'

export interface Finding {
  id: string
  agent: AgentName
  severity: Severity
  basis: Basis
  file: string
  line: number
  title: string
  detail: string
  suggestion: string
  relatedFindings?: string[]
}

export interface CoverageGap {
  file: string
  functionName: string
  lineStart: number
  lineEnd: number
  description: string
}

export interface GeneratedTestFile {
  path: string
  content: string
  framework: TestFramework
}

export interface ReviewInput {
  diff: string
  contextLines?: number
  projectPath?: string
}

export interface ReviewSummary {
  totalFindings: number
  bySeverity: Partial<Record<Severity, number>>
  byAgent: Partial<Record<AgentName, number>>
  durationMs: number
}

export interface ReviewResult {
  findings: Finding[]
  testFiles: GeneratedTestFile[]
  summary: ReviewSummary
}

export const SEVERITY_RANK: Record<Severity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1
}
```

- [ ] **Step 2: Write src/core/llm/provider.ts**

```typescript
export interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatOptions {
  think?: boolean
  format?: 'json'
  timeout?: number
}

export interface LLMProvider {
  chat(messages: Message[], options?: ChatOptions): Promise<string>
  ping(): Promise<{ ok: boolean; error?: string }>
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/core/schema.ts src/core/llm/provider.ts
git commit -m "feat: core types — Finding schema, LLMProvider interface"
```

---

## Task 3: Config Loading

**Files:**
- Create: `src/core/config.ts`
- Create: `tests/unit/config.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/config.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { loadConfig, DEFAULT_CONFIG } from '../../src/core/config.js'
import { writeFileSync, unlinkSync } from 'fs'

describe('loadConfig', () => {
  it('returns defaults when no config file exists', () => {
    const config = loadConfig('/nonexistent/path')
    expect(config.model).toBe('devstral:latest')
    expect(config.provider).toBe('ollama')
    expect(config.maxFindings).toBe(15)
  })

  it('merges project config over defaults', () => {
    writeFileSync('ai-review.config.json', JSON.stringify({ model: 'qwen3:latest', maxFindings: 5 }))
    try {
      const config = loadConfig(process.cwd())
      expect(config.model).toBe('qwen3:latest')
      expect(config.maxFindings).toBe(5)
      expect(config.provider).toBe('ollama') // default preserved
    } finally {
      unlinkSync('ai-review.config.json')
    }
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npm test -- config
```

Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Write src/core/config.ts**

```typescript
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import type { AgentName } from './schema.js'

export interface ReviewConfig {
  model: string
  provider: 'ollama' | 'anthropic'
  ollamaUrl: string
  anthropicModel: string
  maxFindings: number
  agents: AgentName[]
  contextLines: number
  testOutputDir: string
}

export const DEFAULT_CONFIG: ReviewConfig = {
  model: 'devstral:latest',
  provider: 'ollama',
  ollamaUrl: 'http://localhost:11434',
  anthropicModel: 'claude-sonnet-4-5',
  maxFindings: 15,
  agents: ['security', 'performance', 'correctness', 'design', 'dependencies', 'coverage', 'testgen', 'adversarial', 'integration'],
  contextLines: 10,
  testOutputDir: './ai-review-tests'
}

export function loadConfig(projectPath: string): ReviewConfig {
  const configPath = join(projectPath, 'ai-review.config.json')
  if (!existsSync(configPath)) return { ...DEFAULT_CONFIG }
  try {
    const raw = readFileSync(configPath, 'utf-8')
    const partial = JSON.parse(raw) as Partial<ReviewConfig>
    return { ...DEFAULT_CONFIG, ...partial }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
npm test -- config
```

Expected: 2 passing.

- [ ] **Step 5: Commit**

```bash
git add src/core/config.ts tests/unit/config.test.ts
git commit -m "feat: config loading with defaults and project override"
```

---

## Task 4: OllamaProvider

**Files:**
- Create: `src/core/llm/ollamaProvider.ts`
- Create: `tests/unit/ollamaProvider.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/ollamaProvider.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { OllamaProvider } from '../../src/core/llm/ollamaProvider.js'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

describe('OllamaProvider', () => {
  beforeEach(() => mockFetch.mockReset())

  describe('chat', () => {
    it('strips think tags from response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message: { content: '<think>reasoning here</think>\n{"findings":[]}' } })
      })
      const provider = new OllamaProvider('http://localhost:11434', 'devstral:latest')
      const result = await provider.chat([{ role: 'user', content: 'test' }])
      expect(result).toBe('{"findings":[]}')
      expect(result).not.toContain('<think>')
    })

    it('passes think:true by default', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message: { content: 'response' } })
      })
      const provider = new OllamaProvider('http://localhost:11434', 'devstral:latest')
      await provider.chat([{ role: 'user', content: 'test' }])
      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.think).toBe(true)
      expect(body.stream).toBe(false)
    })

    it('throws on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 })
      const provider = new OllamaProvider('http://localhost:11434', 'devstral:latest')
      await expect(provider.chat([{ role: 'user', content: 'test' }])).rejects.toThrow('Ollama HTTP 500')
    })
  })

  describe('ping', () => {
    it('returns ok:true when model is present', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: [{ name: 'devstral:latest' }] })
      })
      const provider = new OllamaProvider('http://localhost:11434', 'devstral:latest')
      const result = await provider.ping()
      expect(result.ok).toBe(true)
    })

    it('returns ok:false when model is missing', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: [{ name: 'other-model:latest' }] })
      })
      const provider = new OllamaProvider('http://localhost:11434', 'devstral:latest')
      const result = await provider.ping()
      expect(result.ok).toBe(false)
      expect(result.error).toContain('devstral')
    })
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npm test -- ollamaProvider
```

Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Write src/core/llm/ollamaProvider.ts**

```typescript
// Adapted from Google-Organizer/src/workers/ollamaClient.ts
import type { LLMProvider, Message, ChatOptions } from './provider.js'

const DEFAULT_TIMEOUT_MS = 120_000

export class OllamaProvider implements LLMProvider {
  constructor(
    private readonly baseUrl: string,
    private readonly model: string
  ) {}

  async chat(messages: Message[], options: ChatOptions = {}): Promise<string> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        stream: false,
        think: options.think ?? true,
        ...(options.format ? { format: options.format } : {}),
        messages
      }),
      signal: AbortSignal.timeout(options.timeout ?? DEFAULT_TIMEOUT_MS)
    })
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`)
    const data = await res.json() as { message?: { content?: string } }
    const raw = data.message?.content ?? ''
    return this.stripThinkTags(raw)
  }

  async ping(): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(5_000)
      })
      if (!res.ok) return { ok: false, error: `Ollama returned HTTP ${res.status}` }
      const data = await res.json() as { models?: Array<{ name: string }> }
      const modelBase = this.model.split(':')[0].toLowerCase()
      const hasModel = (data.models ?? []).some(m => m.name.toLowerCase().includes(modelBase))
      if (!hasModel) {
        return { ok: false, error: `Model ${this.model} not found. Run: ollama pull ${this.model}` }
      }
      return { ok: true }
    } catch (err) {
      return { ok: false, error: `Ollama not reachable at ${this.baseUrl}: ${(err as Error).message}` }
    }
  }

  private stripThinkTags(text: string): string {
    return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
  }
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
npm test -- ollamaProvider
```

Expected: 5 passing.

- [ ] **Step 5: Commit**

```bash
git add src/core/llm/ollamaProvider.ts tests/unit/ollamaProvider.test.ts
git commit -m "feat: OllamaProvider with think-tag stripping and ping"
```

---

## Task 5: BaseAgent

**Files:**
- Create: `src/core/agents/base.ts`
- Create: `tests/unit/baseAgent.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/baseAgent.test.ts
import { describe, it, expect, vi } from 'vitest'
import { BaseAgent } from '../../src/core/agents/base.js'
import type { LLMProvider } from '../../src/core/llm/provider.js'
import type { Finding, ReviewInput } from '../../src/core/schema.js'
import { DEFAULT_CONFIG } from '../../src/core/config.js'

// Concrete subclass for testing
class TestAgent extends BaseAgent {
  get name() { return 'security' as const }
  get systemPrompt() { return 'You are a test agent.' }
}

const makeProvider = (response: string): LLMProvider => ({
  chat: vi.fn().mockResolvedValue(response),
  ping: vi.fn().mockResolvedValue({ ok: true })
})

describe('BaseAgent', () => {
  it('parses bare JSON array', async () => {
    const raw = JSON.stringify([{ severity: 'high', basis: 'VERIFIED', file: 'src/foo.ts', line: 10, title: 'T', detail: 'D', suggestion: 'S' }])
    const agent = new TestAgent(makeProvider(raw), DEFAULT_CONFIG)
    const findings = await agent.run({ diff: 'diff content' })
    expect(findings).toHaveLength(1)
    expect(findings[0].agent).toBe('security')
    expect(findings[0].id).toBe('security-0')
    expect(findings[0].title).toBe('T')
  })

  it('parses JSON wrapped in markdown code fence', async () => {
    const raw = '```json\n[{"severity":"high","basis":"VERIFIED","file":"f.ts","line":1,"title":"T","detail":"D","suggestion":"S"}]\n```'
    const agent = new TestAgent(makeProvider(raw), DEFAULT_CONFIG)
    const findings = await agent.run({ diff: 'diff' })
    expect(findings).toHaveLength(1)
  })

  it('parses object with findings array', async () => {
    const raw = JSON.stringify({ findings: [{ severity: 'medium', basis: 'INFERRED', file: 'x.ts', line: 5, title: 'T', detail: 'D', suggestion: 'S' }] })
    const agent = new TestAgent(makeProvider(raw), DEFAULT_CONFIG)
    const findings = await agent.run({ diff: 'diff' })
    expect(findings).toHaveLength(1)
  })

  it('returns empty array on parse failure', async () => {
    const agent = new TestAgent(makeProvider('not json at all'), DEFAULT_CONFIG)
    const findings = await agent.run({ diff: 'diff' })
    expect(findings).toEqual([])
  })

  it('filters out findings missing required fields', async () => {
    const raw = JSON.stringify([
      { severity: 'high', basis: 'VERIFIED', file: 'f.ts', line: 1, title: 'T', detail: 'D', suggestion: 'S' },
      { severity: 'high' } // missing required fields
    ])
    const agent = new TestAgent(makeProvider(raw), DEFAULT_CONFIG)
    const findings = await agent.run({ diff: 'diff' })
    expect(findings).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npm test -- baseAgent
```

Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Write src/core/agents/base.ts**

```typescript
import type { LLMProvider, Message } from '../llm/provider.js'
import type { ReviewConfig } from '../config.js'
import type { Finding, ReviewInput, AgentName } from '../schema.js'

export abstract class BaseAgent {
  constructor(
    protected readonly provider: LLMProvider,
    protected readonly config: ReviewConfig
  ) {}

  abstract get name(): AgentName
  abstract get systemPrompt(): string

  async run(input: ReviewInput): Promise<Finding[]> {
    const messages: Message[] = [
      { role: 'system', content: this.systemPrompt },
      { role: 'user', content: this.buildUserPrompt(input) }
    ]
    const raw = await this.provider.chat(messages, { think: true })
    return this.parseFindings(raw)
  }

  protected buildUserPrompt(input: ReviewInput): string {
    return `Review this diff and return a JSON array of findings.\n\n\`\`\`diff\n${input.diff}\n\`\`\``
  }

  protected parseFindings(raw: string): Finding[] {
    const cleaned = raw.replace(/```json\s*|```\s*/g, '').trim()

    // Stage 1: bare array
    try {
      const parsed = JSON.parse(cleaned)
      if (Array.isArray(parsed)) {
        const valid = this.validateFindings(parsed)
        if (valid.length > 0 || parsed.length === 0) return valid
      }
      // Stage 2: object with .findings array
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.findings)) {
        return this.validateFindings(parsed.findings)
      }
    } catch { /* fall through */ }

    // Stage 3: regex extract array
    try {
      const arrMatch = cleaned.match(/\[[\s\S]*\]/)
      if (arrMatch) {
        const parsed = JSON.parse(arrMatch[0])
        if (Array.isArray(parsed)) return this.validateFindings(parsed)
      }
    } catch { /* fall through */ }

    console.error(`[${this.name}] parse failure. Raw snippet: ${raw.slice(0, 200)}`)
    return []
  }

  private validateFindings(items: unknown[]): Finding[] {
    return (items as Finding[])
      .filter(f =>
        typeof f === 'object' &&
        f !== null &&
        typeof f.severity === 'string' &&
        typeof f.basis === 'string' &&
        typeof f.file === 'string' &&
        typeof f.line === 'number' &&
        typeof f.title === 'string' &&
        typeof f.detail === 'string' &&
        typeof f.suggestion === 'string'
      )
      .map((f, i) => ({
        ...f,
        id: `${this.name}-${i}`,
        agent: this.name
      }))
  }
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
npm test -- baseAgent
```

Expected: 5 passing.

- [ ] **Step 5: Commit**

```bash
git add src/core/agents/base.ts tests/unit/baseAgent.test.ts
git commit -m "feat: BaseAgent with 3-stage JSON parse (bare array, wrapped, regex)"
```

---

## Task 6: Security + Performance + Correctness Agents

**Files:**
- Create: `src/core/agents/security.ts`
- Create: `src/core/agents/performance.ts`
- Create: `src/core/agents/correctness.ts`

All three follow the identical pattern — subclass `BaseAgent`, override `name` and `systemPrompt`. No custom `run()` needed.

- [ ] **Step 1: Write src/core/agents/security.ts**

```typescript
import { BaseAgent } from './base.js'
import type { AgentName } from '../schema.js'

export class SecurityAgent extends BaseAgent {
  get name(): AgentName { return 'security' }

  get systemPrompt(): string {
    return `You are a security code reviewer. Analyze the provided git diff for security vulnerabilities.

Focus on:
- SQL/NoSQL/command injection vulnerabilities
- Authentication and authorization bypasses
- Cryptographic misuse (weak algorithms, improper key handling, hardcoded secrets/API keys)
- OWASP Top 10 vulnerabilities
- Insecure deserialization
- Path traversal vulnerabilities
- XSS vulnerabilities (in frontend code)
- Prompt injection (in AI/LLM-adjacent code)
- Insecure direct object references

Output ONLY a JSON array. No prose, no explanation, no markdown fences.

Required format:
[{"severity":"critical|high|medium|low","basis":"VERIFIED|INFERRED|SPECULATIVE","file":"path/to/file","line":42,"title":"Short title under 60 chars","detail":"Detailed explanation of the vulnerability and why it is dangerous","suggestion":"Concrete fix with example code if applicable"}]

Rules:
- basis=VERIFIED: vulnerability is unambiguously visible in the diff
- basis=INFERRED: likely vulnerable based on patterns, broader context would confirm
- basis=SPECULATIVE: possible vulnerability, needs investigation to confirm
- Only report severity >= medium
- If no issues found, return: []`
  }
}
```

- [ ] **Step 2: Write src/core/agents/performance.ts**

```typescript
import { BaseAgent } from './base.js'
import type { AgentName } from '../schema.js'

export class PerformanceAgent extends BaseAgent {
  get name(): AgentName { return 'performance' }

  get systemPrompt(): string {
    return `You are a performance code reviewer. Analyze the provided git diff for performance issues.

Focus on:
- O(n²) or worse algorithmic complexity in loops or nested iterations
- N+1 query patterns (loading related records inside a loop)
- Blocking synchronous calls in async/event-loop contexts
- Memory leaks (unclosed connections, growing arrays never cleared, event listener accumulation)
- Unnecessary object allocations in hot paths
- Missing pagination on queries that return unbounded result sets
- Redundant computations that should be memoized or cached
- Inefficient data structures (array.find in a loop instead of a Map)
- Synchronous file I/O on the main thread

Output ONLY a JSON array. No prose, no explanation, no markdown fences.

Required format:
[{"severity":"critical|high|medium|low","basis":"VERIFIED|INFERRED|SPECULATIVE","file":"path/to/file","line":42,"title":"Short title under 60 chars","detail":"Explanation of the performance issue and its impact","suggestion":"Concrete optimization with example code"}]

Rules:
- basis=VERIFIED: issue is unambiguously visible in the diff
- basis=INFERRED: likely issue based on patterns
- basis=SPECULATIVE: possible issue, needs profiling to confirm
- Only report severity >= medium
- If no issues found, return: []`
  }
}
```

- [ ] **Step 3: Write src/core/agents/correctness.ts**

```typescript
import { BaseAgent } from './base.js'
import type { AgentName } from '../schema.js'

export class CorrectnessAgent extends BaseAgent {
  get name(): AgentName { return 'correctness' }

  get systemPrompt(): string {
    return `You are a correctness code reviewer. Analyze the provided git diff for logic bugs and correctness issues.

Focus on:
- Logic errors and incorrect conditional expressions
- Null/undefined dereferences (accessing properties on potentially null values)
- Off-by-one errors in array indexing, loop bounds, or string slicing
- Race conditions and TOCTOU (time-of-check-time-of-use) bugs
- Incorrect type assumptions (treating a string as a number, etc.)
- Missing error handling for operations that can fail
- Incorrect async/await usage (missing await, unhandled promise rejections)
- Integer overflow or underflow in arithmetic
- Incorrect comparison operators (== vs ===, boundary conditions)
- State mutation bugs (modifying shared state without proper synchronization)

Output ONLY a JSON array. No prose, no explanation, no markdown fences.

Required format:
[{"severity":"critical|high|medium|low","basis":"VERIFIED|INFERRED|SPECULATIVE","file":"path/to/file","line":42,"title":"Short title under 60 chars","detail":"Explanation of the bug and when it would manifest","suggestion":"Corrected code or approach"}]

Rules:
- basis=VERIFIED: bug is unambiguously present in the diff
- basis=INFERRED: likely bug based on patterns
- basis=SPECULATIVE: possible bug, depends on runtime state
- Only report severity >= medium
- If no issues found, return: []`
  }
}
```

- [ ] **Step 4: Verify TypeScript**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/core/agents/security.ts src/core/agents/performance.ts src/core/agents/correctness.ts
git commit -m "feat: SecurityAgent, PerformanceAgent, CorrectnessAgent"
```

---

## Task 7: Design + Dependencies + Adversarial + IntegrationScout Agents

**Files:**
- Create: `src/core/agents/design.ts`
- Create: `src/core/agents/dependencies.ts`
- Create: `src/core/agents/adversarial.ts`
- Create: `src/core/agents/integrationScout.ts`

- [ ] **Step 1: Write src/core/agents/design.ts**

```typescript
import { BaseAgent } from './base.js'
import type { AgentName } from '../schema.js'

export class DesignAgent extends BaseAgent {
  get name(): AgentName { return 'design' }

  get systemPrompt(): string {
    return `You are a software design code reviewer. Analyze the provided git diff for design and architecture issues.

Focus on:
- Tight coupling between modules (direct instantiation of dependencies, no injection)
- API contract violations (breaking changes to public interfaces)
- SOLID principle violations (single responsibility, open/closed, Liskov, interface segregation, dependency inversion)
- Abstraction leaks (internal implementation details exposed to callers)
- God objects or functions doing too many things
- Missing separation of concerns (business logic mixed with I/O)
- Inappropriate use of inheritance over composition
- Circular dependencies between modules
- Inconsistent naming conventions that obscure intent

Output ONLY a JSON array. No prose, no explanation, no markdown fences.

Required format:
[{"severity":"critical|high|medium|low","basis":"VERIFIED|INFERRED|SPECULATIVE","file":"path/to/file","line":42,"title":"Short title under 60 chars","detail":"Explanation of the design problem and why it matters","suggestion":"Recommended design approach"}]

Rules:
- basis=VERIFIED: issue is clearly visible in the diff
- basis=INFERRED: likely issue based on patterns seen
- basis=SPECULATIVE: possible issue, depends on broader codebase
- Only report severity >= medium
- If no issues found, return: []`
  }
}
```

- [ ] **Step 2: Write src/core/agents/dependencies.ts**

```typescript
import { BaseAgent } from './base.js'
import type { AgentName } from '../schema.js'

export class DependenciesAgent extends BaseAgent {
  get name(): AgentName { return 'dependencies' }

  get systemPrompt(): string {
    return `You are a dependency security reviewer. Analyze the provided git diff for dependency and supply chain issues.

Focus on:
- Newly added packages with known CVEs (based on your training knowledge)
- Packages with suspicious names that could be typosquatting attacks
- Pinned versions being loosened to ranges that allow malicious updates
- Packages with overly broad permissions or suspicious post-install scripts
- License incompatibilities (GPL code imported into MIT projects, etc.)
- Direct use of git URLs or unverified sources instead of registry packages
- Deprecated packages with known security issues
- Unnecessary dependencies that increase attack surface
- Version ranges so broad they allow breaking changes

Output ONLY a JSON array. No prose, no explanation, no markdown fences.

Required format:
[{"severity":"critical|high|medium|low","basis":"VERIFIED|INFERRED|SPECULATIVE","file":"path/to/file","line":42,"title":"Short title under 60 chars","detail":"Explanation of the dependency risk","suggestion":"Safer alternative or remediation"}]

Rules:
- basis=VERIFIED: CVE or known issue confirmed in training data
- basis=INFERRED: suspicious pattern that warrants investigation
- basis=SPECULATIVE: possible risk, needs npm audit to confirm
- Only report severity >= medium
- If the diff has no package.json / requirements.txt changes, return: []`
  }
}
```

- [ ] **Step 3: Write src/core/agents/adversarial.ts**

```typescript
import { BaseAgent } from './base.js'
import type { AgentName } from '../schema.js'

export class AdversarialAgent extends BaseAgent {
  get name(): AgentName { return 'adversarial' }

  get systemPrompt(): string {
    return `You are an adversarial testing agent. Analyze the provided git diff and identify inputs that would break the changed code.

Focus on finding inputs that cause:
- Null/undefined where not expected (passing null to a function expecting an object)
- Empty collections (empty array, empty string, empty object) where the code assumes non-empty
- Boundary values (INT_MAX, INT_MIN, 0, -1, very large numbers)
- Malformed data (invalid JSON, truncated strings, wrong encoding)
- Unicode edge cases (emoji in strings, RTL characters, null bytes)
- Concurrent access (two requests mutating the same resource simultaneously)
- Extremely long inputs that cause timeouts or stack overflows
- Negative numbers where only positive are expected
- Missing required fields in objects/payloads

For each finding, describe the specific breaking input and which code path it exercises.

Output ONLY a JSON array. No prose, no explanation, no markdown fences.

Required format:
[{"severity":"critical|high|medium|low","basis":"VERIFIED|INFERRED|SPECULATIVE","file":"path/to/file","line":42,"title":"Short title under 60 chars","detail":"The specific input that breaks this code and why","suggestion":"Guard condition or validation that would prevent the break"}]

Rules:
- basis=VERIFIED: the code clearly does not handle this input
- basis=INFERRED: likely unhandled based on common patterns
- basis=SPECULATIVE: might fail depending on upstream validation
- Only report severity >= medium
- If no breaking inputs found, return: []`
  }
}
```

- [ ] **Step 4: Write src/core/agents/integrationScout.ts**

```typescript
import { BaseAgent } from './base.js'
import type { AgentName } from '../schema.js'

export class IntegrationScoutAgent extends BaseAgent {
  get name(): AgentName { return 'integration' }

  get systemPrompt(): string {
    return `You are an integration testing analyst. Analyze the provided git diff and identify integration seams that need contract or integration tests.

Focus on:
- New or modified HTTP API calls (fetch, axios, got) — need contract tests verifying request/response shape
- New or modified database writes — need integration tests verifying data persistence and constraints
- New or modified IPC/message-passing boundaries — need tests for message schemas
- New external service integrations — need mocked integration tests
- Changed event emitters/listeners — need tests verifying event contracts
- Modified queue/worker interfaces — need tests for message format compatibility
- New WebSocket connections — need tests for connection lifecycle and message handling
- Changed file system interactions — need tests for file creation, permissions, cleanup

For each finding, describe WHAT needs an integration test and WHY a unit test is insufficient.

Output ONLY a JSON array. No prose, no explanation, no markdown fences.

Required format:
[{"severity":"critical|high|medium|low","basis":"VERIFIED|INFERRED|SPECULATIVE","file":"path/to/file","line":42,"title":"Short title under 60 chars","detail":"The integration boundary that needs testing and what could go wrong","suggestion":"Specific test scenario to write, including what to mock and what to assert"}]

Rules:
- basis=VERIFIED: integration boundary is clearly new or changed in the diff
- basis=INFERRED: likely needs integration testing based on patterns
- basis=SPECULATIVE: may need testing depending on deployment context
- Only report severity >= medium
- If no integration boundaries found, return: []`
  }
}
```

- [ ] **Step 5: Verify TypeScript**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/core/agents/design.ts src/core/agents/dependencies.ts src/core/agents/adversarial.ts src/core/agents/integrationScout.ts
git commit -m "feat: DesignAgent, DependenciesAgent, AdversarialAgent, IntegrationScoutAgent"
```

---

## Task 8: CoverageAnalyst + TestGen Agents

These two are special — CoverageAnalyst returns both `Finding[]` and `CoverageGap[]`; TestGen consumes gaps and produces test files instead of findings.

**Files:**
- Create: `src/core/agents/coverageAnalyst.ts`
- Create: `src/core/agents/testGen.ts`

- [ ] **Step 1: Write src/core/agents/coverageAnalyst.ts**

```typescript
import { BaseAgent } from './base.js'
import type { AgentName, CoverageGap, Finding, ReviewInput } from '../schema.js'
import type { Message } from '../llm/provider.js'

export interface CoverageAnalystResult {
  findings: Finding[]
  gaps: CoverageGap[]
}

export class CoverageAnalystAgent extends BaseAgent {
  get name(): AgentName { return 'coverage' }

  get systemPrompt(): string {
    return `You are a test coverage analyst. Analyze the provided git diff and identify code paths that lack test coverage.

Focus on:
- New functions or methods with no corresponding test
- New conditional branches (if/else, switch cases) not covered by existing tests
- New error handling paths not tested
- New async code paths (Promise rejections, async error cases)
- Changed logic in existing functions where old tests may no longer cover new behavior

Output ONLY a JSON object with two arrays: "findings" (coverage issues as review findings) and "gaps" (structured coverage gap data for test generation).

Required format:
{
  "findings": [{"severity":"medium","basis":"VERIFIED","file":"path/to/file","line":42,"title":"No test for X function","detail":"The X function added in this diff has no test coverage","suggestion":"Add unit test covering the happy path and error case"}],
  "gaps": [{"file":"path/to/file","functionName":"functionName","lineStart":10,"lineEnd":25,"description":"What the function does and what cases need testing"}]
}

Rules:
- Every gap should have a corresponding finding
- basis=VERIFIED: function is clearly new/changed with no test file changes in the diff
- basis=INFERRED: likely untested based on file patterns
- If fully covered, return: {"findings":[],"gaps":[]}`
  }

  async runForCoverage(input: ReviewInput): Promise<CoverageAnalystResult> {
    const messages: Message[] = [
      { role: 'system', content: this.systemPrompt },
      { role: 'user', content: this.buildUserPrompt(input) }
    ]
    const raw = await this.provider.chat(messages, { think: true })
    return this.parseCoverageResult(raw, input)
  }

  private parseCoverageResult(raw: string, _input: ReviewInput): CoverageAnalystResult {
    const cleaned = raw.replace(/```json\s*|```\s*/g, '').trim()
    try {
      const parsed = JSON.parse(cleaned) as { findings?: unknown[]; gaps?: unknown[] }
      const findings = this.parseFindings(JSON.stringify(parsed.findings ?? []))
      const gaps = this.validateGaps(parsed.gaps ?? [])
      return { findings, gaps }
    } catch {
      // Try regex extraction
      try {
        const objMatch = cleaned.match(/\{[\s\S]*\}/)
        if (objMatch) {
          const parsed = JSON.parse(objMatch[0]) as { findings?: unknown[]; gaps?: unknown[] }
          return {
            findings: this.parseFindings(JSON.stringify(parsed.findings ?? [])),
            gaps: this.validateGaps(parsed.gaps ?? [])
          }
        }
      } catch { /* fall through */ }
      console.error(`[coverage] parse failure. Raw snippet: ${raw.slice(0, 200)}`)
      return { findings: [], gaps: [] }
    }
  }

  private validateGaps(items: unknown[]): CoverageGap[] {
    return (items as CoverageGap[]).filter(g =>
      typeof g === 'object' &&
      g !== null &&
      typeof g.file === 'string' &&
      typeof g.functionName === 'string' &&
      typeof g.lineStart === 'number' &&
      typeof g.lineEnd === 'number' &&
      typeof g.description === 'string'
    )
  }
}
```

- [ ] **Step 2: Write src/core/agents/testGen.ts**

```typescript
import type { LLMProvider, Message } from '../llm/provider.js'
import type { ReviewConfig } from '../config.js'
import type { CoverageGap, GeneratedTestFile, ReviewInput, TestFramework } from '../schema.js'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

export class TestGenAgent {
  constructor(
    private readonly provider: LLMProvider,
    private readonly config: ReviewConfig
  ) {}

  async runWithGaps(input: ReviewInput, gaps: CoverageGap[]): Promise<{ testFiles: GeneratedTestFile[] }> {
    if (gaps.length === 0) return { testFiles: [] }

    const framework = this.detectFramework(input.projectPath)
    const testFiles: GeneratedTestFile[] = []

    // Group gaps by file to minimize API calls
    const byFile = new Map<string, CoverageGap[]>()
    for (const gap of gaps) {
      const existing = byFile.get(gap.file) ?? []
      existing.push(gap)
      byFile.set(gap.file, existing)
    }

    for (const [file, fileGaps] of byFile) {
      const testFile = await this.generateTestFile(file, fileGaps, framework, input)
      if (testFile) testFiles.push(testFile)
    }

    return { testFiles }
  }

  private async generateTestFile(
    sourceFile: string,
    gaps: CoverageGap[],
    framework: TestFramework,
    input: ReviewInput
  ): Promise<GeneratedTestFile | null> {
    const gapDescriptions = gaps.map(g =>
      `- Function: ${g.functionName} (lines ${g.lineStart}-${g.lineEnd})\n  What it does: ${g.description}`
    ).join('\n')

    const messages: Message[] = [
      {
        role: 'system',
        content: `You are a test generation agent. Write complete, runnable test code using ${framework}.
Output ONLY valid ${framework} test code. No explanation, no markdown fences, no prose.
Tests must: import the module under test, cover the happy path, cover the error/edge case, use descriptive test names.`
      },
      {
        role: 'user',
        content: `Generate tests for these uncovered functions in ${sourceFile}:\n\n${gapDescriptions}\n\nContext from diff:\n\`\`\`diff\n${input.diff.slice(0, 8000)}\n\`\`\``
      }
    ]

    const raw = await this.provider.chat(messages, { think: false })
    const content = raw.replace(/```(?:typescript|javascript|python)?\s*|```\s*/g, '').trim()
    if (!content || content.length < 50) return null

    const testPath = this.deriveTestPath(sourceFile, framework)
    return { path: testPath, content, framework }
  }

  private detectFramework(projectPath?: string): TestFramework {
    if (!projectPath) return 'vitest'
    const pkgPath = join(projectPath, 'package.json')
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as Record<string, unknown>
        const deps = { ...(pkg.dependencies as object ?? {}), ...(pkg.devDependencies as object ?? {}) }
        if ('vitest' in deps) return 'vitest'
        if ('jest' in deps) return 'jest'
        if ('mocha' in deps) return 'mocha'
      } catch { /* fall through */ }
    }
    const reqPath = join(projectPath, 'requirements.txt')
    if (existsSync(reqPath)) return 'pytest'
    return 'vitest'
  }

  private deriveTestPath(sourceFile: string, framework: TestFramework): string {
    const ext = framework === 'pytest' ? '.py' : '.test.ts'
    const base = sourceFile.replace(/\.(ts|js|tsx|jsx|py)$/, '')
    return `${this.config.testOutputDir}/${base.replace(/^src\//, '')}${ext}`
  }
}
```

- [ ] **Step 3: Verify TypeScript**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/core/agents/coverageAnalyst.ts src/core/agents/testGen.ts
git commit -m "feat: CoverageAnalystAgent (gaps + findings) and TestGenAgent (produces test files)"
```

---

## Task 9: Orchestrator

**Files:**
- Create: `src/core/agents/orchestrator.ts`
- Create: `tests/unit/orchestrator.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/orchestrator.test.ts
import { describe, it, expect } from 'vitest'
import { OrchestratorAgent } from '../../src/core/agents/orchestrator.js'
import { DEFAULT_CONFIG } from '../../src/core/config.js'
import type { Finding } from '../../src/core/schema.js'
import { vi } from 'vitest'

const makeProvider = () => ({
  chat: vi.fn(),
  ping: vi.fn().mockResolvedValue({ ok: true })
})

const finding = (overrides: Partial<Finding> = {}): Finding => ({
  id: 'security-0',
  agent: 'security',
  severity: 'high',
  basis: 'VERIFIED',
  file: 'src/auth.ts',
  line: 10,
  title: 'Test finding',
  detail: 'Detail',
  suggestion: 'Fix it',
  ...overrides
})

describe('OrchestratorAgent', () => {
  describe('deduplication', () => {
    it('removes duplicate findings at same file:line from different agents', () => {
      const orch = new OrchestratorAgent(makeProvider(), DEFAULT_CONFIG)
      const findings = [
        finding({ id: 'security-0', agent: 'security', file: 'src/auth.ts', line: 10, title: 'SQL injection' }),
        finding({ id: 'correctness-0', agent: 'correctness', file: 'src/auth.ts', line: 10, title: 'Null pointer' })
      ]
      const result = orch.synthesize(findings)
      expect(result).toHaveLength(1)
      // Security takes precedence over correctness
      expect(result[0].agent).toBe('security')
    })
  })

  describe('severity escalation', () => {
    it('escalates severity when correctness bug has no test coverage at same location', () => {
      const orch = new OrchestratorAgent(makeProvider(), DEFAULT_CONFIG)
      const findings = [
        finding({ id: 'correctness-0', agent: 'correctness', severity: 'medium', file: 'src/foo.ts', line: 20, title: 'Logic bug' }),
        finding({ id: 'coverage-0', agent: 'coverage', severity: 'medium', file: 'src/foo.ts', line: 20, title: 'No test coverage' })
      ]
      const result = orch.synthesize(findings)
      const corrFinding = result.find(f => f.agent === 'correctness')
      expect(corrFinding?.severity).toBe('high') // escalated from medium
    })
  })

  describe('cap', () => {
    it('limits output to maxFindings sorted by severity', () => {
      const config = { ...DEFAULT_CONFIG, maxFindings: 3 }
      const orch = new OrchestratorAgent(makeProvider(), config)
      const findings = Array.from({ length: 10 }, (_, i) =>
        finding({ id: `security-${i}`, line: i + 1, title: `Finding ${i}`, severity: i < 3 ? 'critical' : 'medium' })
      )
      const result = orch.synthesize(findings)
      expect(result).toHaveLength(3)
      expect(result.every(f => f.severity === 'critical')).toBe(true)
    })
  })

  describe('publication filter', () => {
    it('excludes SPECULATIVE findings below high severity', () => {
      const orch = new OrchestratorAgent(makeProvider(), DEFAULT_CONFIG)
      const findings = [
        finding({ id: 'security-0', severity: 'medium', basis: 'SPECULATIVE' }),
        finding({ id: 'security-1', severity: 'high', basis: 'SPECULATIVE' }),
        finding({ id: 'security-2', severity: 'medium', basis: 'VERIFIED' })
      ]
      const result = orch.synthesize(findings)
      expect(result.find(f => f.id === 'security-0')).toBeUndefined()
      expect(result.find(f => f.id === 'security-1')).toBeDefined()
      expect(result.find(f => f.id === 'security-2')).toBeDefined()
    })
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npm test -- orchestrator
```

Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Write src/core/agents/orchestrator.ts**

```typescript
import type { LLMProvider } from '../llm/provider.js'
import type { ReviewConfig } from '../config.js'
import type { Finding, Severity, AgentName } from '../schema.js'
import { SEVERITY_RANK } from '../schema.js'

// Agent priority for deduplication — higher index = higher priority kept
const AGENT_PRIORITY: AgentName[] = [
  'integration', 'coverage', 'testgen', 'adversarial',
  'design', 'dependencies', 'correctness', 'performance', 'security'
]

export class OrchestratorAgent {
  constructor(
    private readonly provider: LLMProvider,
    private readonly config: ReviewConfig
  ) {}

  synthesize(findings: Finding[]): Finding[] {
    let result = [...findings]
    result = this.deduplicate(result)
    result = this.crossReference(result)
    result = this.applyPublicationFilter(result)
    result = this.capAndSort(result)
    return result
  }

  private deduplicate(findings: Finding[]): Finding[] {
    const seen = new Map<string, Finding>()
    for (const f of findings) {
      const key = `${f.file}:${f.line}`
      const existing = seen.get(key)
      if (!existing) {
        seen.set(key, f)
      } else {
        // Keep the one from the higher-priority agent
        const existingPriority = AGENT_PRIORITY.indexOf(existing.agent)
        const newPriority = AGENT_PRIORITY.indexOf(f.agent)
        if (newPriority > existingPriority) {
          seen.set(key, { ...f, relatedFindings: [...(f.relatedFindings ?? []), existing.id] })
        }
      }
    }
    return Array.from(seen.values())
  }

  private crossReference(findings: Finding[]): Finding[] {
    return findings.map(f => {
      // Correctness bug at same file:line as a coverage gap → escalate severity
      if (f.agent === 'correctness') {
        const hasCoverageGap = findings.some(
          other => other.agent === 'coverage' && other.file === f.file && Math.abs(other.line - f.line) <= 5
        )
        if (hasCoverageGap) {
          return { ...f, severity: this.escalate(f.severity), relatedFindings: [...(f.relatedFindings ?? []), 'coverage'] }
        }
      }
      // Security finding at same location as adversarial → escalate
      if (f.agent === 'security') {
        const hasAdversarial = findings.some(
          other => other.agent === 'adversarial' && other.file === f.file && Math.abs(other.line - f.line) <= 5
        )
        if (hasAdversarial) {
          return { ...f, severity: this.escalate(f.severity) }
        }
      }
      return f
    })
  }

  private escalate(severity: Severity): Severity {
    const levels: Severity[] = ['low', 'medium', 'high', 'critical']
    const idx = levels.indexOf(severity)
    return levels[Math.min(idx + 1, levels.length - 1)]
  }

  private applyPublicationFilter(findings: Finding[]): Finding[] {
    return findings.filter(f => {
      if (f.severity === 'low') return false
      if (f.basis === 'SPECULATIVE' && SEVERITY_RANK[f.severity] < SEVERITY_RANK['high']) return false
      return true
    })
  }

  private capAndSort(findings: Finding[]): Finding[] {
    return findings
      .sort((a, b) => {
        const sevDiff = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]
        if (sevDiff !== 0) return sevDiff
        // Secondary sort: VERIFIED > INFERRED > SPECULATIVE
        const basisOrder = { VERIFIED: 2, INFERRED: 1, SPECULATIVE: 0 }
        return basisOrder[b.basis] - basisOrder[a.basis]
      })
      .slice(0, this.config.maxFindings)
  }
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
npm test -- orchestrator
```

Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
git add src/core/agents/orchestrator.ts tests/unit/orchestrator.test.ts
git commit -m "feat: OrchestratorAgent — dedup, cross-reference escalation, publication filter, cap"
```

---

## Task 10: SwarmRunner

**Files:**
- Create: `src/core/runner.ts`
- Create: `tests/unit/runner.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/runner.test.ts
import { describe, it, expect, vi } from 'vitest'
import { SwarmRunner } from '../../src/core/runner.js'
import { DEFAULT_CONFIG } from '../../src/core/config.js'
import type { LLMProvider } from '../../src/core/llm/provider.js'

const makeProvider = (response = '[]'): LLMProvider => ({
  chat: vi.fn().mockResolvedValue(response),
  ping: vi.fn().mockResolvedValue({ ok: true })
})

describe('SwarmRunner', () => {
  it('runs agents sequentially and returns a ReviewResult', async () => {
    const provider = makeProvider()
    const runner = new SwarmRunner(DEFAULT_CONFIG, provider)
    const result = await runner.run({ diff: 'diff content' })
    expect(result.findings).toBeInstanceOf(Array)
    expect(result.testFiles).toBeInstanceOf(Array)
    expect(result.summary.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('calls onProgress for each agent', async () => {
    const provider = makeProvider()
    const runner = new SwarmRunner(DEFAULT_CONFIG, provider)
    const progress: string[] = []
    await runner.run({ diff: 'diff' }, (agent) => progress.push(agent))
    expect(progress.length).toBe(DEFAULT_CONFIG.agents.length)
  })

  it('aborts with error when ping fails', async () => {
    const provider: LLMProvider = {
      chat: vi.fn(),
      ping: vi.fn().mockResolvedValue({ ok: false, error: 'Ollama not running' })
    }
    const runner = new SwarmRunner(DEFAULT_CONFIG, provider)
    await expect(runner.run({ diff: 'diff' })).rejects.toThrow('Ollama not running')
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npm test -- runner
```

Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Write src/core/runner.ts**

```typescript
import type { LLMProvider } from './llm/provider.js'
import type { ReviewConfig } from './config.js'
import type { AgentName, Finding, ReviewInput, ReviewResult, CoverageGap, GeneratedTestFile } from './schema.js'
import { BaseAgent } from './agents/base.js'
import { SecurityAgent } from './agents/security.js'
import { PerformanceAgent } from './agents/performance.js'
import { CorrectnessAgent } from './agents/correctness.js'
import { DesignAgent } from './agents/design.js'
import { DependenciesAgent } from './agents/dependencies.js'
import { CoverageAnalystAgent } from './agents/coverageAnalyst.js'
import { TestGenAgent } from './agents/testGen.js'
import { AdversarialAgent } from './agents/adversarial.js'
import { IntegrationScoutAgent } from './agents/integrationScout.js'
import { OrchestratorAgent } from './agents/orchestrator.js'

function buildAgents(config: ReviewConfig, provider: LLMProvider): BaseAgent[] {
  const map: Record<AgentName, () => BaseAgent> = {
    security: () => new SecurityAgent(provider, config),
    performance: () => new PerformanceAgent(provider, config),
    correctness: () => new CorrectnessAgent(provider, config),
    design: () => new DesignAgent(provider, config),
    dependencies: () => new DependenciesAgent(provider, config),
    coverage: () => new CoverageAnalystAgent(provider, config),
    testgen: () => { throw new Error('testgen handled separately') },
    adversarial: () => new AdversarialAgent(provider, config),
    integration: () => new IntegrationScoutAgent(provider, config)
  }
  return config.agents
    .filter(a => a !== 'testgen' && a !== 'coverage')
    .map(a => map[a]())
}

export class SwarmRunner {
  private readonly orchestrator: OrchestratorAgent
  private readonly testGen: TestGenAgent

  constructor(
    private readonly config: ReviewConfig,
    private readonly provider: LLMProvider
  ) {
    this.orchestrator = new OrchestratorAgent(provider, config)
    this.testGen = new TestGenAgent(provider, config)
  }

  async run(
    input: ReviewInput,
    onProgress?: (agent: AgentName) => void
  ): Promise<ReviewResult> {
    const ping = await this.provider.ping()
    if (!ping.ok) throw new Error(ping.error ?? 'LLM provider not available')

    const start = Date.now()
    const allFindings: Finding[] = []
    let coverageGaps: CoverageGap[] = []
    let testFiles: GeneratedTestFile[] = []

    // Run CoverageAnalyst first if enabled (TestGen depends on it)
    if (this.config.agents.includes('coverage')) {
      onProgress?.('coverage')
      const coverageAgent = new CoverageAnalystAgent(this.provider, this.config)
      const coverageResult = await coverageAgent.runForCoverage(input)
      allFindings.push(...coverageResult.findings)
      coverageGaps = coverageResult.gaps
    }

    // Run remaining specialist agents
    const agents = buildAgents(this.config, this.provider)
    for (const agent of agents) {
      onProgress?.(agent.name)
      const findings = await agent.run(input)
      allFindings.push(...findings)
    }

    // Run TestGen if enabled
    if (this.config.agents.includes('testgen') && coverageGaps.length > 0) {
      onProgress?.('testgen')
      const testResult = await this.testGen.runWithGaps(input, coverageGaps)
      testFiles = testResult.testFiles
    }

    const findings = this.orchestrator.synthesize(allFindings)

    const bySeverity = findings.reduce((acc, f) => {
      acc[f.severity] = (acc[f.severity] ?? 0) + 1
      return acc
    }, {} as Record<string, number>)

    const byAgent = findings.reduce((acc, f) => {
      acc[f.agent] = (acc[f.agent] ?? 0) + 1
      return acc
    }, {} as Record<string, number>)

    return {
      findings,
      testFiles,
      summary: {
        totalFindings: findings.length,
        bySeverity,
        byAgent,
        durationMs: Date.now() - start
      }
    }
  }
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
npm test -- runner
```

Expected: 3 passing.

- [ ] **Step 5: Run all unit tests**

```bash
npm test
```

Expected: all passing.

- [ ] **Step 6: Commit**

```bash
git add src/core/runner.ts tests/unit/runner.test.ts
git commit -m "feat: SwarmRunner — sequential agent orchestration with coverage-first ordering"
```

---

## Task 11: CLI

**Files:**
- Create: `src/cli/formatter.ts`
- Create: `src/cli/index.ts`

- [ ] **Step 1: Write src/cli/formatter.ts**

```typescript
import type { ReviewResult, Finding, Severity } from '../core/schema.js'

const SEVERITY_EMOJI: Record<Severity, string> = {
  critical: '🔴',
  high: '🟠',
  medium: '🟡',
  low: '🔵'
}

export function formatMarkdown(result: ReviewResult): string {
  const { findings, testFiles, summary } = result
  const lines: string[] = []

  lines.push('# AI Code Review Report')
  lines.push('')
  lines.push(`**${summary.totalFindings} finding${summary.totalFindings === 1 ? '' : 's'}** | ${summary.durationMs}ms`)
  lines.push('')

  if (findings.length === 0) {
    lines.push('✅ No issues found.')
    return lines.join('\n')
  }

  const bySeverity = groupBy(findings, f => f.severity)
  for (const severity of ['critical', 'high', 'medium', 'low'] as Severity[]) {
    const group = bySeverity.get(severity)
    if (!group?.length) continue
    lines.push(`## ${SEVERITY_EMOJI[severity]} ${capitalize(severity)} (${group.length})`)
    lines.push('')
    for (const f of group) {
      lines.push(`### ${f.title}`)
      lines.push(`**Agent:** ${f.agent} | **Basis:** ${f.basis} | **File:** \`${f.file}:${f.line}\``)
      lines.push('')
      lines.push(f.detail)
      lines.push('')
      lines.push(`**Suggestion:** ${f.suggestion}`)
      lines.push('')
      lines.push('---')
      lines.push('')
    }
  }

  if (testFiles.length > 0) {
    lines.push(`## 🧪 Generated Test Files (${testFiles.length})`)
    lines.push('')
    for (const tf of testFiles) {
      lines.push(`- \`${tf.path}\` (${tf.framework})`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

export function formatJson(result: ReviewResult): string {
  return JSON.stringify(result, null, 2)
}

function groupBy<T>(arr: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const item of arr) {
    const k = key(item)
    const group = map.get(k) ?? []
    group.push(item)
    map.set(k, group)
  }
  return map
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
```

- [ ] **Step 2: Write src/cli/index.ts**

```typescript
#!/usr/bin/env node
import { Command } from 'commander'
import { execSync } from 'child_process'
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import { SwarmRunner } from '../core/runner.js'
import { loadConfig } from '../core/config.js'
import { OllamaProvider } from '../core/llm/ollamaProvider.js'
import { formatMarkdown, formatJson } from './formatter.js'
import type { AgentName } from '../core/schema.js'

const program = new Command()

program
  .name('ai-review')
  .description('AI-powered code review and deep testing agent')
  .version('0.1.0')

program
  .command('review', { isDefault: true })
  .description('Review code changes')
  .option('--diff <path>', 'Path to a .diff file to review')
  .option('--path <path>', 'Directory to diff against HEAD')
  .option('--model <model>', 'Override Ollama model')
  .option('--agents <list>', 'Comma-separated list of agents to run')
  .option('--format <format>', 'Output format: markdown or json', 'markdown')
  .option('--out <path>', 'Write output to file instead of stdout')
  .action(async (options: {
    diff?: string
    path?: string
    model?: string
    agents?: string
    format: 'markdown' | 'json'
    out?: string
  }) => {
    const projectPath = resolve(options.path ?? process.cwd())
    const config = loadConfig(projectPath)

    if (options.model) config.model = options.model
    if (options.agents) config.agents = options.agents.split(',').map(a => a.trim()) as AgentName[]

    const diff = getDiff(options.diff, options.path)
    if (!diff.trim()) {
      console.error('No diff to review. Stage changes or provide --diff.')
      process.exit(1)
    }

    const provider = new OllamaProvider(config.ollamaUrl, config.model)
    const runner = new SwarmRunner(config, provider)

    process.stdout.write(`\n🔍 Running ai-review with ${config.agents.length} agents...\n\n`)

    const result = await runner.run(
      { diff, projectPath },
      (agent) => process.stdout.write(`  ✓ ${agent}\n`)
    )

    // Write generated test files
    if (result.testFiles.length > 0) {
      for (const tf of result.testFiles) {
        const outPath = join(projectPath, tf.path)
        mkdirSync(join(outPath, '..'), { recursive: true })
        writeFileSync(outPath, tf.content, 'utf-8')
      }
      process.stdout.write(`\n📝 Generated ${result.testFiles.length} test file(s) in ${config.testOutputDir}\n`)
    }

    const output = options.format === 'json' ? formatJson(result) : formatMarkdown(result)

    if (options.out) {
      writeFileSync(options.out, output, 'utf-8')
      process.stdout.write(`\n✅ Report written to ${options.out}\n`)
    } else {
      process.stdout.write('\n' + output + '\n')
    }

    // Exit 1 if any critical/high findings (useful for CI)
    const hasBlocker = result.findings.some(f => f.severity === 'critical' || f.severity === 'high')
    process.exit(hasBlocker ? 1 : 0)
  })

function getDiff(diffFile?: string, pathOverride?: string): string {
  if (diffFile) {
    if (!existsSync(diffFile)) {
      console.error(`Diff file not found: ${diffFile}`)
      process.exit(1)
    }
    return readFileSync(diffFile, 'utf-8')
  }
  if (pathOverride) {
    return execSync(`git -C "${pathOverride}" diff HEAD`, { encoding: 'utf-8' })
  }
  // Default: staged diff
  const staged = execSync('git diff --staged', { encoding: 'utf-8' })
  if (staged.trim()) return staged
  // Fall back to unstaged
  return execSync('git diff', { encoding: 'utf-8' })
}

program.parse()
```

- [ ] **Step 3: Build and verify**

```bash
npm run build
```

Expected: `dist/` created with no TypeScript errors.

- [ ] **Step 4: Smoke test CLI**

```bash
node dist/cli/index.js --help
```

Expected: shows usage with `--diff`, `--model`, `--agents`, `--format` options.

- [ ] **Step 5: Commit**

```bash
git add src/cli/formatter.ts src/cli/index.ts
git commit -m "feat: CLI — commander entry point, markdown/json formatters, staged diff by default"
```

---

## Task 12: GitHub Actions Adapter + Workflow

**Files:**
- Create: `src/adapters/github.ts`
- Create: `.github/workflows/review.yml`

- [ ] **Step 1: Write src/adapters/github.ts**

```typescript
// Adapted from ai-code-review-agent branch review-agent.js comment upsert pattern
export interface GitHubComment {
  body: string
}

const COMMENT_MARKER = '<!-- ai-review-bot -->'

export async function upsertPRComment(
  token: string,
  owner: string,
  repo: string,
  prNumber: number,
  body: string
): Promise<void> {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28'
  }

  const fullBody = `${COMMENT_MARKER}\n${body}`

  // Find existing bot comment
  const listRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/comments?per_page=100`,
    { headers }
  )
  if (!listRes.ok) throw new Error(`GitHub API list comments failed: ${listRes.status}`)
  const comments = await listRes.json() as Array<{ id: number; body: string }>
  const existing = comments.find(c => c.body.includes(COMMENT_MARKER))

  if (existing) {
    // PATCH to update existing comment
    const patchRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/issues/comments/${existing.id}`,
      { method: 'PATCH', headers, body: JSON.stringify({ body: fullBody }) }
    )
    if (!patchRes.ok) throw new Error(`GitHub API update comment failed: ${patchRes.status}`)
  } else {
    // POST new comment
    const postRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/comments`,
      { method: 'POST', headers, body: JSON.stringify({ body: fullBody }) }
    )
    if (!postRes.ok) throw new Error(`GitHub API create comment failed: ${postRes.status}`)
  }
}

export function buildStepSummary(result: import('../core/schema.js').ReviewResult): string {
  const rows = result.findings.map(f =>
    `| ${f.severity} | ${f.agent} | ${f.file}:${f.line} | ${f.title} | ${f.basis} |`
  ).join('\n')

  return `## AI Review Summary
| Severity | Agent | Location | Issue | Basis |
|---|---|---|---|---|
${rows || '| — | — | — | No findings | — |'}

**Total:** ${result.findings.length} findings | **Duration:** ${result.summary.durationMs}ms`
}
```

- [ ] **Step 2: Write .github/workflows/review.yml**

```yaml
name: AI Code Review

on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  ai-review:
    runs-on: self-hosted  # Requires Ollama on the runner
    permissions:
      pull-requests: write
      contents: read

    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '24'

      - name: Install ai-review
        run: npm install -g ai-review

      - name: Generate diff
        run: |
          git diff origin/${{ github.base_ref }}...HEAD > pr.diff
          echo "Diff size: $(wc -c < pr.diff) bytes"

      - name: Run AI Review
        id: review
        run: |
          ai-review --diff pr.diff --format json --out findings.json || true
        env:
          OLLAMA_URL: http://localhost:11434

      - name: Post PR Comment
        if: always()
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs')
            if (!fs.existsSync('findings.json')) {
              console.log('No findings.json — skipping comment')
              return
            }
            const result = JSON.parse(fs.readFileSync('findings.json', 'utf8'))
            const findings = result.findings ?? []
            const lines = ['<!-- ai-review-bot -->', '## 🤖 AI Code Review', '']
            if (findings.length === 0) {
              lines.push('✅ No issues found.')
            } else {
              for (const f of findings) {
                const emoji = { critical: '🔴', high: '🟠', medium: '🟡', low: '🔵' }[f.severity] ?? '⚪'
                lines.push(`### ${emoji} ${f.title}`)
                lines.push(`**${f.agent}** · \`${f.file}:${f.line}\` · ${f.basis}`)
                lines.push('')
                lines.push(f.detail)
                lines.push('')
                lines.push(`> 💡 ${f.suggestion}`)
                lines.push('')
                lines.push('---')
                lines.push('')
              }
            }
            const body = lines.join('\n')
            const comments = await github.rest.issues.listComments({
              owner: context.repo.owner, repo: context.repo.repo, issue_number: context.issue.number
            })
            const existing = comments.data.find(c => c.body.includes('<!-- ai-review-bot -->'))
            if (existing) {
              await github.rest.issues.updateComment({
                owner: context.repo.owner, repo: context.repo.repo,
                comment_id: existing.id, body
              })
            } else {
              await github.rest.issues.createComment({
                owner: context.repo.owner, repo: context.repo.repo,
                issue_number: context.issue.number, body
              })
            }

      - name: Write Step Summary
        if: always()
        run: |
          node -e "
            const fs = require('fs')
            if (!fs.existsSync('findings.json')) process.exit(0)
            const r = JSON.parse(fs.readFileSync('findings.json','utf8'))
            const rows = (r.findings||[]).map(f => \`| \${f.severity} | \${f.agent} | \${f.file}:\${f.line} | \${f.title} |\`).join('\n')
            fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, \`## AI Review\n| Severity | Agent | Location | Issue |\n|---|---|---|---|\n\${rows||'| — | — | — | No findings |'}\n\`)
          "

      - name: Upload findings artifact
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: ai-review-findings
          path: findings.json
          if-no-files-found: ignore
```

- [ ] **Step 3: Verify TypeScript**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/adapters/github.ts .github/workflows/review.yml
git commit -m "feat: GitHub Actions adapter with PR comment upsert and Step Summary"
```

---

## Task 13: Claude Code Slash Command

**Files:**
- Create: `.claude/commands/ai-review.md`

- [ ] **Step 1: Write .claude/commands/ai-review.md**

```markdown
# /ai-review

Run a deep 9-agent code review on the current working diff using local Ollama (devstral:latest).

**When to use:**
- Before committing or opening a PR for thorough review
- Use `/code-review` instead for a quick Claude-native check mid-session

**Usage:**
```
/ai-review              # reviews staged changes
/ai-review --agents security,correctness   # run specific agents only
/ai-review --model qwen3:latest            # override model
```

## Instructions for Claude

Run the following in the project root:

```bash
ai-review --format markdown
```

If `ai-review` is not installed globally, run:

```bash
npx ai-review --format markdown
```

Stream the output directly into the conversation. If Ollama is not running, say so and suggest running `ollama serve`.

After displaying findings, ask: "Would you like me to address any of these findings?"
```

- [ ] **Step 2: Commit**

```bash
git add .claude/commands/ai-review.md
git commit -m "feat: /ai-review Claude Code slash command"
```

---

## Task 14: Calibration Suite

**Files:**
- Create: `calibration/fixtures/security.diff` (and 8 more)
- Create: `calibration/calibrate.ts`

- [ ] **Step 1: Write calibration/fixtures/security.diff**

```diff
diff --git a/src/auth/login.ts b/src/auth/login.ts
index 000000..111111 100644
--- a/src/auth/login.ts
+++ b/src/auth/login.ts
@@ -0,0 +1,20 @@
+import { db } from '../db'
+
+// REAL VULN: SQL injection via string interpolation
+export async function getUser(username: string) {
+  const result = await db.query(`SELECT * FROM users WHERE username = '${username}'`)
+  return result.rows[0]
+}
+
+// FALSE POSITIVE BAIT: looks like hardcoded secret but is a config key name
+const CONFIG_KEY = 'database_password_key'
+
+export async function hashPassword(password: string) {
+  const crypto = await import('crypto')
+  return crypto.createHash('md5').update(password).digest('hex')
+}
```

- [ ] **Step 2: Write calibration/fixtures/performance.diff**

```diff
diff --git a/src/users/service.ts b/src/users/service.ts
index 000000..111111 100644
--- a/src/users/service.ts
+++ b/src/users/service.ts
@@ -0,0 +1,18 @@
+import { db } from '../db'
+
+// REAL PERF ISSUE: N+1 query — loads posts for each user in a loop
+export async function getUsersWithPosts(userIds: string[]) {
+  const users = await db.query('SELECT * FROM users WHERE id = ANY($1)', [userIds])
+  for (const user of users.rows) {
+    user.posts = await db.query('SELECT * FROM posts WHERE user_id = $1', [user.id])
+  }
+  return users.rows
+}
+
+// FALSE POSITIVE BAIT: linear loop, not a perf issue
+export function sumArray(numbers: number[]): number {
+  let total = 0
+  for (const n of numbers) total += n
+  return total
+}
```

- [ ] **Step 3: Write calibration/fixtures/correctness.diff**

```diff
diff --git a/src/cart/calculator.ts b/src/cart/calculator.ts
index 000000..111111 100644
--- a/src/cart/calculator.ts
+++ b/src/cart/calculator.ts
@@ -0,0 +1,16 @@
+// REAL BUG: off-by-one — last item is excluded
+export function getLastNItems<T>(items: T[], n: number): T[] {
+  return items.slice(items.length - n - 1)
+}
+
+// FALSE POSITIVE BAIT: correct use of >= boundary
+export function isAdult(age: number): boolean {
+  return age >= 18
+}
```

- [ ] **Step 4: Write calibration/fixtures/coverage.diff**

```diff
diff --git a/src/payments/processor.ts b/src/payments/processor.ts
index 000000..111111 100644
--- a/src/payments/processor.ts
+++ b/src/payments/processor.ts
@@ -0,0 +1,18 @@
+// REAL GAP: new function with no test file in this diff
+export async function processRefund(orderId: string, amount: number): Promise<boolean> {
+  if (amount <= 0) throw new Error('Refund amount must be positive')
+  const order = await getOrder(orderId)
+  if (!order) return false
+  await issueRefund(order, amount)
+  return true
+}
+
+// FALSE POSITIVE BAIT: trivial getter that likely doesn't need a test
+export function getVersion(): string {
+  return '1.0.0'
+}
+
+async function getOrder(id: string) { return null as any }
+async function issueRefund(order: any, amount: number) {}
```

- [ ] **Step 5: Write remaining fixture diffs**

Create `calibration/fixtures/design.diff`:
```diff
diff --git a/src/reports/generator.ts b/src/reports/generator.ts
index 000000..111111 100644
--- a/src/reports/generator.ts
+++ b/src/reports/generator.ts
@@ -0,0 +1,20 @@
+import { db } from '../db'
+import { sendEmail } from '../email'
+import { generatePDF } from '../pdf'
+
+// REAL DESIGN ISSUE: god function mixing DB, PDF generation, and email in one place
+export async function generateAndSendReport(userId: string) {
+  const data = await db.query('SELECT * FROM reports WHERE user_id = $1', [userId])
+  const pdf = await generatePDF(data.rows)
+  const user = await db.query('SELECT email FROM users WHERE id = $1', [userId])
+  await sendEmail(user.rows[0].email, 'Your Report', pdf)
+  await db.query('UPDATE reports SET sent_at = NOW() WHERE user_id = $1', [userId])
+}
+
+// FALSE POSITIVE BAIT: appropriately small, single-purpose function
+export function formatCurrency(amount: number): string {
+  return `$${amount.toFixed(2)}`
+}
```

Create `calibration/fixtures/dependencies.diff`:
```diff
diff --git a/package.json b/package.json
index 000000..111111 100644
--- a/package.json
+++ b/package.json
@@ -1,5 +1,8 @@
 {
   "dependencies": {
-    "express": "^4.18.0"
+    "express": "^4.18.0",
+    "lodash": "*",
+    "color-thief": "^2.3.2"
   }
 }
```

Create `calibration/fixtures/adversarial.diff`:
```diff
diff --git a/src/api/handler.ts b/src/api/handler.ts
index 000000..111111 100644
--- a/src/api/handler.ts
+++ b/src/api/handler.ts
@@ -0,0 +1,14 @@
+// REAL: no guard against empty array — items[0] will throw
+export function getFirstItem<T>(items: T[]): T {
+  return items[0]
+}
+
+// FALSE POSITIVE BAIT: correctly handles empty string
+export function trimOrDefault(s: string | null | undefined): string {
+  return s?.trim() ?? ''
+}
```

Create `calibration/fixtures/integration.diff`:
```diff
diff --git a/src/webhooks/handler.ts b/src/webhooks/handler.ts
index 000000..111111 100644
--- a/src/webhooks/handler.ts
+++ b/src/webhooks/handler.ts
@@ -0,0 +1,14 @@
+import { fetch } from 'node-fetch'
+
+// REAL: new external HTTP call with no integration test
+export async function notifyWebhook(url: string, payload: object): Promise<void> {
+  const res = await fetch(url, {
+    method: 'POST',
+    headers: { 'Content-Type': 'application/json' },
+    body: JSON.stringify(payload)
+  })
+  if (!res.ok) throw new Error(`Webhook failed: ${res.status}`)
+}
+
+// FALSE POSITIVE BAIT: pure function, no integration needed
+export function buildPayload(event: string, data: object) { return { event, data, ts: Date.now() } }
```

Create `calibration/fixtures/testgen.diff` (same as coverage.diff — TestGen reads CoverageAnalyst output):
```diff
diff --git a/src/billing/invoice.ts b/src/billing/invoice.ts
index 000000..111111 100644
--- a/src/billing/invoice.ts
+++ b/src/billing/invoice.ts
@@ -0,0 +1,12 @@
+export function calculateTax(subtotal: number, taxRate: number): number {
+  if (taxRate < 0 || taxRate > 1) throw new RangeError('Tax rate must be between 0 and 1')
+  return Math.round(subtotal * taxRate * 100) / 100
+}
+
+export function applyDiscount(price: number, discountPercent: number): number {
+  if (discountPercent < 0 || discountPercent > 100) throw new RangeError('Discount must be 0-100')
+  return price * (1 - discountPercent / 100)
+}
```

- [ ] **Step 6: Write calibration/calibrate.ts**

```typescript
import { readFileSync } from 'fs'
import { OllamaProvider } from '../src/core/llm/ollamaProvider.js'
import { DEFAULT_CONFIG } from '../src/core/config.js'
import { SecurityAgent } from '../src/core/agents/security.js'
import { PerformanceAgent } from '../src/core/agents/performance.js'
import { CorrectnessAgent } from '../src/core/agents/correctness.js'
import { OrchestratorAgent } from '../src/core/agents/orchestrator.js'
import type { Finding } from '../src/core/schema.js'

interface CalibrationCase {
  name: string
  fixtureFile: string
  expectedKeyword: string   // word that should appear in a legitimate finding title
  baitKeyword: string       // word that should NOT appear in findings (false positive)
}

const CASES: CalibrationCase[] = [
  { name: 'Security', fixtureFile: 'calibration/fixtures/security.diff', expectedKeyword: 'injection', baitKeyword: 'CONFIG_KEY' },
  { name: 'Performance', fixtureFile: 'calibration/fixtures/performance.diff', expectedKeyword: 'N+1', baitKeyword: 'sumArray' },
  { name: 'Correctness', fixtureFile: 'calibration/fixtures/correctness.diff', expectedKeyword: 'off-by-one', baitKeyword: 'isAdult' }
]

async function main() {
  const provider = new OllamaProvider(DEFAULT_CONFIG.ollamaUrl, DEFAULT_CONFIG.model)
  const ping = await provider.ping()
  if (!ping.ok) {
    console.error(`❌ Ollama not available: ${ping.error}`)
    process.exit(1)
  }

  const orch = new OrchestratorAgent(provider, DEFAULT_CONFIG)
  let passed = 0
  let failed = 0

  for (const c of CASES) {
    process.stdout.write(`\nRunning calibration: ${c.name}...\n`)
    const diff = readFileSync(c.fixtureFile, 'utf-8')

    const agentMap: Record<string, { run: (input: { diff: string }) => Promise<Finding[]> }> = {
      Security: new SecurityAgent(provider, DEFAULT_CONFIG),
      Performance: new PerformanceAgent(provider, DEFAULT_CONFIG),
      Correctness: new CorrectnessAgent(provider, DEFAULT_CONFIG)
    }

    const rawFindings = await agentMap[c.name].run({ diff })
    const findings = orch.synthesize(rawFindings)

    const hasLegitimate = findings.some(f =>
      f.title.toLowerCase().includes(c.expectedKeyword.toLowerCase()) ||
      f.detail.toLowerCase().includes(c.expectedKeyword.toLowerCase())
    )
    const hasBait = findings.some(f =>
      f.title.includes(c.baitKeyword) || f.detail.includes(c.baitKeyword)
    )

    if (hasLegitimate && !hasBait) {
      console.log(`  ✅ PASS — found legitimate issue, rejected false positive`)
      passed++
    } else {
      if (!hasLegitimate) console.log(`  ❌ FAIL — missed legitimate ${c.expectedKeyword} finding`)
      if (hasBait) console.log(`  ❌ FAIL — false positive not filtered (${c.baitKeyword})`)
      failed++
    }
  }

  console.log(`\nCalibration: ${passed} passed, ${failed} failed`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch(err => { console.error(err); process.exit(1) })
```

- [ ] **Step 7: Commit**

```bash
git add calibration/
git commit -m "feat: calibration suite — per-agent fixtures with real findings and false-positive baits"
```

---

## Task 15: Integration Test

**Files:**
- Create: `tests/integration/e2e.test.ts`

- [ ] **Step 1: Write tests/integration/e2e.test.ts**

```typescript
// Requires Ollama running with devstral:latest
// Run with: npm run test:integration
import { describe, it, expect, beforeAll } from 'vitest'
import { SwarmRunner } from '../../src/core/runner.js'
import { DEFAULT_CONFIG } from '../../src/core/config.js'
import { OllamaProvider } from '../../src/core/llm/ollamaProvider.js'
import { readFileSync } from 'fs'

describe('SwarmRunner e2e (requires Ollama)', () => {
  let provider: OllamaProvider

  beforeAll(async () => {
    provider = new OllamaProvider(DEFAULT_CONFIG.ollamaUrl, DEFAULT_CONFIG.model)
    const ping = await provider.ping()
    if (!ping.ok) {
      throw new Error(`Ollama not available: ${ping.error}. Run: ollama serve`)
    }
  })

  it('produces findings from a real diff with known vulnerability', async () => {
    const diff = readFileSync('calibration/fixtures/security.diff', 'utf-8')
    const config = { ...DEFAULT_CONFIG, agents: ['security' as const], maxFindings: 15 }
    const runner = new SwarmRunner(config, provider)

    const result = await runner.run({ diff })

    expect(result.findings.length).toBeGreaterThan(0)
    const hasSQLFinding = result.findings.some(f =>
      f.detail.toLowerCase().includes('injection') ||
      f.title.toLowerCase().includes('injection') ||
      f.detail.toLowerCase().includes('sql')
    )
    expect(hasSQLFinding).toBe(true)
    expect(result.summary.durationMs).toBeGreaterThan(0)
  }, 120_000) // 2 min timeout for LLM call
})
```

- [ ] **Step 2: Commit**

```bash
git add tests/integration/e2e.test.ts
git commit -m "test: integration e2e test against real Ollama (security fixture)"
```

---

## Task 16: Final Wiring + Spec Doc Commit

**Files:**
- Verify: `src/core/` barrel exports work end-to-end
- Copy spec to: `docs/superpowers/specs/2026-06-04-ai-code-review-agent-design.md` (already created)

- [ ] **Step 1: Run all unit tests**

```bash
npm test
```

Expected: all passing, no errors.

- [ ] **Step 2: Build dist**

```bash
npm run build
```

Expected: `dist/` populated, no TypeScript errors.

- [ ] **Step 3: Smoke-test the CLI against security fixture**

```bash
node dist/cli/index.js --diff calibration/fixtures/security.diff --agents security --format markdown
```

Expected: outputs markdown report with at least one security finding. Exit code 1 (due to high/critical finding).

- [ ] **Step 4: Run typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 5: Final commit**

```bash
git add docs/
git commit -m "docs: spec doc and implementation plan"
git add -A
git commit -m "feat: complete ai-review agent v0.1.0 — 9 specialists + orchestrator + CLI + GitHub Actions + Claude Code skill"
```

---

## Verification Checklist

```bash
npm test                   # unit tests — all passing, no Ollama needed
npm run typecheck          # TypeScript — no errors
npm run build              # dist/ built successfully
node dist/cli/index.js --help   # CLI responds
npm run calibrate          # calibration — requires Ollama
npm run test:integration   # e2e — requires Ollama
```

---

## Key Reuse Notes

| Source file | Reuse target | What to port |
|---|---|---|
| `Google-Organizer/src/workers/ollamaClient.ts` | `src/core/llm/ollamaProvider.ts` | `pingOllama`, fetch pattern, think-tag strip, multi-stage parse |
| `ai-code-review-agent` branch `review-agent.js` | `src/adapters/github.ts` | Comment upsert PATCH pattern, Step Summary table |
| PMB `standards/CODE-REVIEW.md` | `src/core/schema.ts` | `Basis` values (VERIFIED/INFERRED/SPECULATIVE) |
