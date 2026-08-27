// src/core/evidenceLocation.ts
// Answers one question: does a finding's quoted evidence actually occur at the file:line the
// finding cites?
//
// WHY this is worth a deterministic check rather than better prompting: line attribution has been
// measured unreliable straight from the model (7/5/7 across three trials on one finding, on an
// unchunked diff), and prompt wording has failed to move defect rates here four separate times.
// Two independent real runs motivated this module -- a consumer's review mis-cited 3 of 3 findings,
// one of them naming a different file than the one its evidence came from, and this project's own
// release PR produced three findings whose evidence text contradicts their titles outright.
//
// WHY it only reports and never rewrites the location: the same evidence string frequently occurs
// more than once in a diff -- in the release PR that prompted this, `"version": "1.13.1",` appears
// three times across two files in a 134-line diff. Picking one occurrence would state a location
// with more confidence than the model had, and a confidently-wrong line is worse than a visibly
// wrong one because the reader loses the signal that anything is off.
//
// WHY it never drops the finding: a real finding carrying bad metadata is still a real finding.
// Dropping is the false-negative direction, which this project has repeatedly judged the more
// expensive mistake.

import { splitByFileBoundary } from './diffSplit.js'
import { extractChangedFiles } from './policyFilter.js'
import { normalizeFilePath, stripDiffPrefix } from './filePath.js'
import type { Finding, LocationCheck } from './schema.js'

export type { LocationCheck }

/** file path -> (post-image line number -> line text). */
export type PostImageLineMap = Map<string, Map<number, string>>

const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/

/**
 * Maps each file in the diff to its post-image line numbers.
 *
 * The numbering must come from the hunk header's `+start`, advancing on context and added lines and
 * skipping removed ones. An implementation that instead counts offsets into the diff body looks
 * correct on a hunk with no deletions and silently drifts by one per removed line -- which is
 * exactly the shape of the misattribution this module exists to catch, so the distinction is not
 * academic.
 */
export function buildPostImageLineMap(diff: string): Map<string, Map<number, string>> {
  const byFile = new Map<string, Map<number, string>>()

  for (const section of splitByFileBoundary(diff, 1)) {
    const files = extractChangedFiles(section).map((f) => stripDiffPrefix(normalizeFilePath(f)))
    if (files.length === 0) continue

    const lines = new Map<number, string>()
    let lineNo = 0
    let inHunk = false

    for (const raw of section.split('\n')) {
      const hunk = HUNK_HEADER.exec(raw)
      if (hunk) {
        lineNo = Number(hunk[1])
        inHunk = true
        continue
      }
      if (!inHunk) continue
      // A file header starting a new file inside this section ends the current hunk run.
      if (raw.startsWith('diff --git ') || raw.startsWith('--- ') || raw.startsWith('+++ ')) {
        inHunk = false
        continue
      }
      // Not part of the post-image and carries no line number of its own.
      if (raw.startsWith('\\')) continue

      if (raw.startsWith('-')) continue // removed: consumes no post-image line
      if (raw.startsWith('+') || raw.startsWith(' ') || raw === '') {
        lines.set(lineNo, raw.slice(1))
        lineNo += 1
      }
    }

    if (lines.size === 0) continue
    for (const file of files) {
      // Later hunks for the same path merge rather than replace, so a multi-hunk file keeps every
      // line it showed.
      const existing = byFile.get(file)
      if (existing) {
        for (const [n, text] of lines) existing.set(n, text)
      } else {
        byFile.set(file, new Map(lines))
      }
    }
  }

  return byFile
}

/** Strips a leading diff marker and surrounding whitespace so quoted evidence compares against
 *  post-image text regardless of whether the model echoed the `+`/`-` column. */
function normalizeLine(s: string): string {
  return s.replace(/^[+-]/, '').trim()
}

/** The first line of the evidence that carries any content -- the anchor the check is made on.
 *  Multi-line evidence is common and its later lines add nothing to a location question. */
function evidenceAnchor(evidence: string): string | undefined {
  for (const line of evidence.split('\n')) {
    const normalized = normalizeLine(line)
    if (normalized.length > 0) return normalized
  }
  return undefined
}

/**
 * Checks whether `evidence` occurs at `file`:`line` in `diff`.
 *
 * Fails open to `unknown` wherever the question cannot be answered, matching every other filter in
 * the review pipeline. That matters more than usual here: an unparseable diff must not flag every
 * finding at once, which would turn a parsing bug into a wall of false attribution warnings.
 *
 * @param lineEnd optional inclusive end of a cited range; a match anywhere in `line..lineEnd`
 *                counts, since a finding may legitimately span several lines.
 */
export function checkEvidenceLocation(
  diff: string,
  file: string,
  line: number,
  evidence: string,
  lineEnd?: number
): LocationCheck {
  return checkAgainstMap(buildPostImageLineMap(diff), file, line, evidence, lineEnd)
}

/** The same check against an already-built map. Annotating a whole review parses the diff once
 *  rather than once per finding, which matters because a large diff is parsed here and the
 *  orchestrator already walks every finding several times. */
export function checkAgainstMap(
  byFile: PostImageLineMap,
  file: string,
  line: number,
  evidence: string,
  lineEnd?: number
): LocationCheck {
  const anchor = evidenceAnchor(evidence ?? '')
  if (!anchor) return 'unknown'
  if (byFile.size === 0) return 'unknown'

  const normalized = normalizeFilePath(file)
  const lines = byFile.get(normalized) ?? byFile.get(stripDiffPrefix(normalized))
  if (!lines) return 'unknown'

  const end = lineEnd !== undefined && lineEnd >= line ? lineEnd : line
  let sawAnyCitedLine = false

  for (let n = line; n <= end; n += 1) {
    const text = lines.get(n)
    if (text === undefined) continue
    sawAnyCitedLine = true
    const candidate = normalizeLine(text)
    if (candidate === anchor || candidate.includes(anchor) || anchor.includes(candidate)) {
      return 'verified'
    }
  }

  // The diff never showed the cited line, so the finding may be describing code outside the hunks.
  // That is not evidence of misattribution.
  return sawAnyCitedLine ? 'mismatch' : 'unknown'
}

/**
 * Stamps every finding with whether its evidence occurs where it says it does.
 *
 * Annotates only -- it never reorders, rewrites or removes a finding. The orchestrator runs this
 * last, on the findings that will actually be published, so the stamp describes the report the
 * reader receives.
 */
export function annotateEvidenceLocation(findings: Finding[], diff: string): Finding[] {
  const byFile = buildPostImageLineMap(diff)
  if (byFile.size === 0) return findings
  return findings.map((f) => ({
    ...f,
    locationCheck: checkAgainstMap(byFile, f.file, f.line, f.evidence, f.lineEnd),
  }))
}
