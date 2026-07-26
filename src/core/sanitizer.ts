interface InjectionPattern {
  pattern: RegExp
  label: string
}

const INJECTION_PATTERNS: InjectionPattern[] = [
  { pattern: /SYSTEM:/i, label: 'SYSTEM: directive' },
  { pattern: /ignore\s+(?:all\s+)?previous\s+instructions?/i, label: 'instruction override' },
  {
    pattern: /you\s+are\s+now\s+(?:a\s+|an\s+)?[\w\s]{1,30}(?:AI|assistant|bot|model)/i,
    label: 'role reassignment',
  },
  {
    // Requires the "act as a/an ..." phrase to actually target an AI/assistant role, not just
    // any generic "act as a X" turn of phrase (e.g. "acts as a validator" in a code comment) --
    // confirmed as a real false positive against this repo's own memory-bank docs.
    pattern: /act\s+as\s+(?:a|an)\s+[\w\s]{1,30}(?:AI|assistant|bot|model)/i,
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
  { pattern: /[A-Za-z0-9+/]{80,}={0,2}/, label: 'potential base64 payload' },
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

    for (const { pattern, label } of INJECTION_PATTERNS) {
      if (pattern.test(redactedLine)) {
        warnings.push(`Prompt injection pattern detected (${label}): ${line.slice(0, 100)}`)
        // Replace all occurrences of this pattern using a global version of the regex
        const globalPat = new RegExp(pattern.source, 'gi')
        redactedLine = redactedLine.replace(globalPat, '[REDACTED]')
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
