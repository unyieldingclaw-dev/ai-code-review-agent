# Review Reliability Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix four independently-verified review-reliability bugs in `ai-review-agent` — silent diff truncation with no exit-code signal, agent responses not conforming to the required JSON shape, security/adversarial agents misreading documentation as code, and the dependencies agent assuming every project is Node.js — without adding token/performance cost to the default (unconfigured) path.

**Architecture:** Each issue is independent and gets its own task cluster. Task order here is dependency order, not spec order: Issue 1's exit-code fix comes first (no dependencies), but its optional `--chunk` full-coverage feature is deliberately placed *last*, after Issues 3/4's schema additions exist, and is built as a thin wrapper *outside* `SwarmRunner` rather than a refactor of its internals — `SwarmRunner`'s orchestration boundary isn't demonstrated to be the problem by any of these four bugs, so nothing inside it changes for `--chunk`. Issue 2 required a live diagnostic measurement against real Ollama before its fix could be finalized — that measurement (Task 3) ruled out the originally-planned fix entirely and pointed at a different, verified root cause (a `format: 'json'` object-vs-array shape mismatch, fixed via an explicit JSON Schema in Tasks 4/5) — a real example of why that task was scoped as "diagnose before fixing" rather than guessing.

**Tech Stack:** Node/TypeScript, Ollama (local LLM), vitest.

**Spec:** `docs/superpowers/specs/2026-08-16-review-reliability-fixes-design.md`

---

### Task 1: Exit code — add TRUNCATION_EXIT_CODE

**Files:**
- Modify: `src/cli/exitCode.ts`
- Test: `tests/unit/exitCode.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/exitCode.test.ts`, after the existing `AGENT_FAILURE_EXIT_CODE` describe block:

```ts
describe('TRUNCATION_EXIT_CODE', () => {
  it('is distinct from agent-failure (2), severity-gate (1), and clean (0)', () => {
    expect(TRUNCATION_EXIT_CODE).toBe(3)
  })
})
```

Update the import at the top of the file:

```ts
import {
  shouldFail,
  hasAgentFailures,
  AGENT_FAILURE_EXIT_CODE,
  TRUNCATION_EXIT_CODE,
} from '../../src/cli/exitCode.js'
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/exitCode.test.ts`
Expected: FAIL — `TRUNCATION_EXIT_CODE` is not exported.

- [ ] **Step 3: Implement**

In `src/cli/exitCode.ts`, add below the existing `AGENT_FAILURE_EXIT_CODE`:

```ts
export const AGENT_FAILURE_EXIT_CODE = 2
// Distinct from AGENT_FAILURE_EXIT_CODE (agents didn't run at all) and the severity-gate exit
// code 1 (a real finding was found) -- a truncated-but-otherwise-clean run means agents ran
// successfully but didn't see the whole diff. See cli/index.ts for how this ranks against the
// other two: a genuine blocker finding must never be masked by "the run was also incomplete."
export const TRUNCATION_EXIT_CODE = 3
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/exitCode.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/exitCode.ts tests/unit/exitCode.test.ts
git commit -m "feat: add TRUNCATION_EXIT_CODE for incomplete-coverage runs"
```

---

### Task 2: CLI — exit-code priority and --allow-truncation

**Files:**
- Modify: `src/cli/index.ts`
- Test: `tests/unit/cli.test.ts`

- [ ] **Step 1: Read the current exit sequence to confirm line numbers**

Run: `grep -n "hasBlocker\|AGENT_FAILURE_EXIT_CODE\|process.exit" src/cli/index.ts`

Confirm the block still matches:
```ts
const hasBlocker = result.findings.some((f) => shouldFail(f.severity, options.failOn))
if (hasAgentFailures(result.agentStatus)) {
  process.exit(AGENT_FAILURE_EXIT_CODE)
}
process.exit(hasBlocker ? 1 : 0)
```

- [ ] **Step 2: Write the failing test**

Find the existing `describe('program')` or CLI exit-code test block in `tests/unit/cli.test.ts` (grep for `AGENT_FAILURE_EXIT_CODE` there for the existing pattern to match). Add:

```ts
it('exits 1 (not 3) when a truncated run also contains a blocker finding', async () => {
  vi.mocked(SwarmRunner.prototype.run).mockResolvedValue({
    findings: [makeFinding({ severity: 'critical' })],
    testFiles: [],
    summary: { totalFindings: 1, bySeverity: {}, byAgent: {}, durationMs: 1 },
    sanitizer: { enabled: true, applied: false, redactedLines: 0, warnings: [] },
    truncation: { truncated: true, originalLines: 5000, keptLines: 2000 },
  })
  await expect(runCli(['--diff', 'x.diff'])).rejects.toThrow('process.exit(1)')
})

it('exits 3 when truncated with no blocker finding', async () => {
  vi.mocked(SwarmRunner.prototype.run).mockResolvedValue({
    findings: [],
    testFiles: [],
    summary: { totalFindings: 0, bySeverity: {}, byAgent: {}, durationMs: 1 },
    sanitizer: { enabled: true, applied: false, redactedLines: 0, warnings: [] },
    truncation: { truncated: true, originalLines: 5000, keptLines: 2000 },
  })
  await expect(runCli(['--diff', 'x.diff'])).rejects.toThrow('process.exit(3)')
})

it('exits 0 on a truncated-but-clean run when --allow-truncation is passed', async () => {
  vi.mocked(SwarmRunner.prototype.run).mockResolvedValue({
    findings: [],
    testFiles: [],
    summary: { totalFindings: 0, bySeverity: {}, byAgent: {}, durationMs: 1 },
    sanitizer: { enabled: true, applied: false, redactedLines: 0, warnings: [] },
    truncation: { truncated: true, originalLines: 5000, keptLines: 2000 },
  })
  await expect(
    runCli(['--diff', 'x.diff', '--allow-truncation'])
  ).rejects.toThrow('process.exit(0)')
})
```

