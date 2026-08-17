# Evidence-Grounding Verification Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in, report-only verification pass that catches Critical/High findings whose own cited evidence doesn't support their claim, using a cross-model Ollama call plus a non-blocking deterministic pre-filter.

**Architecture:** A new `src/core/evidenceVerifier.ts` module exports `verifyEvidence` (one finding, one LLM call, retry + fail-open) and `runEvidenceChecks` (orchestrates the run: one up-front availability ping, iterate eligible findings, aggregate into `EvidenceCheckFilterMetadata`). `SwarmRunner` gets an optional third constructor param, `verifierProvider`, so the verifier's model stays a genuinely separate `LLMProvider` instance from the main review's — constructed only at the CLI/MCP boundary, matching how every other `LLMProvider` in this codebase is already injected rather than built inside `runner.ts`. Stage 1 only: nothing is dropped from `findings`, only reported via `ReviewResult.evidenceCheckFilter`.

**Tech Stack:** TypeScript, Vitest, Ollama (`qwen3:latest` default verifier model), existing `LLMProvider`/`OllamaProvider` abstractions.

**Spec:** `docs/superpowers/specs/2026-08-10-evidence-grounding-verification-design.md`

**Note:** two implementation refinements first drafted during planning (provider-injection instead of `(verifierModel, ollamaUrl)`; reusing `LLMProvider.ping()` instead of a separate `checkVerifierAvailable` function; adding `unavailableReasons: string[]` to `EvidenceCheckFilterMetadata`) were folded back into the spec itself after a post-review pass, so the spec and this plan now agree. See the spec's Architecture and Schema sections for the current, single source of truth on all three.

---

## File Structure

**Create:**

- `src/core/evidenceVerifier.ts` — `verifyEvidence`, `runEvidenceChecks`, the deterministic pre-filter table, the validated system prompt.
- `tests/unit/evidenceVerifier.test.ts`
- `calibration/evidenceVerifierCalibration.ts` — permanent, cleaned-up port of the scratch validation script; regression guard for verifier judgment quality.

**Modify:**

- `src/core/schema.ts` — `EvidenceCheckFinding`, `EvidenceCheckFilterMetadata`, `ReviewResult.evidenceCheckFilter`.
- `src/core/config.ts` — `verifyEvidence`, `verifierModel` on `ReviewConfig` + `DEFAULT_CONFIG`.
- `src/core/agents/orchestrator.ts` — export `DETERMINISTIC_SOURCES` (currently module-private) so `evidenceVerifier.ts` shares the same list instead of duplicating it.
- `src/core/runner.ts` — `SwarmRunner` takes an optional `verifierProvider`; new step after `synthesize()`.
- `src/cli/index.ts` — `--verify-evidence` flag; constructs `verifierProvider`.
- `src/mcp/tool.ts` — forces `config.verifyEvidence = false`.
- `src/cli/formatter.ts` — markdown block for `evidenceCheckFilter`.
- `src/cli/formatters/sarif.ts` — `evidenceCheckFilter` in run properties.
- `tests/unit/config.test.ts`, `tests/unit/runner.test.ts`, `tests/unit/mcp/tool.test.ts`, `tests/unit/formatters/markdown.test.ts`, `tests/unit/formatters/sarif.test.ts` — new coverage.
- `README.md`, `CHANGELOG.md` — docs.

---

### Task 1: Schema — evidence-check types

**Files:**

- Modify: `src/core/schema.ts`

- [ ] **Step 1: Add the new interfaces and wire them into `ReviewResult`**

In `src/core/schema.ts`, add after `CoverageGapFilterMetadata` (currently ends around line 138):

```ts
export interface EvidenceCheckFinding {
  agent: AgentName
  title: string
  file: string
  line: number
  claim: string
  evidence: string
  reason: string
  preFilterAgreed: boolean | null
}

export interface EvidenceCheckFilterMetadata {
  checkedCount: number
  unavailableCount: number
  unavailableReasons: string[]
  flagged: EvidenceCheckFinding[]
}
```

Then add one field to `ReviewResult` (after `coverageGapFilter?: CoverageGapFilterMetadata`):

```ts
  evidenceCheckFilter?: EvidenceCheckFilterMetadata
```

- [ ] **Step 2: Verify it compiles**

Run:

```bash
cd "C:\Users\Mizzo\Claude\AI-Code-Review-Agent" && npx tsc --noEmit
```

Expected: no errors (pure type addition, nothing references the new fields yet).

- [ ] **Step 3: Commit**

```bash
git add src/core/schema.ts
git commit -m "feat: add EvidenceCheckFinding/EvidenceCheckFilterMetadata schema"
```

---

### Task 2: Config — `verifyEvidence` / `verifierModel`

**Files:**

- Modify: `src/core/config.ts`
- Test: `tests/unit/config.test.ts`

- [ ] **Step 1: Write the failing test**

In `tests/unit/config.test.ts`, add inside the `describe('DEFAULT_CONFIG', ...)` block:

```ts
it('verifyEvidence defaults to false', () => {
  expect(DEFAULT_CONFIG.verifyEvidence).toBe(false)
})

it('verifierModel defaults to qwen3:latest', () => {
  expect(DEFAULT_CONFIG.verifierModel).toBe('qwen3:latest')
})
```

- [ ] **Step 2: Run it to verify it fails**

Run:

```bash
cd "C:\Users\Mizzo\Claude\AI-Code-Review-Agent" && npx vitest run tests/unit/config.test.ts
```

Expected: FAIL — `DEFAULT_CONFIG.verifyEvidence` is `undefined`.

- [ ] **Step 3: Add the fields**

In `src/core/config.ts`, add two fields to the `ReviewConfig` interface (after `agentPolicy`):

```ts
  verifyEvidence?: boolean
  verifierModel?: string
```

Add two fields to `DEFAULT_CONFIG` (after `parallel: false,`):

```ts
  // Opt-in: an unproven mechanism (cross-model LLM verification) stays off by default until
  // Stage 1's report-only rollout has real usage behind it -- see the design spec's Rollout
  // section. qwen3:latest got all 13 unique validation cases right, including the same 8
  // cases both times they were tested (docs/superpowers/specs/2026-08-10-evidence-grounding-
  // verification-design.md's Validation section).
  verifyEvidence: false,
  verifierModel: 'qwen3:latest',
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
cd "C:\Users\Mizzo\Claude\AI-Code-Review-Agent" && npx vitest run tests/unit/config.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/config.ts tests/unit/config.test.ts
git commit -m "feat: add verifyEvidence/verifierModel config fields"
```

---

### Task 3: Export `DETERMINISTIC_SOURCES` from orchestrator.ts

**Files:**

- Modify: `src/core/agents/orchestrator.ts:12`

- [ ] **Step 1: Add `export`**

In `src/core/agents/orchestrator.ts`, change:

```ts
const DETERMINISTIC_SOURCES: EvidenceSource[] = [
```

to:

```ts
export const DETERMINISTIC_SOURCES: EvidenceSource[] = [
```

- [ ] **Step 2: Verify nothing broke**

Run:

```bash
cd "C:\Users\Mizzo\Claude\AI-Code-Review-Agent" && npx vitest run tests/unit/orchestratorAgent.test.ts tests/unit/orchestrator.test.ts
```

Expected: PASS (pure export addition, no behavior change).

