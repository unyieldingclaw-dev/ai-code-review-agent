import { describe, it, expect } from 'vitest'
import { formatGithubAnnotations } from '../../../src/cli/formatters/githubAnnotations.js'
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
    id: 'security-0',
    agent: 'security',
    domain: 'Security',
    severity: 'high',
    basis: 'VERIFIED',
    file: 'src/auth.ts',
    line: 42,
    title: 'Hardcoded secret',
    detail: 'API key is hardcoded',
    evidence: 'const API_KEY = "abc123"',
    impact: 'Credential exposure',
    recommendation: 'Use environment variable',
    suggestion: 'Use environment variable',
    blocking: true,
    source: 'llm',
    confidence: 85,
    ...overrides,
  }
}

describe('formatGithubAnnotations', () => {
  it('returns empty string when there are no findings', () => {
    expect(formatGithubAnnotations(makeResult())).toBe('')
  })

  it('maps critical severity to ::error', () => {
    const output = formatGithubAnnotations(
      makeResult({ findings: [makeFinding({ severity: 'critical' })] })
    )
    expect(output).toMatch(/^::error /)
  })

  it('maps high severity to ::error', () => {
    const output = formatGithubAnnotations(
      makeResult({ findings: [makeFinding({ severity: 'high' })] })
    )
    expect(output).toMatch(/^::error /)
  })

  it('maps medium severity to ::warning', () => {
    const output = formatGithubAnnotations(
      makeResult({ findings: [makeFinding({ severity: 'medium' })] })
    )
    expect(output).toMatch(/^::warning /)
  })

  it('maps low severity to ::notice', () => {
    const output = formatGithubAnnotations(
      makeResult({ findings: [makeFinding({ severity: 'low' })] })
    )
    expect(output).toMatch(/^::notice /)
  })

  it('includes file and line in annotation', () => {
    const output = formatGithubAnnotations(
      makeResult({ findings: [makeFinding({ file: 'src/api.ts', line: 42 })] })
    )
    expect(output).toContain('file=src/api.ts')
    expect(output).toContain('line=42')
  })

  it('includes title in annotation properties', () => {
    const output = formatGithubAnnotations(
      makeResult({ findings: [makeFinding({ title: 'SQL injection risk' })] })
    )
    expect(output).toContain('SQL injection risk')
  })

  it('uses recommendation as message text', () => {
    const output = formatGithubAnnotations(
      makeResult({ findings: [makeFinding({ recommendation: 'Use parameterized queries' })] })
    )
    expect(output).toContain('Use parameterized queries')
  })

  it('falls back to detail when recommendation is empty', () => {
    const output = formatGithubAnnotations(
      makeResult({
        findings: [
          makeFinding({
            recommendation: '',
            detail: 'This is the detail text',
          }),
        ],
      })
    )
    expect(output).toContain('This is the detail text')
  })

  it('produces one line per finding', () => {
    const result = makeResult({
      findings: [makeFinding({ file: 'src/a.ts' }), makeFinding({ file: 'src/b.ts' })],
    })
    const output = formatGithubAnnotations(result)
    expect(output.split('\n')).toHaveLength(2)
  })

  it('escapes newlines in title and message', () => {
    const output = formatGithubAnnotations(
      makeResult({
        findings: [
          makeFinding({
            title: 'line1\nline2',
            recommendation: 'fix\nthis',
          }),
        ],
      })
    )
    expect(output).not.toContain('\n\n')
    expect(output.split('\n')).toHaveLength(1)
  })

  it('escapes percent signs to prevent injection', () => {
    const output = formatGithubAnnotations(
      makeResult({
        findings: [makeFinding({ title: '100% safe', recommendation: 'apply 50% fix' })],
      })
    )
    expect(output).toContain('%25')
  })

  it('escapes colons in title and message', () => {
    const output = formatGithubAnnotations(
      makeResult({
        findings: [makeFinding({ title: 'Error: failed', recommendation: 'Fix: do this' })],
      })
    )
    // Colons should be escaped as %3A in the properties
    expect(output).toContain('title=Error%3A')
  })

  it('includes endLine when present', () => {
    const output = formatGithubAnnotations(
      makeResult({
        findings: [makeFinding({ line: 10, lineEnd: 15 })],
      })
    )
    expect(output).toContain('line=10')
    expect(output).toContain('endLine=15')
  })

  it('omits endLine when not specified', () => {
    const output = formatGithubAnnotations(
      makeResult({
        findings: [makeFinding({ line: 42, lineEnd: undefined })],
      })
    )
    expect(output).toContain('line=42')
    expect(output).not.toContain('endLine')
  })

  it('formats annotation with correct structure', () => {
    const output = formatGithubAnnotations(
      makeResult({
        findings: [
          makeFinding({
            severity: 'high',
            file: 'src/api.ts',
            line: 25,
            title: 'Test finding',
            recommendation: 'Fix it',
          }),
        ],
      })
    )
    expect(output).toMatch(/^::error file=src\/api\.ts,line=25,title=Test finding::/)
  })

  it('handles multiple findings with different severities', () => {
    const result = makeResult({
      findings: [
        makeFinding({ severity: 'critical', file: 'src/a.ts', line: 1 }),
        makeFinding({ severity: 'high', file: 'src/b.ts', line: 2 }),
        makeFinding({ severity: 'medium', file: 'src/c.ts', line: 3 }),
        makeFinding({ severity: 'low', file: 'src/d.ts', line: 4 }),
      ],
    })
    const lines = formatGithubAnnotations(result).split('\n')
    expect(lines).toHaveLength(4)
    expect(lines[0]).toMatch(/^::error /)
    expect(lines[1]).toMatch(/^::error /)
    expect(lines[2]).toMatch(/^::warning /)
    expect(lines[3]).toMatch(/^::notice /)
  })

  it('escapes newlines as %0A', () => {
    const output = formatGithubAnnotations(
      makeResult({
        findings: [makeFinding({ title: 'Line 1\nLine 2' })],
      })
    )
    expect(output).toContain('Line 1%0ALine 2')
  })

  it('escapes carriage returns as %0D', () => {
    const output = formatGithubAnnotations(
      makeResult({
        findings: [makeFinding({ title: 'Text\rWith\rCR' })],
      })
    )
    expect(output).toContain('Text%0DWith%0DCR')
  })

  it('emits a warning annotation when any agent failed, even with zero findings', () => {
    const result = makeResult({ findings: [], agentStatus: { security: 'timeout' } })
    const output = formatGithubAnnotations(result)
    expect(output).toContain('::warning')
    expect(output).toContain('security')
  })

  it('emits nothing when there are no findings and no agent failures', () => {
    const result = makeResult({ findings: [], agentStatus: { security: 'ok' } })
    expect(formatGithubAnnotations(result)).toBe('')
  })

  it('emits a warning annotation when the diff was truncated, even with zero findings', () => {
    const result = makeResult({
      findings: [],
      truncation: { truncated: true, originalLines: 4188, keptLines: 2000 },
    })
    const output = formatGithubAnnotations(result)
    expect(output).toContain('::warning')
    expect(output).toContain('2000')
    expect(output).toContain('4188')
  })

  it('emits nothing when there are no findings and the diff was not truncated', () => {
    const result = makeResult({
      findings: [],
      truncation: { truncated: false, originalLines: 100, keptLines: 100 },
    })
    expect(formatGithubAnnotations(result)).toBe('')
  })
})

