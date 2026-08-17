import { describe, it, expect, vi } from 'vitest'
import { loadConfig, DEFAULT_CONFIG } from '../../src/core/config.js'
import { writeFileSync, unlinkSync } from 'fs'

describe('DEFAULT_CONFIG', () => {
  it('does not include testgen in default agents', () => {
    expect(DEFAULT_CONFIG.agents).not.toContain('testgen')
  })

  it('has 15 default agents', () => {
    expect(DEFAULT_CONFIG.agents).toHaveLength(15)
  })

  it('model is devstral:latest', () => {
    expect(DEFAULT_CONFIG.model).toBe('devstral:latest')
  })

  it('does not have anthropicModel field', () => {
    expect('anthropicModel' in DEFAULT_CONFIG).toBe(false)
  })

  it('does not have contextLines field', () => {
    expect('contextLines' in DEFAULT_CONFIG).toBe(false)
  })

  it('provider is ollama', () => {
    expect(DEFAULT_CONFIG.provider).toBe('ollama')
  })

  it('verifyEvidence defaults to false', () => {
    expect(DEFAULT_CONFIG.verifyEvidence).toBe(false)
  })

  it('verifierModel defaults to qwen3:latest', () => {
    expect(DEFAULT_CONFIG.verifierModel).toBe('qwen3:latest')
  })

  it('verifyEvidenceSeverity defaults to high', () => {
    expect(DEFAULT_CONFIG.verifyEvidenceSeverity).toBe('high')
  })

  it('chunk defaults to false', () => {
    expect(DEFAULT_CONFIG.chunk).toBe(false)
  })

  // Pins the actual default this release's fix for security/adversarial misreading .md prose as
  // vulnerable code depends on -- the per-agent filtering mechanism itself is well covered
  // elsewhere (tests/unit/runner.test.ts), but nothing previously asserted this specific default
  // value exists, so a future edit could silently drop or reword it with no test failing.
  it('security and adversarial exclude **/*.md by default', () => {
    expect(DEFAULT_CONFIG.agentPolicy?.security?.exclude).toContain('**/*.md')
    expect(DEFAULT_CONFIG.agentPolicy?.adversarial?.exclude).toContain('**/*.md')
  })
})

describe('loadConfig', () => {
  it('returns defaults when no config file exists', () => {
    const config = loadConfig('/nonexistent/path')
    expect(config.model).toBe('devstral:latest')
    expect(config.maxFindings).toBe(15)
  })

  it('merges project config over defaults', () => {
    writeFileSync(
      'ai-review.config.json',
      JSON.stringify({ model: 'qwen3:latest', maxFindings: 5 })
    )
    try {
      const config = loadConfig(process.cwd())
      expect(config.model).toBe('qwen3:latest')
      expect(config.maxFindings).toBe(5)
      expect(config.agents).not.toContain('testgen')
    } finally {
      unlinkSync('ai-review.config.json')
    }
  })

  it('does not log an error for a valid config file', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    writeFileSync('ai-review.config.json', JSON.stringify({ model: 'qwen3:latest' }))
    try {
      loadConfig(process.cwd())
      expect(errorSpy).not.toHaveBeenCalled()
    } finally {
      unlinkSync('ai-review.config.json')
    }
  })

  it('returns defaults when config file contains invalid JSON', () => {
    writeFileSync('ai-review.config.json', '{ not valid json }')
    try {
      const config = loadConfig(process.cwd())
      expect(config.model).toBe('devstral:latest')
    } finally {
      unlinkSync('ai-review.config.json')
    }
  })

  it('logs a warning when falling back to defaults due to invalid JSON', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    writeFileSync('ai-review.config.json', '{ not valid json }')
    try {
      loadConfig(process.cwd())
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('ai-review.config.json'))
    } finally {
      unlinkSync('ai-review.config.json')
    }
  })
})
