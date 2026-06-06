// tests/unit/runner.test.ts
import { describe, it, expect, vi } from 'vitest'
import { SwarmRunner } from '../../src/core/runner.js'
import { DEFAULT_CONFIG } from '../../src/core/config.js'
import type { LLMProvider } from '../../src/core/llm/provider.js'

const makeProvider = (response = '[]'): LLMProvider => ({
  chat: vi.fn().mockResolvedValue(response),
  ping: vi.fn().mockResolvedValue({ ok: true })
})

describe('SwarmRunner', () => {
  it('runs agents sequentially and returns a ReviewResult', async () => {
    const provider = makeProvider()
    const runner = new SwarmRunner(DEFAULT_CONFIG, provider)
    const result = await runner.run({ diff: 'diff content' })
    expect(result.findings).toBeInstanceOf(Array)
    expect(result.testFiles).toBeInstanceOf(Array)
    expect(result.summary.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('calls onProgress for each agent', async () => {
    const provider = makeProvider()
    const runner = new SwarmRunner(DEFAULT_CONFIG, provider)
    const progress: string[] = []
    await runner.run({ diff: 'diff' }, (agent) => progress.push(agent))
    expect(progress.length).toBe(DEFAULT_CONFIG.agents.length)
  })

  it('truncates diff that exceeds maxDiffLines and warns', async () => {
    const provider = makeProvider()
    const config = { ...DEFAULT_CONFIG, maxDiffLines: 3 }
    const runner = new SwarmRunner(config, provider)
    const largeDiff = Array.from({ length: 10 }, (_, i) => `line ${i}`).join('\n')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = await runner.run({ diff: largeDiff })
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Truncating'))
    expect(result.findings).toBeInstanceOf(Array)
    warnSpy.mockRestore()
  })

  it('aborts with error when ping fails', async () => {
    const provider: LLMProvider = {
      chat: vi.fn(),
      ping: vi.fn().mockResolvedValue({ ok: false, error: 'Ollama not running' })
    }
    const runner = new SwarmRunner(DEFAULT_CONFIG, provider)
    await expect(runner.run({ diff: 'diff' })).rejects.toThrow('Ollama not running')
  })
})
