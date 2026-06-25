# Track 4 — Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Four targeted cleanups: make context budget configurable, clamp invalid lineEnd values, document AGENT_PRIORITY rationale, and delete the stale actions-runner2 directory.

**Architecture:** Surgical edits across 6 files. No new abstractions. All changes are backward compatible — `contextBudgetChars` has a default of 4000 matching the previous hardcoded value.

**Tech Stack:** TypeScript 5, Vitest, Node.js 24

---

## File Map

| Operation | File |
|---|---|
| Modify | `src/core/config.ts` — add `contextBudgetChars?: number` |
| Modify | `src/core/contextLoader.ts` — accept budget param, remove hardcoded constant |
| Modify | `src/core/runner.ts` — pass `config.contextBudgetChars` to `loadAgentContext` |
| Modify | `src/cli/index.ts` — add `--context-budget <n>` CLI flag |
| Modify | `src/core/agents/base.ts` — clamp `lineEnd` in map step |
| Modify | `src/cli/formatters/sarif.ts` — defensive lineEnd check |
| Modify | `src/core/agents/orchestrator.ts` — add AGENT_PRIORITY comment |
| Modify | `tests/unit/contextLoader.test.ts` — verify custom budget respected |
| Modify | `tests/unit/baseAgent.test.ts` — verify lineEnd clamping |

---

### Task 1: Make contextBudgetChars configurable

**Files:**
- Modify: `src/core/config.ts`
- Modify: `src/core/contextLoader.ts`
- Modify: `src/core/runner.ts`
- Modify: `src/cli/index.ts`
- Modify: `tests/unit/contextLoader.test.ts`

- [ ] **Step 1: Write a failing test for custom budget**

Open `tests/unit/contextLoader.test.ts`. Add this test inside the existing describe block (it already has a truncation test — this parameterizes the budget):

```ts
it('respects a custom budget smaller than default', () => {
  setup({ 'techContext.md': 'x'.repeat(500) })
  const result = loadAgentContext(TMP, 'security', 200)  // 200-char budget
  expect(result.truncated).toBe(true)
  expect(result.content.length).toBeLessThan(300) // content + header overhead
  expect(result.estimatedTokens).toBeLessThanOrEqual(55) // ~200 chars / 4
})

it('loads full file when budget is large enough', () => {
  setup({ 'techContext.md': 'x'.repeat(100) })
  const result = loadAgentContext(TMP, 'security', 4000)
  expect(result.truncated).toBe(false)
  expect(result.filesLoaded).toHaveLength(1)
})
```

- [ ] **Step 2: Run to confirm they fail**

```bash
cd "C:\Users\Mizzo\Claude\AI-Code-Review-Agent"
npm test -- tests/unit/contextLoader.test.ts
```

Expected: FAIL — `loadAgentContext` currently doesn't accept a budget parameter.

- [ ] **Step 3: Update src/core/config.ts**

Read the file first. Then make two surgical changes:

**3a.** Add one line to `ReviewConfig` interface (after the `sanitize` field):
```ts
  contextBudgetChars: number
```

**3b.** Add one line to `DEFAULT_CONFIG` (after `sanitize: true`):
```ts
  contextBudgetChars: 4000,
```

- [ ] **Step 4: Update src/core/contextLoader.ts**

Remove the module-level constant and accept budget as a parameter:

```ts
// Remove: const CONTEXT_BUDGET_CHARS = 4000

export function loadAgentContext(
  projectPath: string,
  agentName: AgentName,
  budgetChars = 4000        // ← add this parameter with default
): ContextResult {
```

Replace all references to `CONTEXT_BUDGET_CHARS` with `budgetChars`:

```ts
  const remaining = budgetChars - charsUsed

  if (remaining <= 0) {
```

and:

```ts
  const chunk = raw.length <= remaining ? raw : raw.slice(0, remaining)
```

(There are 2 references to `CONTEXT_BUDGET_CHARS` — replace both with `budgetChars`.)

- [ ] **Step 5: Update src/core/runner.ts**

