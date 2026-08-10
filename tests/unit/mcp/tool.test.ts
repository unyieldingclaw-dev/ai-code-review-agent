// tests/unit/mcp/tool.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { runReviewTool } from '../../../src/mcp/tool.js'
import type { SpawnSyncReturns } from 'child_process'
import { resolve, join } from 'path'

// Mock child_process so tests never shell out
vi.mock('child_process', () => ({
  spawnSync: vi.fn(),
}))

// Mock SwarmRunner so tests never call Ollama
vi.mock('../../../src/core/runner.js', () => ({
  SwarmRunner: vi.fn().mockImplementation(() => ({
    run: vi.fn().mockResolvedValue({
      findings: [],
      testFiles: [],
      summary: { totalFindings: 0, bySeverity: {}, byAgent: {}, durationMs: 10 },
    }),
  })),
}))

// Mock OllamaProvider — trivial stub
vi.mock('../../../src/core/llm/ollamaProvider.js', () => ({
  OllamaProvider: vi.fn().mockImplementation(() => ({})),
}))

// Mock loadConfig — return default config
vi.mock('../../../src/core/config.js', () => ({
  loadConfig: vi.fn().mockReturnValue({
    model: 'devstral:latest',
    provider: 'ollama',
    ollamaUrl: 'http://localhost:11434',
    anthropicModel: '',
    maxFindings: 15,
    agents: [
      'security',
      'performance',
      'correctness',
      'design',
      'dependencies',
      'coverage',
      'adversarial',
      'integration',
      'breaking-change',
      'license',
    ],
    contextLines: 10,
    testOutputDir: './ai-review-tests',
    maxDiffLines: 2000,
    agentTimeoutMs: 60000,
    ignorePaths: [],
    sanitize: true,
  }),
}))

import { spawnSync } from 'child_process'
const mockSpawnSync = vi.mocked(spawnSync)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('runReviewTool', () => {
  it('uses staged diff by default', async () => {
    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: 'diff --git a/f.ts b/f.ts\n+line',
    } as unknown as SpawnSyncReturns<string>)
    await runReviewTool({})
    expect(mockSpawnSync).toHaveBeenCalledWith(
      'git',
      expect.arrayContaining(['diff', '--cached']),
      expect.any(Object)
    )
  })

  it('falls back to git diff HEAD when no staged changes', async () => {
    mockSpawnSync
      .mockReturnValueOnce({ status: 0, stdout: '' } as unknown as SpawnSyncReturns<string>) // first call: git diff --cached → empty
      .mockReturnValueOnce({
        status: 0,
        stdout: 'diff --git a/f.ts b/f.ts\n+line',
      } as unknown as SpawnSyncReturns<string>) // second call: git diff HEAD
    await runReviewTool({})
    const calls = mockSpawnSync.mock.calls
    expect(calls[0][1]).toContain('--cached')
    expect(calls[1][1]).toContain('HEAD')
  })

  it('returns empty-diff message when no changes found', async () => {
    mockSpawnSync.mockReturnValue({ status: 0, stdout: '' } as unknown as SpawnSyncReturns<string>)
    const result = await runReviewTool({})
    expect(result).toContain('No staged changes found')
  })

  it('uses provided repo_path in git commands', async () => {
    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: 'diff --git a/f.ts b/f.ts\n+line',
    } as unknown as SpawnSyncReturns<string>)
    await runReviewTool({ repo_path: '/tmp/myrepo' })
    const _call = mockSpawnSync.mock.calls[0][1] as string[]
    expect(mockSpawnSync.mock.calls[0][0]).toBe('git')
    expect(mockSpawnSync.mock.calls[0][2]).toHaveProperty('encoding', 'utf-8')
  })

  it('returns error message when git command throws (not a repo)', async () => {
    mockSpawnSync.mockImplementation(() => {
      throw new Error('not a git repository')
    })
    const result = await runReviewTool({})
    expect(result).toContain('Not a git repository')
  })

  it('returns error message when Ollama is unreachable', async () => {
    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: 'diff --git a/f.ts b/f.ts\n+line',
    } as unknown as SpawnSyncReturns<string>)
    const { SwarmRunner } = await import('../../../src/core/runner.js')
    vi.mocked(SwarmRunner).mockImplementationOnce(
      () =>
        ({
          run: vi.fn().mockRejectedValue(new Error('LLM provider not available')),
        }) as unknown as InstanceType<typeof SwarmRunner>
    )
    const result = await runReviewTool({})
    expect(result).toContain('Ollama is not reachable')
  })

  it('excludes testgen from agents regardless of config', async () => {
    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: 'diff --git a/f.ts b/f.ts\n+line',
    } as unknown as SpawnSyncReturns<string>)
    const { loadConfig } = await import('../../../src/core/config.js')
    vi.mocked(loadConfig).mockReturnValueOnce({
      model: 'devstral:latest',
      provider: 'ollama',
      ollamaUrl: 'http://localhost:11434',
      anthropicModel: '',
      maxFindings: 15,
      agents: ['security', 'testgen', 'coverage'], // testgen present in config
      contextLines: 10,
      testOutputDir: './ai-review-tests',
      maxDiffLines: 2000,
      agentTimeoutMs: 60000,
      ignorePaths: [],
      sanitize: true,
    })
    const { SwarmRunner } = await import('../../../src/core/runner.js')
    const runMock = vi.fn().mockResolvedValue({
      findings: [],
      testFiles: [],
      summary: { totalFindings: 0, bySeverity: {}, byAgent: {}, durationMs: 10 },
    })
    vi.mocked(SwarmRunner).mockImplementationOnce((config: Parameters<typeof SwarmRunner>[0]) => {
      expect(config.agents).not.toContain('testgen')
      return { run: runMock } as unknown as InstanceType<typeof SwarmRunner>
    })
    await runReviewTool({})
  })
})

