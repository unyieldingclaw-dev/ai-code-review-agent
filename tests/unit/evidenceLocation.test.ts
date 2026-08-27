import { describe, it, expect } from 'vitest'
import { buildPostImageLineMap, checkEvidenceLocation } from '../../src/core/evidenceLocation.js'

// A minimal but realistic diff: one hunk that starts at post-image line 1, containing a
// removed line, so the post-image numbering diverges from the raw diff-body offset. That
// divergence is the whole point of the check -- an offset-based implementation passes the
// happy path and fails here.
const DIFF = `diff --git a/package.json b/package.json
index 3bad677..263ef8f 100644
--- a/package.json
+++ b/package.json
@@ -1,6 +1,6 @@
 {
   "name": "acme",
-  "version": "1.0.0",
+  "version": "1.0.1",
   "description": "a package",
   "type": "module",
   "keywords": [
`

describe('buildPostImageLineMap', () => {
  it('numbers post-image lines from the hunk header, skipping removed lines', () => {
    const map = buildPostImageLineMap(DIFF)
    const pkg = map.get('package.json')
    expect(pkg).toBeDefined()
    expect(pkg?.get(1)).toBe('{')
    expect(pkg?.get(2)).toBe('  "name": "acme",')
    // The removed 1.0.0 line consumes no post-image number; the added line takes 3.
    expect(pkg?.get(3)).toBe('  "version": "1.0.1",')
    expect(pkg?.get(4)).toBe('  "description": "a package",')
    expect(pkg?.get(6)).toBe('  "keywords": [')
  })

  it('returns an empty map for a diff with no parseable hunks', () => {
    expect(buildPostImageLineMap('not a diff at all').size).toBe(0)
  })
})

describe('checkEvidenceLocation', () => {
  it('verifies evidence that really is at the cited line', () => {
    expect(checkEvidenceLocation(DIFF, 'package.json', 3, '  "version": "1.0.1",')).toBe('verified')
  })

  it('flags a mismatch when the evidence sits at a different line in the same file', () => {
    // This is the exact shape of the real defect: the value is present, but two lines up
    // from where the finding says it is.
    expect(checkEvidenceLocation(DIFF, 'package.json', 2, '  "version": "1.0.1",')).toBe('mismatch')
  })

  it('flags a mismatch when the evidence lives in a different file entirely', () => {
    const twoFiles =
      DIFF +
      `diff --git a/other.ts b/other.ts
--- a/other.ts
+++ b/other.ts
@@ -1,2 +1,3 @@
 const a = 1
+const secret = "xyz"
 const b = 2
`
    // Evidence belongs to other.ts but the finding cites package.json -- PMB's worst case.
    expect(checkEvidenceLocation(twoFiles, 'package.json', 3, 'const secret = "xyz"')).toBe(
      'mismatch'
    )
  })

  it('strips diff markers from the quoted evidence before comparing', () => {
    expect(checkEvidenceLocation(DIFF, 'package.json', 3, '+  "version": "1.0.1",')).toBe(
      'verified'
    )
  })

  it('anchors multi-line evidence on its first meaningful line', () => {
    const evidence = '  "version": "1.0.1",\n  "description": "a package",'
    expect(checkEvidenceLocation(DIFF, 'package.json', 3, evidence)).toBe('verified')
  })

  it('accepts a match anywhere within an explicit line range', () => {
    expect(checkEvidenceLocation(DIFF, 'package.json', 1, '  "version": "1.0.1",', 4)).toBe(
      'verified'
    )
  })

  // Fail-open cases: the existing filters in orchestrator.ts all fail open rather than
  // reject when they cannot evaluate something, and this must match, or an unparseable
  // diff would flag every finding at once.
  it('returns unknown when the cited file is absent from the diff', () => {
    expect(checkEvidenceLocation(DIFF, 'nowhere.ts', 3, 'anything')).toBe('unknown')
  })

  it('returns unknown for empty evidence', () => {
    expect(checkEvidenceLocation(DIFF, 'package.json', 3, '   ')).toBe('unknown')
  })

  it('returns unknown when the cited line is outside the hunks shown', () => {
    // Line 900 is not in the diff at all -- the finding may be right about code the diff
    // does not display, so this is not evidence of misattribution.
    expect(checkEvidenceLocation(DIFF, 'package.json', 900, '  "version": "1.0.1",')).toBe(
      'unknown'
    )
  })

  it('returns unknown when the diff cannot be parsed', () => {
    expect(checkEvidenceLocation('garbage', 'package.json', 3, 'x')).toBe('unknown')
  })
})
