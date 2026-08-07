// Unit tests — mock the LLM provider. Ollama is NOT required to run these.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runTool } from '../../src/utils/shell.js'

vi.mock('../../src/utils/shell.js', () => ({
  runTool: vi.fn(),
}))
const mockRunTool = vi.mocked(runTool)

import { readFileSync } from 'fs'
import { DependenciesAgent } from '../../src/core/agents/dependencies.js'
import { DEFAULT_CONFIG } from '../../src/core/config.js'
import { ParseFailureError } from '../../src/core/parsing.js'
import type { LLMProvider } from '../../src/core/llm/provider.js'

const makeProvider = (response: string): LLMProvider => ({
  chat: vi.fn().mockResolvedValue(response),
  ping: vi.fn().mockResolvedValue({ ok: true }),
})

beforeEach(() => {
  vi.resetAllMocks()
  mockRunTool.mockResolvedValue(null) // default: npm audit not run, existing tests unaffected
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

  it('throws ParseFailureError on parse failure', async () => {
    await expect(
      new DependenciesAgent(makeProvider(''), DEFAULT_CONFIG).run({ diff: 'diff' })
    ).rejects.toThrow(ParseFailureError)
  })

  it('system prompt mentions dependencies or packages', () => {
    const agent = new DependenciesAgent(makeProvider('[]'), DEFAULT_CONFIG)
    expect(agent.systemPrompt).toMatch(/depend|package|npm|vulnerab|CVE/i)
  })
})

describe('DependenciesAgent npm-audit integration', () => {
  const MANIFEST_DIFF = `diff --git a/package.json b/package.json
--- a/package.json
+++ b/package.json
@@ -1,1 +1,1 @@
-"a":"1"
+"a":"2"`

  const NON_MANIFEST_DIFF = `diff --git a/src/foo.ts b/src/foo.ts
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,1 +1,1 @@
-a
+b`

  it('uses npm audit and never calls the LLM when the diff touches package.json and projectPath is set', async () => {
    mockRunTool.mockResolvedValue(readFileSync('tests/fixtures/npm-audit-sample.json', 'utf-8'))
    const provider = makeProvider('[]')
    const agent = new DependenciesAgent(provider, DEFAULT_CONFIG)

    const findings = await agent.run({ diff: MANIFEST_DIFF, projectPath: '.' })

    expect(provider.chat).not.toHaveBeenCalled()
    expect(findings.length).toBeGreaterThan(0)
    expect(findings.every((f) => f.source === 'npm-audit')).toBe(true)
    expect(agent.lastToolAvailability).toBe('used')
  })

  it('falls back to the LLM when the diff does not touch a manifest file', async () => {
    const provider = makeProvider('[]')
    const agent = new DependenciesAgent(provider, DEFAULT_CONFIG)

    await agent.run({ diff: NON_MANIFEST_DIFF, projectPath: '.' })

    expect(mockRunTool).not.toHaveBeenCalled()
    expect(provider.chat).toHaveBeenCalledOnce()
    expect(agent.lastToolAvailability).toBeUndefined()
  })

  it('falls back to the LLM with degraded status when manifest changed but projectPath is missing', async () => {
    const provider = makeProvider('[]')
    const agent = new DependenciesAgent(provider, DEFAULT_CONFIG)

    await agent.run({ diff: MANIFEST_DIFF })

    expect(mockRunTool).not.toHaveBeenCalled()
    expect(provider.chat).toHaveBeenCalledOnce()
    expect(agent.lastToolAvailability).toBe('unavailable-llm-fallback')
  })

  it('falls back to the LLM with degraded status when npm audit is unavailable', async () => {
    mockRunTool.mockResolvedValue(null)
    const provider = makeProvider('[]')
    const agent = new DependenciesAgent(provider, DEFAULT_CONFIG)

    await agent.run({ diff: MANIFEST_DIFF, projectPath: '.' })

    expect(provider.chat).toHaveBeenCalledOnce()
    expect(agent.lastToolAvailability).toBe('unavailable-llm-fallback')
  })

  it('passes projectPath through as cwd, so npm audit runs against the reviewed project instead of the process cwd', async () => {
    mockRunTool.mockResolvedValue('{"vulnerabilities":{}}')
    const provider = makeProvider('[]')
    const agent = new DependenciesAgent(provider, DEFAULT_CONFIG)

    await agent.run({ diff: MANIFEST_DIFF, projectPath: '/some/other/project' })

    expect(mockRunTool).toHaveBeenCalledWith(
      'npm',
      ['audit', '--json'],
      undefined,
      true,
      '/some/other/project'
    )
  })
})
