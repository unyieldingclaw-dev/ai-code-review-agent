// Unit tests — mock the LLM provider. Ollama is NOT required to run these.
import { describe, it, expect, vi } from 'vitest'
import { DesignAgent } from '../../src/core/agents/design.js'
import { DEFAULT_CONFIG } from '../../src/core/config.js'
import type { LLMProvider } from '../../src/core/llm/provider.js'

const makeProvider = (response: string): LLMProvider => ({
  chat: vi.fn().mockResolvedValue(response),
  ping: vi.fn().mockResolvedValue({ ok: true })
})

describe('DesignAgent', () => {
  it('has name design', () => {
    expect(new DesignAgent(makeProvider('[]'), DEFAULT_CONFIG).name).toBe('design')
  })

  it('returns empty array when provider returns empty JSON array', async () => {
    expect(await new DesignAgent(makeProvider('[]'), DEFAULT_CONFIG).run({ diff: 'diff' })).toEqual([])
  })

  it('parses a valid finding and stamps agent name', async () => {
    const raw = JSON.stringify([{ severity: 'medium', basis: 'INFERRED', confidence: 65, file: 'src/service.ts', line: 8, title: 'Business logic in controller layer', detail: 'Validation belongs in service, not route handler', suggestion: 'Extract validation to a service method' }])
    const findings = await new DesignAgent(makeProvider(raw), DEFAULT_CONFIG).run({ diff: 'diff' })
    expect(findings).toHaveLength(1)
    expect(findings[0].agent).toBe('design')
    expect(findings[0].id).toBe('design-0')
  })

  it('returns empty array on parse failure', async () => {
    expect(await new DesignAgent(makeProvider('null'), DEFAULT_CONFIG).run({ diff: 'diff' })).toEqual([])
  })

  it('system prompt mentions design or architecture', () => {
    const agent = new DesignAgent(makeProvider('[]'), DEFAULT_CONFIG)
    expect(agent.systemPrompt).toMatch(/design|architect|pattern|coupling|cohesion|layer/i)
  })
})
