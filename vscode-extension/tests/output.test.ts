import { describe, it, expect } from 'vitest'
import { renderReport } from '../src/output'
import type { ReviewResult } from '../src/types'

// WHY this file exists at all: `renderReport` had no test coverage, and that is how this surface
// silently fell three fixes behind the other five. It read only `findings` and `summary`, so a
// truncated run, a run whose agents all failed, and a --fail-fast run each rendered byte-identical
// to a genuine clean pass. None of those states was ever asserted here, because nothing was.

function makeResult(overrides: Partial<ReviewResult> = {}): ReviewResult {
  return {
    findings: [],
    testFiles: [],
    summary: { totalFindings: 0, bySeverity: {}, byAgent: {}, durationMs: 100 },
    ...overrides,
  }
}

/** Minimal OutputChannel stand-in that records what was written. */
function makeChannel() {
  const lines: string[] = []
  return {
    lines,
    text: () => lines.join('\n'),
    channel: {
      clear: () => {
        lines.length = 0
      },
      appendLine: (l: string) => {
        lines.push(l)
      },
    } as unknown as Parameters<typeof renderReport>[0],
  }
}

describe('renderReport — incompleteness parity with the CLI', () => {
  it('does not render a fail-fast run as clean', () => {
    const c = makeChannel()
    renderReport(
      c.channel,
      makeResult({
        earlyExit: { stoppedAt: 'security' },
        agentStatus: { coverage: 'ok', correctness: 'ok', security: 'ok' },
        agentsPlanned: 15,
      })
    )
    expect(c.text()).not.toContain('✅')
    expect(c.text()).toContain('INCOMPLETE')
  })

  it('counts agents that were planned, not the ones that started', () => {
    // The denominator trap, which reaches this surface too: agentStatus holds only agents that
    // ran, so deriving the total from it claims full coverage of a roster never attempted.
    const c = makeChannel()
    renderReport(
      c.channel,
      makeResult({
        earlyExit: { stoppedAt: 'security' },
        agentStatus: { coverage: 'ok', correctness: 'ok', security: 'ok' },
        agentsPlanned: 15,
      })
    )
    expect(c.text()).toContain('12 of 15 agents never ran')
  })

  it('does not render a truncated run as clean', () => {
    const c = makeChannel()
    renderReport(
      c.channel,
      makeResult({ truncation: { truncated: true, originalLines: 10039, keptLines: 2000 } })
    )
    expect(c.text()).not.toContain('✅')
    expect(c.text()).toContain('2000/10039')
  })

  it('does not render a run whose agents failed as clean', () => {
    const c = makeChannel()
    renderReport(c.channel, makeResult({ agentStatus: { security: 'timeout' }, agentsPlanned: 15 }))
    expect(c.text()).not.toContain('✅')
    expect(c.text()).toContain('timeout')
  })

  it('does not render a short chunk loop as clean', () => {
    const c = makeChannel()
    renderReport(c.channel, makeResult({ chunking: { total: 5, reviewed: 2 } }))
    expect(c.text()).not.toContain('✅')
    expect(c.text()).toContain('2 of 5 chunks')
  })

  it('still reports a genuinely complete clean run as a pass', () => {
    // Guard against over-correction. Absent fields must read as "not reported", never as
    // "something went wrong" -- the extension may be driven by an older agent binary.
    const c = makeChannel()
    renderReport(c.channel, makeResult({ agentStatus: { security: 'ok' }, agentsPlanned: 1 }))
    expect(c.text()).toContain('✅ No issues found.')
    expect(c.text()).not.toContain('INCOMPLETE')
  })

  it('treats an entirely absent envelope as complete rather than incomplete', () => {
    // Guard: an older ai-review-agent reports none of these fields. Rendering that as INCOMPLETE
    // would cry wolf on every run and train the reader to ignore the banner.
    const c = makeChannel()
    renderReport(c.channel, makeResult())
    expect(c.text()).toContain('✅ No issues found.')
  })
})

describe('renderReport — earlyExit that cost no coverage', () => {
  it('does not call a run incomplete when every planned agent ran', () => {
    const c = makeChannel()
    renderReport(
      c.channel,
      makeResult({
        earlyExit: { stoppedAt: 'security' },
        agentStatus: { coverage: 'ok', correctness: 'ok', security: 'ok' },
        agentsPlanned: 3,
      })
    )
    expect(c.text()).not.toContain('INCOMPLETE')
    expect(c.text()).toContain('✅ No issues found.')
  })
})
