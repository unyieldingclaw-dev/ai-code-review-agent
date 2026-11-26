import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ExtensionConfig } from '../src/types'

// Hoist vi.mock calls — vitest moves these before imports automatically
vi.mock('child_process', () => ({
  execSync: vi.fn(),
  spawn: vi.fn(),
}))

vi.mock('fs', () => ({
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
}))

vi.mock('os', () => ({
  tmpdir: () => '/tmp',
}))

import { execSync, spawn } from 'child_process'
import { writeFileSync, unlinkSync } from 'fs'
import { runReview } from '../src/runner'

const mockConfig: ExtensionConfig = {
  ollamaUrl: 'http://localhost:11434',
  model: 'devstral:latest',
  agents: [],
  maxLines: 2000,
  timeoutSecs: 120,
  cliPath: '/ext/node_modules/ai-review-agent/dist/cli/index.js',
}

const mockToken = {
  isCancellationRequested: false,
  onCancellationRequested: vi.fn(() => ({ dispose: vi.fn() })),
}

/**
 * Creates a fake child_process with controllable stdout/stderr/close events.
 * Uses setImmediate to simulate async event emission in the correct order:
 * data events fire before close.
 */
function makeChild(stdoutData: string, exitCode = 0, stderrData = '') {
  const child = {
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    kill: vi.fn(),
    on: vi.fn(),
  }

  child.stdout.on.mockImplementation((event: string, cb: (data: Buffer) => void) => {
    if (event === 'data') setImmediate(() => cb(Buffer.from(stdoutData)))
  })

  child.stderr.on.mockImplementation((event: string, cb: (data: Buffer) => void) => {
    if (event === 'data') setImmediate(() => cb(Buffer.from(stderrData)))
  })

  child.on.mockImplementation((event: string, cb: (code: number) => void) => {
    if (event === 'close') setImmediate(() => cb(exitCode))
  })

  return child
}

