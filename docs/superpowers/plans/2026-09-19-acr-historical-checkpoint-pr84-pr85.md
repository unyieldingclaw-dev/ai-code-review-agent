# Historical Checkpoint: PR #84 and PR #85 — Re-Adjudication and Oracle

**Status:** all 6 runs complete and adjudicated, 2026-09-21. **Headline: the synthetic-fixture
ranking does not transfer to real code.** Ornith, the synthetic recall leader (52.5% mean
exact-recall), produced zero findings on both real diffs — timing out on a majority of agents on
each. No model detected either of PR #84's 2 pre-registered real defects. Devstral reproduced 2 of
its original 12 fabrications verbatim and added 3 new ones with nonsensical security framing.
Qwen3.5 had the best runtime (zero timeouts on either diff) but its `lizard`-attributed complexity
numbers were fabricated in 2 of 3 cases despite the tool genuinely running — a new, separate
finding about tool-attribution reliability, not specific to this checkpoint.

**Explicit scope constraint, restated from the approved contract: this is NOT "the historical
corpus."** N=2 is far too small to rank models. This is a first real-code checkpoint testing
whether the synthetic-fixture ranking (Ornith best recall, Qwen3.5 best restraint/runtime, Devstral
weakest) transfers to real PRs on this repo. **It does not, at least not at N=2** — see Part 3 below.

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

| #   | Domain        | Location                     | Claim                                                                                                                           | Verdict                      | Why (mechanism, not vibes)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --- | ------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | correctness   | `src/cli/index.ts:317`       | "`event.status` may be null/undefined, causing a runtime error"                                                                 | **FALSE**                    | Real code: `event.status && event.status !== 'ok' ? ... : ''`. The `&&` short-circuits to falsy when `status` is undefined — no error, `statusSuffix` becomes `''`. The finding's own quoted "evidence" is a paraphrased nested-ternary that doesn't match the source text at all (`locationCheck`-style mismatch).                                                                                                                                                                                                                                                                           |
| 2   | correctness   | `src/core/runner.ts:393`     | "`agentStatus.coverage` may be null/undefined, causing a runtime error" — quotes `status: agentStatus.coverage \|\| 'unknown',` | **FALSE**                    | That quoted line does not exist anywhere in the diff or file. The real line is `status: agentStatus.coverage,` — no `\|\| 'unknown'`. And even on its own terms: `agentStatus.coverage` is assigned on the immediately preceding line (`agentStatus.coverage = classifyAgentError(err)`) inside the same synchronous `catch` block, so it cannot be undefined when read 8 lines later. Reading `undefined` from an object property is not a JS runtime error regardless.                                                                                                                      |
| 3   | design        | `src/core/runner.ts:378`     | "SwarmRunner violates SRP: agent management + progress reporting"                                                               | **FALSE**                    | No evidence quoted (basis marked INFERRED despite zero citation — arguably should have been SPECULATIVE). Backwards on inspection: `onProgress` is an _injected callback parameter_, not internal reporting logic — this is the textbook way to avoid exactly the coupling being alleged. The diff itself only adds one field (`status: 'ok'`) to an already-existing call.                                                                                                                                                                                                                   |
| 4   | complexity    | `src/cli/index.ts:313`       | "Cyclomatic complexity of 63"                                                                                                   | **FALSE**                    | The cited function (the `onProgress` callback) is ~40 lines with roughly 8–10 real branches — nowhere near a real CC of 63. `ComplexityAgent`'s prompt only reports a real `lizard`-measured number when `complexityThreshold` is configured (`source: "lizard"`); `DEFAULT_CONFIG` never sets it, so this run used pure LLM guessing (`source: "llm"`) with no tool backing the number. The diff added ~5 lines to an already-existing function — not diff-attributable regardless.                                                                                                          |
| 5   | design        | `src/core/schema.ts:408`     | "AgentProgressEvent violates ISP: mixes end-only and general fields"                                                            | **FALSE**                    | The interface already had 4 other `// Set on 'end' only` optional fields (`elapsedMs`, `attemptMs`, `attempts`, `earlyExit`) _before_ this diff. The diff adds exactly one more optional field (`status`) following that same pre-existing, deliberate, documented convention. Not a new pattern, not something this diff introduced.                                                                                                                                                                                                                                                         |
| 6   | design        | `src/core/chunkRunner.ts:93` | "runChunked violates SoC: chunk processing + logging"                                                                           | **FALSE**                    | The diff added one `console.warn(...)` diagnostic line inside an existing loop. A single log statement co-located with real work is not a meaningful separation-of-concerns violation by any normal engineering standard — this would flag most real-world code.                                                                                                                                                                                                                                                                                                                              |
| 7   | adversarial   | `src/cli/index.ts:318`       | "If `event.status` is undefined, statusSuffix will be `' (undefined)'`"                                                         | **FALSE**                    | Directly contradicted by the code: `event.status && event.status !== 'ok' ? ... : ''` — the `&&` guard specifically prevents `' (undefined)'` from ever appearing. Claims the exact opposite of what the guard does.                                                                                                                                                                                                                                                                                                                                                                          |
| 8   | adversarial   | `src/core/chunkRunner.ts:95` | "If chunks array is empty, the loop won't execute, no results processed"                                                        | **FALSE**                    | States normal, correct JS semantics (empty-array iteration = zero iterations) as if it were a defect, with no demonstrated downstream consequence. Also unreachable in practice: `cli/index.ts` already rejects an empty diff before `runChunked` is ever called, so `splitByFileBoundary` always receives non-empty input.                                                                                                                                                                                                                                                                   |
| 9   | adversarial   | `src/core/runner.ts:465`     | "If `agentStatus[agent.name]` is undefined, status will be undefined"                                                           | **FALSE**                    | Same shape as #2: `agentStatus[agent.name] = classifyAgentError(err)` is assigned on the immediately preceding line, synchronously, before the read. Cannot be undefined at read time.                                                                                                                                                                                                                                                                                                                                                                                                        |
| 10  | adversarial   | `src/core/runner.ts:537`     | Same claim, parallel-execution path                                                                                             | **FALSE**                    | Identical mechanism to #9, confirmed in the parallel (`Promise.allSettled`) branch's own catch block — same immediately-preceding synchronous assignment.                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 11  | adversarial   | `src/core/runner.ts:873`     | "If `agentStatus.testgen` is undefined, status will be undefined"                                                               | **FALSE — most severe case** | This diff has exactly 6 hunks in `runner.ts`, at original lines 378/392/443/462/517/532. **None are anywhere near line 873.** The code at line 873 (`agentStatus.testgen = 'ok'` / `classifyAgentError(err)`) is pre-existing, completely untouched by this diff — and at this commit, testgen's `onProgress` 'end' emission doesn't even have a `status:` field yet (that gap was fixed later, during `#85`'s own merge-conflict resolution — already documented in `progress.md`). This finding describes a location and a code shape that simply do not exist in the reviewed diff at all. |
| 12  | observability | `src/core/runner.ts:392`     | "Catch block swallows exceptions without logging"                                                                               | **FALSE**                    | The catch block visibly calls `console.warn(\`[ai-review] Agent coverage timed out or failed: ${(err as Error).message}\`)` two lines above the cited location. Directly contradicted by visible code.                                                                                                                                                                                                                                                                                                                                                                                        |

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

