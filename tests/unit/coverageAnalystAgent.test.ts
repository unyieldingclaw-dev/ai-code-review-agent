// Unit tests — mock the LLM provider. Ollama is NOT required to run these.
import { describe, it, expect, vi } from 'vitest'
import { CoverageAnalystAgent } from '../../src/core/agents/coverageAnalyst.js'
import { DEFAULT_CONFIG } from '../../src/core/config.js'
import { ParseFailureError } from '../../src/core/parsing.js'
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

  it('throws ParseFailureError on parse failure', async () => {
    await expect(
      new CoverageAnalystAgent(makeProvider('[invalid]'), DEFAULT_CONFIG).run({
        diff: 'diff',
      })
    ).rejects.toThrow(ParseFailureError)
  })

  it('runForCoverage requests structured JSON output from the provider', async () => {
    const provider = makeProvider('{"findings":[],"gaps":[]}')
    await new CoverageAnalystAgent(provider, DEFAULT_CONFIG).runForCoverage({ diff: 'diff' })
    expect(provider.chat).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ format: expect.objectContaining({ type: 'object' }) })
    )
  })

  it('sends an object-typed JSON Schema (findings + gaps), not the bare "json" string', async () => {
    const provider = makeProvider('{"findings":[],"gaps":[]}')
    await new CoverageAnalystAgent(provider, DEFAULT_CONFIG).runForCoverage({ diff: 'x' })
    expect(provider.chat).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        format: expect.objectContaining({ type: 'object' }),
      })
    )
  })

  it('runForCoverage throws ParseFailureError on parse failure', async () => {
    await expect(
      new CoverageAnalystAgent(makeProvider('not json at all'), DEFAULT_CONFIG).runForCoverage({
        diff: 'diff',
      })
    ).rejects.toThrow(ParseFailureError)
  })

  it('recovers findings and gaps from a response truncated before the outer object closed', async () => {
    // The outer {"findings":[...],"gaps":[...]} object never closes -- Stage 1/2 both require
    // it to balance and would throw immediately without Stage 3's salvage pass.
    const raw =
      '{"findings":[{"severity":"medium","basis":"VERIFIED","file":"a.ts","line":1,' +
      '"title":"No test","detail":"D","suggestion":"S"}],' +
      '"gaps":[{"file":"a.ts","functionName":"foo","lineStart":1,"lineEnd":5,"description":"desc'
    const result = await new CoverageAnalystAgent(makeProvider(raw), DEFAULT_CONFIG).runForCoverage(
      { diff: 'diff' }
    )
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0].title).toBe('No test')
    expect(result.gaps).toHaveLength(0) // the gap object itself never closed either
  })

  it('runForCoverage throws ParseFailureError when nothing recoverable exists (truncated with no complete object)', async () => {
    // Cut off so early that not even one finding/gap object ever closes -- nothing to salvage.
    const raw = '{"findings":[{"severity":"high"'
    await expect(
      new CoverageAnalystAgent(makeProvider(raw), DEFAULT_CONFIG).runForCoverage({ diff: 'diff' })
    ).rejects.toThrow(ParseFailureError)
  })

  it('runForCoverage returns empty findings/gaps for the documented "fully covered" response', async () => {
    // {} is a legitimate clean response per this agent's own system prompt ("If fully covered,
    // return: {"findings":[],"gaps":[]}"), not a parse failure -- unlike BaseAgent's array-based
    // schema, where {} has no valid interpretation.
    const result = await new CoverageAnalystAgent(
      makeProvider('{}'),
      DEFAULT_CONFIG
    ).runForCoverage({ diff: 'diff' })
    expect(result).toEqual({ findings: [], gaps: [] })
  })

  it('system prompt mentions coverage or testing', () => {
    const agent = new CoverageAnalystAgent(makeProvider('[]'), DEFAULT_CONFIG)
    expect(agent.systemPrompt).toMatch(/coverage|test|untested/i)
  })
})
