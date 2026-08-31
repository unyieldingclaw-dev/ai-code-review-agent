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

  const { findings, summary, earlyExit, truncation, agentStatus, chunking } = result
  const count = summary.totalFindings
  const plural = count === 1 ? 'finding' : 'findings'

  // Parity with cli/formatter.ts. Before this, the extension read only `findings` and `summary`,
  // so a truncated run, a run where every agent failed, and a fail-fast run all rendered
  // identically to a clean pass -- three incompleteness states this project had already fixed on
  // the other five surfaces. The glyph IS the verdict for a skimming reader (#51), which is why
  // the headline changes rather than gaining a caveat underneath it.
  const failedAgents = Object.entries(agentStatus ?? {}).filter(([, s]) => s !== 'ok')
  const agentsRan = Object.keys(agentStatus ?? {}).length
  // agentsPlanned, not agentsRan: agentStatus holds only agents that ran, so on an early exit it
  // shrinks with the numerator and claims full coverage of a roster it never attempted.
  const totalAgents = result.agentsPlanned ?? agentsRan
  const chunksMissed = chunking !== undefined && chunking.reviewed < chunking.total
  // Mirrors earlyExitLostCoverage in src/core/schema.ts, which this package cannot import.
  // shouldEarlyExit runs after every agent including the last, so `earlyExit` alone does not mean
  // coverage was lost; an undefined agentsPlanned (older agent binary) counts as lost.
  const notRun =
    result.agentsPlanned !== undefined
      ? result.agentsPlanned - Object.keys(agentStatus ?? {}).length
      : undefined
  const earlyExitLostCoverage = earlyExit !== undefined && (notRun === undefined || notRun > 0)
  const incomplete =
    truncation?.truncated || failedAgents.length > 0 || earlyExitLostCoverage || chunksMissed

  channel.appendLine('# AI Code Review Report')
  channel.appendLine('')
  channel.appendLine(
    incomplete
      ? `⚠️ INCOMPLETE — ${count} ${plural}  |  ${summary.durationMs}ms`
      : `${count} ${plural}  |  ${summary.durationMs}ms`
  )
  channel.appendLine('')

  if (earlyExitLostCoverage && earlyExit) {
    channel.appendLine(
      `⚡ Fail-fast: the swarm stopped after ${earlyExit.stoppedAt}` +
        (notRun !== undefined && notRun > 0
          ? `, so ${notRun} of ${totalAgents} agents never ran`
          : '') +
        `. Re-run without --fail-fast for full coverage.`
    )
    channel.appendLine('')
  }
  if (truncation?.truncated) {
    channel.appendLine(
      `⚠️ Diff truncated: reviewed ${truncation.keptLines}/${truncation.originalLines} lines — ` +
        `findings past this point were never analyzed. Use --chunk to review the whole diff.`
    )
    channel.appendLine('')
  }
  if (chunksMissed) {
    channel.appendLine(
      `⚠️ Chunked run stopped early: ${chunking.reviewed} of ${chunking.total} chunks reviewed.`
    )
    channel.appendLine('')
  }
  if (failedAgents.length > 0) {
    const detail = failedAgents.map(([name, status]) => `${name}: ${status}`).join(', ')
    channel.appendLine(
      `⚠️ ${failedAgents.length}/${totalAgents} agent(s) failed (${detail}) — results may be incomplete.`
    )
    channel.appendLine('')
  }

  if (findings.length === 0) {
    // Gated on `incomplete`, not on findings alone: "no issues found" and "no issues found in the
    // part that was reviewed" are different claims, and only the first deserves a green check.
    channel.appendLine(
      incomplete
        ? '⚠️ No issues found in the portion reviewed — this was not a complete review.'
        : '✅ No issues found.'
    )
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
