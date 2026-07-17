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

  it('runForCoverage throws ParseFailureError on parse failure', async () => {
    await expect(
      new CoverageAnalystAgent(makeProvider('not json at all'), DEFAULT_CONFIG).runForCoverage({
        diff: 'diff',
      })
    ).rejects.toThrow(ParseFailureError)
  })

  it('system prompt mentions coverage or testing', () => {
    const agent = new CoverageAnalystAgent(makeProvider('[]'), DEFAULT_CONFIG)
    expect(agent.systemPrompt).toMatch(/coverage|test|untested/i)
  })
})
