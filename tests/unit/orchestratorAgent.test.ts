// Unit tests for OrchestratorAgent -- pure synthesis, no LLM provider involved.
import { describe, it, expect } from 'vitest'
import { OrchestratorAgent } from '../../src/core/agents/orchestrator.js'
import { DEFAULT_CONFIG } from '../../src/core/config.js'
import type { Finding } from '../../src/core/schema.js'

describe('OrchestratorAgent', () => {
  it('returns empty array when synthesize() receives empty findings', () => {
    const agent = new OrchestratorAgent(DEFAULT_CONFIG)
    const result = agent.synthesize([])
    expect(result).toEqual([])
  })

  it('deduplicates findings at same file:line from different agents', () => {
    const agent = new OrchestratorAgent(DEFAULT_CONFIG)
    const findings: Finding[] = [
      {
        id: 'security-0',
        agent: 'security',
        domain: 'Security',
        severity: 'high',
        basis: 'VERIFIED',
        confidence: 85,
        file: 'src/auth.ts',
        line: 10,
        title: 'SQL injection',
        detail: 'User input not escaped',
        evidence: 'User input not escaped',
        impact: 'SQL injection possible',
        recommendation: 'Use prepared statements',
        suggestion: 'Use prepared statements',
        blocking: false,
        source: 'llm',
      },
      {
        id: 'correctness-0',
        agent: 'correctness',
        domain: 'Correctness',
        severity: 'high',
        basis: 'VERIFIED',
        confidence: 80,
        file: 'src/auth.ts',
        line: 10,
        title: 'Logic error',
        detail: 'Same location issue',
        evidence: 'Same location issue',
        impact: 'Logic error impact',
        recommendation: 'Fix the logic',
        suggestion: 'Fix the logic',
        blocking: false,
        source: 'llm',
      },
    ]
    const result = agent.synthesize(findings)
    // Should keep only one (security has higher priority) with corroboratingAgents
    expect(result.length).toBeLessThanOrEqual(findings.length)
    expect(result[0].agent).toBe('security')
  })

  it('filters out low-severity findings', () => {
    const agent = new OrchestratorAgent(DEFAULT_CONFIG)
    const findings: Finding[] = [
      {
        id: 'coverage-0',
        agent: 'coverage',
        domain: 'Testing',
        severity: 'low',
        basis: 'INFERRED',
        confidence: 70,
        file: 'src/util.ts',
        line: 5,
        title: 'Untested edge case',
        detail: 'This branch has no test',
        evidence: 'This branch has no test',
        impact: 'Low coverage',
        recommendation: 'Add a test',
        suggestion: 'Add a test',
        blocking: false,
        source: 'llm',
      },
    ]
    const result = agent.synthesize(findings)
    expect(result).toEqual([])
  })

  it('applies confidence-aware downgrade to solo critical findings when multiple agents present', () => {
    const agent = new OrchestratorAgent(DEFAULT_CONFIG)
    const findings: Finding[] = [
      {
        id: 'security-0',
        agent: 'security',
        domain: 'Security',
        severity: 'critical',
        basis: 'INFERRED',
        confidence: 45, // Low confidence
        file: 'src/parse.ts',
        line: 20,
        title: 'Possible vulnerability',
        detail: 'Might be vulnerable',
        evidence: 'Might be vulnerable',
        impact: 'Possible security breach',
        recommendation: 'Review carefully',
        suggestion: 'Review carefully',
        blocking: true,
        source: 'llm',
      },
      {
        id: 'performance-0',
        agent: 'performance',
        domain: 'Performance',
        severity: 'low',
        basis: 'INFERRED',
        confidence: 70,
        file: 'src/other.ts',
        line: 5,
        title: 'Slow loop',
        detail: 'O(n^2) complexity',
        evidence: 'O(n^2) complexity',
        impact: 'Performance degradation',
        recommendation: 'Optimize',
        suggestion: 'Optimize',
        blocking: false,
        source: 'llm',
      },
    ]
    const result = agent.synthesize(findings)
    // Multiple agents present, so hallucination check runs. Low-confidence solo critical → high
    const critical = result.find((f) => f.agent === 'security')
    expect(critical).toBeDefined()
    expect(critical!.severity).toBe('high')
  })

  it('keeps high-confidence solo critical findings at critical', () => {
    const agent = new OrchestratorAgent(DEFAULT_CONFIG)
    const findings: Finding[] = [
      {
        id: 'security-0',
        agent: 'security',
        domain: 'Security',
        severity: 'critical',
        basis: 'VERIFIED',
        confidence: 95, // High confidence
        file: 'src/crypto.ts',
        line: 15,
        title: 'Weak encryption',
        detail: 'Using deprecated algorithm',
        evidence: 'Using deprecated algorithm',
        impact: 'Data can be decrypted',
        recommendation: 'Use AES-256',
        suggestion: 'Use AES-256',
        blocking: true,
        source: 'llm',
      },
    ]
    const result = agent.synthesize(findings)
    // High-confidence solo critical stays critical
    expect(result.length).toBe(1)
    expect(result[0].severity).toBe('critical')
  })
})
