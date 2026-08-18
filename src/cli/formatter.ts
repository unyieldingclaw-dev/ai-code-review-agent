import type { ReviewResult, Severity, ToolAvailabilityMetadata } from '../core/schema.js'
export { formatSarif } from './formatters/sarif.js'
export { formatGithubAnnotations } from './formatters/githubAnnotations.js'

const SEVERITY_EMOJI: Record<Severity, string> = {
  critical: '🔴',
  high: '🟠',
  medium: '🟡',
  low: '🔵',
}

const SEVERITY_TEXT: Record<Severity, string> = {
  critical: '[CRITICAL]',
  high: '[HIGH]',
  medium: '[MEDIUM]',
  low: '[LOW]',
}

export function formatMarkdown(result: ReviewResult, options?: { noEmoji?: boolean }): string {
  const useEmoji = !options?.noEmoji
  const sevLabel = (s: Severity) => (useEmoji ? SEVERITY_EMOJI[s] : SEVERITY_TEXT[s])

  const { findings, testFiles, summary, agentStatus, truncation } = result
  const lines: string[] = []

  const failedAgents = Object.entries(agentStatus ?? {}).filter(([, status]) => status !== 'ok')
  const totalAgents = Object.keys(agentStatus ?? {}).length

  lines.push('# AI Code Review Report')
  lines.push('')
  lines.push(
    `**${summary.totalFindings} finding${summary.totalFindings === 1 ? '' : 's'}** | ${summary.durationMs}ms`
  )
  lines.push('')

  if (truncation?.truncated) {
    lines.push(
      `${useEmoji ? '⚠️ ' : ''}Diff truncated: reviewed ${truncation.keptLines}/${truncation.originalLines} lines — ` +
        `findings past this point were never analyzed. Raise --max-lines to review the full diff.`
    )
    lines.push('')
  }

  if (result.hallucinationFilter && result.hallucinationFilter.dropped.length > 0) {
    lines.push(
      `${useEmoji ? '🔍 ' : ''}Hallucination filter: ${result.hallucinationFilter.dropped.length} finding(s) dropped — referenced file(s) not present in the reviewed diff.`
    )
    lines.push('')
  }

  if (result.coverageGapFilter && result.coverageGapFilter.dropped.length > 0) {
    lines.push(
      `${useEmoji ? '🔍 ' : ''}Coverage gap filter: ${result.coverageGapFilter.dropped.length} coverage gap(s) dropped — referenced file(s) not present in the reviewed diff.`
    )
    lines.push('')
  }

  if (result.evidenceCheckFilter) {
    const { checkedCount, unavailableCount, unavailableReasons, flagged } =
      result.evidenceCheckFilter
    lines.push(
      `${useEmoji ? '🔍 ' : ''}Evidence check: ${checkedCount} finding(s) checked` +
        (flagged.length > 0
          ? `, ${flagged.length} flagged as possibly unsupported by their own cited evidence`
          : ', none flagged') +
        (unavailableCount > 0
          ? `, ${unavailableCount} unavailable (verifier could not be reached)`
          : '') +
        '.'
    )
    if (unavailableReasons.length > 0) {
      lines.push(`  ${unavailableReasons.join('; ')}`)
    }
    for (const f of flagged) {
      lines.push(
        `  - **${f.title}** (${f.file}:${f.line}, ${f.agent}) — ${f.reason}` +
          (f.preFilterAgreed === true ? ' [deterministic pre-filter agreed]' : '')
      )
    }
    lines.push('')
  }

  // WHY key off ToolAvailabilityMetadata's own keys instead of a second hand-typed literal union:
  // this and the array below used to each independently list the same 3 tool keys, which could
  // silently drift apart (e.g. a new tool integration added to the schema but forgotten here).
  // Deriving the iteration list from this object's own keys means there's exactly one place that
  // enumerates them.
  const TOOL_LABELS: Record<keyof ToolAvailabilityMetadata, string> = {
    gitleaks: 'gitleaks',
    npmAudit: 'npm audit',
    lizard: 'lizard',
  }
  const degradedTools = (Object.keys(TOOL_LABELS) as (keyof ToolAvailabilityMetadata)[]).filter(
    (t) => result.toolAvailability?.[t] === 'unavailable-llm-fallback'
  )
  if (degradedTools.length > 0) {
    const names = degradedTools.map((t) => TOOL_LABELS[t]).join(', ')
    // WHY not "falling back to LLM-only": true for gitleaks/npm-audit (they replace the LLM call
    // entirely when the tool is available) but false for lizard (ComplexityAgent always calls the
    // LLM -- lizard only augments the prompt when present). This message covers whichever tools
    // are degraded, so it must stay accurate under both semantics.
    lines.push(
      `${useEmoji ? '🔧 ' : ''}Degraded mode: ${names} not installed — the affected agent(s) ran ` +
        `without it, which may reduce finding accuracy. Install the missing tool(s) for more ` +
        `reliable results.`
    )
    lines.push('')
  }

  if (failedAgents.length > 0) {
    lines.push(
      `${useEmoji ? '⚠️ ' : ''}${failedAgents.length}/${totalAgents} agents failed — results incomplete`
    )
    lines.push('')
    for (const [name, status] of failedAgents) {
      const advice =
        status === 'timeout'
          ? 'raise --timeout or reduce --max-lines'
          : status === 'parse-error'
            ? 'diff likely too large for this model'
            : 'see stderr for details'
      lines.push(`- \`${name}\`: ${status} — ${advice}`)
    }
    lines.push('')
  }

  if (findings.length === 0) {
    if (failedAgents.length === 0) {
      // WHY qualify this when truncated (not just rely on the standalone warning above): the
      // warning and this line are visually separate, and a reader who skims to the bottom line
      // for a pass/fail verdict -- the exact way this line is designed to be read -- can miss the
      // warning above entirely. A real bug report: a 12,599-line diff truncated to 2,000
      // (--max-lines default) still ended in an unqualified "No issues found," reading as a clean
      // full pass when only ~16% of the diff was actually reviewed.
      lines.push(
        truncation?.truncated
          ? `${useEmoji ? '✅ ' : ''}No issues found in the portion reviewed (${truncation.keptLines}/${truncation.originalLines} lines — diff was truncated).`
          : useEmoji
            ? '✅ No issues found.'
            : 'No issues found.'
      )
    }
    return lines.join('\n')
  }

  const bySeverity = groupBy(findings, (f) => f.severity)
  for (const severity of ['critical', 'high', 'medium', 'low'] as Severity[]) {
    const group = bySeverity.get(severity)
    if (!group?.length) continue
    lines.push(`## ${sevLabel(severity)} ${capitalize(severity)} (${group.length})`)
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
    lines.push(`## ${useEmoji ? '🧪 ' : ''}Generated Test Files (${testFiles.length})`)
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
