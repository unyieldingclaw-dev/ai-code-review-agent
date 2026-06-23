// Unit tests — mock the LLM provider. Ollama is NOT required to run these.
import { describe, it, expect, vi } from 'vitest'
import { PerformanceAgent } from '../../src/core/agents/performance.js'
import { DEFAULT_CONFIG } from '../../src/core/config.js'
import type { LLMProvider } from '../../src/core/llm/provider.js'

const makeProvider = (response: string): LLMProvider => ({
  chat: vi.fn().mockResolvedValue(response),
  ping: vi.fn().mockResolvedValue({ ok: true }),
})

describe('PerformanceAgent', () => {
  it('has name performance', () => {
    expect(new PerformanceAgent(makeProvider('[]'), DEFAULT_CONFIG).name).toBe('performance')
  })

  it('returns empty array when provider returns empty JSON array', async () => {
    expect(
      await new PerformanceAgent(makeProvider('[]'), DEFAULT_CONFIG).run({ diff: 'diff' })
    ).toEqual([])
  })

  it('parses a valid finding and stamps agent name', async () => {
    const raw = JSON.stringify([
      {
        severity: 'medium',
        basis: 'INFERRED',
        confidence: 70,
        file: 'src/api.ts',
        line: 22,
        title: 'N+1 query in loop',
        detail: 'Each iteration issues a separate DB query',
        suggestion: 'Batch the queries outside the loop',
      },
    ])
    const findings = await new PerformanceAgent(makeProvider(raw), DEFAULT_CONFIG).run({
      diff: 'diff',
    })
    expect(findings).toHaveLength(1)
    expect(findings[0].agent).toBe('performance')
    expect(findings[0].id).toBe('performance-0')
  })

  it('returns empty array on parse failure', async () => {
    expect(
      await new PerformanceAgent(makeProvider('{bad}'), DEFAULT_CONFIG).run({ diff: 'diff' })
    ).toEqual([])
  })

  it('system prompt mentions performance or efficiency', () => {
    const agent = new PerformanceAgent(makeProvider('[]'), DEFAULT_CONFIG)
    expect(agent.systemPrompt).toMatch(/performance|efficiency|latency|throughput/i)
  })
})
