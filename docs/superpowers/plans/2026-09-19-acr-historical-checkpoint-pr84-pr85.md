# Historical Checkpoint: PR #84 and PR #85 — Re-Adjudication and Oracle

**Status:** re-adjudication and oracle construction complete, 2026-09-21. **Checkpoint reached —
awaiting user sign-off before running any of the three models
(`devstral:latest`/`ornith-1.5:9b`/`qwen3.5:9b`) against either historical diff.**

**Explicit scope constraint, restated from the approved contract: this is NOT "the historical
corpus."** N=2 is far too small to rank models. This is a first real-code checkpoint testing
whether the synthetic-fixture ranking (Ornith best recall, Qwen3.5 best restraint/runtime, Devstral
weakest) transfers to real PRs on this repo. No model has been run against either diff yet.

## Correction before anything else: PR #85 had 12 findings, not 11

A prior session summary (inherited across a compaction boundary) stated PR #85's ACR comment
reported "11 fabricated findings." **That number was wrong.** Re-fetched fresh via
`gh api repos/unyieldingclaw-dev/ai-code-review-agent/issues/85/comments` rather than trusted from
memory — there is exactly one ACR comment on PR #85 (id `5644928409`, posted 2026-09-12T09:10:00Z),
and it contains **12** findings. Verified this is the only comment on the PR (no earlier/later rerun
with a different count exists). The corrected count is used throughout this document; the approved
task contract's "11 persisted findings" language is superseded by this correction.

## Provenance, verified directly

- **Exact commit PR #85 was reviewed at:** `7f07fd68` — confirmed three independent ways: (a) it
  appears in `gh pr view 85`'s commit list, (b) a `check-runs` query against that exact SHA shows an
  `ai-review` check completed at `2026-09-12T08:56:50Z`, 10 minutes before the comment was posted,
  (c) `review.yml` computes `git diff origin/${{ github.base_ref }}...HEAD`, and recomputing
  `git diff $(git merge-base main 7f07fd68)...7f07fd68` today reproduces a diff touching exactly the
  4 files every one of the 12 findings cites (`src/cli/index.ts`, `src/core/chunkRunner.ts`,
  `src/core/runner.ts`, `src/core/schema.ts`) — internally consistent, not assumed.
- **Exact commits for PR #84's 2 known defects:** `2039538` and `c3b184b`, both children of
  `b7634e2` (the `#83`/`#84` merge). All three hashes still resolve in this repo
  (`git cat-file -t` confirmed for all four hashes used in this document before reading any diff).

## Part 1 — PR #85 re-adjudication (12/12 findings, all confirmed fabricated)

Every finding below was checked against the actual historical file content at `7f07fd68` (via
`git show 7f07fd68:<path>`), not assumed false by default. Each verdict states the specific
mechanism that falsifies it — this is not "these all look like the same pattern as before,"
each one was independently traced.

