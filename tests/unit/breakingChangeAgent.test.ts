import { describe, it, expect, vi } from 'vitest'
import { BreakingChangeAgent } from '../../src/core/agents/breakingChange.js'
import { DEFAULT_CONFIG } from '../../src/core/config.js'
import { ParseFailureError } from '../../src/core/parsing.js'
import type { LLMProvider } from '../../src/core/llm/provider.js'

const makeProvider = (response: string): LLMProvider => ({
  chat: vi.fn().mockResolvedValue(response),
  ping: vi.fn().mockResolvedValue({ ok: true }),
})

describe('BreakingChangeAgent', () => {
  it('has name breaking-change', () => {
    const agent = new BreakingChangeAgent(makeProvider('[]'), DEFAULT_CONFIG)
    expect(agent.name).toBe('breaking-change')
  })

  it('returns empty array when provider returns empty JSON array', async () => {
    const agent = new BreakingChangeAgent(makeProvider('[]'), DEFAULT_CONFIG)
    const findings = await agent.run({ diff: 'diff content' })
    expect(findings).toEqual([])
  })

  it('parses a valid finding and stamps agent name', async () => {
    const raw = JSON.stringify([
      {
        severity: 'high',
        basis: 'VERIFIED',
        file: 'src/api.ts',
        line: 42,
        title: 'Removed export: createUser',
        detail: 'The exported function createUser was deleted',
        suggestion: 'Add a deprecation shim or update all callers',
      },
    ])
    const agent = new BreakingChangeAgent(makeProvider(raw), DEFAULT_CONFIG)
    const findings = await agent.run({ diff: 'diff' })
    expect(findings).toHaveLength(1)
    expect(findings[0].agent).toBe('breaking-change')
    expect(findings[0].id).toBe('breaking-change-0')
  })

  it('throws ParseFailureError on parse failure', async () => {
    const agent = new BreakingChangeAgent(makeProvider('not json'), DEFAULT_CONFIG)
    await expect(agent.run({ diff: 'diff' })).rejects.toThrow(ParseFailureError)
  })

  it('system prompt mentions exported functions and signatures', () => {
    const agent = new BreakingChangeAgent(makeProvider('[]'), DEFAULT_CONFIG)
    expect(agent.systemPrompt).toMatch(/export/i)
    expect(agent.systemPrompt).toMatch(/signature/i)
  })
})
