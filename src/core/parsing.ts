// src/core/parsing.ts
// Finding validation and normalization — extracted from BaseAgent to satisfy SRP.
// Accepts both legacy LLM field names (basis, detail, suggestion) and canonical
// schema names (evidence, description, recommendation).

import type { Finding, AgentName, ReviewDomain, AgentStatus } from './schema.js'

export class ParseFailureError extends Error {
  constructor(
    public readonly agentName: string,
    rawSnippet: string
  ) {
    super(`[${agentName}] failed to parse a usable response: ${rawSnippet.slice(0, 200)}`)
    this.name = 'ParseFailureError'
  }
}

export function classifyAgentError(err: unknown): AgentStatus {
  if (err instanceof ParseFailureError) return 'parse-error'
  if (err instanceof Error && err.message.includes('timed out')) return 'timeout'
  return 'error'
}

// Shared string/escape-aware bracket scanner, used by every agent that has to recover JSON
// from LLM output that may have trailing prose or get cut off mid-generation. Depth is clamped
// at 0 so a stray unmatched close-bracket before the real content can't desync the rest of the
// scan (e.g. `extractCompleteObjects('}{"a":1}')` still recovers `{"a":1}` instead of silently
// dropping every object for the rest of the text).

/** Finds the first `open`...`close` span in `text` and returns it only if it actually closes
 *  (i.e. isn't truncated). Returns null if `open` never appears or the span never balances. */
export function extractBalancedSpan(text: string, open: string, close: string): string | null {
  const start = text.indexOf(open)
  if (start === -1) return null
  let depth = 0
  let inString = false
  let esc = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (esc) {
      esc = false
      continue
    }
    if (ch === '\\' && inString) {
      esc = true
      continue
    }
    if (ch === '"') {
      inString = !inString
      continue
    }
    if (inString) continue
    if (ch === open) depth++
    else if (ch === close) {
      depth = Math.max(0, depth - 1)
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

/** Scans the entire text for complete `{...}` objects at any nesting depth, regardless of
 *  whether any enclosing array/object ever closes -- recovers whatever finished objects exist
 *  before a truncation point instead of discarding all of them because the last one never
 *  completed. A stack of open-brace positions means a stray unmatched `}` is simply ignored
 *  (nothing to pop) rather than desyncing recovery for the rest of the text, and an object
 *  nested inside an outer wrapper that itself never closes (e.g. `{"findings":[{...}],"gaps":[..
 *  truncated) is still recovered on its own. */
export function extractCompleteObjects(text: string): unknown[] {
  const objects: unknown[] = []
  const starts: number[] = []
  let inString = false
  let esc = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (esc) {
      esc = false
      continue
    }
    if (ch === '\\' && inString) {
      esc = true
      continue
    }
    if (ch === '"') {
      inString = !inString
      continue
    }
    if (inString) continue
    if (ch === '{') {
      starts.push(i)
    } else if (ch === '}') {
      const start = starts.pop()
      if (start === undefined) continue // stray unmatched close-brace -- ignore
      try {
        objects.push(JSON.parse(text.slice(start, i + 1)))
      } catch {
        /* malformed object -- skip it and keep scanning */
      }
    }
  }
  return objects
}

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
