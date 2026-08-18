// src/core/parsing.ts
// Finding validation and normalization — extracted from BaseAgent to satisfy SRP.
// Accepts both legacy LLM field names (basis, detail, suggestion) and canonical
// schema names (evidence, description, recommendation).

import type { Finding, AgentName, ReviewDomain, AgentStatus, Severity, Basis } from './schema.js'
import { SEVERITY_OPTIONS, BASIS_OPTIONS } from './schema.js'

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
    // WHY validate severity/basis against their real enum members, not just `typeof === 'string'`:
    // every downstream consumer (SEVERITY_RANK lookups in capAndSort/shouldFail/applyPublicationFilter/
    // evidenceVerifier, basisOrder in capAndSort) indexes a plain object by these values with no guard.
    // An LLM-emitted typo or garbage string (e.g. "sev3", "Confirmed") previously passed through
    // unvalidated and silently produced `undefined`/NaN in every one of those lookups -- breaking exit-
    // code gating, sort order, and the publication filter without ever surfacing an error. Dropping the
    // finding here (same as any other missing-required-field case) is the safe failure direction: it's
    // a genuinely malformed structured-output item, not a value worth guessing a default for.
    const passes =
      typeof f === 'object' &&
      f !== null &&
      typeof f.severity === 'string' &&
      SEVERITY_OPTIONS.includes(f.severity as Severity) &&
      // Accept basis (legacy LLM field, must be a real enum member if present) OR evidence
      // (canonical schema name, basis is then defaulted below)
      ((typeof f.basis === 'string' && BASIS_OPTIONS.includes(f.basis as Basis)) ||
        (f.basis === undefined && typeof f.evidence === 'string')) &&
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
        `missing required fields, or an unrecognized severity/basis value ` +
        `(severity must be one of ${SEVERITY_OPTIONS.join('/')}; basis, if present, must be one of ` +
        `${BASIS_OPTIONS.join('/')}; also require file, line, title, detail, suggestion/recommendation)`
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
      // WHY default to INFERRED, not VERIFIED/SPECULATIVE: `passes` above only lets a finding
      // through with no basis when it has a real `evidence` string instead (the "legacy" LLM
      // field shape) -- INFERRED reflects "the model gave supporting evidence but no explicit
      // self-declared confidence tier," without the over-trust of VERIFIED or the under-value of
      // SPECULATIVE (which applyPublicationFilter drops outright below `high` severity).
      basis: f.basis ?? 'INFERRED',
      evidence: f.evidence ?? f.detail ?? '',
      impact: f.impact ?? '',
      recommendation,
      suggestion,
      // WHY true for high as well as critical: every agent's own system prompt documents
      // "blocking: true for critical/high, false for medium/low" -- the previous critical-only
      // default silently contradicted that stated policy for every high-severity finding whose
      // JSON omitted `blocking` (a field the schema doesn't mark required, so omission is a real,
      // model-nondeterministic occurrence, not a hypothetical).
      blocking: f.blocking ?? (f.severity === 'critical' || f.severity === 'high'),
      source: f.source ?? 'llm',
      ...(f.lineEnd !== undefined ? { lineEnd: Math.max(f.line, f.lineEnd) } : {}),
    }
  })
}
