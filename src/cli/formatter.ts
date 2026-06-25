import type { ReviewResult, Severity } from '../core/schema.js'
export { formatSarif } from './formatters/sarif.js'
export { formatGithubAnnotations } from './formatters/githubAnnotations.js'

const SEVERITY_EMOJI: Record<Severity, string> = {
  critical: '🔴',
  high: '🟠',
  medium: '🟡',
  low: '🔵',
}

export function formatMarkdown(result: ReviewResult): string {
  const { findings, testFiles, summary } = result
  const lines: string[] = []

  lines.push('# AI Code Review Report')
  lines.push('')
  lines.push(
    `**${summary.totalFindings} finding${summary.totalFindings === 1 ? '' : 's'}** | ${summary.durationMs}ms`
  )
  lines.push('')

  if (findings.length === 0) {
    lines.push('✅ No issues found.')
    return lines.join('\n')
  }

  const bySeverity = groupBy(findings, (f) => f.severity)
  for (const severity of ['critical', 'high', 'medium', 'low'] as Severity[]) {
    const group = bySeverity.get(severity)
    if (!group?.length) continue
    lines.push(`## ${SEVERITY_EMOJI[severity]} ${capitalize(severity)} (${group.length})`)
    lines.push('')
    for (const f of group) {
      lines.push(`### ${f.title}`)
      const conf = f.confidence ?? 70
      lines.push(
        `**Agent:** ${f.agent} | **Basis:** ${f.basis} | **Confidence:** ${conf}% | **File:** \`${f.file}:${f.line}\``
      )
      lines.push('')
      lines.push(f.detail)
      lines.push('')
      lines.push(`**Domain:** ${f.domain}`)
      lines.push(`**Evidence:** ${f.evidence}`)
      lines.push(`**Impact:** ${f.impact}`)
      lines.push(`**Recommendation:** ${f.recommendation}`)
      lines.push(`**Blocking:** ${f.blocking ? 'Yes' : 'No'}`)
      lines.push('')
      lines.push('---')
      lines.push('')
    }
  }

  if (testFiles.length > 0) {
    lines.push(`## 🧪 Generated Test Files (${testFiles.length})`)
    lines.push('')
    for (const tf of testFiles) {
      lines.push(`- \`${tf.path}\` (${tf.framework})`)
    }
    lines.push('')
  }

  if (result.sanitizer?.applied) {
    lines.push('')
    lines.push('---')
    lines.push(
      `*Sanitizer: ${result.sanitizer.redactedLines} line(s) modified to remove potential prompt injection. See \`--format json\` output for details.*`
    )
  }

  if (result.context) {
    const { mode, filesLoaded, estimatedTokens } = result.context
    const fileList = filesLoaded.join(', ')
    lines.push('---')
    lines.push(`*Context: ${mode} — loaded ${fileList || 'no files'} (~${estimatedTokens} tokens)*`)
  }

  if (result.policy && result.policy.agentsSkipped.length > 0) {
    lines.push('---')
    lines.push(`*Policy: ${result.policy.agentsSkipped.join(', ')} skipped by agentPolicy rules.*`)
  }

  return lines.join('\n')
}

export function formatJson(result: ReviewResult): string {
  return JSON.stringify(result, null, 2)
}

function groupBy<T>(arr: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const item of arr) {
    const k = key(item)
    const group = map.get(k) ?? []
    group.push(item)
    map.set(k, group)
  }
  return map
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
