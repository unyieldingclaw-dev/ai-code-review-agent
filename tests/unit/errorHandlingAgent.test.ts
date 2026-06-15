import { describe, it, expect, vi } from 'vitest'
import { ErrorHandlingAgent } from '../../src/core/agents/errorHandling.js'
import { DEFAULT_CONFIG } from '../../src/core/config.js'
import type { LLMProvider } from '../../src/core/llm/provider.js'

const makeProvider = (response: string): LLMProvider => ({
  chat: vi.fn().mockResolvedValue(response),
  ping: vi.fn().mockResolvedValue({ ok: true })
})

describe('ErrorHandlingAgent', () => {
  it('has name error-handling', () => {
    expect(new ErrorHandlingAgent(makeProvider('[]'), DEFAULT_CONFIG).name).toBe('error-handling')
  })

  it('returns empty array when provider returns empty JSON array', async () => {
    expect(await new ErrorHandlingAgent(makeProvider('[]'), DEFAULT_CONFIG).run({ diff: 'diff content' })).toEqual([])
  })

  it('parses a valid finding and stamps agent name', async () => {
    const raw = JSON.stringify([{ severity: 'high', basis: 'VERIFIED', confidence: 80, file: 'src/api.ts', line: 10, title: 'Swallowed exception in fetchUser', detail: 'The catch block is empty', suggestion: 'Rethrow the error' }])
    const agent = new ErrorHandlingAgent(makeProvider(raw), DEFAULT_CONFIG)
    const findings = await agent.run({ diff: 'diff' })
    expect(findings).toHaveLength(1)
    expect(findings[0].agent).toBe('error-handling')
    expect(findings[0].id).toBe('error-handling-0')
  })

  it('returns empty array on parse failure', async () => {
    expect(await new ErrorHandlingAgent(makeProvider('not json'), DEFAULT_CONFIG).run({ diff: 'diff' })).toEqual([])
  })

  it('system prompt mentions swallowed exceptions and Promise rejections', () => {
    const agent = new ErrorHandlingAgent(makeProvider('[]'), DEFAULT_CONFIG)
    expect(agent.systemPrompt).toMatch(/swallowed/i)
    expect(agent.systemPrompt).toMatch(/promise/i)
  })
})
