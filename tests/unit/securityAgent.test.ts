// Unit tests — mock the LLM provider. Ollama is NOT required to run these.
import { describe, it, expect, vi } from 'vitest'
import { SecurityAgent } from '../../src/core/agents/security.js'
import { DEFAULT_CONFIG } from '../../src/core/config.js'
import { ParseFailureError } from '../../src/core/parsing.js'
import type { LLMProvider } from '../../src/core/llm/provider.js'

const makeProvider = (response: string): LLMProvider => ({
  chat: vi.fn().mockResolvedValue(response),
  ping: vi.fn().mockResolvedValue({ ok: true }),
})

describe('SecurityAgent', () => {
  it('has name security', () => {
    expect(new SecurityAgent(makeProvider('[]'), DEFAULT_CONFIG).name).toBe('security')
  })

  it('returns empty array when provider returns empty JSON array', async () => {
    expect(
      await new SecurityAgent(makeProvider('[]'), DEFAULT_CONFIG).run({ diff: 'diff content' })
    ).toEqual([])
  })

  it('parses a valid finding and stamps agent name', async () => {
    const raw = JSON.stringify([
      {
        severity: 'critical',
        basis: 'VERIFIED',
        confidence: 90,
        file: 'src/auth.ts',
        line: 4,
        title: 'Hardcoded API secret',
        detail: 'API_SECRET is committed to source',
        suggestion: 'Move to environment variable',
      },
    ])
    const findings = await new SecurityAgent(makeProvider(raw), DEFAULT_CONFIG).run({
      diff: 'diff',
    })
    expect(findings).toHaveLength(1)
    expect(findings[0].agent).toBe('security')
    expect(findings[0].id).toBe('security-0')
    expect(findings[0].severity).toBe('critical')
  })

  it('throws ParseFailureError on parse failure', async () => {
    await expect(
      new SecurityAgent(makeProvider('not json'), DEFAULT_CONFIG).run({ diff: 'diff' })
    ).rejects.toThrow(ParseFailureError)
  })

  it('system prompt mentions injection and OWASP', () => {
    const agent = new SecurityAgent(makeProvider('[]'), DEFAULT_CONFIG)
    expect(agent.systemPrompt).toMatch(/injection/i)
    expect(agent.systemPrompt).toMatch(/OWASP/i)
  })
})
