import type { Finding, ReviewResult } from '../core/schema.js'

// Only critical and high are rendered — medium/low appear in the tail only.
const SEVERITY_ICONS: Record<'critical' | 'high', string> = {
  critical: '🔴',
  high: '🟠',
}

export function formatMcpOutput(result: ReviewResult): string {
  const { findings, summary } = result

  if (findings.length === 0) {
    return '## AI Code Review — ✅ No findings\n'
  }

  const actionable = findings.filter(
    f => f.severity === 'critical' || f.severity === 'high'
  )
  // Intentionally trust summary.bySeverity rather than re-counting from findings —
  // summary is the canonical source of truth and keeps medium/low counts correct even
  // if the caller pre-filtered findings.
  const mediumCount = summary.bySeverity.medium ?? 0
  const lowCount = summary.bySeverity.low ?? 0

  if (actionable.length === 0) {
    const tail = buildTail(mediumCount, lowCount)
    return `## AI Code Review — ✅ No critical or high findings\n\n_${tail}_\n`
  }

  const count = actionable.length
  const header = `## AI Code Review — ${count} finding${count === 1 ? '' : 's'}\n\n`
  const body = actionable.map(renderFinding).join('\n\n')
  const tail = buildTail(mediumCount, lowCount)
  const footer = tail ? `\n\n---\n_${tail}_\n` : '\n'

  return header + body + footer
}

function renderFinding(f: Finding): string {
  const icon = SEVERITY_ICONS[f.severity as 'critical' | 'high']
  const lines = [
    `### ${icon} ${f.severity.toUpperCase()} · ${f.domain ?? f.agent} · \`${f.file}:${f.line}\``,
    `**${f.title}**`,
    f.detail,
  ]
  if (f.evidence) lines.push(`**Evidence:** ${f.evidence}`)
  if (f.impact) lines.push(`**Impact:** ${f.impact}`)
  lines.push(`**Recommendation:** ${f.recommendation ?? f.suggestion}`)
  if (f.blocking != null) lines.push(`**Blocking:** ${f.blocking ? 'Yes' : 'No'}`)
  return lines.join('\n')
}

function buildTail(medium: number, low: number): string {
  const parts: string[] = []
  if (medium > 0) parts.push(`${medium} medium`)
  if (low > 0) parts.push(`${low} low`)
  if (parts.length === 0) return ''
  return `${parts.join(' · ')} — run \`ai-review-agent\` in your terminal to see all findings`
}
