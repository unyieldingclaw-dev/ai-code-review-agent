// Unit tests — mock the LLM provider. Ollama is NOT required to run these.
import { describe, it, expect, vi } from 'vitest'
import { IntegrationScoutAgent } from '../../src/core/agents/integrationScout.js'
import { DEFAULT_CONFIG } from '../../src/core/config.js'
import { ParseFailureError } from '../../src/core/parsing.js'
import type { LLMProvider } from '../../src/core/llm/provider.js'

const makeProvider = (response: string): LLMProvider => ({
  chat: vi.fn().mockResolvedValue(response),
  ping: vi.fn().mockResolvedValue({ ok: true }),
})

describe('IntegrationScoutAgent', () => {
  it('has name integration', () => {
    expect(new IntegrationScoutAgent(makeProvider('[]'), DEFAULT_CONFIG).name).toBe('integration')
  })

  it('returns empty array when provider returns empty JSON array', async () => {
    expect(
      await new IntegrationScoutAgent(makeProvider('[]'), DEFAULT_CONFIG).run({ diff: 'diff' })
    ).toEqual([])
  })

  it('parses a valid finding and stamps agent name', async () => {
    const raw = JSON.stringify([
      {
        severity: 'high',
        basis: 'INFERRED',
        confidence: 72,
        file: 'src/gateway.ts',
        line: 45,
        title: 'Breaking change to external API contract',
        detail: 'Renamed field userId to user_id breaks downstream consumers',
        suggestion: 'Add a migration shim or version the endpoint',
      },
    ])
    const findings = await new IntegrationScoutAgent(makeProvider(raw), DEFAULT_CONFIG).run({
      diff: 'diff',
    })
    expect(findings).toHaveLength(1)
    expect(findings[0].agent).toBe('integration')
    expect(findings[0].id).toBe('integration-0')
  })

  it('throws ParseFailureError on parse failure', async () => {
    await expect(
      new IntegrationScoutAgent(makeProvider('not-json'), DEFAULT_CONFIG).run({
        diff: 'diff',
      })
    ).rejects.toThrow(ParseFailureError)
  })

  it('system prompt mentions integration or contract', () => {
    const agent = new IntegrationScoutAgent(makeProvider('[]'), DEFAULT_CONFIG)
    expect(agent.systemPrompt).toMatch(/integrat|contract|API|interface|downstream/i)
  })
})
