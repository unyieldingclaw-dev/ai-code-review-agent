// GitHub Actions annotation output format.
// Emits GitHub Actions workflow command annotation syntax.
// Intended for use inside GitHub Actions — findings appear inline in PR diffs.
// One line per finding: ::level file=...,line=...,title=...::message
// Plus one ::warning:: line per failed agent (agentStatus !== 'ok'), and one ::warning:: line
// if the diff was truncated -- both emitted before the finding lines, so a run with failed
// agents or a truncated diff is never indistinguishable from a clean, fully-analyzed one.

import type { ReviewResult, Finding, Severity } from '../../core/schema.js'

function severityToAnnotationLevel(severity: Severity): 'error' | 'warning' | 'notice' {
  if (severity === 'critical' || severity === 'high') return 'error'
  if (severity === 'medium') return 'warning'
  return 'notice'
}

function escapeAnnotationValue(value: string): string {
  // GitHub Actions annotation values must not contain newlines or colons in the
  // property section. Escape newlines to prevent command injection via finding text.
  return value.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A').replace(/:/g, '%3A')
}

function findingToAnnotation(f: Finding): string {
  const level = severityToAnnotationLevel(f.severity)
  const title = escapeAnnotationValue(f.title)

  // WHY a mismatched location keeps `line` and warns in the message, rather than omitting `line`:
  // omitting it does NOT produce a file-level annotation. Every annotation property is optional,
  // but `line` documents a default of 1 -- so dropping it silently repins the finding to line 1
  // instead of detaching it. That is worse than leaving the model's line alone, because GitHub
  // only renders an annotation inline when its line falls inside the diff: line 1 usually does
  // not, so the annotation drops out of the Files-changed view into the Checks tab. That is
  // exactly the "annotations silently land nowhere" harm that resolving finding paths fixed.
  //
  // So the line stays where the finding put it -- inside the diff, where the reader is looking --
  // and the message says not to trust it. The caveat leads rather than trails because annotation
  // messages are clipped in some views, and a warning the reader never scrolls to is not a
  // warning. Suppressing the annotation was the third option and is worse still: the finding may
  // be real, and only its line is in doubt.
  const unlocated = f.locationCheck === 'mismatch'
  const baseMessage = f.recommendation || f.detail
  const message = escapeAnnotationValue(
    unlocated
      ? `[Location unverified — the quoted evidence was not found at this line; treat the line number as unreliable.] ${baseMessage}`
      : baseMessage
  )
  const endLine = f.lineEnd ? `,endLine=${f.lineEnd}` : ''
  return `::${level} file=${f.file},line=${f.line}${endLine},title=${title}::${message}`
}

// `result.timings` is DELIBERATELY not rendered here, and this comment exists so the next reader
// can tell that from an oversight -- `ReviewResult.toolAvailability` and `Finding.locationCheck`
// each reached some surfaces and silently missed others, which is why every new field is now
// checked against all four formatters.
//
// This is an exception to a rule written without exceptions, so the reasons are on the record:
//   1. Annotations are per-finding review comments on a PR. Timing is a diagnostic about the run,
//      not a defect in the code under review, and a ::notice:: on every PR is noise charged to
//      every reader to serve the rare one investigating the timeout ceiling.
//   2. The actionable half of the signal is already on this surface. An agent that hits the
//      ceiling is `agentStatus.<name> === 'timeout'`, which already emits a ::warning:: line
//      below. What `timings` adds beyond that is measurement, not a call to action.
//   3. The readers who can act on the measurement reach it elsewhere: the markdown and MCP
//      reports render it, SARIF carries it machine-read in run properties, and `--format json`
//      passes the raw field through to the findings.json CI archives.
// Revisit only if a PR reviewer turns out to need per-run timings inline in a diff.
export function formatGithubAnnotations(result: ReviewResult): string {
  const failedAgents = Object.entries(result.agentStatus ?? {}).filter(
    ([, status]) => status !== 'ok'
  )
  const warningLines = failedAgents.map(
    ([name, status]) => `::warning::Agent ${name} failed (${status}) — results may be incomplete`
  )
  const truncationLines = result.truncation?.truncated
    ? [
        `::warning::Diff truncated: reviewed ${result.truncation.keptLines}/${result.truncation.originalLines} lines — results may be incomplete`,
      ]
    : []
  const findingLines = result.findings.map(findingToAnnotation)
  return [...warningLines, ...truncationLines, ...findingLines].join('\n')
}
