import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { loadAgentContext } from '../../src/core/contextLoader.js'

const TMP = join(process.cwd(), '.test-context-tmp')

function setup(files: Record<string, string>) {
  mkdirSync(join(TMP, 'memory-bank'), { recursive: true })
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(TMP, 'memory-bank', name), content, 'utf-8')
  }
}

beforeEach(() => {
  mkdirSync(TMP, { recursive: true })
})
afterEach(() => {
  if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true })
})

describe('loadAgentContext', () => {
  it('returns empty result when memory-bank/ does not exist', () => {
    const result = loadAgentContext('/nonexistent/path', 'security')
    expect(result.content).toBe('')
    expect(result.filesLoaded).toHaveLength(0)
    expect(result.truncated).toBe(false)
    expect(result.estimatedTokens).toBe(0)
  })

  it('returns empty result for agents with no configured files', () => {
    setup({ 'techContext.md': 'some content' })
    const result = loadAgentContext(TMP, 'performance')
    expect(result.content).toBe('')
    expect(result.filesLoaded).toHaveLength(0)
  })

  it('loads techContext.md for security agent', () => {
    setup({ 'techContext.md': 'Tech stack: TypeScript + Node.js' })
    const result = loadAgentContext(TMP, 'security')
    expect(result.filesLoaded).toContain('memory-bank/techContext.md')
    expect(result.content).toContain('Project Context')
    expect(result.content).toContain('TypeScript')
    expect(result.estimatedTokens).toBeGreaterThan(0)
  })

  it('loads multiple files for design agent', () => {
    setup({
      'systemPatterns.md': 'Architecture: layered',
      'projectbrief.md': 'Goal: code review tool',
      'techContext.md': 'Stack: Node',
    })
    const result = loadAgentContext(TMP, 'design')
    expect(result.filesLoaded.length).toBeGreaterThanOrEqual(2)
    expect(result.content).toContain('systemPatterns')
  })

  it('truncates content when budget is exceeded', () => {
    const bigContent = 'x'.repeat(5000)
    setup({ 'techContext.md': bigContent })
    const result = loadAgentContext(TMP, 'security')
    expect(result.truncated).toBe(true)
    expect(result.content.length).toBeLessThan(5000 + 200) // content + header overhead
    expect(result.estimatedTokens).toBeLessThanOrEqual(1100) // ~4000 chars / 4
  })

  it('skips files that do not exist without error', () => {
    // Only systemPatterns.md exists, projectbrief.md and techContext.md do not
    setup({ 'systemPatterns.md': 'Patterns here' })
    const result = loadAgentContext(TMP, 'design')
    expect(result.filesLoaded).toContain('memory-bank/systemPatterns.md')
    expect(result.filesLoaded).not.toContain('memory-bank/projectbrief.md')
    expect(result.truncated).toBe(false)
  })
})
