import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as vscodeModule from 'vscode'
import path from 'path'

// Must be imported AFTER vi.mock calls take effect (vitest hoists vi.mock)
// vscode is already aliased to our mock via vitest.config.ts

describe('getConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(vscodeModule.workspace.getConfiguration).mockReturnValue({
      get: vi.fn((_key: string, defaultVal: unknown) => defaultVal),
    } as ReturnType<typeof vscodeModule.workspace.getConfiguration>)
  })

  it('returns defaults when no user settings are configured', async () => {
    const { getConfig } = await import('../src/config')
    const config = getConfig('/ext/path')

    expect(config.ollamaUrl).toBe('http://localhost:11434')
    expect(config.model).toBe('devstral:latest')
    expect(config.agents).toEqual([])
    expect(config.maxLines).toBe(2000)
    expect(config.timeoutSecs).toBe(120)
    expect(config.cliPath).toBe(
      path.join('/ext/path', 'node_modules', 'ai-review-agent', 'dist', 'cli', 'index.js')
    )
  })

  it('reads aiReview.ollamaUrl from VS Code settings', async () => {
    vi.mocked(vscodeModule.workspace.getConfiguration).mockReturnValue({
      get: vi.fn((key: string, defaultVal: unknown) => {
        if (key === 'ollamaUrl') return 'http://192.168.1.10:11434'
        return defaultVal
      }),
    } as ReturnType<typeof vscodeModule.workspace.getConfiguration>)

    const { getConfig } = await import('../src/config')
    const config = getConfig('/ext/path')
    expect(config.ollamaUrl).toBe('http://192.168.1.10:11434')
  })

  it('reads aiReview.agents array from VS Code settings', async () => {
    vi.mocked(vscodeModule.workspace.getConfiguration).mockReturnValue({
      get: vi.fn((key: string, defaultVal: unknown) => {
        if (key === 'agents') return ['security', 'performance']
        return defaultVal
      }),
    } as ReturnType<typeof vscodeModule.workspace.getConfiguration>)

    const { getConfig } = await import('../src/config')
    const config = getConfig('/ext/path')
    expect(config.agents).toEqual(['security', 'performance'])
  })
})

describe('buildCliArgs', () => {
  const baseConfig = {
    ollamaUrl: 'http://localhost:11434',
    model: 'devstral:latest',
    agents: [] as string[],
    maxLines: 2000,
    timeoutSecs: 120,
    cliPath: '/ext/node_modules/ai-review-agent/dist/cli/index.js',
  }

  it('assembles required flags', async () => {
    const { buildCliArgs } = await import('../src/config')
    const args = buildCliArgs(baseConfig, '/workspace', '/tmp/ai-review-123.diff')

    expect(args).toContain(baseConfig.cliPath)
    expect(args).toContain('--diff')
    expect(args).toContain('/tmp/ai-review-123.diff')
    expect(args).toContain('--dir')
    expect(args).toContain('/workspace')
    expect(args).toContain('--format')
    expect(args).toContain('json')
    expect(args).toContain('--ollama-url')
    expect(args).toContain('http://localhost:11434')
    expect(args).toContain('--model')
    expect(args).toContain('devstral:latest')
    expect(args).toContain('--fail-on')
    expect(args).toContain('never')
  })

  it('converts timeoutSecs to milliseconds for --timeout', async () => {
    const { buildCliArgs } = await import('../src/config')
    const args = buildCliArgs(baseConfig, '/workspace', '/tmp/diff')
    const timeoutIdx = args.indexOf('--timeout')
    expect(timeoutIdx).not.toBe(-1)
    expect(args[timeoutIdx + 1]).toBe('120000')
  })

  it('omits --agents when agents array is empty (runs all agents)', async () => {
    const { buildCliArgs } = await import('../src/config')
    const args = buildCliArgs({ ...baseConfig, agents: [] }, '/workspace', '/tmp/diff')
    expect(args).not.toContain('--agents')
  })

  it('includes --agents as comma-joined string when agents are specified', async () => {
    const { buildCliArgs } = await import('../src/config')
    const args = buildCliArgs(
      { ...baseConfig, agents: ['security', 'performance'] },
      '/workspace',
      '/tmp/diff'
    )
    const agentsIdx = args.indexOf('--agents')
    expect(agentsIdx).not.toBe(-1)
    expect(args[agentsIdx + 1]).toBe('security,performance')
  })
})
