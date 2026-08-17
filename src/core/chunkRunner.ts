// Orchestration wrapper for --chunk: splits an oversized diff into maxDiffLines-sized chunks and
// calls the existing SwarmRunner.run() once per chunk, UNCHANGED, then merges the resulting
// ReviewResults into one. Lives outside SwarmRunner deliberately -- this is new orchestration
// built on top of the existing review capability, not a change to how that capability itself
// works. See docs/superpowers/specs/2026-08-16-review-reliability-fixes-design.md, Issue 1.
//
// Known, accepted simplifications (documented, not fixed here -- same class of chunk-boundary
// limitation the design spec already accepts for "a function split across a chunk boundary"):
// chunks split on raw line count, not `diff --git` file boundaries, so a single file's diff
// section can itself be split across two chunks. This has a real, non-cosmetic consequence,
// caught in a pre-merge review of this exact code, worth understanding before relying on --chunk
// for a large diff: each chunk's own OrchestratorAgent.synthesize() call computes changedFiles
// from ONLY that chunk's content -- if a file's `diff --git`/`+++ b/` header lands in chunk N but
// the hunk body an agent reads from continues into chunk N+1, that chunk's changedFiles won't
// include the file, and filterNonexistentFiles will drop any genuine finding an agent reports on
// it as "likely a hallucinated or malicious finding" -- indistinguishable in the output from an
// actual hallucination. Not fixed here (needs either file-boundary-aware chunking or carrying a
// running changedFiles set across chunks, both real design decisions); tracked as a real gap, not
// waved off as cosmetic like the duplicate-findings case below. Purely diagnostic metadata
// (toolAvailability, policy, filteredFiles, context) reflects whichever chunk ran LAST, not a true
// merge across chunks -- acceptable for an opt-in feature, since none of it gates an exit code.
// agentStatus is the one exception and IS merged across all chunks (see mergeAgentStatus below):
// it feeds cli/index.ts's exit code 2, so a last-chunk-wins simplification there would let a real
// failure in an earlier chunk go unreported by the very feature meant to guarantee complete
// coverage. The actual review output (findings, testFiles, summary, sanitizer) IS fully merged
// below too, including a global severity-sort + maxFindings cap (see capAndSort) so a large diff's
// merged report doesn't silently exceed the documented cap or order findings chunk-then-severity.
// Cross-chunk duplicate findings are not deduped (each chunk's own OrchestratorAgent.synthesize()
// call only ever sees that chunk's own findings) -- narrow in practice since chunks are
// non-overlapping diff content, and genuinely cosmetic (a near-duplicate finding shown twice)
// rather than a correctness problem, unlike the boundary-drop issue above.
import type { SwarmRunner } from './runner.js'
import type {
  ReviewInput,
  ReviewResult,
  AgentProgressEvent,
  GeneratedTestFile,
  AgentName,
  AgentStatus,
} from './schema.js'
import { SEVERITY_RANK } from './schema.js'

export async function runChunked(
  runner: SwarmRunner,
  input: ReviewInput,
  maxDiffLines: number,
  maxFindings: number,
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

  return mergeResults(results, maxFindings)
}

// Mirrors OrchestratorAgent.capAndSort exactly (severity desc, then VERIFIED > INFERRED >
// SPECULATIVE) -- each chunk's own OrchestratorAgent already capped/sorted WITHIN that chunk, but
// merging N already-capped-at-maxFindings lists via a plain flatMap (as this function used to)
// both re-exceeds maxFindings (up to chunkCount x maxFindings in the final report) and orders
// findings chunk-then-severity instead of globally by severity, breaking an invariant every other
// code path in this project maintains.
function capAndSort(findings: ReviewResult['findings'], maxFindings: number) {
  return [...findings]
    .sort((a, b) => {
      const sevDiff = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]
      if (sevDiff !== 0) return sevDiff
      const basisOrder = { VERIFIED: 2, INFERRED: 1, SPECULATIVE: 0 }
      return basisOrder[b.basis] - basisOrder[a.basis]
    })
    .slice(0, maxFindings)
}

function mergeResults(results: ReviewResult[], maxFindings: number): ReviewResult {
  const findings = capAndSort(
    results.flatMap((r) => r.findings),
    maxFindings
  )
  const testFiles: GeneratedTestFile[] = results.flatMap((r) => r.testFiles)
  const durationMs = results.reduce((sum, r) => sum + r.summary.durationMs, 0)

  const bySeverity: Record<string, number> = {}
  const byAgent: Record<string, number> = {}
  for (const f of findings) {
    bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1
    byAgent[f.agent] = (byAgent[f.agent] ?? 0) + 1
  }

  const last = results[results.length - 1]
  const mergedAgentStatus = mergeAgentStatus(results)
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
    ...(mergedAgentStatus ? { agentStatus: mergedAgentStatus } : {}),
    ...(last.hallucinationFilter ? { hallucinationFilter: last.hallucinationFilter } : {}),
    ...(last.coverageGapFilter ? { coverageGapFilter: last.coverageGapFilter } : {}),
    ...(last.toolAvailability ? { toolAvailability: last.toolAvailability } : {}),
    ...(last.evidenceCheckFilter ? { evidenceCheckFilter: last.evidenceCheckFilter } : {}),
    ...(last.filteredFiles ? { filteredFiles: last.filteredFiles } : {}),
  }
}

// A last-chunk-wins merge here would let a real failure in an earlier chunk go unreported --
// e.g. `security` times out on chunk 1 but succeeds on chunk 2 -- because cli/index.ts's exit
// code 2 is driven directly by this field (hasAgentFailures checks `status !== 'ok'` across it).
// An agent's merged status is 'ok' only if every chunk that reported a status for it said 'ok';
// otherwise it keeps the first non-'ok' status seen (which specific failure reason wins doesn't
// change the exit-code outcome, since any non-'ok' value triggers it the same way).
function mergeAgentStatus(
  results: ReviewResult[]
): Partial<Record<AgentName, AgentStatus>> | undefined {
  const merged: Partial<Record<AgentName, AgentStatus>> = {}
  for (const r of results) {
    if (!r.agentStatus) continue
    for (const [name, status] of Object.entries(r.agentStatus) as [AgentName, AgentStatus][]) {
      const existing = merged[name]
      if (existing === undefined || existing === 'ok') merged[name] = status
    }
  }
  return Object.keys(merged).length > 0 ? merged : undefined
}