describe('location-unverified findings', () => {
  // WHY the line is kept rather than omitted: `line` defaults to 1 when absent, so omitting it
  // repins the annotation to line 1 instead of detaching it -- and line 1 is usually outside the
  // diff, where GitHub will not render the annotation inline at all.
  it('keeps the cited line so the annotation still renders inside the diff', () => {
    const result = makeResult({
      findings: [makeFinding({ locationCheck: 'mismatch', line: 42, lineEnd: 44 })],
    })
    const out = formatGithubAnnotations(result)
    expect(out).toContain('line=42')
    expect(out).toContain('endLine=44')
  })

  it('warns in the message, leading with the caveat so clipping cannot hide it', () => {
    const result = makeResult({ findings: [makeFinding({ locationCheck: 'mismatch' })] })
    const out = formatGithubAnnotations(result)
    const body = out.slice(out.indexOf('::', 2) + 2)
    expect(body.startsWith('[Location unverified')).toBe(true)
    // The finding is warned about, never dropped.
    expect(out.split('\n').filter((l) => l.startsWith('::error'))).toHaveLength(1)
  })

  // Finding-3 style check: pin the whole annotation, not just fragments of it, so a structurally
  // malformed command cannot pass on substring matches alone.
  it('emits a well-formed annotation with properties in the documented order', () => {
    const result = makeResult({
      findings: [
        makeFinding({
          locationCheck: 'mismatch',
          line: 42,
          title: 'Hardcoded secret',
          recommendation: 'Use env var',
        }),
      ],
    })
    expect(formatGithubAnnotations(result)).toBe(
      '::error file=src/auth.ts,line=42,title=Hardcoded secret::' +
        '[Location unverified — the quoted evidence was not found at this line; ' +
        'treat the line number as unreliable.] Use env var'
    )
  })

  it('leaves a verified finding completely untouched', () => {
    const result = makeResult({
      findings: [
        makeFinding({
          locationCheck: 'verified',
          line: 42,
          title: 'Hardcoded secret',
          recommendation: 'Use env var',
        }),
      ],
    })
    expect(formatGithubAnnotations(result)).toBe(
      '::error file=src/auth.ts,line=42,title=Hardcoded secret::Use env var'
    )
  })

  it('adds no caveat when the check did not run or had no opinion', () => {
    for (const lc of [undefined, 'unknown'] as const) {
      const result = makeResult({ findings: [makeFinding({ locationCheck: lc, line: 42 })] })
      const out = formatGithubAnnotations(result)
      expect(out).toContain('line=42')
      expect(out).not.toContain('Location unverified')
    }
  })
})