describe('runReview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('throws "nothing-staged" when git diff --cached returns empty string', async () => {
    vi.mocked(execSync).mockReturnValue('')
    await expect(runReview(mockConfig, '/workspace', mockToken as any)).rejects.toThrow(
      'nothing-staged'
    )
  })

  it('throws "git not found" when execSync throws with spawn error', async () => {
    vi.mocked(execSync).mockImplementation(() => {
      const err = new Error('spawn git ENOENT') as NodeJS.ErrnoException
      err.code = 'ENOENT'
      throw err
    })
    await expect(runReview(mockConfig, '/workspace', mockToken as any)).rejects.toThrow(
      'git not found'
    )
  })

  it('writes staged diff to a temp file and deletes it after run', async () => {
    const mockResult = {
      findings: [],
      testFiles: [],
      summary: { totalFindings: 0, bySeverity: {}, byAgent: {}, durationMs: 42 },
    }
    const cliOutput = '\n🔍 Running...\n\n  ✓ security\n\n' + JSON.stringify(mockResult)

    vi.mocked(execSync).mockReturnValue('diff --git a/foo.ts b/foo.ts\n+const x = 1')
    vi.mocked(spawn).mockReturnValue(makeChild(cliOutput) as any)

    await runReview(mockConfig, '/workspace', mockToken as any)

    expect(writeFileSync).toHaveBeenCalledWith(
      expect.stringMatching(/ai-review-\d+\.diff$/),
      expect.any(String),
      'utf-8'
    )
    expect(unlinkSync).toHaveBeenCalled()
  })

  it('parses ReviewResult from CLI stdout that contains progress lines before JSON', async () => {
    const mockResult = {
      findings: [
        {
          id: 'f1',
          agent: 'security',
          severity: 'high',
          basis: 'VERIFIED',
          file: 'src/auth.ts',
          line: 42,
          title: 'SQL Injection',
          detail: 'Unsanitized input',
          suggestion: 'Use parameterized queries',
          confidence: 85,
        },
      ],
      testFiles: [],
      summary: {
        totalFindings: 1,
        bySeverity: { high: 1 },
        byAgent: { security: 1 },
        durationMs: 8000,
      },
    }
    // CLI stdout has progress noise before the JSON
    const cliOutput =
      '\n🔍 Running ai-review-agent with 11 agents...\n\n  ✓ security\n\n' +
      JSON.stringify(mockResult)

    vi.mocked(execSync).mockReturnValue('some staged diff content')
    vi.mocked(spawn).mockReturnValue(makeChild(cliOutput) as any)

    const result = await runReview(mockConfig, '/workspace', mockToken as any)

    expect(result.findings).toHaveLength(1)
    expect(result.findings[0].severity).toBe('high')
    expect(result.summary.totalFindings).toBe(1)
  })

  it('throws "ollama-unreachable" when CLI exits non-zero with ECONNREFUSED in stderr', async () => {
    vi.mocked(execSync).mockReturnValue('some staged diff')
    vi.mocked(spawn).mockReturnValue(
      makeChild('', 1, 'Error: connect ECONNREFUSED 127.0.0.1:11434') as any
    )

    await expect(runReview(mockConfig, '/workspace', mockToken as any)).rejects.toThrow(
      'ollama-unreachable:'
    )
  })

  it('throws "ollama-unreachable" on exit 4 with "Ollama not reachable" stderr', async () => {
    const stderr =
      '\nError: Ollama not reachable at http://localhost:11434: fetch failed\n' +
      'Make sure Ollama is running: ollama serve\n'
    vi.mocked(execSync).mockReturnValue('some staged diff')
    vi.mocked(spawn).mockReturnValue(makeChild('', 4, stderr) as any)

    await expect(runReview(mockConfig, '/workspace', mockToken as any)).rejects.toThrow(
      'ollama-unreachable:http://localhost:11434'
    )
  })

  it('throws "cli-error" for non-zero exit with unrecognised stderr', async () => {
    vi.mocked(execSync).mockReturnValue('some staged diff')
    vi.mocked(spawn).mockReturnValue(makeChild('', 1, 'Some unexpected crash') as any)

    await expect(runReview(mockConfig, '/workspace', mockToken as any)).rejects.toThrow(
      'cli-error:'
    )
  })

  it('throws "parse-error" when stdout has no JSON object', async () => {
    vi.mocked(execSync).mockReturnValue('some staged diff')
    vi.mocked(spawn).mockReturnValue(makeChild('no json here', 0) as any)

    await expect(runReview(mockConfig, '/workspace', mockToken as any)).rejects.toThrow(
      'parse-error:'
    )
  })

  it('kills child process and throws "cancelled" when cancellation token fires', async () => {
    let cancelCallback: (() => void) | undefined

    const cancelToken = {
      isCancellationRequested: false,
      onCancellationRequested: vi.fn((cb: () => void) => {
        cancelCallback = cb
        return { dispose: vi.fn() }
      }),
    }

    // child.on('close') never fires — simulates a long-running process
    const child = {
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      kill: vi.fn(),
      on: vi.fn(), // never calls 'close'
    }

    vi.mocked(execSync).mockReturnValue('some staged diff')
    vi.mocked(spawn).mockReturnValue(child as any)

    const promise = runReview(mockConfig, '/workspace', cancelToken as any)

    // Trigger cancellation after spawn
    await Promise.resolve()
    cancelCallback?.()

    await expect(promise).rejects.toThrow('cancelled')
    expect(child.kill).toHaveBeenCalled()
  })

  it('rejects with timeout error when process does not close in time', async () => {
    // child.on('close') never fires — simulates a stalled Ollama process
    const child = {
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      kill: vi.fn(),
      on: vi.fn(), // never calls 'close'
    }

    vi.mocked(spawn).mockReturnValue(child as any)
    vi.mocked(execSync).mockReturnValue('some diff content\n' as unknown as Buffer)
    vi.mocked(writeFileSync).mockImplementation(() => {})
    vi.mocked(unlinkSync).mockImplementation(() => {})

    // Use a 1ms timeout — the child never closes, so timeout fires immediately
    const promise = runReview(mockConfig, '/workspace', mockToken as any, 1)

    await expect(promise).rejects.toThrow('timed out after')
    expect(child.kill).toHaveBeenCalled()
  })

  describe('CLI exit-code handling (Finding #3 regression tests)', () => {
    it('preserves partial findings and failed-agent status when CLI exits 2 with valid JSON', async () => {
      const partialResult = {
        findings: [
          {
            id: 'security-0',
            agent: 'security',
            severity: 'high',
            basis: 'VERIFIED',
            file: 'src/auth.ts',
            line: 42,
            title: 'SQL Injection',
            detail: 'Unsanitized input',
            suggestion: 'Use parameterized queries',
            confidence: 85,
          },
        ],
        testFiles: [],
        summary: {
          totalFindings: 1,
          bySeverity: { high: 1 },
          byAgent: { security: 1 },
          durationMs: 125000,
        },
        agentStatus: {
          security: 'ok',
          correctness: 'timeout',
        },
        agentsPlanned: 2,
      }
      const stderr =
        '[1/2] security   5s — 1 raw finding (1 high)\n' +
        '[2/2] correctness   120s — 0 raw findings (timeout)\n'

      vi.mocked(execSync).mockReturnValue('diff --git a/src/auth.ts b/src/auth.ts\n+query(input)')
      vi.mocked(spawn).mockReturnValue(
        makeChild('\n' + JSON.stringify(partialResult) + '\n', 2, stderr) as any
      )

      const result = await runReview(mockConfig, '/workspace', mockToken as any)

      expect(result.findings).toHaveLength(1)
      expect(result.findings[0].title).toBe('SQL Injection')
      expect(result.agentStatus).toEqual({ security: 'ok', correctness: 'timeout' })
      expect(result.agentsPlanned).toBe(2)
    })

    it('preserves truncation metadata when CLI exits 3 with valid JSON', async () => {
      const truncatedResult = {
        findings: [],
        testFiles: [],
        summary: {
          totalFindings: 0,
          bySeverity: {},
          byAgent: {},
          durationMs: 9000,
        },
        agentStatus: {
          security: 'ok',
        },
        agentsPlanned: 1,
        truncation: {
          truncated: true,
          originalLines: 5000,
          keptLines: 2000,
        },
      }
      const stderr = '[ai-review] Diff truncated: 3000 of 5000 lines were excluded\n'

      vi.mocked(execSync).mockReturnValue('diff --git a/big.ts b/big.ts\n+line')
      vi.mocked(spawn).mockReturnValue(
        makeChild('\n' + JSON.stringify(truncatedResult) + '\n', 3, stderr) as any
      )

      const result = await runReview(mockConfig, '/workspace', mockToken as any)

      expect(result.findings).toEqual([])
      expect(result.truncation).toEqual({
        truncated: true,
        originalLines: 5000,
        keptLines: 2000,
      })
    })

    it('keeps exit code 1 with startup validation error as a failure', async () => {
      vi.mocked(execSync).mockReturnValue('diff --git a/foo.ts b/foo.ts\n+const x = 1')
      vi.mocked(spawn).mockReturnValue(
        makeChild('', 1, 'Invalid --agents value(s): bogus-agent\n') as any
      )

      await expect(runReview(mockConfig, '/workspace', mockToken as any)).rejects.toThrow(
        'cli-error:'
      )
    })

    it('keeps exit code 4 with startup failure as a failure', async () => {
      vi.mocked(execSync).mockReturnValue('diff --git a/foo.ts b/foo.ts\n+const x = 1')
      vi.mocked(spawn).mockReturnValue(
        makeChild('', 4, '\nError: Diff file not found: /tmp/missing.diff\n') as any
      )

      await expect(runReview(mockConfig, '/workspace', mockToken as any)).rejects.toThrow(
        'cli-error:'
      )
    })

    it('rejects invalid JSON on exit code 2 instead of accepting it as a successful report', async () => {
      vi.mocked(execSync).mockReturnValue('diff --git a/foo.ts b/foo.ts\n+const x = 1')
      vi.mocked(spawn).mockReturnValue(
        makeChild(
          'not valid json output',
          2,
          '[1/1] security   120s — 0 raw findings (timeout)\n'
        ) as any
      )

      await expect(runReview(mockConfig, '/workspace', mockToken as any)).rejects.toThrow(
        'parse-error:'
      )
    })

    it('rejects invalid JSON on exit code 3 instead of accepting it as a successful report', async () => {
      vi.mocked(execSync).mockReturnValue('diff --git a/foo.ts b/foo.ts\n+const x = 1')
      vi.mocked(spawn).mockReturnValue(
        makeChild('{"findings": [truncated', 3, '[ai-review] Diff truncated\n') as any
      )

      await expect(runReview(mockConfig, '/workspace', mockToken as any)).rejects.toThrow(
        'parse-error:'
      )
    })
  })

  describe('derived subprocess timeout guardrail', () => {
    function makeControllableChild() {
      let stdoutCb: ((data: Buffer) => void) | undefined
      let closeCb: ((code: number | null) => void) | undefined
      const child = {
        stdout: {
          on: vi.fn((event: string, cb: (data: Buffer) => void) => {
            if (event === 'data') stdoutCb = cb
          }),
        },
        stderr: { on: vi.fn() },
        kill: vi.fn(),
        on: vi.fn((event: string, cb: (code: number | null) => void) => {
          if (event === 'close') closeCb = cb
        }),
      }
      return {
        child,
        emitStdout: (text: string) => stdoutCb?.(Buffer.from(text)),
        emitClose: (code: number | null) => closeCb?.(code),
      }
    }

    it('does not kill a multi-agent run at 5 minutes and still preserves an exit-2 partial report', async () => {
      vi.useFakeTimers()
      try {
        const { child, emitStdout, emitClose } = makeControllableChild()
        const multiAgentConfig: ExtensionConfig = {
          ...mockConfig,
          profile: 'change-review',
          contextMode: 'none',
          timeoutSecs: 0,
        }
        const partialResult = {
          findings: [
            {
              id: 'security-0',
              agent: 'security',
              severity: 'high',
              basis: 'VERIFIED',
              file: 'src/a.ts',
              line: 10,
              title: 'Issue',
              detail: 'Detail',
              suggestion: 'Fix',
              confidence: 80,
            },
          ],
          testFiles: [],
          summary: {
            totalFindings: 1,
            bySeverity: { high: 1 },
            byAgent: { security: 1 },
            durationMs: 305_000,
          },
          agentStatus: { security: 'ok', correctness: 'timeout' },
        }

        vi.mocked(execSync).mockReturnValue('diff --git a/src/a.ts b/src/a.ts\n+const x = 1')
        vi.mocked(spawn).mockReturnValue(child as any)

        const promise = runReview(multiAgentConfig, '/workspace', mockToken as any)

        await vi.advanceTimersByTimeAsync(300_000)
        expect(child.kill).not.toHaveBeenCalled()

        await vi.advanceTimersByTimeAsync(5_000)
        emitStdout('\n' + JSON.stringify(partialResult) + '\n')
        emitClose(2)

        const result = await promise
        expect(result.findings).toHaveLength(1)
        expect(result.agentStatus).toEqual({ security: 'ok', correctness: 'timeout' })
      } finally {
        vi.useRealTimers()
      }
    })

    it('terminates at the derived guardrail timeout while preserving immediate user cancellation', async () => {
      vi.useFakeTimers()
      try {
        // 1. fast (3 agents) with explicit 120s override -> 3 * 120s + 60s = 420s
        const { child: timedOutChild } = makeControllableChild()
        const fastConfig: ExtensionConfig = {
          ...mockConfig,
          profile: 'fast',
          contextMode: 'none',
          timeoutSecs: 120,
        }
        vi.mocked(execSync).mockReturnValue('diff --git a/src/a.ts b/src/a.ts\n+const x = 1')
        vi.mocked(spawn).mockReturnValue(timedOutChild as any)

        const timeoutPromise = runReview(fastConfig, '/workspace', mockToken as any)
        const timeoutAssertion = expect(timeoutPromise).rejects.toThrow('timed out after 420s')

        await vi.advanceTimersByTimeAsync(300_000)
        expect(timedOutChild.kill).not.toHaveBeenCalled()

        await vi.advanceTimersByTimeAsync(120_000)
        await timeoutAssertion
        expect(timedOutChild.kill).toHaveBeenCalledWith('SIGTERM')

        // 2. Prompt cancellation fires immediately even with a large derived full-profile guardrail
        let cancelCallback: (() => void) | undefined
        const cancelToken = {
          isCancellationRequested: false,
          onCancellationRequested: vi.fn((cb: () => void) => {
            cancelCallback = cb
            return { dispose: vi.fn() }
          }),
        }
        const { child: cancelledChild } = makeControllableChild()
        const fullConfig: ExtensionConfig = {
          ...mockConfig,
          profile: 'full',
          contextMode: 'none',
          timeoutSecs: 0,
        }
        vi.mocked(spawn).mockReturnValue(cancelledChild as any)

        const cancelPromise = runReview(fullConfig, '/workspace', cancelToken as any)
        const cancelAssertion = expect(cancelPromise).rejects.toThrow('cancelled')
        cancelCallback?.()
        await cancelAssertion
        expect(cancelledChild.kill).toHaveBeenCalled()
      } finally {
        vi.useRealTimers()
      }
    })
  })
})
