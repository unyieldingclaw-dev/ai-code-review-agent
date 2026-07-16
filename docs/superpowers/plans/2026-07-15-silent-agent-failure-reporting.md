# Silent Agent Failure Reporting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a run where agents time out or fail to produce parseable output clearly
distinguishable from a genuinely clean review — both currently render as identical
`0 findings | ✅ No issues found`.

**Architecture:** `parseFindings` (base.ts) and `parseCoverageResult` (coverageAnalyst.ts) throw a
new `ParseFailureError` instead of silently returning `[]` on total parse failure. This error
propagates through the existing exception path (`agent.run()` → `withRetryTimeout` → the 4
catch blocks already in `runner.ts`), which now classify the caught error into an `AgentStatus`
(`'ok' | 'timeout' | 'parse-error' | 'error'`) and record it into a shared `agentStatus` map
mutated throughout `SwarmRunner.run()`. The map lands on `ReviewResult.agentStatus`, which all 4
formatters and `exitCode.ts` can read — JSON gets it for free (whole-object serialization);
markdown, SARIF, and github-annotations get small additive changes.

**Tech Stack:** No new dependencies. Pure TypeScript changes to existing files, Vitest for tests,
following this repo's existing `vi.mock`/mocked-provider conventions.

---

## Task 1: `AgentStatus` type, `ParseFailureError`, and `ReviewResult.agentStatus`

**Files:**

- Modify: `src/core/schema.ts`
- Modify: `src/core/parsing.ts`
- Test: `tests/unit/parsing.test.ts` (new file)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/parsing.test.ts`:

```ts
// tests/unit/parsing.test.ts
import { describe, it, expect } from 'vitest'
import { ParseFailureError } from '../../src/core/parsing.js'

