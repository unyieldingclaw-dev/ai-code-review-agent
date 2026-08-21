import { describe, it, expect, vi } from 'vitest'
import { runChunked, splitByFileBoundary } from '../../src/core/chunkRunner.js'
import type { SwarmRunner } from '../../src/core/runner.js'
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
