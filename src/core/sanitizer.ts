interface InjectionPattern {
  pattern: RegExp
  label: string
  // Optional per-match filter: given the line being scanned and the *original* (pre-redaction)
  // start offset of a match, return true to skip that specific occurrence. Used for known
  // false-positive shapes that a regex alone can't exclude (e.g. an SRI integrity hash, which
  // is structurally identical to the base64-payload pattern this project needs to catch).
  isFalsePositive?: (line: string, matchOffset: number) => boolean
}

// WHY offset-based context checks instead of a lookbehind: a naive negative-lookbehind
// (`(?<!sha(?:256|384|512)-)...`) was tried and empirically proven not to work here -- the
// regex engine can find an alternate match-start position a few characters later that isn't
// itself immediately preceded by the excluded prefix, bypassing the lookbehind entirely.
// Checking the text preceding the actual match offset in plain code, after the match is found,
// doesn't have that escape hatch.
function precededBySriPrefix(line: string, matchOffset: number): boolean {
  const before = line.slice(Math.max(0, matchOffset - 10), matchOffset)
  return /sha(?:256|384|512)-$/i.test(before)
}

const INJECTION_PATTERNS: InjectionPattern[] = [
  { pattern: /SYSTEM:/i, label: 'SYSTEM: directive' },
  { pattern: /ignore\s+(?:all\s+)?previous\s+instructions?/i, label: 'instruction override' },
  {
    pattern: /you\s+are\s+now\s+(?:a\s+|an\s+)?[\w\s]{1,30}(?:AI|assistant|bot|model)/i,
    label: 'role reassignment',
  },
  {
    // Requires the "act as ..." phrase to target either an explicit AI/assistant role, or one
    // of several well-known jailbreak framings that don't use an AI-labeled noun ("act as DAN",
    // "act as a Linux terminal"). An earlier version required an AI/assistant/bot/model word
    // directly and correctly stopped false-positiving on ordinary phrases like "acts as a
    // validator" -- but a later review found it also missed both of the jailbreak phrasings
    // above, which the broader original pattern used to catch. This keeps the fix (still
    // requires one of a specific set of trailing words, not just any noun) while covering both.
    pattern:
      /act\s+as\s+(?:a\s+|an\s+)?[\w\s]{0,30}\b(?:AI|assistant|bot|model|DAN|terminal|hacker|unrestricted|unfiltered|jailbroken)\b/i,
    label: 'role-play directive',
  },
  { pattern: /pretend\s+(?:you\s+are|to\s+be)\s+/i, label: 'role-play directive' },
  { pattern: /forget\s+(?:your|all)\s+(?:previous|prior)\s+/i, label: 'instruction wipe' },
  { pattern: /disregard\s+(?:the\s+)?(?:previous|prior|above)\s+/i, label: 'instruction wipe' },
  {
    pattern: /new\s+(?:role|persona|system\s+prompt|instructions?)\s*:/i,
    label: 'persona injection',
  },
  { pattern: /\[\[INSTRUCTIONS?\]\]/i, label: 'instruction tag' },
  {
    pattern: /[A-Za-z0-9+/]{80,}={0,2}/,
    label: 'potential base64 payload',
    // A subresource-integrity hash (integrity="sha256-<base64>") is structurally identical to
    // a base64 payload -- confirmed false-positiving on real SRI hashes in an earlier review.
    isFalsePositive: precededBySriPrefix,
  },
]

export interface SanitizeResult {
  sanitized: string
  applied: boolean
  redactedLines: number
  warnings: string[]
}

function sanitizeLines(lines: string[], shouldScan: (line: string) => boolean): SanitizeResult {
  const warnings: string[] = []
  let redactedLines = 0
  const sanitizedLines = lines.map((line) => {
    if (!shouldScan(line)) return line

    let redactedLine = line
    let wasRedacted = false

    for (const { pattern, label, isFalsePositive } of INJECTION_PATTERNS) {
      const globalPat = new RegExp(pattern.source, 'gi')
      let matchedThisPattern = false
      // None of INJECTION_PATTERNS' regexes use capturing groups, so replace()'s callback
      // signature is reliably (match, offset, string) -- offset is the match's start position
      // in the *current* redactedLine (the value being read here, before this call reassigns
      // it), which is exactly what isFalsePositive needs to inspect preceding context.
      redactedLine = redactedLine.replace(globalPat, (match: string, offset: number) => {
        if (isFalsePositive?.(redactedLine, offset)) return match
        matchedThisPattern = true
        return '[REDACTED]'
      })
      if (matchedThisPattern) {
        warnings.push(`Prompt injection pattern detected (${label}): ${line.slice(0, 100)}`)
        wasRedacted = true
      }
    }

    if (wasRedacted) redactedLines++
    return redactedLine
  })

  return {
    sanitized: sanitizedLines.join('\n'),
    applied: redactedLines > 0,
    redactedLines,
    warnings,
  }
}

/**
 * Scans added lines in a diff for LLM prompt-injection patterns.
 * Only lines starting with '+' (not '+++') are scanned — removed and
 * context lines are passed through unchanged.
 */
export function sanitizeDiff(diff: string): SanitizeResult {
  return sanitizeLines(diff.split('\n'), (line) => line.startsWith('+') && !line.startsWith('+++'))
}

/**
 * Scans every line of arbitrary text (e.g. memory-bank context prepended to an agent's
 * prompt) for the same LLM prompt-injection patterns as sanitizeDiff. Unlike sanitizeDiff,
 * there's no '+'-prefix convention here -- this isn't a diff, so every line is scanned.
 */
export function sanitizeText(text: string): SanitizeResult {
  return sanitizeLines(text.split('\n'), () => true)
}