describe('ParseFailureError', () => {
  it('is an Error subclass carrying the agent name and a raw-output snippet', () => {
    const err = new ParseFailureError('security', 'not json at all, just prose from the model')
    expect(err).toBeInstanceOf(Error)
    expect(err.agentName).toBe('security')
    expect(err.message).toContain('security')
    expect(err.message).toContain('not json at all')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/parsing.test.ts`
Expected: FAIL — `ParseFailureError` is not exported yet.

- [ ] **Step 3: Add `AgentStatus` and `agentStatus` to `schema.ts`**

Open `src/core/schema.ts`. Find the `ReviewResult` interface (currently starts around line 115):

```typescript
export interface ReviewResult {
  schemaVersion?: 'ai-review-agent/v1'
  toolVersion?: string
  profile?: string | null
  findings: Finding[]
  testFiles: GeneratedTestFile[]
  summary: ReviewSummary
  earlyExit?: { stoppedAt: AgentName }
  context?: {
    mode: 'none' | 'memory-bank'
    filesLoaded: string[]
    truncated: boolean
    estimatedTokens: number
  }
  sanitizer?: SanitizerMetadata
  policy?: PolicyResult
}
```

Add `AgentStatus` immediately above it, and add the `agentStatus` field inside it:

```typescript
export type AgentStatus = 'ok' | 'timeout' | 'parse-error' | 'error'

export interface ReviewResult {
  schemaVersion?: 'ai-review-agent/v1'
  toolVersion?: string
  profile?: string | null
  findings: Finding[]
  testFiles: GeneratedTestFile[]
  summary: ReviewSummary
  earlyExit?: { stoppedAt: AgentName }
  context?: {
    mode: 'none' | 'memory-bank'
    filesLoaded: string[]
    truncated: boolean
    estimatedTokens: number
  }
  sanitizer?: SanitizerMetadata
  policy?: PolicyResult
  agentStatus?: Partial<Record<AgentName | 'coverage' | 'testgen', AgentStatus>>
}
```

- [ ] **Step 4: Add `ParseFailureError` to `parsing.ts`**

Open `src/core/parsing.ts`. At the top, after the existing imports, add:

```typescript
export class ParseFailureError extends Error {
  constructor(
    public readonly agentName: string,
    rawSnippet: string
  ) {
    super(`[${agentName}] failed to parse a usable response: ${rawSnippet.slice(0, 200)}`)
    this.name = 'ParseFailureError'
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/unit/parsing.test.ts`
Expected: PASS.

- [ ] **Step 6: Run typecheck and full suite**

```bash
npm run typecheck
npm test -- --run
```

Expected: typecheck clean; full suite still passes (this task only adds new exports, doesn't
change existing behavior yet).

- [ ] **Step 7: Format and commit**

```bash
npx prettier --write src/core/schema.ts src/core/parsing.ts tests/unit/parsing.test.ts
git add src/core/schema.ts src/core/parsing.ts tests/unit/parsing.test.ts
git commit -m "feat: add AgentStatus type and ParseFailureError"
```

---

## Task 2: Throw `ParseFailureError` instead of silently returning `[]`

**Files:**

- Modify: `src/core/agents/base.ts`
- Modify: `src/core/agents/coverageAnalyst.ts`

- [ ] **Step 1: Update `base.ts`'s `parseFindings` final fallback**

Open `src/core/agents/base.ts`. Add the import at the top:

```typescript
import { validateAndNormalizeFindings, ParseFailureError } from '../parsing.js'
```

(This import already exists as `import { validateAndNormalizeFindings } from '../parsing.js'` —
just add `ParseFailureError` to the same import.)

Find the final fallback in `parseFindings` (near the end of the method):

```typescript
    console.error(`[${this.name}] parse failure. Raw snippet: ${raw.slice(0, 200)}`)
    return []
  }
```

Replace with:

```typescript
    console.error(`[${this.name}] parse failure. Raw snippet: ${raw.slice(0, 200)}`)
    throw new ParseFailureError(this.name, raw)
  }
```

- [ ] **Step 2: Update `coverageAnalyst.ts`'s `parseCoverageResult` final fallback**

Open `src/core/agents/coverageAnalyst.ts`. Add the import at the top:

```typescript
import { ParseFailureError } from '../parsing.js'
```

Find the final fallback in `parseCoverageResult`:

```typescript
    console.error(`[coverage] parse failure. Raw snippet: ${raw.slice(0, 200)}`)
    return { findings: [], gaps: [] }
  }
```

Replace with:

```typescript
    console.error(`[coverage] parse failure. Raw snippet: ${raw.slice(0, 200)}`)
    throw new ParseFailureError('coverage', raw)
  }
```

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```

Expected: clean (no signature changes, just a throw instead of a return).

- [ ] **Step 4: Run the full suite — expect failures**

```bash
npm test -- --run
```

Expected: the 15 existing "returns empty array on parse failure" tests across the agent test
files now FAIL, because `run()`/`runForCoverage()` reject instead of resolving to `[]`. This is
expected — Task 3 fixes them. Do not fix them in this task; keep this task's diff minimal and
focused on the production code change.

- [ ] **Step 5: Format and commit**

```bash
npx prettier --write src/core/agents/base.ts src/core/agents/coverageAnalyst.ts
git add src/core/agents/base.ts src/core/agents/coverageAnalyst.ts
git commit -m "feat: throw ParseFailureError instead of silently returning empty findings"
```

Note: this commit intentionally leaves the test suite red. Task 3 fixes it in the same PR before
landing — this split keeps each commit's diff focused and reviewable.

---

## Task 3: Update the 15 existing parse-failure tests + add a coverage-specific one

**Files:**

- Modify: `tests/unit/adversarialAgent.test.ts`
- Modify: `tests/unit/baseAgent.test.ts`
- Modify: `tests/unit/breakingChangeAgent.test.ts`
- Modify: `tests/unit/complexityAgent.test.ts`
- Modify: `tests/unit/correctnessAgent.test.ts`
- Modify: `tests/unit/coverageAnalystAgent.test.ts`
- Modify: `tests/unit/dependenciesAgent.test.ts`
- Modify: `tests/unit/designAgent.test.ts`
- Modify: `tests/unit/errorHandlingAgent.test.ts`
- Modify: `tests/unit/integrationScoutAgent.test.ts`
- Modify: `tests/unit/licenseComplianceAgent.test.ts`
- Modify: `tests/unit/migrationSafetyAgent.test.ts`
- Modify: `tests/unit/observabilityAgent.test.ts`
- Modify: `tests/unit/performanceAgent.test.ts`
- Modify: `tests/unit/securityAgent.test.ts`

Every one of these 15 files has an identical-shape test named `'returns empty array on parse
failure'`. Two exact shapes appear across the files — check which one a given file uses before
editing:

**Shape A** (most files, e.g. `securityAgent.test.ts`):

```typescript
  it('returns empty array on parse failure', async () => {
    expect(
      await new SecurityAgent(makeProvider('not json'), DEFAULT_CONFIG).run({ diff: 'diff' })
    ).toEqual([])
  })
```

Replace with (adjust the class name and provider content per file — keep everything else
identical):

```typescript
  it('throws ParseFailureError on parse failure', async () => {
    await expect(
      new SecurityAgent(makeProvider('not json'), DEFAULT_CONFIG).run({ diff: 'diff' })
    ).rejects.toThrow(ParseFailureError)
  })
```

**Shape B** (`baseAgent.test.ts`):

```typescript
  it('returns empty array on parse failure', async () => {
    const agent = new TestAgent(makeProvider('not json at all'), DEFAULT_CONFIG)
    const findings = await agent.run({ diff: 'diff' })
    expect(findings).toEqual([])
  })
```

Replace with:

```typescript
  it('throws ParseFailureError on parse failure', async () => {
    const agent = new TestAgent(makeProvider('not json at all'), DEFAULT_CONFIG)
    await expect(agent.run({ diff: 'diff' })).rejects.toThrow(ParseFailureError)
  })
```

- [ ] **Step 1: Add the `ParseFailureError` import to each of the 15 files**

Each file needs `import { ParseFailureError } from '../../src/core/parsing.js'` added to its
import block (match the existing relative-path depth/style already used for other imports in
that same file — all these test files live directly in `tests/unit/`, so the path is
`../../src/core/parsing.js` in every case).

- [ ] **Step 2: Update each file's test per the shape it uses**

Apply the Shape A or Shape B replacement above to all 15 files, substituting the correct
agent class name and mock content already present in each file's existing test (don't change
the provider mock content — e.g. `'not json'` vs `'not json at all'` vs `'[invalid]'` — only the
assertion changes).

- [ ] **Step 3: Add a dedicated `runForCoverage` parse-failure test to `coverageAnalystAgent.test.ts`**

The existing (now-updated) `'returns empty array on parse failure'` test in this file calls
`.run(...)`, which only exercises the *inherited* `BaseAgent.parseFindings` path — it never
exercises `coverageAnalyst.ts`'s own `parseCoverageResult` fallback, which has never had a
dedicated test. Add a new test alongside it:

```typescript
  it('runForCoverage throws ParseFailureError on parse failure', async () => {
    await expect(
      new CoverageAnalystAgent(makeProvider('not json at all'), DEFAULT_CONFIG).runForCoverage({
        diff: 'diff',
      })
    ).rejects.toThrow(ParseFailureError)
  })
```

- [ ] **Step 4: Run the full suite**

```bash
npm test -- --run
```

Expected: all tests pass again (297 + 1 new coverage test + 1 new parsing.test.ts test — check
exact count in output, don't hardcode an assumption).

- [ ] **Step 5: Run typecheck**

```bash
npm run typecheck
```

Expected: clean.

- [ ] **Step 6: Format and commit**

```bash
npx prettier --write tests/unit/adversarialAgent.test.ts tests/unit/baseAgent.test.ts tests/unit/breakingChangeAgent.test.ts tests/unit/complexityAgent.test.ts tests/unit/correctnessAgent.test.ts tests/unit/coverageAnalystAgent.test.ts tests/unit/dependenciesAgent.test.ts tests/unit/designAgent.test.ts tests/unit/errorHandlingAgent.test.ts tests/unit/integrationScoutAgent.test.ts tests/unit/licenseComplianceAgent.test.ts tests/unit/migrationSafetyAgent.test.ts tests/unit/observabilityAgent.test.ts tests/unit/performanceAgent.test.ts tests/unit/securityAgent.test.ts

git add tests/unit/adversarialAgent.test.ts tests/unit/baseAgent.test.ts tests/unit/breakingChangeAgent.test.ts tests/unit/complexityAgent.test.ts tests/unit/correctnessAgent.test.ts tests/unit/coverageAnalystAgent.test.ts tests/unit/dependenciesAgent.test.ts tests/unit/designAgent.test.ts tests/unit/errorHandlingAgent.test.ts tests/unit/integrationScoutAgent.test.ts tests/unit/licenseComplianceAgent.test.ts tests/unit/migrationSafetyAgent.test.ts tests/unit/observabilityAgent.test.ts tests/unit/performanceAgent.test.ts tests/unit/securityAgent.test.ts

git commit -m "test: update parse-failure tests for ParseFailureError, add coverage-specific case"
```

---

## Task 4: Classify errors and collect `agentStatus` in `runner.ts`

**Files:**

- Modify: `src/core/parsing.ts`
- Modify: `src/core/runner.ts`
- Test: `tests/unit/runner.test.ts`

- [ ] **Step 1: Write the failing tests**

Open `tests/unit/runner.test.ts`. Add these tests near the other `SwarmRunner` tests (adapt to
match the file's existing `makeProvider`/`DEFAULT_CONFIG` helper conventions already used
elsewhere in the file):

```typescript
  it('records agentStatus "ok" for agents that succeed', async () => {
    const provider = makeProvider() // existing helper returning valid empty findings JSON
    const config = { ...DEFAULT_CONFIG, agents: ['security'] as AgentName[] }
    const runner = new SwarmRunner(config, provider)
    const result = await runner.run({ diff: 'diff' })
    expect(result.agentStatus?.security).toBe('ok')
  })

  it('records agentStatus "timeout" when an agent times out', async () => {
    const provider: LLMProvider = {
      chat: vi.fn().mockImplementation(() => new Promise(() => {})), // never resolves
      ping: vi.fn().mockResolvedValue({ ok: true }),
    }
    const config = {
      ...DEFAULT_CONFIG,
      agents: ['security'] as AgentName[],
      agentTimeoutMs: 20,
      retryAttempts: 1,
      retryDelayMs: 0,
    }
    const runner = new SwarmRunner(config, provider)
    const result = await runner.run({ diff: 'diff' })
    expect(result.agentStatus?.security).toBe('timeout')
  })

  it('records agentStatus "parse-error" when an agent returns unparseable output', async () => {
    const provider: LLMProvider = {
      chat: vi.fn().mockResolvedValue('not json at all, just prose from the model'),
      ping: vi.fn().mockResolvedValue({ ok: true }),
    }
    const config = {
      ...DEFAULT_CONFIG,
      agents: ['security'] as AgentName[],
      retryAttempts: 1,
      retryDelayMs: 0,
    }
    const runner = new SwarmRunner(config, provider)
    const result = await runner.run({ diff: 'diff' })
    expect(result.agentStatus?.security).toBe('parse-error')
  })

  it('records agentStatus for coverage and testgen', async () => {
    const provider: LLMProvider = {
      chat: vi.fn().mockResolvedValue('{"findings":[],"gaps":[]}'),
      ping: vi.fn().mockResolvedValue({ ok: true }),
    }
    const config = {
      ...DEFAULT_CONFIG,
      agents: ['coverage'] as AgentName[],
      retryAttempts: 1,
      retryDelayMs: 0,
    }
    const runner = new SwarmRunner(config, provider)
    const result = await runner.run({ diff: 'diff' })
    expect(result.agentStatus?.coverage).toBe('ok')
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/runner.test.ts`
Expected: FAIL — `result.agentStatus` is `undefined`.

- [ ] **Step 3: Add `classifyAgentError` to `parsing.ts`**

Open `src/core/parsing.ts`. After the `ParseFailureError` class added in Task 1, add:

```typescript
import type { AgentStatus } from './schema.js'

export function classifyAgentError(err: unknown): AgentStatus {
  if (err instanceof ParseFailureError) return 'parse-error'
  if (err instanceof Error && err.message.includes('timed out')) return 'timeout'
  return 'error'
}
```

(Note: `AgentStatus` needs to be imported as a type here — add it to the top of the file
alongside the existing `import type { Finding, AgentName, ReviewDomain } from './schema.js'`,
or as a separate `import type { AgentStatus } from './schema.js'` line if that's cleaner given
the file's existing import style.)

- [ ] **Step 4: Wire `agentStatus` collection through `runner.ts`**

Open `src/core/runner.ts`. Add to the imports:

```typescript
import { classifyAgentError } from './parsing.js'
import type { AgentStatus } from './schema.js'
```

In `runAgentsSequential`, change the signature to accept the shared status map, and populate it:

```typescript
  private async runAgentsSequential(
    agents: BaseAgent[],
    ctx: (name: AgentName) => Promise<ReviewInput>,
    baseIndex: number,
    total: number,
    agentStatus: Partial<Record<AgentName | 'coverage' | 'testgen', AgentStatus>>,
    onProgress?: (e: AgentProgressEvent) => void
  ): Promise<{ findings: Finding[]; earlyExitAgent?: AgentName }> {
```

Inside the loop's try block, right after `findings.push(...agentFindings)`, add:

```typescript
        agentStatus[agent.name] = 'ok'
```

In the catch block, replace:

```typescript
      } catch (err) {
        console.warn(
          `[ai-review] Agent ${agent.name} timed out or failed: ${(err as Error).message}`
        )
```

with:

```typescript
      } catch (err) {
        agentStatus[agent.name] = classifyAgentError(err)
        console.warn(
          `[ai-review] Agent ${agent.name} timed out or failed: ${(err as Error).message}`
        )
```

Apply the identical pattern to `runAgentsParallel` (same signature addition, same `'ok'` write
on success inside the `Promise.allSettled` mapper, same `classifyAgentError` call in its catch
block).

Apply the identical pattern to `runCoverageAgent`: add the `agentStatus` parameter to its
signature, write `agentStatus.coverage = 'ok'` on the success path (right before its `return`),
and `agentStatus.coverage = classifyAgentError(err)` in its catch block.

In the main `run()` method, declare the shared map near the other accumulator variables
(`allFindings`, `coverageGaps`, `testFiles`):

```typescript
    const agentStatus: Partial<Record<AgentName | 'coverage' | 'testgen', AgentStatus>> = {}
```

Pass `agentStatus` as an argument at each of the three call sites (`runCoverageAgent`,
`runAgentsParallel`, `runAgentsSequential`) — add it to the existing argument lists in the same
position pattern already used for `onProgress` (i.e., as an additional positional argument
before `onProgress`).

In the TestGen block, right after `testFiles = testResult.testFiles`, add:

```typescript
          agentStatus.testgen = 'ok'
```

And in its catch block, replace:

```typescript
        } catch (err) {
          console.warn(`[ai-review] Agent testgen timed out or failed: ${(err as Error).message}`)
        }
```

with:

```typescript
        } catch (err) {
          agentStatus.testgen = classifyAgentError(err)
          console.warn(`[ai-review] Agent testgen timed out or failed: ${(err as Error).message}`)
        }
```

Finally, in the `return { ... }` at the end of `run()`, add:

```typescript
      ...(Object.keys(agentStatus).length > 0 ? { agentStatus } : {}),
```

(matching the existing conditional-spread style already used for `earlyExit`, `context`,
and `policy` in the same return statement).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/runner.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the full suite and typecheck**

```bash
npm test -- --run
npm run typecheck
```

Expected: all green.

- [ ] **Step 7: Format and commit**

```bash
npx prettier --write src/core/parsing.ts src/core/runner.ts tests/unit/runner.test.ts
git add src/core/parsing.ts src/core/runner.ts tests/unit/runner.test.ts
git commit -m "feat: classify and record agentStatus for every agent in SwarmRunner"
```

---

## Task 5: Surface `agentStatus` in the formatters

**Files:**

- Modify: `src/cli/formatter.ts`
- Modify: `src/cli/formatters/sarif.ts`
- Modify: `src/cli/formatters/githubAnnotations.ts`
- Test: `tests/unit/formatters/markdown.test.ts`
- Test: `tests/unit/formatters/sarif.test.ts`
- Test: `tests/unit/formatters/githubAnnotations.test.ts`

Confirmed: all three test files already exist (one per formatter, not a single combined file),
each with an identical local `makeResult(overrides: Partial<ReviewResult> = {})` helper
(`findings: []`, `testFiles: []`, `summary: {...}`, spread overrides) — use it as-is, don't
invent a new one.

- [ ] **Step 1: Write the failing tests**

In `tests/unit/formatters/markdown.test.ts`, add:

```typescript
  it('shows an agent-failure warning instead of a clean checkmark when agentStatus has failures', () => {
    const result = makeResult({
      findings: [],
      agentStatus: { security: 'timeout', correctness: 'ok', performance: 'parse-error' },
    })
    const output = formatMarkdown(result)
    expect(output).toContain('agents failed')
    expect(output).not.toContain('No issues found')
    expect(output).toContain('security')
    expect(output).toContain('timeout')
    expect(output).toContain('performance')
    expect(output).toContain('parse-error')
  })

  it('still shows the clean checkmark when agentStatus is all ok', () => {
    const result = makeResult({
      findings: [],
      agentStatus: { security: 'ok', correctness: 'ok' },
    })
    const output = formatMarkdown(result)
    expect(output).toContain('No issues found')
  })
```

In `tests/unit/formatters/sarif.test.ts`, add:

```typescript
  it('includes agentStatus in run-level properties when present', () => {
    const result = makeResult({ agentStatus: { security: 'timeout' } })
    const sarif = JSON.parse(formatSarif(result))
    expect(sarif.runs[0].properties.agentStatus).toEqual({ security: 'timeout' })
  })
```

In `tests/unit/formatters/githubAnnotations.test.ts`, add:

```typescript
  it('emits a warning annotation when any agent failed, even with zero findings', () => {
    const result = makeResult({ findings: [], agentStatus: { security: 'timeout' } })
    const output = formatGithubAnnotations(result)
    expect(output).toContain('::warning')
    expect(output).toContain('security')
  })

  it('emits nothing when there are no findings and no agent failures', () => {
    const result = makeResult({ findings: [], agentStatus: { security: 'ok' } })
    expect(formatGithubAnnotations(result)).toBe('')
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run tests/unit/formatters/
```

Expected: FAIL (markdown and sarif and githubAnnotations tests all fail — `agentStatus` isn't
read by any formatter yet).

- [ ] **Step 3: Update `formatter.ts`'s markdown formatter**

Open `src/cli/formatter.ts`. Find:

```typescript
  const { findings, testFiles, summary } = result
  const lines: string[] = []

  lines.push('# AI Code Review Report')
  lines.push('')
  lines.push(
    `**${summary.totalFindings} finding${summary.totalFindings === 1 ? '' : 's'}** | ${summary.durationMs}ms`
  )
  lines.push('')

  if (findings.length === 0) {
    lines.push(useEmoji ? '✅ No issues found.' : 'No issues found.')
    return lines.join('\n')
  }
```

Replace with:

```typescript
  const { findings, testFiles, summary, agentStatus } = result
  const lines: string[] = []

  const failedAgents = Object.entries(agentStatus ?? {}).filter(([, status]) => status !== 'ok')
  const totalAgents = Object.keys(agentStatus ?? {}).length

  lines.push('# AI Code Review Report')
  lines.push('')
  lines.push(
    `**${summary.totalFindings} finding${summary.totalFindings === 1 ? '' : 's'}** | ${summary.durationMs}ms`
  )
  lines.push('')

  if (failedAgents.length > 0) {
    lines.push(
      `${useEmoji ? '⚠️ ' : ''}${failedAgents.length}/${totalAgents} agents failed — results incomplete`
    )
    lines.push('')
    for (const [name, status] of failedAgents) {
      const advice =
        status === 'timeout'
          ? 'raise --timeout or reduce --max-lines'
          : status === 'parse-error'
            ? 'diff likely too large for this model'
            : 'see stderr for details'
      lines.push(`- \`${name}\`: ${status} — ${advice}`)
    }
    lines.push('')
  }

  if (findings.length === 0) {
    if (failedAgents.length === 0) {
      lines.push(useEmoji ? '✅ No issues found.' : 'No issues found.')
    }
    return lines.join('\n')
  }