(If `tests/unit/cli.test.ts` doesn't already have a `makeFinding`/`runCli` helper, check the file's existing patterns first via `grep -n "function runCli\|function makeFinding" tests/unit/cli.test.ts` and reuse them — don't invent new ones that duplicate existing helpers.)

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/unit/cli.test.ts`
Expected: FAIL — exit code 3 doesn't exist yet, `--allow-truncation` isn't a recognized option.

- [ ] **Step 4: Implement**

In `src/cli/index.ts`, update the import:

```ts
import {
  shouldFail,
  FAIL_ON_OPTIONS,
  hasAgentFailures,
  AGENT_FAILURE_EXIT_CODE,
  TRUNCATION_EXIT_CODE,
} from './exitCode.js'
```

Add the new option near `--fail-fast` (after the `--fail-on` option block):

```ts
  .option(
    '--allow-truncation',
    'Exit 0 on a truncated-but-otherwise-clean run instead of exit code 3 -- use only if you have ' +
      'deliberately accepted partial diff coverage for this workflow'
  )
```

Add `allowTruncation?: boolean` to the `action` callback's options type, alongside `verifyEvidence?: boolean`.

Replace the exit-code block at the end of the action callback:

```ts
        const hasBlocker = result.findings.some((f) => shouldFail(f.severity, options.failOn))
        if (hasAgentFailures(result.agentStatus)) {
          process.exit(AGENT_FAILURE_EXIT_CODE)
        }
        if (hasBlocker) {
          process.exit(1)
        }
        // Truncation ranks below a real blocker (checked above) but above "clean" -- a run that
        // silently skipped 60% of the diff must not report exit 0 by default. --allow-truncation
        // opts back into 0 for callers who've deliberately accepted partial coverage.
        if (result.truncation?.truncated && !options.allowTruncation) {
          process.exit(TRUNCATION_EXIT_CODE)
        }
        process.exit(0)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/cli.test.ts`
Expected: PASS

- [ ] **Step 6: Update CLI help documentation**

In `README.md`, find the CLI flags table (grep `--fail-on` to locate it) and add a row:

```
| `--allow-truncation` | Exit 0 on a truncated-but-otherwise-clean run instead of exit code 3 | off |
```

Also add a line documenting exit code 3 wherever exit codes 0/1/2 are already documented (grep `AGENT_FAILURE_EXIT_CODE\|exit code 2` in `README.md`).

- [ ] **Step 7: Commit**

```bash
git add src/cli/index.ts tests/unit/cli.test.ts README.md
git commit -m "feat: exit code 3 for truncated-but-clean runs, --allow-truncation opt-out"
```

---

### Task 3: Diagnostic script — measure response-truncation cause

**Files:**
- Create: `calibration/responseTruncationDiagnostic.ts`
- Modify: `package.json` (new script entry)

This task's "expected output" is a genuine live measurement, not a predictable pass/fail — that's the point (see design spec, Issue 2). **Note (added after this task executed):** the live measurement ruled out the original `num_predict` hypothesis entirely (`done_reason` was `stop`, never `length`) and pointed at a different root cause (a `format: 'json'` object-vs-array shape mismatch) — Tasks 4/5 were revised accordingly. See the design spec's Issue 2 section and this task's actual commit message for the full investigation.

- [ ] **Step 1: Write the diagnostic script**

Create `calibration/responseTruncationDiagnostic.ts`:

```ts
// One-off diagnostic (not part of the default test suite -- makes real Ollama calls) to
// determine WHY every agent hit response truncation in the reported bug (see
// docs/superpowers/specs/2026-08-16-review-reliability-fixes-design.md, Issue 2). Sends a
// realistically large diff-review prompt (matching what SecurityAgent actually sends) through
// OllamaProvider.chat() directly and logs Ollama's own prompt_eval_count/eval_count/done_reason
// fields -- these already exist in Ollama's /api/chat response and are already discarded by
// OllamaProvider.chat() today (it only returns message.content). Run manually:
//   npx tsx calibration/responseTruncationDiagnostic.ts [path/to/large.diff]
import { readFileSync } from 'fs'
import { SecurityAgent } from '../src/core/agents/security.js'
import { DEFAULT_CONFIG } from '../src/core/config.js'
import type { LLMProvider, Message } from '../src/core/llm/provider.js'

const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://localhost:11434'
const MODEL = process.env.OLLAMA_MODEL ?? DEFAULT_CONFIG.model
const diffPath = process.argv[2]

if (!diffPath) {
  console.error('Usage: npx tsx calibration/responseTruncationDiagnostic.ts <path/to/large.diff>')
  process.exit(1)
}

// Raw fetch, not OllamaProvider -- OllamaProvider.chat() only returns message.content, discarding
// exactly the fields this diagnostic needs (prompt_eval_count, eval_count, done_reason).
async function chatRaw(
  messages: Message[]
): Promise<{ content: string; promptEvalCount?: number; evalCount?: number; doneReason?: string }> {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, stream: false, think: true, format: 'json', messages }),
  })
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`)
  const data = (await res.json()) as {
    message?: { content?: string }
    prompt_eval_count?: number
    eval_count?: number
    done_reason?: string
  }
  return {
    content: data.message?.content ?? '',
    promptEvalCount: data.prompt_eval_count,
    evalCount: data.eval_count,
    doneReason: data.done_reason,
  }
}

async function main(): Promise<void> {
  const diff = readFileSync(diffPath, 'utf-8')
  const agent = new SecurityAgent({} as LLMProvider, DEFAULT_CONFIG) // provider unused -- only buildUserPrompt/systemPrompt needed
  const messages: Message[] = [
    { role: 'system', content: agent.systemPrompt },
    // buildUserPrompt is protected -- reconstruct its exact shape inline rather than exposing it
    { role: 'user', content: `Review this diff and return a JSON array of findings.\n\n\`\`\`diff\n${diff}\n\`\`\`` },
  ]

  console.log(`Model: ${MODEL}`)
  console.log(`Diff: ${diffPath} (${diff.split('\n').length} lines)`)
  const result = await chatRaw(messages)
  console.log(`prompt_eval_count (prompt tokens): ${result.promptEvalCount}`)
  console.log(`eval_count (response tokens): ${result.evalCount}`)
  console.log(`done_reason: ${result.doneReason}`)
  console.log(`response length: ${result.content.length} chars`)
  console.log(`response tail: ...${result.content.slice(-200)}`)

  if (result.doneReason === 'length') {
    console.log(
      '\n=> done_reason is "length": generation was cut off by a token cap. If prompt_eval_count ' +
        'is small relative to 32k, the fix is an explicit num_predict. If prompt_eval_count is ' +
        'itself close to 32k, the fix is reserving response headroom instead.'
    )
  } else if (result.doneReason === 'stop') {
    console.log('\n=> done_reason is "stop": the model chose to stop -- not a length-cap issue.')
  } else {
    console.log(`\n=> unexpected done_reason "${result.doneReason}" -- investigate directly.`)
  }
}

main()
```

- [ ] **Step 2: Add a package.json script entry**

In `package.json`'s `"scripts"` block, alongside `"calibrate:evidence"`:

```json
    "diagnose:truncation": "tsx calibration/responseTruncationDiagnostic.ts"
```

- [ ] **Step 3: Run it against a real large diff**

Produce a realistic large diff (e.g. `git -C <some large repo> diff HEAD~20 > /tmp/large.diff`, or reuse the diff from the original bug report if available), then:

Run: `npm run diagnose:truncation /tmp/large.diff`

**Record the actual output** — `prompt_eval_count`, `eval_count`, `done_reason` — in the commit message for this task (Step 5). This measurement is what determines whether Task 5 should proceed as originally planned or needs revision — do not skip straight to implementing a fix without this data.

- [ ] **Step 4: Confirm typecheck is clean**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add calibration/responseTruncationDiagnostic.ts package.json
git commit -m "$(cat <<'EOF'
feat: add response-truncation diagnostic script

Run against live Ollama with a real large diff before Task 5: measured
prompt_eval_count=<FILL IN>, eval_count=<FILL IN>, done_reason=<FILL IN>.
EOF
)"
```

