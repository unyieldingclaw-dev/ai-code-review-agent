// Orchestration wrapper for --chunk: splits an oversized diff into maxDiffLines-sized chunks and
// calls the existing SwarmRunner.run() once per chunk, UNCHANGED, then merges the resulting
// ReviewResults into one. Lives outside SwarmRunner deliberately -- this is new orchestration
// built on top of the existing review capability, not a change to how that capability itself
// works. See docs/superpowers/specs/2026-08-16-review-reliability-fixes-design.md, Issue 1.
//
// Chunks are split on `diff --git` file boundaries (splitByFileBoundary below), never mid-file --
// fixes a real, non-cosmetic bug caught in a pre-merge review of an earlier version of this file,
// which split on raw line count instead: each chunk's own OrchestratorAgent.synthesize() call
// computes changedFiles from ONLY that chunk's content, so if a file's `diff --git`/`+++ b/`
// header landed in chunk N but the hunk body an agent reads from continued into chunk N+1, that
// chunk's changedFiles wouldn't include the file, and filterNonexistentFiles would drop any
// genuine finding an agent reported on it as "likely a hallucinated or malicious finding" --
// indistinguishable in the output from an actual hallucination. A single file's diff section
// larger than maxDiffLines still becomes its own oversized chunk (SwarmRunner.run()'s existing
// internal truncation applies within it, same as it always has for an over-max-lines diff) -- a
// much narrower, already-handled edge case than the general boundary-split this replaces.
//
// Known, accepted simplification: purely diagnostic metadata (policy, filteredFiles, context)
// reflects whichever chunk ran LAST, not a true merge across chunks -- acceptable for an opt-in
// feature, since none of it gates an exit code, and losing an earlier chunk's copy of it costs
// nothing the user-facing report still depends on.
// toolAvailability was on that list until 'partial' existed, and no longer qualifies: a partial
// first chunk followed by a clean one rendered as a COMPLETED tool scan, which is a claim about
// security coverage rather than a diagnostic detail. See mergeToolAvailability below.
// agentStatus and evidenceCheckFilter are the two exceptions and ARE merged across all chunks
// (see mergeAgentStatus/mergeEvidenceCheckFilter below): agentStatus feeds cli/index.ts's exit
// code 2, so a last-chunk-wins simplification there would let a real failure in an earlier chunk
// go unreported by the very feature meant to guarantee complete coverage. evidenceCheckFilter's
// `flagged` array names specific Critical/High findings STILL IN the final report whose own cited
// evidence may not support them -- unlike hallucinationFilter/coverageGapFilter (which only
// explain findings already dropped, so an incomplete explanation costs nothing the report itself
// depends on), losing an earlier chunk's flagged entries would silently under-report which of the
// findings a reader is looking at right now might be unreliable. The actual review output
// (findings, testFiles, summary, sanitizer) IS fully merged
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
  EvidenceCheckFilterMetadata,
  ToolAvailability,
  ToolAvailabilityMetadata,
} from './schema.js'
import { SEVERITY_RANK, TOOL_LABELS } from './schema.js'
import { splitByFileBoundary } from './diffSplit.js'

// Re-exported for the existing chunkRunner.test.ts contract tests; defined in diffSplit.ts so
// leaf consumers (claimSupport) need not import this orchestration module.
export { splitByFileBoundary }

