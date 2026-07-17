# Silent Agent Failure Reporting — Design Spec

**Date:** 2026-07-15
**Status:** Approved

## Problem

`ai-review-agent` silently reports "0 findings ✅ No issues found" when agents fail —
indistinguishable from a genuinely clean review.

Found while running `/ai-review` against a large diff (~10,600 lines, v1.2.0 era build). Two
separate runs — one where all 14 non-coverage agents hit the 60s timeout, another where the
timeout was raised to 5 minutes and instead every agent's response was unparseable prose
("It looks like you've updated a number of files...") instead of JSON — both produced the exact
same output: `0 findings | ✅ No issues found`. 35 minutes of compute on the second run, zero
agents actually succeeded, and the report gave no indication anything went wrong short of digging
into stderr.

**Root cause** — two silent-failure sites collapse into the same signal as "clean":

1. `src/core/agents/base.ts` (`parseFindings`) and `src/core/agents/coverageAnalyst.ts` — on
   total parse failure (JSON.parse fails at all three extraction stages), log `console.error` and
   return a bare `[]`. Identical return value to "the model genuinely found zero issues."
2. `src/core/runner.ts` (4 catch-block sites: sequential agents, parallel agents, coverage,
   testgen) — on timeout or thrown error, `console.warn`s and pushes nothing to `findings`. Same
   collapse.

Both failure modes are only visible in stderr (`[ai-review] Agent X timed out or failed...` /
`[agentName] parse failure...`). `ReviewResult` (`src/core/schema.ts`) has no field for
agent-level success/failure — only `earlyExit`, `sanitizer`, `policy`, `context`. So
`src/cli/formatter.ts` has no data available to distinguish "14/14 agents ran clean" from
"14/14 agents failed to produce output."

## Goals

1. Every consumer of a `ReviewResult` (human reading markdown, CI parsing JSON/SARIF/
   github-annotations, or `exitCode.ts`) can tell the difference between "clean" and "broken."
2. Give tailored, actionable remediation per failure type — timeout vs. parse failure have
   different fixes (raise `--timeout` / reduce `--max-lines` vs. diff too large for this model).
3. CI usage can't silently treat a broken run as a passing one — a distinct exit code signals
   "don't trust this result" independent of the existing `--fail-on` severity gate.

## Non-Goals

- Auto-retry with a smaller diff chunk on parse failure — detection and reporting only, no
  automatic remediation.
- Distinguishing _why_ a parse failure happened (diff too large vs. model confusion vs. something
  else) beyond the existing `console.error` snippet already logged — `agentStatus` records _that_
  it failed and _how_ (timeout/parse-error/error), not a root-cause diagnosis.
- Changing `testGen`'s existing per-file `null` skip behavior (when a single generated test file's
  content is too short) — that's a different, lower-severity gap than the whole-agent silent
  failure this spec addresses. The catch block around the _entire_ `testgen` call (timeout/thrown
  error) is in scope; the per-file inner skip is not.

## Design

### Types & Schema

New `AgentStatus` type in `schema.ts`:

```typescript
export type AgentStatus = 'ok' | 'timeout' | 'parse-error' | 'error'
```

New `ParseFailureError` class (in `parsing.ts`, alongside `validateAndNormalizeFindings`) —
thrown instead of the current silent `return []` when all 3 parse stages in `parseFindings`
(and the equivalent in `coverageAnalyst.ts`) fail.

`ReviewResult` gains:

```typescript
agentStatus?: Partial<Record<AgentName | 'coverage' | 'testgen', AgentStatus>>
```

Optional (not required) so existing consumers that don't check it keep working unchanged.

### Per-file changes

- **`base.ts` / `coverageAnalyst.ts`**: the final parse-failure fallback
  (`console.error(...); return []`) becomes `console.error(...); throw new ParseFailureError(...)`.
  The `console.error` stays for debugging; it no longer silently swallows the failure by also
  returning a value indistinguishable from success.
- **`runner.ts`** (4 catch-block sites: sequential agents, parallel agents, coverage, testgen):
  each already catches `err` and does `console.warn`. Add classification: message starts with
  `"timed out"` → `'timeout'`; `err instanceof ParseFailureError` → `'parse-error'`; anything
  else → `'error'`. Record into a shared `agentStatus` map threaded through `SwarmRunner.run()`,
  defaulting every attempted agent to `'ok'` unless overwritten in a catch block.
- **`SwarmRunner.run()`**: merges the per-phase status maps (sequential + parallel + coverage +
  testgen) into the final `ReviewResult.agentStatus`.

### Formatter & exit code

- **`formatter.ts`** (all 4 formats — markdown, json, sarif, github-annotations): when any status
  isn't `'ok'`, markdown replaces the clean checkmark with `⚠️ N/M agents failed — results
incomplete` plus a per-agent breakdown (agent name + reason + tailored advice: timeout → "raise
  --timeout or reduce --max-lines"; parse-error → "diff likely too large for this model").
  JSON/SARIF/github-annotations include the raw `agentStatus` map in their existing metadata
  sections (same place `context`/`policy` already live) — additive field on `ReviewResult`, no
  restructuring needed.
- **`exitCode.ts`**: new `AGENT_FAILURE_EXIT_CODE = 2` and a helper `hasAgentFailures(agentStatus)`.
  `cli/index.ts`'s exit logic checks this _before_ the existing `shouldFail` severity check.
  **Priority when both conditions are true** (some agents failed AND remaining findings are
  severe enough to trip `--fail-on`): agent failure always wins (exit 2), regardless of findings
  severity — "don't trust this result, it's incomplete" is the strongest possible signal, even if
  what _did_ come back looks bad. Existing exit 1 (severity-gate failure) and exit 0 (clean pass)
  behavior is unchanged when no agent failed.

### Scope

Covers all agents with the same silent-failure pattern: the 15 review specialists (via
`base.ts`/subclass overrides), `coverageAnalyst`, and `testGen` (when enabled via
`--suggest-tests`/`--write-tests`).

## Testing

- Unit tests for `parseFindings`/coverage-agent parsing: assert `ParseFailureError` is thrown
  (not `[]`) on unparseable prose, across all 3 fallback stages.
- Unit tests for each of the 4 `runner.ts` catch-block sites: mock a provider that throws
  timeout / `ParseFailureError` / generic error, assert the resulting `agentStatus` entry matches.
- Unit tests for the formatter: given an `agentStatus` map with mixed statuses, assert markdown
  shows the warning + breakdown instead of the clean checkmark; assert JSON/SARIF/
  github-annotations include `agentStatus` in output.
- Unit tests for `exitCode.ts`: the 4 combinations of {agents ok/failed} × {findings below/above
  `--fail-on`} — confirm exit 2 wins whenever any agent failed.
- One integration-style test simulating the original bug report's exact scenario (all agents
  return unparseable prose) — assert the final CLI exit code is 2, not 0.
