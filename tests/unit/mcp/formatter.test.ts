import { describe, it, expect } from 'vitest'
import { formatMcpOutput } from '../../../src/mcp/formatter.js'
import type { ReviewResult } from '../../../src/core/schema.js'

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

function makeFinding(severity: 'critical' | 'high' | 'medium' | 'low', overrides = {}) {
  return {
    id: 'f1',
    agent: 'security' as const,
    severity,
    basis: 'VERIFIED' as const,
    file: 'src/auth.ts',
    line: 42,
    title: 'Test finding',
    detail: 'Detailed description',
    suggestion: 'Fix it this way',
    ...overrides,
  }
}

describe('formatMcpOutput', () => {
  it('returns no-findings message when findings is empty', () => {
    const result = formatMcpOutput(makeResult())
    expect(result).toContain('✅ No findings')
  })

  it('returns no-critical/high message when only medium/low exist', () => {
    const result = formatMcpOutput(makeResult({
      findings: [makeFinding('medium'), makeFinding('low')],
      summary: { totalFindings: 2, bySeverity: { medium: 1, low: 1 }, byAgent: {}, durationMs: 100 }
    }))
    expect(result).toContain('✅ No critical or high findings')
    expect(result).toContain('1 medium')
    expect(result).toContain('1 low')
  })

  it('renders critical finding with 🔴 icon and full detail', () => {
    const finding = makeFinding('critical', {
      id: 'f1', agent: 'security', file: 'src/auth.ts', line: 42,
      title: 'Hardcoded secret', detail: 'Key is embedded in source.', suggestion: 'Use env var.'
    })
    const result = formatMcpOutput(makeResult({
      findings: [finding],
      summary: { totalFindings: 1, bySeverity: { critical: 1 }, byAgent: { security: 1 }, durationMs: 100 }
    }))
    expect(result).toContain('🔴')
    expect(result).toContain('CRITICAL')
    expect(result).toContain('security')
    expect(result).toContain('src/auth.ts:42')
    expect(result).toContain('Hardcoded secret')
    expect(result).toContain('Key is embedded in source.')
    expect(result).toContain('Use env var.')
  })

  it('renders high finding with 🟠 icon', () => {
    const finding = makeFinding('high')
    const result = formatMcpOutput(makeResult({
      findings: [finding],
      summary: { totalFindings: 1, bySeverity: { high: 1 }, byAgent: {}, durationMs: 100 }
    }))
    expect(result).toContain('🟠')
    expect(result).toContain('HIGH')
  })

  it('shows medium/low count tail when both exist', () => {
    const findings = [
      makeFinding('critical'), makeFinding('medium'), makeFinding('medium'), makeFinding('low')
    ]
    const result = formatMcpOutput(makeResult({
      findings,
      summary: { totalFindings: 4, bySeverity: { critical: 1, medium: 2, low: 1 }, byAgent: {}, durationMs: 100 }
    }))
    expect(result).toContain('2 medium')
    expect(result).toContain('1 low')
    expect(result).toContain('ai-review-agent')
  })

  it('omits tail when no medium/low findings', () => {
    const finding = makeFinding('critical')
    const result = formatMcpOutput(makeResult({
      findings: [finding],
      summary: { totalFindings: 1, bySeverity: { critical: 1 }, byAgent: {}, durationMs: 100 }
    }))
    expect(result).not.toContain('medium')
    expect(result).not.toContain('low')
    expect(result).not.toContain('ai-review-agent')
  })

  it('header shows count of critical+high only', () => {
    const findings = [makeFinding('critical'), makeFinding('high'), makeFinding('medium')]
    const result = formatMcpOutput(makeResult({
      findings,
      summary: { totalFindings: 3, bySeverity: { critical: 1, high: 1, medium: 1 }, byAgent: {}, durationMs: 100 }
    }))
    expect(result).toContain('2 findings')
  })
})
