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
})
