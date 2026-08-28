import type { Finding, ReviewResult } from '../core/schema.js'
import { TOOL_LABELS, toolsWithAvailability } from '../core/schema.js'
import { timingLabel, timingSentence } from '../core/timingReport.js'

// Only critical and high are rendered — medium/low appear in the tail only.
const SEVERITY_ICONS: Record<'critical' | 'high', string> = {
  critical: '🔴',
  high: '🟠',
}

export function formatMcpOutput(result: ReviewResult): string {
  const { findings, summary, agentStatus, truncation } = result

  // WHY this block exists at all: this output goes back to a calling LLM (e.g. Claude Code
  // itself via the MCP tool), not a human reading a terminal -- it has no other channel to
  // notice a failure. Before this fix, a run where every agent timed out and/or the diff was
  // truncated to a fraction of its size rendered identically to a genuine clean pass, because
  // this function never read agentStatus/truncation at all. The markdown formatter (cli/
  // formatter.ts) already handles this correctly; this mirrors that gating logic for MCP.
  const failedAgents = Object.entries(agentStatus ?? {}).filter(([, status]) => status !== 'ok')
  const warnings: string[] = []
  if (failedAgents.length > 0) {
    const totalAgents = Object.keys(agentStatus ?? {}).length
    const detail = failedAgents.map(([name, status]) => `${name}: ${status}`).join(', ')
    warnings.push(
      `⚠️ ${failedAgents.length}/${totalAgents} agent(s) failed (${detail}) — results may be incomplete.`
    )
  }
  if (truncation?.truncated) {
    warnings.push(
      `⚠️ Diff truncated: reviewed ${truncation.keptLines}/${truncation.originalLines} lines — ` +
        `findings past this point were never analyzed.`
    )
  }

  // WHY tool availability is a SEPARATE array from `warnings` rather than another entry in it:
  // `warnings` gates the headline below ("No findings, but the review was incomplete"). A failed
  // agent or a truncated diff means the review did not complete as designed, so it earns that
  // headline. A missing optional tool does not -- the agent ran in a documented degraded mode and
  // returned a real result. Folding these together would flip every clean run into "incomplete"
  // for any user who simply has not installed lizard, training the caller to ignore the warning
  // that actually matters. cli/formatter.ts draws the same line; this keeps MCP consistent with it.
  //
  // Before this, formatMcpOutput never read toolAvailability, so a partial gitleaks scan, a not-installed
  // tool, and a fully clean tool run were indistinguishable to the calling LLM -- the reader least
  // able to notice, since it has no terminal output to fall back on.
  const toolNotes: string[] = []
  const partialTools = toolsWithAvailability(result.toolAvailability, 'partial')
  if (partialTools.length > 0) {
    const names = partialTools.map((t) => TOOL_LABELS[t]).join(', ')
    toolNotes.push(
      `🔧 Partial scan: ${names} covered some of the reviewed surface but not all of it — ` +
        `findings for the remainder came from the model, not the tool.`
    )
  }
  const degradedTools = toolsWithAvailability(result.toolAvailability, 'unavailable-llm-fallback')
  if (degradedTools.length > 0) {
    const names = degradedTools.map((t) => TOOL_LABELS[t]).join(', ')
    toolNotes.push(
      `🔧 Degraded mode: ${names} not installed — the affected agent(s) ran without it, ` +
        `which may reduce finding accuracy.`
    )
  }

  // A THIRD array, not an entry in `warnings`, for the same reason toolNotes is separate: a slow
  // run is not an incomplete one, and folding timing into the headline gate would mark every
  // review "incomplete". It renders in the body instead.
  //
  // WHY the MCP surface carries it at all, when the numbers are already in the JSON envelope: the
  // caller here is an LLM with no terminal and no artifact to open. Asked "did anything time
  // out?", it can answer only from what this string contains. This surface has been the one left
  // out twice -- `ReviewResult.toolAvailability` missed it, and `Finding.locationCheck` missed
  // it and SARIF both -- each time leaving the reader least able to notice as the one not told.
  const timingNotes = (result.timings ?? []).map((t, i, all) => {
    return `⏱️ ${timingLabel(i, all.length)}: ${timingSentence(t)}`
  })

  const notices = [...warnings, ...toolNotes, ...timingNotes]
  const warningBlock = notices.length > 0 ? notices.join('\n') + '\n\n' : ''

  if (findings.length === 0) {
    // Only `warnings` downgrades the headline -- toolNotes still render underneath it, so a
    // degraded tool is reported without being escalated into "the review was incomplete".
    if (warnings.length > 0) {
      return `## AI Code Review — ⚠️ No findings, but the review was incomplete\n\n${warningBlock}`
    }
    // `notices` rather than `toolNotes`: a clean run still has timing to report, and without
    // this the timing block was dropped on exactly the run where "0 findings" most needs
    // qualifying. (Not the only clean-run path -- a run whose agents failed returns above, on
    // `warnings`.) The bare return below now fires only for a result with no timings at all:
    // an archived findings.json from before this field, or a hand-built one.
    if (notices.length > 0) {
      return `## AI Code Review — ✅ No findings\n\n${warningBlock}`
    }
    return '## AI Code Review — ✅ No findings\n'
  }

  const actionable = findings.filter((f) => f.severity === 'critical' || f.severity === 'high')
  // Intentionally trust summary.bySeverity rather than re-counting from findings —
  // summary is the canonical source of truth and keeps medium/low counts correct even
  // if the caller pre-filtered findings.
  const mediumCount = summary.bySeverity.medium ?? 0
  const lowCount = summary.bySeverity.low ?? 0

  if (actionable.length === 0) {
    const tail = buildTail(mediumCount, lowCount)
    return `## AI Code Review — ✅ No critical or high findings\n\n${warningBlock}${tail ? `_${tail}_\n` : ''}`
  }

  const count = actionable.length
  const header = `## AI Code Review — ${count} finding${count === 1 ? '' : 's'}\n\n${warningBlock}`
  const body = actionable.map(renderFinding).join('\n\n')
  const tail = buildTail(mediumCount, lowCount)
  const footer = tail ? `\n\n---\n_${tail}_\n` : '\n'

  return header + body + footer
}

function renderFinding(f: Finding): string {
  const icon = SEVERITY_ICONS[f.severity as 'critical' | 'high']
  // WHY the caveat sits in the heading, immediately after the location it qualifies: this output
  // is consumed by an LLM with no terminal to cross-check against, which makes it the reader least
  // able to notice that a line number is unreliable. toolAvailability had this exact gap -- it was
  // added to the schema and rendered everywhere except here, leaving a partial scan, a missing
  // tool and a clean run indistinguishable to a calling model. Same field, same surface, same fix.
  const unlocated = f.locationCheck === 'mismatch' ? ' · ❓ location unverified' : ''
  const lines = [
    `### ${icon} ${f.severity.toUpperCase()} · ${f.domain ?? f.agent} · \`${f.file}:${f.line}\`${unlocated}`,
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
