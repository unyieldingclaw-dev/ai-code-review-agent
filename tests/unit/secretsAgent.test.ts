import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runTool } from '../../src/utils/shell.js'

vi.mock('../../src/utils/shell.js', () => ({
  runTool: vi.fn(),
}))
const mockRunTool = vi.mocked(runTool)

import { readFileSync } from 'fs'
import { SecretsAgent } from '../../src/core/agents/secrets.js'
import { DEFAULT_CONFIG } from '../../src/core/config.js'
import { ParseFailureError } from '../../src/core/parsing.js'
import type { LLMProvider } from '../../src/core/llm/provider.js'

const makeProvider = (response: string): LLMProvider => ({
  chat: vi.fn().mockResolvedValue(response),
  ping: vi.fn().mockResolvedValue({ ok: true }),
})

const FAKE_DIFF = `--- a/src/config.ts
+++ b/src/config.ts
@@ -1,1 +1,3 @@
+const API_KEY = 'sk_live_REPLACE_WITH_REAL_KEY_DO_NOT_COMMIT'
+const SECRET = 'AAAAAAAAAAAAAAAAAAAAAA'`

beforeEach(() => {
  vi.resetAllMocks()
  mockRunTool.mockResolvedValue(null) // default: gitleaks not found, existing tests unaffected
})

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
    const raw = JSON.stringify([
      {
        severity: 'high',
        basis: 'VERIFIED',
        confidence: 90,
        file: 'src/config.ts',
        line: 2,
        title: 'Hardcoded API key',
        detail: 'API key found in source code',
        suggestion: 'Move to environment variable',
      },
    ])
    const agent = new SecretsAgent(makeProvider(raw), DEFAULT_CONFIG)
    const findings = await agent.run({ diff: FAKE_DIFF })
    expect(findings).toHaveLength(1)
    expect(findings[0].agent).toBe('secrets')
    expect(findings[0].id).toBe('secrets-0')
  })

  it('throws ParseFailureError on LLM parse failure', async () => {
    await expect(
      new SecretsAgent(makeProvider('not json'), DEFAULT_CONFIG).run({ diff: FAKE_DIFF })
    ).rejects.toThrow(ParseFailureError)
  })

  it('system prompt mentions credentials and secrets', () => {
    const agent = new SecretsAgent(makeProvider('[]'), DEFAULT_CONFIG)
    expect(agent.systemPrompt).toMatch(/credential/i)
    expect(agent.systemPrompt).toMatch(/secret/i)
  })
})

describe('SecretsAgent gitleaks integration', () => {
  // src/core/config.ts is a real file in this repo -- required so the run() override's
  // existsSync filter doesn't drop it before ever reaching gitleaks.
  const DIFF = `diff --git a/src/core/config.ts b/src/core/config.ts
--- a/src/core/config.ts
+++ b/src/core/config.ts
@@ -1,1 +1,1 @@
-old
+new`

  it('uses gitleaks and never calls the LLM when gitleaks is available', async () => {
    mockRunTool.mockResolvedValue(readFileSync('tests/fixtures/gitleaks-leak-found.json', 'utf-8'))
    const provider = makeProvider('[]')
    const agent = new SecretsAgent(provider, DEFAULT_CONFIG)

    const findings = await agent.run({ diff: DIFF })

    expect(provider.chat).not.toHaveBeenCalled()
    expect(findings).toHaveLength(1)
    expect(findings[0].source).toBe('gitleaks')
    expect(agent.lastToolAvailability).toBe('used')
  })

  it('falls back to the LLM when gitleaks is not installed', async () => {
    mockRunTool.mockResolvedValue(null)
    const provider = makeProvider('[]')
    const agent = new SecretsAgent(provider, DEFAULT_CONFIG)

    await agent.run({ diff: DIFF })

    expect(provider.chat).toHaveBeenCalledOnce()
    expect(agent.lastToolAvailability).toBe('unavailable-llm-fallback')
  })

  it('records tool usage as "used" when gitleaks ran, even with zero leaks', async () => {
    mockRunTool.mockResolvedValue('[]')
    const provider = makeProvider('[]')
    const agent = new SecretsAgent(provider, DEFAULT_CONFIG)

    const findings = await agent.run({ diff: DIFF })

    expect(provider.chat).not.toHaveBeenCalled()
    expect(findings).toEqual([])
    expect(agent.lastToolAvailability).toBe('used')
  })

  it('calls gitleaks once per changed file that exists on disk', async () => {
    mockRunTool.mockResolvedValue('[]')
    const provider = makeProvider('[]')
    const agent = new SecretsAgent(provider, DEFAULT_CONFIG)
    // src/core/config.ts is a real file in this repo -- exercises the existsSync filter's
    // true branch without needing a throwaway fixture file on disk.
    const diff = `diff --git a/src/core/config.ts b/src/core/config.ts
--- a/src/core/config.ts
+++ b/src/core/config.ts
@@ -1,1 +1,1 @@
-old
+new`

    await agent.run({ diff })

    expect(mockRunTool).toHaveBeenCalledWith(
      'gitleaks',
      expect.arrayContaining(['detect', '--source', 'src/core/config.ts', '--redact']),
      undefined,
      false,
      '.'
    )
  })

  it('passes projectPath through as cwd, so gitleaks and existsSync resolve against the reviewed project instead of the process cwd', async () => {
    mockRunTool.mockResolvedValue('[]')
    const provider = makeProvider('[]')
    const agent = new SecretsAgent(provider, DEFAULT_CONFIG)

    await agent.run({ diff: DIFF, projectPath: process.cwd() })

    expect(mockRunTool).toHaveBeenCalledWith(
      'gitleaks',
      expect.any(Array),
      undefined,
      false,
      process.cwd()
    )
  })
})
