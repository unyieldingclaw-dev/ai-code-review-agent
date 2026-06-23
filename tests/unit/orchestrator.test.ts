import { describe, it, expect } from 'vitest'
import { OrchestratorAgent } from '../../src/core/agents/orchestrator.js'
import { DEFAULT_CONFIG } from '../../src/core/config.js'
import type { Finding } from '../../src/core/schema.js'

function makeFinding(overrides: Partial<Finding>): Finding {
  return {
    id: 'f1',
    agent: 'secrets',
    domain: 'Secrets',
    severity: 'critical',
    basis: 'VERIFIED',
    file: 'src/api.ts',
    line: 10,
    title: 'Hardcoded API key',
    detail: 'API key hardcoded in source',
    evidence: 'Detected by gitleaks rule generic-api-key',
    impact: 'Credential exposure',
    recommendation: 'Move to environment variable',
    suggestion: 'Move to environment variable',
    blocking: true,
    source: 'gitleaks',
    confidence: 50,
    ...overrides
  }
}

describe('OrchestratorAgent.synthesize — hallucinationCrossCheck', () => {
  const orchestrator = new OrchestratorAgent(null as any, { ...DEFAULT_CONFIG, maxFindings: 50 })

  it('does NOT downgrade a solo Critical finding from a deterministic source (gitleaks)', () => {
    const findings: Finding[] = [
      makeFinding({ source: 'gitleaks', severity: 'critical', confidence: 50, agent: 'secrets' }),
      makeFinding({ id: 'f2', agent: 'security', file: 'src/other.ts', line: 99, source: 'llm', severity: 'low' })
    ]
    const result = orchestrator.synthesize(findings)
    const secretFinding = result.find(f => f.id === 'f1')
    expect(secretFinding?.severity).toBe('critical')
  })

  it('does NOT downgrade a solo High finding from semgrep', () => {
    const findings: Finding[] = [
      makeFinding({ id: 'f1', source: 'semgrep', severity: 'high', confidence: 40, agent: 'security' }),
      makeFinding({ id: 'f2', agent: 'correctness', file: 'src/other.ts', line: 99, source: 'llm', severity: 'low' })
    ]
    const result = orchestrator.synthesize(findings)
    const secFinding = result.find(f => f.id === 'f1')
    expect(secFinding?.severity).toBe('high')
  })

  it('DOES downgrade a solo High finding from llm source with low confidence', () => {
    const findings: Finding[] = [
      makeFinding({ id: 'f1', source: 'llm', severity: 'high', confidence: 40, agent: 'security' }),
      makeFinding({ id: 'f2', agent: 'correctness', file: 'src/other.ts', line: 99, source: 'llm', severity: 'low' })
    ]
    const result = orchestrator.synthesize(findings)
    const secFinding = result.find(f => f.id === 'f1')
    expect(secFinding?.severity).toBe('medium')
  })

  it('does NOT downgrade when a corroborating agent exists regardless of source', () => {
    const findings: Finding[] = [
      makeFinding({ id: 'f1', source: 'llm', severity: 'critical', confidence: 40, agent: 'security', file: 'src/api.ts', line: 10 }),
      makeFinding({ id: 'f2', source: 'llm', severity: 'high', agent: 'adversarial', file: 'src/api.ts', line: 10 })
    ]
    const result = orchestrator.synthesize(findings)
    const criticalFinding = result.find(f => f.id === 'f1')
    expect(criticalFinding?.severity).toBe('critical')
  })
})
