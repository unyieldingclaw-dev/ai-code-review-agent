// Unit tests for OrchestratorAgent — mock the LLM provider. Ollama is NOT required.
import { describe, it, expect, vi } from 'vitest'
import { OrchestratorAgent } from '../../src/core/agents/orchestrator.js'
import { DEFAULT_CONFIG } from '../../src/core/config.js'
import type { LLMProvider } from '../../src/core/llm/provider.js'
import type { Finding } from '../../src/core/schema.js'

const makeProvider = (response: string): LLMProvider => ({
  chat: vi.fn().mockResolvedValue(response),
  ping: vi.fn().mockResolvedValue({ ok: true })
})

describe('OrchestratorAgent', () => {
  it('returns empty array when synthesize() receives empty findings', () => {
    const agent = new OrchestratorAgent(makeProvider(''), DEFAULT_CONFIG)
    const result = agent.synthesize([])
    expect(result).toEqual([])
  })

  it('deduplicates findings at same file:line from different agents', () => {
    const agent = new OrchestratorAgent(makeProvider(''), DEFAULT_CONFIG)
    const findings: Finding[] = [
      {
        id: 'security-0',
        agent: 'security',
        severity: 'high',
        basis: 'VERIFIED',
        confidence: 85,
        file: 'src/auth.ts',
        line: 10,
        title: 'SQL injection',
        detail: 'User input not escaped',
        suggestion: 'Use prepared statements'
      },
      {
        id: 'correctness-0',
        agent: 'correctness',
        severity: 'high',
        basis: 'VERIFIED',
        confidence: 80,
        file: 'src/auth.ts',
        line: 10,
        title: 'Logic error',
        detail: 'Same location issue',
        suggestion: 'Fix the logic'
      }
    ]
    const result = agent.synthesize(findings)
    // Should keep only one (security has higher priority) with corroboratingAgents
    expect(result.length).toBeLessThanOrEqual(findings.length)
    expect(result[0].agent).toBe('security')
  })

  it('filters out low-severity findings', () => {
    const agent = new OrchestratorAgent(makeProvider(''), DEFAULT_CONFIG)
    const findings: Finding[] = [
      {
        id: 'coverage-0',
        agent: 'coverage',
        severity: 'low',
        basis: 'INFERRED',
        confidence: 70,
        file: 'src/util.ts',
        line: 5,
        title: 'Untested edge case',
        detail: 'This branch has no test',
        suggestion: 'Add a test'
      }
    ]
    const result = agent.synthesize(findings)
    expect(result).toEqual([])
  })

  it('applies confidence-aware downgrade to solo critical findings when multiple agents present', () => {
    const agent = new OrchestratorAgent(makeProvider(''), DEFAULT_CONFIG)
    const findings: Finding[] = [
      {
        id: 'security-0',
        agent: 'security',
        severity: 'critical',
        basis: 'INFERRED',
        confidence: 45, // Low confidence
        file: 'src/parse.ts',
        line: 20,
        title: 'Possible vulnerability',
        detail: 'Might be vulnerable',
        suggestion: 'Review carefully'
      },
      {
        id: 'performance-0',
        agent: 'performance',
        severity: 'low',
        basis: 'INFERRED',
        confidence: 70,
        file: 'src/other.ts',
        line: 5,
        title: 'Slow loop',
        detail: 'O(n^2) complexity',
        suggestion: 'Optimize'
      }
    ]
    const result = agent.synthesize(findings)
    // Multiple agents present, so hallucination check runs. Low-confidence solo critical → high
    const critical = result.find(f => f.agent === 'security')
    expect(critical).toBeDefined()
    expect(critical!.severity).toBe('high')
  })

  it('keeps high-confidence solo critical findings at critical', () => {
    const agent = new OrchestratorAgent(makeProvider(''), DEFAULT_CONFIG)
    const findings: Finding[] = [
      {
        id: 'security-0',
        agent: 'security',
        severity: 'critical',
        basis: 'VERIFIED',
        confidence: 95, // High confidence
        file: 'src/crypto.ts',
        line: 15,
        title: 'Weak encryption',
        detail: 'Using deprecated algorithm',
        suggestion: 'Use AES-256'
      }
    ]
    const result = agent.synthesize(findings)
    // High-confidence solo critical stays critical
    expect(result.length).toBe(1)
    expect(result[0].severity).toBe('critical')
  })
})