## Part 3 — Results (N=1 per model per diff, run 2026-09-21)

**Run configuration, locked before any run:** both diffs extracted verbatim via
`git diff $(git merge-base main <commit>)...<commit>` to `calibration/fixtures/historical-pr85.diff`
(425 lines) and `historical-pr84.diff` (1146 lines) — the same three-dot form `review.yml` uses, so
these are the exact diffs a real CI run would have seen. Invoked directly via
`ai-review-agent --diff <fixture> --model <name> --timeout 300000 --format json --out <path>` — the
real CLI, default full 14-agent set (no `--profile`), not new `calibrate.ts` machinery, since this
is explicitly N=1 per cell, not a repeated scored batch. Order locked to match the N=20×3 study:
`devstral:latest` → `qwen3.5:9b` → `ornith-1.5:9b`, each against PR #85's diff then PR #84's.

| Model           | Diff   | Duration | Timeouts (of 14)                                                                       | Findings (post-synthesis) |
| --------------- | ------ | -------- | -------------------------------------------------------------------------------------- | ------------------------- |
| devstral:latest | PR #85 | 18.5 min | 1 (adversarial)                                                                        | 10                        |
| devstral:latest | PR #84 | 44.6 min | 5 (coverage, adversarial, integration, observability, complexity)                      | 15                        |
| qwen3.5:9b      | PR #85 | 16.0 min | 0                                                                                      | 13                        |
| qwen3.5:9b      | PR #84 | 13.5 min | 0                                                                                      | 13                        |
| ornith-1.5:9b   | PR #85 | 40.9 min | 7 (coverage, correctness, design, adversarial, integration, observability, complexity) | **0**                     |
| ornith-1.5:9b   | PR #84 | 48.1 min | 7, plus a `complexity` parse-error after 2 attempts                                    | **0**                     |

### PR #84 — D1/D2 oracle: 0/3 detections across all three models

