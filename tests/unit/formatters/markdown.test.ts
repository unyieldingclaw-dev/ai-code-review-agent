import { describe, it, expect } from 'vitest'
import { formatMarkdown } from '../../../src/cli/formatter.js'
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
  })

  it('does not show a hallucination-filter note when nothing was dropped', () => {
    const output = formatMarkdown(makeResult())
    expect(output).not.toMatch(/hallucinat/i)
  })
})