- [ ] **Step 3: Commit**

```bash
git add src/core/agents/orchestrator.ts
git commit -m "refactor: export DETERMINISTIC_SOURCES so evidenceVerifier can share it"
```

---

### Task 4: `evidenceVerifier.ts` — `verifyEvidence`

**Files:**

- Create: `src/core/evidenceVerifier.ts`
- Test: `tests/unit/evidenceVerifier.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/evidenceVerifier.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { verifyEvidence } from '../../src/core/evidenceVerifier.js'
import type { LLMProvider } from '../../src/core/llm/provider.js'
import type { Finding } from '../../src/core/schema.js'

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'security-0',
    agent: 'security',
    domain: 'Security',
    severity: 'high',
    basis: 'VERIFIED',
    file: 'src/auth.ts',
    line: 10,
    title: 'Lock failure not logged',
    detail: 'Lock acquisition failures are not logged, making debugging difficult.',
    evidence: 'echo "WARN: could not acquire session-claims lock, skipping" >&2',
    impact: 'test impact',
    recommendation: 'test recommendation',
    suggestion: 'test recommendation',
    blocking: false,
    source: 'llm',
    ...overrides,
  }
}

function makeProvider(chatImpl: LLMProvider['chat']): LLMProvider {
  return { chat: vi.fn(chatImpl), ping: vi.fn().mockResolvedValue({ ok: true }) }
}

describe('verifyEvidence', () => {
  it('returns verified:true on a SUPPORTED verdict', async () => {
    const provider = makeProvider(async () => 'VERDICT: SUPPORTED — evidence matches the claim.')
    const result = await verifyEvidence(makeFinding(), provider)
    expect(result.verified).toBe(true)
    expect(result.unavailable).toBe(false)
    // makeFinding()'s default evidence ("not logged" claim + an `echo` call) matches the
    // 'not-logged' pre-filter pattern (see the 'preFilterAgreed' tests below), and the LLM's
    // SUPPORTED verdict disagrees with what that pre-filter match implies.
    expect(result.preFilterAgreed).toBe(false)
  })

  it('returns verified:false on a NOT_SUPPORTED verdict', async () => {
    const provider = makeProvider(
      async () => 'VERDICT: NOT_SUPPORTED — the evidence shows the opposite of the claim.'
    )
    const result = await verifyEvidence(makeFinding(), provider)
    expect(result.verified).toBe(false)
    expect(result.reason).toContain('opposite')
  })

  it('fails open on an unparseable verdict, without retrying', async () => {
    const provider = makeProvider(async () => 'I am not sure about this one.')
    const result = await verifyEvidence(makeFinding(), provider)
    expect(result.verified).toBe(true)
    expect(result.unavailable).toBe(true)
    expect(result.reason).toContain('unparseable')
    expect(provider.chat).toHaveBeenCalledTimes(1)
  })

  it('retries once on a transient error, then fails open if it keeps failing', async () => {
    const provider = makeProvider(async () => {
      throw new Error('fetch failed')
    })
    const result = await verifyEvidence(makeFinding(), provider)
    expect(result.verified).toBe(true)
    expect(result.unavailable).toBe(true)
    expect(result.reason).toContain('verification unavailable')
    expect(provider.chat).toHaveBeenCalledTimes(2)
  })

  it('succeeds on the retry after one transient failure', async () => {
    let calls = 0
    const provider = makeProvider(async () => {
      calls++
      if (calls === 1) throw new Error('fetch failed')
      return 'VERDICT: SUPPORTED — fine on retry.'
    })
    const result = await verifyEvidence(makeFinding(), provider)
    expect(result.verified).toBe(true)
    expect(result.unavailable).toBe(false)
    expect(provider.chat).toHaveBeenCalledTimes(2)
  })

  it('sets preFilterAgreed:true when the deterministic pre-filter and the LLM agree', async () => {
    const provider = makeProvider(async () => 'VERDICT: NOT_SUPPORTED — logging already exists.')
    // makeFinding()'s default title/detail/evidence is exactly the "not logged" vs. a log call
    // shape the pre-filter's 'not-logged' pattern targets.
    const result = await verifyEvidence(makeFinding(), provider)
    expect(result.preFilterAgreed).toBe(true)
  })

  it('sets preFilterAgreed:false when the pre-filter matches but the LLM disagrees', async () => {
    const provider = makeProvider(
      async () => 'VERDICT: SUPPORTED — evidence genuinely lacks logging.'
    )
    const result = await verifyEvidence(makeFinding(), provider)
    expect(result.preFilterAgreed).toBe(false)
    // Critically: the pre-filter match never overrides the LLM's own verdict in Stage 1.
    expect(result.verified).toBe(true)
  })

  it('sets preFilterAgreed:null when no pre-filter pattern applies', async () => {
    const provider = makeProvider(async () => 'VERDICT: NOT_SUPPORTED — unrelated mismatch.')
    const result = await verifyEvidence(
      makeFinding({
        title: 'Breaking change',
        detail: 'This is called a breaking change but is purely additive.',
        evidence: '+ "SessionStart": [{"matcher": "*"}]',
      }),
      provider
    )
    expect(result.preFilterAgreed).toBe(null)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run:

```bash
cd "C:\Users\Mizzo\Claude\AI-Code-Review-Agent" && npx vitest run tests/unit/evidenceVerifier.test.ts
```

Expected: FAIL — `src/core/evidenceVerifier.ts` does not exist yet.

- [ ] **Step 3: Implement `verifyEvidence`**

Create `src/core/evidenceVerifier.ts`:

```ts
import type { LLMProvider, Message } from './llm/provider.js'
import type { Finding, EvidenceCheckFinding, EvidenceCheckFilterMetadata } from './schema.js'
import { DETERMINISTIC_SOURCES } from './agents/orchestrator.js'

const RETRY_DELAY_MS = 1000

// Validated against 13 unique synthetic cases spanning both evidence-contradicts-claim and
// genuinely-correct-finding controls -- qwen3:latest scored 13/13, including the same 8 cases
// both times they were tested across two validation rounds. See docs/superpowers/specs/
// 2026-08-10-evidence-grounding-verification-design.md's Validation section. Not tuned further
// without re-validating.
const SYSTEM_PROMPT = `You are verifying a code review finding, written by someone else. You did not write this finding and have no stake in it being correct -- evaluate it fresh and skeptically.

You will be given a CLAIM and the EVIDENCE cited to support it. Read the evidence literally and carefully. If the evidence shows the exact opposite of what's claimed (e.g. a guard/check that IS present when the claim says it's missing), the claim is NOT_SUPPORTED, regardless of how plausible the claim sounds on its own.

Respond with exactly one line in this format: VERDICT: <SUPPORTED or NOT_SUPPORTED> — <one sentence reason>`

interface PreFilterPattern {
  name: string
  claimPattern: RegExp
  evidencePattern: RegExp
}

