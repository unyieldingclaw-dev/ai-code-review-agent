import { describe, it, expect, vi } from 'vitest'
import { BaseAgent } from '../../src/core/agents/base.js'
import type { LLMProvider } from '../../src/core/llm/provider.js'
import type { ReviewInput } from '../../src/core/schema.js'
import { DEFAULT_CONFIG } from '../../src/core/config.js'

// Concrete subclass for testing
class TestAgent extends BaseAgent {
  get name() {
    return 'security' as const
  }
  get systemPrompt() {
    return 'You are a test agent.'
  }
}

const makeProvider = (response: string): LLMProvider => ({
  chat: vi.fn().mockResolvedValue(response),
  ping: vi.fn().mockResolvedValue({ ok: true }),
})

describe('BaseAgent', () => {
  it('parses bare JSON array', async () => {
    const raw = JSON.stringify([
      {
        severity: 'high',
        basis: 'VERIFIED',
        file: 'src/foo.ts',
        line: 10,
        title: 'T',
        detail: 'D',
        suggestion: 'S',
      },
    ])
    const agent = new TestAgent(makeProvider(raw), DEFAULT_CONFIG)
    const findings = await agent.run({ diff: 'diff content' })
    expect(findings).toHaveLength(1)
    expect(findings[0].agent).toBe('security')
    expect(findings[0].id).toBe('security-0')
    expect(findings[0].title).toBe('T')
  })

  it('parses JSON wrapped in markdown code fence', async () => {
    const raw =
      '```json\n[{"severity":"high","basis":"VERIFIED","file":"f.ts","line":1,"title":"T","detail":"D","suggestion":"S"}]\n```'
    const agent = new TestAgent(makeProvider(raw), DEFAULT_CONFIG)
    const findings = await agent.run({ diff: 'diff' })
    expect(findings).toHaveLength(1)
  })

  it('parses object with findings array', async () => {
    const raw = JSON.stringify({
      findings: [
        {
          severity: 'medium',
          basis: 'INFERRED',
          file: 'x.ts',
          line: 5,
          title: 'T',
          detail: 'D',
          suggestion: 'S',
        },
      ],
    })
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
      {
        severity: 'high',
        basis: 'VERIFIED',
        file: 'f.ts',
        line: 1,
        title: 'T',
        detail: 'D',
        suggestion: 'S',
      },
      { severity: 'high' }, // missing required fields
    ])
    const agent = new TestAgent(makeProvider(raw), DEFAULT_CONFIG)
    const findings = await agent.run({ diff: 'diff' })
    expect(findings).toHaveLength(1)
  })

  it('fills domain from agentDefaultDomain when LLM omits it', async () => {
    const raw = JSON.stringify([
      {
        severity: 'high',
        basis: 'VERIFIED',
        confidence: 80,
        file: 'src/a.ts',
        line: 1,
        title: 'Test',
        detail: 'Detail',
        suggestion: 'Fix it',
        // domain intentionally omitted
      },
    ])
    const agent = new TestAgent(makeProvider(raw), DEFAULT_CONFIG)
    const findings = await agent.run({ diff: 'diff' })
    expect(findings[0].domain).toBe('Security')
    expect(findings[0].domain).not.toBeUndefined()
  })

  it('fills evidence from detail when LLM omits evidence', async () => {
    const raw = JSON.stringify([
      {
        severity: 'high',
        basis: 'VERIFIED',
        confidence: 80,
        file: 'src/a.ts',
        line: 1,
        title: 'Test',
        detail: 'The detail text',
        suggestion: 'Fix it',
        // evidence intentionally omitted
      },
    ])
    const agent = new TestAgent(makeProvider(raw), DEFAULT_CONFIG)
    const findings = await agent.run({ diff: 'diff' })
    expect(findings[0].evidence).toBe('The detail text')
  })

  it('fills impact as empty string when LLM omits it', async () => {
    const raw = JSON.stringify([
      {
        severity: 'high',
        basis: 'VERIFIED',
        confidence: 80,
        file: 'src/a.ts',
        line: 1,
        title: 'Test',
        detail: 'Detail',
        suggestion: 'Fix it',
        // impact intentionally omitted
      },
    ])
    const agent = new TestAgent(makeProvider(raw), DEFAULT_CONFIG)
    const findings = await agent.run({ diff: 'diff' })
    expect(findings[0].impact).toBe('')
    expect(findings[0].impact).not.toBeUndefined()
  })

  it('fills blocking=true for critical severity when LLM omits blocking', async () => {
    const raw = JSON.stringify([
      {
        severity: 'critical',
        basis: 'VERIFIED',
        confidence: 90,
        file: 'src/a.ts',
        line: 1,
        title: 'T',
        detail: 'D',
        suggestion: 'S',
        // blocking intentionally omitted
      },
    ])
    const agent = new TestAgent(makeProvider(raw), DEFAULT_CONFIG)
    const findings = await agent.run({ diff: 'diff' })
    expect(findings[0].blocking).toBe(true)
  })

  it('fills source as llm when LLM omits source', async () => {
    const raw = JSON.stringify([
      {
        severity: 'high',
        basis: 'VERIFIED',
        confidence: 80,
        file: 'src/a.ts',
        line: 1,
        title: 'T',
        detail: 'D',
        suggestion: 'S',
        // source intentionally omitted
      },
    ])
    const agent = new TestAgent(makeProvider(raw), DEFAULT_CONFIG)
    const findings = await agent.run({ diff: 'diff' })
    expect(findings[0].source).toBe('llm')
    expect(findings[0].source).not.toBeUndefined()
  })

  it('clamps lineEnd to line when lineEnd < line', async () => {
    const raw = JSON.stringify([
      {
        severity: 'high',
        basis: 'VERIFIED',
        confidence: 80,
        file: 'src/a.ts',
        line: 42,
        lineEnd: 5,
        title: 'Test',
        detail: 'Detail',
        suggestion: 'Fix it',
      },
    ])
    const findings = await new TestAgent(makeProvider(raw), DEFAULT_CONFIG).run({ diff: 'diff' })
    expect(findings[0].lineEnd).toBeGreaterThanOrEqual(findings[0].line)
    expect(findings[0].lineEnd).toBe(42)
  })

  it('preserves valid lineEnd when lineEnd >= line', async () => {
    const raw = JSON.stringify([
      {
        severity: 'high',
        basis: 'VERIFIED',
        confidence: 80,
        file: 'src/a.ts',
        line: 10,
        lineEnd: 20,
        title: 'Test',
        detail: 'Detail',
        suggestion: 'Fix it',
      },
    ])
    const findings = await new TestAgent(makeProvider(raw), DEFAULT_CONFIG).run({ diff: 'diff' })
    expect(findings[0].lineEnd).toBe(20)
  })
})
