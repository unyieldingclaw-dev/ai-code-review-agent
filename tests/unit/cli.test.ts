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

// Mock chunkRunner — same pattern as SwarmRunner above (mocked module, not a spy on a real
// export), since runChunked is a standalone function, not a class method. WHY no
// .mockResolvedValue(makeResult()) here (unlike SwarmRunner's mock above, which wraps its
// makeResult() call inside an extra mockImplementation lambda): calling makeResult() directly
// inside this factory would run eagerly when the mock is registered, before the top-level
// `const makeResult` below has initialized (vi.mock factories are hoisted above it) --
// ReferenceError. Tests that need a resolved value set it explicitly via mockRunChunked below.
vi.mock('../../src/core/chunkRunner.js', () => ({
  runChunked: vi.fn(),
}))

// Mock OllamaProvider — valid URL check is bypassed by mock
vi.mock('../../src/core/llm/ollamaProvider.js', () => ({
  OllamaProvider: vi.fn().mockImplementation(() => ({})),
}))

// Mock loadConfig — returns a fresh object each call. cli/index.ts mutates the returned
// config in place (e.g. --timeout sets agentTimeoutMs/timeoutScalingEnabled directly on it),
// so a shared object reference here would leak mutations from one test into the next.
vi.mock('../../src/core/config.js', () => ({
  loadConfig: vi.fn().mockImplementation(() => ({
    model: 'devstral:latest',
    provider: 'ollama',
    ollamaUrl: 'http://localhost:11434',
    maxFindings: 15,
    agents: ['security', 'correctness'],
    contextLines: 10,
    testOutputDir: './ai-review-tests',
    maxDiffLines: 2000,
    agentTimeoutMs: 60000,
    timeoutScalingEnabled: true,
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
    verifyEvidence: false,
    verifierModel: 'qwen3:latest',
    verifyEvidenceSeverity: 'high',
  })),
}))

import { spawnSync } from 'child_process'
import { resolve } from 'path'
import { SwarmRunner } from '../../src/core/runner.js'
import { runChunked } from '../../src/core/chunkRunner.js'