// Only ever used as a second, independent signal alongside the LLM verdict (preFilterAgreed) --
// never to skip the LLM call or stand alone as a verdict. This codebase's evidence snippets can
// carry diff context ("- console.log(...)" for a removed line, or a commented-out call), which a
// naive text match can't distinguish from currently-executing code -- letting a match veto a
// finding outright risked a confident-looking false rejection with nothing downstream to catch
// it. See the design spec's Architecture section (pre-filter) for the full reasoning.
const PRE_FILTER_PATTERNS: PreFilterPattern[] = [
  {
    name: 'not-logged',
    claimPattern: /\bnot logged\b|\bisn't logged\b|\bno logging\b/i,
    // `echo` has no parenthesized-call form in shell (unlike log(...)/logger.x(...)/console.x(...)),
    // so it's matched as a bare keyword rather than requiring a trailing "(".
    evidencePattern: /\b(log|logger|console\.\w+)\s*\(|\becho\b/i,
  },
  {
    name: 'not-closed',
    claimPattern: /\bnot (explicitly )?closed\b|\bnever closes?\b/i,
    evidencePattern: /\bwith\b[^\n]*\bas\b|\.close\(\)|\bfinally\b/i,
  },
  {
    name: 'not-validated',
    claimPattern: /\bnot validated\b|\bno validation\b|\bnot checked\b/i,
    evidencePattern: /\bif\s*\(|\bassert\b|\bthrow\b/i,
  },
]

function matchPreFilter(claim: string, evidence: string): string | null {
  const pattern = PRE_FILTER_PATTERNS.find(
    (p) => p.claimPattern.test(claim) && p.evidencePattern.test(evidence)
  )
  return pattern?.name ?? null
}

export interface VerifyEvidenceResult {
  verified: boolean
  reason: string
  preFilterAgreed: boolean | null
  unavailable: boolean
}

// Deliberately takes an already-constructed LLMProvider rather than (verifierModel, ollamaUrl) --
// matches how every existing agent takes `provider: LLMProvider` via constructor injection, and
// the caller (runEvidenceChecks) is the one responsible for constructing a verifier-model
// instance that's genuinely independent from the main review's provider.
export async function verifyEvidence(
  finding: Finding,
  provider: LLMProvider
): Promise<VerifyEvidenceResult> {
  const claim = `${finding.title} ${finding.detail}`
  const evidence = finding.evidence
  const matchedPattern = matchPreFilter(claim, evidence)

  const messages: Message[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `CLAIM: ${claim}\n\nEVIDENCE:\n${evidence}` },
  ]

  let lastErr: Error | null = null
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await provider.chat(messages)
      const match = raw.match(/VERDICT:\s*(SUPPORTED|NOT_SUPPORTED)/i)
      if (!match) {
        console.error(
          `[evidenceVerifier] unparseable verdict for "${finding.title}": ${raw.slice(0, 200)}`
        )
        return {
          verified: true,
          reason: 'verification unavailable — unparseable verdict from verifier model',
          preFilterAgreed: null,
          unavailable: true,
        }
      }
      const notSupported = match[1].toUpperCase() === 'NOT_SUPPORTED'
      const reason = raw.replace(/^VERDICT:\s*(SUPPORTED|NOT_SUPPORTED)\s*[—-]?\s*/i, '').trim()
      return {
        verified: !notSupported,
        reason: reason || raw.trim(),
        preFilterAgreed: matchedPattern === null ? null : notSupported,
        unavailable: false,
      }
    } catch (err) {
      lastErr = err as Error
      if (attempt === 0) {
        console.warn(
          `[evidenceVerifier] verification call failed for "${finding.title}" (attempt 1/2): ` +
            `${lastErr.message} — retrying in ${RETRY_DELAY_MS}ms`
        )
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS))
      }
    }
  }
  console.error(
    `[evidenceVerifier] verification unavailable for "${finding.title}": ${lastErr?.message}`
  )
  return {
    verified: true,
    reason: `verification unavailable — ${lastErr?.message}`,
    preFilterAgreed: null,
    unavailable: true,
  }
}
```

(`runEvidenceChecks` is added in Task 5 — this step only needs `verifyEvidence` to make Task 4's tests pass. `EvidenceCheckFinding`/`EvidenceCheckFilterMetadata` imports are unused until then; that's fine, they're used by Task 5 in the same file.)

- [ ] **Step 4: Run the tests to verify they pass**

Run:

```bash
cd "C:\Users\Mizzo\Claude\AI-Code-Review-Agent" && npx vitest run tests/unit/evidenceVerifier.test.ts
```

Expected: PASS (8 tests)

- [ ] **Step 5: Typecheck**

Run:

```bash
cd "C:\Users\Mizzo\Claude\AI-Code-Review-Agent" && npx tsc --noEmit
```

Expected: no errors, aside from the two unused-import names — if `tsc` flags them (depends on `noUnusedLocals`), remove `EvidenceCheckFinding`/`EvidenceCheckFilterMetadata` from this step's import line and re-add them in Task 5's edit instead.

- [ ] **Step 6: Commit**

```bash
git add src/core/evidenceVerifier.ts tests/unit/evidenceVerifier.test.ts
git commit -m "feat: add verifyEvidence with deterministic pre-filter and retry"
```

---

### Task 5: `evidenceVerifier.ts` — `runEvidenceChecks`

**Files:**

- Modify: `src/core/evidenceVerifier.ts`
- Test: `tests/unit/evidenceVerifier.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/evidenceVerifier.test.ts` (new imports at top: add `runEvidenceChecks` to the existing import from `'../../src/core/evidenceVerifier.js'`):

```ts
describe('runEvidenceChecks', () => {
  it('returns undefined when there are no critical/high candidates', async () => {
    const provider = makeProvider(async () => 'VERDICT: SUPPORTED — fine.')
    const result = await runEvidenceChecks([makeFinding({ severity: 'medium' })], provider)
    expect(result).toBeUndefined()
    expect(provider.chat).not.toHaveBeenCalled()
    expect(provider.ping).not.toHaveBeenCalled()
  })

  it('skips findings from DETERMINISTIC_SOURCES', async () => {
    const provider = makeProvider(async () => 'VERDICT: SUPPORTED — fine.')
    const result = await runEvidenceChecks(
      [makeFinding({ severity: 'critical', source: 'gitleaks' })],
      provider
    )
    expect(result).toBeUndefined()
    expect(provider.chat).not.toHaveBeenCalled()
  })

  it('checks eligible findings and reports checkedCount/unavailableCount/flagged', async () => {
    const provider = makeProvider(async () => 'VERDICT: NOT_SUPPORTED — contradiction found.')
    const finding = makeFinding({ severity: 'critical' })
    const result = await runEvidenceChecks([finding], provider)
    expect(result).toEqual({
      checkedCount: 1,
      unavailableCount: 0,
      unavailableReasons: [],
      flagged: [
        {
          agent: finding.agent,
          title: finding.title,
          file: finding.file,
          line: finding.line,
          claim: `${finding.title} ${finding.detail}`,
          evidence: finding.evidence,
          reason: 'contradiction found.',
          preFilterAgreed: true,
        },
      ],
    })
  })

  it('does not add a SUPPORTED finding to flagged', async () => {
    const provider = makeProvider(async () => 'VERDICT: SUPPORTED — evidence matches.')
    const result = await runEvidenceChecks([makeFinding({ severity: 'high' })], provider)
    expect(result?.flagged).toEqual([])
    expect(result?.checkedCount).toBe(1)
  })

  it('checks the verifier model once up front and short-circuits every finding if unavailable', async () => {
    const provider: LLMProvider = {
      chat: vi.fn(),
      ping: vi.fn().mockResolvedValue({
        ok: false,
        error: 'Model qwen3:latest not found. Run: ollama pull qwen3:latest',
      }),
    }
    const findings = [
      makeFinding({ severity: 'critical', id: 'a' }),
      makeFinding({ severity: 'high', id: 'b' }),
    ]
    const result = await runEvidenceChecks(findings, provider)
    expect(result).toEqual({
      checkedCount: 2,
      unavailableCount: 2,
      unavailableReasons: ['Model qwen3:latest not found. Run: ollama pull qwen3:latest'],
      flagged: [],
    })
    // The whole point: not one call per finding when the model just isn't there.
    expect(provider.chat).not.toHaveBeenCalled()
    expect(provider.ping).toHaveBeenCalledTimes(1)
  })

  it('never puts a fail-open (unavailable) result into flagged', async () => {
    const provider = makeProvider(async () => {
      throw new Error('timeout')
    })
    const result = await runEvidenceChecks([makeFinding({ severity: 'critical' })], provider)
    expect(result?.flagged).toEqual([])
    expect(result?.unavailableCount).toBe(1)
    expect(result?.unavailableReasons[0]).toContain('verification unavailable')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run:

```bash
cd "C:\Users\Mizzo\Claude\AI-Code-Review-Agent" && npx vitest run tests/unit/evidenceVerifier.test.ts
```

Expected: FAIL — `runEvidenceChecks` is not exported.

- [ ] **Step 3: Implement `runEvidenceChecks`**

Append to `src/core/evidenceVerifier.ts` (the `EvidenceCheckFinding`/`EvidenceCheckFilterMetadata` types imported at the top of the file in Task 4 are used here):

```ts
// Runs the up-front availability check once, then verifyEvidence for each eligible finding.
// Only Critical/High findings from non-deterministic sources are eligible -- DETERMINISTIC_SOURCES
// findings are tool output, not model reasoning, so there's nothing an evidence check would
// usefully catch; it would just spend latency confirming a tool's own report matches itself.
//
// Returns undefined when there's nothing eligible at all, so ReviewResult.evidenceCheckFilter
// stays absent on runs where this had nothing to do (matching truncation/policy's existing
// "only present when relevant" convention). Once it DOES run, checkedCount/unavailableCount are
// always present even with zero flagged findings -- --format json tracking (see design spec's
// Tracking section) depends on that ratio being computable for every run that checked anything,
// not just runs that found something wrong.
export async function runEvidenceChecks(
  findings: Finding[],
  provider: LLMProvider
): Promise<EvidenceCheckFilterMetadata | undefined> {
  const candidates = findings.filter(
    (f) =>
      (f.severity === 'critical' || f.severity === 'high') &&
      !DETERMINISTIC_SOURCES.includes(f.source)
  )
  if (candidates.length === 0) return undefined

  // Checked once, up front -- not discovered incrementally on the first per-finding call. If the
  // model simply isn't pulled, looping through every finding anyway (each paying its own retry +
  // backoff) before the run finally completes would multiply a guaranteed, unrecoverable failure
  // across every finding for no benefit.
  const ping = await provider.ping()
  if (!ping.ok) {
    const reason = ping.error ?? 'verifier model unavailable'
    console.error(`[evidenceVerifier] verifier model unavailable: ${reason}`)
    return {
      checkedCount: candidates.length,
      unavailableCount: candidates.length,
      unavailableReasons: [reason],
      flagged: [],
    }
  }

  const flagged: EvidenceCheckFinding[] = []
  const unavailableReasons = new Set<string>()
  let unavailableCount = 0

  for (const finding of candidates) {
    const result = await verifyEvidence(finding, provider)
    if (result.unavailable) {
      unavailableCount++
      unavailableReasons.add(result.reason)
      continue
    }
    // flagged contains only genuine NOT_SUPPORTED verdicts -- a fail-open result never appears
    // here (handled above), since "we couldn't check this" and "we checked this and it failed"
    // are different report states.
    if (!result.verified) {
      flagged.push({
        agent: finding.agent,
        title: finding.title,
        file: finding.file,
        line: finding.line,
        claim: `${finding.title} ${finding.detail}`,
        evidence: finding.evidence,
        reason: result.reason,
        preFilterAgreed: result.preFilterAgreed,
      })
    }
  }

  return {
    checkedCount: candidates.length,
    unavailableCount,
    unavailableReasons: [...unavailableReasons],
    flagged,
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:

```bash
cd "C:\Users\Mizzo\Claude\AI-Code-Review-Agent" && npx vitest run tests/unit/evidenceVerifier.test.ts
```

Expected: PASS (14 tests total)

- [ ] **Step 5: Commit**

```bash
git add src/core/evidenceVerifier.ts tests/unit/evidenceVerifier.test.ts
git commit -m "feat: add runEvidenceChecks orchestration with once-per-run availability check"
```

---

### Task 6: Wire into `runner.ts`

**Files:**

- Modify: `src/core/runner.ts`
- Test: `tests/unit/runner.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/runner.test.ts` (new imports: `runEvidenceChecks` is not directly used by these tests — they go through `SwarmRunner.run()` — but the mocked verifier provider is, so add `type { LLMProvider }` is already imported):

```ts
describe('evidence verification', () => {
  const evidenceFinding = () => ({
    id: 'security-0',
    agent: 'security' as const,
    domain: 'Security' as const,
    severity: 'critical' as const,
    basis: 'VERIFIED' as const,
    file: 'src/a.ts',
    line: 1,
    title: 'Test finding',
    detail: 'Some detail',
    evidence: 'some evidence',
    impact: 'impact',
    recommendation: 'fix it',
    suggestion: 'fix it',
    blocking: false,
    source: 'llm' as const,
  })

  it('does not run evidence checks when verifyEvidence is false (default)', async () => {
    const provider = makeProvider()
    const verifierProvider: LLMProvider = { chat: vi.fn(), ping: vi.fn() }
    const config = { ...DEFAULT_CONFIG, agents: ['security'] as AgentName[] }
    const runner = new SwarmRunner(config, provider, verifierProvider)
    const result = await runner.run({ diff: 'diff' })
    expect(result.evidenceCheckFilter).toBeUndefined()
    expect(verifierProvider.ping).not.toHaveBeenCalled()
  })

  it('does not run evidence checks when verifyEvidence is true but no verifierProvider is supplied', async () => {
    const provider = makeProvider()
    const config = { ...DEFAULT_CONFIG, agents: ['security'] as AgentName[], verifyEvidence: true }
    const runner = new SwarmRunner(config, provider)
    const result = await runner.run({ diff: 'diff' })
    expect(result.evidenceCheckFilter).toBeUndefined()
  })

  it('runs evidence checks and populates evidenceCheckFilter when enabled', async () => {
    // security agent returns one critical finding; verifier says NOT_SUPPORTED.
    const provider: LLMProvider = {
      chat: vi.fn().mockResolvedValue(JSON.stringify([evidenceFinding()])),
      ping: vi.fn().mockResolvedValue({ ok: true }),
    }
    const verifierProvider: LLMProvider = {
      chat: vi.fn().mockResolvedValue('VERDICT: NOT_SUPPORTED — evidence contradicts the claim.'),
      ping: vi.fn().mockResolvedValue({ ok: true }),
    }
    const config = { ...DEFAULT_CONFIG, agents: ['security'] as AgentName[], verifyEvidence: true }
    const runner = new SwarmRunner(config, provider, verifierProvider)
    const result = await runner.run({ diff: 'diff' })
    expect(result.evidenceCheckFilter).toBeDefined()
    expect(result.evidenceCheckFilter?.checkedCount).toBe(1)
    expect(result.evidenceCheckFilter?.flagged).toHaveLength(1)
    expect(verifierProvider.chat).toHaveBeenCalledTimes(1)
    // The main review provider and the verifier provider must stay separate instances.
    expect(provider.chat).not.toBe(verifierProvider.chat)
  })
})
```

Note: `security` agent's real prompt parsing is exercised elsewhere; this test only needs `provider.chat` to return something `SecurityAgent`'s parser accepts as one finding. If `JSON.stringify([evidenceFinding()])` doesn't parse cleanly through `SecurityAgent`'s real output format, use the same finding-returning mock pattern already established in `tests/unit/securityAgent.test.ts` instead — check that file's `makeProvider`/response format before finalizing this step's exact response string.

- [ ] **Step 2: Run to verify it fails**

Run:

```bash
cd "C:\Users\Mizzo\Claude\AI-Code-Review-Agent" && npx vitest run tests/unit/runner.test.ts -t "evidence verification"
```

Expected: FAIL — `SwarmRunner` doesn't accept a third constructor argument yet, and `evidenceCheckFilter` is never set.

- [ ] **Step 3: Wire `verifierProvider` into `SwarmRunner`**

In `src/core/runner.ts`, add to the top-level type imports (the `import type { ... } from './schema.js'` block):

```ts
  EvidenceCheckFilterMetadata,
```

Add a new value import near the top (with the other local imports):

```ts
import { runEvidenceChecks } from './evidenceVerifier.js'
```

Change the constructor:

```ts
  constructor(
    private readonly config: ReviewConfig,
    private readonly provider: LLMProvider,
    private readonly verifierProvider?: LLMProvider
  ) {
    this.orchestrator = new OrchestratorAgent(config)
    this.testGen = new TestGenAgent(provider, config)
  }
```

- [ ] **Step 4: Call `runEvidenceChecks` after synthesis**

In `run()`, replace:

```ts
    const droppedHallucinated: DroppedHallucinatedFinding[] = []
    const findings = this.orchestrator.synthesize(allFindings, changedFiles, droppedHallucinated)

    return {
```

with:

```ts
    const droppedHallucinated: DroppedHallucinatedFinding[] = []
    const findings = this.orchestrator.synthesize(allFindings, changedFiles, droppedHallucinated)

    const evidenceCheckFilter: EvidenceCheckFilterMetadata | undefined =
      this.config.verifyEvidence && this.verifierProvider
        ? await runEvidenceChecks(findings, this.verifierProvider)
        : undefined

    return {
```

And add one more spread entry at the end of the returned object, after `...(Object.keys(toolAvailability).length > 0 ? { toolAvailability } : {}),`:

```ts
      ...(evidenceCheckFilter ? { evidenceCheckFilter } : {}),
```

- [ ] **Step 5: Run the tests to verify they pass**

Run:

```bash
cd "C:\Users\Mizzo\Claude\AI-Code-Review-Agent" && npx vitest run tests/unit/runner.test.ts
```

Expected: PASS (all existing runner tests plus the 3 new ones — the optional constructor param means every existing `new SwarmRunner(config, provider)` call site still compiles and behaves identically).

- [ ] **Step 6: Full test suite + typecheck**

Run:

```bash
cd "C:\Users\Mizzo\Claude\AI-Code-Review-Agent" && npx tsc --noEmit && npx vitest run
```

Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add src/core/runner.ts tests/unit/runner.test.ts
git commit -m "feat: wire evidence verification into SwarmRunner"
```

---

### Task 7: CLI — `--verify-evidence` flag

**Files:**

- Modify: `src/cli/index.ts`
- Test: `tests/unit/cli.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/cli.test.ts`, near the existing `--parallel` tests:

```ts
it('--verify-evidence enables evidence verification and constructs a verifier provider', async () => {
  MockSwarmRunner.mockImplementation(() => ({
    run: vi.fn().mockResolvedValue(makeResult()),
  }))
  await runCli(['--verify-evidence'])
  const config = MockSwarmRunner.mock.calls[0][0]
  const verifierProvider = MockSwarmRunner.mock.calls[0][2]
  expect(config.verifyEvidence).toBe(true)
  expect(verifierProvider).toBeDefined()
})

it('leaves verifyEvidence off and passes no verifier provider by default', async () => {
  MockSwarmRunner.mockImplementation(() => ({
    run: vi.fn().mockResolvedValue(makeResult()),
  }))
  await runCli([])
  const config = MockSwarmRunner.mock.calls[0][0]
  const verifierProvider = MockSwarmRunner.mock.calls[0][2]
  expect(config.verifyEvidence).toBe(false)
  expect(verifierProvider).toBeUndefined()
})
```

Check this file's existing helper functions (`runCli`, `makeResult`) before adding — reuse them as-is; they already exist above the `--parallel` tests you're inserting next to.

- [ ] **Step 2: Run to verify it fails**

Run:

```bash
cd "C:\Users\Mizzo\Claude\AI-Code-Review-Agent" && npx vitest run tests/unit/cli.test.ts -t "verify-evidence"
```

Expected: FAIL — flag doesn't exist yet.

- [ ] **Step 3: Add the flag and wire it up**

In `src/cli/index.ts`, add the option after `--no-emoji`:

```ts
  .option(
    '--verify-evidence',
    'Verify Critical/High findings against their own cited evidence using a separate model (report-only in this version -- flags possibly-unsupported findings without dropping them; adds one LLM call per checked finding)'
  )
```

Add `verifyEvidence?: boolean` to the action handler's options type (after `emoji: boolean`):

```ts
      emoji: boolean
      verifyEvidence?: boolean
    }) => {
```

Inside the action handler, after `config.parallel = !!options.parallel`, add:

```ts
if (options.verifyEvidence) config.verifyEvidence = true
```

Change the provider/runner construction from:

```ts
const provider = new OllamaProvider(config.ollamaUrl, config.model)
const runner = new SwarmRunner(config, provider)
```

to:

```ts
const provider = new OllamaProvider(config.ollamaUrl, config.model)
// Deliberately a separate OllamaProvider instance/model from the main review's --
// cross-model verification only works if the verifier has no memory of the original
// claim. See docs/superpowers/specs/2026-08-10-evidence-grounding-verification-design.md.
const verifierProvider = config.verifyEvidence
  ? new OllamaProvider(config.ollamaUrl, config.verifierModel ?? 'qwen3:latest')
  : undefined
const runner = new SwarmRunner(config, provider, verifierProvider)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:

```bash
cd "C:\Users\Mizzo\Claude\AI-Code-Review-Agent" && npx vitest run tests/unit/cli.test.ts
```

Expected: PASS (all existing CLI tests plus the 2 new ones)

- [ ] **Step 5: Commit**

```bash
git add src/cli/index.ts tests/unit/cli.test.ts
git commit -m "feat: add --verify-evidence CLI flag"
```

---

### Task 8: MCP — force `verifyEvidence` off

**Files:**

- Modify: `src/mcp/tool.ts`
- Test: `tests/unit/mcp/tool.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/mcp/tool.test.ts`, near the existing `'excludes testgen from agents regardless of config'` test. First check that test's exact `loadConfig` mock shape (shown above — it's a plain object literal, not `DEFAULT_CONFIG`-spread, so add `verifyEvidence: true` to whatever mock config object this new test constructs):

```ts
it('forces verifyEvidence off regardless of config', async () => {
  mockSpawnSync.mockReturnValue({
    status: 0,
    stdout: 'diff --git a/f.ts b/f.ts\n+line',
  } as unknown as SpawnSyncReturns<string>)
  const { loadConfig } = await import('../../../src/core/config.js')
  vi.mocked(loadConfig).mockReturnValueOnce({
    model: 'devstral:latest',
    provider: 'ollama',
    ollamaUrl: 'http://localhost:11434',
    maxFindings: 15,
    agents: ['security'],
    testOutputDir: './ai-review-tests',
    maxDiffLines: 2000,
    agentTimeoutMs: 60000,
    ignorePaths: [],
    sanitize: true,
    verifyEvidence: true, // config says on -- MCP must still force it off
  } as unknown as Parameters<typeof loadConfig>[0] extends never
    ? never
    : ReturnType<typeof loadConfig>)
  const { SwarmRunner } = await import('../../../src/core/runner.js')
  const runMock = vi.fn().mockResolvedValue({
    findings: [],
    testFiles: [],
    summary: { totalFindings: 0, bySeverity: {}, byAgent: {}, durationMs: 10 },
  })
  vi.mocked(SwarmRunner).mockImplementationOnce((config: Parameters<typeof SwarmRunner>[0]) => {
    expect(config.verifyEvidence).toBe(false)
    return { run: runMock } as unknown as InstanceType<typeof SwarmRunner>
  })
  await runReviewTool({})
})
```

The `as unknown as ... extends never ? never : ...` cast above is defensive against this file's config mock object being incomplete relative to the real `ReviewConfig` (as seen in the existing `'excludes testgen'` test at `tests/unit/mcp/tool.test.ts:138-151`, which also omits several current `ReviewConfig` fields). If that existing test already uses a simpler cast or none at all when you open the file, match its existing style instead of introducing a new casting pattern.

- [ ] **Step 2: Run to verify it fails**

Run:

```bash
cd "C:\Users\Mizzo\Claude\AI-Code-Review-Agent" && npx vitest run tests/unit/mcp/tool.test.ts -t "forces verifyEvidence off"
```

Expected: FAIL — `config.verifyEvidence` is still `true`.

- [ ] **Step 3: Force it off**

In `src/mcp/tool.ts`, after:

```ts
config.agents = config.agents.filter((a): a is AgentName => !MCP_EXCLUDED_AGENTS.includes(a))
```

add:

```ts
// Evidence verification adds a synchronous per-finding LLM round-trip -- not worth the latency
// for an interactive MCP caller waiting on the response, and Stage 1 is report-only anyway
// (nothing is dropped), so there's little payoff for the cost here. Force off regardless of
// what the project config says, mirroring the testgen exclusion above.
config.verifyEvidence = false
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:

```bash
cd "C:\Users\Mizzo\Claude\AI-Code-Review-Agent" && npx vitest run tests/unit/mcp/tool.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/mcp/tool.ts tests/unit/mcp/tool.test.ts
git commit -m "fix: force verifyEvidence off for MCP callers"
```

---

### Task 9: Markdown formatter block

**Files:**

- Modify: `src/cli/formatter.ts`
- Test: `tests/unit/formatters/markdown.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/formatters/markdown.test.ts`:

```ts
describe('evidenceCheckFilter', () => {
  it('shows checked/flagged/unavailable counts', () => {
    const result = makeResult({
      evidenceCheckFilter: {
        checkedCount: 3,
        unavailableCount: 1,
        unavailableReasons: ['verification unavailable — timeout'],
        flagged: [
          {
            agent: 'security',
            title: 'Test finding',
            file: 'src/a.ts',
            line: 10,
            claim: 'Test finding claim',
            evidence: 'some evidence',
            reason: 'evidence contradicts the claim',
            preFilterAgreed: true,
          },
        ],
      },
    })
    const output = formatMarkdown(result)
    expect(output).toContain('3 finding(s) checked')
    expect(output).toContain('1 flagged')
    expect(output).toContain('1 unavailable')
    expect(output).toContain('evidence contradicts the claim')
    expect(output).toContain('src/a.ts:10')
  })

  it('is omitted entirely when evidenceCheckFilter is absent', () => {
    const output = formatMarkdown(makeResult())
    expect(output).not.toContain('Evidence check')
  })

  it('reports zero flagged findings without listing any', () => {
    const result = makeResult({
      evidenceCheckFilter: {
        checkedCount: 2,
        unavailableCount: 0,
        unavailableReasons: [],
        flagged: [],
      },
    })
    const output = formatMarkdown(result)
    expect(output).toContain('2 finding(s) checked')
    expect(output).toContain('none flagged')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run:

```bash
cd "C:\Users\Mizzo\Claude\AI-Code-Review-Agent" && npx vitest run tests/unit/formatters/markdown.test.ts -t "evidenceCheckFilter"
```

Expected: FAIL — no such block in the output yet.

- [ ] **Step 3: Add the block**

In `src/cli/formatter.ts`, after the `coverageGapFilter` block (right before the `TOOL_LABELS` comment), add:

```ts
if (result.evidenceCheckFilter) {
  const { checkedCount, unavailableCount, unavailableReasons, flagged } = result.evidenceCheckFilter
  lines.push(
    `${useEmoji ? '🔍 ' : ''}Evidence check: ${checkedCount} finding(s) checked` +
      (flagged.length > 0
        ? `, ${flagged.length} flagged as possibly unsupported by their own cited evidence`
        : ', none flagged') +
      (unavailableCount > 0
        ? `, ${unavailableCount} unavailable (verifier could not be reached)`
        : '') +
      '.'
  )
  if (unavailableReasons.length > 0) {
    lines.push(`  ${unavailableReasons.join('; ')}`)
  }
  for (const f of flagged) {
    lines.push(
      `  - **${f.title}** (${f.file}:${f.line}, ${f.agent}) — ${f.reason}` +
        (f.preFilterAgreed === true ? ' [deterministic pre-filter agreed]' : '')
    )
  }
  lines.push('')
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:

```bash
cd "C:\Users\Mizzo\Claude\AI-Code-Review-Agent" && npx vitest run tests/unit/formatters/markdown.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/formatter.ts tests/unit/formatters/markdown.test.ts
git commit -m "feat: surface evidenceCheckFilter in markdown report"
```

---

### Task 10: SARIF formatter

**Files:**

- Modify: `src/cli/formatters/sarif.ts`
- Test: `tests/unit/formatters/sarif.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/formatters/sarif.test.ts`:

```ts
it('includes evidenceCheckFilter in run properties when present', () => {
  const result = makeResult({
    evidenceCheckFilter: {
      checkedCount: 1,
      unavailableCount: 0,
      unavailableReasons: [],
      flagged: [],
    },
  })
  const output = JSON.parse(formatSarif(result))
  expect(output.runs[0].properties.evidenceCheckFilter).toEqual({
    checkedCount: 1,
    unavailableCount: 0,
    unavailableReasons: [],
    flagged: [],
  })
})

it('omits evidenceCheckFilter from properties when absent', () => {
  const output = JSON.parse(formatSarif(makeResult()))
  expect(output.runs[0].properties.evidenceCheckFilter).toBeUndefined()
})
```

- [ ] **Step 2: Run to verify it fails**

Run:

```bash
cd "C:\Users\Mizzo\Claude\AI-Code-Review-Agent" && npx vitest run tests/unit/formatters/sarif.test.ts -t "evidenceCheckFilter"
```

Expected: FAIL — property not present.

- [ ] **Step 3: Add it**

In `src/cli/formatters/sarif.ts`, add one entry to the `properties` object, after `...(result.toolAvailability ? { toolAvailability: result.toolAvailability } : {}),`:

```ts
          ...(result.evidenceCheckFilter ? { evidenceCheckFilter: result.evidenceCheckFilter } : {}),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:

```bash
cd "C:\Users\Mizzo\Claude\AI-Code-Review-Agent" && npx vitest run tests/unit/formatters/sarif.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/formatters/sarif.ts tests/unit/formatters/sarif.test.ts
git commit -m "feat: surface evidenceCheckFilter in SARIF output"
```

---

### Task 11: Full regression pass

**Files:** none (verification only)

- [ ] **Step 1: Run the entire suite and typecheck**

Run:

```bash
cd "C:\Users\Mizzo\Claude\AI-Code-Review-Agent" && npx tsc --noEmit && npx vitest run
```

Expected: all green, zero failures, zero type errors. This is the checkpoint before touching docs — if anything here is red, stop and fix it before Task 12.

- [ ] **Step 2: Lint**

Run:

```bash
cd "C:\Users\Mizzo\Claude\AI-Code-Review-Agent" && npx eslint src tests
```

Expected: 0 warnings, 0 errors (matches this project's existing zero-warnings bar — see memory-bank/progress.md).

---

### Task 12: README + CHANGELOG

**Files:**

- Modify: `README.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add the flag to README's flag reference table**

In `README.md`, add a row to the flag table (after the `--no-emoji` row, around line 237):

```
| `--verify-evidence`     | off             | Verify Critical/High findings against their own cited evidence using a separate model (`qwen3:latest` by default). Report-only in this version — flags possibly-unsupported findings in the report without dropping them. Adds one LLM call per checked finding                                                                                                              |
```

- [ ] **Step 2: Add a short paragraph near the other opt-in-mechanism docs**

In `README.md`, find the section documenting `--context-mode semantic` (the `nomic-embed-text` paragraph, near line 202-203's usage example) and add a matching usage example nearby:

```
# Verify Critical/High findings against their own evidence (requires qwen3:latest in Ollama)
ai-review-agent --verify-evidence
```

- [ ] **Step 3: Add a CHANGELOG entry**

In `CHANGELOG.md`, add a new section at the top, before `## [1.9.0]`:

```markdown
## [Unreleased]

### Added

- `--verify-evidence` runs Critical/High findings through a separate model (`qwen3:latest` by
  default) that checks whether each finding's own cited evidence actually supports its claim —
  catches a hallucination class none of the existing defenses caught (a finding citing a real
  line, in a real changed file, that says the opposite of what the line does). **Report-only in
  this release**: flagged findings are surfaced in `ReviewResult.evidenceCheckFilter` (and in the
  markdown/SARIF reports) but nothing is dropped from `findings` yet. Opt-in (`verifyEvidence`
  config field, default `false`); forced off for MCP callers regardless of project config. See
  `docs/superpowers/specs/2026-08-10-evidence-grounding-verification-design.md` for the full
  design and validation data.
```

- [ ] **Step 4: Commit**

```bash
git add README.md CHANGELOG.md
git commit -m "docs: document --verify-evidence flag"
```

---

### Task 13: Permanent calibration script

**Files:**

- Create: `calibration/evidenceVerifierCalibration.ts`

- [ ] **Step 1: Check how `calibration/calibrate.ts` is invoked**

Run:

```bash
cd "C:\Users\Mizzo\Claude\AI-Code-Review-Agent" && grep -n "calibrate" package.json
```

Note the npm script pattern (e.g. `"calibrate": "tsx calibration/calibrate.ts"`) so this new script's own `npm run` entry (Step 3) matches it exactly — same runner, same invocation style.

- [ ] **Step 2: Create the script**

Create `calibration/evidenceVerifierCalibration.ts` — this is the permanent, cleaned-up port of the scratch `verify-poc.mjs` validation script referenced in the design spec's Validation section, carrying forward the full 13-case set as a regression guard for verifier judgment quality. It checks `verifyEvidence` judgment against real Ollama, which doesn't fit `calibrate.ts`'s agent-generation-oriented loop (that one calibrates what agents generate; this one calibrates what the verifier judges):

```ts
// Permanent regression guard for evidenceVerifier.ts's judgment quality against real Ollama
// models -- the cleaned-up, TypeScript port of the scratch verify-poc.mjs script used to
// validate this design (see docs/superpowers/specs/2026-08-10-evidence-grounding-verification-
// design.md's Validation section). Carries forward the full 13-case set (5 evidence-contradicts-
// claim cases and 3 genuinely-correct controls from round 1, plus 5 more added in round 2) that
// qwen3:latest scored 13/13 on. Run manually or via CI when changing the verifier's
// prompt or evaluating a new candidate verifier model -- NOT part of the default test suite,
// since it makes real Ollama calls and takes minutes to run.
import { verifyEvidence } from '../src/core/evidenceVerifier.js'
import { OllamaProvider } from '../src/core/llm/ollamaProvider.js'
import type { Finding } from '../src/core/schema.js'

const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://localhost:11434'
const MODELS = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ['qwen3:latest']

function makeFinding(title: string, detail: string, evidence: string): Finding {
  return {
    id: 'calibration-0',
    agent: 'security',
    domain: 'Security',
    severity: 'high',
    basis: 'VERIFIED',
    file: 'calibration.ts',
    line: 1,
    title,
    detail,
    evidence,
    impact: 'n/a',
    recommendation: 'n/a',
    suggestion: 'n/a',
    blocking: false,
    source: 'llm',
  }
}

interface Case {
  label: string
  title: string
  detail: string
  evidence: string
  expected: 'SUPPORTED' | 'NOT_SUPPORTED'
}

const cases: Case[] = [
  {
    label: 'bad-1-observability-log-exists',
    title: 'Lock failure not logged',
    detail:
      'Lock acquisition failures are not logged, making debugging difficult when locks fail silently.',
    evidence: 'echo "WARN: could not acquire session-claims lock, skipping" >&2',
    expected: 'NOT_SUPPORTED',
  },
  {
    label: 'bad-2-file-handle-closed-by-with',
    title: 'File handle never closed',
    detail:
      'The temp file handle is never explicitly closed, risking file descriptor exhaustion under heavy load.',
    evidence: "with open(tmp, 'w') as f:\n    f.write(payload)",
    expected: 'NOT_SUPPORTED',
  },
  {
    label: 'bad-3-guard-present',
    title: 'Missing claim-id guard',
    detail:
      'Calling release without --claim-id silently does nothing, with no error or exit code to signal the failure to the caller.',
    evidence: 'if [ -z "$claim_id" ]; then echo "Usage: release --claim-id <id>" >&2; exit 2; fi',
    expected: 'NOT_SUPPORTED',
  },
  {
    label: 'bad-4-unbound-var-fix-flagged-as-bug',
    title: 'Unbound variable risk',
    detail:
      "This line risks an unbound variable error under 'set -u' if $2 is not provided, since it's referenced without a default.",
    evidence: 'local value="${2:-}"; shift 2 2>/dev/null || shift',
    expected: 'NOT_SUPPORTED',
  },
  {
    label: 'bad-5-additive-change-called-breaking',
    title: 'Breaking change',
    detail:
      'This is a breaking change that will break existing callers relying on the current SessionStart behavior.',
    evidence:
      '+ "SessionStart": [{"matcher": "*", "hooks": [{"type": "command", "command": "scripts/init.sh"}]}]\n(this is a new key added to a hooks config object; nothing existing was removed or modified)',
    expected: 'NOT_SUPPORTED',
  },
  {
    label: 'good-1-real-sql-injection',
    title: 'SQL injection',
    detail:
      'User input is concatenated directly into a SQL query without parameterization, allowing SQL injection.',
    evidence: 'const query = "SELECT * FROM users WHERE id = " + userId',
    expected: 'SUPPORTED',
  },
  {
    label: 'good-2-real-null-deref',
    title: 'Null dereference',
    detail:
      'This function dereferences user.profile without checking whether user could be null, risking a runtime TypeError.',
    evidence: 'function getName(user: User | null) {\n  return user.profile.name.toUpperCase()\n}',
    expected: 'SUPPORTED',
  },
  {
    label: 'good-3-real-nested-complexity',
    title: 'Deep nesting',
    detail:
      'This function has 5+ levels of nested conditionals, making it hard to test and reason about.',
    evidence:
      'if (a) {\n  if (b) {\n    if (c) {\n      if (d) {\n        if (e) {\n          doThing()\n        }\n      }\n    }\n  }\n}',
    expected: 'SUPPORTED',
  },
  {
    label: 'bad-6-messy-diff-context-retry-bound-exists',
    title: 'Unbounded retry loop',
    detail:
      'This retry loop has no maximum attempt limit and could loop forever if the network never recovers.',
    evidence:
      '  async function fetchWithRetry(url, maxRetries) {\n' +
      '+   for (let attempt = 0; attempt < maxRetries; attempt++) {\n' +
      '+     try {\n' +
      '+       return await fetchWithTimeout(url)\n' +
      '+     } catch (err) {\n' +
      '+       if (attempt === maxRetries - 1) throw err\n' +
      '+       await sleep(backoffMs * (attempt + 1))\n' +
      '+     }\n' +
      '+   }\n' +
      '  }',
    expected: 'NOT_SUPPORTED',
  },
  {
    label: 'bad-7-wrong-hash-algorithm-claimed',
    title: 'Weak password hashing',
    detail:
      'Passwords are hashed with a fast, insecure algorithm (MD5), making them vulnerable to brute-force attacks.',
    evidence: 'const hash = await bcrypt.hash(password, 12)',
    expected: 'NOT_SUPPORTED',
  },
  {
    label: 'good-4-real-xss',
    title: 'Stored XSS',
    detail: 'User-supplied HTML is rendered without sanitization, allowing stored XSS.',
    evidence: 'commentEl.innerHTML = comment.text // comment.text comes directly from user input',
    expected: 'SUPPORTED',
  },
  {
    label: 'good-5-real-toctou-race',
    title: 'TOCTOU race',
    detail:
      'Two concurrent requests could both pass the balance check before either debits the account, allowing an overdraft.',
    evidence:
      '  const balance = await getBalance(accountId)\n' +
      '+ if (balance >= amount) {\n' +
      '+   await debit(accountId, amount) // no lock or transaction between the check and the debit\n' +
      '+ }',
    expected: 'SUPPORTED',
  },
  {
    label: 'good-6-real-missing-await',
    title: 'Missing await',
    detail:
      'This async cleanup call is not awaited, so the function can return before cleanup actually completes.',
    evidence:
      'async function cleanup() { /* ... */ }\n\nfunction handler() {\n  cleanup() // missing await\n  return result\n}',
    expected: 'SUPPORTED',
  },
]

async function main(): Promise<void> {
  let anyFailed = false
  for (const model of MODELS) {
    const provider = new OllamaProvider(OLLAMA_URL, model)
    let correct = 0
    console.log(`\n=== ${model} ===`)
    for (const c of cases) {
      const start = Date.now()
      const result = await verifyEvidence(makeFinding(c.title, c.detail, c.evidence), provider)
      const got = result.verified ? 'SUPPORTED' : 'NOT_SUPPORTED'
      const pass = got === c.expected
      if (pass) correct++
      else anyFailed = true
      const elapsed = ((Date.now() - start) / 1000).toFixed(1)
      console.log(
        `[${elapsed}s] ${c.label}: expected=${c.expected} got=${got} ${pass ? 'PASS' : 'FAIL'}` +
          (pass ? '' : ` -- ${result.reason}`)
      )
    }
    console.log(`${model}: ${correct}/${cases.length}`)
  }
  if (anyFailed) process.exit(1)
}

main()
```

- [ ] **Step 3: Add an npm script**

In `package.json`, add a new script alongside the existing `"calibrate"` entry:

```json
    "calibrate:evidence": "tsx calibration/evidenceVerifierCalibration.ts",
```

(Match the exact runner Step 1 found for `"calibrate"` — if it's not `tsx`, use whatever that script actually uses instead.)

- [ ] **Step 4: Run it manually against a live Ollama (not part of `npm test`)**

Run:

```bash
cd "C:\Users\Mizzo\Claude\AI-Code-Review-Agent" && npm run calibrate:evidence
```

Expected: `qwen3:latest: 13/13` if Ollama is running locally with the model pulled. If Ollama isn't available in this environment, this step can't be verified here — note that in the task's completion and leave it for the next run where Ollama is reachable, matching this project's existing `calibrate.yml` CI convention of skipping gracefully when Ollama is unavailable.

- [ ] **Step 5: Commit**

```bash
git add calibration/evidenceVerifierCalibration.ts package.json
git commit -m "test: add permanent evidence-verifier calibration script"
```

---

## Self-Review Notes

**Spec coverage:** Architecture (Task 4-6), Rollout/Stage 1 (Task 6 — nothing dropped from `findings`), Schema (Task 1), Config surface (Task 2, 7), Formatter updates (Task 9-10), Testing's calibration-script requirement (Task 13), MCP decision (Task 8), Documentation (Task 12). All 7 originally-identified gaps and the deterministic pre-filter are implemented in Tasks 4-5. Spec and plan were reconciled post-review — see the header note above.

**Type consistency check:** `VerifyEvidenceResult` (Task 4) → consumed by `runEvidenceChecks` (Task 5) → produces `EvidenceCheckFinding`/`EvidenceCheckFilterMetadata` (Task 1's schema) → consumed by `runner.ts` (Task 6), `formatter.ts` (Task 9), `sarif.ts` (Task 10). Field names (`checkedCount`, `unavailableCount`, `unavailableReasons`, `flagged`, `preFilterAgreed`) are identical across every task that touches them.

**No placeholders:** every step above has complete code, not a description of code.
