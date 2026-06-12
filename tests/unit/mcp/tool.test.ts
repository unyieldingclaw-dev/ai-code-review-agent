// tests/unit/mcp/tool.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runReviewTool } from '../../../src/mcp/tool.js'

// Mock child_process so tests never shell out
vi.mock('child_process', () => ({
  execSync: vi.fn(),
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
    agents: ['security', 'performance', 'correctness', 'design', 'dependencies',
             'coverage', 'adversarial', 'integration', 'breaking-change', 'license'],
    contextLines: 10,
    testOutputDir: './ai-review-tests',
    maxDiffLines: 2000,
    agentTimeoutMs: 60000,
    ignorePaths: [],
    sanitize: true,
  }),
}))

import { execSync } from 'child_process'
const mockExecSync = vi.mocked(execSync)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('runReviewTool', () => {
  it('uses staged diff by default', async () => {
    mockExecSync.mockReturnValue('diff --git a/f.ts b/f.ts\n+line' as any)
    await runReviewTool({})
    expect(mockExecSync).toHaveBeenCalledWith(
      expect.stringContaining('diff --cached'),
      expect.any(Object)
    )
  })

  it('falls back to git diff HEAD when no staged changes', async () => {
    mockExecSync
      .mockReturnValueOnce('' as any)            // first call: git diff --cached → empty
      .mockReturnValueOnce('diff --git a/f.ts b/f.ts\n+line' as any) // second call: git diff HEAD
    await runReviewTool({})
    const calls = mockExecSync.mock.calls.map(c => c[0] as string)
    expect(calls[0]).toContain('--cached')
    expect(calls[1]).toContain('diff HEAD')
  })

  it('returns empty-diff message when no changes found', async () => {
    mockExecSync.mockReturnValue('' as any)
    const result = await runReviewTool({})
    expect(result).toContain('No staged changes found')
  })

  it('uses provided repo_path in git commands', async () => {
    mockExecSync.mockReturnValue('diff --git a/f.ts b/f.ts\n+line' as any)
    await runReviewTool({ repo_path: '/tmp/myrepo' })
    const call = mockExecSync.mock.calls[0][0] as string
    expect(call).toContain('myrepo')
  })

  it('returns error message when git command throws (not a repo)', async () => {
    mockExecSync.mockImplementation(() => { throw new Error('not a git repository') })
    const result = await runReviewTool({})
    expect(result).toContain('Not a git repository')
  })

  it('returns error message when Ollama is unreachable', async () => {
    mockExecSync.mockReturnValue('diff --git a/f.ts b/f.ts\n+line' as any)
    const { SwarmRunner } = await import('../../../src/core/runner.js')
    vi.mocked(SwarmRunner).mockImplementationOnce(() => ({
      run: vi.fn().mockRejectedValue(new Error('LLM provider not available')),
    }) as any)
    const result = await runReviewTool({})
    expect(result).toContain('Ollama is not reachable')
  })

  it('excludes testgen from agents regardless of config', async () => {
    mockExecSync.mockReturnValue('diff --git a/f.ts b/f.ts\n+line' as any)
    const { loadConfig } = await import('../../../src/core/config.js')
    vi.mocked(loadConfig).mockReturnValueOnce({
      model: 'devstral:latest',
      provider: 'ollama',
      ollamaUrl: 'http://localhost:11434',
      anthropicModel: '',
      maxFindings: 15,
      agents: ['security', 'testgen', 'coverage'],  // testgen present in config
      contextLines: 10,
      testOutputDir: './ai-review-tests',
      maxDiffLines: 2000,
      agentTimeoutMs: 60000,
      ignorePaths: [],
      sanitize: true,
    })
    const { SwarmRunner } = await import('../../../src/core/runner.js')
    const runMock = vi.fn().mockResolvedValue({
      findings: [], testFiles: [],
      summary: { totalFindings: 0, bySeverity: {}, byAgent: {}, durationMs: 10 }
    })
    vi.mocked(SwarmRunner).mockImplementationOnce((config: any) => {
      expect(config.agents).not.toContain('testgen')
      return { run: runMock } as any
    })
    await runReviewTool({})
  })
})
