// Orchestration wrapper for --chunk: splits an oversized diff into maxDiffLines-sized chunks and
// calls the existing SwarmRunner.run() once per chunk, UNCHANGED, then merges the resulting
// ReviewResults into one. Lives outside SwarmRunner deliberately -- this is new orchestration
// built on top of the existing review capability, not a change to how that capability itself
// works. See docs/superpowers/specs/2026-08-16-review-reliability-fixes-design.md, Issue 1.
//
// Known, accepted simplifications (documented, not fixed here -- same class of chunk-boundary
// limitation the design spec already accepts for "a function split across a chunk boundary"):
// chunks split on raw line count, not `diff --git` file boundaries, so a single file's diff
// section can itself be split across two chunks. Diagnostic/observability metadata (agentStatus,
// toolAvailability, policy, filteredFiles, context) reflects whichever chunk ran LAST, not a true
// merge across chunks -- acceptable for an opt-in feature; the actual review output (findings,
// testFiles, summary, sanitizer) IS fully merged below. Cross-chunk duplicate findings are not
// deduped (each chunk's own OrchestratorAgent.synthesize() call only ever sees that chunk's own
// findings) -- narrow in practice since chunks are non-overlapping diff content, and cosmetic (a
// near-duplicate finding shown twice) rather than a correctness problem.
import type { SwarmRunner } from './runner.js'
import type { ReviewInput, ReviewResult, AgentProgressEvent, GeneratedTestFile } from './schema.js'

export async function runChunked(
  runner: SwarmRunner,
  input: ReviewInput,
  maxDiffLines: number,
  onProgress?: (event: AgentProgressEvent) => void,
  contextMode: 'none' | 'memory-bank' = 'none'
): Promise<ReviewResult> {
  const lines = input.diff.split('\n')
  const diffLines = lines.length
  const chunkCount = Math.max(1, Math.ceil(diffLines / maxDiffLines))

  console.warn(
    `[ai-review] Diff split into ${chunkCount} chunk(s) of up to ${maxDiffLines} lines each ` +
      `(--chunk) -- full diff coverage, ${chunkCount}x the LLM calls.`
  )

  const results: ReviewResult[] = []
  for (let i = 0; i < chunkCount; i++) {
    const start = i * maxDiffLines
    const end = Math.min(start + maxDiffLines, diffLines)
    const chunkInput: ReviewInput = { ...input, diff: lines.slice(start, end).join('\n') }
    const result = await runner.run(chunkInput, onProgress, contextMode)
    results.push(result)
    if (result.earlyExit) break // --fail-fast should stop across chunks too, not just within one
  }

  return mergeResults(results)
}

function mergeResults(results: ReviewResult[]): ReviewResult {
  const findings = results.flatMap((r) => r.findings)
  const testFiles: GeneratedTestFile[] = results.flatMap((r) => r.testFiles)
  const durationMs = results.reduce((sum, r) => sum + r.summary.durationMs, 0)

  const bySeverity: Record<string, number> = {}
  const byAgent: Record<string, number> = {}
  for (const f of findings) {
    bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1
    byAgent[f.agent] = (byAgent[f.agent] ?? 0) + 1
  }

  const last = results[results.length - 1]
  const sanitizerApplied = results.some((r) => r.sanitizer?.applied)
  const sanitizerRedacted = results.reduce((sum, r) => sum + (r.sanitizer?.redactedLines ?? 0), 0)
  const sanitizerWarnings = results.flatMap((r) => r.sanitizer?.warnings ?? [])

  return {
    findings,
    testFiles,
    summary: { totalFindings: findings.length, bySeverity, byAgent, durationMs },
    ...(last.earlyExit ? { earlyExit: last.earlyExit } : {}),
    ...(last.context ? { context: last.context } : {}),
    sanitizer: {
      enabled: last.sanitizer?.enabled ?? true,
      applied: sanitizerApplied,
      redactedLines: sanitizerRedacted,
      warnings: sanitizerWarnings,
    },
    // Full coverage achieved across all chunks -- `truncation` is deliberately omitted, matching
    // cli/index.ts's exit-code priority (chunking and truncation are mutually exclusive outcomes
    // for a given run; see Task 13).
    ...(last.policy ? { policy: last.policy } : {}),
    ...(last.agentStatus ? { agentStatus: last.agentStatus } : {}),
    ...(last.hallucinationFilter ? { hallucinationFilter: last.hallucinationFilter } : {}),
    ...(last.coverageGapFilter ? { coverageGapFilter: last.coverageGapFilter } : {}),
    ...(last.toolAvailability ? { toolAvailability: last.toolAvailability } : {}),
    ...(last.evidenceCheckFilter ? { evidenceCheckFilter: last.evidenceCheckFilter } : {}),
    ...(last.filteredFiles ? { filteredFiles: last.filteredFiles } : {}),
  }
}
