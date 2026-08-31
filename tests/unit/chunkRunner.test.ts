import { describe, it, expect, vi } from 'vitest'
import { runChunked, splitByFileBoundary } from '../../src/core/chunkRunner.js'
import { SwarmRunner } from '../../src/core/runner.js'
import { DEFAULT_CONFIG } from '../../src/core/config.js'
import type { AgentName } from '../../src/core/schema.js'
import type { LLMProvider } from '../../src/core/llm/provider.js'
import type { ReviewResult } from '../../src/core/schema.js'

function makeResult(overrides: Partial<ReviewResult> = {}): ReviewResult {
  return {
    findings: [],
    testFiles: [],
    summary: { totalFindings: 0, bySeverity: {}, byAgent: {}, durationMs: 100 },
    sanitizer: { enabled: true, applied: false, redactedLines: 0, warnings: [] },
    ...overrides,
  }
}

// Each file section is deliberately sized larger than maxLines (2000 in these tests) so it always
// becomes its own chunk regardless of packing order -- keeps the orchestration tests below
// (merge/sort/cap/earlyExit behavior) independent of splitByFileBoundary's own packing details,
// which get their own dedicated test coverage further down.
function makeFileDiff(path: string, bodyLines: number): string {
  const body = Array.from({ length: bodyLines }, (_, i) => `+line ${i}`).join('\n')
  return `diff --git a/${path} b/${path}\n${body}`
}

function makeMultiFileDiff(fileCount: number, linesPerFile = 2500): string {
  return Array.from({ length: fileCount }, (_, i) =>
    makeFileDiff(`file${i}.ts`, linesPerFile)
  ).join('\n')
}

// WIRING SEAM, not a predicate test. Every other test in this describe hands runChunked a mocked
// `run`, which proves mergeResults concatenates whatever it is given but proves nothing about
// whether a real SwarmRunner actually produces those rows, or whether the field survives the trip.
// That is the exact gap that let isPreImageOnlyEvidence ship inert: its predicate tests all
// passed, and so did a scratch probe, because neither went through the real path. Only the LLM
// is mocked here; preprocessing, timeout scaling, the progress channel and the merge are real.
describe('runChunked timing through a real SwarmRunner', () => {
  it('produces one real row per chunk, each with its own line count and ceiling', async () => {
    const provider: LLMProvider = {
      chat: vi.fn().mockResolvedValue('[]'),
      ping: vi.fn().mockResolvedValue({ ok: true }),
    }
    const maxDiffLines = 2000
    const runner = new SwarmRunner(
      { ...DEFAULT_CONFIG, agents: ['security'] as AgentName[], maxDiffLines },
      provider
    )
    // Deliberately different sizes: identical chunks would pass even if every row were a copy
    // of the first one.
    const diff = [makeFileDiff('a.ts', 2500), makeFileDiff('b.ts', 3500)].join('\n')

    const merged = await runChunked(runner, { diff }, maxDiffLines, 15)

    expect(merged.timings).toHaveLength(2)
    const [first, second] = merged.timings!
    // Each chunk is truncated to maxDiffLines by the real preprocessDiff, and both oversized
    // sections land there -- what matters is that two distinct rows survive with real agent
    // entries, not one merged row.
    expect(first!.diffLines).toBe(maxDiffLines)
    expect(second!.diffLines).toBe(maxDiffLines)
    expect(first!.agents.map((a) => a.name)).toEqual(['security'])
    expect(second!.agents.map((a) => a.name)).toEqual(['security'])
    expect(first!.effectiveTimeoutMs).toBeGreaterThan(0)
    // The aggregate is still available for anyone who wants it -- it just is not the only thing
    // available any more.
    expect(merged.summary.durationMs).toBeGreaterThanOrEqual(0)
  })
})

