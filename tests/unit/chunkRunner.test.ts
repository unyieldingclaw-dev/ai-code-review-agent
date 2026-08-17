import { describe, it, expect, vi } from 'vitest'
import { runChunked } from '../../src/core/chunkRunner.js'
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

describe('runChunked', () => {
  it('splits a diff into ceil(lines/maxDiffLines) chunks and calls run() once per chunk', async () => {
    const runMock = vi.fn().mockResolvedValue(makeResult())
    const runner = { run: runMock } as unknown as SwarmRunner
    const bigDiff = Array.from({ length: 5000 }, (_, i) => `line ${i}`).join('\n')

    await runChunked(runner, { diff: bigDiff }, 2000)

    expect(runMock).toHaveBeenCalledTimes(3) // ceil(5000/2000)
  })

  it('merges findings, testFiles, and summary counts across chunks', async () => {
    const runMock = vi
      .fn()
      .mockResolvedValueOnce(
        makeResult({
          findings: [{ id: 'a', severity: 'high', agent: 'security' } as never],
          summary: { totalFindings: 1, bySeverity: { high: 1 }, byAgent: { security: 1 }, durationMs: 50 },
        })
      )
      .mockResolvedValueOnce(
        makeResult({
          findings: [{ id: 'b', severity: 'medium', agent: 'security' } as never],
          summary: { totalFindings: 1, bySeverity: { medium: 1 }, byAgent: { security: 1 }, durationMs: 60 },
        })
      )
    const runner = { run: runMock } as unknown as SwarmRunner
    const diff = Array.from({ length: 3000 }, (_, i) => `line ${i}`).join('\n')

    const merged = await runChunked(runner, { diff }, 2000)

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
    const diff = Array.from({ length: 5000 }, (_, i) => `line ${i}`).join('\n')

    await runChunked(runner, { diff }, 2000)

    expect(runMock).toHaveBeenCalledTimes(1) // stopped after the first chunk's earlyExit
  })

  it('does not report truncation on the merged result -- full coverage was achieved', async () => {
    const runMock = vi.fn().mockResolvedValue(makeResult())
    const runner = { run: runMock } as unknown as SwarmRunner
    const diff = Array.from({ length: 5000 }, (_, i) => `line ${i}`).join('\n')

    const merged = await runChunked(runner, { diff }, 2000)

    expect(merged.truncation).toBeUndefined()
  })
})