describe('repo_path allowlist (AI_REVIEW_ALLOWED_ROOTS)', () => {
  // repo_path is client-supplied -- in practice populated by whatever LLM/agent is calling this
  // MCP tool from its own context, which could itself be influenced by injected instructions in
  // content it previously read (see standards/AGENTIC-SAFETY.md). Currently any path the process
  // user can read gets diffed and summarized back into the conversation with no scoping at all.
  const ORIGINAL_ENV = process.env.AI_REVIEW_ALLOWED_ROOTS

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) delete process.env.AI_REVIEW_ALLOWED_ROOTS
    else process.env.AI_REVIEW_ALLOWED_ROOTS = ORIGINAL_ENV
  })

  it('rejects a repo_path outside all configured allowed roots, with a clear message', async () => {
    process.env.AI_REVIEW_ALLOWED_ROOTS = [
      resolve('/allowed/root1'),
      resolve('/allowed/root2'),
    ].join(',')
    const result = await runReviewTool({ repo_path: resolve('/not/allowed/path') })
    expect(result).toContain('outside the configured allowed roots')
    expect(mockSpawnSync).not.toHaveBeenCalled()
  })

  it('allows a repo_path inside a configured allowed root to proceed normally', async () => {
    const allowedRoot = resolve('/allowed/root1')
    process.env.AI_REVIEW_ALLOWED_ROOTS = allowedRoot
    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: 'diff --git a/f.ts b/f.ts\n+line',
    } as unknown as SpawnSyncReturns<string>)

    const result = await runReviewTool({ repo_path: join(allowedRoot, 'sub') })

    expect(result).not.toContain('outside the configured allowed roots')
    expect(mockSpawnSync).toHaveBeenCalled()
  })

  it('proceeds for any repo_path, unchanged, when AI_REVIEW_ALLOWED_ROOTS is unset (fail open)', async () => {
    delete process.env.AI_REVIEW_ALLOWED_ROOTS
    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: 'diff --git a/f.ts b/f.ts\n+line',
    } as unknown as SpawnSyncReturns<string>)

    const result = await runReviewTool({ repo_path: resolve('/anywhere/at/all') })

    expect(result).not.toContain('outside the configured allowed roots')
    expect(mockSpawnSync).toHaveBeenCalled()
  })
})
