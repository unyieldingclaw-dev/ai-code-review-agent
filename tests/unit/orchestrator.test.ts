// tests/unit/orchestrator.test.ts
import { describe, it, expect } from 'vitest'
import { OrchestratorAgent } from '../../src/core/agents/orchestrator.js'
import { DEFAULT_CONFIG } from '../../src/core/config.js'
import type { Finding } from '../../src/core/schema.js'
import type { LLMProvider } from '../../src/core/llm/provider.js'
import { vi } from 'vitest'

const makeProvider = () => ({
  chat: vi.fn(),
  ping: vi.fn().mockResolvedValue({ ok: true }),
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
  ...overrides,
})

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
    ...overrides,
  }
}

describe('OrchestratorAgent', () => {
  describe('deduplication', () => {
    it('merges duplicate findings from multiple agents into one with corroboratingAgents', () => {
      const orch = new OrchestratorAgent(makeProvider(), DEFAULT_CONFIG)
      const findings = [
        finding({
          id: 'security-0',
          agent: 'security',
          file: 'src/auth.ts',
          line: 10,
          title: 'SQL injection',
        }),
        finding({
          id: 'correctness-0',
          agent: 'correctness',
          file: 'src/auth.ts',
          line: 10,
          title: 'Null pointer',
        }),
      ]
      const result = orch.synthesize(findings)
      expect(result).toHaveLength(1)
      expect(result[0].agent).toBe('security')
      expect(result[0].corroboratingAgents).toContain('correctness')
    })

    it('removes duplicate findings at same file:line from different agents', () => {
      const orch = new OrchestratorAgent(makeProvider(), DEFAULT_CONFIG)
      const findings = [
        finding({
          id: 'security-0',
          agent: 'security',
          file: 'src/auth.ts',
          line: 10,
          title: 'SQL injection',
        }),
        finding({
          id: 'correctness-0',
          agent: 'correctness',
          file: 'src/auth.ts',
          line: 10,
          title: 'Null pointer',
        }),
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
        finding({
          id: 'correctness-0',
          agent: 'correctness',
          severity: 'medium',
          file: 'src/foo.ts',
          line: 20,
          title: 'Logic bug',
        }),
        finding({
          id: 'coverage-0',
          agent: 'coverage',
          severity: 'medium',
          file: 'src/foo.ts',
          line: 20,
          title: 'No test coverage',
        }),
      ]
      const result = orch.synthesize(findings)
      const corrFinding = result.find((f) => f.agent === 'correctness')
      expect(corrFinding?.severity).toBe('high') // escalated from medium
    })
  })

  describe('cap', () => {
    it('limits output to maxFindings sorted by severity', () => {
      const config = { ...DEFAULT_CONFIG, maxFindings: 3 }
      const orch = new OrchestratorAgent(makeProvider(), config)
      const findings = Array.from({ length: 10 }, (_, i) =>
        finding({
          id: `security-${i}`,
          line: i + 1,
          title: `Finding ${i}`,
          severity: i < 3 ? 'critical' : 'medium',
        })
      )
      const result = orch.synthesize(findings)
      expect(result).toHaveLength(3)
      expect(result.every((f) => f.severity === 'critical')).toBe(true)
    })
  })

  describe('hallucination cross-check', () => {
    it('downgrades solo Critical to High (not Medium) when confidence < 60', () => {
      const orch = new OrchestratorAgent(makeProvider(), DEFAULT_CONFIG)
      const findings = [
        finding({
          id: 'security-0',
          agent: 'security',
          severity: 'critical',
          confidence: 45,
          file: 'src/foo.ts',
          line: 5,
        }),
        finding({
          id: 'correctness-0',
          agent: 'correctness',
          severity: 'low',
          file: 'src/bar.ts',
          line: 99,
        }),
      ]
      const result = orch.synthesize(findings)
      const f = result.find((r) => r.id === 'security-0')
      // confidence < 60 → downgraded to high, not medium
      expect(f?.severity).toBe('high')
    })

    it('keeps critical finding when a second agent flags the same file+line region', () => {
      const orch = new OrchestratorAgent(makeProvider(), DEFAULT_CONFIG)
      const findings = [
        finding({
          id: 'security-0',
          agent: 'security',
          severity: 'critical',
          file: 'src/foo.ts',
          line: 10,
        }),
        finding({
          id: 'correctness-0',
          agent: 'correctness',
          severity: 'high',
          file: 'src/foo.ts',
          line: 12,
        }),
      ]
      const result = orch.synthesize(findings)
      const secFinding = result.find((f) => f.agent === 'security')
      expect(secFinding?.severity).toBe('critical')
    })

    it('skips cross-check when only one agent ran', () => {
      const orch = new OrchestratorAgent(makeProvider(), DEFAULT_CONFIG)
      const findings = [
        finding({
          id: 'security-0',
          agent: 'security',
          severity: 'critical',
          file: 'src/foo.ts',
          line: 5,
        }),
      ]
      const result = orch.synthesize(findings)
      const f = result.find((r) => r.id === 'security-0')
      expect(f?.severity).toBe('critical')
    })
  })

  describe('file-existence filter (hallucination defense)', () => {
    it('drops a finding whose file is not in the diff’s changed files', () => {
      const orch = new OrchestratorAgent(makeProvider(), DEFAULT_CONFIG)
      const findings = [
        finding({ id: 'dependencies-0', agent: 'dependencies', file: 'package.json' }),
      ]
      const result = orch.synthesize(findings, ['src/other.ts'])
      expect(result).toHaveLength(0)
    })

    it('keeps a finding whose file is in the diff’s changed files', () => {
      const orch = new OrchestratorAgent(makeProvider(), DEFAULT_CONFIG)
      const findings = [finding({ id: 'security-0', file: 'src/auth.ts' })]
      const result = orch.synthesize(findings, ['src/auth.ts', 'package.json'])
      expect(result).toHaveLength(1)
    })

    it('does not filter anything when changedFiles is omitted (backward compatible)', () => {
      const orch = new OrchestratorAgent(makeProvider(), DEFAULT_CONFIG)
      const findings = [finding({ id: 'security-0', file: 'anything/not/real.ts' })]
      const result = orch.synthesize(findings)
      expect(result).toHaveLength(1)
    })

    it('matches despite a leading "./" on the finding’s file path', () => {
      const orch = new OrchestratorAgent(makeProvider(), DEFAULT_CONFIG)
      const findings = [finding({ id: 'security-0', file: './src/auth.ts' })]
      const result = orch.synthesize(findings, ['src/auth.ts'])
      expect(result).toHaveLength(1)
    })

    it('matches despite a git-diff "a/" prefix on the finding’s file path', () => {
      // Reproduced live: the model sometimes echoes the diff's own `a/`/`b/` path prefix
      // (from "--- a/path" / "+++ b/path" headers) into the file field, even though
      // extractChangedFiles always strips it. A real finding was wrongly dropped as
      // hallucinated because of this exact mismatch.
      const orch = new OrchestratorAgent(makeProvider(), DEFAULT_CONFIG)
      const findings = [finding({ id: 'correctness-0', file: 'a/src/cart/calculator.ts' })]
      const result = orch.synthesize(findings, ['src/cart/calculator.ts'])
      expect(result).toHaveLength(1)
    })

    it('does not filter anything when changedFiles is an empty array (fail open, not fail closed)', () => {
      // An empty list means extractChangedFiles couldn't confidently parse any files from the
      // diff -- not "this diff touches zero files." Filtering against an empty set would reject
      // every finding, a worse failure mode than the one this feature defends against.
      const orch = new OrchestratorAgent(makeProvider(), DEFAULT_CONFIG)
      const findings = [finding({ id: 'security-0', file: 'anything/not/real.ts' })]
      const result = orch.synthesize(findings, [])
      expect(result).toHaveLength(1)
    })

    it('records a dropped finding into the optional sink instead of only logging it', () => {
      // A dropped finding used to be visible only via console.error -- invisible to any caller
      // reading the ReviewResult itself. The sink lets runner.ts surface this in the report.
      const orch = new OrchestratorAgent(makeProvider(), DEFAULT_CONFIG)
      const findings = [
        finding({
          id: 'dependencies-0',
          agent: 'dependencies',
          file: 'package.json',
          title: 'Wildcard version',
        }),
      ]
      const dropped: Array<{ agent: string; title: string; file: string }> = []
      const result = orch.synthesize(findings, ['src/other.ts'], dropped)
      expect(result).toHaveLength(0)
      expect(dropped).toEqual([
        { agent: 'dependencies', title: 'Wildcard version', file: 'package.json' },
      ])
    })

    it('does not push into the sink when nothing is dropped', () => {
      const orch = new OrchestratorAgent(makeProvider(), DEFAULT_CONFIG)
      const findings = [finding({ id: 'security-0', file: 'src/auth.ts' })]
      const dropped: Array<{ agent: string; title: string; file: string }> = []
      orch.synthesize(findings, ['src/auth.ts'], dropped)
      expect(dropped).toEqual([])
    })
  })

  describe('publication filter', () => {
    it('excludes SPECULATIVE findings below high severity', () => {
      const orch = new OrchestratorAgent(makeProvider(), DEFAULT_CONFIG)
      const findings = [
        finding({ id: 'security-0', severity: 'medium', basis: 'SPECULATIVE' }),
        finding({ id: 'security-1', severity: 'high', basis: 'SPECULATIVE' }),
        finding({ id: 'security-2', severity: 'medium', basis: 'VERIFIED' }),
      ]
      const result = orch.synthesize(findings)
      expect(result.find((f) => f.id === 'security-0')).toBeUndefined()
      expect(result.find((f) => f.id === 'security-1')).toBeDefined()
      expect(result.find((f) => f.id === 'security-2')).toBeDefined()
    })
  })
})

