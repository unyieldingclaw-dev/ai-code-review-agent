import type * as vscode from 'vscode'
import type { ReviewResult, Severity } from './types'

type OutputChannel = vscode.OutputChannel

const HEADER: Record<Severity, string> = {
  critical: '🔴 CRITICAL',
  high: '🟠 HIGH',
  medium: '🟡 MEDIUM',
  low: '🔵 LOW',
}

/**
 * Render a full ReviewResult as a human-readable markdown-ish report in the
 * given OutputChannel. Clears existing content before writing.
 */
export function renderReport(channel: OutputChannel, result: ReviewResult): void {
  channel.clear()

  const { findings, summary } = result
  const count = summary.totalFindings
  const plural = count === 1 ? 'finding' : 'findings'

  channel.appendLine('# AI Code Review Report')
  channel.appendLine('')
  channel.appendLine(`${count} ${plural}  |  ${summary.durationMs}ms`)
  channel.appendLine('')

  if (findings.length === 0) {
    channel.appendLine('✅ No issues found.')
    return
  }

  for (const severity of ['critical', 'high', 'medium', 'low'] as Severity[]) {
    const group = findings.filter((f) => f.severity === severity)
    if (group.length === 0) continue

    channel.appendLine(`## ${HEADER[severity]} (${group.length})`)
    channel.appendLine('')

    for (const f of group) {
      const confidence = f.confidence !== undefined ? `${f.confidence}%` : '—'
      channel.appendLine(`### ${f.title}`)
      channel.appendLine(
        `Agent: ${f.agent}  |  ${f.file}:${f.line}  |  Confidence: ${confidence}  |  Basis: ${f.basis}`
      )
      channel.appendLine('')
      channel.appendLine(f.detail)
      channel.appendLine('')
      channel.appendLine(`**Suggestion:** ${f.suggestion}`)
      channel.appendLine('─'.repeat(60))
      channel.appendLine('')
    }
  }
}
