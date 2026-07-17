import { describe, it, expect, vi } from 'vitest'
import { MigrationSafetyAgent, hasMigrationFiles } from '../../src/core/agents/migrationSafety.js'
import { DEFAULT_CONFIG } from '../../src/core/config.js'
import { ParseFailureError } from '../../src/core/parsing.js'
import type { LLMProvider } from '../../src/core/llm/provider.js'

const makeProvider = (response: string): LLMProvider => ({
  chat: vi.fn().mockResolvedValue(response),
  ping: vi.fn().mockResolvedValue({ ok: true }),
})

describe('MigrationSafetyAgent', () => {
  it('has name migration-safety', () => {
    expect(new MigrationSafetyAgent(makeProvider('[]'), DEFAULT_CONFIG).name).toBe(
      'migration-safety'
    )
  })

  it('returns empty array when provider returns empty JSON array', async () => {
    expect(
      await new MigrationSafetyAgent(makeProvider('[]'), DEFAULT_CONFIG).run({
        diff: 'diff content',
      })
    ).toEqual([])
  })

  it('parses a valid finding and stamps agent name', async () => {
    const raw = JSON.stringify([
      {
        severity: 'high',
        basis: 'VERIFIED',
        confidence: 85,
        file: 'migrations/0042_add_user_role.sql',
        line: 3,
        title: 'NOT NULL column without default',
        detail: 'Adding role column as NOT NULL with no default will fail on existing rows',
        suggestion: 'Add a DEFAULT value or run a backfill first',
      },
    ])
    const agent = new MigrationSafetyAgent(makeProvider(raw), DEFAULT_CONFIG)
    const findings = await agent.run({ diff: 'diff' })
    expect(findings).toHaveLength(1)
    expect(findings[0].agent).toBe('migration-safety')
    expect(findings[0].id).toBe('migration-safety-0')
  })

  it('throws ParseFailureError on parse failure', async () => {
    await expect(
      new MigrationSafetyAgent(makeProvider('not json'), DEFAULT_CONFIG).run({ diff: 'diff' })
    ).rejects.toThrow(ParseFailureError)
  })

  it('system prompt mentions NOT NULL and migration', () => {
    const agent = new MigrationSafetyAgent(makeProvider('[]'), DEFAULT_CONFIG)
    expect(agent.systemPrompt).toMatch(/NOT NULL/i)
    expect(agent.systemPrompt).toMatch(/migration/i)
  })
})

describe('hasMigrationFiles', () => {
  it('returns true for a migrations/ path', () => {
    expect(hasMigrationFiles('+++ b/db/migrations/0042_add_role.sql')).toBe(true)
  })

  it('returns true for a .migration.ts file', () => {
    expect(hasMigrationFiles('+++ b/src/database/add_user.migration.ts')).toBe(true)
  })

  it('returns true for a versions/ path', () => {
    expect(hasMigrationFiles('+++ b/alembic/versions/0001_initial.py')).toBe(true)
  })

  it('returns true for an _up.sql file', () => {
    expect(hasMigrationFiles('+++ b/schema/0003_users_up.sql')).toBe(true)
  })

  it('returns false for a non-migration file', () => {
    expect(hasMigrationFiles('--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-foo\n+bar')).toBe(
      false
    )
  })

  it('does not match the --- a/ (old-side) header', () => {
    expect(hasMigrationFiles('--- a/migrations/old.sql\n+++ b/src/app.ts')).toBe(false)
  })
})
