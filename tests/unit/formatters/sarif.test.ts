import { describe, it, expect } from 'vitest'
import { formatSarif } from '../../../src/cli/formatters/sarif.js'
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

describe('formatSarif', () => {
  it('produces valid SARIF 2.1.0 structure', () => {
    const output = JSON.parse(formatSarif(makeResult()))
    expect(output['$schema']).toContain('sarif-2.1.0')
    expect(output.version).toBe('2.1.0')
    expect(output.runs).toHaveLength(1)
    expect(output.runs[0].tool.driver.name).toBe('ai-review-agent')
  })

  it('produces empty results array for no findings', () => {
    const output = JSON.parse(formatSarif(makeResult()))
    expect(output.runs[0].results).toHaveLength(0)
  })

  it('maps critical/high severity to error level', () => {
    for (const severity of ['critical', 'high'] as const) {
      const result = makeResult({ findings: [makeFinding({ severity })] })
      const output = JSON.parse(formatSarif(result))
      expect(output.runs[0].results[0].level).toBe('error')
    }
  })

  it('maps medium severity to warning level', () => {
    const result = makeResult({ findings: [makeFinding({ severity: 'medium' })] })
    const output = JSON.parse(formatSarif(result))
    expect(output.runs[0].results[0].level).toBe('warning')
  })

  it('maps low severity to note level', () => {
    const result = makeResult({ findings: [makeFinding({ severity: 'low' })] })
    const output = JSON.parse(formatSarif(result))
    expect(output.runs[0].results[0].level).toBe('note')
  })

  it('includes file and line in physicalLocation', () => {
    const result = makeResult({ findings: [makeFinding({ file: 'src/api.ts', line: 10 })] })
    const output = JSON.parse(formatSarif(result))
    const loc = output.runs[0].results[0].locations[0].physicalLocation
    expect(loc.artifactLocation.uri).toBe('src/api.ts')
    expect(loc.region.startLine).toBe(10)
  })

  it('uses ruleId from finding id', () => {
    const result = makeResult({ findings: [makeFinding({ id: 'security-0' })] })
    const output = JSON.parse(formatSarif(result))
    expect(output.runs[0].results[0].ruleId).toBe('security-0')
  })

  it('includes tool version from package.json', () => {
    const output = JSON.parse(formatSarif(makeResult()))
    expect(output.runs[0].tool.driver.version).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('includes multiple findings with distinct rule IDs', () => {
    const result = makeResult({
      findings: [makeFinding({ id: 'sec-1' }), makeFinding({ id: 'sec-2' })],
    })
    const output = JSON.parse(formatSarif(result))
    expect(output.runs[0].results).toHaveLength(2)
    expect(output.runs[0].results[0].ruleId).toBe('sec-1')
    expect(output.runs[0].results[1].ruleId).toBe('sec-2')
  })

  it('includes all properties in result.properties', () => {
    const result = makeResult({
      findings: [
        makeFinding({
          agent: 'security',
          domain: 'Security',
          basis: 'VERIFIED',
          confidence: 95,
          impact: 'Data breach',
          recommendation: 'Fix immediately',
        }),
      ],
    })
    const output = JSON.parse(formatSarif(result))
    const props = output.runs[0].results[0].properties
    expect(props.agent).toBe('security')
    expect(props.domain).toBe('Security')
    expect(props.basis).toBe('VERIFIED')
    expect(props.confidence).toBe(95)
    expect(props.impact).toBe('Data breach')
    expect(props.recommendation).toBe('Fix immediately')
  })

  it('handles lineEnd when present', () => {
    const result = makeResult({
      findings: [makeFinding({ line: 10, lineEnd: 15 })],
    })
    const output = JSON.parse(formatSarif(result))
    const region = output.runs[0].results[0].locations[0].physicalLocation.region
    expect(region.startLine).toBe(10)
    expect(region.endLine).toBe(15)
  })

  it('uses startLine as endLine when lineEnd is not specified', () => {
    const result = makeResult({
      findings: [makeFinding({ line: 42 })],
    })
    const output = JSON.parse(formatSarif(result))
    const region = output.runs[0].results[0].locations[0].physicalLocation.region
    expect(region.startLine).toBe(42)
    expect(region.endLine).toBe(42)
  })

  it('includes agentStatus in run-level properties when present', () => {
    const result = makeResult({ agentStatus: { security: 'timeout' } })
    const sarif = JSON.parse(formatSarif(result))
    expect(sarif.runs[0].properties.agentStatus).toEqual({ security: 'timeout' })
  })

  it('includes truncation in run-level properties when the diff was truncated', () => {
    const result = makeResult({
      truncation: { truncated: true, originalLines: 4188, keptLines: 2000 },
    })
    const sarif = JSON.parse(formatSarif(result))
    expect(sarif.runs[0].properties.truncation).toEqual({
      truncated: true,
      originalLines: 4188,
      keptLines: 2000,
    })
  })

  it('omits truncation from run-level properties when the diff was not truncated', () => {
    const result = makeResult({
      truncation: { truncated: false, originalLines: 100, keptLines: 100 },
    })
    const sarif = JSON.parse(formatSarif(result))
    expect(sarif.runs[0].properties.truncation).toBeUndefined()
  })

  it('includes hallucinationFilter in run-level properties when findings were dropped', () => {
    const result = makeResult({
      hallucinationFilter: {
        dropped: [{ agent: 'dependencies', title: 'Wildcard version', file: 'package.json' }],
      },
    })
    const sarif = JSON.parse(formatSarif(result))
    expect(sarif.runs[0].properties.hallucinationFilter).toEqual({
      dropped: [{ agent: 'dependencies', title: 'Wildcard version', file: 'package.json' }],
    })
  })

  it('omits hallucinationFilter from run-level properties when nothing was dropped', () => {
    const sarif = JSON.parse(formatSarif(makeResult()))
    expect(sarif.runs[0].properties.hallucinationFilter).toBeUndefined()
  })

  it('omits hallucinationFilter from run-level properties when dropped is explicitly empty', () => {
    // Defensive consistency with the markdown formatter's dropped.length > 0 check -- not
    // reachable via runner.ts today (it only ever sets hallucinationFilter when non-empty), but
    // the formatter shouldn't emit a misleading empty block if some future caller populates it.
    const sarif = JSON.parse(formatSarif(makeResult({ hallucinationFilter: { dropped: [] } })))
    expect(sarif.runs[0].properties.hallucinationFilter).toBeUndefined()
  })
})
