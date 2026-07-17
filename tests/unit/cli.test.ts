// tests/unit/cli.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ReviewResult } from '../../src/core/schema.js'

// Mock child_process so tests never shell out to git
vi.mock('child_process', () => ({
  spawnSync: vi.fn(),
}))

// Mock fs so tests can control diff file existence
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(true),
    readFileSync: vi.fn().mockImplementation((path: string) => {
      if (String(path).endsWith('package.json'))
        return JSON.stringify({ name: 'ai-review-agent', version: '0.0.0-test' })
      return '+ added line\n- removed line'
    }),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
  }
})

// Mock update-notifier so tests never hit the network or print notifier output
vi.mock('update-notifier', () => ({
  default: vi.fn().mockReturnValue({
    notify: vi.fn(),
  }),
}))

// Minimal ReviewResult factory
const makeResult = (overrides: Partial<ReviewResult> = {}): ReviewResult => ({
  findings: [],
  testFiles: [],
  summary: { totalFindings: 0, bySeverity: {}, byAgent: {}, durationMs: 10 },
  schemaVersion: 'ai-review-agent/v1',
  toolVersion: '0.0.0-test',
  profile: null,
  earlyExit: undefined,
  ...overrides,
})

// Mock SwarmRunner
vi.mock('../../src/core/runner.js', () => ({
  SwarmRunner: vi.fn().mockImplementation(() => ({
    run: vi.fn().mockResolvedValue(makeResult()),
  })),
}))

// Mock OllamaProvider — valid URL check is bypassed by mock
vi.mock('../../src/core/llm/ollamaProvider.js', () => ({
  OllamaProvider: vi.fn().mockImplementation(() => ({})),
}))

// Mock loadConfig
vi.mock('../../src/core/config.js', () => ({
  loadConfig: vi.fn().mockReturnValue({
    model: 'devstral:latest',
    provider: 'ollama',
    ollamaUrl: 'http://localhost:11434',
    maxFindings: 15,
    agents: ['security', 'correctness'],
    contextLines: 10,
    testOutputDir: './ai-review-tests',
    maxDiffLines: 2000,
    agentTimeoutMs: 60000,
    ignorePaths: [],
    sanitize: true,
    failOn: 'high',
    failFast: false,
    parallel: false,
    retryAttempts: 2,
    retryDelayMs: 2000,
    contextBudgetChars: 4000,
    contextMode: 'static',
    agentPolicy: {},
  }),
}))

import { spawnSync } from 'child_process'
import { SwarmRunner } from '../../src/core/runner.js'

const mockSpawnSync = vi.mocked(spawnSync)
const MockSwarmRunner = vi.mocked(SwarmRunner)

beforeEach(() => {
  vi.clearAllMocks()
  // Default: git returns a non-empty diff
  mockSpawnSync.mockReturnValue({
    stdout: '+ added line\n- removed line',
    stderr: '',
    status: 0,
    pid: 1,
    output: [],
    signal: null,
    error: undefined,
  })
})

afterEach(() => {
  vi.resetModules()
})

async function runCli(
  args: string[]
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const stdoutChunks: string[] = []
  const stderrChunks: string[] = []
  const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdoutChunks.push(String(chunk))
    return true
  })
  const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderrChunks.push(String(chunk))
    return true
  })
  // console.error routes through a different path than process.stderr.write in Node.js
  const consoleSpy = vi.spyOn(console, 'error').mockImplementation((...args) => {
    stderrChunks.push(args.map(String).join(' ') + '\n')
  })

  let exitCode = 0
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: number | string) => {
    exitCode = Number(code ?? 0)
    throw new Error(`process.exit(${code})`)
  })

  try {
    const { program } = await import('../../src/cli/index.js')
    await program.parseAsync(['node', 'cli', ...args])
  } catch (err) {
    if (!(err instanceof Error) || !err.message.startsWith('process.exit(')) throw err
  } finally {
    stdoutSpy.mockRestore()
    stderrSpy.mockRestore()
    consoleSpy.mockRestore()
    exitSpy.mockRestore()
  }

  return { exitCode, stdout: stdoutChunks.join(''), stderr: stderrChunks.join('') }
}

