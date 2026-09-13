import { describe, it, expect } from 'vitest'
import { formatMarkdown } from '../../../src/cli/formatter.js'
import { formatMcpOutput } from '../../../src/mcp/formatter.js'
import type { ReviewResult, Finding } from '../../../src/core/schema.js'

function makeResult(overrides: Partial<ReviewResult> = {}): ReviewResult {
  return {
    findings: [],
    testFiles: [],
    summary: { totalFindings: 0, bySeverity: {}, byAgent: {}, durationMs: 100 },
    ...overrides,
  }
}

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'f1',
    agent: 'security',
    domain: 'Security',
    severity: 'high',
    basis: 'VERIFIED',
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

describe('formatMarkdown', () => {
  it('uses emoji by default', () => {
    const result = makeResult({
      findings: [makeFinding({ severity: 'high' })],
      summary: { totalFindings: 1, bySeverity: { high: 1 }, byAgent: {}, durationMs: 100 },
    })
    const output = formatMarkdown(result)
    expect(output).toContain('🟠')
  })

  it('uses text labels when noEmoji is true', () => {
    const result = makeResult({
      findings: [makeFinding({ severity: 'critical' })],
      summary: { totalFindings: 1, bySeverity: { critical: 1 }, byAgent: {}, durationMs: 100 },
    })
    const output = formatMarkdown(result, { noEmoji: true })
    expect(output).toContain('[CRITICAL]')
    expect(output).not.toContain('🔴')
  })

  it('uses text labels for all severity levels when noEmoji is true', () => {
    const findings = [
      makeFinding({ severity: 'critical' }),
      makeFinding({ severity: 'high' }),
      makeFinding({ severity: 'medium' }),
      makeFinding({ severity: 'low' }),
    ]
    const result = makeResult({
      findings,
      summary: {
        totalFindings: 4,
        bySeverity: { critical: 1, high: 1, medium: 1, low: 1 },
        byAgent: {},
        durationMs: 100,
      },
    })
    const output = formatMarkdown(result, { noEmoji: true })
    expect(output).toContain('[CRITICAL]')
    expect(output).toContain('[HIGH]')
    expect(output).toContain('[MEDIUM]')
    expect(output).toContain('[LOW]')
    expect(output).not.toContain('🔴')
    expect(output).not.toContain('🟠')
    expect(output).not.toContain('🟡')
    expect(output).not.toContain('🔵')
  })

  it('shows plain no-issues text when noEmoji is true and no findings', () => {
    const output = formatMarkdown(makeResult(), { noEmoji: true })
    expect(output).toContain('No issues found.')
    expect(output).not.toContain('✅')
  })

  it('shows checkmark when emoji enabled and no findings', () => {
    const output = formatMarkdown(makeResult())
    expect(output).toContain('✅ No issues found.')
  })

  it('omits test file emoji header when noEmoji is true', () => {
    const result = makeResult({
      findings: [makeFinding({ severity: 'high' })],
      testFiles: [{ path: 'tests/auth.test.ts', content: '// test', framework: 'vitest' }],
      summary: { totalFindings: 1, bySeverity: { high: 1 }, byAgent: {}, durationMs: 100 },
    })
    const output = formatMarkdown(result, { noEmoji: true })
    expect(output).toContain('Generated Test Files')
    expect(output).not.toContain('🧪')
  })

  it('includes test file emoji header when emoji enabled', () => {
    const result = makeResult({
      findings: [makeFinding({ severity: 'high' })],
      testFiles: [{ path: 'tests/auth.test.ts', content: '// test', framework: 'vitest' }],
      summary: { totalFindings: 1, bySeverity: { high: 1 }, byAgent: {}, durationMs: 100 },
    })
    const output = formatMarkdown(result)
    expect(output).toContain('🧪')
  })

  it('shows an agent-failure warning instead of a clean checkmark when agentStatus has failures', () => {
    const result = makeResult({
      findings: [],
      agentStatus: { security: 'timeout', correctness: 'ok', performance: 'parse-error' },
    })
    const output = formatMarkdown(result)
    expect(output).toContain('agents failed')
    expect(output).not.toContain('No issues found')
    expect(output).toContain('security')
    expect(output).toContain('timeout')
    expect(output).toContain('performance')
    expect(output).toContain('parse-error')
  })

  it('still shows the clean checkmark when agentStatus is all ok', () => {
    const result = makeResult({
      findings: [],
      agentStatus: { security: 'ok', correctness: 'ok' },
    })
    const output = formatMarkdown(result)
    expect(output).toContain('No issues found')
  })

  it('shows a truncation warning near the top when the diff was truncated', () => {
    const result = makeResult({
      findings: [],
      truncation: { truncated: true, originalLines: 4188, keptLines: 2000 },
    })
    const output = formatMarkdown(result)
    expect(output).toContain('truncated')
    expect(output).toContain('2000')
    expect(output).toContain('4188')
    expect(output.indexOf('truncated')).toBeLessThan(output.indexOf('No issues found'))
  })

  it('does not show a truncation warning when the diff was not truncated', () => {
    const result = makeResult({
      findings: [],
      truncation: { truncated: false, originalLines: 100, keptLines: 100 },
    })
    const output = formatMarkdown(result)
    expect(output).not.toContain('truncated')
  })

  it('reports a truncated run as INCOMPLETE rather than as any kind of pass', () => {
    // Two real bug reports, a week apart. The first (12,599 lines truncated to 2,000) ended in an
    // unqualified "✅ No issues found." and was fixed by appending qualifying text. That was not
    // enough: the second (10,039 lines truncated to 2,000) still read as a pass, because the green
    // check is absorbed before the sentence beside it -- the glyph IS the verdict for a skimming
    // reader. The headline now leads with the incompleteness instead of trailing it.
    const result = makeResult({
      findings: [],
      truncation: { truncated: true, originalLines: 12599, keptLines: 2000 },
    })
    const output = formatMarkdown(result)
    expect(output).not.toContain('✅')
    expect(output).toContain('INCOMPLETE — reviewed 2000/12599 lines')
    expect(output).toContain('10599') // the unreviewed remainder, stated outright
  })

  // REGRESSION (2026-08-30). #51 fixed the NO-findings path and stopped there, leaving the
  // findings path stating "**15 findings**" as its headline with the truncation banner below it.
  // A findings count is a verdict in the same way a ✅ is: it states a result, and a reader who
  // takes it at face value has no reason to suspect 70% of the diff was never looked at.
  //
  // Measured, which is why this is not a style preference: a 6,578-line diff at default
  // --max-lines reviewed 2,000 lines and reported 0 findings; the same diff with --chunk returned
  // 15 findings including 2 High. The banner fired correctly three times over and the reader still
  // concluded clean. A control that depends on attention is not a control.
  it('leads with INCOMPLETE when a truncated run DID find things, not just when it found none', () => {
    const findings = [makeFinding()]
    const result = makeResult({
      findings,
      summary: { totalFindings: findings.length, bySeverity: {}, byAgent: {}, durationMs: 100 },
      truncation: { truncated: true, originalLines: 6578, keptLines: 2000 },
    })
    const headline = formatMarkdown(result)
      .split('\n')
      .find((l) => l.includes('finding'))
    expect(headline).toBeDefined()
    // The incompleteness must be IN the headline, not in a line below it.
    expect(headline).toContain('INCOMPLETE')
    expect(headline).toContain('2000/6578')
    expect(headline).toContain('1 finding')
  })

  it('does not state a bare findings count as the headline of a truncated run', () => {
    // The exact shape that shipped: "**15 findings** | 200ms" with the caveat underneath it.
    const findings = [makeFinding({ id: 'f1' }), makeFinding({ id: 'f2' })]
    const result = makeResult({
      findings,
      summary: { totalFindings: findings.length, bySeverity: {}, byAgent: {}, durationMs: 100 },
      truncation: { truncated: true, originalLines: 6578, keptLines: 2000 },
    })
    const bareCount = formatMarkdown(result)
      .split('\n')
      .find((l) => /^\*\*\d+ findings?\*\* \|/.test(l))
    expect(bareCount).toBeUndefined()
  })

  // REGRESSION (2026-08-30), MCP side. The same defect as the two CLI cases above, on the surface
  // that earns the fix most: systemPatterns' four-formatter rule says check MCP FIRST, because its
  // reader is a calling LLM with no terminal to cross-check against. #51's reasoning reached this
  // file's no-findings path and not its two siblings twenty lines below.
  it('MCP does not show a green check for a truncated run with only medium/low findings', () => {
    const findings = [makeFinding({ severity: 'medium' })]
    const result = makeResult({
      findings,
      summary: {
        totalFindings: 1,
        bySeverity: { medium: 1 },
        byAgent: {},
        durationMs: 100,
      },
      truncation: { truncated: true, originalLines: 6578, keptLines: 2000 },
    })
    const output = formatMcpOutput(result)
    // A ✅ here says "reviewed and found nothing serious" about 30% of a diff.
    expect(output).not.toContain('✅')
    expect(output.split('\n')[0]).toContain('INCOMPLETE')
  })

  it('MCP does not state a bare findings count as the headline of a truncated run', () => {
    const findings = [
      makeFinding({ severity: 'high' }),
      makeFinding({ id: 'f2', severity: 'high' }),
    ]
    const result = makeResult({
      findings,
      summary: { totalFindings: 2, bySeverity: { high: 2 }, byAgent: {}, durationMs: 100 },
      truncation: { truncated: true, originalLines: 6578, keptLines: 2000 },
    })
    const headline = formatMcpOutput(result).split('\n')[0]
    expect(headline).toContain('INCOMPLETE')
    expect(headline).not.toMatch(/—\s*\d+ findings?$/)
  })

  it('MCP still reports a genuine full-coverage run without the incompleteness headline', () => {
    // Guard against over-correction: an untruncated run with all agents ok must keep its ✅.
    const result = makeResult({
      findings: [makeFinding({ severity: 'medium' })],
      summary: { totalFindings: 1, bySeverity: { medium: 1 }, byAgent: {}, durationMs: 100 },
      agentStatus: { security: 'ok' },
    })
    const output = formatMcpOutput(result)
    expect(output).toContain('✅')
    expect(output).not.toContain('INCOMPLETE')
  })

  // REGRESSION (2026-08-30). The first version of the INCOMPLETE headline gated on truncation
  // ALONE, while the MCP fix in the same change gated on `warnings` — which carries agent failures
  // too. That made the CLI the only one of four surfaces calling an agent-failure run complete:
  // MCP said INCOMPLETE, sarif set executionSuccessful=false, githubAnnotations emitted a
  // ::warning:: per agent, and cli/index.ts set exit code 2. The process called the run degraded
  // while its own headline called it complete.
  //
  // Truncation and agent failure are the same defect wearing two hats: part of the diff never
  // reviewed, versus part of the review never performed. Neither is actionable from a plain count.
  it('leads with INCOMPLETE when agents failed, even with nothing truncated', () => {
    const result = makeResult({
      findings: [makeFinding()],
      summary: { totalFindings: 1, bySeverity: { high: 1 }, byAgent: {}, durationMs: 100 },
      agentStatus: { security: 'ok', performance: 'timeout', design: 'error' },
    })
    const headline = formatMarkdown(result)
      .split('\n')
      .find((l) => l.includes('finding'))
    expect(headline).toContain('INCOMPLETE')
    expect(headline).toContain('1/3') // agents that completed, stated outright
  })

  it('CLI and MCP agree on AGENT FAILURES, not just on truncation', () => {
    // The cross-surface check that existed only for truncation, which is why the split survived.
    const result = makeResult({
      findings: [makeFinding()],
      summary: { totalFindings: 1, bySeverity: { high: 1 }, byAgent: {}, durationMs: 100 },
      agentStatus: { security: 'ok', performance: 'timeout' },
    })
    expect(formatMarkdown(result)).toContain('INCOMPLETE')
    expect(formatMcpOutput(result)).toContain('INCOMPLETE')
  })

  it('does not render a truncated run as clean on ANY surface — CLI and MCP agree', () => {
    // The CLI said ✅ while MCP said ⚠️ for the identical state, so the same run reported two
    // different verdicts depending on which surface you read. Whichever is chosen, both must
    // refuse to call a partial review clean.
    const result = makeResult({
      findings: [],
      truncation: { truncated: true, originalLines: 10039, keptLines: 2000 },
    })
    expect(formatMarkdown(result)).not.toContain('✅')
    expect(formatMcpOutput(result)).not.toContain('✅')
  })

  it('does not render a fail-fast run as clean on ANY surface', () => {
    // The sibling test above passed `truncation` and only ever passed `truncation`, which is why
    // it never caught this: `earlyExit` is a third incompleteness state, and both surfaces gated
    // on the other two. A --fail-fast run stops the swarm after agent N and the remaining
    // specialists never run -- but they are absent from agentStatus rather than failed, so
    // `failedAgents.length` is 0 and every gate reads the run as complete.
    const result = makeResult({
      findings: [],
      earlyExit: { stoppedAt: 'security' },
      agentStatus: { coverage: 'ok', correctness: 'ok', security: 'ok' },
      agentsPlanned: 15,
    })
    expect(formatMarkdown(result)).not.toContain('✅')
    expect(formatMcpOutput(result)).not.toContain('✅')
  })

  it('counts agents that were planned, not the ones that started', () => {
    // The trap in the obvious fix. Folding earlyExit into the `incomplete` gate makes the scope
    // string render on every fail-fast run -- and that string derived its denominator from
    // agentStatus, which only holds agents that ran. So the naive fix upgrades a silent omission
    // into an affirmative false claim: "3/3 agents that completed" for a run that skipped twelve.
    // Asserting the absence of 3/3 is what makes this falsifying rather than decorative.
    const result = makeResult({
      findings: [],
      earlyExit: { stoppedAt: 'security' },
      agentStatus: { coverage: 'ok', correctness: 'ok', security: 'ok' },
      agentsPlanned: 15,
    })
    const output = formatMarkdown(result)
    expect(output).toContain('3/15')
    expect(output).not.toContain('3/3')
  })

  it('names the agent the swarm stopped after, so the reader can re-run deliberately', () => {
    const result = makeResult({
      findings: [],
      earlyExit: { stoppedAt: 'security' },
      agentStatus: { security: 'ok' },
      agentsPlanned: 15,
    })
    expect(formatMarkdown(result)).toContain('security')
    expect(formatMarkdown(result)).toMatch(/fail-fast/i)
  })

  it('still reports a complete run as a pass when earlyExit is absent', () => {
    // Guard against over-correction, mirroring the truncation guard below: a run that executed
    // its whole roster must not inherit the incompleteness headline.
    const output = formatMarkdown(
      makeResult({ findings: [], agentStatus: { security: 'ok' }, agentsPlanned: 1 })
    )
    expect(output).toContain('✅ No issues found.')
    expect(output).not.toContain('INCOMPLETE')
  })

  it('still reports an untruncated clean run as a pass', () => {
    // Guard against over-correction: the incompleteness headline must not leak into a genuine
    // full-coverage clean run.
    const output = formatMarkdown(
      makeResult({
        findings: [],
        truncation: { truncated: false, originalLines: 120, keptLines: 120 },
      })
    )
    expect(output).toContain('✅ No issues found.')
    expect(output).not.toContain('INCOMPLETE')
  })

  it('surfaces a hallucination-filter note when findings were dropped', () => {
    const result = makeResult({
      findings: [],
      hallucinationFilter: {
        dropped: [{ agent: 'dependencies', title: 'Wildcard version', file: 'package.json' }],
      },
    })
    const output = formatMarkdown(result)
    expect(output).toContain('1')
    expect(output).toMatch(/hallucinat/i)
    // A drop with no `reason` came from the file-existence filter, so it must still read that way.
    expect(output).toContain('referenced file(s) not present in the reviewed diff')
  })

  it('groups drops by reason instead of labelling them all "file not present"', () => {
    // Regression: this sink has two writers. filterUnsupportedClaims drops findings whose file IS
    // in the diff, so the previous single hardcoded sentence was factually false for every one of
    // them. Asserting only a count and /hallucinat/i passed even when the text was wrong.
    const result = makeResult({
      findings: [],
      hallucinationFilter: {
        dropped: [
          { agent: 'dependencies', title: 'Wildcard version', file: 'package.json' },
          {
            agent: 'security',
            title: 'SQL Injection',
            file: 'db.sql',
            reason: 'unsupported-injection-claim' as const,
          },
          {
            agent: 'error-handling',
            title: 'Swallowed exception',
            file: 'db.sql',
            reason: 'unsupported-exception-claim' as const,
          },
          {
            agent: 'adversarial',
            title: 'Null raises',
            file: 'db.sql',
            reason: 'unsupported-null-error-claim' as const,
          },
        ],
      },
    })
    const output = formatMarkdown(result)
    expect(output).toContain('4 finding(s) dropped')
    expect(output).toContain('1 — referenced file(s) not present in the reviewed diff')
    expect(output).toContain('1 — no dynamic query/command construction in the file')
    expect(output).toContain('1 — no exception-handling construct in the file')
    expect(output).toContain('1 — SQL NULL comparison yields no match, not an error')
  })

  it('collapses same-reason drops into one line with a count', () => {
    const result = makeResult({
      findings: [],
      hallucinationFilter: {
        dropped: [
          {
            agent: 'security',
            title: 'A',
            file: 'a.sql',
            reason: 'unsupported-injection-claim' as const,
          },
          {
            agent: 'adversarial',
            title: 'B',
            file: 'b.sql',
            reason: 'unsupported-injection-claim' as const,
          },
        ],
      },
    })
    const output = formatMarkdown(result)
    expect(output).toContain('2 finding(s) dropped')
    expect(output).toContain('2 — no dynamic query/command construction in the file')
  })

  it('does not show a hallucination-filter note when nothing was dropped', () => {
    const output = formatMarkdown(makeResult())
    expect(output).not.toMatch(/hallucinat/i)
  })

  it('surfaces a coverage-gap-filter note when a gap was dropped', () => {
    const result = makeResult({
      findings: [],
      coverageGapFilter: {
        dropped: [{ file: '../../../../etc/passwd', functionName: 'foo' }],
      },
    })
    const output = formatMarkdown(result)
    expect(output).toContain('1')
    expect(output).toMatch(/coverage gap/i)
  })

  it('does not show a coverage-gap-filter note when nothing was dropped', () => {
    const output = formatMarkdown(makeResult())
    expect(output).not.toMatch(/coverage gap/i)
  })

  it('shows a degraded-mode note when a tool-integrated agent fell back to the LLM', () => {
    const result = makeResult({
      findings: [],
      toolAvailability: { gitleaks: 'unavailable-llm-fallback' },
    })
    const output = formatMarkdown(result)
    expect(output).toMatch(/gitleaks/i)
    expect(output).toMatch(/not installed|fallback|degraded/i)
  })

  it('does not show a degraded-mode note when the tool was used', () => {
    const result = makeResult({
      findings: [],
      toolAvailability: { gitleaks: 'used' },
    })
    const output = formatMarkdown(result)
    expect(output).not.toMatch(/degraded|fallback/i)
  })

  it('does not show a degraded-mode note when toolAvailability is absent', () => {
    const output = formatMarkdown(makeResult())
    expect(output).not.toMatch(/gitleaks|npm.audit|degraded/i)
  })

  it('shows a degraded-mode note mentioning lizard when it fell back to LLM-only', () => {
    const result = makeResult({
      findings: [],
      toolAvailability: { lizard: 'unavailable-llm-fallback' },
    })
    const output = formatMarkdown(result)
    expect(output).toMatch(/lizard/i)
    expect(output).toMatch(/not installed|fallback|degraded/i)
  })

  it('does not show a degraded-mode note when lizard was used', () => {
    const result = makeResult({
      findings: [],
      toolAvailability: { lizard: 'used' },
    })
    const output = formatMarkdown(result)
    expect(output).not.toMatch(/degraded|fallback/i)
  })

  // 'partial' must not render as the degraded note, which says the tool is not installed and tells
  // the reader to install it -- wrong advice when the tool ran and only some files were skipped.
  it('shows a partial-scan note, not a not-installed note, when a tool covered only some files', () => {
    const result = makeResult({
      findings: [],
      toolAvailability: { gitleaks: 'partial' },
    })
    const output = formatMarkdown(result)
    expect(output).toMatch(/partial scan/i)
    expect(output).toMatch(/gitleaks/i)
    expect(output).not.toMatch(/not installed/i)
  })

  it('does not include a not-applicable tool in the degraded-tools warning', () => {
    const result = makeResult({
      findings: [],
      toolAvailability: { npmAudit: 'not-applicable' },
    })
    const output = formatMarkdown(result)
    expect(output).not.toMatch(/degraded/i)
  })

  it('still warns for a genuinely unavailable tool alongside a not-applicable one', () => {
    const result = makeResult({
      findings: [],
      toolAvailability: { npmAudit: 'not-applicable', gitleaks: 'unavailable-llm-fallback' },
    })
    const output = formatMarkdown(result)
    expect(output).toMatch(/degraded/i)
    expect(output).toMatch(/gitleaks/i)
    expect(output).not.toMatch(/npm audit not installed/i)
  })
})

