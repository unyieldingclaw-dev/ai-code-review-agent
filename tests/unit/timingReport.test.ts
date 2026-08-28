import { describe, it, expect } from 'vitest'
import { formatRunTiming, timingLabel, timingSentence } from '../../src/core/timingReport.js'
import type { AgentTiming, RunTiming } from '../../src/core/schema.js'

const agent = (o: Partial<AgentTiming> & { name: AgentTiming['name'] }): AgentTiming => ({
  elapsedMs: 1000,
  attemptMs: 1000,
  attempts: 1,
  status: 'ok',
  ...o,
})

const run = (o: Partial<RunTiming> = {}): RunTiming => ({
  diffLines: 900,
  effectiveTimeoutMs: 240000,
  durationMs: 300000,
  agents: [],
  ...o,
})

describe('timingLabel', () => {
  it('drops the run number when there is only one row', () => {
    expect(timingLabel(0, 1)).toBe('Timing')
  })

  it('numbers rows from 1, not 0, when a chunked run produced several', () => {
    expect(timingLabel(0, 9)).toBe('Timing (run 1/9)')
    expect(timingLabel(8, 9)).toBe('Timing (run 9/9)')
  })
})

describe('timingSentence', () => {
  it('reports the run without a slowest clause when no agent ran', () => {
    const s = timingSentence(run())
    expect(s).toContain('900 diff lines, 0 agents, 300.0s total, ceiling 240.0s/agent')
    expect(s).not.toContain('slowest')
  })

  it('singularises a one-agent run', () => {
    expect(timingSentence(run({ agents: [agent({ name: 'security' })] }))).toContain('1 agent,')
  })

  // The slowest agent is deliberately neither first nor last, so a first- or last-wins
  // implementation names a different agent and this fails.
  it('ranks by attemptMs, not wall time', () => {
    const s = timingSentence(
      run({
        agents: [
          agent({ name: 'security', elapsedMs: 10_000, attemptMs: 10_000 }),
          // Longest WALL time, but only because it retried three times -- its LONGEST single
          // attempt is short, so it says nothing about the ceiling. attemptMs is the max across
          // attempts, not the last, so this fixture is only meaningful post-fix.
          agent({ name: 'design', elapsedMs: 200_000, attemptMs: 20_000, attempts: 3 }),
          agent({ name: 'performance', elapsedMs: 90_000, attemptMs: 90_000 }),
        ],
      })
    )
    expect(s).toContain('slowest performance 90.0s')
    expect(s).not.toContain('slowest design')
  })

  it('names a timed-out agent, whose attemptMs is the ceiling rather than a run time', () => {
    const s = timingSentence(
      run({
        agents: [
          agent({ name: 'security', attemptMs: 240000, elapsedMs: 240000, status: 'timeout' }),
          agent({ name: 'design', attemptMs: 5000, elapsedMs: 5000 }),
        ],
      })
    )
    expect(s).toContain('hit the ceiling: security')
  })

  it('names a retried agent, so a wall time larger than the ceiling is explained', () => {
    const s = timingSentence(
      run({
        agents: [
          agent({ name: 'adversarial', elapsedMs: 611_700, attemptMs: 304_800, attempts: 2 }),
        ],
      })
    )
    expect(s).toContain('retried: adversarial x2')
    expect(s).toContain('total includes backoff')
    // The figure compared against the ceiling is the per-attempt one, not the inflated wall time.
    expect(s).toContain('slowest adversarial 304.8s')
    expect(s).not.toContain('611.7s')
  })

  // All three optional clauses at once: the shape most likely to read as self-contradictory.
  it('stays coherent when one agent timed out and another retried', () => {
    const s = timingSentence(
      run({
        agents: [
          agent({ name: 'security', attemptMs: 240000, elapsedMs: 240000, status: 'timeout' }),
          agent({ name: 'design', elapsedMs: 90_000, attemptMs: 40_000, attempts: 2 }),
        ],
      })
    )
    // REGRESSION. The timed-out agent has the largest attemptMs by construction (it IS the
    // ceiling), so a plain reduce always names it -- and the clause then reports the ceiling back
    // as though it were a measurement, in the exact failure case the line exists to explain.
    // "slowest" must name the slowest agent that actually finished.
    expect(s).toContain('slowest design 40.0s')
    expect(s).not.toContain('slowest security')
    expect(s).toContain('hit the ceiling: security')
    expect(s).toContain('retried: design x2')
    // Order matters for readability: the ceiling breach reads before the retry caveat.
    expect(s.indexOf('hit the ceiling')).toBeLessThan(s.indexOf('retried:'))
  })

  it('omits the slowest clause entirely when every agent hit the ceiling', () => {
    const s = timingSentence(
      run({
        agents: [
          agent({ name: 'security', attemptMs: 240100, elapsedMs: 240100, status: 'timeout' }),
          agent({ name: 'design', attemptMs: 240050, elapsedMs: 240050, status: 'timeout' }),
        ],
      })
    )
    // Naming one of two agents killed by the same clock asserts a 50 ms ranking the data does
    // not support. They are reported by name in the ceiling clause instead.
    expect(s).not.toContain('slowest')
    expect(s).toContain('hit the ceiling: security, design')
  })

  it('lists every retried agent, not just the first', () => {
    const s = timingSentence(
      run({
        agents: [agent({ name: 'security', attempts: 2 }), agent({ name: 'design', attempts: 3 })],
      })
    )
    expect(s).toContain('retried: security x2, design x3')
  })

  // A no-op testgen makes zero LLM calls, so attempts: 0 is accurate -- but it must not be
  // mistaken for a retry (attempts > 1) or promoted to slowest.
  it('does not treat an agent that made no attempt as retried', () => {
    const s = timingSentence(
      run({ agents: [agent({ name: 'testgen', elapsedMs: 0, attemptMs: 0, attempts: 0 })] })
    )
    expect(s).not.toContain('retried')
  })
})

describe('formatRunTiming', () => {
  it('prefixes the shared sentence and terminates the line', () => {
    const line = formatRunTiming(run({ agents: [agent({ name: 'security', attemptMs: 5000 })] }))
    expect(line.startsWith('[ai-review] timing: ')).toBe(true)
    expect(line.endsWith('\n')).toBe(true)
    // Same body as every other surface -- that is the point of the shared renderer.
    expect(line).toContain(
      timingSentence(run({ agents: [agent({ name: 'security', attemptMs: 5000 })] }))
    )
  })
})
