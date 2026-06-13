// tests/unit/runner.test.ts
import { describe, it, expect, vi } from 'vitest'
import { SwarmRunner } from '../../src/core/runner.js'
import { DEFAULT_CONFIG } from '../../src/core/config.js'
import type { LLMProvider } from '../../src/core/llm/provider.js'
import type { AgentName } from '../../src/core/schema.js'

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

  it('continues with other agents when one agent times out', async () => {
    let callCount = 0
    const provider: LLMProvider = {
      chat: vi.fn().mockImplementation(() => {
        callCount++
        // First call hangs forever; subsequent calls resolve normally
        if (callCount === 1) return new Promise(() => {})
        return Promise.resolve('[]')
      }),
      ping: vi.fn().mockResolvedValue({ ok: true })
    }
    const config = { ...DEFAULT_CONFIG, agentTimeoutMs: 50, retryAttempts: 1, retryDelayMs: 0, agents: ['security', 'correctness'] as AgentName[] }
    const runner = new SwarmRunner(config, provider)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = await runner.run({ diff: 'diff' })
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('timed out'))
    expect(result.findings).toBeInstanceOf(Array)
    warnSpy.mockRestore()
  }, 10000)

  it('retries a failing agent and succeeds on second attempt', async () => {
    let callCount = 0
    const provider: LLMProvider = {
      chat: vi.fn().mockImplementation(() => {
        callCount++
        if (callCount === 1) return Promise.reject(new Error('connection refused'))
        return Promise.resolve('[]')
      }),
      ping: vi.fn().mockResolvedValue({ ok: true })
    }
    const config = { ...DEFAULT_CONFIG, agents: ['security'] as AgentName[], retryAttempts: 2, retryDelayMs: 0 }
    const runner = new SwarmRunner(config, provider)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = await runner.run({ diff: 'diff' })
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('attempt 1/2'))
    expect(result.findings).toBeInstanceOf(Array)
    warnSpy.mockRestore()
  })

  it('skips agent after all retry attempts exhausted', async () => {
    const provider: LLMProvider = {
      chat: vi.fn().mockRejectedValue(new Error('always fails')),
      ping: vi.fn().mockResolvedValue({ ok: true })
    }
    const config = { ...DEFAULT_CONFIG, agents: ['security'] as AgentName[], retryAttempts: 2, retryDelayMs: 0 }
    const runner = new SwarmRunner(config, provider)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = await runner.run({ diff: 'diff' })
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('attempt 1/2'))
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('timed out or failed'))
    expect(result.findings).toEqual([])
    warnSpy.mockRestore()
  })

  it('does not retry when retryAttempts is 1', async () => {
    const provider: LLMProvider = {
      chat: vi.fn().mockRejectedValue(new Error('fail')),
      ping: vi.fn().mockResolvedValue({ ok: true })
    }
    const config = { ...DEFAULT_CONFIG, agents: ['security'] as AgentName[], retryAttempts: 1, retryDelayMs: 0 }
    const runner = new SwarmRunner(config, provider)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await runner.run({ diff: 'diff' })
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('retrying'))
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
