// Rendering for RunTiming.
//
// WHY a module of its own rather than living inside one of its callers: three modules render the
// same RunTiming -- the runner's stderr line (`core/`), the markdown report (`cli/`), and the MCP
// report (`mcp/`). `core/` must not import `cli/` (a core->cli cycle; `FailOnLevel` was moved
// into `schema.ts` for that reason), and `src/mcp/` imports nothing from `src/cli/` today, though
// no lint rule enforces that. A leaf in `core/` is the only location all three can reach.
//
// Not in `schema.ts`: these are string builders, and `schema.ts` holds types plus TOOL_LABELS,
// whose sharing earns its place differently -- `Record<keyof ToolAvailabilityMetadata, string>`
// makes a missing *label* a compile error. Nothing analogous constrains a sentence, so keeping
// these here avoids making `schema.ts` the default home for whatever two renderers happen to
// share. This module does not own every timing string in the tool: `cli/formatter.ts` prints
// `summary.durationMs` in the report header, and `cli/index.ts` formats per-agent elapsed on the
// live progress line.

import type { AgentTiming, RunTiming } from './schema.js'

const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`

/**
 * The slowest agent whose duration is an actual measurement, or undefined if there is none.
 *
 * Keyed on `attemptMs`, not `elapsedMs`: the question a reader brings to this line is whether
 * any agent came near the ceiling, and the ceiling governs a single attempt. Ranking by wall
 * time would promote an agent that retried twice quickly over one that genuinely ran long.
 *
 * WHY timed-out agents are excluded rather than ranked with the rest: a timed-out agent's
 * attemptMs IS the ceiling, so it always wins a plain reduce -- and then the clause reports the
 * ceiling back to the reader as though it were a measurement, in the very failure case the line
 * exists to explain. Worse, two agents killed by the same clock differ only by scheduling noise,
 * so naming one of them asserts a ranking the data does not support. They are reported by name
 * in the `hit the ceiling` clause instead, which is where that information belongs.
 *
 * Zero-attempt agents are excluded for the same reason: a no-op testgen made no LLM call, so
 * "slowest testgen 0.0s" is not a measurement of anything.
 *
 * WHY the slowest and not the mean: a mean over fifteen agents averages the outlier away, and
 * the outlier is the entire signal.
 */
function slowestAgent(timing: RunTiming): AgentTiming | undefined {
  const measured = timing.agents.filter((a) => a.status !== 'timeout' && a.attempts > 0)
  if (measured.length === 0) return undefined
  return measured.reduce((a, b) => (b.attemptMs > a.attemptMs ? b : a))
}

/** Agents in one run that hit the ceiling. Their `attemptMs` is the ceiling, not a run time. */
function timedOutAgents(timing: RunTiming): AgentTiming[] {
  return timing.agents.filter((a) => a.status === 'timeout')
}

/** Agents whose reported duration covers more than one attempt plus backoff. */
function retriedAgents(timing: RunTiming): AgentTiming[] {
  return timing.agents.filter((a) => a.attempts > 1)
}

/**
 * How a row is labelled when a report carries several.
 *
 * Shared rather than written out in each renderer: this encodes a display convention ("run 2/9"
 * versus "run 2 of 9"), which is exactly the kind of thing two copies drift on.
 */
export function timingLabel(index: number, total: number): string {
  return total > 1 ? `Timing (run ${index + 1}/${total})` : 'Timing'
}

/** One run's timing as a sentence. The shared body behind all three renderers. */
export function timingSentence(t: RunTiming): string {
  const parts = [
    `${t.diffLines} diff lines`,
    `${t.agents.length} agent${t.agents.length === 1 ? '' : 's'}`,
    `${secs(t.durationMs)} total`,
    `ceiling ${secs(t.effectiveTimeoutMs)}/agent`,
  ]
  const slowest = slowestAgent(t)
  if (slowest) parts.push(`slowest ${slowest.name} ${secs(slowest.attemptMs)}`)

  // Named explicitly rather than left to be inferred from "slowest": a timed-out agent's
  // attemptMs IS the ceiling, so it reads as a completion time that happens to sit right at the
  // limit unless it is labelled. That misreading is the one this field exists to prevent.
  const timedOut = timedOutAgents(t)
  if (timedOut.length > 0) parts.push(`hit the ceiling: ${timedOut.map((a) => a.name).join(', ')}`)

  // WHY retries are called out even though the printed figure is already per-attempt: `total`
  // above is wall time for the whole pass, so on a retried run the parts of this sentence stop
  // adding up -- the slowest agent's figure can be a fraction of a total it appears to dominate.
  // Saying so is cheaper than leaving a reader to reconcile it, and silence there was the
  // original defect: wall time was printed as though it were a single invocation.
  const retried = retriedAgents(t)
  if (retried.length > 0) {
    parts.push(
      `retried: ${retried.map((a) => `${a.name} x${a.attempts}`).join(', ')} ` +
        `(total includes backoff)`
    )
  }
  return parts.join(', ')
}

/** The operator-facing stderr line for a single run. */
export function formatRunTiming(timing: RunTiming): string {
  return `[ai-review] timing: ${timingSentence(timing)}\n`
}
