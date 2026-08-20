// src/core/diffSplit.ts
// Pure diff-splitting primitive, with no dependencies of its own.
//
// WHY this is its own leaf module rather than living in chunkRunner.ts: two callers need it --
// chunkRunner (packing an oversized diff into review passes) and claimSupport (slicing a diff into
// per-file sections). chunkRunner is a high-level orchestration wrapper whose own header describes
// it as "built on top of the existing review capability", and it references SwarmRunner; having
// claimSupport -- a leaf consumed by orchestrator, which runner consumes -- import from it
// inverted the dependency direction. That created no runtime cycle today only because
// chunkRunner's runner import is `import type` (erased at compile time); converting it to a value
// import would have silently produced cli -> runner -> orchestrator -> claimSupport -> chunkRunner
// -> runner, and nothing in CI guards against that (no eslint-plugin-import, no madge check).
// Keeping the function in one dependency-free place preserves the "one tested implementation"
// rationale without the inversion -- the same anti-drift reasoning filePath.ts's header states.

// Splits a diff into chunks of up to maxLines each without ever splitting a single file's
// `diff --git` section across two chunks. Packs sections greedily in order; a section larger than
// maxLines on its own still becomes its own chunk rather than being dropped or force-split.
export function splitByFileBoundary(diff: string, maxLines: number): string[] {
  const sections = diff.split(/(?=^diff --git )/m).filter((s) => s.length > 0)
  if (sections.length === 0) return ['']

  const chunks: string[] = []
  let current: string[] = []
  let currentLines = 0

  for (const section of sections) {
    const sectionLines = section.split('\n').length
    if (current.length > 0 && currentLines + sectionLines > maxLines) {
      chunks.push(current.join(''))
      current = []
      currentLines = 0
    }
    current.push(section)
    currentLines += sectionLines
  }
  if (current.length > 0) chunks.push(current.join(''))

  return chunks
}
