import type { LLMProvider } from '../llm/provider.js'
import type { ReviewConfig } from '../config.js'
import type { Finding, Severity, AgentName } from '../schema.js'
import { SEVERITY_RANK } from '../schema.js'

// Record-based priority map — TypeScript will error if any AgentName is missing
const AGENT_PRIORITY: Record<AgentName, number> = {
  'integration': 0,
  'breaking-change': 1,
  'coverage': 2,
  'testgen': 3,
  'adversarial': 4,
  'design': 5,
  'dependencies': 6,
  'license': 7,
  'correctness': 8,
  'performance': 9,
  'security': 10,
}

export class OrchestratorAgent {
  constructor(
    private readonly provider: LLMProvider,
    private readonly config: ReviewConfig
  ) {}

  synthesize(findings: Finding[]): Finding[] {
    let result = [...findings]
    // Cross-reference before dedup so coverage gaps can escalate correctness findings
    result = this.crossReference(result)
    // Require 2+ independent agents for Critical/High before publishing
    result = this.hallucinationCrossCheck(result)
    result = this.deduplicate(result)
    result = this.applyPublicationFilter(result)
    result = this.capAndSort(result)
    return result
  }

  private hallucinationCrossCheck(findings: Finding[]): Finding[] {
    // Build file-indexed map for O(n) lookup instead of O(n²) scan
    const byFile = new Map<string, Finding[]>()
    for (const f of findings) {
      const arr = byFile.get(f.file) ?? []
      arr.push(f)
      byFile.set(f.file, arr)
    }

    return findings.map(f => {
      if (f.severity !== 'critical' && f.severity !== 'high') return f
      const fileFindings = byFile.get(f.file) ?? []
      const corroborators = new Set(
        fileFindings
          .filter(other =>
            other.id !== f.id &&
            other.agent !== f.agent &&
            Math.abs(other.line - f.line) <= 5
          )
          .map(other => other.agent)
      )
      if (corroborators.size > 0) return f

      // Solo finding — apply confidence-aware downgrade
      const confidence = f.confidence ?? 70
      if (f.severity === 'critical') {
        // High-confidence solo Critical stays Critical; low-confidence → High (not Medium)
        return confidence < 60
          ? { ...f, severity: 'high' as Severity }
          : f
      }
      // Solo High → Medium (unchanged behavior)
      return { ...f, severity: 'medium' as Severity }
    })
  }

  private deduplicate(findings: Finding[]): Finding[] {
    // Group by file:line; within each group, if multiple different agents reported,
    // keep only the highest-priority agent's finding and record all other agents in
    // corroboratingAgents. Same-agent findings at the same location are kept as-is.
    const byLocation = new Map<string, Finding[]>()
    for (const f of findings) {
      const key = `${f.file}:${f.line}`
      const group = byLocation.get(key) ?? []
      group.push(f)
      byLocation.set(key, group)
    }

    const result: Finding[] = []
    for (const group of byLocation.values()) {
      const agents = new Set(group.map(f => f.agent))
      if (agents.size === 1) {
        // All from same agent — keep all as-is
        result.push(...group)
      } else {
        // Multiple agents at same location — keep highest-priority agent's finding,
        // merge all other agents into corroboratingAgents
        let bestPriority = -Infinity
        let bestAgent: AgentName | null = null
        for (const agent of agents) {
          const priority = AGENT_PRIORITY[agent]
          if (priority > bestPriority) {
            bestPriority = priority
            bestAgent = agent
          }
        }
        const kept = group.filter(f => f.agent === bestAgent)
        const dropped = group.filter(f => f.agent !== bestAgent)
        const droppedAgents = [...new Set(dropped.map(f => f.agent))]
        const droppedIds = dropped.map(f => f.id)
        result.push(...kept.map(f => ({
          ...f,
          corroboratingAgents: [...new Set([...(f.corroboratingAgents ?? []), ...droppedAgents])],
          relatedFindings: [...(f.relatedFindings ?? []), ...droppedIds]
        })))
      }
    }
    return result
  }

  private crossReference(findings: Finding[]): Finding[] {
    // Build file-indexed maps for O(n) lookup instead of O(n²) scan
    const coverageByFile = new Map<string, Finding[]>()
    const adversarialByFile = new Map<string, Finding[]>()
    for (const f of findings) {
      if (f.agent === 'coverage') {
        const arr = coverageByFile.get(f.file) ?? []
        arr.push(f)
        coverageByFile.set(f.file, arr)
      }
      if (f.agent === 'adversarial') {
        const arr = adversarialByFile.get(f.file) ?? []
        arr.push(f)
        adversarialByFile.set(f.file, arr)
      }
    }

    return findings.map(f => {
      // Correctness bug at same file:line as a coverage gap → escalate severity
      if (f.agent === 'correctness') {
        const fileCoverage = coverageByFile.get(f.file) ?? []
        const coverageGap = fileCoverage.find(other => Math.abs(other.line - f.line) <= 5)
        if (coverageGap) {
          return { ...f, severity: this.escalate(f.severity), relatedFindings: [...(f.relatedFindings ?? []), coverageGap.id] }
        }
      }
      // Security finding at same location as adversarial → escalate
      if (f.agent === 'security') {
        const fileAdversarial = adversarialByFile.get(f.file) ?? []
        if (fileAdversarial.some(other => Math.abs(other.line - f.line) <= 5)) {
          return { ...f, severity: this.escalate(f.severity) }
        }
      }
      return f
    })
  }

  private escalate(severity: Severity): Severity {
    const levels: Severity[] = ['low', 'medium', 'high', 'critical']
    const idx = levels.indexOf(severity)
    return levels[Math.min(idx + 1, levels.length - 1)]
  }

  private applyPublicationFilter(findings: Finding[]): Finding[] {
    return findings.filter(f => {
      if (f.severity === 'low') return false
      if (f.basis === 'SPECULATIVE' && SEVERITY_RANK[f.severity] < SEVERITY_RANK['high']) return false
      return true
    })
  }

  private capAndSort(findings: Finding[]): Finding[] {
    return findings
      .sort((a, b) => {
        const sevDiff = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]
        if (sevDiff !== 0) return sevDiff
        // Secondary sort: VERIFIED > INFERRED > SPECULATIVE
        const basisOrder = { VERIFIED: 2, INFERRED: 1, SPECULATIVE: 0 }
        return basisOrder[b.basis] - basisOrder[a.basis]
      })
      .slice(0, this.config.maxFindings)
  }
}