(Replace the `<FILL IN>` placeholders with the actual numbers from Step 3 before committing — this commit message is the permanent record of the measurement that justifies Task 5's chosen default.)

---

### Task 4: Provider — widen ChatOptions.format to accept a JSON Schema

**Revised after Task 3's live investigation.** The original hypothesis (missing `num_predict`)
was tested and ruled out — `done_reason` was `stop`, never `length`, at every diff size tested,
including the realistic 2000-line size. What was actually confirmed live: `format: 'json'` (the
bare string) only constrains "valid JSON," not "an array of N objects" — the model reliably emits
a single bare object instead of the required array. Tested directly: sending the identical request
with an explicit JSON Schema (`format: { type: 'array', items: {...} }` — Ollama's `format` field
accepts either the string `"json"` or a full JSON Schema object) correctly produced an array. See
`docs/superpowers/specs/2026-08-16-review-reliability-fixes-design.md`, Issue 2, for the full
investigation and measurements. This task and Task 5 implement that verified fix instead.

**Files:**
- Modify: `src/core/llm/provider.ts`
- Test: `tests/unit/ollamaProvider.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/ollamaProvider.test.ts` (grep for an existing test asserting on the request body sent to `fetch`, e.g. for `format: 'json'`, and match its mocking pattern):

```ts
it('forwards an object-shaped format (JSON Schema) unchanged in the request body', async () => {
  const fetchMock = vi.mocked(global.fetch)
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify({ message: { content: '[]' } }), { status: 200 })
  )
  const provider = new OllamaProvider('http://localhost:11434', 'devstral:latest')
  const schema = { type: 'array', items: { type: 'object' } }
  await provider.chat([{ role: 'user', content: 'x' }], { format: schema })

  const [, requestInit] = fetchMock.mock.calls[0]
  const body = JSON.parse(requestInit!.body as string)
  expect(body.format).toEqual(schema)
})
```

(The existing test for `format: 'json'` string mode should already pass unchanged — this is an additive type widening, not a behavior change to the string case. Confirm that existing test still passes too.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/ollamaProvider.test.ts`
Expected: FAIL — TypeScript rejects passing an object to `format` (type error), or the test doesn't compile.

- [ ] **Step 3: Implement**

In `src/core/llm/provider.ts`, widen `ChatOptions.format`:

```ts
export interface ChatOptions {
  think?: boolean
  // Ollama's structured-output mode: the string "json" only constrains "valid JSON" (any shape);
  // a full JSON Schema object additionally constrains the actual structure (e.g. top-level array
  // vs. object) -- see base.ts's FINDING_ARRAY_SCHEMA for why this matters. Both are forwarded
  // to Ollama unchanged; OllamaProvider itself doesn't need to know which one it's carrying.
  format?: 'json' | Record<string, unknown>
  /** Ignored when `signal` is also provided — OllamaProvider prefers the caller's signal. */
  timeout?: number
  signal?: AbortSignal
}
```

No change needed in `src/core/llm/ollamaProvider.ts` — its request body already does
`...(options.format ? { format: options.format } : {})`, which forwards either shape unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/ollamaProvider.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/llm/provider.ts tests/unit/ollamaProvider.test.ts
git commit -m "feat: widen ChatOptions.format to accept a JSON Schema object"
```

---

### Task 5: Findings-array JSON Schema — wire into base.ts and coverageAnalyst.ts

**Files:**
- Modify: `src/core/agents/base.ts`
- Modify: `src/core/agents/coverageAnalyst.ts`
- Test: `tests/unit/baseAgent.test.ts`, `tests/unit/coverageAnalyst.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/baseAgent.test.ts` (grep for an existing test asserting on `provider.chat`'s call arguments to match style):

```ts
it('sends an array-typed JSON Schema instead of the bare "json" string', async () => {
  const provider = makeProvider('[]') // reuse existing helper
  class TestAgent extends BaseAgent {
    get name(): AgentName { return 'security' }
    get systemPrompt(): string { return 'test' }
  }
  await new TestAgent(provider, DEFAULT_CONFIG).run({ diff: 'x' })
  expect(provider.chat).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({
      format: expect.objectContaining({ type: 'array' }),
    })
  )
})
```

Add the analogous test to `tests/unit/coverageAnalyst.test.ts` for `runForCoverage`, asserting `format: expect.objectContaining({ type: 'object' })` (the `{findings, gaps}` shape, not an array).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/baseAgent.test.ts tests/unit/coverageAnalyst.test.ts`
Expected: FAIL — both still send `format: 'json'`.

- [ ] **Step 3: Implement**

In `src/core/agents/base.ts`, add a new exported constant above the `BaseAgent` class. `required` is a stricter subset of what `parsing.ts`'s `validateAndNormalizeFindings` actually requires (`severity`, `file`, `line`, `title`, `detail`, plus `evidence`/`recommendation` — the canonical field names every current agent prompt already emits; the validator itself also accepts the legacy `basis`/`suggestion` alternates via OR-logic, but hard-requiring the canonical names here is safe and simpler than reproducing that OR logic in JSON Schema):

```ts
// Forces Ollama's structured-output mode to actually constrain the top-level shape to an array,
// not just "valid JSON" -- format: 'json' (the bare string) let the model emit a single bare
// object instead of the required array; verified via live testing that an explicit array-typed
// schema fixes this (see docs/superpowers/specs/2026-08-16-review-reliability-fixes-design.md,
// Issue 2). `required` is a stricter subset of parsing.ts's validateAndNormalizeFindings:
// that validator accepts (basis OR evidence) and (suggestion OR recommendation), but every
// current agent prompt already emits evidence+recommendation, so hard-requiring those two
// here is safe and simpler than reproducing the OR logic in JSON Schema.
export const FINDING_ARRAY_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      severity: { type: 'string' },
      basis: { type: 'string' },
      confidence: { type: 'integer' },
      domain: { type: 'string' },
      file: { type: 'string' },
      line: { type: 'integer' },
      lineEnd: { type: 'integer' },
      title: { type: 'string' },
      detail: { type: 'string' },
      evidence: { type: 'string' },
      impact: { type: 'string' },
      recommendation: { type: 'string' },
      suggestion: { type: 'string' },
      blocking: { type: 'boolean' },
      source: { type: 'string' },
    },
    required: ['severity', 'file', 'line', 'title', 'detail', 'evidence', 'recommendation'],
  },
} as const
```

Update `run()`'s `provider.chat` call:

```ts
  async run(input: ReviewInput, signal?: AbortSignal): Promise<Finding[]> {
    const messages: Message[] = [
      { role: 'system', content: this.systemPrompt },
      { role: 'user', content: this.buildUserPrompt(input) },
    ]
    const raw = await this.provider.chat(messages, {
      think: true,
      format: FINDING_ARRAY_SCHEMA,
      signal,
    })
    return this.parseFindings(raw)
  }
```

In `src/core/agents/coverageAnalyst.ts`, import `FINDING_ARRAY_SCHEMA` from `./base.js` and add a second schema constant matching its `{findings, gaps}` object shape (mirrors `validateGaps`'s required fields exactly):

```ts
import { BaseAgent, FINDING_ARRAY_SCHEMA } from './base.js'