describe('CLI — argument parsing and output', () => {
  it('exits 0 when no blocking findings and --fail-on high (default)', async () => {
    MockSwarmRunner.mockImplementation(() => ({
      run: vi.fn().mockResolvedValue(makeResult({ findings: [] })),
    }))
    const { exitCode } = await runCli([])
    expect(exitCode).toBe(0)
  })

  it('exits 1 when a critical finding is present and --fail-on high', async () => {
    MockSwarmRunner.mockImplementation(() => ({
      run: vi.fn().mockResolvedValue(
        makeResult({
          findings: [
            {
              id: 'f1',
              agentName: 'security',
              severity: 'critical',
              title: 'SQL injection',
              description: 'desc',
              file: 'src/db.ts',
              line: 1,
              lineEnd: 1,
              confidence: 90,
              domain: 'security',
              evidence: 'e',
              impact: 'i',
              recommendation: 'r',
              blocking: true,
              source: 'llm',
              corroboratingAgents: [],
            },
          ],
        })
      ),
    }))
    const { exitCode } = await runCli(['--fail-on', 'high'])
    expect(exitCode).toBe(1)
  })

  it('exits 0 for a high finding when --fail-on critical', async () => {
    MockSwarmRunner.mockImplementation(() => ({
      run: vi.fn().mockResolvedValue(
        makeResult({
          findings: [
            {
              id: 'f1',
              agentName: 'security',
              severity: 'high',
              title: 'XSS',
              description: 'desc',
              file: 'src/ui.ts',
              line: 5,
              lineEnd: 5,
              confidence: 80,
              domain: 'security',
              evidence: 'e',
              impact: 'i',
              recommendation: 'r',
              blocking: false,
              source: 'llm',
              corroboratingAgents: [],
            },
          ],
        })
      ),
    }))
    const { exitCode } = await runCli(['--fail-on', 'critical'])
    expect(exitCode).toBe(0)
  })

  it('produces valid JSON when --format json', async () => {
    const { stdout } = await runCli(['--format', 'json'])
    const parsed = JSON.parse(stdout.trim())
    expect(parsed).toHaveProperty('findings')
    expect(Array.isArray(parsed.findings)).toBe(true)
  })

  it('exits 1 and prints actionable error when no diff available', async () => {
    mockSpawnSync.mockReturnValue({
      stdout: '',
      stderr: '',
      status: 0,
      pid: 1,
      output: [],
      signal: null,
      error: undefined,
    })
    const { exitCode, stderr } = await runCli([])
    expect(exitCode).toBe(1)
    expect(stderr + '').toMatch(/No diff to review/)
  })

  it('prints Ollama hint when runner throws connection error', async () => {
    MockSwarmRunner.mockImplementation(() => ({
      run: vi.fn().mockRejectedValue(new Error('Ollama not reachable at http://localhost:11434')),
    }))
    const { exitCode, stderr } = await runCli([])
    expect(exitCode).toBe(1)
    expect(stderr).toMatch(/ollama serve/)
  })

  it('checkForUpdates calls update-notifier with a 7-day interval and the expected message', async () => {
    const updateNotifier = (await import('update-notifier')).default
    const notifyMock = vi.fn()
    vi.mocked(updateNotifier).mockReturnValue({ notify: notifyMock } as ReturnType<
      typeof updateNotifier
    >)
    const { checkForUpdates } = await import('../../src/cli/index.js')

    checkForUpdates()

    expect(updateNotifier).toHaveBeenCalledWith({
      pkg: { name: 'ai-review-agent', version: expect.any(String) },
      updateCheckInterval: 1000 * 60 * 60 * 24 * 7,
    })
    expect(notifyMock).toHaveBeenCalledWith({
      isGlobal: true,
      message: expect.stringContaining('newer version'),
    })
  })

  it('does not call update-notifier automatically when NODE_ENV=test', async () => {
    const updateNotifier = (await import('update-notifier')).default
    await import('../../src/cli/index.js')
    expect(updateNotifier).not.toHaveBeenCalled()
  })

  it('passes --fail-on never: exits 0 even with critical finding', async () => {
    MockSwarmRunner.mockImplementation(() => ({
      run: vi.fn().mockResolvedValue(
        makeResult({
          findings: [
            {
              id: 'f1',
              agentName: 'security',
              severity: 'critical',
              title: 'RCE',
              description: 'desc',
              file: 'src/eval.ts',
              line: 1,
              lineEnd: 1,
              confidence: 95,
              domain: 'security',
              evidence: 'e',
              impact: 'i',
              recommendation: 'r',
              blocking: true,
              source: 'llm',
              corroboratingAgents: [],
            },
          ],
        })
      ),
    }))
    const { exitCode } = await runCli(['--fail-on', 'never'])
    expect(exitCode).toBe(0)
  })
})
