import type { LLMProvider } from '../llm/provider.js'
import type { ReviewConfig } from '../config.js'
import type { Finding, Severity, AgentName } from '../schema.js'
import { SEVERITY_RANK } from '../schema.js'

// Agent priority for deduplication — higher index = higher priority kept
const AGENT_PRIORITY: AgentName[] = [
  'integration', 'coverage', 'testgen', 'adversarial',
  'design', 'dependencies', 'correctness', 'performance', 'security'
]

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
    // Only meaningful when multiple agents ran
    const agentsPresent = new Set(findings.map(f => f.agent))
    if (agentsPresent.size <= 1) return findings

    return findings.map(f => {
      if (f.severity !== 'critical' && f.severity !== 'high') return f
      // Count distinct OTHER agents that flagged the same file within ±5 lines
      const corroborators = new Set(
        findings
          .filter(other =>
            other.id !== f.id &&
            other.agent !== f.agent &&
            other.file === f.file &&
            Math.abs(other.line - f.line) <= 5
          )
          .map(other => other.agent)
      )
      if (corroborators.size === 0) {
        // Only one agent flagged this location — downgrade to medium
        return { ...f, severity: 'medium' as Severity }
      }
      return f
    })
  }

  private deduplicate(findings: Finding[]): Finding[] {
    // Group by file:line; within each group, if multiple different agents reported,
    // keep only the highest-priority agent's finding. Same-agent findings are distinct.
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
        // All from same agent — keep all
        result.push(...group)
      } else {
        // Multiple agents at same location — keep only the highest-priority agent's findings
        let bestPriority = -Infinity
        let bestAgent: AgentName | null = null
        for (const agent of agents) {
          const priority = AGENT_PRIORITY.indexOf(agent)
          if (priority > bestPriority) {
            bestPriority = priority
            bestAgent = agent
          }
        }
        const kept = group.filter(f => f.agent === bestAgent)
        const droppedIds = group.filter(f => f.agent !== bestAgent).map(f => f.id)
        result.push(...kept.map(f => ({
          ...f,
          relatedFindings: [...(f.relatedFindings ?? []), ...droppedIds]
        })))
      }
    }
    return result
  }

  private crossReference(findings: Finding[]): Finding[] {
    return findings.map(f => {
      // Correctness bug at same file:line as a coverage gap → escalate severity
      if (f.agent === 'correctness') {
        const coverageGap = findings.find(
          other => other.agent === 'coverage' && other.file === f.file && Math.abs(other.line - f.line) <= 5
        )
        if (coverageGap) {
          return { ...f, severity: this.escalate(f.severity), relatedFindings: [...(f.relatedFindings ?? []), coverageGap.id] }
        }
      }
      // Security finding at same location as adversarial → escalate
      if (f.agent === 'security') {
        const hasAdversarial = findings.some(
          other => other.agent === 'adversarial' && other.file === f.file && Math.abs(other.line - f.line) <= 5
        )
        if (hasAdversarial) {
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
