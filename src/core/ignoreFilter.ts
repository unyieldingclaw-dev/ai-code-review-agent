import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

/** Load patterns from a .aiignore file and any extra paths passed by the caller. */
export function loadIgnorePatterns(projectPath: string, extraPaths: string[] = []): string[] {
  const patterns: string[] = [...extraPaths]
  const ignorePath = join(projectPath, '.aiignore')
  if (existsSync(ignorePath)) {
    const lines = readFileSync(ignorePath, 'utf-8').split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      // Skip blank lines, comments, and negation patterns (unsupported)
      if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('!')) {
        patterns.push(trimmed)
      }
    }
  }
  return patterns
}

/**
 * Filter a git diff string, removing sections for files that match any
 * of the provided gitignore-style patterns. Returns the filtered diff.
 */
export function filterDiff(diff: string, patterns: string[]): string {
  if (patterns.length === 0) return diff

  // Pre-compile once; avoids reconstructing RegExp objects per file per pattern
  const compiled = patterns.map(compilePattern)

  // Split on diff --git boundaries, preserving the marker in each chunk
  const sections = diff.split(/(?=^diff --git )/m)
  return sections
    .filter(section => {
      if (!section.startsWith('diff --git ')) return true
      const filePath = extractFilePath(section)
      if (!filePath) return true
      return !compiled.some(re => re.test(filePath))
    })
    .join('')
}

function extractFilePath(section: string): string | null {
  // Non-rename case: diff --git a/X b/X (same path, use backreference)
  const samePathMatch = section.match(/^diff --git a\/(.*) b\/\1$/m)
  if (samePathMatch) return samePathMatch[1]

  // Rename or path-with-space fallback: use +++ b/ line
  const plusMatch = section.match(/^\+\+\+ b\/(.+)$/m)
  if (plusMatch && plusMatch[1] !== '/dev/null') return plusMatch[1]

  // Deletion fallback: use --- a/ line
  const minusMatch = section.match(/^--- a\/(.+)$/m)
  if (minusMatch && minusMatch[1] !== '/dev/null') return minusMatch[1]

  return null
}

function compilePattern(pattern: string): RegExp {
  const isDir = pattern.endsWith('/')
  const normalised = isDir ? pattern.slice(0, -1) : pattern
  const hasSlash = normalised.includes('/')

  // Convert gitignore glob to regex
  const regexStr = normalised
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')   // escape regex special chars
    .replace(/\*\*/g, '\x00')                 // placeholder for **
    .replace(/\*/g, '[^/]*')                  // * = non-slash run
    .replace(/\?/g, '[^/]')                   // ? = one non-slash char
    .replace(/\x00/g, '.*')                   // ** = anything

  const suffix = isDir ? '(/.*)?$' : '$'
  return hasSlash
    ? new RegExp(`^/?${regexStr}${suffix}`)   // anchored to repo root
    : new RegExp(`(^|/)${regexStr}(/|$)`)     // match any path component
}
