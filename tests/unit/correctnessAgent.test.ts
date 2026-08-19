// Unit tests — mock the LLM provider. Ollama is NOT required to run these.
import { describe, it, expect, vi } from 'vitest'
import { CorrectnessAgent } from '../../src/core/agents/correctness.js'
import { DEFAULT_CONFIG } from '../../src/core/config.js'
import { ParseFailureError } from '../../src/core/parsing.js'
import type { LLMProvider } from '../../src/core/llm/provider.js'

const makeProvider = (response: string): LLMProvider => ({
  chat: vi.fn().mockResolvedValue(response),
  ping: vi.fn().mockResolvedValue({ ok: true }),
})

describe('CorrectnessAgent', () => {
  it('has name correctness', () => {
    expect(new CorrectnessAgent(makeProvider('[]'), DEFAULT_CONFIG).name).toBe('correctness')
  })

  it('returns empty array when provider returns empty JSON array', async () => {
    expect(
      await new CorrectnessAgent(makeProvider('[]'), DEFAULT_CONFIG).run({ diff: 'diff' })
    ).toEqual([])
  })

  it('parses a valid finding and stamps agent name', async () => {
    const raw = JSON.stringify([
      {
        severity: 'high',
        basis: 'VERIFIED',
        confidence: 85,
        file: 'src/utils.ts',
        line: 15,
        title: 'Off-by-one in slice',
        detail: 'Array slice uses wrong end index',
        suggestion: 'Change arr.slice(0, n-1) to arr.slice(0, n)',
      },
    ])
    const findings = await new CorrectnessAgent(makeProvider(raw), DEFAULT_CONFIG).run({
      diff: 'diff',
    })
    expect(findings).toHaveLength(1)
    expect(findings[0].agent).toBe('correctness')
    expect(findings[0].id).toBe('correctness-0')
  })

  it('throws ParseFailureError on parse failure', async () => {
    await expect(
      new CorrectnessAgent(makeProvider('undefined'), DEFAULT_CONFIG).run({ diff: 'diff' })
    ).rejects.toThrow(ParseFailureError)
  })

  it('system prompt mentions correctness or logic', () => {
    const agent = new CorrectnessAgent(makeProvider('[]'), DEFAULT_CONFIG)
    expect(agent.systemPrompt).toMatch(/correct|logic|bug|error/i)
  })

  // Regression test for a false positive reproduced live (3/5 trials against real Ollama): this
  // agent has zero security framing in its focus list, yet invented "Potential SQL Injection"
  // findings against a parameterized Postgres function with no dynamic SQL construction anywhere.
  it('system prompt tells the agent not to invent security-vulnerability labels', () => {
    const agent = new CorrectnessAgent(makeProvider('[]'), DEFAULT_CONFIG)
    expect(agent.systemPrompt).toMatch(/security agent/i)
    expect(agent.systemPrompt).toMatch(/injection/i)
  })
})
