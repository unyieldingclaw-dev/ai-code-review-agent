import { describe, it, expect } from 'vitest'
import { formatMcpOutput } from '../../../src/mcp/formatter.js'
import type { ReviewResult, Finding } from '../../../src/core/schema.js'

function makeResult(overrides: Partial<ReviewResult> = {}): ReviewResult {
  return {
    findings: [],
    testFiles: [],
    summary: {
      totalFindings: 0,
      bySeverity: {},
      byAgent: {},
      durationMs: 100,
    },
    ...overrides,
  }
}

function makeFinding(
  severity: 'critical' | 'high' | 'medium' | 'low',
  overrides: Partial<Finding> = {}
): Finding {
  return {
    id: 'f1',
    agent: 'security' as const,
    domain: 'Security',
    severity,
    basis: 'VERIFIED' as const,
    file: 'src/auth.ts',
    line: 42,
    title: 'Test finding',
    detail: 'Detailed description',
    evidence: 'test evidence',
    impact: 'test impact',
    recommendation: 'Fix it this way',
    suggestion: 'Fix it this way',
    blocking: false,
    source: 'llm',
    ...overrides,
  }
}

describe('formatMcpOutput', () => {
  it('returns no-findings message when findings is empty', () => {
    const result = formatMcpOutput(makeResult())
    expect(result).toContain('✅ No findings')
  })

  it('returns no-critical/high message when only medium/low exist', () => {
    const result = formatMcpOutput(
      makeResult({
        findings: [makeFinding('medium'), makeFinding('low')],
        summary: {
          totalFindings: 2,
          bySeverity: { medium: 1, low: 1 },
          byAgent: {},
          durationMs: 100,
        },
      })
    )
    expect(result).toContain('✅ No critical or high findings')
    expect(result).toContain('1 medium')
    expect(result).toContain('1 low')
  })

  it('renders critical finding with 🔴 icon and full detail', () => {
    const finding = makeFinding('critical', {
      id: 'f1',
      agent: 'security',
      file: 'src/auth.ts',
      line: 42,
      title: 'Hardcoded secret',
      detail: 'Key is embedded in source.',
      recommendation: 'Use env var.',
    })
    const result = formatMcpOutput(
      makeResult({
        findings: [finding],
        summary: {
          totalFindings: 1,
          bySeverity: { critical: 1 },
          byAgent: { security: 1 },
          durationMs: 100,
        },
      })
    )
    expect(result).toContain('🔴')
    expect(result).toContain('CRITICAL')
    expect(result).toContain('Security')
    expect(result).toContain('src/auth.ts:42')
    expect(result).toContain('Hardcoded secret')
    expect(result).toContain('Key is embedded in source.')
    expect(result).toContain('Use env var.')
  })

  it('renders high finding with 🟠 icon', () => {
    const finding = makeFinding('high')
    const result = formatMcpOutput(
      makeResult({
        findings: [finding],
        summary: { totalFindings: 1, bySeverity: { high: 1 }, byAgent: {}, durationMs: 100 },
      })
    )
    expect(result).toContain('🟠')
    expect(result).toContain('HIGH')
  })

  it('shows medium/low count tail when both exist', () => {
    const findings = [
      makeFinding('critical'),
      makeFinding('medium'),
      makeFinding('medium'),
      makeFinding('low'),
    ]
    const result = formatMcpOutput(
      makeResult({
        findings,
        summary: {
          totalFindings: 4,
          bySeverity: { critical: 1, medium: 2, low: 1 },
          byAgent: {},
          durationMs: 100,
        },
      })
    )
    expect(result).toContain('2 medium')
    expect(result).toContain('1 low')
    expect(result).toContain('ai-review-agent')
  })

  it('omits tail when no medium/low findings', () => {
    const finding = makeFinding('critical')
    const result = formatMcpOutput(
      makeResult({
        findings: [finding],
        summary: { totalFindings: 1, bySeverity: { critical: 1 }, byAgent: {}, durationMs: 100 },
      })
    )
    expect(result).not.toContain('medium')
    expect(result).not.toContain('low')
    expect(result).not.toContain('ai-review-agent')
  })

  it('header shows count of critical+high only', () => {
    const findings = [makeFinding('critical'), makeFinding('high'), makeFinding('medium')]
    const result = formatMcpOutput(
      makeResult({
        findings,
        summary: {
          totalFindings: 3,
          bySeverity: { critical: 1, high: 1, medium: 1 },
          byAgent: {},
          durationMs: 100,
        },
      })
    )
    expect(result).toContain('2 findings')
  })

  it('shows only medium count in tail when no low findings', () => {
    const finding = makeFinding('critical')
    const result = formatMcpOutput(
      makeResult({
        findings: [finding, makeFinding('medium')],
        summary: {
          totalFindings: 2,
          bySeverity: { critical: 1, medium: 1 },
          byAgent: {},
          durationMs: 100,
        },
      })
    )
    expect(result).toContain('1 medium')
    expect(result).not.toContain('low')
    expect(result).toContain('ai-review-agent')
  })

  it('does not report an unqualified clean pass when every agent failed and there are no findings', () => {
    // Real bug: a run where every agent timed out and found nothing was indistinguishable from
    // a genuine clean pass to the calling LLM, since this formatter never read agentStatus.
    const result = formatMcpOutput(
      makeResult({
        agentStatus: { security: 'timeout', correctness: 'timeout' },
      })
    )
    expect(result).not.toMatch(/^## AI Code Review — ✅ No findings\n$/)
    expect(result).toMatch(/incomplete/i)
    expect(result).toContain('security: timeout')
    expect(result).toContain('correctness: timeout')
  })

  it('does not report an unqualified clean pass when the diff was truncated and there are no findings', () => {
    const result = formatMcpOutput(
      makeResult({
        truncation: { truncated: true, originalLines: 12599, keptLines: 2000 },
      })
    )
    expect(result).not.toMatch(/^## AI Code Review — ✅ No findings\n$/)
    expect(result).toMatch(/truncat/i)
    expect(result).toContain('2000')
    expect(result).toContain('12599')
  })

  it('still shows the clean checkmark when agentStatus is all ok and nothing was truncated', () => {
    const result = formatMcpOutput(
      makeResult({
        agentStatus: { security: 'ok', correctness: 'ok' },
        truncation: { truncated: false, originalLines: 100, keptLines: 100 },
      })
    )
    expect(result).toBe('## AI Code Review — ✅ No findings\n')
  })

  // Real gap: formatMcpOutput read neither toolAvailability field, so a partial gitleaks scan, a
  // not-installed tool, and a fully clean tool run were indistinguishable to the calling LLM --
  // the reader least able to notice, having no terminal output to fall back on.
  it('reports a partial tool scan to the calling LLM', () => {
    const result = formatMcpOutput(makeResult({ toolAvailability: { gitleaks: 'partial' } }))
    expect(result).toMatch(/partial scan/i)
    expect(result).toContain('gitleaks')
  })

  it('reports a not-installed tool to the calling LLM', () => {
    const result = formatMcpOutput(
      makeResult({ toolAvailability: { lizard: 'unavailable-llm-fallback' } })
    )
    expect(result).toMatch(/degraded mode/i)
    expect(result).toContain('lizard')
  })

  // The headline distinction that keeps the warning worth reading: a failed agent or a truncated
  // diff means the review did not complete as designed. A missing optional tool does not -- the
  // agent ran in a documented degraded mode and returned a real result. Folding the two together
  // would mark every clean run "incomplete" for anyone who simply has not installed lizard.
  it('does not downgrade the headline to "incomplete" for a merely degraded tool', () => {
    const result = formatMcpOutput(
      makeResult({ toolAvailability: { gitleaks: 'unavailable-llm-fallback' } })
    )
    expect(result).toContain('✅ No findings')
    expect(result).not.toMatch(/incomplete/i)
    expect(result).toContain('gitleaks')
  })

  it('still downgrades the headline when an agent failed alongside a degraded tool', () => {
    const result = formatMcpOutput(
      makeResult({
        agentStatus: { security: 'timeout' },
        toolAvailability: { gitleaks: 'unavailable-llm-fallback' },
      })
    )
    expect(result).toMatch(/incomplete/i)
    expect(result).toContain('gitleaks')
    expect(result).toContain('security: timeout')
  })

  it('says nothing about tools when every tool ran cleanly', () => {
    const result = formatMcpOutput(makeResult({ toolAvailability: { gitleaks: 'used' } }))
    expect(result).toBe('## AI Code Review — ✅ No findings\n')
  })

  it('says nothing about a not-applicable tool', () => {
    const result = formatMcpOutput(makeResult({ toolAvailability: { npmAudit: 'not-applicable' } }))
    expect(result).toBe('## AI Code Review — ✅ No findings\n')
  })

  it('surfaces a tool note above real findings, not just on the empty-findings path', () => {
    const result = formatMcpOutput(
      makeResult({
        findings: [makeFinding('critical')],
        summary: { totalFindings: 1, bySeverity: { critical: 1 }, byAgent: {}, durationMs: 100 },
        toolAvailability: { gitleaks: 'partial' },
      })
    )
    expect(result).toMatch(/partial scan/i)
    expect(result.indexOf('Partial scan')).toBeLessThan(result.indexOf('Test finding'))
  })

  it('surfaces an agent-failure warning above real findings, not just on the empty-findings path', () => {
    const finding = makeFinding('critical')
    const result = formatMcpOutput(
      makeResult({
        findings: [finding],
        summary: { totalFindings: 1, bySeverity: { critical: 1 }, byAgent: {}, durationMs: 100 },
        agentStatus: { security: 'ok', dependencies: 'parse-error' },
      })
    )
    expect(result).toContain('dependencies: parse-error')
    expect(result).toContain(finding.title)
  })
})

describe('locationCheck signalling', () => {
  // This surface is read by an LLM with no terminal to cross-check against, so an unreliable
  // line number that is not labelled here is one nothing downstream can catch.
  it('marks an unverified location in the heading, beside the line it qualifies', () => {
    const out = formatMcpOutput(
      makeResult({
        findings: [
          makeFinding('critical', { locationCheck: 'mismatch', file: 'src/a.ts', line: 42 }),
        ],
      })
    )
    expect(out).toContain('location unverified')
    // The finding and its location are still reported -- only the confidence in the line changes.
    expect(out).toContain('src/a.ts:42')
  })

  it('stays silent for verified, unknown, and an absent check', () => {
    for (const lc of [undefined, 'verified', 'unknown'] as const) {
      const out = formatMcpOutput(
        makeResult({ findings: [makeFinding('critical', { locationCheck: lc })] })
      )
      expect(out).not.toContain('location unverified')
    }
  })
})

describe('formatMcpOutput timing', () => {
  const timings = [
    {
      diffLines: 900,
      effectiveTimeoutMs: 240000,
      durationMs: 300000,
      agents: [
        {
          name: 'security' as const,
          elapsedMs: 240000,
          attemptMs: 240000,
          attempts: 1,
          status: 'timeout' as const,
        },
        {
          name: 'design' as const,
          elapsedMs: 20_000,
          attemptMs: 20_000,
          attempts: 1,
          status: 'ok' as const,
        },
      ],
    },
  ]

  it('reports timing to the calling model, naming what hit the ceiling', () => {
    const out = formatMcpOutput(makeResult({ findings: [makeFinding('high')], timings }))
    expect(out).toContain('Timing: 900 diff lines, 2 agents, 300.0s total, ceiling 240.0s/agent')
    expect(out).toContain('hit the ceiling: security')
  })

  // REGRESSION. A clean run took the early return that skipped the notice block entirely, so the
  // reader with no terminal and no artifact to open -- the only one wholly dependent on this
  // string -- was the one told nothing. Same gap toolAvailability and locationCheck each left
  // here before.
  it('still reports timing on a run with no findings and no degraded tools', () => {
    const out = formatMcpOutput(makeResult({ findings: [], timings }))
    expect(out).toContain('No findings')
    expect(out).toContain('Timing: 900 diff lines')
  })

  // REGRESSION for the headline gate: timing joins `notices`, which is rendered, and must never
  // join `warnings`, which decides the headline. A slow run is not an incomplete one -- the same
  // line toolAvailability draws, for the same reason.
  it('does not let timing downgrade a clean headline to incomplete', () => {
    const out = formatMcpOutput(makeResult({ findings: [], timings }))
    expect(out).toContain('✅ No findings')
    expect(out).not.toContain('the review was incomplete')
  })

  it('leaves the bare no-findings output untouched when a result carries no timings', () => {
    expect(formatMcpOutput(makeResult())).toBe('## AI Code Review — ✅ No findings' + '\n')
  })
})

describe('formatMcpOutput policy notes', () => {
  // This surface read neither policy nor filteredFiles, and its caller is an LLM with no terminal
  // to cross-check against -- so it was the worst place for the omission to sit.
  it('names the narrowed agents and counts distinct files', () => {
    const out = formatMcpOutput(
      makeResult({
        filteredFiles: { security: ['docs/a.md'], adversarial: ['docs/a.md', 'docs/b.md'] },
      })
    )
    expect(out).toContain('adversarial, security reviewed a reduced diff')
    expect(out).toContain('2 files')
  })

  it('reports agents skipped outright', () => {
    const out = formatMcpOutput(makeResult({ policy: { agentsSkipped: ['security'], reason: {} } }))
    expect(out).toContain('skipped entirely by agentPolicy')
  })

  it('says nothing about policy when neither applies', () => {
    expect(formatMcpOutput(makeResult())).not.toContain('Policy:')
  })
})
