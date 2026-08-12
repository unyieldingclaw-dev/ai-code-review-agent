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
    const provider = makeProvider(async () => 'VERDICT: SUPPORTED — evidence genuinely lacks logging.')
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