describe('evidenceCheckFilter', () => {
  it('shows checked/flagged/unavailable counts', () => {
    const result = makeResult({
      evidenceCheckFilter: {
        checkedCount: 3,
        unavailableCount: 1,
        unavailableReasons: ['verification unavailable — timeout'],
        flagged: [
          {
            agent: 'security',
            title: 'Test finding',
            file: 'src/a.ts',
            line: 10,
            claim: 'Test finding claim',
            evidence: 'some evidence',
            reason: 'evidence contradicts the claim',
            preFilterAgreed: true,
          },
        ],
      },
    })
    const output = formatMarkdown(result)
    expect(output).toContain('3 finding(s) checked')
    expect(output).toContain('1 flagged')
    expect(output).toContain('1 unavailable')
    expect(output).toContain('evidence contradicts the claim')
    expect(output).toContain('src/a.ts:10')
  })

  it('is omitted entirely when evidenceCheckFilter is absent', () => {
    const output = formatMarkdown(makeResult())
    expect(output).not.toContain('Evidence check')
  })

  it('reports zero flagged findings without listing any', () => {
    const result = makeResult({
      evidenceCheckFilter: {
        checkedCount: 2,
        unavailableCount: 0,
        unavailableReasons: [],
        flagged: [],
      },
    })
    const output = formatMarkdown(result)
    expect(output).toContain('2 finding(s) checked')
    expect(output).toContain('none flagged')
  })
})

