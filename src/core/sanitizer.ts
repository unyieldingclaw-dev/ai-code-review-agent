interface InjectionPattern {
  pattern: RegExp
  label: string
}

const INJECTION_PATTERNS: InjectionPattern[] = [
  { pattern: /SYSTEM:/i, label: 'SYSTEM: directive' },
  { pattern: /ignore\s+(?:all\s+)?previous\s+instructions?/i, label: 'instruction override' },
  { pattern: /you\s+are\s+now\s+(?:a\s+|an\s+)?[\w\s]{1,30}(?:AI|assistant|bot|model)/i, label: 'role reassignment' },
  { pattern: /act\s+as\s+(?:a|an)\s+/i, label: 'role-play directive' },
  { pattern: /pretend\s+(?:you\s+are|to\s+be)\s+/i, label: 'role-play directive' },
  { pattern: /forget\s+(?:your|all)\s+(?:previous|prior)\s+/i, label: 'instruction wipe' },
  { pattern: /disregard\s+(?:the\s+)?(?:previous|prior|above)\s+/i, label: 'instruction wipe' },
  { pattern: /new\s+(?:role|persona|system\s+prompt|instructions?)\s*:/i, label: 'persona injection' },
  { pattern: /\[\[INSTRUCTIONS?\]\]/i, label: 'instruction tag' },
  { pattern: /[A-Za-z0-9+/]{80,}={0,2}/, label: 'potential base64 payload' },
]

export interface SanitizeResult {
  sanitized: string
  warnings: string[]
}

/**
 * Scans added lines in a diff for LLM prompt-injection patterns.
 * Only lines starting with '+' (not '+++') are scanned — removed and
 * context lines are passed through unchanged.
 */
export function sanitizeDiff(diff: string): SanitizeResult {
  const warnings: string[] = []
  const sanitizedLines = diff.split('\n').map(line => {
    // Only scan added lines; skip diff header lines (+++ b/...)
    if (!line.startsWith('+') || line.startsWith('+++')) return line

    for (const { pattern, label } of INJECTION_PATTERNS) {
      if (pattern.test(line)) {
        warnings.push(`Prompt injection pattern detected (${label}): ${line.slice(0, 100)}`)
        return line.replace(pattern, '[REDACTED]')
      }
    }
    return line
  })

  return { sanitized: sanitizedLines.join('\n'), warnings }
}
