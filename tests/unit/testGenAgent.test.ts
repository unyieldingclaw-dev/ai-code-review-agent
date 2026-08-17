// Unit tests — mock the LLM provider. Ollama is NOT required to run these.
// TestGenAgent is opt-in (--suggest-tests or --write-tests).
import { describe, it, expect, vi } from 'vitest'
import { TestGenAgent } from '../../src/core/agents/testGen.js'
import { DEFAULT_CONFIG } from '../../src/core/config.js'
import type { LLMProvider } from '../../src/core/llm/provider.js'
import type { ReviewInput, CoverageGap } from '../../src/core/schema.js'

const makeProvider = (response: string): LLMProvider => ({
  chat: vi.fn().mockResolvedValue(response),
  ping: vi.fn().mockResolvedValue({ ok: true }),
})

describe('TestGenAgent', () => {
  const mockInput: ReviewInput = {
    diff: 'diff content',
    projectPath: '/tmp/project',
  }

  it('returns empty testFiles array when given no coverage gaps', async () => {
    const agent = new TestGenAgent(makeProvider(''), DEFAULT_CONFIG)
    const result = await agent.runWithGaps(mockInput, [])
    expect(result.testFiles).toEqual([])
  })

  it('generates test file for a single coverage gap', async () => {
    const testCode = 'describe("test", () => { it("should pass", () => {}) })'
    const agent = new TestGenAgent(makeProvider(testCode), DEFAULT_CONFIG)
    const gaps: CoverageGap[] = [
      {
        file: 'src/auth.ts',
        functionName: 'validateToken',
        lineStart: 10,
        lineEnd: 20,
        description: 'Validates JWT tokens',
      },
    ]
    const result = await agent.runWithGaps(mockInput, gaps)
    expect(result.testFiles.length).toBeGreaterThan(0)
    expect(result.testFiles[0].content).toContain('describe')
  })

  it('returns empty testFiles when LLM response is too short', async () => {
    const agent = new TestGenAgent(makeProvider('x'), DEFAULT_CONFIG)
    const gaps: CoverageGap[] = [
      {
        file: 'src/util.ts',
        functionName: 'helper',
        lineStart: 5,
        lineEnd: 10,
        description: 'Helper function',
      },
    ]
    const result = await agent.runWithGaps(mockInput, gaps)
    expect(result.testFiles).toEqual([])
  })

  it('returns empty testFiles when LLM response is long but has no test-framework structure', async () => {
    const prose =
      'I cannot generate this test because the function signature is ambiguous and I would need more context about the expected error handling behavior before writing anything runnable here.'
    const agent = new TestGenAgent(makeProvider(prose), DEFAULT_CONFIG)
    const gaps: CoverageGap[] = [
      {
        file: 'src/util.ts',
        functionName: 'helper',
        lineStart: 5,
        lineEnd: 10,
        description: 'Helper function',
      },
    ]
    const result = await agent.runWithGaps(mockInput, gaps)
    expect(result.testFiles).toEqual([])
  })

  it('rejects prose that merely contains the words "it" or "test" followed by a parenthesis', async () => {
    // "it" and "test" are common English words -- a refusal that happens to phrase a parenthetical
    // this way ("explain it (the reasoning) here") must not be mistaken for a real it(...) call.
    const prose =
      "I can't fully cover this edge case without more context. Let me explain it (the reasoning) here: the function depends on external state that isn't visible from this diff alone, so any test I write would be guessing at behavior."
    const agent = new TestGenAgent(makeProvider(prose), DEFAULT_CONFIG)
    const gaps: CoverageGap[] = [
      {
        file: 'src/util.ts',
        functionName: 'helper',
        lineStart: 5,
        lineEnd: 10,
        description: 'Helper function',
      },
    ]
    const result = await agent.runWithGaps(mockInput, gaps)
    expect(result.testFiles).toEqual([])
  })

  it('groups multiple gaps by file to minimize API calls', async () => {
    const testCode = 'describe("test", () => { it("gap1", () => {}) it("gap2", () => {}) })'
    const chat = vi.fn().mockResolvedValue(testCode)
    const agent = new TestGenAgent(
      { chat, ping: vi.fn().mockResolvedValue({ ok: true }) },
      DEFAULT_CONFIG
    )
    const gaps: CoverageGap[] = [
      {
        file: 'src/auth.ts',
        functionName: 'func1',
        lineStart: 10,
        lineEnd: 15,
        description: 'First function',
      },
      {
        file: 'src/auth.ts',
        functionName: 'func2',
        lineStart: 20,
        lineEnd: 25,
        description: 'Second function',
      },
    ]
    const result = await agent.runWithGaps(mockInput, gaps)
    // Should make only 1 API call for the same file
    expect(chat).toHaveBeenCalledTimes(1)
    expect(result.testFiles.length).toBe(1)
  })
})
