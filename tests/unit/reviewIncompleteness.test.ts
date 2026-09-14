import { describe, it, expect } from 'vitest'
import { createRequire } from 'module'

// scripts/reviewIncompleteness.cjs is CommonJS because its two consumers -- actions/github-script
// and a `node -e` step, both inside .github/workflows/review.yml -- can only `require`. Loading it
// the same way the workflow does is deliberate: a test that imported an ESM twin would prove the
// logic and not the artifact the workflow actually executes.
const require_ = createRequire(import.meta.url)
const { incompletenessLines, noFindingsVerdict } = require_(
  '../../scripts/reviewIncompleteness.cjs'
) as {
  incompletenessLines: (r: unknown) => string[]
  noFindingsVerdict: (r: unknown) => string
}

describe('reviewIncompleteness — the gate behind the PR comment and Step Summary', () => {
  it('reports nothing for a genuinely complete clean run', () => {
    const r = { findings: [], agentStatus: { security: 'ok' }, agentsPlanned: 1 }
    expect(incompletenessLines(r)).toEqual([])
    expect(noFindingsVerdict(r)).toBe('✅ No issues found.')
  })

  it('refuses a green check for a fail-fast run', () => {
    // The defect this module exists for: review.yml posted "✅ No issues found." on the PR for a
    // run that executed three of fifteen agents.
    const r = {
      findings: [],
      earlyExit: { stoppedAt: 'security' },
      agentStatus: { coverage: 'ok', correctness: 'ok', security: 'ok' },
      agentsPlanned: 15,
    }
    expect(noFindingsVerdict(r)).not.toContain('✅')
    expect(incompletenessLines(r)[0]).toContain('12 of 15 agents never ran')
  })

  it('states no ratio rather than a wrong one when agentsPlanned is absent', () => {
    // An older ai-review-agent reports no agentsPlanned. Deriving the denominator from agentStatus
    // would claim "0 of 3 never ran" for a run that abandoned twelve, so the count is omitted.
    const r = {
      findings: [],
      earlyExit: { stoppedAt: 'security' },
      agentStatus: { security: 'ok' },
    }
    const line = incompletenessLines(r)[0]
    expect(line).toContain('the remaining agents never ran')
    expect(line).not.toMatch(/\d+ of \d+ agents/)
  })

  it('refuses a green check for a truncated diff, a short chunk loop, and failed agents', () => {
    expect(
      noFindingsVerdict({ truncation: { truncated: true, originalLines: 10039, keptLines: 2000 } })
    ).not.toContain('✅')
    expect(noFindingsVerdict({ chunking: { total: 5, reviewed: 2 } })).not.toContain('✅')
    expect(noFindingsVerdict({ agentStatus: { security: 'timeout' } })).not.toContain('✅')
  })

  it('reports every reason at once rather than only the first', () => {
    const r = {
      earlyExit: { stoppedAt: 'security' },
      chunking: { total: 5, reviewed: 2 },
      truncation: { truncated: true, originalLines: 900, keptLines: 100 },
      agentStatus: { security: 'ok', design: 'timeout' },
      agentsPlanned: 15,
    }
    expect(incompletenessLines(r)).toHaveLength(4)
  })

  it('survives a malformed or empty envelope without throwing', () => {
    // This runs inside a CI step that already handles a missing findings.json; it must not become
    // a new way for the comment step to crash and leave the PR with no trace at all.
    expect(incompletenessLines(undefined)).toEqual([])
    expect(incompletenessLines(null)).toEqual([])
    expect(incompletenessLines({})).toEqual([])
    expect(noFindingsVerdict({})).toBe('✅ No issues found.')
  })
})

describe('reviewIncompleteness — earlyExit that cost no coverage', () => {
  it('reports nothing when every planned agent ran', () => {
    const r = {
      earlyExit: { stoppedAt: 'security' },
      agentStatus: { coverage: 'ok', correctness: 'ok', security: 'ok' },
      agentsPlanned: 3,
    }
    expect(incompletenessLines(r)).toEqual([])
    expect(noFindingsVerdict(r)).toBe('✅ No issues found.')
  })

  it('treats unknown agentsPlanned as lost coverage rather than assuming none', () => {
    // The safe direction when the question cannot be answered: an older agent binary reports
    // earlyExit without agentsPlanned, and silently calling that complete is the failure mode
    // this whole change exists to remove.
    const r = { earlyExit: { stoppedAt: 'security' }, agentStatus: { security: 'ok' } }
    expect(incompletenessLines(r)).toHaveLength(1)
  })
})

describe('reviewIncompleteness — agrees with schema.ts on every boundary', () => {
  it('stays silent when more agents ran than were planned, as schema.ts does', () => {
    // A malformed or legacy envelope makes `planned - ran` NEGATIVE. This module gated on
    // `!== 0`, which trips on that, while schema.ts floors at 0 and the vscode copy checks `> 0`
    // — so the PR comment claimed a partial review while every other surface stayed silent.
    // Unreachable through the real pipeline, but "the copies agree" is the property this file's
    // existence depends on, and it did not hold.
    const r = {
      earlyExit: { stoppedAt: 'security' },
      agentStatus: { a: 'ok', b: 'ok', c: 'ok', d: 'ok' },
      agentsPlanned: 2,
    }
    expect(incompletenessLines(r)).toEqual([])
  })
})
