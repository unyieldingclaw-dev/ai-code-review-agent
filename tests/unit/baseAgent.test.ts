import { describe, it, expect, vi } from 'vitest'
import { BaseAgent } from '../../src/core/agents/base.js'
import { validateAndNormalizeFindings, ParseFailureError } from '../../src/core/parsing.js'
import type { LLMProvider } from '../../src/core/llm/provider.js'
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
  it('requests structured JSON output from the provider', async () => {
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
    const provider = makeProvider(raw)
    await new TestAgent(provider, DEFAULT_CONFIG).run({ diff: 'diff content' })
    expect(provider.chat).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ format: 'json' })
    )
  })

  it('recovers complete findings from a truncated response instead of discarding all of them', async () => {
    // Response cut off mid-generation on the second finding -- first one is complete.
    const raw =
      '[{"severity":"high","basis":"VERIFIED","file":"a.ts","line":1,"title":"First","detail":"D1","suggestion":"S1"},{"severity":"medium","basis":"VERIFIED","file":"b.ts","line":2,"title":"Sec'
    const agent = new TestAgent(makeProvider(raw), DEFAULT_CONFIG)
    const findings = await agent.run({ diff: 'diff' })
    expect(findings).toHaveLength(1)
    expect(findings[0].title).toBe('First')
  })

  it('still throws ParseFailureError when nothing recoverable passes schema validation', async () => {
    // A trivially parseable but empty/garbage object must not be silently treated as
    // "0 findings, clean run" -- it's a real parse failure.
    const agent = new TestAgent(makeProvider('{}'), DEFAULT_CONFIG)
    await expect(agent.run({ diff: 'diff' })).rejects.toThrow(ParseFailureError)
  })

  it('wraps a single bare finding-shaped object without claiming truncation', async () => {
    // The LLM returned one finding as a bare `{...}` instead of the required `[...]` array.
    // Nothing was truncated -- Stage 4's "appears truncated" message would be misleading here.
    const raw = JSON.stringify({
      severity: 'high',
      basis: 'VERIFIED',
      file: 'a.ts',
      line: 1,
      title: 'T',
      detail: 'D',
      suggestion: 'S',
    })
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const agent = new TestAgent(makeProvider(raw), DEFAULT_CONFIG)
    const findings = await agent.run({ diff: 'diff' })
    expect(findings).toHaveLength(1)
    expect(findings[0].title).toBe('T')
    const loggedTruncated = consoleSpy.mock.calls.some((args) =>
      String(args[0]).includes('appears truncated')
    )
    const loggedAutoWrapped = consoleSpy.mock.calls.some((args) =>
      String(args[0]).includes('auto-wrapped')
    )
    expect(loggedTruncated).toBe(false)
    expect(loggedAutoWrapped).toBe(true)
    consoleSpy.mockRestore()
  })

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

  it('throws ParseFailureError on parse failure', async () => {
    const agent = new TestAgent(makeProvider('not json at all'), DEFAULT_CONFIG)
    await expect(agent.run({ diff: 'diff' })).rejects.toThrow(ParseFailureError)
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

describe('validateAndNormalizeFindings', () => {
  const AGENT = 'security' as const

  it('keeps a finding that has evidence (canonical) but no basis (legacy)', () => {
    const item = {
      severity: 'high',
      evidence: 'src/foo.ts:42 — unescaped input',
      file: 'src/foo.ts',
      line: 42,
      title: 'XSS risk',
      detail: 'User input not escaped',
      recommendation: 'Escape before render',
    }
    const result = validateAndNormalizeFindings([item], AGENT)
    expect(result).toHaveLength(1)
    expect(result[0].evidence).toBe('src/foo.ts:42 — unescaped input')
  })

  it('keeps a finding that has basis (legacy) but no evidence (canonical)', () => {
    const item = {
      severity: 'medium',
      basis: 'VERIFIED',
      file: 'src/bar.ts',
      line: 10,
      title: 'Missing null check',
      detail: 'Potential NPE',
      suggestion: 'Add null guard',
    }
    const result = validateAndNormalizeFindings([item], AGENT)
    expect(result).toHaveLength(1)
  })

  it('drops findings missing required fields and logs the count', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const badItem = { severity: 'high' } // missing file, line, title, detail, basis/evidence
    const result = validateAndNormalizeFindings([badItem], AGENT)
    expect(result).toHaveLength(0)
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('dropped 1/1'))
    consoleSpy.mockRestore()
  })
})
