// Unit tests — mock the LLM provider. Ollama is NOT required to run these.
import { describe, it, expect, vi } from 'vitest'
import { DesignAgent } from '../../src/core/agents/design.js'
import { DEFAULT_CONFIG } from '../../src/core/config.js'
import { ParseFailureError } from '../../src/core/parsing.js'
import type { LLMProvider } from '../../src/core/llm/provider.js'

const makeProvider = (response: string): LLMProvider => ({
  chat: vi.fn().mockResolvedValue(response),
  ping: vi.fn().mockResolvedValue({ ok: true }),
})

describe('DesignAgent', () => {
  it('has name design', () => {
    expect(new DesignAgent(makeProvider('[]'), DEFAULT_CONFIG).name).toBe('design')
  })

  it('returns empty array when provider returns empty JSON array', async () => {
    expect(await new DesignAgent(makeProvider('[]'), DEFAULT_CONFIG).run({ diff: 'diff' })).toEqual(
      []
    )
  })

  it('parses a valid finding and stamps agent name', async () => {
    const raw = JSON.stringify([
      {
        severity: 'medium',
        basis: 'INFERRED',
        confidence: 65,
        file: 'src/service.ts',
        line: 8,
        title: 'Business logic in controller layer',
        detail: 'Validation belongs in service, not route handler',
        suggestion: 'Extract validation to a service method',
      },
    ])
    const findings = await new DesignAgent(makeProvider(raw), DEFAULT_CONFIG).run({ diff: 'diff' })
    expect(findings).toHaveLength(1)
    expect(findings[0].agent).toBe('design')
    expect(findings[0].id).toBe('design-0')
  })

  it('throws ParseFailureError on parse failure', async () => {
    await expect(
      new DesignAgent(makeProvider('null'), DEFAULT_CONFIG).run({ diff: 'diff' })
    ).rejects.toThrow(ParseFailureError)
  })

  it('system prompt mentions design or architecture', () => {
    const agent = new DesignAgent(makeProvider('[]'), DEFAULT_CONFIG)
    expect(agent.systemPrompt).toMatch(/design|architect|pattern|coupling|cohesion|layer/i)
  })

  // Regression test for a false positive reproduced live: this agent has zero security framing
  // in its focus list, yet invented an "Insecure Authentication Dependency" finding citing
  // auth.uid() itself as the evidence -- a safe, standard Supabase RLS pattern.
  it('system prompt tells the agent not to invent security-vulnerability labels', () => {
    const agent = new DesignAgent(makeProvider('[]'), DEFAULT_CONFIG)
    expect(agent.systemPrompt).toMatch(/security agent/i)
  })
})
