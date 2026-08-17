// src/core/filePath.ts
// Shared file-path helpers used by more than one path-safety check in this project, so they
// don't independently drift into subtly-different behavior.

import { sep } from 'path'

/** Normalizes a path for comparison: strips a leading "./" and converts backslashes to forward
 *  slashes (in case an LLM emits a Windows-style path). Used by orchestrator.ts (Finding[]
 *  hallucination filtering) and runner.ts (CoverageGap[] filtering) to match LLM-produced paths
 *  (which sometimes echo the diff's own "--- a/path" / "+++ b/path" header prefix verbatim)
 *  against real changed-file paths extracted from the diff. */
export function normalizeFilePath(p: string): string {
  return p.replace(/^\.\//, '').replace(/\\/g, '/')
}

/** Strips a leading "a/" or "b/" diff-header prefix a finding or gap might echo verbatim. */
export function stripDiffPrefix(p: string): string {
  return p.replace(/^[ab]\//, '')
}

/** True if `candidate` is `root` itself or a path underneath it. Both arguments must already
 *  be resolved to absolute, normalized paths by the caller (this function only compares, it
 *  doesn't resolve) -- e.g. via `path.resolve()`, which both current call sites already do
 *  before comparing.
 *
 *  WHY `+ sep` and not a plain `startsWith(root)`: without the trailing separator, a sibling
 *  directory that merely shares `root` as a string prefix -- e.g. candidate `/repo-evil/x`
 *  against root `/repo` -- would incorrectly pass, since `/repo-evil/x`.startsWith(`/repo`) is
 *  true even though `/repo-evil` is not inside `/repo` at all. Requiring the separator right
 *  after `root` ensures containment is checked at a real path-segment boundary. Used as the
 *  backstop for both --write-tests (cli/index.ts, is a generated test file's path still inside
 *  projectPath) and the MCP repo_path allowlist (mcp/tool.ts, is repo_path inside an allowed
 *  root).
 *
 *  Known limitation: this is a string comparison, not a filesystem check -- it doesn't resolve
 *  symlinks (a symlink inside root pointing outside it would pass undetected) and is
 *  case-sensitive (a case-mismatched root on a case-insensitive filesystem like Windows/macOS
 *  would incorrectly fail closed). Neither is a security regression versus the code this
 *  replaced -- both fail safe or no worse than before -- just not exhaustive. */
export function isPathWithin(candidate: string, root: string): boolean {
  return candidate === root || candidate.startsWith(root + sep)
}
