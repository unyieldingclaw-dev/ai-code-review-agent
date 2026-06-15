import { describe, it, expect, vi } from 'vitest'
import { MigrationSafetyAgent } from '../../src/core/agents/migrationSafety.js'
import { DEFAULT_CONFIG } from '../../src/core/config.js'
import type { LLMProvider } from '../../src/core/llm/provider.js'

const makeProvider = (response: string): LLMProvider => ({
  chat: vi.fn().mockResolvedValue(response),
  ping: vi.fn().mockResolvedValue({ ok: true })
})

describe('MigrationSafetyAgent', () => {
  it('has name migration-safety', () => {
    expect(new MigrationSafetyAgent(makeProvider('[]'), DEFAULT_CONFIG).name).toBe('migration-safety')
  })

  it('returns empty array when provider returns empty JSON array', async () => {
    expect(await new MigrationSafetyAgent(makeProvider('[]'), DEFAULT_CONFIG).run({ diff: 'diff content' })).toEqual([])
  })

  it('parses a valid finding and stamps agent name', async () => {
    const raw = JSON.stringify([{ severity: 'high', basis: 'VERIFIED', confidence: 85, file: 'migrations/0042_add_user_role.sql', line: 3, title: 'NOT NULL column without default', detail: 'Adding role column as NOT NULL with no default will fail on existing rows', suggestion: 'Add a DEFAULT value or run a backfill first' }])
    const agent = new MigrationSafetyAgent(makeProvider(raw), DEFAULT_CONFIG)
    const findings = await agent.run({ diff: 'diff' })
    expect(findings).toHaveLength(1)
    expect(findings[0].agent).toBe('migration-safety')
    expect(findings[0].id).toBe('migration-safety-0')
  })

  it('returns empty array on parse failure', async () => {
    expect(await new MigrationSafetyAgent(makeProvider('not json'), DEFAULT_CONFIG).run({ diff: 'diff' })).toEqual([])
  })

  it('system prompt mentions NOT NULL and migration', () => {
    const agent = new MigrationSafetyAgent(makeProvider('[]'), DEFAULT_CONFIG)
    expect(agent.systemPrompt).toMatch(/NOT NULL/i)
    expect(agent.systemPrompt).toMatch(/migration/i)
  })
})