describe('runChunked timing rows', () => {
  // REGRESSION. `summary.durationMs` directly beside this IS summed, and summing is what makes a
  // chunked run unreadable: the agent timeout applies per run() call, so an aggregate larger than
  // any ceiling looks like a timeout problem whether or not one exists. The three chunks carry
  // distinct, non-uniform values so a sum, a mean, and a last-chunk-wins read each produce a
  // different answer from the concatenation asserted here.
  it('concatenates one row per chunk instead of summing them', async () => {
    const runMock = vi
      .fn()
      .mockResolvedValueOnce(
        makeResult({
          summary: { totalFindings: 0, bySeverity: {}, byAgent: {}, durationMs: 100 },
          timings: [
            {
              diffLines: 900,
              effectiveTimeoutMs: 261000,
              durationMs: 100,
              agents: [
                { name: 'security', elapsedMs: 60, attemptMs: 60, attempts: 1, status: 'ok' },
              ],
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        makeResult({
          summary: { totalFindings: 0, bySeverity: {}, byAgent: {}, durationMs: 250 },
          timings: [
            {
              diffLines: 1500,
              effectiveTimeoutMs: 315000,
              durationMs: 250,
              agents: [
                {
                  name: 'security',
                  elapsedMs: 240,
                  attemptMs: 240,
                  attempts: 1,
                  status: 'timeout',
                },
              ],
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        makeResult({
          summary: { totalFindings: 0, bySeverity: {}, byAgent: {}, durationMs: 50 },
          timings: [
            {
              diffLines: 300,
              effectiveTimeoutMs: 207000,
              durationMs: 50,
              agents: [
                { name: 'security', elapsedMs: 30, attemptMs: 30, attempts: 1, status: 'ok' },
              ],
            },
          ],
        })
      )
    const runner = { run: runMock } as unknown as SwarmRunner

    const merged = await runChunked(runner, { diff: makeMultiFileDiff(3) }, 2000, 15)

    expect(merged.timings).toHaveLength(3)
    expect(merged.timings!.map((t) => t.diffLines)).toEqual([900, 1500, 300])
    expect(merged.timings!.map((t) => t.durationMs)).toEqual([100, 250, 50])
    expect(merged.timings!.map((t) => t.effectiveTimeoutMs)).toEqual([261000, 315000, 207000])
    // The chunk that hit its ceiling stays individually identifiable -- the whole point.
    expect(merged.timings![1]!.agents[0]!.status).toBe('timeout')
    // Guard, not regression: the pre-existing aggregate contract is unchanged by this field.
    expect(merged.summary.durationMs).toBe(400)
  })
})

describe('runChunked', () => {
  it('splits a diff into one chunk per file section and calls run() once per chunk', async () => {
    const runMock = vi.fn().mockResolvedValue(makeResult())
    const runner = { run: runMock } as unknown as SwarmRunner
    const diff = makeMultiFileDiff(3)

    await runChunked(runner, { diff }, 2000, 15)

    expect(runMock).toHaveBeenCalledTimes(3)
  })

  it('merges findings, testFiles, and summary counts across chunks', async () => {
    const runMock = vi
      .fn()
      .mockResolvedValueOnce(
        makeResult({
          findings: [{ id: 'a', severity: 'high', agent: 'security' } as never],
          summary: {
            totalFindings: 1,
            bySeverity: { high: 1 },
            byAgent: { security: 1 },
            durationMs: 50,
          },
        })
      )
      .mockResolvedValueOnce(
        makeResult({
          findings: [{ id: 'b', severity: 'medium', agent: 'security' } as never],
          summary: {
            totalFindings: 1,
            bySeverity: { medium: 1 },
            byAgent: { security: 1 },
            durationMs: 60,
          },
        })
      )
    const runner = { run: runMock } as unknown as SwarmRunner
    const diff = makeMultiFileDiff(2)

    const merged = await runChunked(runner, { diff }, 2000, 15)

    expect(merged.findings).toHaveLength(2)
    expect(merged.summary.totalFindings).toBe(2)
    expect(merged.summary.bySeverity).toEqual({ high: 1, medium: 1 })
    expect(merged.summary.durationMs).toBe(110)
  })

  it('stops after a chunk reports earlyExit, matching --fail-fast semantics', async () => {
    const runMock = vi
      .fn()
      .mockResolvedValueOnce(makeResult({ earlyExit: { stoppedAt: 'security' } }))
      .mockResolvedValueOnce(makeResult())
    const runner = { run: runMock } as unknown as SwarmRunner
    const diff = makeMultiFileDiff(3)

    await runChunked(runner, { diff }, 2000, 15)

    expect(runMock).toHaveBeenCalledTimes(1) // stopped after the first chunk's earlyExit
  })

  it('does not report truncation on the merged result -- full coverage was achieved', async () => {
    const runMock = vi.fn().mockResolvedValue(makeResult())
    const runner = { run: runMock } as unknown as SwarmRunner
    const diff = makeMultiFileDiff(3)

    const merged = await runChunked(runner, { diff }, 2000, 15)

    expect(merged.truncation).toBeUndefined()
  })

  it('merges agentStatus across chunks -- a failure in an earlier chunk is not hidden by a later chunk succeeding', async () => {
    const runMock = vi
      .fn()
      .mockResolvedValueOnce(makeResult({ agentStatus: { security: 'timeout' } }))
      .mockResolvedValueOnce(makeResult({ agentStatus: { security: 'ok' } }))
    const runner = { run: runMock } as unknown as SwarmRunner
    const diff = makeMultiFileDiff(2)

    const merged = await runChunked(runner, { diff }, 2000, 15)

    // Last-chunk-wins would report 'ok' here, silently hiding chunk 1's real timeout and letting
    // cli/index.ts's exit code 2 (hasAgentFailures) miss it entirely.
    expect(merged.agentStatus?.security).toBe('timeout')
  })

  it('reports ok for an agent only when every chunk that ran it reported ok', async () => {
    const runMock = vi
      .fn()
      .mockResolvedValueOnce(makeResult({ agentStatus: { security: 'ok', dependencies: 'ok' } }))
      .mockResolvedValueOnce(makeResult({ agentStatus: { security: 'ok', dependencies: 'ok' } }))
    const runner = { run: runMock } as unknown as SwarmRunner
    const diff = makeMultiFileDiff(2)

    const merged = await runChunked(runner, { diff }, 2000, 15)

    expect(merged.agentStatus).toEqual({ security: 'ok', dependencies: 'ok' })
  })

  // Regression: toolAvailability was last-chunk-wins, so a partial gitleaks scan in chunk 1
  // followed by a clean chunk 2 rendered as a COMPLETED scan -- reintroducing at the chunk layer
  // the exact false claim that adding 'partial' removed at the agent layer.
  it('merges toolAvailability -- a partial scan in an earlier chunk is not hidden by a later clean one', async () => {
    const runMock = vi
      .fn()
      .mockResolvedValueOnce(makeResult({ toolAvailability: { gitleaks: 'partial' } }))
      .mockResolvedValueOnce(makeResult({ toolAvailability: { gitleaks: 'used' } }))
    const runner = { run: runMock } as unknown as SwarmRunner

    const merged = await runChunked(runner, { diff: makeMultiFileDiff(2) }, 2000, 15)

    expect(merged.toolAvailability?.gitleaks).toBe('partial')
  })

  // A tool that ran on one chunk and not another covered part of the diff and not the rest, which
  // is what 'partial' means. Reporting 'unavailable-llm-fallback' here would claim it never ran.
  it('collapses a used/unavailable disagreement to partial rather than to unavailable', async () => {
    const runMock = vi
      .fn()
      .mockResolvedValueOnce(makeResult({ toolAvailability: { gitleaks: 'used' } }))
      .mockResolvedValueOnce(
        makeResult({ toolAvailability: { gitleaks: 'unavailable-llm-fallback' } })
      )
    const runner = { run: runMock } as unknown as SwarmRunner

    const merged = await runChunked(runner, { diff: makeMultiFileDiff(2) }, 2000, 15)

    expect(merged.toolAvailability?.gitleaks).toBe('partial')
  })

  it('reports used for a tool only when every chunk that reported it said used', async () => {
    const runMock = vi
      .fn()
      .mockResolvedValueOnce(makeResult({ toolAvailability: { gitleaks: 'used', lizard: 'used' } }))
      .mockResolvedValueOnce(makeResult({ toolAvailability: { gitleaks: 'used', lizard: 'used' } }))
    const runner = { run: runMock } as unknown as SwarmRunner

    const merged = await runChunked(runner, { diff: makeMultiFileDiff(2) }, 2000, 15)

    expect(merged.toolAvailability).toEqual({ gitleaks: 'used', lizard: 'used' })
  })

  // 'not-applicable' is neutral: a chunk with no manifest changes says nothing about npm audit and
  // must not degrade a verdict another chunk legitimately earned. Ordered with 'used' FIRST on
  // purpose -- the reverse order passes under last-chunk-wins too, so it would not be falsifying.
  it('ignores not-applicable chunks when another chunk reported a substantive value', async () => {
    const runMock = vi
      .fn()
      .mockResolvedValueOnce(makeResult({ toolAvailability: { npmAudit: 'used' } }))
      .mockResolvedValueOnce(makeResult({ toolAvailability: { npmAudit: 'not-applicable' } }))
    const runner = { run: runMock } as unknown as SwarmRunner

    const merged = await runChunked(runner, { diff: makeMultiFileDiff(2) }, 2000, 15)

    expect(merged.toolAvailability?.npmAudit).toBe('used')
  })

  it('keeps not-applicable when it is the only value any chunk reported', async () => {
    const runMock = vi
      .fn()
      .mockResolvedValueOnce(makeResult({ toolAvailability: { npmAudit: 'not-applicable' } }))
      .mockResolvedValueOnce(makeResult({ toolAvailability: { npmAudit: 'not-applicable' } }))
    const runner = { run: runMock } as unknown as SwarmRunner

    const merged = await runChunked(runner, { diff: makeMultiFileDiff(2) }, 2000, 15)

    expect(merged.toolAvailability?.npmAudit).toBe('not-applicable')
  })

  it('omits toolAvailability entirely when no chunk reported any tool', async () => {
    const runMock = vi.fn().mockResolvedValue(makeResult())
    const runner = { run: runMock } as unknown as SwarmRunner

    const merged = await runChunked(runner, { diff: makeMultiFileDiff(2) }, 2000, 15)

    expect(merged.toolAvailability).toBeUndefined()
  })

  it('caps merged findings at maxFindings instead of returning chunkCount x maxFindings', async () => {
    const makeFindings = (n: number, prefix: string) =>
      Array.from(
        { length: n },
        (_, i) =>
          ({
            id: `${prefix}${i}`,
            severity: 'medium',
            basis: 'VERIFIED',
            agent: 'security',
          }) as never
      )
    const runMock = vi
      .fn()
      .mockResolvedValueOnce(makeResult({ findings: makeFindings(10, 'a') }))
      .mockResolvedValueOnce(makeResult({ findings: makeFindings(10, 'b') }))
    const runner = { run: runMock } as unknown as SwarmRunner
    const diff = makeMultiFileDiff(2)

    const merged = await runChunked(runner, { diff }, 2000, 15)

    // A plain flatMap would report 20 -- every other code path in this project caps at
    // maxFindings, and --chunk should not be the one exception.
    expect(merged.findings).toHaveLength(15)
    expect(merged.summary.totalFindings).toBe(15)
  })

  it('sorts merged findings globally by severity, not chunk-then-severity', async () => {
    const runMock = vi
      .fn()
      .mockResolvedValueOnce(
        makeResult({
          findings: [
            { id: 'a', severity: 'medium', basis: 'VERIFIED', agent: 'security' } as never,
          ],
        })
      )
      .mockResolvedValueOnce(
        makeResult({
          findings: [
            { id: 'b', severity: 'critical', basis: 'VERIFIED', agent: 'security' } as never,
          ],
        })
      )
    const runner = { run: runMock } as unknown as SwarmRunner
    const diff = makeMultiFileDiff(2)

    const merged = await runChunked(runner, { diff }, 2000, 15)

    // Chunk 2's critical finding must sort ahead of chunk 1's medium finding in the final report,
    // not just appear after it because its chunk ran later.
    expect(merged.findings.map((f) => (f as { id: string }).id)).toEqual(['b', 'a'])
  })

  it('merges evidenceCheckFilter across chunks instead of only keeping the last chunk', async () => {
    const runMock = vi
      .fn()
      .mockResolvedValueOnce(
        makeResult({
          evidenceCheckFilter: {
            checkedCount: 2,
            unavailableCount: 0,
            unavailableReasons: [],
            flagged: [
              {
                agent: 'security',
                title: 'Chunk 1 flagged finding',
                file: 'a.ts',
                line: 1,
                claim: 'x',
                evidence: 'y',
                reason: 'z',
                preFilterAgreed: null,
              } as never,
            ],
          },
        })
      )
      .mockResolvedValueOnce(
        makeResult({
          evidenceCheckFilter: {
            checkedCount: 1,
            unavailableCount: 1,
            unavailableReasons: ['timeout'],
            flagged: [],
          },
        })
      )
    const runner = { run: runMock } as unknown as SwarmRunner
    const diff = makeMultiFileDiff(2)

    const merged = await runChunked(runner, { diff }, 2000, 15)

    // A last-chunk-wins merge would silently drop chunk 1's flagged finding -- exactly the kind
    // of possibly-unsupported finding a reader relying on --verify-evidence needs to see.
    expect(merged.evidenceCheckFilter?.flagged).toHaveLength(1)
    expect(merged.evidenceCheckFilter?.flagged[0].title).toBe('Chunk 1 flagged finding')
    expect(merged.evidenceCheckFilter?.checkedCount).toBe(3)
    expect(merged.evidenceCheckFilter?.unavailableCount).toBe(1)
    expect(merged.evidenceCheckFilter?.unavailableReasons).toEqual(['timeout'])
  })
})

describe('splitByFileBoundary', () => {
  it('never splits a single file section across two chunks', () => {
    // file0 alone (2500 lines) exceeds maxLines (2000) -- the old raw-line-count chunker would
    // have cut it mid-file; this must keep the whole file --git header + hunk body together.
    const diff = makeFileDiff('file0.ts', 2500)

    const chunks = splitByFileBoundary(diff, 2000)

    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toBe(diff)
    // Every line of the file's own diff --git header must land in the same chunk as its body --
    // this is the exact bug class being fixed: a header in chunk N with body spilling into N+1.
    expect(chunks[0]).toContain('diff --git a/file0.ts b/file0.ts')
  })

  it('packs multiple small file sections into one chunk when they fit under maxLines', () => {
    const diff = [makeFileDiff('a.ts', 500), makeFileDiff('b.ts', 500)].join('\n')

    const chunks = splitByFileBoundary(diff, 2000)

    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toContain('a.ts')
    expect(chunks[0]).toContain('b.ts')
  })

  it('starts a new chunk when adding the next file section would exceed maxLines', () => {
    const diff = [makeFileDiff('a.ts', 1500), makeFileDiff('b.ts', 1500)].join('\n')

    const chunks = splitByFileBoundary(diff, 2000)

    expect(chunks).toHaveLength(2)
    expect(chunks[0]).toContain('a.ts')
    expect(chunks[0]).not.toContain('b.ts')
    expect(chunks[1]).toContain('b.ts')
    expect(chunks[1]).not.toContain('a.ts')
  })

  it('returns a single chunk containing everything when the whole diff fits under maxLines', () => {
    const diff = makeMultiFileDiff(2, 100)

    const chunks = splitByFileBoundary(diff, 10000)

    expect(chunks).toHaveLength(1)
  })

  it('handles an empty diff without crashing', () => {
    expect(splitByFileBoundary('', 2000)).toEqual([''])
  })
})

describe('runChunked — chunk coverage when the loop breaks early', () => {
  it('records how many chunks were reviewed when a chunk stops the run', async () => {
    // The sibling test above already asserts run() was called twice and it passes today, which is
    // exactly why it proves nothing: mergeResults only ever sees the chunks that RAN, so a
    // complete 2-chunk run and a 3-chunk run that broke at 2 are identical inputs to it. The
    // ratio is the only thing that can tell them apart.
    const runMock = vi
      .fn()
      .mockResolvedValueOnce(makeResult())
      .mockResolvedValueOnce(makeResult({ earlyExit: { stoppedAt: 'security' } }))
      .mockResolvedValueOnce(makeResult())
    const runner = { run: runMock } as unknown as SwarmRunner

    const merged = await runChunked(runner, { diff: makeMultiFileDiff(3) }, 2000, 15)

    expect(runMock).toHaveBeenCalledTimes(2)
    expect(merged.chunking).toEqual({ total: 3, reviewed: 2 })
  })

  it('records full coverage on a run that reviewed every chunk', async () => {
    // Always set, never conditional: every surface gates on `reviewed < total`, so an absent field
    // on a complete run would be indistinguishable from an absent field on an old archived result.
    const runMock = vi.fn().mockResolvedValue(makeResult())
    const runner = { run: runMock } as unknown as SwarmRunner

    const merged = await runChunked(runner, { diff: makeMultiFileDiff(3) }, 2000, 15)

    expect(merged.chunking).toEqual({ total: 3, reviewed: 3 })
  })

  it('reports the largest agent roster any chunk planned, not the last chunk that ran', async () => {
    // runner.ts derives its roster from THAT CHUNK'S diff -- the migration-safety gate and
    // agentPolicy both consult the changed files -- so the count legitimately differs per chunk.
    // The larger value is deliberately FIRST: the reverse order passes under last-chunk-wins too,
    // which would make this test decorative rather than falsifying.
    const runMock = vi
      .fn()
      .mockResolvedValueOnce(makeResult({ agentsPlanned: 15 }))
      .mockResolvedValueOnce(makeResult({ agentsPlanned: 14 }))
    const runner = { run: runMock } as unknown as SwarmRunner

    const merged = await runChunked(runner, { diff: makeMultiFileDiff(2) }, 2000, 15)

    expect(merged.agentsPlanned).toBe(15)
  })

  it('omits agentsPlanned entirely when no chunk reported one', async () => {
    // Guard: Math.max() of an empty list is -Infinity, and a negative denominator would render
    // worse than no denominator at all.
    const runMock = vi.fn().mockResolvedValue(makeResult())
    const runner = { run: runMock } as unknown as SwarmRunner

    const merged = await runChunked(runner, { diff: makeMultiFileDiff(2) }, 2000, 15)

    expect(merged.agentsPlanned).toBeUndefined()
  })
})

describe('runChunked — a deterministic tool must not claim coverage it did not have', () => {
  it('degrades a tool from used to partial when the chunk loop stopped early', async () => {
    // Every chunk that RAN reported 'used', so they agree and the merge reported 'used' -- a
    // positive claim that gitleaks scanned the whole diff, made about chunks it never saw.
    // 'used' renders nothing on any surface, so the claim was made by silence.
    const runMock = vi
      .fn()
      .mockResolvedValueOnce(makeResult({ toolAvailability: { gitleaks: 'used' } }))
      .mockResolvedValueOnce(
        makeResult({ toolAvailability: { gitleaks: 'used' }, earlyExit: { stoppedAt: 'security' } })
      )
    const runner = { run: runMock } as unknown as SwarmRunner

    const merged = await runChunked(runner, { diff: makeMultiFileDiff(3) }, 2000, 15)

    expect(merged.toolAvailability?.gitleaks).toBe('partial')
  })

  it('leaves a tool as used when every chunk was reviewed', async () => {
    // Guard: only an INCOMPLETE run degrades. A complete chunked run must still be able to report
    // that gitleaks genuinely covered everything, or the signal becomes meaningless.
    const runMock = vi
      .fn()
      .mockResolvedValue(makeResult({ toolAvailability: { gitleaks: 'used' } }))
    const runner = { run: runMock } as unknown as SwarmRunner

    const merged = await runChunked(runner, { diff: makeMultiFileDiff(2) }, 2000, 15)

    expect(merged.toolAvailability?.gitleaks).toBe('used')
  })

  it('does not promote not-applicable or unavailable to partial on a short run', async () => {
    // Only a positive coverage claim is degraded. 'unavailable-llm-fallback' asserts the tool did
    // not run at all, which stays true regardless of how many chunks were reviewed -- rewriting it
    // would tell the reader to investigate skipped files instead of installing the tool.
    const runMock = vi
      .fn()
      .mockResolvedValueOnce(
        makeResult({ toolAvailability: { gitleaks: 'unavailable-llm-fallback' } })
      )
      .mockResolvedValueOnce(
        makeResult({
          toolAvailability: { gitleaks: 'unavailable-llm-fallback' },
          earlyExit: { stoppedAt: 'security' },
        })
      )
    const runner = { run: runMock } as unknown as SwarmRunner

    const merged = await runChunked(runner, { diff: makeMultiFileDiff(3) }, 2000, 15)

    expect(merged.toolAvailability?.gitleaks).toBe('unavailable-llm-fallback')
  })

  it('floors agentsPlanned at the merged agentStatus size so it cannot fall below it', async () => {
    // Math.max of per-chunk roster SIZES is not an upper bound on the UNION of agent names
    // mergeAgentStatus builds: two chunks whose agentPolicy allows disjoint agents each report 2
    // while the union is 4, and every surface then renders agentsPlanned - agentsRan as -2.
    const runMock = vi
      .fn()
      .mockResolvedValueOnce(
        makeResult({ agentsPlanned: 2, agentStatus: { security: 'ok', correctness: 'ok' } })
      )
      .mockResolvedValueOnce(
        makeResult({ agentsPlanned: 2, agentStatus: { design: 'ok', dependencies: 'ok' } })
      )
    const runner = { run: runMock } as unknown as SwarmRunner

    const merged = await runChunked(runner, { diff: makeMultiFileDiff(2) }, 2000, 15)

    expect(Object.keys(merged.agentStatus ?? {})).toHaveLength(4)
    expect(merged.agentsPlanned).toBe(4)
  })
})