describe('OrchestratorAgent.synthesize — hallucinationCrossCheck', () => {
  const orchestrator = new OrchestratorAgent(null as unknown as LLMProvider, {
    ...DEFAULT_CONFIG,
    maxFindings: 50,
  })

  it('does NOT downgrade a solo Critical finding from a deterministic source (gitleaks)', () => {
    const findings: Finding[] = [
      makeFinding({ source: 'gitleaks', severity: 'critical', confidence: 50, agent: 'secrets' }),
      makeFinding({
        id: 'f2',
        agent: 'security',
        file: 'src/other.ts',
        line: 99,
        source: 'llm',
        severity: 'low',
      }),
    ]
    const result = orchestrator.synthesize(findings)
    const secretFinding = result.find((f) => f.id === 'f1')
    expect(secretFinding?.severity).toBe('critical')
  })

  it('does NOT downgrade a solo High finding from semgrep', () => {
    const findings: Finding[] = [
      makeFinding({
        id: 'f1',
        source: 'semgrep',
        severity: 'high',
        confidence: 40,
        agent: 'security',
      }),
      makeFinding({
        id: 'f2',
        agent: 'correctness',
        file: 'src/other.ts',
        line: 99,
        source: 'llm',
        severity: 'low',
      }),
    ]
    const result = orchestrator.synthesize(findings)
    const secFinding = result.find((f) => f.id === 'f1')
    expect(secFinding?.severity).toBe('high')
  })

  it('DOES downgrade a solo High finding from llm source with low confidence', () => {
    const findings: Finding[] = [
      makeFinding({ id: 'f1', source: 'llm', severity: 'high', confidence: 40, agent: 'security' }),
      makeFinding({
        id: 'f2',
        agent: 'correctness',
        file: 'src/other.ts',
        line: 99,
        source: 'llm',
        severity: 'low',
      }),
    ]
    const result = orchestrator.synthesize(findings)
    const secFinding = result.find((f) => f.id === 'f1')
    expect(secFinding?.severity).toBe('medium')
  })

  it('does NOT downgrade when a corroborating agent exists regardless of source', () => {
    const findings: Finding[] = [
      makeFinding({
        id: 'f1',
        source: 'llm',
        severity: 'critical',
        confidence: 40,
        agent: 'security',
        file: 'src/api.ts',
        line: 10,
      }),
      makeFinding({
        id: 'f2',
        source: 'llm',
        severity: 'high',
        agent: 'adversarial',
        file: 'src/api.ts',
        line: 10,
      }),
    ]
    const result = orchestrator.synthesize(findings)
    const criticalFinding = result.find((f) => f.id === 'f1')
    expect(criticalFinding?.severity).toBe('critical')
  })
})

