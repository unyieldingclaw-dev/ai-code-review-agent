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

describe('formatMarkdown policy notes', () => {
  // docs/a.md is withheld from both agents: two entries, one distinct file.
  const narrowed: Partial<ReviewResult> = {
    filteredFiles: { security: ['docs/a.md'], adversarial: ['docs/a.md', 'docs/b.md'] },
  }

  // THE defect this change exists for. A run whose agents were handed a reduced diff and then
  // found nothing returns through the no-findings early path, which rendered no policy note at
  // all -- so the least-covered runs were exactly the ones that reported clean.
  it('names the narrowed agents on the no-findings path', () => {
    const out = formatMarkdown(makeResult(narrowed))
    expect(out).toContain('No issues found')
    expect(out).toContain('reviewed a reduced diff')
    expect(out).toContain('adversarial, security')
  })

  it('names the narrowed agents on the findings path', () => {
    const out = formatMarkdown(
      makeResult({
        ...narrowed,
        findings: [makeFinding()],
        summary: { totalFindings: 1, bySeverity: { high: 1 }, byAgent: {}, durationMs: 100 },
      })
    )
    expect(out).toContain('reviewed a reduced diff')
  })

  it('counts each withheld file once across agents', () => {
    expect(formatMarkdown(makeResult(narrowed))).toContain('2 files withheld')
  })

  it('uses the singular for a single withheld file', () => {
    const out = formatMarkdown(makeResult({ filteredFiles: { security: ['docs/a.md'] } }))
    expect(out).toContain('1 file withheld')
    expect(out).not.toContain('1 files withheld')
  })

  it('still reports agents skipped outright', () => {
    const out = formatMarkdown(makeResult({ policy: { agentsSkipped: ['security'], reason: {} } }))
    expect(out).toContain('security skipped by agentPolicy rules')
  })

  it('reports a skip and a narrowing together', () => {
    const out = formatMarkdown(
      makeResult({ ...narrowed, policy: { agentsSkipped: ['license'], reason: {} } })
    )
    expect(out).toContain('license skipped by agentPolicy rules')
    expect(out).toContain('reviewed a reduced diff')
  })

  it('emits no policy block when nothing was skipped or narrowed', () => {
    expect(formatMarkdown(makeResult())).not.toContain('*Policy:')
  })

  it('ignores an agent whose withheld list is empty', () => {
    expect(formatMarkdown(makeResult({ filteredFiles: { security: [] } }))).not.toContain(
      '*Policy:'
    )
  })

  // Deliberate, and the reason is in buildPolicyLines: the exclusion is configured and the agents
  // did run. Gating the headline on it would fire on nearly every mixed diff and train the reader
  // past the banner that matters.
  it('does not flip the headline to INCOMPLETE', () => {
    expect(formatMarkdown(makeResult(narrowed))).not.toContain('INCOMPLETE')
  })
})

describe('formatMarkdown policy separator', () => {
  // REGRESSION, asserted on ADJACENCY rather than with toContain, for the reason the timing
  // separator block above records: in CommonMark a '---' directly beneath a paragraph is a setext
  // heading underline, not a thematic break. Every policy-note assertion in this file uses
  // toContain, and every one of them passed while the rendered output promoted the verdict line to
  // an <h2> and swallowed its own rule. Adjacency is the only assertion that catches it.
  const rendersRuleNotHeading = (md: string) => {
    const lines = md.split('\n')
    const i = lines.findIndex((l) => l.startsWith('*Policy'))
    expect(i).toBeGreaterThan(0)
    expect(lines[i - 1]).toBe('---')
    expect(lines[i - 2]).toBe('')
  }

  it('does not turn the clean-run verdict into a heading', () => {
    rendersRuleNotHeading(
      formatMarkdown(makeResult({ filteredFiles: { security: ['docs/a.md'] } }))
    )
  })

  it('does not turn the INCOMPLETE verdict into a heading', () => {
    rendersRuleNotHeading(
      formatMarkdown(
        makeResult({
          truncation: { truncated: true, originalLines: 12599, keptLines: 2000 },
          filteredFiles: { security: ['docs/a.md'] },
        })
      )
    )
  })

  it('does not turn the last footer into a heading on the findings path', () => {
    rendersRuleNotHeading(
      formatMarkdown(
        makeResult({
          findings: [makeFinding()],
          summary: { totalFindings: 1, bySeverity: { high: 1 }, byAgent: {}, durationMs: 100 },
          policy: { agentsSkipped: ['license'], reason: {} },
        })
      )
    )
  })
})