```

- [ ] **Step 4: Update `sarif.ts`**

Open `src/cli/formatters/sarif.ts`. Find:

```typescript
        // Add run-level properties for context and policy metadata
        properties: {
          ...(result.context ? { context: result.context } : {}),
          ...(result.policy && result.policy.agentsSkipped.length > 0
            ? { policy: result.policy }
            : {}),
        },
```

Replace with:

```typescript
        // Add run-level properties for context, policy, and agent-status metadata
        properties: {
          ...(result.context ? { context: result.context } : {}),
          ...(result.policy && result.policy.agentsSkipped.length > 0
            ? { policy: result.policy }
            : {}),
          ...(result.agentStatus ? { agentStatus: result.agentStatus } : {}),
        },
```

- [ ] **Step 5: Update `githubAnnotations.ts`**

Open `src/cli/formatters/githubAnnotations.ts`. Find:

```typescript
export function formatGithubAnnotations(result: ReviewResult): string {
  if (result.findings.length === 0) return ''
  return result.findings.map(findingToAnnotation).join('\n')
}
```

Replace with:

```typescript
export function formatGithubAnnotations(result: ReviewResult): string {
  const failedAgents = Object.entries(result.agentStatus ?? {}).filter(
    ([, status]) => status !== 'ok'
  )
  const warningLines = failedAgents.map(
    ([name, status]) =>
      `::warning::Agent ${name} failed (${status}) — results may be incomplete`
  )
  const findingLines = result.findings.map(findingToAnnotation)
  return [...warningLines, ...findingLines].join('\n')
}
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
npx vitest run tests/unit/formatters/
```

Expected: PASS.

- [ ] **Step 7: Run the full suite and typecheck**

```bash
npm test -- --run
npm run typecheck
```

Expected: all green. Pay attention to whether any *existing* formatter tests broke — e.g. a
test asserting `formatMarkdown` output for a clean run with no `agentStatus` field at all should
still show the checkmark (since `agentStatus` is optional and `failedAgents.length` would be 0
when `agentStatus` is `undefined`).

- [ ] **Step 8: Format and commit**

```bash
npx prettier --write src/cli/formatter.ts src/cli/formatters/sarif.ts src/cli/formatters/githubAnnotations.ts tests/unit/formatters/markdown.test.ts tests/unit/formatters/sarif.test.ts tests/unit/formatters/githubAnnotations.test.ts
git add src/cli/formatter.ts src/cli/formatters/sarif.ts src/cli/formatters/githubAnnotations.ts tests/unit/formatters/markdown.test.ts tests/unit/formatters/sarif.test.ts tests/unit/formatters/githubAnnotations.test.ts
git commit -m "feat: surface agentStatus in markdown, SARIF, and github-annotations formatters"
```

---

## Task 6: Exit code 2 on agent failure

**Files:**

- Modify: `src/cli/exitCode.ts`
- Modify: `src/cli/index.ts`
- Test: `tests/unit/exitCode.test.ts`
- Test: `tests/unit/cli.test.ts`

- [ ] **Step 1: Write the failing tests**

Open `tests/unit/exitCode.test.ts`. Add:

```typescript
import { hasAgentFailures, AGENT_FAILURE_EXIT_CODE } from '../../src/cli/exitCode.js'