export async function runChunked(
  runner: SwarmRunner,
  input: ReviewInput,
  maxDiffLines: number,
  maxFindings: number,
  onProgress?: (event: AgentProgressEvent) => void,
  contextMode: 'none' | 'memory-bank' = 'none'
): Promise<ReviewResult> {
  const chunks = splitByFileBoundary(input.diff, maxDiffLines)

  console.warn(
    `[ai-review] Diff split into ${chunks.length} chunk(s) of up to ${maxDiffLines} lines each ` +
      `(--chunk) -- full diff coverage, ${chunks.length}x the LLM calls.`
  )

  const results: ReviewResult[] = []
  for (const chunkDiff of chunks) {
    const chunkInput: ReviewInput = { ...input, diff: chunkDiff }
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
  const mergedEvidenceCheckFilter = mergeEvidenceCheckFilter(results)
  const sanitizerApplied = results.some((r) => r.sanitizer?.applied)
  const sanitizerRedacted = results.reduce((sum, r) => sum + (r.sanitizer?.redactedLines ?? 0), 0)
  const sanitizerWarnings = results.flatMap((r) => r.sanitizer?.warnings ?? [])

  // WHY this is merged rather than last-chunk-wins like coverageGapFilter: when the only writer
  // was filterNonexistentFiles, an incomplete explanation cost nothing -- those findings were
  // fabrications referencing files outside the diff. filterUnsupportedClaims now also writes here,
  // and it CAN drop a real finding (a claim matcher misfiring on genuine prose -- measured twice).
  // This line is then the only user-visible trace that anything was dropped, so losing earlier
  // chunks' entries would hide exactly the drops most worth auditing.
  const droppedAcrossChunks = results.flatMap((r) => r.hallucinationFilter?.dropped ?? [])
  const mergedHallucinationFilter =
    droppedAcrossChunks.length > 0 ? { dropped: droppedAcrossChunks } : undefined
  const mergedToolAvailability = mergeToolAvailability(results)

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
    ...(mergedHallucinationFilter ? { hallucinationFilter: mergedHallucinationFilter } : {}),
    ...(last.coverageGapFilter ? { coverageGapFilter: last.coverageGapFilter } : {}),
    ...(mergedToolAvailability ? { toolAvailability: mergedToolAvailability } : {}),
    ...(mergedEvidenceCheckFilter ? { evidenceCheckFilter: mergedEvidenceCheckFilter } : {}),
    ...(last.filteredFiles ? { filteredFiles: last.filteredFiles } : {}),
  }
}

// See the header comment above for why this field is merged (unlike hallucinationFilter/
// coverageGapFilter, which stay last-chunk-wins): its `flagged` array names specific findings
// still in the final report, not just an explanation of ones already dropped.
function mergeEvidenceCheckFilter(
  results: ReviewResult[]
): EvidenceCheckFilterMetadata | undefined {
  const present = results
    .map((r) => r.evidenceCheckFilter)
    .filter((m): m is EvidenceCheckFilterMetadata => m !== undefined)
  if (present.length === 0) return undefined

  return {
    checkedCount: present.reduce((sum, m) => sum + m.checkedCount, 0),
    unavailableCount: present.reduce((sum, m) => sum + m.unavailableCount, 0),
    unavailableReasons: present.flatMap((m) => m.unavailableReasons),
    flagged: present.flatMap((m) => m.flagged),
  }
}

/**
 * Per-tool availability across chunks, replacing a last-chunk-wins read.
 *
 * WHY this is merged rather than left as last-chunk-wins with the other diagnostic metadata: once
 * 'partial' existed, a first chunk reporting a partial gitleaks scan followed by a clean second
 * chunk rendered as a COMPLETED scan -- reintroducing, at the chunk layer, the exact false claim
 * that adding 'partial' removed at the agent layer. Unlike policy or filteredFiles, this field
 * makes an assertion about how much of the diff a security tool actually covered.
 *
 * Any disagreement between chunks collapses to 'partial'. That is the whole rule: a mixed set is
 * two or more distinct values drawn from {used, partial, unavailable-llm-fallback}, and every such
 * pair contains 'used' or 'partial', so the tool demonstrably covered part of the diff and not the
 * rest -- which is what 'partial' means. (An earlier draft carried an "else unavailable" branch
 * for mixed sets; no input can reach it.)
 *
 * 'not-applicable' is neutral and ignored unless it is the only value: a chunk with no manifest
 * changes says nothing about npm audit, and must not degrade a verdict another chunk legitimately
 * earned.
 */
function mergeToolAvailability(results: ReviewResult[]): ToolAvailabilityMetadata | undefined {
  const merged: ToolAvailabilityMetadata = {}
  for (const key of Object.keys(TOOL_LABELS) as (keyof ToolAvailabilityMetadata)[]) {
    const reported = results
      .map((r) => r.toolAvailability?.[key])
      .filter((v): v is ToolAvailability => v !== undefined)
    if (reported.length === 0) continue

    const substantive = reported.filter((v) => v !== 'not-applicable')
    if (substantive.length === 0) {
      merged[key] = 'not-applicable'
      continue
    }
    const distinct = new Set(substantive)
    merged[key] = distinct.size === 1 ? [...distinct][0]! : 'partial'
  }
  return Object.keys(merged).length > 0 ? merged : undefined
}

// A last-chunk-wins merge here would let a real failure in an earlier chunk go unreported --
// e.g. `security` times out on chunk 1 but succeeds on chunk 2 -- because cli/index.ts's exit
// code 2 is driven directly by this field (hasAgentFailures checks `status !== 'ok'` across it).
//
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