**No model detected either pre-registered defect.** Ornith produced no findings at all (see table).
Qwen3.5's 13 findings were all test-coverage suggestions for newly-added functionality (largely
accurate descriptions of what changed, but none identifying either defect's mechanism) plus 2
fabricated complexity numbers (below). **Devstral came closest in subject matter but not in
substance**: `performance-0` and `correctness-0` both describe `mergePolicy`'s denominator using
`withPolicy.length` instead of `results.length` — but that is the **already-fixed, pre-b7634e2**
bug the code comment itself documents as resolved ("BUG FIXED 2026-09-12"). At b7634e2 the real
computation already correctly uses `results.length`; devstral's `correctness-0` actually cites an
unrelated early-return guard (`if (withPolicy.length === 0) return undefined`) and misidentifies it
as the flawed denominator. This is neither D1 nor D2 — it's the model pattern-matching on a code
comment describing a past, resolved bug and hallucinating that it still applies, a third failure
mode distinct from anything in the PR #85 table. Devstral's other 13 findings: 5 mislabel ordinary
union/intersection merge logic as "IDOR" (Insecure Direct Object Reference — an access-control
vulnerability category that does not apply to internal diagnostic metadata with no external actor
involved at all); 1 (`correctness-1`) flags `result.policy?.agentsSkipped ?? []` for a null-deref
risk that its own optional-chaining and nullish-coalescing already prevent; 6 (`error-handling-0`
through `-5`) repeat the identical templated claim ("catch block logs policyLines and continues")
across 6 different files and lines, several of whose quoted "evidence" isn't inside any catch block
at all — the clearest sign of boilerplate hallucination in this whole checkpoint.

### PR #85 — re-adjudication against the 12-row table

**Devstral (10 findings):** 2 are verbatim repeats of the original review's fabrications (`missing
error logging` at `runner.ts:392` and `:532` — both catch blocks visibly call `console.warn` with
the error message, confirmed again). 3 more are new fabrications with nonsensical security framing:
"command injection via stderr output" (writing an internal, non-attacker-controlled `AgentStatus`
string to stderr cannot be command injection — nothing executes it) and "command injection via
status field" (an interface's type declaration cannot be "injected into"). 1 repeats the ISP
critique on `AgentProgressEvent` (still false for the same reason as the original: pre-existing
deliberate pattern, not new). 1 mischaracterizes a once-per-run error-handling branch as a "hot
path" needing allocation optimization. 1 claims the diff added `status` handling with no tests —
directly contradicted by the diff's own content: 6 real `expect(...).status` assertions across
sequential, coverage, and parallel paths, plus a mutation-testing note confirming all 10 mutations
were killed. **The remaining 2 are genuinely tool-backed** (`source: "lizard"`, confirmed against
this repo's real complexity thresholds) rather than fabricated, though one's cited evidence line
didn't precisely match (`locationCheck: mismatch`).

**Qwen3.5 (13 findings, all medium, zero from security/correctness/adversarial):** meaningfully
different character than devstral. Six repeat the "catch block doesn't log the exception" theme,
but more carefully than the original review's flat claim — qwen3.5 says the **stack trace**
specifically is lost (true: `console.warn` only prints `.message`, never `.stack`), while overstating
that "the original Error object... is lost" (false: `.message` does survive via the existing
`console.warn` call). Partially accurate, not a clean fabrication. Two are legitimate, low-materiality
architecture observations (`console.warn` called directly rather than through an injected logger
abstraction — factually true, if debatable as a real problem). Four are complexity findings, three
of which claim specific `lizard`-sourced CCN numbers — **verified directly by running `lizard`
myself against the actual historical files: two are fabricated** (no `CCN=22` or `CCN=63` exists
anywhere in the real `chunkRunner.ts`/`runner.ts` at this commit — the real maxima are 12 and 13),
**but the third is exactly correct** (`formatMcpOutput`, `CCN=26`, confirmed against `b7634e2`'s
actual `src/mcp/formatter.ts`, which genuinely exceeds lizard's own >15 warning threshold). This is
a new finding in its own right, separate from the model-ranking question: **`source: "lizard"` is
not reliable provenance** — the model can and does fabricate tool-attributed numbers even when the
real tool ran and real numbers were available to it, at least some of the time.

**Ornith (0 findings):** nothing to adjudicate. 7 of 14 agents timed out; the 7 that completed
returned no findings at all.

## Conclusion: the synthetic-fixture ranking does not transfer, at least not at N=2

Ornith went from the strongest recall performer on `adversarial-dirty` (52.5% mean exact-recall) to
zero signal on both real diffs. Qwen3.5's real-code advantage was runtime reliability (zero timeouts
on either diff, consistent with its synthetic-fixture standing) and a somewhat more careful
fabrication style (partially-accurate observability claims instead of flatly false ones) — but it
still fabricated tool-attributed numbers, and its 13 PR #84 findings, while mostly non-fabricated in
content, missed both real defects entirely. Devstral remained the most productive by volume and the
most consistently wrong on security-flavored claims, and additionally demonstrated a new failure
mode (hallucinating that an already-fixed historical bug still applies, from pattern-matching a code
comment describing its own resolution).

**This is a real, if small, result — not a null one:** every model missed both pre-registered real
defects on real code, and the specific ways the "restraint" measurement's ranking did or didn't
carry over (Ornith's collapse, Qwen3.5's continued reliability edge) are each individually
informative, even at N=2. **What it explicitly does not support:** any claim about which model is
"best" for this repo's actual PRs, or any production model change. That requires the labeled
historical corpus this checkpoint was built to test the feasibility of studying at all.

**Not done, and not implied by this result:** any code or config change, any production model
change, or extending this to more historical PRs without a fresh decision to do so.
