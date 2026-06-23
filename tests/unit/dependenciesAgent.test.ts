// Unit tests — mock the LLM provider. Ollama is NOT required to run these.
import { describe, it, expect, vi } from 'vitest'
import { DependenciesAgent } from '../../src/core/agents/dependencies.js'
import { DEFAULT_CONFIG } from '../../src/core/config.js'
import type { LLMProvider } from '../../src/core/llm/provider.js'

const makeProvider = (response: string): LLMProvider => ({
  chat: vi.fn().mockResolvedValue(response),
  ping: vi.fn().mockResolvedValue({ ok: true }),
})

describe('DependenciesAgent', () => {
  it('has name dependencies', () => {
    expect(new DependenciesAgent(makeProvider('[]'), DEFAULT_CONFIG).name).toBe('dependencies')
  })

  it('returns empty array when provider returns empty JSON array', async () => {
    expect(
      await new DependenciesAgent(makeProvider('[]'), DEFAULT_CONFIG).run({ diff: 'diff' })
    ).toEqual([])
  })

  it('parses a valid finding and stamps agent name', async () => {
    const raw = JSON.stringify([
      {
        severity: 'high',
        basis: 'VERIFIED',
        confidence: 88,
        file: 'package.json',
        line: 12,
        title: 'Vulnerable dependency: lodash < 4.17.21',
        detail: 'Prototype pollution CVE-2021-23337',
        suggestion: 'Upgrade to lodash@4.17.21',
      },
    ])
    const findings = await new DependenciesAgent(makeProvider(raw), DEFAULT_CONFIG).run({
      diff: 'diff',
    })
    expect(findings).toHaveLength(1)
    expect(findings[0].agent).toBe('dependencies')
    expect(findings[0].id).toBe('dependencies-0')
  })

  it('returns empty array on parse failure', async () => {
    expect(
      await new DependenciesAgent(makeProvider(''), DEFAULT_CONFIG).run({ diff: 'diff' })
    ).toEqual([])
  })

  it('system prompt mentions dependencies or packages', () => {
    const agent = new DependenciesAgent(makeProvider('[]'), DEFAULT_CONFIG)
    expect(agent.systemPrompt).toMatch(/depend|package|npm|vulnerab|CVE/i)
  })
})
