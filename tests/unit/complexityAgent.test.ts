import { vi, describe, it, expect, beforeEach } from 'vitest'
import { runTool } from '../../src/utils/shell.js'

vi.mock('../../src/utils/shell.js', () => ({
  runTool: vi.fn(),
}))
const mockRunTool = vi.mocked(runTool)

import { ComplexityAgent } from '../../src/core/agents/complexity.js'
import { DEFAULT_CONFIG } from '../../src/core/config.js'
import { ParseFailureError } from '../../src/core/parsing.js'
import type { LLMProvider } from '../../src/core/llm/provider.js'

const makeProvider = (response: string): LLMProvider => ({
  chat: vi.fn().mockResolvedValue(response),
  ping: vi.fn().mockResolvedValue({ ok: true }),
})

const DIFF_WITH_FILE = `diff --git a/src/app.ts b/src/app.ts
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,3 +1,6 @@
+function doThing() {
+  return 1
+}
`

describe('ComplexityAgent', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockRunTool.mockResolvedValue(null) // default: lizard not found
  })

  it('has name complexity', () => {
    const agent = new ComplexityAgent(makeProvider('[]'), DEFAULT_CONFIG)
    expect(agent.name).toBe('complexity')
  })

  it('declares toolKey lizard', () => {
    const agent = new ComplexityAgent(makeProvider('[]'), DEFAULT_CONFIG)
    expect(agent.toolKey).toBe('lizard')
  })

  it('sets lastToolAvailability to "used" when lizard ran', async () => {
    mockRunTool.mockResolvedValue('Function complexity: 15\n')
    const agent = new ComplexityAgent(makeProvider('[]'), DEFAULT_CONFIG)
    await agent.run({ diff: DIFF_WITH_FILE })
    expect(agent.lastToolAvailability).toBe('used')
  })

  it('sets lastToolAvailability to "unavailable-llm-fallback" when lizard is not installed', async () => {
    mockRunTool.mockResolvedValue(null)
    const agent = new ComplexityAgent(makeProvider('[]'), DEFAULT_CONFIG)
    await agent.run({ diff: DIFF_WITH_FILE })
    expect(agent.lastToolAvailability).toBe('unavailable-llm-fallback')
  })

  it('leaves lastToolAvailability unset when the diff has no changed files', async () => {
    const agent = new ComplexityAgent(makeProvider('[]'), DEFAULT_CONFIG)
    await agent.run({ diff: 'no file markers here' })
    expect(agent.lastToolAvailability).toBeUndefined()
    expect(mockRunTool).not.toHaveBeenCalled()
  })

  it('falls back to LLM when lizard not installed', async () => {
    mockRunTool.mockResolvedValue(null)
    const provider = makeProvider('[]')
    const agent = new ComplexityAgent(provider, DEFAULT_CONFIG)
    const findings = await agent.run({ diff: DIFF_WITH_FILE })
    expect(provider.chat).toHaveBeenCalledOnce()
    expect(findings).toEqual([])
  })

  it('includes lizard metrics in LLM input when lizard found', async () => {
    const lizardOutput = 'Function complexity: 15\n'
    mockRunTool.mockResolvedValue(lizardOutput)
    const provider = makeProvider('[]')
    const agent = new ComplexityAgent(provider, DEFAULT_CONFIG)
    await agent.run({ diff: DIFF_WITH_FILE })
    expect(mockRunTool).toHaveBeenCalledWith('lizard', ['src/app.ts'], undefined, false, '.')
    expect(provider.chat).toHaveBeenCalledOnce()
    // The LLM prompt content should include the lizard metrics
    const chatArgs = (provider.chat as ReturnType<typeof vi.fn>).mock.calls[0]
    const messages = chatArgs[0] as Array<{ role: string; content: string }>
    const userMessage = messages.find((m) => m.role === 'user')
    expect(userMessage?.content).toContain(lizardOutput.trim())
  })

  it('parses a valid finding and stamps agent name', async () => {
    mockRunTool.mockResolvedValue(null)
    const raw = JSON.stringify([
      {
        severity: 'high',
        basis: 'VERIFIED',
        confidence: 80,
        file: 'src/app.ts',
        line: 10,
        title: 'High cyclomatic complexity',
        detail: 'Function has 16 decision paths',
        suggestion: 'Break into smaller functions',
      },
    ])
    const agent = new ComplexityAgent(makeProvider(raw), DEFAULT_CONFIG)
    const findings = await agent.run({ diff: DIFF_WITH_FILE })
    expect(findings).toHaveLength(1)
    expect(findings[0].agent).toBe('complexity')
    expect(findings[0].id).toBe('complexity-0')
  })

  it('system prompt mentions cyclomatic complexity', () => {
    const agent = new ComplexityAgent(makeProvider('[]'), DEFAULT_CONFIG)
    expect(agent.systemPrompt).toMatch(/cyclomatic/i)
  })

  it('throws ParseFailureError on parse failure', async () => {
    mockRunTool.mockResolvedValue(null)
    const agent = new ComplexityAgent(makeProvider('not json'), DEFAULT_CONFIG)
    await expect(agent.run({ diff: DIFF_WITH_FILE })).rejects.toThrow(ParseFailureError)
  })

  it('passes -C <threshold> to lizard when complexityThreshold is configured', async () => {
    mockRunTool.mockResolvedValue('Function complexity: 15\n')
    const config = { ...DEFAULT_CONFIG, complexityThreshold: 20 }
    const agent = new ComplexityAgent(makeProvider('[]'), config)
    await agent.run({ diff: DIFF_WITH_FILE })
    expect(mockRunTool).toHaveBeenCalledWith(
      'lizard',
      ['src/app.ts', '-C', '20'],
      undefined,
      false,
      '.'
    )
  })

  it('does not pass -C when complexityThreshold is not configured, so lizard uses its own default', async () => {
    mockRunTool.mockResolvedValue('Function complexity: 15\n')
    const agent = new ComplexityAgent(makeProvider('[]'), DEFAULT_CONFIG)
    await agent.run({ diff: DIFF_WITH_FILE })
    expect(mockRunTool).toHaveBeenCalledWith('lizard', ['src/app.ts'], undefined, false, '.')
  })

  it('excludes deleted files (+++ /dev/null) from the file list passed to lizard', async () => {
    const diffWithDeletion = `diff --git a/src/old.ts b/src/old.ts
--- a/src/old.ts
+++ /dev/null
@@ -1,3 +0,0 @@
-function gone() {
-  return 1
-}
${DIFF_WITH_FILE}`
    mockRunTool.mockResolvedValue('Function complexity: 15\n')
    const agent = new ComplexityAgent(makeProvider('[]'), DEFAULT_CONFIG)
    await agent.run({ diff: diffWithDeletion })
    expect(mockRunTool).toHaveBeenCalledWith('lizard', ['src/app.ts'], undefined, false, '.')
  })

  it('passes projectPath through as cwd, so lizard resolves paths against the reviewed project instead of the process cwd', async () => {
    mockRunTool.mockResolvedValue('Function complexity: 15\n')
    const provider = makeProvider('[]')
    const agent = new ComplexityAgent(provider, DEFAULT_CONFIG)

    await agent.run({ diff: DIFF_WITH_FILE, projectPath: '/some/other/project' })

    expect(mockRunTool).toHaveBeenCalledWith(
      'lizard',
      ['src/app.ts'],
      undefined,
      false,
      '/some/other/project'
    )
  })
})
