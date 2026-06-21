import { describe, it, expect, beforeEach, afterEach } from 'vitest'
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
})

describe('loadConfig', () => {
  it('returns defaults when no config file exists', () => {
    const config = loadConfig('/nonexistent/path')
    expect(config.model).toBe('devstral:latest')
    expect(config.maxFindings).toBe(15)
  })

  it('merges project config over defaults', () => {
    writeFileSync('ai-review.config.json', JSON.stringify({ model: 'qwen3:latest', maxFindings: 5 }))
    try {
      const config = loadConfig(process.cwd())
      expect(config.model).toBe('qwen3:latest')
      expect(config.maxFindings).toBe(5)
      expect(config.agents).not.toContain('testgen')
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
})
