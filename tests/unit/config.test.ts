import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { loadConfig, DEFAULT_CONFIG } from '../../src/core/config.js'
import { writeFileSync, unlinkSync } from 'fs'

describe('loadConfig', () => {
  it('returns defaults when no config file exists', () => {
    const config = loadConfig('/nonexistent/path')
    expect(config.model).toBe('devstral:latest')
    expect(config.provider).toBe('ollama')
    expect(config.maxFindings).toBe(15)
  })

  it('merges project config over defaults', () => {
    writeFileSync('ai-review.config.json', JSON.stringify({ model: 'qwen3:latest', maxFindings: 5 }))
    try {
      const config = loadConfig(process.cwd())
      expect(config.model).toBe('qwen3:latest')
      expect(config.maxFindings).toBe(5)
      expect(config.provider).toBe('ollama') // default preserved
    } finally {
      unlinkSync('ai-review.config.json')
    }
  })
})
