import { describe, it, expect, vi } from 'vitest'
import { OrchestratorAgent } from '../../src/core/agents/orchestrator.js'
import { DEFAULT_CONFIG } from '../../src/core/config.js'
import type { Finding } from '../../src/core/schema.js'

const makeProvider = () => ({
  chat: vi.fn(),
  ping: vi.fn().mockResolvedValue({ ok: true })
})

const finding = (overrides: Partial<Finding> = {}): Finding => ({
  id: 'security-0',
  agent: 'security',
  severity: 'high',
  basis: 'VERIFIED',
  file: 'src/auth.ts',
  line: 10,
  title: 'Test finding',
  detail: 'Detail',
  suggestion: 'Fix it',
  confidence: 70,
  ...overrides
})

describe('confidence-aware hallucination cross-check', () => {
  it('keeps solo Critical when confidence >= 60', () => {
    const orch = new OrchestratorAgent(makeProvider(), DEFAULT_CONFIG)
    const findings = [
      finding({ id: 'security-0', agent: 'security', severity: 'critical', confidence: 75, file: 'src/foo.ts', line: 5 }),
      finding({ id: 'correctness-0', agent: 'correctness', severity: 'low', confidence: 80, file: 'src/bar.ts', line: 99 })
    ]
    const result = orch.synthesize(findings)
    const f = result.find(r => r.id === 'security-0')
    // confidence=75 >= 60: solo Critical stays Critical
    expect(f?.severity).toBe('critical')
  })

  it('downgrades solo Critical to High (not Medium) when confidence < 60', () => {
    const orch = new OrchestratorAgent(makeProvider(), DEFAULT_CONFIG)
    const findings = [
      finding({ id: 'security-0', agent: 'security', severity: 'critical', confidence: 45, file: 'src/foo.ts', line: 5 }),
      finding({ id: 'correctness-0', agent: 'correctness', severity: 'low', confidence: 80, file: 'src/bar.ts', line: 99 })
    ]
    const result = orch.synthesize(findings)
    const f = result.find(r => r.id === 'security-0')
    // low confidence solo Critical → High, not Medium
    expect(f?.severity).toBe('high')
  })

  it('keeps Critical when corroborated, regardless of confidence', () => {
    const orch = new OrchestratorAgent(makeProvider(), DEFAULT_CONFIG)
    const findings = [
      finding({ id: 'security-0', agent: 'security', severity: 'critical', confidence: 40, file: 'src/foo.ts', line: 10 }),
      finding({ id: 'correctness-0', agent: 'correctness', severity: 'high', confidence: 80, file: 'src/foo.ts', line: 12 })
    ]
    const result = orch.synthesize(findings)
    // corroborated: stays Critical even with confidence=40
    const secFinding = result.find(f => f.agent === 'security')
    expect(secFinding?.severity).toBe('critical')
  })

  it('solo High still downgrades to Medium regardless of confidence', () => {
    const orch = new OrchestratorAgent(makeProvider(), DEFAULT_CONFIG)
    const findings = [
      finding({ id: 'security-0', agent: 'security', severity: 'high', confidence: 90, file: 'src/foo.ts', line: 5 }),
      finding({ id: 'correctness-0', agent: 'correctness', severity: 'low', confidence: 80, file: 'src/bar.ts', line: 99 })
    ]
    const result = orch.synthesize(findings)
    const f = result.find(r => r.id === 'security-0')
    // solo High always → Medium (unchanged behavior)
    expect(f?.severity).toBe('medium')
  })
})

describe('confidence default in BaseAgent', () => {
  it('assigns confidence=70 when agent does not output confidence field', async () => {
    const { BaseAgent } = await import('../../src/core/agents/base.js')
    class TestAgent extends BaseAgent {
      get name() { return 'security' as const }
      get systemPrompt() { return 'test' }
    }
    const provider = {
      chat: vi.fn().mockResolvedValue(JSON.stringify([{
        severity: 'high', basis: 'VERIFIED', file: 'f.ts', line: 1,
        title: 'T', detail: 'D', suggestion: 'S'
      }])),
      ping: vi.fn()
    }
    const agent = new TestAgent(provider, DEFAULT_CONFIG)
    const findings = await agent.run({ diff: 'diff' })
    expect(findings[0].confidence).toBe(70)
  })

  it('uses agent-reported confidence when present and clamps to 0–100', async () => {
    const { BaseAgent } = await import('../../src/core/agents/base.js')
    class TestAgent extends BaseAgent {
      get name() { return 'security' as const }
      get systemPrompt() { return 'test' }
    }
    const provider = {
      chat: vi.fn().mockResolvedValue(JSON.stringify([{
        severity: 'high', basis: 'VERIFIED', file: 'f.ts', line: 1,
        title: 'T', detail: 'D', suggestion: 'S', confidence: 150
      }])),
      ping: vi.fn()
    }
    const agent = new TestAgent(provider, DEFAULT_CONFIG)
    const findings = await agent.run({ diff: 'diff' })
    expect(findings[0].confidence).toBe(100)
  })
})