describe('hasAgentFailures', () => {
  it('returns false when agentStatus is undefined', () => {
    expect(hasAgentFailures(undefined)).toBe(false)
  })

  it('returns false when every agent status is ok', () => {
    expect(hasAgentFailures({ security: 'ok', correctness: 'ok' })).toBe(false)
  })

  it('returns true when any agent status is not ok', () => {
    expect(hasAgentFailures({ security: 'ok', correctness: 'timeout' })).toBe(true)
  })
})

describe('AGENT_FAILURE_EXIT_CODE', () => {
  it('is distinct from the severity-gate exit code (1) and the clean exit code (0)', () => {
    expect(AGENT_FAILURE_EXIT_CODE).toBe(2)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run tests/unit/exitCode.test.ts
```

Expected: FAIL — neither export exists yet.

- [ ] **Step 3: Add to `exitCode.ts`**

Open `src/cli/exitCode.ts`. Add the import and the two new exports:

```typescript
import type { AgentStatus } from '../core/schema.js'

export const AGENT_FAILURE_EXIT_CODE = 2

export function hasAgentFailures(
  agentStatus: Partial<Record<string, AgentStatus>> | undefined
): boolean {
  if (!agentStatus) return false
  return Object.values(agentStatus).some((status) => status !== 'ok')
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run tests/unit/exitCode.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write the failing CLI-level test**

Open `tests/unit/cli.test.ts`. Add a test near the other exit-code-related tests (find them by
searching the file for `process.exit`):

```typescript
  it('exits 2 when any agent failed, even if remaining findings would pass --fail-on', async () => {
    MockSwarmRunner.mockImplementation(() => ({
      run: vi.fn().mockResolvedValue(
        makeResult({
          findings: [],
          agentStatus: { security: 'timeout' },
        })
      ),
    }))
    const { exitCode } = await runCli(['review', '--fail-on', 'never'])
    expect(exitCode).toBe(2)
  })

  it('exits 2 (not 1) when agents failed AND findings would also trip --fail-on', async () => {
    MockSwarmRunner.mockImplementation(() => ({
      run: vi.fn().mockResolvedValue(
        makeResult({
          findings: [
            {
              id: 'f-0',
              agent: 'security',
              severity: 'critical',
              basis: 'VERIFIED',
              file: 'a.ts',
              line: 1,
              title: 'T',
              detail: 'D',
              domain: 'Security',
              evidence: 'E',
              impact: 'I',
              recommendation: 'R',
              suggestion: 'S',
              blocking: true,
              source: 'llm',
              confidence: 90,
            },
          ],
          agentStatus: { security: 'ok', correctness: 'timeout' },
        })
      ),
    }))
    const { exitCode } = await runCli(['review', '--fail-on', 'high'])
    expect(exitCode).toBe(2)
  })

  it('exits 0 when all agents succeed and no findings trip --fail-on', async () => {
    MockSwarmRunner.mockImplementation(() => ({
      run: vi.fn().mockResolvedValue(
        makeResult({ findings: [], agentStatus: { security: 'ok' } })
      ),
    }))
    const { exitCode } = await runCli(['review', '--fail-on', 'high'])
    expect(exitCode).toBe(0)
  })
```

Confirmed: `runCli(args: string[]): Promise<{ exitCode, stdout, stderr }>`, `MockSwarmRunner`,
and `makeResult` above match this file's actual existing helpers exactly. Note: one *pre-existing*
test elsewhere in this file (`'exits 0 for a high finding when --fail-on critical'`) uses
`agentName`/`description` field names on its `Finding` object, which don't match the real
`Finding` interface (`agent`/`detail` — see `src/core/schema.ts:53-74`). That's a pre-existing
inconsistency in this test file, out of scope to fix here — use the correct `agent`/`detail`
shape shown above for the new tests, not the older test's shape.

- [ ] **Step 6: Run the tests to verify they fail**

```bash
npx vitest run tests/unit/cli.test.ts
```

Expected: FAIL — exit code logic doesn't check `agentStatus` yet.

- [ ] **Step 7: Wire it into `cli/index.ts`**

Open `src/cli/index.ts`. Add to the imports:

```typescript
import { hasAgentFailures, AGENT_FAILURE_EXIT_CODE } from './exitCode.js'
```

(This can be combined into the existing `import { shouldFail, FAIL_ON_OPTIONS } from
'./exitCode.js'` line — add the two new names to that same import.)

Find:

```typescript
        const hasBlocker = result.findings.some((f) => shouldFail(f.severity, options.failOn))
        process.exit(hasBlocker ? 1 : 0)
```

Replace with:

```typescript
        const hasBlocker = result.findings.some((f) => shouldFail(f.severity, options.failOn))
        if (hasAgentFailures(result.agentStatus)) {
          process.exit(AGENT_FAILURE_EXIT_CODE)
        }
        process.exit(hasBlocker ? 1 : 0)
```

- [ ] **Step 8: Run the tests to verify they pass**

```bash
npx vitest run tests/unit/cli.test.ts
```

Expected: PASS.

- [ ] **Step 9: Run the full suite and typecheck**

```bash
npm test -- --run
npm run typecheck
```

Expected: all green.

- [ ] **Step 10: Format and commit**

```bash
npx prettier --write src/cli/exitCode.ts src/cli/index.ts tests/unit/exitCode.test.ts tests/unit/cli.test.ts
git add src/cli/exitCode.ts src/cli/index.ts tests/unit/exitCode.test.ts tests/unit/cli.test.ts
git commit -m "feat: exit code 2 when any agent fails, independent of --fail-on"
```

---

## Task 7: Integration test for the original bug scenario

**Files:**

- Modify: `tests/unit/cli.test.ts` (or `tests/unit/runner.test.ts` — pick whichever already has
  the more suitable end-to-end harness; read both before deciding)

- [ ] **Step 1: Write the test**

Add a test that reproduces the exact bug report scenario end-to-end: every agent returns
unparseable prose, and the final result must NOT look like a clean pass.

If added to `runner.test.ts`:

```typescript
  it('BUG REGRESSION: a run where every agent returns unparseable prose is not reported as clean', async () => {
    const provider: LLMProvider = {
      chat: vi
        .fn()
        .mockResolvedValue(
          "It looks like you've updated a number of files. Let me review them for you..."
        ),
      ping: vi.fn().mockResolvedValue({ ok: true }),
    }
    const config = {
      ...DEFAULT_CONFIG,
      agents: ['security', 'performance', 'correctness'] as AgentName[],
      retryAttempts: 1,
      retryDelayMs: 0,
    }
    const runner = new SwarmRunner(config, provider)
    const result = await runner.run({ diff: 'diff' })

    expect(result.findings).toEqual([])
    expect(result.agentStatus?.security).toBe('parse-error')
    expect(result.agentStatus?.performance).toBe('parse-error')
    expect(result.agentStatus?.correctness).toBe('parse-error')

    const markdown = formatMarkdown(result)
    expect(markdown).not.toContain('No issues found')
    expect(markdown).toContain('agents failed')
  })
```

Add the `formatMarkdown` import to the top of the file if it isn't already imported there.

- [ ] **Step 2: Run the test to verify it passes**

```bash
npx vitest run tests/unit/runner.test.ts
```

Expected: PASS (this should already pass given Tasks 1–5 are complete — this test exists to
prove the *end-to-end* scenario, not to drive new implementation).

- [ ] **Step 3: Run the full suite and typecheck**

```bash
npm test -- --run
npm run typecheck
npm run build
```

Expected: all green.

- [ ] **Step 4: Format and commit**

```bash
npx prettier --write tests/unit/runner.test.ts
git add tests/unit/runner.test.ts
git commit -m "test: add end-to-end regression test for the silent-failure bug report"
```

---

## Task 8: Update memory-bank, CHANGELOG, version

**Files:**

- Modify: `memory-bank/activeContext.md`
- Modify: `memory-bank/progress.md`
- Modify: `CHANGELOG.md`
- Modify: `package.json`

- [ ] **Step 1: CHANGELOG entry**

At the top of `CHANGELOG.md`, above the current top entry, add:

```markdown
## [1.4.0] — 2026-07-15 (silent agent failure reporting)

### Added

- `ReviewResult.agentStatus`: records `'ok' | 'timeout' | 'parse-error' | 'error'` per agent
  (15 specialists + coverage + testgen). Previously a run where every agent timed out or
  returned unparseable output rendered identically to a genuinely clean review
  (`0 findings | ✅ No issues found`) — both silent-failure sites (`parseFindings`'s final
  fallback, and `runner.ts`'s 4 catch blocks) now surface the distinction.
- Markdown, SARIF, and github-annotations formatters show a clear `⚠️ N/M agents failed` warning
  (with per-agent, per-failure-type remediation advice) instead of a clean checkmark when any
  agent didn't succeed. JSON gets `agentStatus` for free (whole-object serialization).
- New exit code `2`: a run with any agent failure exits 2, independent of and taking priority
  over the existing `--fail-on` severity gate (exit 1) — CI can no longer silently treat a
  broken run as a passing one.

### Fixed

- `parseFindings` (`base.ts`) and `parseCoverageResult` (`coverageAnalyst.ts`) now throw
  `ParseFailureError` on total parse failure instead of silently returning `[]` — the same
  value a genuinely clean review produces.
```

- [ ] **Step 2: Version bump**

In `package.json`, bump `"version"` to `"1.4.0"` (minor — new field/behavior, backward
compatible: `agentStatus` is optional, existing consumers that don't check it are unaffected).

- [ ] **Step 3: memory-bank/activeContext.md**

Prepend under `## Current Focus`:

```markdown
**Silent agent failure reporting fix (2026-07-15)**: a run where every agent timed out or
returned unparseable prose instead of JSON rendered identically to a genuinely clean review —
`0 findings | ✅ No issues found` in both cases, only visible in stderr. `parseFindings`
(`base.ts`) and `parseCoverageResult` (`coverageAnalyst.ts`) now throw `ParseFailureError`
instead of silently returning `[]`; `runner.ts`'s 4 catch blocks classify it into a new
`agentStatus: Partial<Record<AgentName | 'coverage' | 'testgen', AgentStatus>>` field on
`ReviewResult`. All 4 formatters surface it; a new exit code 2 (independent of and taking
priority over `--fail-on`) means CI can no longer silently treat a broken run as passing. See
`docs/superpowers/specs/2026-07-15-silent-agent-failure-reporting-design.md`.
```

- [ ] **Step 4: memory-bank/progress.md**

Add under `## ✅ Completed (Tasks 1–16)`, above the most recent existing entry:

```markdown
### Silent Agent Failure Reporting — 2026-07-15

- [x] `ParseFailureError` thrown by `parseFindings`/`parseCoverageResult` instead of silently
      returning `[]` on total parse failure.
- [x] `agentStatus` field added to `ReviewResult`, populated across all 4 `runner.ts`
      catch-block sites (sequential, parallel, coverage, testgen) plus their success paths.
- [x] All 4 output formats (markdown, json, sarif, github-annotations) surface agent failures
      clearly instead of an indistinguishable clean checkmark.
- [x] New exit code 2 for agent failures, independent of and taking priority over `--fail-on`.
- [x] 15 existing agent test files updated from asserting a silent `[]` return to asserting
      `ParseFailureError` is thrown; new dedicated tests for the runner-level classification,
      formatter output, exit code priority, and an end-to-end regression test for the original
      bug report scenario.
- [x] v1.4.0.
```

- [ ] **Step 5: Run the full check suite**

```bash
npm run check
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add CHANGELOG.md package.json memory-bank/activeContext.md memory-bank/progress.md
git commit -m "docs: changelog and memory-bank for silent agent failure reporting v1.4.0"
```

---

## Task 9: Land it

- [ ] **Step 1: Push and open a PR**

```bash
git push origin fix/silent-agent-failure-reporting
gh pr create --base main --head fix/silent-agent-failure-reporting \
  --title "fix: report agent failures instead of silently rendering as a clean pass" \
  --body "Implements docs/superpowers/specs/2026-07-15-silent-agent-failure-reporting-design.md. A run where agents time out or fail to produce parseable output previously rendered identically to a genuinely clean review (0 findings, no signal short of stderr). Adds ReviewResult.agentStatus, surfaces it in all 4 output formats, and adds exit code 2 (independent of --fail-on) so CI can't silently treat a broken run as passing."
```

Note: this repo's `/code-review` and `/change-review` review-gate hooks require running those
slash commands (and writing their diff-bound markers) before each commit/push in this task list
will actually succeed — follow the same flow used earlier in this session.
