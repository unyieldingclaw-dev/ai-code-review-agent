// src/core/parsing.ts
// Finding validation and normalization — extracted from BaseAgent to satisfy SRP.
// Accepts both legacy LLM field names (basis, detail, suggestion) and canonical
// schema names (evidence, description, recommendation).

import type { Finding, AgentName, ReviewDomain } from './schema.js'

function agentDefaultDomain(name: AgentName): ReviewDomain {
  const map: Record<AgentName, ReviewDomain> = {
    security: 'Security',
    performance: 'Performance',
    correctness: 'Correctness',
    design: 'Architecture Drift',
    dependencies: 'Dependencies',
    coverage: 'Testing',
    testgen: 'Testing',
    adversarial: 'Adversarial',
    integration: 'Integration',
    'breaking-change': 'Breaking Change',
    license: 'License',
    secrets: 'Secrets',
    'error-handling': 'Error Handling',
    observability: 'Observability',
    'migration-safety': 'Migration Safety',
    complexity: 'Complexity',
  }
  return map[name] ?? 'Correctness'
}

export function validateAndNormalizeFindings(items: unknown[], agentName: AgentName): Finding[] {
  const valid: Finding[] = []
  let dropped = 0
  for (const f of items as Finding[]) {
    const passes =
      typeof f === 'object' &&
      f !== null &&
      typeof f.severity === 'string' &&
      // Accept basis (legacy LLM field) OR evidence (canonical schema name)
      (typeof f.basis === 'string' || typeof f.evidence === 'string') &&
      typeof f.file === 'string' &&
      typeof f.line === 'number' &&
      typeof f.title === 'string' &&
      typeof f.detail === 'string' &&
      // Accept either suggestion (legacy) or recommendation (new) from LLM output
      (typeof f.suggestion === 'string' || typeof f.recommendation === 'string')
    if (passes) {
      valid.push(f)
    } else {
      dropped++
    }
  }
  if (dropped > 0) {
    console.error(
      `[${agentName}] validateFindings: dropped ${dropped}/${items.length} item(s) — ` +
        `missing required fields (severity, basis/evidence, file, line, title, detail, suggestion/recommendation)`
    )
  }
  return valid.map((f, i) => {
    const rawConf = typeof f.confidence === 'number' ? f.confidence : 70
    const suggestion = f.suggestion ?? f.recommendation ?? ''
    const recommendation = f.recommendation ?? suggestion
    return {
      ...f,
      id: `${agentName}-${i}`,
      agent: agentName,
      confidence: Math.max(0, Math.min(100, rawConf)),
      domain: f.domain ?? agentDefaultDomain(agentName),
      evidence: f.evidence ?? f.detail ?? '',
      impact: f.impact ?? '',
      recommendation,
      suggestion,
      blocking: f.blocking ?? f.severity === 'critical',
      source: f.source ?? 'llm',
      ...(f.lineEnd !== undefined ? { lineEnd: Math.max(f.line, f.lineEnd) } : {}),
    }
  })
}
