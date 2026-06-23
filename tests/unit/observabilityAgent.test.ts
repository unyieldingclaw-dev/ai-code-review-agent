import { describe, it, expect, vi } from 'vitest'
import { ObservabilityAgent } from '../../src/core/agents/observability.js'
import { DEFAULT_CONFIG } from '../../src/core/config.js'
import type { LLMProvider } from '../../src/core/llm/provider.js'

const makeProvider = (response: string): LLMProvider => ({
  chat: vi.fn().mockResolvedValue(response),
  ping: vi.fn().mockResolvedValue({ ok: true }),
})

describe('ObservabilityAgent', () => {
  it('has name observability', () => {
    expect(new ObservabilityAgent(makeProvider('[]'), DEFAULT_CONFIG).name).toBe('observability')
  })

  it('returns empty array when provider returns empty JSON array', async () => {
    expect(
      await new ObservabilityAgent(makeProvider('[]'), DEFAULT_CONFIG).run({ diff: 'diff content' })
    ).toEqual([])
  })

  it('parses a valid finding and stamps agent name', async () => {
    const raw = JSON.stringify([
      {
        severity: 'medium',
        basis: 'VERIFIED',
        confidence: 75,
        file: 'src/service.ts',
        line: 20,
        title: 'Missing log on error path',
        detail: 'The catch block silently swallows the error',
        suggestion: 'Add a structured log statement at error level',
      },
    ])
    const agent = new ObservabilityAgent(makeProvider(raw), DEFAULT_CONFIG)
    const findings = await agent.run({ diff: 'diff' })
    expect(findings).toHaveLength(1)
    expect(findings[0].agent).toBe('observability')
    expect(findings[0].id).toBe('observability-0')
  })

  it('returns empty array on parse failure', async () => {
    expect(
      await new ObservabilityAgent(makeProvider('not json'), DEFAULT_CONFIG).run({ diff: 'diff' })
    ).toEqual([])
  })

  it('system prompt mentions logging and code paths', () => {
    const agent = new ObservabilityAgent(makeProvider('[]'), DEFAULT_CONFIG)
    expect(agent.systemPrompt).toMatch(/log/i)
    expect(agent.systemPrompt).toMatch(/path/i)
  })
})