// coverageAnalyst's response is an object with two arrays, not a bare array -- FINDING_ARRAY_SCHEMA
// alone doesn't fit here. `gaps.items.required` mirrors this file's own validateGaps exactly.
const COVERAGE_RESULT_SCHEMA = {
  type: 'object',
  properties: {
    findings: FINDING_ARRAY_SCHEMA,
    gaps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          functionName: { type: 'string' },
          lineStart: { type: 'integer' },
          lineEnd: { type: 'integer' },
          description: { type: 'string' },
        },
        required: ['file', 'functionName', 'lineStart', 'lineEnd', 'description'],
      },
    },
  },
  required: ['findings', 'gaps'],
} as const
```

Update `runForCoverage`'s `provider.chat` call:

```ts
  async runForCoverage(input: ReviewInput, signal?: AbortSignal): Promise<CoverageAnalystResult> {
    const messages: Message[] = [
      { role: 'system', content: this.systemPrompt },
      { role: 'user', content: this.buildUserPrompt(input) },
    ]
    const raw = await this.provider.chat(messages, {
      think: true,
      format: COVERAGE_RESULT_SCHEMA,
      signal,
    })
    return this.parseCoverageResult(raw, input)
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/baseAgent.test.ts tests/unit/coverageAnalyst.test.ts`
Expected: PASS

- [ ] **Step 5: Confirm testGen.ts and evidenceVerifier.ts are unchanged**

Run: `git diff src/core/agents/testGen.ts src/core/evidenceVerifier.ts`
Expected: empty output (no changes to either file) — neither is array/object-of-findings shaped
(testGen outputs raw code; evidenceVerifier sends a single short verdict line), so neither needs
this fix.

- [ ] **Step 6: Run full regression**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 0 typecheck errors, all tests pass.

- [ ] **Step 7: Live sanity check**

Run a real `ai-review-agent` review (via the built CLI or `npx tsx src/cli/index.ts --profile security --format json`) against a diff with 2+ genuine, unrelated findings, and confirm the JSON output is now a well-formed top-level array (not a bare object requiring Stage 2b's auto-wrap). This confirms the shape fix works end-to-end, not just in the schema constant. **This does not need to show more than one finding** — the model's tendency to under-report multiple real findings is a separate, confirmed, deliberately out-of-scope problem (see design spec, Issue 2 Non-Goals) — this step only confirms the *shape* is correct, not that recall improved.

- [ ] **Step 8: Commit**

```bash
git add src/core/agents/base.ts src/core/agents/coverageAnalyst.ts tests/unit/baseAgent.test.ts tests/unit/coverageAnalyst.test.ts
git commit -m "$(cat <<'EOF'
feat: constrain agent JSON output to the required shape via explicit schema

Replaces the bare format: 'json' string (which only constrains "valid
JSON", not array-vs-object shape) with an explicit JSON Schema for
base.ts (array of findings) and coverageAnalyst.ts ({findings, gaps}
object) -- verified live against real Ollama to fix the object-vs-array
mismatch that was causing every agent's response to need Stage 2b's
auto-wrap recovery. Does not address a separate, confirmed finding from
the same investigation (the model under-reporting multiple real issues
in one diff) -- that's a distinct, deliberately out-of-scope problem,
documented in the design spec's Issue 2 Non-Goals.
EOF
)"
```

---

### Task 6: Schema — top-level filteredFiles field

**Files:**
- Modify: `src/core/schema.ts`

- [ ] **Step 1: Implement**

`PolicyResult` itself needs no change — leave it exactly as-is. Add a new field directly to
`ReviewResult` instead (after `policy?: PolicyResult`), typed inline the same way
`agentStatus`/`toolAvailability` already are elsewhere in this file (no new named interface):

```ts
export interface ReviewResult {
  // ... existing fields unchanged ...
  policy?: PolicyResult
  // Sibling of PolicyResult, not a field on it: PolicyResult is only ever surfaced below when
  // agentsSkipped is non-empty (see runner.ts), but the scenario this field covers is exactly the
  // opposite case -- an agent that still RAN, just with some file sections removed from its own
  // view of the diff via agentPolicy.exclude (see Task 7). Nesting inside PolicyResult would mean
  // this field never appears in the one case it exists to report.
  filteredFiles?: Partial<Record<AgentName, string[]>>
  agentStatus?: Partial<Record<AgentName, AgentStatus>>
  // ... rest of existing fields unchanged ...
}
```

- [ ] **Step 2: Confirm typecheck is clean**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/core/schema.ts
git commit -m "feat: add ReviewResult.filteredFiles (top-level, sibling of PolicyResult)"
```

---

### Task 7: Runner — per-agent filterDiff() call site, agentPolicy defaults

**Files:**
- Modify: `src/core/runner.ts`
- Modify: `src/core/config.ts`
- Test: `tests/unit/runner.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/runner.test.ts`:

```ts
it('strips only excluded file sections from an agent with an agentPolicy.exclude rule, and reports it in filteredFiles', async () => {
  const mixedDiff =
    `diff --git a/docs/notes.md b/docs/notes.md\n--- a/docs/notes.md\n+++ b/docs/notes.md\n@@ -1 +1 @@\n-old\n+new\n` +
    `diff --git a/src/foo.ts b/src/foo.ts\n--- a/src/foo.ts\n+++ b/src/foo.ts\n@@ -1 +1 @@\n-old\n+new\n`
  const config = {
    ...DEFAULT_CONFIG,
    agents: ['security'] as AgentName[],
    agentPolicy: { security: { exclude: ['**/*.md'] } },
  }
  const provider = makeMockProvider('[]')
  const runner = new SwarmRunner(config, provider)

  const result = await runner.run({ diff: mixedDiff })

  expect(result.filteredFiles?.security).toEqual(['docs/notes.md'])
  // security still ran (not skipped -- src/foo.ts still matched) and its prompt shouldn't
  // contain the excluded file's diff section
  expect(provider.chat).toHaveBeenCalledOnce()
  const [messages] = vi.mocked(provider.chat).mock.calls[0]
  const userMessage = messages.find((m) => m.role === 'user')?.content ?? ''
  expect(userMessage).not.toContain('docs/notes.md')
  expect(userMessage).toContain('src/foo.ts')
})

it('still applies the existing whole-agent skip when ALL changed files match exclude', async () => {
  const allMdDiff =
    `diff --git a/docs/notes.md b/docs/notes.md\n--- a/docs/notes.md\n+++ b/docs/notes.md\n@@ -1 +1 @@\n-old\n+new\n`
  const config = {
    ...DEFAULT_CONFIG,
    agents: ['security'] as AgentName[],
    agentPolicy: { security: { exclude: ['**/*.md'] } },
  }
  const provider = makeMockProvider('[]')
  const runner = new SwarmRunner(config, provider)

  const result = await runner.run({ diff: allMdDiff })

  expect(result.policy?.agentsSkipped).toContain('security')
  expect(result.filteredFiles?.security).toBeUndefined() // never ran -- nothing to report
  expect(provider.chat).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/runner.test.ts`
Expected: FAIL — `agentPolicy.exclude` currently only affects whole-agent skip, never strips individual file sections; `filteredFiles` is never populated.

- [ ] **Step 3: Implement**

In `src/core/runner.ts`, `run()` builds one shared `agents` array and passes `withContext` to `runCoverageAgent`/`runAgentsParallel`/`runAgentsSequential`/`testGen.runWithGaps`. Add per-agent diff filtering by wrapping `withContext`. Right after the `const agents = buildAgents(policyConfig, this.provider)` line, add:

```ts
    // Per-agent diff-content filtering: agentPolicy.exclude already gates whole-agent skip (via
    // evaluatePolicy above, when ALL changed files match); this additionally strips just the
    // matching file sections from an agent's OWN diff when only SOME files match, reusing the
    // same filterDiff() ignoreFilter.ts already uses for global --ignore filtering. Wraps
    // withContext rather than replacing it -- context injection still happens on top of the
    // filtered diff, unchanged.
    const filteredFiles: Partial<Record<AgentName, string[]>> = {}
    const withFilteredContext = async (agentName: AgentName): Promise<ReviewInput> => {
      const ctxInput = await withContext(agentName)
      const rule = this.config.agentPolicy?.[agentName]
      if (!rule?.exclude || rule.exclude.length === 0) return ctxInput
      const beforeFiles = new Set(extractChangedFiles(ctxInput.diff))
      const filtered = filterDiff(ctxInput.diff, { excludes: rule.exclude, includes: rule.include ?? [] })
      const afterFiles = new Set(extractChangedFiles(filtered))
      const dropped = [...beforeFiles].filter((f) => !afterFiles.has(f))
      if (dropped.length > 0) {
        filteredFiles[agentName] = [...(filteredFiles[agentName] ?? []), ...dropped]
      }
      return { ...ctxInput, diff: filtered }
    }
```

Replace every `withContext` call *at the four call sites below it* (`runCoverageAgent`, `runAgentsParallel`, `runAgentsSequential`, `this.testGen.runWithGaps(await withContext('testgen'), ...)`) with `withFilteredContext`. `withContext` itself, defined earlier in `run()`, is unchanged.

Add to the final returned object in `run()`, alongside the other conditional spreads:

```ts
      ...(Object.keys(filteredFiles).length > 0 ? { filteredFiles } : {}),
```

Now add the `security`/`adversarial` `.md` defaults. In `src/core/config.ts`, update `DEFAULT_CONFIG`:

```ts
  // WHY security/adversarial specifically, not project-wide: these are the two agents verified
  // (by reading their prompts) to have zero file-type awareness and a demonstrated real-world
  // failure mode -- misreading a .md file's prose description of a vulnerability pattern as
  // executable code. breaking-change/license were checked too and neither prompt references .md
  // files at all, so there's no evidence either way for them; this stays narrowly scoped to where
  // the bug was actually reproduced rather than guessing more broadly. Deterministic (not a
  // prompt instruction) because this project has prior evidence prompt-tightening alone
  // underperforms for this class of problem (secrets/dependencies/adversarial history). See
  // docs/superpowers/specs/2026-08-16-review-reliability-fixes-design.md, Issue 3 -- including
  // the documented config-shallow-merge caveat: a project's own agentPolicy setting for ANY agent
  // replaces this default entirely (loadConfig does a shallow merge). Re-specify these excludes
  // in your own ai-review.config.json if you set agentPolicy for any agent and want to keep them.
  agentPolicy: {
    security: { exclude: ['**/*.md'] },
    adversarial: { exclude: ['**/*.md'] },
  },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/runner.test.ts`
Expected: PASS

- [ ] **Step 5: Run full regression**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 0 typecheck errors, all tests pass. Pay particular attention to any existing test that reviews this repo's own diffs (which touch `.md` files routinely) — if any existing fixture/calibration case depends on `security`/`adversarial` seeing a `.md` file, it will need updating; if none do (checked during design review), this should be a clean pass.

- [ ] **Step 6: Commit**

```bash
git add src/core/runner.ts src/core/config.ts tests/unit/runner.test.ts
git commit -m "feat: per-agent diff filtering via agentPolicy.exclude, default .md excludes for security/adversarial"
```

---

### Task 8: README — document the agentPolicy shallow-merge interaction

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add documentation**

In `README.md`, find the section documenting `agentPolicy` (grep `agentPolicy`) and add:

```markdown
**Note on defaults:** `security` and `adversarial` exclude `**/*.md` by default (documentation
files were being misread as executable code). `ai-review.config.json`'s config loading does a
shallow merge — if you set your own `agentPolicy` for *any* agent, it replaces the entire
`agentPolicy` object, including these defaults. Re-specify them in your own config if you want to
keep them:

```json
{
  "agentPolicy": {
    "security": { "exclude": ["**/*.md"] },
    "adversarial": { "exclude": ["**/*.md"] },
    "your-other-agent": { "exclude": ["some/pattern"] }
  }
}
```
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: document agentPolicy shallow-merge interaction with new security/adversarial defaults"
```