Find the `loadAgentContext` call (in the `withContext` helper or wherever it's called). Pass the budget from config:

```ts
const ctx = contextMode === 'memory-bank' && projectPath
  ? loadAgentContext(projectPath, agent.name, config.contextBudgetChars)
  : { content: '', filesLoaded: [], truncated: false, estimatedTokens: 0 }
```

- [ ] **Step 6: Update src/cli/index.ts — add --context-budget flag**

Add this option to the Commander chain (after `--context`):

```ts
.option('--context-budget <n>', 'Max chars of memory-bank content per agent (default: 4000)', parseInt)
```

Add `contextBudget?: number` to the options type.

In the action handler, after loading config and setting other options:
```ts
if (options.contextBudget !== undefined) config.contextBudgetChars = options.contextBudget
```

- [ ] **Step 7: Run tests to confirm they pass**

```bash
cd "C:\Users\Mizzo\Claude\AI-Code-Review-Agent"
npm test -- tests/unit/contextLoader.test.ts
```

Expected: All contextLoader tests pass including the 2 new ones.

- [ ] **Step 8: Run typecheck**

```bash
cd "C:\Users\Mizzo\Claude\AI-Code-Review-Agent"
npm run typecheck 2>&1 | tail -3
```

Expected: 0 errors.

- [ ] **Step 9: Commit**

```bash
cd "C:\Users\Mizzo\Claude\AI-Code-Review-Agent"
git add src/core/config.ts src/core/contextLoader.ts src/core/runner.ts src/cli/index.ts tests/unit/contextLoader.test.ts
git commit -m "feat: make contextBudgetChars configurable (default 4000); add --context-budget CLI flag"
```

---

### Task 2: Clamp lineEnd in BaseAgent and SARIF formatter

**Files:**
- Modify: `src/core/agents/base.ts`
- Modify: `src/cli/formatters/sarif.ts`
- Modify: `tests/unit/baseAgent.test.ts`

- [ ] **Step 1: Write failing test**

Add to `tests/unit/baseAgent.test.ts`:

```ts
it('clamps lineEnd to line when lineEnd < line', async () => {
  const raw = JSON.stringify([{
    severity: 'high', basis: 'VERIFIED', confidence: 80,
    file: 'src/a.ts', line: 42, lineEnd: 5,  // lineEnd < line — invalid
    title: 'Test', detail: 'Detail', suggestion: 'Fix it'
  }])
  const findings = await new SecurityAgent(makeProvider(raw), DEFAULT_CONFIG).run({ diff: 'diff' })
  expect(findings[0].lineEnd).toBeGreaterThanOrEqual(findings[0].line)
  expect(findings[0].lineEnd).toBe(42) // clamped to line value
})

it('preserves valid lineEnd when lineEnd >= line', async () => {
  const raw = JSON.stringify([{
    severity: 'high', basis: 'VERIFIED', confidence: 80,
    file: 'src/a.ts', line: 10, lineEnd: 20,  // valid
    title: 'Test', detail: 'Detail', suggestion: 'Fix it'
  }])
  const findings = await new SecurityAgent(makeProvider(raw), DEFAULT_CONFIG).run({ diff: 'diff' })
  expect(findings[0].lineEnd).toBe(20)
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd "C:\Users\Mizzo\Claude\AI-Code-Review-Agent"
npm test -- tests/unit/baseAgent.test.ts
```

Expected: First test FAILS — `lineEnd: 5` passes through unclamped when line is 42.

- [ ] **Step 3: Fix src/core/agents/base.ts**

In the `validateFindings` map step (the `return { ...f, id: ..., agent: ... }` block), add lineEnd clamping:

```ts
return {
  ...f,
  id: `${this.name}-${i}`,
  agent: this.name,
  confidence: Math.max(0, Math.min(100, rawConf)),
  domain: f.domain ?? agentDefaultDomain(this.name),
  evidence: f.evidence ?? f.detail ?? '',
  impact: f.impact ?? '',
  recommendation,
  suggestion,
  blocking: f.blocking ?? f.severity === 'critical',
  source: f.source ?? 'llm',
  // Clamp lineEnd: must be >= line if present
  ...(f.lineEnd !== undefined ? { lineEnd: Math.max(f.line, f.lineEnd) } : {}),
}
```

- [ ] **Step 4: Fix src/cli/formatters/sarif.ts**

The `findingToSarifResult` function at line 29:

```ts
region: {
  startLine: f.line,
  endLine: f.lineEnd ?? f.line,
},
```

Add defensive guard (belt-and-suspenders even after BaseAgent fix):

```ts
region: {
  startLine: f.line,
  endLine: f.lineEnd !== undefined && f.lineEnd >= f.line ? f.lineEnd : f.line,
},
```

- [ ] **Step 5: Run tests**

```bash
cd "C:\Users\Mizzo\Claude\AI-Code-Review-Agent"
npm test 2>&1 | tail -5
```

Expected: All tests pass including the 2 new lineEnd tests.

- [ ] **Step 6: Commit**

```bash
cd "C:\Users\Mizzo\Claude\AI-Code-Review-Agent"
git add src/core/agents/base.ts src/cli/formatters/sarif.ts tests/unit/baseAgent.test.ts
git commit -m "fix: clamp lineEnd >= line in BaseAgent and SARIF formatter"
```

---

### Task 3: Document AGENT_PRIORITY in orchestrator

**Files:**
- Modify: `src/core/agents/orchestrator.ts`

- [ ] **Step 1: Add comment above AGENT_PRIORITY**

In `src/core/agents/orchestrator.ts`, find the `AGENT_PRIORITY` constant (around line 18). Replace:

```ts
const AGENT_PRIORITY: AgentName[] = [
```

With:

```ts
// Dedup tie-breaker: when multiple agents flag the same file:line, the agent
// with the highest index is kept and others are recorded in corroboratingAgents.
//
// Rationale (highest = most kept):
//   secrets / error-handling — high-signal, specific, rarely false-positive
//   security / complexity / migration-safety — precise, domain-specific findings
//   correctness / performance — common but important
//   design / dependencies / license — broader, more interpretive
//   integration / breaking-change — widest scope, most overlap with other agents
//   coverage / testgen / adversarial — supportive signals, escalate others
const AGENT_PRIORITY: AgentName[] = [
```

- [ ] **Step 2: Run typecheck**

```bash
cd "C:\Users\Mizzo\Claude\AI-Code-Review-Agent"
npm run typecheck 2>&1 | tail -3
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
cd "C:\Users\Mizzo\Claude\AI-Code-Review-Agent"
git add src/core/agents/orchestrator.ts
git commit -m "docs: document AGENT_PRIORITY tie-breaker rationale in orchestrator"
```

---

### Task 4: Delete stale actions-runner2 directory

This is a local cleanup only — not a code change and not committed.

- [ ] **Step 1: Delete the directory**

```powershell
cd "C:\Users\Mizzo"
Remove-Item -Recurse -Force "C:\Users\Mizzo\actions-runner2"
```

- [ ] **Step 2: Confirm it's gone**

```powershell
cd "C:\Users\Mizzo"
Test-Path "C:\Users\Mizzo\actions-runner2"
```

Expected: `False`

---

### Task 5: Final verification and push

- [ ] **Step 1: Run full check**

```bash
cd "C:\Users\Mizzo\Claude\AI-Code-Review-Agent"
npm run check 2>&1 | tail -8
```

Expected: All tests pass, 0 TypeScript errors, clean build, Prettier clean.

- [ ] **Step 2: Confirm test count**

```bash
cd "C:\Users\Mizzo\Claude\AI-Code-Review-Agent"
npm test 2>&1 | grep "Tests"
```

Expected: 252+ tests passing (248 from tracks 1-3 + 4 new from track 4).

- [ ] **Step 3: Push**

```bash
cd "C:\Users\Mizzo\Claude\AI-Code-Review-Agent"
git push origin main
```