| # | Domain | Location | Claim | Verdict | Why (mechanism, not vibes) |
|---|---|---|---|---|---|
| 1 | correctness | `src/cli/index.ts:317` | "`event.status` may be null/undefined, causing a runtime error" | **FALSE** | Real code: `event.status && event.status !== 'ok' ? ... : ''`. The `&&` short-circuits to falsy when `status` is undefined — no error, `statusSuffix` becomes `''`. The finding's own quoted "evidence" is a paraphrased nested-ternary that doesn't match the source text at all (`locationCheck`-style mismatch). |
| 2 | correctness | `src/core/runner.ts:393` | "`agentStatus.coverage` may be null/undefined, causing a runtime error" — quotes `status: agentStatus.coverage \|\| 'unknown',` | **FALSE** | That quoted line does not exist anywhere in the diff or file. The real line is `status: agentStatus.coverage,` — no `\|\| 'unknown'`. And even on its own terms: `agentStatus.coverage` is assigned on the immediately preceding line (`agentStatus.coverage = classifyAgentError(err)`) inside the same synchronous `catch` block, so it cannot be undefined when read 8 lines later. Reading `undefined` from an object property is not a JS runtime error regardless. |
| 3 | design | `src/core/runner.ts:378` | "SwarmRunner violates SRP: agent management + progress reporting" | **FALSE** | No evidence quoted (basis marked INFERRED despite zero citation — arguably should have been SPECULATIVE). Backwards on inspection: `onProgress` is an *injected callback parameter*, not internal reporting logic — this is the textbook way to avoid exactly the coupling being alleged. The diff itself only adds one field (`status: 'ok'`) to an already-existing call. |
| 4 | complexity | `src/cli/index.ts:313` | "Cyclomatic complexity of 63" | **FALSE** | The cited function (the `onProgress` callback) is ~40 lines with roughly 8–10 real branches — nowhere near a real CC of 63. `ComplexityAgent`'s prompt only reports a real `lizard`-measured number when `complexityThreshold` is configured (`source: "lizard"`); `DEFAULT_CONFIG` never sets it, so this run used pure LLM guessing (`source: "llm"`) with no tool backing the number. The diff added ~5 lines to an already-existing function — not diff-attributable regardless. |
| 5 | design | `src/core/schema.ts:408` | "AgentProgressEvent violates ISP: mixes end-only and general fields" | **FALSE** | The interface already had 4 other `// Set on 'end' only` optional fields (`elapsedMs`, `attemptMs`, `attempts`, `earlyExit`) *before* this diff. The diff adds exactly one more optional field (`status`) following that same pre-existing, deliberate, documented convention. Not a new pattern, not something this diff introduced. |
| 6 | design | `src/core/chunkRunner.ts:93` | "runChunked violates SoC: chunk processing + logging" | **FALSE** | The diff added one `console.warn(...)` diagnostic line inside an existing loop. A single log statement co-located with real work is not a meaningful separation-of-concerns violation by any normal engineering standard — this would flag most real-world code. |
| 7 | adversarial | `src/cli/index.ts:318` | "If `event.status` is undefined, statusSuffix will be `' (undefined)'`" | **FALSE** | Directly contradicted by the code: `event.status && event.status !== 'ok' ? ... : ''` — the `&&` guard specifically prevents `' (undefined)'` from ever appearing. Claims the exact opposite of what the guard does. |
| 8 | adversarial | `src/core/chunkRunner.ts:95` | "If chunks array is empty, the loop won't execute, no results processed" | **FALSE** | States normal, correct JS semantics (empty-array iteration = zero iterations) as if it were a defect, with no demonstrated downstream consequence. Also unreachable in practice: `cli/index.ts` already rejects an empty diff before `runChunked` is ever called, so `splitByFileBoundary` always receives non-empty input. |
| 9 | adversarial | `src/core/runner.ts:465` | "If `agentStatus[agent.name]` is undefined, status will be undefined" | **FALSE** | Same shape as #2: `agentStatus[agent.name] = classifyAgentError(err)` is assigned on the immediately preceding line, synchronously, before the read. Cannot be undefined at read time. |
| 10 | adversarial | `src/core/runner.ts:537` | Same claim, parallel-execution path | **FALSE** | Identical mechanism to #9, confirmed in the parallel (`Promise.allSettled`) branch's own catch block — same immediately-preceding synchronous assignment. |
| 11 | adversarial | `src/core/runner.ts:873` | "If `agentStatus.testgen` is undefined, status will be undefined" | **FALSE — most severe case** | This diff has exactly 6 hunks in `runner.ts`, at original lines 378/392/443/462/517/532. **None are anywhere near line 873.** The code at line 873 (`agentStatus.testgen = 'ok'` / `classifyAgentError(err)`) is pre-existing, completely untouched by this diff — and at this commit, testgen's `onProgress` 'end' emission doesn't even have a `status:` field yet (that gap was fixed later, during `#85`'s own merge-conflict resolution — already documented in `progress.md`). This finding describes a location and a code shape that simply do not exist in the reviewed diff at all. |
| 12 | observability | `src/core/runner.ts:392` | "Catch block swallows exceptions without logging" | **FALSE** | The catch block visibly calls `console.warn(\`[ai-review] Agent coverage timed out or failed: ${(err as Error).message}\`)` two lines above the cited location. Directly contradicted by visible code. |

**Result: 12/12 confirmed fabricated, independently verified against the actual historical
code/diff — not assumed.** Every "correctness"/"adversarial" finding either quotes evidence that
doesn't exist in the source, or asserts a failure mode the code's own guard clause specifically
prevents, or (finding 11) describes a location the diff never touched. Every "design"/"complexity"
finding is either disconnected from what the diff actually changed, backwards on inspection (the
SRP claim), or unsupported by any real measurement (the complexity claim). This is a stronger result
than the prior "11 fabricated" claim implied — not because the number changed, but because this
time each one was traced to its specific falsifying mechanism rather than characterized in
aggregate.

**One meta-observation, not a finding about PR #85 itself:** three of the four `design`-domain
findings across this session's whole ACR history (this one included) are unevidenced architectural
opinions marked `INFERRED` rather than `SPECULATIVE`. Per `standards/CODE-REVIEW.md`'s own Basis
taxonomy, a claim with zero quoted evidence arguably belongs in `SPECULATIVE`, not `INFERRED` —
worth a separate look at the `design` agent's prompt, not addressed here.

## Part 2 — PR #84 oracle (pre-registered before any model runs)

Same format as `calibration/fixtures/adversarial-dirty.oracle.json`. Snapshot: commit `b7634e2`
(the `#83`/`#84` merge), before either fast-follow fix. Both defects read directly from that
commit's actual file content, not inferred from the fixing diffs alone.

```json
{
  "version": "1.0.0",
  "snapshot": "b7634e2",
  "createdAt": "2026-09-21",
  "notes": "Pre-registered before any model has reviewed this diff. Both defects were found by human opposition review / change-review of the real #83/#84 merge, not planted -- unlike adversarial-dirty's synthetic fixture, this fixture's defects are historically real.",
  "defects": [
    {
      "id": "D1-agentsSkipped-earlyExit",
      "category": "incomplete-coverage-claim",
      "location": {
        "file": "src/core/chunkRunner.ts",
        "function": "mergePolicy",
        "callSite": "mergeResults (const mergedPolicy = mergePolicy(results))"
      },
      "mechanism": "mergePolicy(results) computes agentsSkipped as [...counts.entries()].filter(([, n]) => n === results.length) -- using results.length (chunks that actually ran) as the 'skipped in every chunk' denominator, with no check against totalChunks. mergeToolAvailability, one line above the same call site, already receives coverageIncomplete = results.length < totalChunks as an explicit guard; mergePolicy receives no such parameter.",
      "consequence": "When runChunked's loop breaks early on an earlyExit result, chunks after the break are never examined. mergePolicy can still claim an agent was 'skipped entirely' for the whole run based only on the chunks that did run -- an unprovable completeness claim, since a later unexamined chunk might not have excluded the agent at all. Reaches the documented --format json envelope.",
      "minimumEvidence": "Citing chunkRunner.ts's mergePolicy function and/or its call site in mergeResults, describing the missing coverageIncomplete-style guard (comparing to mergeToolAvailability's existing one is not required to count, but the missing-denominator-guard mechanism must be identified)",
      "fixingCommit": "2039538",
      "fixingTest": "tests/unit/chunkRunner.test.ts: 'demotes a full-run skip to a narrowed view when the chunk loop broke early'"
    },
    {
      "id": "D2-mergePolicy-truthy-empty",
      "category": "contract-shape-violation",
      "location": {
        "file": "src/core/chunkRunner.ts",
        "function": "mergePolicy",
        "line": "final return statement"
      },
      "mechanism": "mergePolicy's final line unconditionally returns { agentsSkipped, reason }, even when agentsSkipped computed to an empty array. The non-chunked path (runner.ts) only ever sets policy on the result when agentsSkipped.length > 0 -- it can never produce a truthy policy object with an empty agentsSkipped array.",
      "consequence": "A chunked run can attach policy: { agentsSkipped: [], reason: {} } to the envelope -- a shape that contradicts the documented --format json contract ('policy only appears when at least one agent was skipped') for any consumer checking truthiness (if (result.policy)) instead of .agentsSkipped.length. Sibling functions mergeToolAvailability/mergeFilteredFiles already return undefined in the equivalent empty case.",
      "minimumEvidence": "Citing mergePolicy's final return statement and identifying that it can return a truthy object when agentsSkipped is empty, contradicting the non-chunked path's undefined-when-empty behavior",
      "fixingCommit": "c3b184b",
      "fixingTest": "tests/unit/chunkRunner.test.ts: 4 existing tests changed from expect(merged.policy?.agentsSkipped).toEqual([]) to expect(merged.policy).toBeUndefined()"
    }
  ],
  "trap": {
    "id": "no-trap-in-this-checkpoint",
    "note": "Unlike adversarial-dirty, this real-PR diff has no deliberately-planted false-positive bait. Any finding not matching D1 or D2 is unclassified until manually adjudicated -- a model may surface a genuine third issue not in this oracle, per the approved contract's explicit instruction to treat every other finding as unclassified rather than assumed wrong."
  }
}
```

**Diff to be reviewed (once models run):** `git diff $(git merge-base main b7634e2)...b7634e2` —
not yet extracted to a fixture file, pending sign-off at this checkpoint.

## What happens next (blocked on sign-off)

1. Extract the `b7634e2` diff to a fixture file (mirroring `adversarial-dirty.diff`'s pattern).
2. Run all three models once each against both historical diffs (PR #85's `7f07fd68` diff, PR #84's
   `b7634e2` diff) — N=1 per model per diff, a checkpoint, not a scored N=20 batch.
3. Manually adjudicate every finding either model produces against real ground truth: for PR #85,
   against the 12-row table above (does the model avoid the same 12 fabrications?); for PR #84,
   against the D1/D2 oracle above, treating anything else as unclassified per the contract.
4. Write up whether the synthetic-fixture ranking transfers — explicitly bounded as N=2, not a
   corpus-level conclusion.

**Not doing without further sign-off:** running any model, building a fixture file from the b7634e2
diff, or drawing any conclusion about model ranking. This document is the checkpoint artifact itself.