---

### Task 9: Schema — ToolAvailability 'not-applicable'

**Files:**
- Modify: `src/core/schema.ts`

- [ ] **Step 1: Implement**

In `src/core/schema.ts`, update:

```ts
export type ToolAvailability = 'used' | 'unavailable-llm-fallback' | 'not-applicable'
```

- [ ] **Step 2: Confirm typecheck is clean**

Run: `npx tsc --noEmit`
Expected: 0 errors (this is a union widening, purely additive — no existing code should break).

- [ ] **Step 3: Commit**

```bash
git add src/core/schema.ts
git commit -m "feat: add 'not-applicable' to ToolAvailability union"
```

---

### Task 10: Dependencies agent — manifest-existence pre-check

**Files:**
- Modify: `src/core/agents/dependencies.ts`
- Test: `tests/unit/dependenciesAgent.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/dependenciesAgent.test.ts`, inside the existing `describe('DependenciesAgent npm-audit integration', ...)` block:

```ts
  it('skips the LLM entirely when the diff does not touch a manifest AND no package.json exists in projectPath', async () => {
    const provider = makeProvider('[]')
    const agent = new DependenciesAgent(provider, DEFAULT_CONFIG)

    const findings = await agent.run({ diff: NON_MANIFEST_DIFF, projectPath: '/no/such/project' })

    expect(findings).toEqual([])
    expect(provider.chat).not.toHaveBeenCalled()
    expect(mockRunTool).not.toHaveBeenCalled()
    expect(agent.lastToolAvailability).toBe('not-applicable')
  })

  it('still runs the LLM fallback when the diff does not touch a manifest but package.json DOES exist (e.g. this repo itself)', async () => {
    const provider = makeProvider('[]')
    const agent = new DependenciesAgent(provider, DEFAULT_CONFIG)

    // projectPath: '.' resolves to the real repo root during `npm test`, which has package.json
    await agent.run({ diff: NON_MANIFEST_DIFF, projectPath: '.' })

    expect(provider.chat).toHaveBeenCalledOnce()
  })

  it('does NOT skip when touchesManifest is true, even if package.json is not yet on disk (new project)', async () => {
    mockRunTool.mockResolvedValue(null) // npm audit unavailable -- e.g. patch not applied to disk
    const provider = makeProvider('[]')
    const agent = new DependenciesAgent(provider, DEFAULT_CONFIG)

    await agent.run({ diff: MANIFEST_DIFF, projectPath: '/brand/new/project/not/on/disk' })

    // Falls through to the existing touchesManifest branch, not the new skip -- still calls the LLM
    expect(provider.chat).toHaveBeenCalledOnce()
    expect(agent.lastToolAvailability).toBe('unavailable-llm-fallback')
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/dependenciesAgent.test.ts`
Expected: FAIL — the new skip doesn't exist yet (first test), and the second/third tests should already pass with current code (confirming the baseline before the change).

