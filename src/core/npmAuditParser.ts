// src/core/npmAuditParser.ts
// Maps `npm audit --json` output to the Finding schema. npm audit has no notion of a diff --
// it audits the entire current dependency tree -- so this is only invoked when the diff touches
// package.json/package-lock.json (see dependencies.ts), reporting the full current audit state
// rather than attempting to diff-scope it (see spec's Non-Goals: package-lock.json diffs are too
// fragile to reliably parse "which packages did this diff touch").
//
// npm audit's severity vocabulary (info/low/moderate/high/critical) doesn't match
// Finding.severity (low/medium/high/critical) -- info/low are dropped (matches every other
// agent's "only report severity >= medium" convention; moderate is the equivalent floor).

import type { AgentName, Finding, Severity } from './schema.js'

interface NpmAuditVia {
  title?: string
  url?: string
  severity?: string
}

interface NpmAuditVulnerability {
  name: string
  severity: string
  via: (string | NpmAuditVia)[]
  range: string
  fixAvailable: boolean | { name: string; version: string; isSemVerMajor: boolean }
}

interface NpmAuditReport {
  vulnerabilities?: Record<string, NpmAuditVulnerability>
}

const SEVERITY_MAP: Record<string, Severity | undefined> = {
  moderate: 'medium',
  high: 'high',
  critical: 'critical',
}

export function parseNpmAuditOutput(json: string, agentName: AgentName): Finding[] {
  let report: NpmAuditReport
  try {
    report = JSON.parse(json)
  } catch {
    return []
  }
  const vulnerabilities = report.vulnerabilities
  if (!vulnerabilities || typeof vulnerabilities !== 'object') return []

  const findings: Finding[] = []
  let i = 0
  for (const [pkgName, vuln] of Object.entries(vulnerabilities)) {
    const severity = SEVERITY_MAP[vuln.severity]
    if (!severity) continue // drops info/low

    const detailVia = vuln.via.find((v): v is NpmAuditVia => typeof v === 'object')
    const detail =
      detailVia?.title ??
      `Vulnerable via ${vuln.via.filter((v) => typeof v === 'string').join(', ')}`
    const evidence = detailVia?.url ?? `Affected range: ${vuln.range}`
    const fixSuggestion =
      typeof vuln.fixAvailable === 'object'
        ? `Upgrade to ${vuln.fixAvailable.name}@${vuln.fixAvailable.version}${vuln.fixAvailable.isSemVerMajor ? ' (major version bump)' : ''}`
        : vuln.fixAvailable
          ? `Run npm audit fix to resolve.`
          : `No automatic fix available yet -- track the advisory for a patched release.`

    findings.push({
      id: `${agentName}-npm-audit-${i++}`,
      agent: agentName,
      domain: 'Dependencies',
      severity,
      basis: 'VERIFIED',
      file: 'package.json',
      line: 1,
      title: `Known vulnerability in ${pkgName}`,
      detail,
      evidence,
      impact: `${vuln.severity} severity vulnerability in ${pkgName} (affected range: ${vuln.range}).`,
      recommendation: fixSuggestion,
      suggestion: fixSuggestion,
      blocking: severity === 'critical' || severity === 'high',
      source: 'npm-audit',
      confidence: 95,
    })
  }
  return findings
}
