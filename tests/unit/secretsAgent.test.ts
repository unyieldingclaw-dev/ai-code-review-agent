import { describe, it, expect, vi } from 'vitest'
import { SecretsAgent } from '../../src/core/agents/secrets.js'
import { DEFAULT_CONFIG } from '../../src/core/config.js'
import type { LLMProvider } from '../../src/core/llm/provider.js'

const makeProvider = (response: string): LLMProvider => ({
  chat: vi.fn().mockResolvedValue(response),
  ping: vi.fn().mockResolvedValue({ ok: true })
})

const FAKE_DIFF = `--- a/src/config.ts
+++ b/src/config.ts
@@ -1,1 +1,3 @@
+const API_KEY = 'sk_live_REPLACE_WITH_REAL_KEY_DO_NOT_COMMIT'
+const SECRET = 'AAAAAAAAAAAAAAAAAAAAAA'`

describe('SecretsAgent', () => {
  it('has name secrets', () => {
    expect(new SecretsAgent(makeProvider('[]'), DEFAULT_CONFIG).name).toBe('secrets')
  })

  it('uses LLM to analyze the diff', async () => {
    const provider = makeProvider('[]')
    const agent = new SecretsAgent(provider, DEFAULT_CONFIG)
    const findings = await agent.run({ diff: FAKE_DIFF })
    expect(findings).toEqual([])
    expect(provider.chat).toHaveBeenCalled()
  })

  it('parses LLM finding and stamps agent name', async () => {
    const raw = JSON.stringify([{
      severity: 'high',
      basis: 'VERIFIED',
      confidence: 90,
      file: 'src/config.ts',
      line: 2,
      title: 'Hardcoded API key',
      detail: 'API key found in source code',
      suggestion: 'Move to environment variable'
    }])
    const agent = new SecretsAgent(makeProvider(raw), DEFAULT_CONFIG)
    const findings = await agent.run({ diff: FAKE_DIFF })
    expect(findings).toHaveLength(1)
    expect(findings[0].agent).toBe('secrets')
    expect(findings[0].id).toBe('secrets-0')
  })

  it('returns empty array on LLM parse failure', async () => {
    expect(
      await new SecretsAgent(makeProvider('not json'), DEFAULT_CONFIG).run({ diff: FAKE_DIFF })
    ).toEqual([])
  })

  it('system prompt mentions credentials and secrets', () => {
    const agent = new SecretsAgent(makeProvider('[]'), DEFAULT_CONFIG)
    expect(agent.systemPrompt).toMatch(/credential/i)
    expect(agent.systemPrompt).toMatch(/secret/i)
  })
})