const mockSpawnSync = vi.mocked(spawnSync)
const MockSwarmRunner = vi.mocked(SwarmRunner)
const mockRunChunked = vi.mocked(runChunked)

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

  // WHY process.exitCode instead of a process.exit() spy: the CLI sets process.exitCode and
  // returns rather than calling process.exit(), so the event loop can drain naturally instead
  // of being torn down mid-flight (process.exit() forcing immediate termination while async
  // handles -- e.g. fetch/AbortController cleanup -- are still settling was reproduced as the
  // cause of a Windows-only libuv crash, "Assertion failed: !(handle->flags &
  // UV_HANDLE_CLOSING)"). Reset before and after each run since process.exitCode is a real
  // mutable global that would otherwise leak between tests and into vitest's own exit code.
  process.exitCode = undefined
  try {
    const { program } = await import('../../src/cli/index.js')
    await program.parseAsync(['node', 'cli', ...args])
  } finally {
    stdoutSpy.mockRestore()
    stderrSpy.mockRestore()
    consoleSpy.mockRestore()
  }

  const exitCode = Number(process.exitCode ?? 0)
  process.exitCode = undefined
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

  it('exits 2 when any agent failed, even if remaining findings would pass --fail-on', async () => {
    MockSwarmRunner.mockImplementation(() => ({
      run: vi.fn().mockResolvedValue(
        makeResult({
          findings: [],
          agentStatus: { security: 'timeout' },
        })
      ),
    }))
    const { exitCode } = await runCli(['--fail-on', 'never'])
    expect(exitCode).toBe(2)
  })

  it('exits 2 (not 1) when agents failed AND findings would also trip --fail-on', async () => {
    MockSwarmRunner.mockImplementation(() => ({
      run: vi.fn().mockResolvedValue(
        makeResult({
          findings: [
            {
              id: 'f-0',
              agent: 'security',
              severity: 'critical',
              basis: 'VERIFIED',
              file: 'a.ts',
              line: 1,
              title: 'T',
              detail: 'D',
              domain: 'Security',
              evidence: 'E',
              impact: 'I',
              recommendation: 'R',
              suggestion: 'S',
              blocking: true,
              source: 'llm',
              confidence: 90,
            },
          ],
          agentStatus: { security: 'ok', correctness: 'timeout' },
        })
      ),
    }))
    const { exitCode } = await runCli(['--fail-on', 'high'])
    expect(exitCode).toBe(2)
  })

  it('exits 0 when all agents succeed and no findings trip --fail-on', async () => {
    MockSwarmRunner.mockImplementation(() => ({
      run: vi.fn().mockResolvedValue(makeResult({ findings: [], agentStatus: { security: 'ok' } })),
    }))
    const { exitCode } = await runCli(['--fail-on', 'high'])
    expect(exitCode).toBe(0)
  })

  it('exits 1 (not 3) when a truncated run also contains a blocker finding', async () => {
    MockSwarmRunner.mockImplementation(() => ({
      run: vi.fn().mockResolvedValue(
        makeResult({
          findings: [
            {
              id: 'f-0',
              agent: 'security',
              severity: 'critical',
              basis: 'VERIFIED',
              file: 'a.ts',
              line: 1,
              title: 'T',
              detail: 'D',
              domain: 'Security',
              evidence: 'E',
              impact: 'I',
              recommendation: 'R',
              suggestion: 'S',
              blocking: true,
              source: 'llm',
              confidence: 90,
            },
          ],
          truncation: { truncated: true, originalLines: 5000, keptLines: 2000 },
        })
      ),
    }))
    const { exitCode } = await runCli(['--fail-on', 'high'])
    expect(exitCode).toBe(1)
  })

  it('exits 3 when truncated with no blocker finding', async () => {
    MockSwarmRunner.mockImplementation(() => ({
      run: vi.fn().mockResolvedValue(
        makeResult({
          findings: [],
          truncation: { truncated: true, originalLines: 5000, keptLines: 2000 },
        })
      ),
    }))
    const { exitCode } = await runCli([])
    expect(exitCode).toBe(3)
  })

  it('exits 0 on a truncated-but-clean run when --allow-truncation is passed', async () => {
    MockSwarmRunner.mockImplementation(() => ({
      run: vi.fn().mockResolvedValue(
        makeResult({
          findings: [],
          truncation: { truncated: true, originalLines: 5000, keptLines: 2000 },
        })
      ),
    }))
    const { exitCode } = await runCli(['--allow-truncation'])
    expect(exitCode).toBe(0)
  })

  it('exits 2 (not 3) when agents failed AND the run was also truncated', async () => {
    MockSwarmRunner.mockImplementation(() => ({
      run: vi.fn().mockResolvedValue(
        makeResult({
          findings: [],
          agentStatus: { security: 'ok', correctness: 'timeout' },
          truncation: { truncated: true, originalLines: 5000, keptLines: 2000 },
        })
      ),
    }))
    const { exitCode } = await runCli([])
    expect(exitCode).toBe(2)
  })

  it('--timeout sets agentTimeoutMs and disables timeout scaling', async () => {
    MockSwarmRunner.mockImplementation(() => ({
      run: vi.fn().mockResolvedValue(makeResult()),
    }))
    await runCli(['--timeout', '5000'])
    const config = MockSwarmRunner.mock.calls[0][0]
    expect(config.agentTimeoutMs).toBe(5000)
    expect(config.timeoutScalingEnabled).toBe(false)
  })

  it('leaves timeout scaling enabled when --timeout is not passed', async () => {
    MockSwarmRunner.mockImplementation(() => ({
      run: vi.fn().mockResolvedValue(makeResult()),
    }))
    await runCli([])
    const config = MockSwarmRunner.mock.calls[0][0]
    expect(config.timeoutScalingEnabled).toBe(true)
  })

  it('--parallel enables parallel execution', async () => {
    MockSwarmRunner.mockImplementation(() => ({
      run: vi.fn().mockResolvedValue(makeResult()),
    }))
    await runCli(['--parallel'])
    const config = MockSwarmRunner.mock.calls[0][0]
    expect(config.parallel).toBe(true)
  })

  it('leaves parallel execution off by default when --parallel is not passed', async () => {
    MockSwarmRunner.mockImplementation(() => ({
      run: vi.fn().mockResolvedValue(makeResult()),
    }))
    await runCli([])
    const config = MockSwarmRunner.mock.calls[0][0]
    expect(config.parallel).toBe(false)
  })

  it('--verify-evidence enables evidence verification and constructs a verifier provider using verifierModel, not the main review model', async () => {
    MockSwarmRunner.mockImplementation(() => ({
      run: vi.fn().mockResolvedValue(makeResult()),
    }))
    const { OllamaProvider } = await import('../../src/core/llm/ollamaProvider.js')
    const MockOllamaProvider = vi.mocked(OllamaProvider)

    await runCli(['--verify-evidence'])

    const config = MockSwarmRunner.mock.calls[0][0]
    const verifierProvider = MockSwarmRunner.mock.calls[0][2]
    expect(config.verifyEvidence).toBe(true)
    expect(verifierProvider).toBeDefined()
    // Cross-model verification only works if the verifier is a genuinely separate instance/model
    // from the main review provider (see cli/index.ts's own WHY comment on this construction) --
    // asserting just `toBeDefined()` can't tell a correctly-wired verifier from one accidentally
    // sharing the main review's model, since the mocked OllamaProvider returns `{}` either way.
    expect(MockOllamaProvider).toHaveBeenCalledTimes(2)
    const [, mainModel] = MockOllamaProvider.mock.calls[0]
    const [, verifierModel] = MockOllamaProvider.mock.calls[1]
    expect(mainModel).toBe('devstral:latest') // DEFAULT_CONFIG.model in this file's loadConfig mock
    expect(verifierModel).toBe('qwen3:latest') // DEFAULT_CONFIG.verifierModel in the same mock
    expect(verifierModel).not.toBe(mainModel)
  })

  it('falls back to qwen3:latest when config.verifierModel is an empty string', async () => {
    MockSwarmRunner.mockImplementation(() => ({
      run: vi.fn().mockResolvedValue(makeResult()),
    }))
    const { loadConfig } = await import('../../src/core/config.js')
    vi.mocked(loadConfig).mockReturnValueOnce({
      model: 'devstral:latest',
      provider: 'ollama',
      ollamaUrl: 'http://localhost:11434',
      maxFindings: 15,
      agents: ['security'],
      contextLines: 10,
      testOutputDir: './ai-review-tests',
      maxDiffLines: 2000,
      agentTimeoutMs: 60000,
      ignorePaths: [],
      sanitize: true,
      verifyEvidence: false,
      verifierModel: '', // config file setting it to "" should fall back to the default, not construct an empty-model provider
    })
    const { OllamaProvider } = await import('../../src/core/llm/ollamaProvider.js')
    const MockOllamaProvider = vi.mocked(OllamaProvider)

    await runCli(['--verify-evidence'])

    const [, verifierModel] = MockOllamaProvider.mock.calls[1]
    expect(verifierModel).toBe('qwen3:latest')
  })

  it('leaves verifyEvidence off and constructs only the main review provider by default', async () => {
    MockSwarmRunner.mockImplementation(() => ({
      run: vi.fn().mockResolvedValue(makeResult()),
    }))
    const { OllamaProvider } = await import('../../src/core/llm/ollamaProvider.js')
    const MockOllamaProvider = vi.mocked(OllamaProvider)

    await runCli([])

    const config = MockSwarmRunner.mock.calls[0][0]
    const verifierProvider = MockSwarmRunner.mock.calls[0][2]
    expect(config.verifyEvidence).toBe(false)
    expect(verifierProvider).toBeUndefined()
    // No verifier provider should be constructed at all when the feature is off -- not just
    // omitted from the SwarmRunner call.
    expect(MockOllamaProvider).toHaveBeenCalledTimes(1)
  })

  it('--verify-evidence-severity overrides the config value when passed', async () => {
    MockSwarmRunner.mockImplementation(() => ({
      run: vi.fn().mockResolvedValue(makeResult()),
    }))
    await runCli(['--verify-evidence', '--verify-evidence-severity', 'medium'])
    const config = MockSwarmRunner.mock.calls[0][0]
    expect(config.verifyEvidenceSeverity).toBe('medium')
  })

  it('leaves verifyEvidenceSeverity at the config default (high) when the flag is not passed', async () => {
    MockSwarmRunner.mockImplementation(() => ({
      run: vi.fn().mockResolvedValue(makeResult()),
    }))
    await runCli(['--verify-evidence'])
    const config = MockSwarmRunner.mock.calls[0][0]
    expect(config.verifyEvidenceSeverity).toBe('high')
  })

  it('rejects an invalid --verify-evidence-severity value', async () => {
    const { exitCode } = await runCli(['--verify-evidence-severity', 'urgent'])
    expect(exitCode).toBe(1)
  })

  // WHY --max-lines 1 in these tests: the mocked diff is fixed at 2 lines ('+ added line\n-
  // removed line'), so forcing maxDiffLines below that is what actually makes diffLines >
  // config.maxDiffLines true -- without it, --chunk alone would never trigger the runChunked
  // branch and these tests would pass trivially regardless of whether the wiring is correct.
  it('calls runChunked instead of runner.run directly when --chunk is passed and the diff exceeds maxDiffLines', async () => {
    MockSwarmRunner.mockImplementation(() => ({
      run: vi.fn().mockResolvedValue(makeResult()),
    }))
    mockRunChunked.mockResolvedValue(makeResult())
    const { exitCode } = await runCli(['--diff', 'x.diff', '--chunk', '--max-lines', '1'])
    expect(exitCode).toBe(0)
    expect(mockRunChunked).toHaveBeenCalled()
  })

  it('does not call runChunked when --chunk is not passed', async () => {
    const runSpy = vi.fn().mockResolvedValue(makeResult())
    MockSwarmRunner.mockImplementation(() => ({ run: runSpy }))
    const { exitCode } = await runCli(['--diff', 'x.diff', '--max-lines', '1'])
    expect(exitCode).toBe(0)
    expect(mockRunChunked).not.toHaveBeenCalled()
    expect(runSpy).toHaveBeenCalled()
  })
})