// GUARD, not a regression test -- it passes against the pre-change code and is counted as
// neither. It pins a deliberate exclusion: timings is the one ReviewResult field intentionally
// absent from this surface (see the comment above formatGithubAnnotations for the three reasons).
// Without it, a later reader applying the "every field reaches all four formatters" rule would
// read the absence as the oversight that rule exists to catch, and "fix" it.
describe('formatGithubAnnotations timing', () => {
  it('deliberately emits no timing annotation, leaving the actionable half to agentStatus', () => {
    const out = formatGithubAnnotations(
      makeResult({
        agentStatus: { security: 'timeout' },
        timings: [
          {
            diffLines: 900,
            effectiveTimeoutMs: 240000,
            durationMs: 300000,
            agents: [
              {
                name: 'security',
                elapsedMs: 240000,
                attemptMs: 240000,
                attempts: 1,
                status: 'timeout',
              },
            ],
          },
        ],
      })
    )
    expect(out).not.toMatch(/timing/i)
    expect(out).not.toContain('900')
    expect(out).not.toContain('ceiling')
    // The part a PR reviewer can act on is already here, which is why the rest is not.
    expect(out).toContain('::warning::Agent security failed (timeout)')
  })
})

describe('formatGithubAnnotations — earlyExit', () => {
  it('emits a warning naming the agent and how many never ran', () => {
    const out = formatGithubAnnotations(
      makeResult({
        earlyExit: { stoppedAt: 'security' },
        agentStatus: { coverage: 'ok', correctness: 'ok', security: 'ok' },
        agentsPlanned: 15,
      })
    )
    expect(out).toContain('::warning::')
    expect(out).toContain('security')
    expect(out).toContain('12 of 15 agents never ran')
  })

  it('puts the incompleteness warning before the finding annotations', () => {
    // Ordering is the whole point on this surface: GitHub renders annotations in emission order,
    // and a caveat after fifteen findings is a caveat nobody scrolls to.
    const out = formatGithubAnnotations(
      makeResult({
        findings: [makeFinding()],
        earlyExit: { stoppedAt: 'security' },
        agentsPlanned: 15,
      })
    )
    const lines = out.split('\n')
    expect(lines[0]).toContain('Fail-fast')
    expect(lines[lines.length - 1]).toContain('file=src/auth.ts')
  })

  it('says nothing when the run completed', () => {
    // Guard: this surface is per-PR review comments, so a spurious warning is charged to every
    // reader of every PR.
    const out = formatGithubAnnotations(makeResult({ agentStatus: { security: 'ok' } }))
    expect(out).not.toContain('Fail-fast')
  })
})
