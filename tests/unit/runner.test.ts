// tests/unit/runner.test.ts
import { describe, it, expect, vi } from 'vitest'
import { SwarmRunner, scaleAgentTimeout } from '../../src/core/runner.js'
import { DEFAULT_CONFIG } from '../../src/core/config.js'
import { formatMarkdown } from '../../src/cli/formatter.js'
import type { LLMProvider } from '../../src/core/llm/provider.js'
import type { AgentName, AgentProgressEvent, FailOnLevel } from '../../src/core/schema.js'

const makeProvider = (response = '[]'): LLMProvider => ({
  chat: vi.fn().mockResolvedValue(response),
  ping: vi.fn().mockResolvedValue({ ok: true }),
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
    await runner.run({ diff: 'diff' }, (event) => {
      if (event.phase === 'start') progress.push(event.name)
    })
    // migration-safety is excluded when diff has no migration files
    expect(progress.length).toBe(DEFAULT_CONFIG.agents.length - 1)
  })

  it('truncates diff that exceeds maxDiffLines, warns, and records truncation metadata', async () => {
    const provider = makeProvider()
    const config = { ...DEFAULT_CONFIG, maxDiffLines: 3 }
    const runner = new SwarmRunner(config, provider)
    const largeDiff = Array.from({ length: 10 }, (_, i) => `line ${i}`).join('\n')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = await runner.run({ diff: largeDiff })
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('7 of 10 lines were excluded'))
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('--max-lines'))
    expect(result.findings).toBeInstanceOf(Array)
    expect(result.truncation).toEqual({ truncated: true, originalLines: 10, keptLines: 3 })
    warnSpy.mockRestore()
  })

  it('does not include truncation metadata when the diff is within maxDiffLines', async () => {
    const provider = makeProvider()
    const runner = new SwarmRunner(DEFAULT_CONFIG, provider)
    const result = await runner.run({ diff: 'a short diff\nwith two lines' })
    expect(result.truncation).toBeUndefined()
  })

  it('scales the effective agent timeout up for a diff at the maxDiffLines truncation point', async () => {
    const provider: LLMProvider = {
      chat: vi.fn().mockImplementation(() => new Promise(() => {})), // never resolves
      ping: vi.fn().mockResolvedValue({ ok: true }),
    }
    const config = {
      ...DEFAULT_CONFIG,
      agents: ['security'] as AgentName[],
      agentTimeoutMs: 30, // base; scaled 2x -> 60ms at maxDiffLines
      maxDiffLines: 10,
      retryAttempts: 1,
      retryDelayMs: 0,
    }
    const runner = new SwarmRunner(config, provider)
    const largeDiff = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const start = Date.now()
    await runner.run({ diff: largeDiff })
    const elapsed = Date.now() - start
    expect(elapsed).toBeGreaterThanOrEqual(50)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('timed out'))
    warnSpy.mockRestore()
  }, 10000)

  it('does not scale the timeout for a diff well under maxDiffLines', async () => {
    const provider: LLMProvider = {
      chat: vi.fn().mockImplementation(() => new Promise(() => {})),
      ping: vi.fn().mockResolvedValue({ ok: true }),
    }
    const config = {
      ...DEFAULT_CONFIG,
      agents: ['security'] as AgentName[],
      agentTimeoutMs: 30,
      maxDiffLines: 2000,
      retryAttempts: 1,
      retryDelayMs: 0,
    }
    const runner = new SwarmRunner(config, provider)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const start = Date.now()
    await runner.run({ diff: 'a\nb\nc' })
    const elapsed = Date.now() - start
    expect(elapsed).toBeLessThan(50)
    warnSpy.mockRestore()
  }, 10000)

  it('does not scale the timeout when timeoutScalingEnabled is false, even for a large diff', async () => {
    const provider: LLMProvider = {
      chat: vi.fn().mockImplementation(() => new Promise(() => {})),
      ping: vi.fn().mockResolvedValue({ ok: true }),
    }
    const config = {
      ...DEFAULT_CONFIG,
      agents: ['security'] as AgentName[],
      agentTimeoutMs: 30,
      maxDiffLines: 10,
      timeoutScalingEnabled: false,
      retryAttempts: 1,
      retryDelayMs: 0,
    }
    const runner = new SwarmRunner(config, provider)
    const largeDiff = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const start = Date.now()
    await runner.run({ diff: largeDiff })
    const elapsed = Date.now() - start
    expect(elapsed).toBeLessThan(50)
    warnSpy.mockRestore()
  }, 10000)

  it('continues with other agents when one agent times out', async () => {
    let callCount = 0
    const provider: LLMProvider = {
      chat: vi.fn().mockImplementation(() => {
        callCount++
        // First call hangs forever; subsequent calls resolve normally
        if (callCount === 1) return new Promise(() => {})
        return Promise.resolve('[]')
      }),
      ping: vi.fn().mockResolvedValue({ ok: true }),
    }
    const config = {
      ...DEFAULT_CONFIG,
      agentTimeoutMs: 50,
      retryAttempts: 1,
      retryDelayMs: 0,
      agents: ['security', 'correctness'] as AgentName[],
    }
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
      ping: vi.fn().mockResolvedValue({ ok: true }),
    }
    const config = {
      ...DEFAULT_CONFIG,
      agents: ['security'] as AgentName[],
      retryAttempts: 2,
      retryDelayMs: 0,
    }
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
      ping: vi.fn().mockResolvedValue({ ok: true }),
    }
    const config = {
      ...DEFAULT_CONFIG,
      agents: ['security'] as AgentName[],
      retryAttempts: 2,
      retryDelayMs: 0,
    }
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
      ping: vi.fn().mockResolvedValue({ ok: true }),
    }
    const config = {
      ...DEFAULT_CONFIG,
      agents: ['security'] as AgentName[],
      retryAttempts: 1,
      retryDelayMs: 0,
    }
    const runner = new SwarmRunner(config, provider)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await runner.run({ diff: 'diff' })
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('retrying'))
    warnSpy.mockRestore()
  })

  it('aborts the underlying chat signal when an agent times out', async () => {
    // WHY this test: withTimeout used to just race a timer against the agent call without
    // cancelling the loser, so a "timed out" agent's request kept running server-side and
    // each retry piled another live request on top instead of replacing it. This proves the
    // signal passed to provider.chat() actually receives an abort when the timeout fires.
    let capturedSignal: AbortSignal | undefined
    const provider: LLMProvider = {
      chat: vi.fn().mockImplementation((_messages, options) => {
        capturedSignal = options?.signal
        return new Promise(() => {}) // never resolves — only the timeout ends this call
      }),
      ping: vi.fn().mockResolvedValue({ ok: true }),
    }
    const config = {
      ...DEFAULT_CONFIG,
      agents: ['security'] as AgentName[],
      agentTimeoutMs: 20,
      retryAttempts: 1,
      retryDelayMs: 0,
    }
    const runner = new SwarmRunner(config, provider)
    await runner.run({ diff: 'diff' })
    expect(capturedSignal).toBeInstanceOf(AbortSignal)
    expect(capturedSignal?.aborted).toBe(true)
  })

  it('clears the timeout timer after a successful call, leaving no dangling abort', async () => {
    // WHY this test: withTimeout's setTimeout handle was never captured/cleared, so even a
    // successful call left a live timer that later fired a pointless controller.abort() after
    // the work was already done. This proves the timer is cleared once the call succeeds, not
    // just when it wins the race by timing out.
    vi.useFakeTimers()
    try {
      const provider = makeProvider()
      const config = {
        ...DEFAULT_CONFIG,
        agents: ['security'] as AgentName[],
        agentTimeoutMs: 1000,
        retryAttempts: 1,
        retryDelayMs: 0,
      }
      const runner = new SwarmRunner(config, provider)
      await runner.run({ diff: 'diff' })
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('aborts with error when ping fails', async () => {
    const provider: LLMProvider = {
      chat: vi.fn(),
      ping: vi.fn().mockResolvedValue({ ok: false, error: 'Ollama not running' }),
    }
    const runner = new SwarmRunner(DEFAULT_CONFIG, provider)
    await expect(runner.run({ diff: 'diff' })).rejects.toThrow('Ollama not running')
  })

  it('skips migration-safety agent when diff has no migration files', async () => {
    const provider = makeProvider()
    const config = { ...DEFAULT_CONFIG, agents: ['security', 'migration-safety'] as AgentName[] }
    const runner = new SwarmRunner(config, provider)
    const progress: string[] = []
    await runner.run(
      { diff: '--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1,1 +1,1 @@\n-foo\n+bar' },
      (event) => {
        if (event.phase === 'start') progress.push(event.name)
      }
    )
    expect(progress).not.toContain('migration-safety')
    expect(progress).toContain('security')
  })

  it('onProgress fires start before end for each agent', async () => {
    const provider = makeProvider()
    const config = { ...DEFAULT_CONFIG, agents: ['security', 'correctness'] as AgentName[] }
    const runner = new SwarmRunner(config, provider)
    const events: { phase: string; name: AgentName }[] = []
    await runner.run({ diff: 'diff' }, (event) =>
      events.push({ phase: event.phase, name: event.name })
    )
    expect(events).toHaveLength(4)
    expect(events[0]).toMatchObject({ phase: 'start', name: 'security' })
    expect(events[1]).toMatchObject({ phase: 'end', name: 'security' })
    expect(events[2]).toMatchObject({ phase: 'start', name: 'correctness' })
    expect(events[3]).toMatchObject({ phase: 'end', name: 'correctness' })
  })

  it("onProgress 'end' event includes findings and elapsedMs", async () => {
    const provider = makeProvider()
    const config = { ...DEFAULT_CONFIG, agents: ['security'] as AgentName[] }
    const runner = new SwarmRunner(config, provider)
    const endEvents: AgentProgressEvent[] = []
    await runner.run({ diff: 'diff' }, (event) => {
      if (event.phase === 'end') endEvents.push(event)
    })
    expect(endEvents).toHaveLength(1)
    expect(endEvents[0].findings).toBeInstanceOf(Array)
    expect(typeof endEvents[0].elapsedMs).toBe('number')
  })

  it('warns that --fail-fast has no effect when --parallel is also enabled', async () => {
    const provider = makeProvider()
    const config = {
      ...DEFAULT_CONFIG,
      agents: ['security'] as AgentName[],
      failFast: true,
      parallel: true,
    }
    const runner = new SwarmRunner(config, provider)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await runner.run({ diff: 'diff' })
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('--fail-fast has no effect'))
    warnSpy.mockRestore()
  })

  it('does not warn about --fail-fast when parallel is left at its default (sequential)', async () => {
    const provider = makeProvider()
    const config = {
      ...DEFAULT_CONFIG,
      agents: ['security'] as AgentName[],
      failFast: true,
    }
    const runner = new SwarmRunner(config, provider)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await runner.run({ diff: 'diff' })
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('--fail-fast has no effect'))
    warnSpy.mockRestore()
  })

  it('failFast stops swarm after critical finding; remaining agents not called', async () => {
    const criticalFinding = JSON.stringify([
      {
        severity: 'critical',
        basis: 'VERIFIED',
        file: 'app.ts',
        line: 1,
        title: 'SQL Injection',
        detail: 'User input used directly in query',
        suggestion: 'Use parameterized queries',
      },
    ])
    let chatCallCount = 0
    const provider: LLMProvider = {
      chat: vi.fn().mockImplementation(() => {
        chatCallCount++
        return Promise.resolve(chatCallCount === 1 ? criticalFinding : '[]')
      }),
      ping: vi.fn().mockResolvedValue({ ok: true }),
    }
    const config = {
      ...DEFAULT_CONFIG,
      agents: ['security', 'correctness'] as AgentName[],
      failFast: true,
      failOn: 'high' as FailOnLevel,
    }
    const runner = new SwarmRunner(config, provider)
    const result = await runner.run({ diff: 'diff' })
    expect(result.earlyExit).toEqual({ stoppedAt: 'security' })
    expect(chatCallCount).toBe(1)
  })

  it('failFast does not stop when findings are below failOn threshold', async () => {
    const lowFinding = JSON.stringify([
      {
        severity: 'low',
        basis: 'INFERRED',
        file: 'app.ts',
        line: 1,
        title: 'Style',
        detail: 'Minor style issue',
        suggestion: 'Rename variable',
      },
    ])
    const provider: LLMProvider = {
      chat: vi.fn().mockResolvedValue(lowFinding),
      ping: vi.fn().mockResolvedValue({ ok: true }),
    }
    const config = {
      ...DEFAULT_CONFIG,
      agents: ['security', 'correctness'] as AgentName[],
      failFast: true,
      failOn: 'high' as FailOnLevel,
    }
    const runner = new SwarmRunner(config, provider)
    const result = await runner.run({ diff: 'diff' })
    expect(result.earlyExit).toBeUndefined()
    expect(provider.chat).toHaveBeenCalledTimes(2)
  })

  it('parallel mode runs all agents and collects findings from each', async () => {
    const finding = JSON.stringify([
      {
        severity: 'medium',
        basis: 'INFERRED',
        file: 'a.ts',
        line: 1,
        title: 'T',
        detail: 'D',
        suggestion: 'S',
      },
    ])
    const provider = makeProvider(finding)
    const config = {
      ...DEFAULT_CONFIG,
      agents: ['security', 'correctness'] as AgentName[],
      parallel: true,
    }
    const runner = new SwarmRunner(config, provider)
    const result = await runner.run({ diff: 'diff' })
    expect(provider.chat).toHaveBeenCalledTimes(2)
    expect(result.findings.length).toBeGreaterThan(0)
  })

  it('parallel mode fires all start events before any end events', async () => {
    const provider = makeProvider()
    const config = {
      ...DEFAULT_CONFIG,
      agents: ['security', 'correctness'] as AgentName[],
      parallel: true,
    }
    const runner = new SwarmRunner(config, provider)
    const events: { phase: string; name: AgentName }[] = []
    await runner.run({ diff: 'diff' }, (event) =>
      events.push({ phase: event.phase, name: event.name })
    )
    expect(events).toHaveLength(4)
    const firstEndIdx = events.findIndex((e) => e.phase === 'end')
    const lastStartIdx = events.map((e) => e.phase).lastIndexOf('start')
    expect(lastStartIdx).toBeLessThan(firstEndIdx)
  })

  it('failFast false runs all agents regardless of finding severity', async () => {
    const criticalFinding = JSON.stringify([
      {
        severity: 'critical',
        basis: 'VERIFIED',
        file: 'app.ts',
        line: 1,
        title: 'RCE',
        detail: 'Remote code execution',
        suggestion: 'Sanitize input',
      },
    ])
    const provider: LLMProvider = {
      chat: vi.fn().mockResolvedValue(criticalFinding),
      ping: vi.fn().mockResolvedValue({ ok: true }),
    }
    const config = {
      ...DEFAULT_CONFIG,
      agents: ['security', 'correctness'] as AgentName[],
      failFast: false,
    }
    const runner = new SwarmRunner(config, provider)
    const result = await runner.run({ diff: 'diff' })
    expect(result.earlyExit).toBeUndefined()
    expect(provider.chat).toHaveBeenCalledTimes(2)
  })

  it('records agentStatus "ok" for agents that succeed', async () => {
    const provider = makeProvider()
    const config = { ...DEFAULT_CONFIG, agents: ['security'] as AgentName[] }
    const runner = new SwarmRunner(config, provider)
    const result = await runner.run({ diff: 'diff' })
    expect(result.agentStatus?.security).toBe('ok')
  })

  it('records agentStatus "timeout" when an agent times out', async () => {
    const provider: LLMProvider = {
      chat: vi.fn().mockImplementation(() => new Promise(() => {})), // never resolves
      ping: vi.fn().mockResolvedValue({ ok: true }),
    }
    const config = {
      ...DEFAULT_CONFIG,
      agents: ['security'] as AgentName[],
      agentTimeoutMs: 20,
      retryAttempts: 1,
      retryDelayMs: 0,
    }
    const runner = new SwarmRunner(config, provider)
    const result = await runner.run({ diff: 'diff' })
    expect(result.agentStatus?.security).toBe('timeout')
  })

  it('records agentStatus "parse-error" when an agent returns unparseable output', async () => {
    const provider: LLMProvider = {
      chat: vi.fn().mockResolvedValue('not json at all, just prose from the model'),
      ping: vi.fn().mockResolvedValue({ ok: true }),
    }
    const config = {
      ...DEFAULT_CONFIG,
      agents: ['security'] as AgentName[],
      retryAttempts: 1,
      retryDelayMs: 0,
    }
    const runner = new SwarmRunner(config, provider)
    const result = await runner.run({ diff: 'diff' })
    expect(result.agentStatus?.security).toBe('parse-error')
  })

  it('records agentStatus "ok" for coverage', async () => {
    const provider: LLMProvider = {
      chat: vi.fn().mockResolvedValue('{"findings":[],"gaps":[]}'),
      ping: vi.fn().mockResolvedValue({ ok: true }),
    }
    const config = {
      ...DEFAULT_CONFIG,
      agents: ['coverage'] as AgentName[],
      retryAttempts: 1,
      retryDelayMs: 0,
    }
    const runner = new SwarmRunner(config, provider)
    const result = await runner.run({ diff: 'diff' })
    expect(result.agentStatus?.coverage).toBe('ok')
  })

  it('records agentStatus "ok" for testgen when there are no coverage gaps to process', async () => {
    const provider: LLMProvider = {
      chat: vi.fn().mockResolvedValue('{"findings":[],"gaps":[]}'), // coverage runs, finds zero gaps
      ping: vi.fn().mockResolvedValue({ ok: true }),
    }
    const config = {
      ...DEFAULT_CONFIG,
      agents: ['coverage', 'testgen'] as AgentName[],
      retryAttempts: 1,
      retryDelayMs: 0,
    }
    const runner = new SwarmRunner(config, provider)
    const result = await runner.run({ diff: 'diff' })
    expect(result.agentStatus?.testgen).toBe('ok')
  })

  it('BUG REGRESSION: a run where every agent returns unparseable prose is not reported as clean', async () => {
    const provider: LLMProvider = {
      chat: vi
        .fn()
        .mockResolvedValue(
          "It looks like you've updated a number of files. Let me review them for you..."
        ),
      ping: vi.fn().mockResolvedValue({ ok: true }),
    }
    const config = {
      ...DEFAULT_CONFIG,
      agents: ['security', 'performance', 'correctness'] as AgentName[],
      retryAttempts: 1,
      retryDelayMs: 0,
    }
    const runner = new SwarmRunner(config, provider)
    const result = await runner.run({ diff: 'diff' })

    expect(result.findings).toEqual([])
    expect(result.agentStatus?.security).toBe('parse-error')
    expect(result.agentStatus?.performance).toBe('parse-error')
    expect(result.agentStatus?.correctness).toBe('parse-error')

    const markdown = formatMarkdown(result)
    expect(markdown).not.toContain('No issues found')
    expect(markdown).toContain('agents failed')
  })
})

describe('scaleAgentTimeout', () => {
  it('returns the base timeout unscaled for an empty diff', () => {
    expect(scaleAgentTimeout(180000, 0, 2000)).toBe(180000)
  })

  it('returns 2x the base timeout at exactly maxDiffLines', () => {
    expect(scaleAgentTimeout(180000, 2000, 2000)).toBe(360000)
  })

  it('scales linearly at the halfway point', () => {
    expect(scaleAgentTimeout(180000, 1000, 2000)).toBe(270000)
  })

  it('clamps to 2x when diffLines exceeds maxDiffLines', () => {
    expect(scaleAgentTimeout(180000, 3000, 2000)).toBe(360000)
  })

  it('returns the base timeout unscaled when maxDiffLines is 0', () => {
    expect(scaleAgentTimeout(180000, 500, 0)).toBe(180000)
  })
})
