import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

export interface IgnorePatterns {
  excludes: string[] // patterns — file is removed from diff if it matches
  includes: string[] // negation patterns (! prefix stripped) — overrides excludes
}

/** Load patterns from a .aiignore file and any extra paths passed by the caller. */
export function loadIgnorePatterns(projectPath: string, extraPaths: string[] = []): IgnorePatterns {
  const excludes: string[] = [...extraPaths]
  const includes: string[] = []

  const ignorePath = join(projectPath, '.aiignore')
  if (existsSync(ignorePath)) {
    const lines = readFileSync(ignorePath, 'utf-8').split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      if (trimmed.startsWith('!')) {
        includes.push(trimmed.slice(1)) // strip the ! prefix
      } else {
        excludes.push(trimmed)
      }
    }
  }
  return { excludes, includes }
}

/**
 * Filter a git diff string, removing sections for files that match any
 * exclude pattern, unless they also match a negation (include) pattern.
 * Returns the filtered diff.
 */
export function filterDiff(diff: string, patterns: IgnorePatterns | string[]): string {
  // Backward compat: accept raw string[] (treated as excludes only)
  const { excludes, includes } = Array.isArray(patterns)
    ? { excludes: patterns, includes: [] }
    : patterns

  if (excludes.length === 0) return diff

  // Split on diff --git boundaries, preserving the marker in each chunk
  const sections = diff.split(/(?=^diff --git )/m)
  return sections
    .filter((section) => {
      if (!section.startsWith('diff --git ')) return true
      const filePath = extractFilePath(section)
      if (!filePath) return true
      // Keep if explicitly included (negation wins)
      if (includes.some((p) => matchPattern(filePath, p))) return true
      // Remove if excluded
      return !excludes.some((p) => matchPattern(filePath, p))
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

export function matchPattern(filePath: string, pattern: string): boolean {
  const isDir = pattern.endsWith('/')
  const normalised = isDir ? pattern.slice(0, -1) : pattern
  const hasSlash = normalised.includes('/')

  // Convert gitignore glob to regex
  const regexStr = normalised
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // escape regex special chars
    .replace(/\*\*/g, '\x00') // placeholder for **
    .replace(/\*/g, '[^/]*') // * = non-slash run
    .replace(/\?/g, '[^/]') // ? = one non-slash char
    // eslint-disable-next-line no-control-regex
    .replace(/\x00/g, '.*') // ** = anything

  const suffix = isDir ? '(/.*)?$' : '$'

  if (hasSlash) {
    // Anchored to repo root (strip leading slash if present)
    return new RegExp(`^/?${regexStr}${suffix}`).test(filePath)
  } else {
    // Match against any path component
    return new RegExp(`(^|/)${regexStr}(/|$)`).test(filePath)
  }
}
