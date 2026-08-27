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

  // WHY a mismatched location drops `line` instead of keeping it or dropping the annotation:
  // an annotation is a mechanical file:line write, so a wrong line renders the finding on
  // unrelated code -- a reader sees a security warning pinned to whatever happens to sit there.
  // That is the same harm as the unresolvable paths fixed earlier, one level in: there the
  // annotation landed nowhere, here it lands somewhere wrong, which is worse because it looks
  // deliberate. Suppressing the annotation entirely would instead hide a finding that may well
  // be real -- only its line is in doubt. GitHub accepts `file=` with no `line=` and attaches
  // the annotation to the file, which says exactly what is known and nothing more.
  const unlocated = f.locationCheck === 'mismatch'
  const baseMessage = f.recommendation || f.detail
  const message = escapeAnnotationValue(
    unlocated
      ? `${baseMessage} [Location unverified — the quoted evidence was not found at the cited line, so this is attached to the file rather than a line.]`
      : baseMessage
  )
  const endLine = f.lineEnd ? `,endLine=${f.lineEnd}` : ''
  const location = unlocated ? '' : `,line=${f.line}${endLine}`
  return `::${level} file=${f.file}${location},title=${title}::${message}`
}

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