describe('location-unverified marker', () => {
  it('marks a finding whose evidence was not found at its cited line', () => {
    const result = makeResult({
      findings: [makeFinding({ locationCheck: 'mismatch' })],
      summary: {
        totalFindings: 1,
        bySeverity: { high: 1 },
        byAgent: { security: 1 },
        durationMs: 1,
      },
    })
    const out = formatMarkdown(result)
    expect(out).toContain('Location unverified')
    // The finding itself must still be reported -- only its line is in doubt.
    expect(out).toContain('Test finding')
    expect(out).toContain('src/auth.ts:42')
  })

  it('stays silent when the location was verified', () => {
    const result = makeResult({
      findings: [makeFinding({ locationCheck: 'verified' })],
      summary: {
        totalFindings: 1,
        bySeverity: { high: 1 },
        byAgent: { security: 1 },
        durationMs: 1,
      },
    })
    expect(formatMarkdown(result)).not.toContain('Location unverified')
  })

  it('stays silent for unknown and for an absent check, which are not failures', () => {
    for (const lc of [undefined, 'unknown'] as const) {
      const result = makeResult({
        findings: [makeFinding({ locationCheck: lc })],
        summary: {
          totalFindings: 1,
          bySeverity: { high: 1 },
          byAgent: { security: 1 },
          durationMs: 1,
        },
      })
      expect(formatMarkdown(result)).not.toContain('Location unverified')
    }
  })
})

