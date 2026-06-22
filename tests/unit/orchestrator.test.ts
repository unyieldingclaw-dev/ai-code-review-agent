// tests/unit/orchestrator.test.ts
import { describe, it, expect } from 'vitest'
import { OrchestratorAgent } from '../../src/core/agents/orchestrator.js'
import { DEFAULT_CONFIG } from '../../src/core/config.js'
import type { Finding } from '../../src/core/schema.js'
import { vi } from 'vitest'

const makeProvider = () => ({
  chat: vi.fn(),
  ping: vi.fn().mockResolvedValue({ ok: true })
})

const finding = (overrides: Partial<Finding> = {}): Finding => ({
  id: 'security-0',
  agent: 'security',
  domain: 'Security',
  severity: 'high',
  basis: 'VERIFIED',
  file: 'src/auth.ts',
  line: 10,
  title: 'Test finding',
  detail: 'Detail',
  evidence: 'test evidence',
  impact: 'test impact',
  recommendation: 'Fix it',
  suggestion: 'Fix it',
  blocking: false,
  source: 'llm',
  ...overrides
})

describe('OrchestratorAgent', () => {
  describe('deduplication', () => {
    it('merges duplicate findings from multiple agents into one with corroboratingAgents', () => {
      const orch = new OrchestratorAgent(makeProvider(), DEFAULT_CONFIG)
      const findings = [
        finding({ id: 'security-0', agent: 'security', file: 'src/auth.ts', line: 10, title: 'SQL injection' }),
        finding({ id: 'correctness-0', agent: 'correctness', file: 'src/auth.ts', line: 10, title: 'Null pointer' })
      ]
      const result = orch.synthesize(findings)
      expect(result).toHaveLength(1)
      expect(result[0].agent).toBe('security')
      expect(result[0].corroboratingAgents).toContain('correctness')
    })

    it('removes duplicate findings at same file:line from different agents', () => {
      const orch = new OrchestratorAgent(makeProvider(), DEFAULT_CONFIG)
      const findings = [
        finding({ id: 'security-0', agent: 'security', file: 'src/auth.ts', line: 10, title: 'SQL injection' }),
        finding({ id: 'correctness-0', agent: 'correctness', file: 'src/auth.ts', line: 10, title: 'Null pointer' })
      ]
      const result = orch.synthesize(findings)
      expect(result).toHaveLength(1)
      // Security takes precedence over correctness
      expect(result[0].agent).toBe('security')
    })
  })

  describe('severity escalation', () => {
    it('escalates severity when correctness bug has no test coverage at same location', () => {
      const orch = new OrchestratorAgent(makeProvider(), DEFAULT_CONFIG)
      const findings = [
        finding({ id: 'correctness-0', agent: 'correctness', severity: 'medium', file: 'src/foo.ts', line: 20, title: 'Logic bug' }),
        finding({ id: 'coverage-0', agent: 'coverage', severity: 'medium', file: 'src/foo.ts', line: 20, title: 'No test coverage' })
      ]
      const result = orch.synthesize(findings)
      const corrFinding = result.find(f => f.agent === 'correctness')
      expect(corrFinding?.severity).toBe('high') // escalated from medium
    })
  })

  describe('cap', () => {
    it('limits output to maxFindings sorted by severity', () => {
      const config = { ...DEFAULT_CONFIG, maxFindings: 3 }
      const orch = new OrchestratorAgent(makeProvider(), config)
      const findings = Array.from({ length: 10 }, (_, i) =>
        finding({ id: `security-${i}`, line: i + 1, title: `Finding ${i}`, severity: i < 3 ? 'critical' : 'medium' })
      )
      const result = orch.synthesize(findings)
      expect(result).toHaveLength(3)
      expect(result.every(f => f.severity === 'critical')).toBe(true)
    })
  })

  describe('hallucination cross-check', () => {
    it('downgrades solo Critical to High (not Medium) when confidence < 60', () => {
      const orch = new OrchestratorAgent(makeProvider(), DEFAULT_CONFIG)
      const findings = [
        finding({ id: 'security-0', agent: 'security', severity: 'critical', confidence: 45, file: 'src/foo.ts', line: 5 }),
        finding({ id: 'correctness-0', agent: 'correctness', severity: 'low', file: 'src/bar.ts', line: 99 })
      ]
      const result = orch.synthesize(findings)
      const f = result.find(r => r.id === 'security-0')
      // confidence < 60 → downgraded to high, not medium
      expect(f?.severity).toBe('high')
    })

    it('keeps critical finding when a second agent flags the same file+line region', () => {
      const orch = new OrchestratorAgent(makeProvider(), DEFAULT_CONFIG)
      const findings = [
        finding({ id: 'security-0', agent: 'security', severity: 'critical', file: 'src/foo.ts', line: 10 }),
        finding({ id: 'correctness-0', agent: 'correctness', severity: 'high', file: 'src/foo.ts', line: 12 })
      ]
      const result = orch.synthesize(findings)
      const secFinding = result.find(f => f.agent === 'security')
      expect(secFinding?.severity).toBe('critical')
    })

    it('skips cross-check when only one agent ran', () => {
      const orch = new OrchestratorAgent(makeProvider(), DEFAULT_CONFIG)
      const findings = [
        finding({ id: 'security-0', agent: 'security', severity: 'critical', file: 'src/foo.ts', line: 5 })
      ]
      const result = orch.synthesize(findings)
      const f = result.find(r => r.id === 'security-0')
      expect(f?.severity).toBe('critical')
    })
  })

  describe('publication filter', () => {
    it('excludes SPECULATIVE findings below high severity', () => {
      const orch = new OrchestratorAgent(makeProvider(), DEFAULT_CONFIG)
      const findings = [
        finding({ id: 'security-0', severity: 'medium', basis: 'SPECULATIVE' }),
        finding({ id: 'security-1', severity: 'high', basis: 'SPECULATIVE' }),
        finding({ id: 'security-2', severity: 'medium', basis: 'VERIFIED' })
      ]
      const result = orch.synthesize(findings)
      expect(result.find(f => f.id === 'security-0')).toBeUndefined()
      expect(result.find(f => f.id === 'security-1')).toBeDefined()
      expect(result.find(f => f.id === 'security-2')).toBeDefined()
    })
  })
})
