import { describe, it, expect, vi } from 'vitest'
import { LicenseComplianceAgent } from '../../src/core/agents/licenseCompliance.js'
import { DEFAULT_CONFIG } from '../../src/core/config.js'
import { ParseFailureError } from '../../src/core/parsing.js'
import type { LLMProvider } from '../../src/core/llm/provider.js'

const makeProvider = (response: string): LLMProvider => ({
  chat: vi.fn().mockResolvedValue(response),
  ping: vi.fn().mockResolvedValue({ ok: true }),
})

describe('LicenseComplianceAgent', () => {
  it('has name license', () => {
    const agent = new LicenseComplianceAgent(makeProvider('[]'), DEFAULT_CONFIG)
    expect(agent.name).toBe('license')
  })

  it('returns empty array when provider returns empty JSON array', async () => {
    const agent = new LicenseComplianceAgent(makeProvider('[]'), DEFAULT_CONFIG)
    const findings = await agent.run({ diff: 'diff content' })
    expect(findings).toEqual([])
  })

  it('parses a valid finding and stamps agent name', async () => {
    const raw = JSON.stringify([
      {
        severity: 'high',
        basis: 'VERIFIED',
        file: 'package.json',
        line: 14,
        title: 'GPL-3.0 dependency: some-gpl-lib',
        detail: 'some-gpl-lib uses GPL-3.0 which is incompatible with commercial use',
        suggestion: 'Replace with an MIT-licensed alternative or obtain a commercial license',
      },
    ])
    const agent = new LicenseComplianceAgent(makeProvider(raw), DEFAULT_CONFIG)
    const findings = await agent.run({ diff: 'diff' })
    expect(findings).toHaveLength(1)
    expect(findings[0].agent).toBe('license')
    expect(findings[0].id).toBe('license-0')
  })

  it('throws ParseFailureError on parse failure', async () => {
    const agent = new LicenseComplianceAgent(makeProvider('not json'), DEFAULT_CONFIG)
    await expect(agent.run({ diff: 'diff' })).rejects.toThrow(ParseFailureError)
  })

  it('system prompt mentions GPL AGPL SSPL and Commons Clause', () => {
    const agent = new LicenseComplianceAgent(makeProvider('[]'), DEFAULT_CONFIG)
    expect(agent.systemPrompt).toMatch(/GPL/i)
    expect(agent.systemPrompt).toMatch(/AGPL/i)
    expect(agent.systemPrompt).toMatch(/SSPL/i)
    expect(agent.systemPrompt).toMatch(/Commons Clause/i)
  })

  it('required-format example uses the generic placeholder line number, not a hallucination seed', () => {
    const agent = new LicenseComplianceAgent(makeProvider('[]'), DEFAULT_CONFIG)
    expect(agent.systemPrompt).not.toMatch(/"line":\s*14\b/)
    expect(agent.systemPrompt).toMatch(/"line":\s*42\b/)
  })

  it('does not name a concrete package (e.g. MongoDB) in the SSPL explanation', () => {
    const agent = new LicenseComplianceAgent(makeProvider('[]'), DEFAULT_CONFIG)
    expect(agent.systemPrompt).not.toMatch(/mongodb/i)
  })
})