- [ ] **Step 3: Implement**

In `src/core/agents/dependencies.ts`, add the `existsSync`/`join` imports:

```ts
import { existsSync } from 'fs'
import { join } from 'path'
import { BaseAgent } from './base.js'
import { runTool } from '../../utils/shell.js'
import { extractChangedFiles } from '../policyFilter.js'
import { parseNpmAuditOutput } from '../npmAuditParser.js'
import type { AgentName, Finding, ReviewInput } from '../schema.js'
```

Update `run()`:

```ts
  async run(input: ReviewInput, signal?: AbortSignal): Promise<Finding[]> {
    const touchesManifest = extractChangedFiles(input.diff).some(
      (f) => f === 'package.json' || f === 'package-lock.json'
    )
    // Guarded to !touchesManifest specifically: a diff that DOES touch package.json (e.g. adding
    // one for the first time) must still reach the existing npm-audit-then-LLM-fallback branch
    // below unchanged, even if package.json isn't on disk yet (e.g. reviewing an unapplied
    // --diff patch) -- that's the correct, already-working case. This check only ever fires for
    // the actually-reported bug: a diff that mentions no manifest at all, in a project that never
    // had one. Root-level existsSync only, not a recursive/monorepo-aware walk -- a project with
    // only a workspace-nested package.json is a known, accepted gap (see design spec Issue 4).
    if (!touchesManifest && input.projectPath && !existsSync(join(input.projectPath, 'package.json'))) {
      this.lastToolAvailability = 'not-applicable'
      return []
    }
    if (touchesManifest && input.projectPath) {
      // shell:true is required for npm specifically (Node refuses to spawn .cmd/.bat files on
      // Windows otherwise) -- safe here because these args are always this hardcoded literal
      // array, never diff-derived content. cwd is required too: without it, npm audit runs
      // against whatever package.json is in this process's own cwd, not the reviewed project
      // (CLI --dir / MCP repo_path routinely differ from process.cwd()).
      const output = await runTool('npm', ['audit', '--json'], undefined, true, input.projectPath)
      if (output !== null) {
        this.lastToolAvailability = 'used'
        return parseNpmAuditOutput(output, this.name)
      }
    }
    if (touchesManifest) this.lastToolAvailability = 'unavailable-llm-fallback'
    return super.run(input, signal)
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/dependenciesAgent.test.ts`
Expected: PASS — including the full pre-existing test file (grep the file for the full `describe` blocks to confirm nothing else regressed).

- [ ] **Step 5: Commit**

```bash
git add src/core/agents/dependencies.ts tests/unit/dependenciesAgent.test.ts
git commit -m "fix: skip dependencies LLM fallback when no package.json exists and diff doesn't touch one"
```

---

### Task 11: Formatters — exclude 'not-applicable' from degraded-tools warnings

**Files:**
- Modify: `src/cli/formatter.ts`
- Modify: `src/cli/formatters/sarif.ts`
- Modify: `src/cli/formatters/githubAnnotations.ts` (check first — see Step 1)
- Test: `tests/unit/formatter.test.ts`

- [ ] **Step 1: Check whether githubAnnotations.ts needs a change**

Run: `grep -n "toolAvailability" src/cli/formatters/githubAnnotations.ts`

If no match, `githubAnnotations.ts` doesn't currently surface `toolAvailability` at all — skip it in this task (nothing to fix there). If it does match, apply the same fix as `sarif.ts` below.

- [ ] **Step 2: Write the failing test**

Add to `tests/unit/formatter.test.ts`:

```ts
it('does not include a not-applicable tool in the degraded-tools warning', () => {
  const result = makeResult({ toolAvailability: { npmAudit: 'not-applicable' } }) // reuse existing helper
  const output = formatMarkdown(result)
  expect(output).not.toContain('Degraded mode')
})

it('still warns for a genuinely unavailable tool alongside a not-applicable one', () => {
  const result = makeResult({
    toolAvailability: { npmAudit: 'not-applicable', gitleaks: 'unavailable-llm-fallback' },
  })
  const output = formatMarkdown(result)
  expect(output).toContain('Degraded mode')
  expect(output).toContain('gitleaks')
  expect(output).not.toContain('npm audit not installed')
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/unit/formatter.test.ts`
Expected: currently PASSES already, since `degradedTools`'s filter (`=== 'unavailable-llm-fallback'`) already excludes anything else, including a future `'not-applicable'` value — confirm this is genuinely a no-op change by re-reading `cli/formatter.ts:92-94`'s existing filter before writing new code. If the test already passes with zero implementation changes, this task is a no-op for `formatter.ts` specifically — skip to Step 5 and just add the regression test as a permanent guard against a future change accidentally widening that filter.

- [ ] **Step 4: Implement (sarif.ts only, if needed)**

`sarif.ts` already spreads `result.toolAvailability` verbatim into run properties with no filtering (`...(result.toolAvailability ? { toolAvailability: result.toolAvailability } : {})`) — this already surfaces `'not-applicable'` as raw data (correct — SARIF consumers can interpret it), not as a warning (there is no SARIF-level "warning" derived from `toolAvailability` today). No change needed here either; confirm by reading the current file.

If Step 1 found `githubAnnotations.ts` does NOT reference `toolAvailability`, no change is needed there either.