describe('OrchestratorAgent.synthesize — crossReference breaking-change escalation', () => {
  it('escalates breaking-change severity when correctness finding is at same location', () => {
    const orch = new OrchestratorAgent(makeProvider(), DEFAULT_CONFIG)
    const findings = [
      makeFinding({
        id: 'bc-0',
        agent: 'breaking-change',
        severity: 'high',
        basis: 'VERIFIED',
        file: 'src/api.ts',
        line: 10,
      }),
      makeFinding({
        id: 'c-0',
        agent: 'correctness',
        severity: 'medium',
        basis: 'VERIFIED',
        file: 'src/api.ts',
        line: 13, // within 5-line window but different location
      }),
    ]
    const result = orch.synthesize(findings)
    const bc = result.find((f) => f.agent === 'breaking-change')
    expect(bc?.severity).toBe('critical') // high → critical (escalated due to nearby correctness)
  })

  it('escalates breaking-change when design finding is nearby', () => {
    const orch = new OrchestratorAgent(makeProvider(), DEFAULT_CONFIG)
    const findings = [
      makeFinding({
        id: 'bc-0',
        agent: 'breaking-change',
        severity: 'medium',
        basis: 'VERIFIED',
        file: 'src/api.ts',
        line: 10,
      }),
      makeFinding({
        id: 'd-0',
        agent: 'design',
        severity: 'high',
        basis: 'VERIFIED',
        file: 'src/api.ts',
        line: 12,
      }),
    ]
    const result = orch.synthesize(findings)
    const bc = result.find((f) => f.agent === 'breaking-change')
    expect(bc?.severity).toBe('high') // medium → high (escalated due to nearby design)
  })

  it('does not escalate breaking-change when correctness is beyond 5-line window', () => {
    const orch = new OrchestratorAgent(makeProvider(), DEFAULT_CONFIG)
    const findings = [
      makeFinding({
        id: 'bc-0',
        agent: 'breaking-change',
        severity: 'high',
        basis: 'VERIFIED',
        file: 'src/api.ts',
        line: 10,
      }),
      makeFinding({
        id: 'c-0',
        agent: 'correctness',
        severity: 'high',
        basis: 'VERIFIED',
        file: 'src/api.ts',
        line: 20, // > 5 lines away
      }),
    ]
    const result = orch.synthesize(findings)
    const bc = result.find((f) => f.agent === 'breaking-change')
    expect(bc?.severity).toBe('high') // unchanged
  })
})
