// tests/unit/mcp/toolDescription.test.ts
// Separate file from tool.test.ts: that file globally mocks src/core/config.js (providing only
// loadConfig, not DEFAULT_CONFIG), which would break buildToolDescription's real DEFAULT_CONFIG
// import if tested there.
import { describe, it, expect } from 'vitest'
import { buildToolDescription } from '../../../src/mcp/tool.js'
import { DEFAULT_CONFIG } from '../../../src/core/config.js'

describe('buildToolDescription', () => {
  it('states the real agent count', () => {
    expect(buildToolDescription()).toContain(`Uses ${DEFAULT_CONFIG.agents.length} specialist`)
  })

  it('lists every agent DEFAULT_CONFIG actually runs', () => {
    const description = buildToolDescription()
    for (const agent of DEFAULT_CONFIG.agents) {
      expect(description).toContain(agent)
    }
  })
})