**If all three formatters already handle this correctly with zero changes** (verify by re-reading each file's actual current logic, not assuming), this task becomes: add the regression tests from Step 2 as permanent protection, with no production code change. Note this explicitly in the commit message.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/formatter.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add tests/unit/formatter.test.ts
git commit -m "test: guard degraded-tools warning against future not-applicable regression"
```

(If Step 4 did require an actual code change in any formatter, `git add` that file too and adjust the commit message to `fix: exclude not-applicable from degraded-tools warnings`.)

---

### Task 12: Chunk-splitting wrapper — outside SwarmRunner

**Files:**
- Create: `src/core/chunkRunner.ts`
- Modify: `src/core/config.ts`
- Test: `tests/unit/chunkRunner.test.ts`

**Why this lives outside `SwarmRunner` rather than as a change to `run()`'s internals:** none of the four bugs this plan fixes demonstrate that `SwarmRunner`'s orchestration boundary itself is the problem. `SwarmRunner.run()` is a working, existing capability (review one diff, fully). `--chunk` is new orchestration built *on top of* that capability — calling it multiple times and merging results — not a change to how it works internally. This task deliberately comes after Tasks 6 and 9 (which added `filteredFiles` and `'not-applicable'` to `ReviewResult`/`ToolAvailability`) so the merge logic below can reference those fields without a forward dependency.

- [ ] **Step 1: Add the config field**

In `src/core/config.ts`, add to `ReviewConfig` (after `parallel: boolean`) — this field is read only by `cli/index.ts` and the new `chunkRunner.ts`; `SwarmRunner` itself never reads it:

```ts
  parallel: boolean
  // WHY opt-in, off by default: splitting an oversized diff into multiple maxDiffLines-sized
  // passes achieves full coverage instead of silently dropping lines past the truncation point,
  // but multiplies LLM calls by chunk count -- imposing that cost on every oversized diff by
  // default would conflict with this project's default-path efficiency goal. Read only by
  // cli/index.ts and chunkRunner.ts -- SwarmRunner.run() has no knowledge of this field. See
  // docs/superpowers/specs/2026-08-16-review-reliability-fixes-design.md, Issue 1.
  chunk: boolean
```

Add to `DEFAULT_CONFIG` (after `parallel: false,`):

```ts
  parallel: false,
  chunk: false,
```

- [ ] **Step 2: Write the failing test**

Create `tests/unit/chunkRunner.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { runChunked } from '../../src/core/chunkRunner.js'
import type { SwarmRunner } from '../../src/core/runner.js'
import type { ReviewResult } from '../../src/core/schema.js'

function makeResult(overrides: Partial<ReviewResult> = {}): ReviewResult {
  return {
    findings: [],
    testFiles: [],
    summary: { totalFindings: 0, bySeverity: {}, byAgent: {}, durationMs: 100 },
    sanitizer: { enabled: true, applied: false, redactedLines: 0, warnings: [] },
    ...overrides,
  }
}

describe('runChunked', () => {
  it('splits a diff into ceil(lines/maxDiffLines) chunks and calls run() once per chunk', async () => {
    const runMock = vi.fn().mockResolvedValue(makeResult())
    const runner = { run: runMock } as unknown as SwarmRunner
    const bigDiff = Array.from({ length: 5000 }, (_, i) => `line ${i}`).join('\n')

    await runChunked(runner, { diff: bigDiff }, 2000)

    expect(runMock).toHaveBeenCalledTimes(3) // ceil(5000/2000)
  })

  it('merges findings, testFiles, and summary counts across chunks', async () => {
    const runMock = vi
      .fn()
      .mockResolvedValueOnce(
        makeResult({
          findings: [{ id: 'a', severity: 'high', agent: 'security' } as never],
          summary: { totalFindings: 1, bySeverity: { high: 1 }, byAgent: { security: 1 }, durationMs: 50 },
        })
      )
      .mockResolvedValueOnce(
        makeResult({
          findings: [{ id: 'b', severity: 'medium', agent: 'security' } as never],
          summary: { totalFindings: 1, bySeverity: { medium: 1 }, byAgent: { security: 1 }, durationMs: 60 },
        })
      )
    const runner = { run: runMock } as unknown as SwarmRunner
    const diff = Array.from({ length: 3000 }, (_, i) => `line ${i}`).join('\n')

    const merged = await runChunked(runner, { diff }, 2000)

    expect(merged.findings).toHaveLength(2)
    expect(merged.summary.totalFindings).toBe(2)
    expect(merged.summary.bySeverity).toEqual({ high: 1, medium: 1 })
    expect(merged.summary.durationMs).toBe(110)
  })

  it('stops after a chunk reports earlyExit, matching --fail-fast semantics', async () => {
    const runMock = vi
      .fn()
      .mockResolvedValueOnce(makeResult({ earlyExit: { stoppedAt: 'security' } }))
      .mockResolvedValueOnce(makeResult())
    const runner = { run: runMock } as unknown as SwarmRunner
    const diff = Array.from({ length: 5000 }, (_, i) => `line ${i}`).join('\n')

    await runChunked(runner, { diff }, 2000)

    expect(runMock).toHaveBeenCalledTimes(1) // stopped after the first chunk's earlyExit
  })

  it('does not report truncation on the merged result -- full coverage was achieved', async () => {
    const runMock = vi.fn().mockResolvedValue(makeResult())
    const runner = { run: runMock } as unknown as SwarmRunner
    const diff = Array.from({ length: 5000 }, (_, i) => `line ${i}`).join('\n')

    const merged = await runChunked(runner, { diff }, 2000)

    expect(merged.truncation).toBeUndefined()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/unit/chunkRunner.test.ts`
Expected: FAIL — `src/core/chunkRunner.ts` doesn't exist yet.

- [ ] **Step 4: Implement**

Create `src/core/chunkRunner.ts`:

```ts
// Orchestration wrapper for --chunk: splits an oversized diff into maxDiffLines-sized chunks and
// calls the existing SwarmRunner.run() once per chunk, UNCHANGED, then merges the resulting
// ReviewResults into one. Lives outside SwarmRunner deliberately -- this is new orchestration
// built on top of the existing review capability, not a change to how that capability itself
// works. See docs/superpowers/specs/2026-08-16-review-reliability-fixes-design.md, Issue 1.
//
// Known, accepted simplifications (documented, not fixed here -- same class of chunk-boundary
// limitation the design spec already accepts for "a function split across a chunk boundary"):
// chunks split on raw line count, not `diff --git` file boundaries, so a single file's diff
// section can itself be split across two chunks. Diagnostic/observability metadata (agentStatus,
// toolAvailability, policy, filteredFiles, context) reflects whichever chunk ran LAST, not a true
// merge across chunks -- acceptable for an opt-in feature; the actual review output (findings,
// testFiles, summary, sanitizer) IS fully merged below. Cross-chunk duplicate findings are not
// deduped (each chunk's own OrchestratorAgent.synthesize() call only ever sees that chunk's own
// findings) -- narrow in practice since chunks are non-overlapping diff content, and cosmetic (a
// near-duplicate finding shown twice) rather than a correctness problem.
import type { SwarmRunner } from './runner.js'
import type { ReviewInput, ReviewResult, AgentProgressEvent, GeneratedTestFile } from './schema.js'

export async function runChunked(
  runner: SwarmRunner,
  input: ReviewInput,
  maxDiffLines: number,
  onProgress?: (event: AgentProgressEvent) => void,
  contextMode: 'none' | 'memory-bank' = 'none'
): Promise<ReviewResult> {
  const lines = input.diff.split('\n')
  const diffLines = lines.length
  const chunkCount = Math.max(1, Math.ceil(diffLines / maxDiffLines))

  console.warn(
    `[ai-review] Diff split into ${chunkCount} chunk(s) of up to ${maxDiffLines} lines each ` +
      `(--chunk) -- full diff coverage, ${chunkCount}x the LLM calls.`
  )

  const results: ReviewResult[] = []
  for (let i = 0; i < chunkCount; i++) {
    const start = i * maxDiffLines
    const end = Math.min(start + maxDiffLines, diffLines)
    const chunkInput: ReviewInput = { ...input, diff: lines.slice(start, end).join('\n') }
    const result = await runner.run(chunkInput, onProgress, contextMode)
    results.push(result)
    if (result.earlyExit) break // --fail-fast should stop across chunks too, not just within one
  }

  return mergeResults(results)
}

function mergeResults(results: ReviewResult[]): ReviewResult {
  const findings = results.flatMap((r) => r.findings)
  const testFiles: GeneratedTestFile[] = results.flatMap((r) => r.testFiles)
  const durationMs = results.reduce((sum, r) => sum + r.summary.durationMs, 0)

  const bySeverity: Record<string, number> = {}
  const byAgent: Record<string, number> = {}
  for (const f of findings) {
    bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1
    byAgent[f.agent] = (byAgent[f.agent] ?? 0) + 1
  }

  const last = results[results.length - 1]
  const sanitizerApplied = results.some((r) => r.sanitizer?.applied)
  const sanitizerRedacted = results.reduce((sum, r) => sum + (r.sanitizer?.redactedLines ?? 0), 0)
  const sanitizerWarnings = results.flatMap((r) => r.sanitizer?.warnings ?? [])

  return {
    findings,
    testFiles,
    summary: { totalFindings: findings.length, bySeverity, byAgent, durationMs },
    ...(last.earlyExit ? { earlyExit: last.earlyExit } : {}),
    ...(last.context ? { context: last.context } : {}),
    sanitizer: {
      enabled: last.sanitizer?.enabled ?? true,
      applied: sanitizerApplied,
      redactedLines: sanitizerRedacted,
      warnings: sanitizerWarnings,
    },
    // Full coverage achieved across all chunks -- `truncation` is deliberately omitted, matching
    // cli/index.ts's exit-code priority (chunking and truncation are mutually exclusive outcomes
    // for a given run; see Task 13).
    ...(last.policy ? { policy: last.policy } : {}),
    ...(last.agentStatus ? { agentStatus: last.agentStatus } : {}),
    ...(last.hallucinationFilter ? { hallucinationFilter: last.hallucinationFilter } : {}),
    ...(last.coverageGapFilter ? { coverageGapFilter: last.coverageGapFilter } : {}),
    ...(last.toolAvailability ? { toolAvailability: last.toolAvailability } : {}),
    ...(last.evidenceCheckFilter ? { evidenceCheckFilter: last.evidenceCheckFilter } : {}),
    ...(last.filteredFiles ? { filteredFiles: last.filteredFiles } : {}),
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/chunkRunner.test.ts`
Expected: PASS

- [ ] **Step 6: Run full regression**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 0 typecheck errors, all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/core/chunkRunner.ts src/core/config.ts tests/unit/chunkRunner.test.ts
git commit -m "feat: add runChunked -- --chunk support as a wrapper outside SwarmRunner"
```

---

### Task 13: CLI — wire --chunk flag

**Files:**
- Modify: `src/cli/index.ts`
- Test: `tests/unit/cli.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('calls runChunked instead of runner.run directly when --chunk is passed', async () => {
  const runChunkedSpy = vi.spyOn(chunkRunnerModule, 'runChunked').mockResolvedValue(makeCleanResult())
  await expect(runCli(['--diff', 'x.diff', '--chunk'])).rejects.toThrow('process.exit(0)')
  expect(runChunkedSpy).toHaveBeenCalled()
})

it('does not call runChunked when --chunk is not passed', async () => {
  const runChunkedSpy = vi.spyOn(chunkRunnerModule, 'runChunked')
  vi.mocked(SwarmRunner.prototype.run).mockResolvedValue(makeCleanResult())
  await expect(runCli(['--diff', 'x.diff'])).rejects.toThrow('process.exit(0)')
  expect(runChunkedSpy).not.toHaveBeenCalled()
})
```

(Adjust the exact mocking mechanism — `vi.spyOn` on a namespace import vs. `vi.mock('../core/chunkRunner.js', ...)` — to match whatever pattern `tests/unit/cli.test.ts` already uses for mocking `SwarmRunner`; grep the file first.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/cli.test.ts`
Expected: FAIL — `--chunk` is not a recognized flag, `runChunked` is never called.

- [ ] **Step 3: Implement**

In `src/cli/index.ts`, add the import:

```ts
import { runChunked } from '../core/chunkRunner.js'
```

Add the option near `--max-lines`:

```ts
  .option(
    '--max-lines <n>', 'Truncate diff to this many lines (default: 2000)', parseInt
  )
  .option(
    '--chunk',
    'Instead of truncating an oversized diff, split it into multiple full-coverage passes ' +
      '(multiplies LLM calls by chunk count -- off by default)'
  )
```

Add `chunk?: boolean` to the action callback's options type, and:

```ts
        if (options.chunk) config.chunk = true
```

Replace the existing `const result = await runner.run(...)` call with a conditional:

```ts
        const diffLines = diff.split('\n').length
        const result =
          config.chunk && diffLines > config.maxDiffLines
            ? await runChunked(
                runner,
                { diff, projectPath },
                config.maxDiffLines,
                (event: AgentProgressEvent) => { /* same progress callback body as below */ },
                contextMode
              )
            : await runner.run(
                { diff, projectPath },
                (event: AgentProgressEvent) => { /* existing progress callback body, unchanged */ },
                contextMode
              )
```

(Factor the existing inline progress-callback function out into a named local function first, e.g. `const onProgress = (event: AgentProgressEvent) => { ... }` using the exact body already in `run()`'s current call, then pass `onProgress` to both branches above — avoids duplicating that callback body.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/cli.test.ts`
Expected: PASS

- [ ] **Step 5: Update README**

Add `--chunk` to the CLI flags table in `README.md`, next to `--allow-truncation` from Task 2.

- [ ] **Step 6: Run full regression**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 0 typecheck errors, all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/cli/index.ts tests/unit/cli.test.ts README.md
git commit -m "feat: wire --chunk CLI flag to runChunked"
```

---

### Task 14: Full regression pass + live end-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Full local check**

Run: `npx tsc --noEmit && npm run lint:eslint && npx vitest run`
Expected: 0 typecheck errors, 0 lint warnings, all tests pass.

- [ ] **Step 2: Live run against a real non-Node project diff**

Reproduce the original bug report as closely as possible: run `ai-review-agent --profile security --diff <patch>` against a real non-Node (e.g. Flutter/Dart) project with an oversized, mixed-content diff (some `.md`, some real source).

Confirm all four original symptoms are gone:
1. Diff truncation is either loud (exit code 3, or exit 1 if a real blocker is also present) or, with `--chunk`, fully covered.
2. `--format json` output is a well-formed array (Stage 2b's auto-wrap for a bare object should no longer be needed — Task 5's live sanity check already confirmed this once; this is the end-to-end confirmation). Note: the model may still only report one of several real findings in the diff — that's the separate, documented, out-of-scope under-reporting finding, not a regression from this fix.
3. No finding cites a `.md` file as vulnerable code from `security`/`adversarial`.
4. No "missing package.json" finding on the Dart project; `toolAvailability.npmAudit` (if present in `--format json` output) reads `"not-applicable"`.

- [ ] **Step 3: Update CHANGELOG.md**

Add an `## [Unreleased]` entry (or append to an existing one) summarizing all four fixes, matching this project's existing CHANGELOG entry style (grep a recent entry for the format).

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: changelog entry for review reliability fixes"
```

---

## Post-Plan Notes

- Task 3's live diagnostic (executed) ruled out the plan's original Issue 2 hypothesis (`num_predict`) entirely and found a different, verified root cause (a `format: 'json'` object-vs-array shape mismatch) — Tasks 4/5 were revised around that finding rather than the original `responseTokenBudget` design. A second, separate finding (the model under-reporting multiple real findings even with the shape fixed) was deliberately left unaddressed — see the design spec's Issue 2 Non-Goals. This is a real example of why Task 3 was scoped as "diagnose before fixing" rather than skipping straight to implementation.
- `--chunk`'s agentStatus/toolAvailability "last-chunk-wins" simplification (Task 12) is a deliberate, documented scope reduction, made deliberately simpler by keeping the feature outside `SwarmRunner` entirely (Tasks 12/13) rather than refactoring its internals — no orchestration-boundary changes anywhere in this plan. Revisit only if real `--chunk` usage shows it causing confusion in practice.