describe('formatMarkdown timing', () => {
  const oneRun = {
    timings: [
      {
        diffLines: 900,
        effectiveTimeoutMs: 240000,
        durationMs: 300000,
        agents: [
          {
            name: 'security' as const,
            elapsedMs: 10_000,
            attemptMs: 10_000,
            attempts: 1,
            status: 'ok' as const,
          },
          {
            name: 'performance' as const,
            elapsedMs: 121_300,
            attemptMs: 121_300,
            attempts: 1,
            status: 'ok' as const,
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
    ],
  }

  it('renders the run timing, naming the slowest agent and the ceiling it ran under', () => {
    const md = formatMarkdown(makeResult(oneRun))
    expect(md).toContain(
      '*Timing: 900 diff lines, 3 agents, 300.0s total, ceiling 240.0s/agent, slowest performance 121.3s*'
    )
    expect(md).toContain('Full per-agent timings are in the `--format json` output.')
  })

  // REGRESSION. Under --chunk each row is a separate timeout budget, so an unlabelled list of
  // rows reads as one review reported several times. The label is what makes "run 2 of 9 came
  // close to its ceiling" a statement a reader can make at all.
  it('labels each row with its run number when a chunked review produced several', () => {
    const md = formatMarkdown(
      makeResult({
        timings: [
          { diffLines: 900, effectiveTimeoutMs: 261000, durationMs: 100, agents: [] },
          { diffLines: 1500, effectiveTimeoutMs: 315000, durationMs: 250, agents: [] },
        ],
      })
    )
    expect(md).toContain('*Timing (run 1/2): 900 diff lines')
    expect(md).toContain('*Timing (run 2/2): 1500 diff lines')
    expect(md).not.toContain('*Timing: ')
  })

  // REGRESSION. A timed-out agent's elapsedMs IS the ceiling, so without the explicit label it
  // renders as a completion time that merely happens to sit at the limit -- the exact misreading
  // that lets an unsourced number look like evidence the ceiling is too low.
  it('names the agents that hit the ceiling rather than leaving it to be inferred', () => {
    const md = formatMarkdown(
      makeResult({
        timings: [
          {
            diffLines: 1500,
            effectiveTimeoutMs: 240000,
            durationMs: 600000,
            agents: [
              {
                name: 'security',
                elapsedMs: 240000,
                attemptMs: 240000,
                attempts: 1,
                status: 'timeout',
              },
              { name: 'design', elapsedMs: 5000, attemptMs: 5000, attempts: 1, status: 'ok' },
            ],
          },
        ],
      })
    )
    expect(md).toContain('hit the ceiling: security')
  })

  it('omits the timing block entirely when a result carries no timings', () => {
    expect(formatMarkdown(makeResult({}))).not.toContain('Timing')
  })
})

describe('formatMarkdown timing separator', () => {
  // REGRESSION, and the reason it is asserted on adjacency rather than with toContain: in
  // CommonMark a line of '---' directly beneath a paragraph is a setext heading UNDERLINE, not a
  // thematic break. The timing block used to open with a bare '---', which silently promoted the
  // verdict line to an <h2> and swallowed its own rule. Every existing assertion on that line
  // used toContain, so all of them passed while the rendered output was wrong.
  const rendersRuleNotHeading = (md: string) => {
    const lines = md.split('\n')
    const i = lines.findIndex((l) => l.startsWith('*Timing'))
    expect(i).toBeGreaterThan(0)
    expect(lines[i - 1]).toBe('---')
    // The line before the rule must be blank, or the rule is a heading underline instead.
    expect(lines[i - 2]).toBe('')
  }

  it('does not turn the clean-run verdict into a heading', () => {
    rendersRuleNotHeading(
      formatMarkdown(
        makeResult({
          timings: [{ diffLines: 900, effectiveTimeoutMs: 240000, durationMs: 100, agents: [] }],
        })
      )
    )
  })

  it('does not turn the INCOMPLETE verdict into a heading', () => {
    rendersRuleNotHeading(
      formatMarkdown(
        makeResult({
          truncation: { truncated: true, originalLines: 12599, keptLines: 2000 },
          timings: [{ diffLines: 2000, effectiveTimeoutMs: 240000, durationMs: 100, agents: [] }],
        })
      )
    )
  })

  it('does not turn the sanitizer footer into a heading on the findings path', () => {
    rendersRuleNotHeading(
      formatMarkdown(
        makeResult({
          findings: [makeFinding()],
          sanitizer: { enabled: true, applied: true, redactedLines: 3, warnings: [] },
          timings: [{ diffLines: 900, effectiveTimeoutMs: 240000, durationMs: 100, agents: [] }],
        })
      )
    )
  })
})

describe('earlyExit that cost no coverage', () => {
  // shouldEarlyExit is evaluated after EVERY sequential agent including the last one, so a run can
  // stop "early" having already executed its whole roster. Before this gate, the report said
  // "INCOMPLETE — 0 findings from 3/3 agents that completed" and, two lines later, "the unrun
  // agents' domains were not examined at all" — contradicting itself about a complete review.
  const fullCoverage = {
    findings: [],
    earlyExit: { stoppedAt: 'security' as const },
    agentStatus: { coverage: 'ok' as const, correctness: 'ok' as const, security: 'ok' as const },
    agentsPlanned: 3,
  }

  it('does not call a run incomplete when every planned agent ran', () => {
    const output = formatMarkdown(makeResult(fullCoverage))
    expect(output).not.toContain('INCOMPLETE')
    expect(output).toContain('✅ No issues found.')
  })

  it('does not claim agents never ran when none were skipped', () => {
    expect(formatMarkdown(makeResult(fullCoverage))).not.toMatch(/never ran|not a full review/i)
    expect(formatMcpOutput(makeResult(fullCoverage))).not.toMatch(
      /partial review|were not examined/i
    )
  })

  it('still flags a fail-fast run that did skip agents', () => {
    // Guard on the guard: the fix must not silence the case it was built for.
    const output = formatMarkdown(makeResult({ ...fullCoverage, agentsPlanned: 15 }))
    expect(output).toContain('INCOMPLETE')
    expect(output).toContain('12 of 15 agents never ran')
  })
})

describe('earlyExit on an envelope with no agentsPlanned', () => {
  // agentsPlannedCount falls back to the count that RAN when the field is absent (an archived
  // findings.json, a hand-built fixture). That makes the denominator tautologically equal the
  // numerator, so the report printed "from 3/3 agents that completed" and "the other 0 never ran"
  // directly beside an INCOMPLETE headline — a number claiming full coverage inside a verdict
  // denying it. A missing roster is now reported as missing rather than as agreement.
  const noRoster = {
    findings: [],
    earlyExit: { stoppedAt: 'security' as const },
    agentStatus: { coverage: 'ok' as const, correctness: 'ok' as const, security: 'ok' as const },
  }

  it('states no agent ratio at all rather than a tautological one', () => {
    const output = formatMarkdown(makeResult(noRoster))
    expect(output).toContain('INCOMPLETE')
    expect(output).not.toContain('3/3')
    expect(output).not.toMatch(/other 0 never ran/)
  })

  it('still says the review was incomplete, because unknown is not the same as complete', () => {
    expect(formatMarkdown(makeResult(noRoster))).not.toContain('✅')
  })
})

describe('a partial tool scan says which kind of partial it was', () => {
  // 'partial' has two producers with opposite implications. SecretsAgent sets it when the tool
  // skipped files the LLM still reviewed. chunkRunner sets it when whole chunks were reviewed by
  // nothing at all — and the original wording asserted "nothing was left unscanned" two lines
  // below a banner saying part of the diff was never analyzed.
  it('does not claim the model covered the gap when whole chunks went unreviewed', () => {
    const output = formatMarkdown(
      makeResult({
        findings: [],
        chunking: { total: 9, reviewed: 4 },
        toolAvailability: { gitleaks: 'partial' },
      })
    )
    expect(output).toContain('never analyzed')
    expect(output).not.toContain('nothing was left unscanned')
    expect(output).toContain('neither the tool nor the model')
  })

  it('still says the model covered the gap for an ordinary partial scan', () => {
    // Guard: the SecretsAgent meaning must survive. Reassurance that is true should not be lost
    // just because a second producer needed a different sentence.
    const output = formatMarkdown(
      makeResult({ findings: [], toolAvailability: { gitleaks: 'partial' } })
    )
    expect(output).toContain('nothing was left unscanned')
  })
})
