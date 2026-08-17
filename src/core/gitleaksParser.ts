// src/core/gitleaksParser.ts
// Maps gitleaks' `-f json` output (verified against a real gitleaks 8.30.1 run this session) to
// the Finding schema. gitleaks' own output has no severity field -- it only reports things it's
// confident are real secrets in the first place, so every leak defaults to 'high'. Per-rule
// severity tuning (e.g. Critical for private-key/certificate rule categories) is a reasonable
// future refinement, not required here.

import type { AgentName, Finding } from './schema.js'

interface GitleaksLeak {
  RuleID: string
  Description: string
  StartLine: number
  Match: string
  Secret: string
  File: string
}

export function parseGitleaksOutput(json: string, agentName: AgentName): Finding[] {
  let leaks: unknown
  try {
    leaks = JSON.parse(json)
  } catch (err) {
    // WHY log here: SecretsAgent treats any non-null runTool output as "gitleaks ran" and reports
    // toolAvailability 'used' -- a malformed response silently mapping to [] would report "0
    // secrets found, tool used", a false sense of security with zero trace anywhere.
    console.error(
      `[gitleaksParser] failed to parse gitleaks JSON output: ${(err as Error).message}`
    )
    return []
  }
  if (!Array.isArray(leaks)) {
    console.error(
      '[gitleaksParser] unexpected gitleaks output shape (not an array) -- treating as no findings'
    )
    return []
  }

  return (leaks as GitleaksLeak[]).map((leak, i) => ({
    id: `${agentName}-gitleaks-${i}`,
    agent: agentName,
    domain: 'Secrets' as const,
    severity: 'high' as const,
    basis: 'VERIFIED' as const,
    file: leak.File,
    line: leak.StartLine,
    // gitleaks RuleIDs are hyphenated (e.g. "stripe-access-token") -- spaced out for readability.
    title: leak.RuleID.replace(/-/g, ' '),
    detail: leak.Description,
    evidence: leak.Secret,
    impact: 'Credential exposure if leaked via repo history, logs, or a public fork.',
    recommendation:
      'Remove the hardcoded credential and rotate it. Use an environment variable or a secrets manager.',
    suggestion:
      'Remove the hardcoded credential and rotate it. Use an environment variable or a secrets manager.',
    blocking: true,
    source: 'gitleaks' as const,
    // gitleaks only reports leaks its own rules are confident about -- 95 reflects that baseline
    // precision, not a per-leak computed value.
    confidence: 95,
  }))
}
