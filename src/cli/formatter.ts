import type { ReviewResult, Severity } from '../core/schema.js'
import { TOOL_LABELS, toolsWithAvailability } from '../core/schema.js'
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
        // Advice deliberately matches runner.ts's stderr hint, which PR #33 corrected to recommend
        // --chunk FIRST: chunking reviews the whole diff while keeping each pass at maxDiffLines,
        // whereas raising --max-lines grows a single prompt, which on CPU-offloaded hardware is
        // what pushes agents past their timeout. This copy was missed by that fix and still
        // recommended the option that makes the other failure worse -- two hints in the same run
        // giving opposite advice, three lines apart in the report.
        `findings past this point were never analyzed. Use --chunk to review the whole diff in ` +
        `same-size passes, or raise --max-lines to review it in one larger pass (slower per ` +
        `agent, and more likely to time out).`
    )
    lines.push('')
  }

  if (result.hallucinationFilter && result.hallucinationFilter.dropped.length > 0) {
    // WHY grouped by reason: this sink has two writers with unrelated causes --
    // filterNonexistentFiles (file absent from the diff) and filterUnsupportedClaims (file IS in
    // the diff, but its claimed mechanism has no supporting syntax). A single hardcoded sentence
    // reported every claim-support drop as "referenced file not present", which was factually
    // false for all of them. Findings carry `reason` only for the latter, so an absent `reason`
    // means the file-existence filter dropped it.
    const dropped = result.hallucinationFilter.dropped
    const REASON_TEXT: Record<string, string> = {
      'unsupported-injection-claim': 'no dynamic query/command construction in the file',
      'unsupported-exception-claim': 'no exception-handling construct in the file',
      'unsupported-null-error-claim': 'SQL NULL comparison yields no match, not an error',
    }
    const byReason = new Map<string, number>()
    for (const d of dropped) {
      const key = d.reason
        ? (REASON_TEXT[d.reason] ?? d.reason)
        : 'referenced file(s) not present in the reviewed diff'
      byReason.set(key, (byReason.get(key) ?? 0) + 1)
    }
    lines.push(`${useEmoji ? '🔍 ' : ''}Hallucination filter: ${dropped.length} finding(s) dropped`)
    for (const [reason, count] of byReason) {
      lines.push(`  - ${count} — ${reason}`)
    }
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

  // TOOL_LABELS and this lookup live in schema.ts, next to the interface they key off -- see the
  // comment there for why a per-formatter copy is a drift hazard rather than a convenience.
  const degradedTools = toolsWithAvailability(result.toolAvailability, 'unavailable-llm-fallback')
  // WHY a separate note rather than folding 'partial' into the degraded list: the degraded message
  // below says the tool is not installed and tells the reader to install it. For a partial scan
  // that advice is wrong -- the tool is installed and did run; what needs attention is the files it
  // could not cover, whose findings came from the model instead.
  const partialTools = toolsWithAvailability(result.toolAvailability, 'partial')
  if (partialTools.length > 0) {
    const names = partialTools.map((t) => TOOL_LABELS[t]).join(', ')
    lines.push(
      `${useEmoji ? '🔧 ' : ''}Partial scan: ${names} ran but could not cover every changed ` +
        `file — the affected agent(s) also ran the LLM over the diff so nothing was left ` +
        `unscanned. Findings for the skipped files come from the model, not the tool.`
    )
    lines.push('')
  }

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
      //
      // WHY the glyph is ⚠️ and the line leads with INCOMPLETE rather than keeping ✅ with
      // qualifying text after it: qualifying text was the first fix, and it was not enough. A
      // second report (10,039-line diff, 2,000 reviewed) still read the result as a pass, because
      // a green check is absorbed before the sentence next to it -- the glyph IS the verdict for a
      // skimming reader, and it was contradicting its own caption. mcp/formatter.ts already refuses
      // to render a truncated run as clean; this brings the CLI in line with it, so the same state
      // does not report two different verdicts depending on which surface you read.
      lines.push(
        truncation?.truncated
          ? `${useEmoji ? '⚠️ ' : ''}INCOMPLETE — reviewed ${truncation.keptLines}/${truncation.originalLines} lines. ` +
              `No issues found in that portion; the remaining ${truncation.originalLines - truncation.keptLines} ` +
              `lines were never analyzed. Re-run with --chunk for full coverage.`
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
      // WHY corroboratingAgents is surfaced here: deduplicate() merges same-location findings from
      // multiple agents into the highest-priority agent's finding, recording the others in this
      // field -- but nothing ever rendered it. From the outside a run whose progress lines said
      // "security 4 findings, adversarial 1 finding" then printed 4 findings all labelled
      // `Agent: security` looked like the adversarial finding had been silently lost, when it had
      // actually corroborated one of them (and, via hallucinationCrossCheck, is why that one kept
      // its severity while uncorroborated siblings were downgraded). Reported as a suspected
      // aggregation bug from a live run; the aggregation was correct, the reporting was not.
      const corroborated = f.corroboratingAgents?.length
        ? ` | **Corroborated by:** ${f.corroboratingAgents.join(', ')}`
        : ''
      // WHY mark the location rather than quietly leave a wrong one: the cited line is what a
      // reader clicks and what SARIF and the GitHub annotations consume, and it has been measured
      // wrong often -- one real run mis-cited all 6 of its findings, another 3 of 3, once naming a
      // different file than its evidence came from. The finding may still be real, so it is
      // neither dropped nor relocated (the same evidence string frequently occurs several times in
      // one diff, so picking an occurrence would assert more than was established); the reader is
      // simply told not to trust the number. Only 'mismatch' renders -- 'unknown' means the check
      // had no opinion, and printing that would be noise on every unparseable diff.
      const located =
        f.locationCheck === 'mismatch'
          ? ` | ${useEmoji ? '❓ ' : ''}**Location unverified** (evidence not found at this line)`
          : ''
      lines.push(
        `**Agent:** ${f.agent} | **Basis:** ${f.basis} | **Confidence:** ${conf}% | **File:** \`${f.file}:${f.line}\`${corroborated}${located}`
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
