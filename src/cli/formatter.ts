import type { ReviewResult, Severity } from '../core/schema.js'
import {
  TOOL_LABELS,
  toolsWithAvailability,
  agentsRanCount,
  agentsPlannedCount,
  earlyExitLostCoverage,
  missedChunks,
  isIncomplete,
} from '../core/schema.js'
import { timingLabel, timingSentence } from '../core/timingReport.js'
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

  const { findings, testFiles, summary, agentStatus, truncation, earlyExit } = result
  const lines: string[] = []

  const failedAgents = Object.entries(agentStatus ?? {}).filter(([, status]) => status !== 'ok')
  const agentsRan = agentsRanCount(result)
  // WHY the denominator is `agentsPlanned` and not `agentsRan`: agentStatus holds only agents
  // that actually ran, so on an early exit it shrinks in step with the numerator and renders
  // "3/3 agents" for a run that skipped twelve -- a claim of full coverage inside the banner
  // that exists to deny it. Falling back to agentsRan keeps pre-field results (an archived
  // findings.json, a hand-built fixture) rendering as before rather than showing "3/undefined";
  // that fallback reproduces the old wrong denominator, which is why `incomplete` below is
  // gated on earlyExit directly and never on the ratio.
  const totalAgents = agentsPlannedCount(result)

  // Built once and pushed on BOTH exit paths, because the no-findings path below returns early
  // -- and a run that found nothing is exactly when this block earns its place. "0 findings"
  // and "0 findings because every agent hit the ceiling" are the two states this whole field
  // exists to separate, and the second one only ever reaches the early-return path.
  //
  // The other footers (sanitizer, context, policy) remain on the findings path only. That is
  // pre-existing behaviour, not a decision recorded anywhere, and it is arguably wrong for the
  // sanitizer footer at least -- redactedLines is a measured count that a 0-finding run
  // currently drops. Left alone here rather than changed in passing.
  const timingLines = buildTimingLines(result)

  lines.push('# AI Code Review Report')
  lines.push('')
  // WHY the headline itself carries incompleteness rather than leaving it to the banner below:
  // this is the same lesson #51 learned for the no-findings path, applied to the case it missed.
  // There, a ✅ next to qualifying text still read as a pass, so the glyph was replaced outright
  // -- "the glyph IS the verdict for a skimming reader". A findings count is a verdict in exactly
  // the same way: "15 findings" states a result, and a reader who takes it at face value has no
  // reason to suspect 70% of the diff was never looked at.
  //
  // Measured 2026-08-30, which is why this is not a style preference: a 6,578-line diff at default
  // --max-lines reviewed 2,000 lines and reported 0 findings; the same diff with --chunk returned
  // 15 findings including 2 High. The truncation banner fired correctly and three times over, and
  // the reader still concluded clean, because they read the top line and grepped for the rest. A
  // control that depends on attention is not a control.
  // WHY this gates on failed agents as well as truncation: they are the same defect wearing two
  // hats -- part of the diff never reviewed, versus part of the REVIEW never performed. A reader
  // cannot act on either from a headline that states a plain count. The first version of this fix
  // gated on truncation alone, which made the CLI the only one of four surfaces calling such a run
  // complete: mcp/formatter.ts says INCOMPLETE (it gates on `warnings`, which carries both),
  // sarif.ts sets executionSuccessful=false, githubAnnotations.ts emits a ::warning:: per agent,
  // and cli/index.ts:421 sets exit code 2 -- so the process called the run degraded while its own
  // headline called it complete. That is precisely the cross-surface disagreement the test named
  // "does not render a truncated run as clean on ANY surface" exists to forbid.
  // WHY earlyExit and a short chunk loop join this gate: they are the same defect wearing a third
  // and fourth hat. Truncation is "part of the diff never reviewed"; a failed agent is "part of
  // the review never performed"; --fail-fast is "the rest of the review deliberately abandoned",
  // and a chunk loop that broke is both at once. The reader cannot act on any of them from a
  // headline stating a plain count, and the agents that never ran are ABSENT from agentStatus
  // rather than failed -- so `failedAgents.length` is 0 and the first two terms cannot see them.
  const chunksMissed = missedChunks(result)
  const incomplete = isIncomplete(result)
  const countText = `**${summary.totalFindings} finding${summary.totalFindings === 1 ? '' : 's'}**`
  // The numerator is `agentsRan`, NOT `totalAgents`. It was written as
  // `totalAgents - failedAgents.length` back when totalAgents WAS the count of agents that ran,
  // so the two were the same number; repointing the denominator at agentsPlanned without this
  // would render "15/15 agents that completed" for a run that executed three -- the identical
  // false claim, inverted.
  //
  // An UNKNOWN roster states no ratio at all. When `agentsPlanned` is absent -- an archived
  // findings.json, a hand-built fixture -- `agentsPlannedCount` falls back to the count that ran,
  // making the denominator tautologically equal the numerator: "from 3/3 agents that completed"
  // printed beside an INCOMPLETE headline, which is the self-contradiction this change exists to
  // remove. A missing number is reported as missing, never as agreement.
  // The fallback denominator is trustworthy exactly when nothing was skipped: on a run that
  // merely had agents FAIL, agentStatus holds the whole roster, so "1/3 agents that completed" is
  // both correct and useful and predates this change. It is only an early exit that makes
  // agentStatus a PREFIX of the roster, and only then does the fallback assert its own denominator.
  const rosterKnown = result.agentsPlanned !== undefined || result.earlyExit === undefined
  const scope = truncation?.truncated
    ? `in ${truncation.keptLines}/${truncation.originalLines} lines reviewed`
    : chunksMissed
      ? `in ${chunksMissed.reviewed}/${chunksMissed.total} chunks reviewed`
      : rosterKnown
        ? `from ${agentsRan - failedAgents.length}/${totalAgents} agents that completed`
        : ''
  lines.push(
    incomplete
      ? `${useEmoji ? '⚠️ ' : ''}INCOMPLETE — ${countText}${scope ? ` ${scope}` : ''} | ${summary.durationMs}ms`
      : `${countText} | ${summary.durationMs}ms`
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

  // WHY here and not with the sanitizer/context/policy footers further down: those render on the
  // findings path only, and this banner is needed most on the path they miss -- a fail-fast run
  // that stopped before anything survived the orchestrator returns 0 findings and exits early,
  // which is exactly when "clean" is most misleading. Placed alongside the truncation banner for
  // the same reason it is: both are pushed before the no-findings early return.
  //
  // WHY this lives in formatMarkdown rather than cli/index.ts, which appended an equivalent
  // blockquote after the fact: a footer bolted on by one caller is invisible to every other one.
  // The VS Code extension and any library consumer call formatMarkdown directly and got nothing,
  // and index.ts skipped its own footer for three of the four --format values.
  // Gated on lost coverage, not on the field: fail-fast can trip on the LAST agent, in which
  // case nothing was skipped and there is nothing to warn about.
  if (earlyExit && earlyExitLostCoverage(result)) {
    const notRun = totalAgents - agentsRan
    lines.push(
      `${useEmoji ? '⚡ ' : ''}Fail-fast: the swarm stopped after \`${earlyExit.stoppedAt}\` ` +
        `because a finding met the --fail-on threshold` +
        (rosterKnown && notRun > 0 ? `, so ${notRun} of ${totalAgents} agents never ran` : '') +
        `. This is not a full review — re-run without --fail-fast for complete coverage.`
    )
    lines.push('')
  }

  if (chunksMissed) {
    lines.push(
      `${useEmoji ? '⚠️ ' : ''}Chunked run stopped early: ${chunksMissed.reviewed} of ` +
        `${chunksMissed.total} chunks were reviewed, so part of the diff was never analyzed.`
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
        `file. ` +
        // WHY this sentence is conditional: 'partial' now has two producers with different
        // meanings. SecretsAgent sets it when the tool skipped files the LLM still reviewed --
        // there, "nothing was left unscanned" is true. chunkRunner sets it when whole chunks were
        // never reviewed by anything, and asserting the LLM covered the gap is then false, two
        // lines below a banner saying part of the diff was never analyzed. Same status, opposite
        // claim; the text has to follow the cause rather than the field.
        (chunksMissed
          ? `Part of the diff was never reviewed at all, so those files were seen by neither the ` +
            `tool nor the model.`
          : `The affected agent(s) also ran the LLM over the diff, so nothing was left unscanned. ` +
            `Findings for the skipped files come from the model, not the tool.`)
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
      //
      // The same reasoning extends to earlyExit and a short chunk loop, and it had to: this
      // branch gated on truncation alone, so a --fail-fast run that surfaced nothing reached the
      // bare "✅ No issues found." while the headline above already said INCOMPLETE. One report,
      // two verdicts, eight lines apart — the same contradiction #51 fixed across surfaces,
      // reappearing inside a single one.
      lines.push(
        truncation?.truncated
          ? `${useEmoji ? '⚠️ ' : ''}INCOMPLETE — reviewed ${truncation.keptLines}/${truncation.originalLines} lines. ` +
              `No issues found in that portion; the remaining ${truncation.originalLines - truncation.keptLines} ` +
              `lines were never analyzed. Re-run with --chunk for full coverage.`
          : earlyExit && earlyExitLostCoverage(result)
            ? `${useEmoji ? '⚠️ ' : ''}INCOMPLETE — the swarm stopped after \`${earlyExit.stoppedAt}\`. ` +
              `No issues found by the ${agentsRan} agent(s) that ran; ` +
              (rosterKnown
                ? `the other ${totalAgents - agentsRan} never ran. `
                : `the rest never ran. `) +
              `Re-run without --fail-fast for full coverage.`
            : chunksMissed
              ? `${useEmoji ? '⚠️ ' : ''}INCOMPLETE — reviewed ${chunksMissed.reviewed}/${chunksMissed.total} ` +
                `chunks. No issues found in that portion; the rest of the diff was never analyzed.`
              : useEmoji
                ? '✅ No issues found.'
                : 'No issues found.'
      )
    }
    lines.push(...timingLines)
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

  lines.push(...timingLines)

  return lines.join('\n')
}

function buildTimingLines(result: ReviewResult): string[] {
  if (!result.timings || result.timings.length === 0) return []
  // The leading '' is load-bearing, not spacing. In CommonMark a line of '---' directly beneath
  // a paragraph is a setext heading UNDERLINE, not a thematic break -- so without the blank line
  // this block silently promoted whatever preceded it to an <h2> and swallowed its own rule.
  // What preceded it on the no-findings path is the verdict line ("No issues found." /
  // "INCOMPLETE - reviewed 2000/12599 lines"), which two separate commits were spent getting
  // right precisely because a skimming reader treats it as THE result.
  //
  // The sanitizer footer above happens to push '' first and so is safe; the context and policy
  // footers between them do not, and exhibit this same bug today. Left alone as pre-existing
  // rather than fixed in passing, but they are the same one-line change.
  const lines = ['', '---']
  for (const [i, t] of result.timings.entries()) {
    // Labelled per run because under --chunk each row is a separate agent-timeout budget. A
    // reader given one merged number cannot tell a slow review from agents nearing their ceiling
    // -- different problems with different fixes (--chunk vs --timeout).
    lines.push(`*${timingLabel(i, result.timings.length)}: ${timingSentence(t)}*`)
  }
  lines.push('*Full per-agent timings are in the `--format json` output.*')
  return lines
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