describe('--write-tests path containment (Layer B backstop)', () => {
  // WHY this matters even though runner.ts's coverage-gap filter (Layer A) already drops
  // gaps whose file isn't in the diff: Layer A can't catch a malicious testOutputDir from
  // ai-review.config.json (e.g. "../../../.."), since deriveTestPath concatenates
  // testOutputDir with a legitimate gap's filename with zero sanitization. This is the
  // backstop that catches that case regardless of which layer let a bad path through.
  it('resolveWriteTestPath returns the resolved path for a normal relative path', async () => {
    const { resolveWriteTestPath } = await import('../../src/cli/index.js')
    const projectPath = resolve('/home/user/myproject')
    const result = resolveWriteTestPath(projectPath, 'ai-review-tests/foo.test.ts')
    expect(result).toBe(resolve(projectPath, 'ai-review-tests/foo.test.ts'))
  })

  it('resolveWriteTestPath returns null for a path that escapes projectPath via traversal', async () => {
    const { resolveWriteTestPath } = await import('../../src/cli/index.js')
    const projectPath = resolve('/home/user/myproject')
    const result = resolveWriteTestPath(projectPath, '../../../../../../etc/passwd')
    expect(result).toBeNull()
  })

  it('skips writing a test file whose path resolves outside projectPath, and logs it, while still writing legitimate files', async () => {
    MockSwarmRunner.mockImplementation(() => ({
      run: vi.fn().mockResolvedValue(
        makeResult({
          testFiles: [
            {
              path: 'ai-review-tests/foo.test.ts',
              content: 'legit test content',
              framework: 'vitest',
            },
            {
              path: '../../../../../../etc/passwd',
              content: 'malicious content',
              framework: 'vitest',
            },
          ],
        })
      ),
    }))
    const fs = await import('fs')
    const writeFileSyncMock = vi.mocked(fs.writeFileSync)

    const { exitCode, stderr } = await runCli(['--write-tests'])

    expect(exitCode).toBe(0)
    expect(writeFileSyncMock).toHaveBeenCalledTimes(1)
    expect(String(writeFileSyncMock.mock.calls[0][0])).toContain('foo.test.ts')
    expect(stderr).toMatch(/outside (the )?project|escapes project|traversal/i)
  })
})
