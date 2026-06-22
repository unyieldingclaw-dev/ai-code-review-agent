// Unit tests — mock the LLM provider. Ollama is NOT required to run these.
import { describe, it, expect, vi } from 'vitest'
import { AdversarialAgent } from '../../src/core/agents/adversarial.js'
import { DEFAULT_CONFIG } from '../../src/core/config.js'
import type { LLMProvider } from '../../src/core/llm/provider.js'

const makeProvider = (response: string): LLMProvider => ({
  chat: vi.fn().mockResolvedValue(response),
  ping: vi.fn().mockResolvedValue({ ok: true })
})

describe('AdversarialAgent', () => {
  it('has name adversarial', () => {
    expect(new AdversarialAgent(makeProvider('[]'), DEFAULT_CONFIG).name).toBe('adversarial')
  })

  it('returns empty array when provider returns empty JSON array', async () => {
    expect(await new AdversarialAgent(makeProvider('[]'), DEFAULT_CONFIG).run({ diff: 'diff' })).toEqual([])
  })

  it('parses a valid finding and stamps agent name', async () => {
    const raw = JSON.stringify([{ severity: 'high', basis: 'SPECULATIVE', confidence: 60, file: 'src/parser.ts', line: 33, title: 'Denial of service via regex backtracking', detail: 'The regex /^(a+)+$/ is vulnerable to ReDoS', suggestion: 'Replace with a linear-time parser' }])
    const findings = await new AdversarialAgent(makeProvider(raw), DEFAULT_CONFIG).run({ diff: 'diff' })
    expect(findings).toHaveLength(1)
    expect(findings[0].agent).toBe('adversarial')
    expect(findings[0].id).toBe('adversarial-0')
  })

  it('returns empty array on parse failure', async () => {
    expect(await new AdversarialAgent(makeProvider('{}'), DEFAULT_CONFIG).run({ diff: 'diff' })).toEqual([])
  })

  it('system prompt mentions adversarial or abuse', () => {
    const agent = new AdversarialAgent(makeProvider('[]'), DEFAULT_CONFIG)
    expect(agent.systemPrompt).toMatch(/adversar|abuse|attack|malicious|exploit/i)
  })
})
