# earlyExit visibility — adversarial design review (2026-08-31)

Findings from an adversarial pass over the proposed fix, run BEFORE any code was written.
Every surface returned `yes-with-changes`: the design survives but not as proposed.

**Recovered from a workflow journal after 5 of 12 agents failed on a spend limit.** The six
attack agents completed; the test-derivation stage did not, except for chunkRunner.

---

## src/cli/index.ts (change 8) + cross-repo call-site audit for formatMarkdown / formatSarif / formatGithubAnnotations / formatMcpOutput / formatJson

Verdict: `yes-with-changes`

### [BLOCKER] O1

**Where:** `.github/workflows/review.yml:109-183 (render at :148 `lines.push('✅ No issues found.')`)`

**Problem:** FIFTH SURFACE — the GitHub Actions PR comment. `.github/workflows/review.yml` runs `ai-review-agent --diff pr.diff --format json --out findings.json` and then renders the PR comment with its own inline github-script, reading ONLY `result.findings`. It never touches earlyExit, agentStatus, truncation, or the proposed agentsConfigured. With zero surviving findings it literally posts `✅ No issues found.` The four-formatter rule in systemPatterns does not reach this code at all, because it is not a formatter — it is a hand-rolled renderer in YAML. After all 8 proposed changes land, a fail-fast run still posts a green PR comment. This is the highest-visibility surface in the repo and the fix does not touch it.

**Fix:** Add a 9th change: in the github-script block, after `const result = JSON.parse(...)`, prepend an incompleteness line when `result.earlyExit || result.truncation?.truncated || Object.values(result.agentStatus||{}).some(s=>s!=='ok')`, e.g. `⚠️ INCOMPLETE — stopped after ${result.earlyExit.stoppedAt}; ${ran}/${result.agentsConfigured} agents ran.` and suppress the `✅ No issues found.` branch when that condition holds. Better still: make the workflow consume `--format markdown --out report.md` for the comment body so it inherits formatMarkdown's gate for free and stops being a parallel renderer that must be kept in sync by hand.

### [BLOCKER] O2

**Where:** `.github/workflows/review.yml:184-199 (fallback at :198)`

**Problem:** SIXTH SURFACE — the GitHub Step Summary. A separate `node -e` block, also reading findings.json, also rendering only `r.findings`, falling back to the table row `| — | — | — | No findings |`. Same blindness as O1, same absence from the four-formatter rule, and it is the surface a reviewer sees on the Actions run page rather than the PR. Note both O1 and O2 already render a _truncated_ run and an _all-agents-failed_ run as clean too — this is a pre-existing hole that earlyExit is about to fall into, so fixing it for earlyExit alone would leave the hole half-patched.

**Fix:** Same treatment as O1 — gate the `No findings` fallback on the same incompleteness predicate and emit a header line naming earlyExit.stoppedAt and ran/agentsConfigured. Factor the predicate into one exported helper (e.g. `isIncomplete(result)` in src/core/schema.ts) that formatMarkdown, mcp/formatter, sarif, githubAnnotations AND the two workflow blocks all call, so the count of surfaces stops being something a future change has to rediscover.

### [BLOCKER] O3

**Where:** `vscode-extension/src/types.ts:33-37 and vscode-extension/src/output.ts:29-31`

**Problem:** SEVENTH SURFACE — the VS Code extension, and it is the one that structurally CANNOT see the field. `vscode-extension/src/types.ts` is a hand-maintained structural mirror (its own comment: 'Local mirrors of ai-review-agent's core/schema.ts types... do not import from the package') and its `ReviewResult` is exactly `{ findings, testFiles, summary }` — no earlyExit, no agentStatus, no truncation, and it will not gain agentsConfigured. `renderReport` prints `✅ No issues found.` on `findings.length === 0` and otherwise a bare `${count} ${plural} | ${summary.durationMs}ms` header — the same bare-count verdict that formatter.ts:53-56's comment says 'a reader who takes it at face value has no reason to suspect 70% of the diff was never looked at'. The extension consumes `formatJson` output via stdout (runner.ts spawns the CLI and JSON.parses stdout), so adding agentsConfigured to the envelope reaches it on the wire but is dropped at the type boundary and never rendered.

**Fix:** Add `earlyExit?: { stoppedAt: string }`, `agentStatus?: Record<string,string>`, `truncation?: {...}` and `agentsConfigured?: number` to the types.ts mirror, and gate output.ts's `✅ No issues found.` / bare-count header on the same predicate from O2's helper. Also note the interaction with the NO-EXIT-CODE-CHANGE constraint: runner.ts:106 `if (code !== 0)` rejects the whole run as `cli-error:<stderr>`, so keeping fail-fast at exit 0 is what makes the extension accept the result and render it clean. The constraint is right, but it is precisely what makes this surface silent — the design must own that, not assume the exit code protects anyone.

### [IMPORTANT] O4

**Where:** `src/cli/index.ts:233 (with src/core/config.ts:141-148)`

**Problem:** The constraint 'a consumer who never passes --fail-fast must still be protected' is currently satisfied only by accident, via a bug the code already flags. `loadConfig` reads `ai-review.config.json` and shallow-merges `Partial<ReviewConfig>`, which includes `failFast`. But index.ts:233 does `config.failFast = !!options.failFast` UNCONDITIONALLY, stomping a config-file `"failFast": true` back to false on every run that omits the flag. The comment immediately below at :235-238 names this exact pattern and calls it 'pre-existing and out of scope to change here'. So today the workflow (O1/O2) and the extension (O3) cannot reach earlyExit — not because they are protected, but because file-configured fail-fast silently does not work. The moment anyone makes that assignment conditional (as `verifyEvidence` already is), all three surfaces silently start rendering fail-fast runs as green.

**Fix:** Do not rely on this. Fix O1/O2/O3 on their own merits so the protection does not depend on an acknowledged bug staying unfixed. If the design wants to lean on it at all, say so explicitly in the commit body and add a regression test asserting that config-file failFast is currently ignored, so the day someone fixes the stomp they are forced to look at these three surfaces.

### [IMPORTANT] O5

**Where:** `src/core/runner.ts:434-435 and :878-884 vs src/cli/index.ts:422-437`

**Problem:** The premise 'a --fail-fast run ... exits 0' is only conditionally true, and stating it flatly will produce a wrong test. `shouldEarlyExit` (runner.ts:239-245) evaluates against the RAW accumulated agent findings at runner.ts:434-435 — before `this.orchestrator.synthesize(...)` runs at runner.ts:878-884 — and it uses the SAME `config.failOn` threshold that `shouldFail` uses in the exit ladder. So whenever the triggering finding survives synthesize (dedup, hallucination drop, maxFindings cap), `hasBlocker` is true and the run exits 1, not 0. Exit 0 with `earlyExit` set is reachable only when the very finding that stopped the swarm is subsequently filtered out — which is the genuinely invisible case, but it is not the general case.

**Fix:** Restate the exit-code claim precisely in the commit message and in any test: a fail-fast run exits 1 when the triggering finding survives synthesize, and 0 when it is filtered — identical before and after this change, because the ladder at index.ts:422-437 is untouched. Write the regression test for the exit-0 branch specifically (earlyExit set, findings empty), not for 'fail-fast exits 0'.

### [MINOR] O6

**Where:** `src/cli/index.ts:404-412`

**Problem:** Change 8's removal is behaviour-neutral only if change 4 reproduces two things the current footer carries: the agent name (`result.earlyExit.stoppedAt`) and the noEmoji variant. The existing block renders `⚡ ` only when `options.emoji !== false`; formatMarkdown's internal `useEmoji = !options?.noEmoji` with index.ts:402 passing `{ noEmoji: options.emoji === false }` is equivalent, so the plumbing is fine — but a banner that says only 'stopped early' without naming stoppedAt is a regression in information, not a relocation. Also note the footer currently lands at the very bottom, after the timing lines; moving it into formatMarkdown will change its position and may move it above them.

**Fix:** Keep the literal `stoppedAt` name in whatever formatMarkdown emits, and add a formatMarkdown test asserting both the emoji and noEmoji renderings contain the agent name — so the removal at index.ts is provably a move, not a deletion. Separately, do NOT remove the live stderr progress line at index.ts:318-324; it is the only earlyExit signal that appears while a long run is still going.

**Would render:**

```
⚠️ INCOMPLETE — **0 findings** from 3/15 agents that completed | 42000ms

...

> ⚡ **Fail-fast**: swarm stopped after `security` (severity threshold met). Remaining agents were not run.

```

---

## src/core/chunkRunner.ts — merged ReviewResult for a `--chunk` + `--fail-fast` run (Change 3)

Verdict: `yes-with-changes`

### [BLOCKER] CHUNK-1

**Where:** `src/core/chunkRunner.ts:245-257 (with src/cli/formatter.ts:65-69)`

**Problem:** THE TRAP RECURS, UNFIXED, IN THE CHUNKED PATH. `agentsConfigured` as a denominator only closes the hole when the numerator shrinks — and under --chunk it does not. mergeAgentStatus (chunkRunner.ts:245-257) takes the UNION of agent names across every chunk that ran, keeping 'ok' unless some chunk reported worse. So on a 5-chunk run where chunks 1-2 complete all 15 agents and chunk 3 fail-fast-exits after 3, merged agentStatus has all 15 names, all 'ok'. formatter.ts:69 then renders numerator `totalAgents - failedAgents.length` = 15 and the proposed denominator = 15: "INCOMPLETE — 7 findings from 15/15 agents that completed". That is the exact string the task brief forbids ("reading as full coverage"), and it is now WORSE than the pre-fix status quo, because 40% of the diff (chunks 4 and 5) was never sent to any agent at all and the only number on the headline says everything ran. The agent-count axis is simply the wrong axis for a chunked early exit: the coverage lost is measured in chunks, not agents.

**Fix:** The denominator fix is necessary but not sufficient. The merged result must additionally carry the chunk-coverage fact, and formatMarkdown's `scope` string must prefer it over the agent ratio whenever it is present: `in ${reviewed}/${total} diff chunks reviewed`. Do not ship change 4's denominator alone and call the chunked case covered.

### [BLOCKER] CHUNK-2

**Where:** `src/core/chunkRunner.ts:78-93`

**Problem:** NOTHING ON THE MERGED RESULT RECORDS THE UNREVIEWED CHUNKS, AND CHANGE 3 AS WRITTEN DOES NOT ADD IT. `chunks.length` is computed at chunkRunner.ts:78 and is in scope at the `break` (line 90), but line 93 calls `mergeResults(results, maxFindings)` — passing only the chunks that RAN. mergeResults literally cannot know a chunk was skipped: `results.length` is all it sees, and a 3-chunk complete run and a 5-chunk run that broke at 3 are byte-identical inputs to it. I checked every field on the returned object (lines 155-178): findings, testFiles, summary, earlyExit, context, sanitizer, policy, agentStatus, hallucinationFilter, coverageGapFilter, toolAvailability, evidenceCheckFilter, filteredFiles, timings. NONE of them records that chunks 4 and 5 exist. The only place the number appears is the console.warn at lines 80-83, which is stderr-only, is emitted BEFORE the loop, and asserts "full diff coverage" — a claim the `break` at line 90 falsifies after it has already been printed. Nothing reaches findings.json, so PMB has no signal whatsoever.

**Fix:** Add `chunking?: { total: number; reviewed: number }` to ReviewResult, set it in runChunked (which owns both numbers) and thread it through mergeResults as an explicit parameter — not derived inside mergeResults. Gate the INCOMPLETE banner on `chunking.reviewed < chunking.total` on every surface. This touches no exit-code branch in cli/index.ts:423-438, so the NO-EXIT-CODE-CHANGE constraint holds. Do NOT derive `reviewed` from `timings.length`: schema.ts:328-334 states timings is legitimately absent on archived/hand-built results and "renderers must therefore treat absent and empty as the same nothing-measured case".

### [BLOCKER] CHUNK-3

**Where:** `src/core/chunkRunner.ts:219-236`

**Problem:** toolAvailability BECOMES A FALSE SECURITY-COVERAGE CLAIM ON AN EARLY BREAK, AND CHANGE 3 DOES NOT TOUCH IT. mergeToolAvailability (lines 219-236) reads `results` — chunks that ran. If gitleaks reported 'used' on chunks 1-3 and chunks 4-5 were never reviewed, `distinct.size === 1` so merged = 'used'. 'used' renders NOTHING in formatter.ts (only 'partial' at :159-168 and 'unavailable-llm-fallback' at :170-182 emit a line), so silence signals a completed secret scan across the whole diff while 40% of it was never scanned. This is verbatim the defect this file's own header says 'partial' was introduced to kill: "a partial first chunk followed by a clean one rendered as a COMPLETED tool scan, which is a claim about security coverage rather than a diagnostic detail" (lines 23-25). An early break reintroduces it through a different door, and mergeToolAvailability cannot see the door because it is never told chunks were skipped.

**Fix:** When the loop broke early, degrade every merged value that is not 'not-applicable' to 'partial'. Concretely: pass the skipped-chunk fact into mergeResults (see CHUNK-2) and, when set, collapse `merged[key]` to 'partial' for any key whose substantive set is non-empty. That yields the existing, already-correct "ran but could not cover every changed file" copy at formatter.ts:162-166 with no new rendering code.

### [BLOCKER] CHUNK-4

**Where:** `src/core/chunkRunner.ts:128 and :159-177 (with src/core/runner.ts:714-724, :775)`

**Problem:** `agentsConfigured` LAST-CHUNK-WINS IS NOT SAFE, AND max IS NOT SAFE EITHER. `total` (runner.ts:775) is not a run-level constant — it is derived from THAT CHUNK'S diff by two independent mechanisms. (a) runner.ts:714-717 drops 'migration-safety' when `!hasMigrationFiles(input.diff)`. (b) runner.ts:719-724 calls `evaluatePolicy(activeConfig.agents, changedFiles, ...)` where `changedFiles = extractChangedFiles(input.diff)`. Both take the CHUNK's diff, because runChunked passes `{ ...input, diff: chunkDiff }` (line 87). So a 5-chunk run where only chunk 4 touches a migration file legitimately computes total=15 for chunk 4 and total=14 for the rest. Taking `last` therefore reports 14 or 15 depending purely on where fail-fast happened. Taking `max` is better but still under-reports on an early break: if the break is at chunk 3 and chunk 4 was the only migration-file chunk, migration-safety was never configured anywhere in `results` and the max is 14 — a denominator that is silently one short of what a complete run would have planned. Separately, the NAME is wrong: `total` is post-migration-gate and post-policy, i.e. the agents this chunk decided to start, not what the user configured. A consumer reading `agentsConfigured: 10` on a run where agentPolicy skipped 5 will conclude the config had 10 agents.

**Fix:** Use `Math.max(...results.map(r => r.agentsPlanned ?? 0))` rather than `last`, and add a comment stating plainly that it is a max over the chunks that RAN and can under-report when a break skipped a chunk whose content would have enabled a diff-gated agent. Rename the field `agentsPlanned` (or `agentsStarted`) so it does not read as a config count. Note this makes the field a weak denominator under --chunk regardless — which is why CHUNK-1's chunk-based scope string, not this number, must carry the chunked headline.

### [IMPORTANT] CHUNK-5

**Where:** `src/core/chunkRunner.ts:167-169`

**Problem:** THE COMMENT AT 167-169 IS ALREADY FALSE TODAY, INDEPENDENT OF EARLY EXIT — so a comment-only rewrite scoped to fail-fast would leave a second live lie in place. diffSplit.ts:29-34 packs greedily and a single `diff --git` section larger than maxLines "still becomes its own chunk rather than being dropped or force-split" (diffSplit.ts:17-18; restated in this file's own header at lines 15-17). runner.run then truncates that oversized chunk at runner.ts:310 (`if (diffLines > this.config.maxDiffLines)`) and sets `truncation` at runner.ts:934. cli/index.ts:334-343 passes the SAME `config.maxDiffLines` to both the splitter and the runner, so this is reachable, not theoretical. mergeResults then drops that truncation at 167-169 on the stated premise that "chunking and truncation are mutually exclusive outcomes". They are not. The guard test does not catch it: tests/unit/chunkRunner.test.ts:208-215 uses `makeResult()` with no truncation on any chunk, so it only asserts that absent stays absent.

**Fix:** Do not quietly reword the comment to be about fail-fast. Either (a) restore a genuinely-truncated chunk's truncation on the merged result — which DOES change chunked-run exit codes to 3, so it needs its own decision and PMB sign-off, and is arguably correct since exit 3 there means 'partial coverage, remedy: raise --max-lines'; or (b) leave the behavior and rewrite the comment to state the real, narrower truth: truncation is dropped because a per-chunk truncation is a different failure from the whole-diff one the field was designed for, and this is a KNOWN under-report. Silence about it is not an option now that the line is being edited.

### [IMPORTANT] CHUNK-6

**Where:** `src/cli/index.ts:404-412`

**Problem:** THE FOOTER WORDING IS WRONG FOR THE CHUNKED CASE. cli/index.ts:411 emits "swarm stopped after `X` (severity threshold met). Remaining agents were not run." Under --chunk the material loss is not remaining agents — chunks 1..N-1 ran every agent — it is remaining CHUNKS of the diff that were never reviewed at all. Change 8 moves this string into formatMarkdown unchanged, which propagates the wrong sentence to the surface that now owns it.

**Fix:** Branch the footer on the presence of chunk-coverage info: with it, "stopped after `X` on chunk R of T — chunks R+1..T of the diff were never reviewed"; without it, keep the existing agent wording.

### [MINOR] CHUNK-7

**Where:** `src/core/chunkRunner.ts:86-91, :128, :159`

**Problem:** `last` IS the early-exiting chunk, and earlyExit IS carried — this part of the proposal is correct, but it is also the whole reason the bug is invisible. Line 89 pushes the result BEFORE line 90 breaks, so `results[results.length-1]` is exactly the chunk that stopped. Line 159 spreads `last.earlyExit` onto the merged result. So a chunked fail-fast run already reaches cli/index.ts:405 today and prints the footer — meaning the chunked path is not silent about earlyExit on markdown, only about the skipped chunks. Any test written for change 3 must therefore assert on the chunk-coverage field, not on `merged.earlyExit`, which already passes.

**Fix:** Add a test that runs 3 chunks, has chunk 2 return earlyExit, and asserts BOTH that runner.run was called twice AND that the merged result records total=3/reviewed=2 — the second assertion is the one that would fail today.

### [MINOR] CHUNK-8

**Where:** `src/core/chunkRunner.ts:119, :146-153`

**Problem:** summary.durationMs and timings are NOT lies under an early break — I checked both, and neither needs a change. durationMs (line 119) sums only the chunks that ran, which is the true wall-clock cost of what actually happened. timings (line 153) concatenates one row per run() call, so it holds exactly R rows for R reviewed chunks and each row's diffLines/effectiveTimeoutMs remain accurate for the pass it describes. The one caution is that a reader cannot distinguish 3 rows from a complete 3-chunk run and 3 rows from a broken 5-chunk run without the field CHUNK-2 adds.

**Fix:** No change. Do not extend change 3 to touch these; listing them as untouched in the PR description is enough.

**Would render:**

```
⚠️ INCOMPLETE — **7 findings** from 15/15 agents that completed | 412300ms
```

---

## MCP — src/mcp/formatter.ts (change 5), with src/mcp/tool.ts + src/mcp/server.ts reachability

Verdict: `yes-with-changes`

### [BLOCKER] O1-denominator-trap-reappears-on-mcp

**Where:** `src/mcp/formatter.ts:23`

**Problem:** The trap the brief warns about is fixed in change 4 (cli/formatter.ts) and left standing in change 5. mcp/formatter.ts:23 computes its own `totalAgents = Object.keys(agentStatus ?? {}).length` from the same shrinking map, and change 5 does not touch it. After the change, a fail-fast run that stopped at agent 4 of 14 with one timeout renders '⚠️ 1/4 agent(s) failed' — reading as 3-of-4 success on a 4-agent swarm. Worse, the run's OTHER count comes from timingSentence (timingReport.ts:71, `${t.agents.length} agents`), which also counts only agents that ran, so the MCP string states '4 agents' twice and never states 14. An LLM reader has no terminal, no exit code and no JSON envelope — those two numbers are its entire coverage picture, and both are wrong in the same direction. Change 5 must consume `agentsConfigured` too, not just change 4.

**Fix:** In change 5, replace `const totalAgents = Object.keys(agentStatus ?? {}).length` with the persisted scheduled count (`result.agentsConfigured ?? Object.keys(agentStatus ?? {}).length`, the fallback keeping archived findings.json renderable), and have the earlyExit line carry ran-vs-scheduled explicitly so the count exists even on the common fail-fast run where zero agents failed and the failedAgents block never renders at all.

### [BLOCKER] O2-incomplete-fires-when-nothing-was-skipped

**Where:** `src/mcp/formatter.ts:36-42`

**Problem:** Pushing earlyExit into `warnings` unconditionally makes INCOMPLETE fire on runs with full coverage. shouldEarlyExit is evaluated after EVERY sequential agent (runner.ts:434-449), so early exit on the LAST scheduled agent sets `earlyExit.stoppedAt` while the `break` skips nothing. Under MCP this is not a corner case: tool.ts:88 strips testgen, so nothing runs after the final specialist, and `if (!earlyExitAgent && hasTestgen)` (runner.ts:840) is moot. That run examined every agent it scheduled, yet the proposal renders '⚠️ INCOMPLETE'. This is precisely the failure mode this file's own WHY comment forbids: 'Folding these together would flip every clean run into "incomplete" ... training the caller to ignore the warning that actually matters.' The gate must be skipped-coverage, not the presence of the earlyExit field.

**Fix:** Gate the warnings push on real lost coverage: `const skipped = (result.agentsConfigured ?? 0) - Object.keys(agentStatus ?? {}).length; if (result.earlyExit && skipped > 0) warnings.push(...)`. agentStatus is written on both success and catch (runner.ts:434, 450), so it counts exactly the agents that STARTED — `scheduled - started` is exactly the never-ran count. When skipped === 0, render the earlyExit as a non-gating note (a fourth array, or fold into toolNotes' band) so the fact is still reported without claiming incompleteness.

### [IMPORTANT] O3-portion-reviewed-is-truncation-language

**Where:** `src/mcp/formatter.ts:122`

**Problem:** Both incomplete verdicts read '... in the portion reviewed' (lines 122 and 129). That phrase was written for the truncation and failed-agent cases and denotes a portion of the DIFF. A fail-fast run reviewed the WHOLE diff with a subset of agents — the opposite axis. An LLM reader acting on 'in the portion reviewed' will conclude the diff was partially seen, and the remedies it reaches for (re-run chunked, ask for the rest of the diff) are wrong and unavailable: tool.ts:100 forces chunk=false and review_diff exposes only repo_path (server.ts:41-52). Routing earlyExit through the shared `incomplete` boolean silently applies the wrong noun to a second, distinct kind of incompleteness.

**Fix:** Keep one `incomplete` gate but derive the phrase from the cause rather than hardcoding it: when earlyExit is the only reason, '⚠️ INCOMPLETE — N findings before the run stopped early (M of K agents never ran)'; when truncation/failure is also present, keep the existing wording and let both warning lines stand. Do not reuse 'portion reviewed' for an agent-coverage gap.

### [IMPORTANT] O4-stoppedAt-alone-is-not-actionable

**Where:** `src/mcp/formatter.ts:20`

**Problem:** Naming stoppedAt is not enough for this reader. server.ts:66 returns `{content:[{type:'text',text}]}` with no isError and no structured content — the string is the only channel, and unlike the CLI there is no exit code at all to fall back on. A bare 'stopped after `correctness`' gives the LLM an agent name it cannot convert into a coverage fraction: it does not know the roster order, and buildToolDescription (tool.ts:17) advertises 15 agents to that same reader, so it will anchor on 15 and guess. It also cannot tell a deliberate stop from a crash, which invites a pointless re-run. Separately, `agentsConfigured?: number` (change 1) forecloses the single most decision-relevant fact — WHICH domains went unexamined. 'security never ran' and 'complexity never ran' are not interchangeable to a reader deciding whether to approve a merge, and the names are recoverable at zero extra cost.

**Fix:** Persist the scheduled agent LIST, not a bare count — `agentsScheduled?: AgentName[]` from runner.ts:775's inputs — which serves change 4's denominator equally well via `.length`. The MCP line must state four things: (1) the stop was configuration, not failure; (2) ran-vs-scheduled as numbers; (3) the never-ran agent names (scheduled minus Object.keys(agentStatus)); (4) a remedy the reader can actually act on — `"failFast": false` in the reviewed repo's ai-review.config.json, since the MCP tool has no flag for it.

### [MINOR] O5-agentsConfigured-is-a-misnomer

**Where:** `src/core/runner.ts:775`

**Problem:** runner.ts:775's `total` is computed from `allowedAgents`/`agents` — the post-migration-safety-filter, post-evaluatePolicy set (runner.ts:713-727) — so it is 'agents scheduled to run', not 'agents configured'. On MCP the two diverge routinely: tool.ts:88 strips testgen, and DEFAULT_CONFIG.agentPolicy excludes security and adversarial on `**/*.md`, so a docs-heavy diff drops them from `total`. Persisting it as `agentsConfigured` and printing 'of N configured' would state a number the reader will compare against the 15 the tool description advertises, and the gap would be silently attributed to the early exit rather than to policy (which is reported separately via `policy.agentsSkipped`).

**Fix:** Name the field for what it holds — `agentsScheduled` — and word the MCP string as 'N of M agents scheduled for this run', never 'configured'. Policy-skipped agents already have their own channel and must not be folded into the early-exit count.

### [MINOR] O6-earlyExit-must-lead-the-warnings-array

**Where:** `src/mcp/formatter.ts:21`

**Problem:** Change 5 says 'push an earlyExit entry into warnings (line ~21)' without pinning the position. warnings is rendered in push order (line 78-79). If earlyExit lands after the failedAgents and truncation entries, the reader meets '1/4 agent(s) failed' before learning that 4 is not the whole swarm — it reads the small denominator before the sentence that explains it. earlyExit and truncation can also co-occur (a diff both truncated and fail-fasted), producing two incompleteness claims with different and non-substitutable remedies (--chunk vs failFast:false).

**Fix:** Unshift the earlyExit entry ahead of the failedAgents and truncation pushes so it frames the counts that follow, and keep the two remedies textually distinct so the reader does not apply --chunk to an agent-coverage gap.

### [MINOR] O7-zero-findings-plus-early-exit-is-self-contradictory

**Where:** `src/mcp/formatter.ts:84-86`

**Problem:** The headline case in the brief — a fail-fast run rendering 0 findings — is only reachable because synthesize (runner.ts:880) drops findings after shouldEarlyExit already fired on them (runner.ts:434). So the 0-findings path will render '⚠️ No findings, but the review was incomplete' alongside an earlyExit line asserting a severity threshold was met. Stated plainly that is a contradiction, and an LLM reader resolving it will most likely discount the warning as a tool bug. formatMcpOutput never reads `hallucinationFilter.dropped`, so the actual explanation is present in the envelope and absent from the string.

**Fix:** On the findings.length === 0 path, when earlyExit is set, say why the two coexist: 'the finding that triggered the stop did not survive the hallucination/dedup filter.' This is the strongest available signal that the filter ate a threshold-severity finding and it currently reaches no reader on this surface.

**Would render:**

```
## AI Code Review — ⚠️ No findings, but the review was incomplete

⚠️ Stopped early: `failFast` is enabled in this repo's `ai-review.config.json` and its `failOn: high` threshold was met at `correctness`. 4 of 14 scheduled agents ran; 10 never ran (design, dependencies, adversarial, integration, breaking-change, license, error-handling, observability, secrets, complexity) — no finding from those domains could appear below. This is configuration, not a failure. The finding that triggered the stop did not survive the hallucination/dedup filter, which is why the count is 0. For full coverage, set `"failFast": false` in the reviewed repo's `ai-review.config.json` and run `review_diff` again.
⏱️ Timing: 812 diff lines, 4 agents, 214s total, ceiling 180s/agent, slowest correctness 71s

```

---

## src/core/schema.ts + src/core/runner.ts (proposed changes 1 and 2: `agentsConfigured?: number` on ReviewResult, populated from `total` at runner.ts:775)

Verdict: `yes-with-changes`

### [BLOCKER] OBJ-1

**Where:** `src/core/runner.ts:715 and src/core/chunkRunner.ts:86-90,154-157`

**Problem:** `total` is NOT run-invariant across chunks, so change 3's last-chunk-wins carry produces a denominator SMALLER than the numerator. runner.ts:713-717 drops 'migration-safety' based on `hasMigrationFiles(input.diff)` -- and chunkRunner.ts:86-88 calls `runner.run(chunkInput)` with a DIFFERENT diff per chunk. A chunk that contains a .sql/migration file computes total=15; every other chunk computes total=14. Meanwhile mergeResults merges agentStatus as a UNION across chunks (chunkRunner.ts:127 mergeAgentStatus) while taking single-chunk fields last-chunk-wins (`last.earlyExit`, `last.policy`, `last.context`). If the migration file lands in chunk 2 of 5, the merged agentStatus holds 15 keys and `last.agentsConfigured` is 14. formatter.ts:69 then renders `15/14 agents that completed` -- a denominator smaller than its own numerator, which is a worse artifact than the shrinking denominator this whole fix exists to remove.

**Fix:** In mergeResults, do NOT use `last.agentsConfigured`. Use `const agentsConfigured = Math.max(...results.map(r => r.agentsConfigured ?? 0), Object.keys(mergedAgentStatus ?? {}).length)` and emit it spread-guarded on `> 0`. The second term is the invariant that makes it impossible for the denominator to fall below the numerator regardless of which chunk carried the migration file.

### [IMPORTANT] OBJ-2

**Where:** `src/core/runner.ts:775`

**Problem:** `agentsConfigured` is a false name for what `total` measures. By the time runner.ts:775 runs, three separate filters have already fired: migration-safety removal (713-717), evaluatePolicy (719-731), and buildAgents' unknown-name drop (runner.ts:173-181, which `console.warn`s and returns []). On the SHIPPED default config -- 15 agents at config.ts:58-73 -- a non-migration diff yields agents.length=13, hasCoverage=true, hasTestgen=false, so total=14, not 15. Add an agentPolicy excluding two agents and it is 12. The value is CORRECT as a denominator (it lives in the same space as agentStatus, which is also written only post-policy, so numerator and denominator agree -- policy-skipping does NOT overcount), but the field name promises the config count. PMB is named as a hard-constraint consumer reading this JSON; it will compare `agentsConfigured` against its own configured agent list and see an unexplained mismatch. Once this ships inside schemaVersion 'ai-review-agent/v1' (set at cli/index.ts:361) renaming it is a consumer break.

**Fix:** Name the field `agentsPlanned` (or `agentsAttempted`) and give it a schema.ts comment stating explicitly: post-migration-safety-filter, post-policy-filter, post-unknown-name-drop; it is the number of agents the run intended to invoke, deliberately NOT config.agents.length, so that it stays in the same space as agentStatus's keys.

### [BLOCKER] OBJ-3

**Where:** `src/core/schema.ts:307 (adjacent to earlyExit) and src/cli/formatter.ts:29,69`

**Problem:** Making the field optional (`?`) means its ABSENCE silently reinstates the exact trap the brief forbids, and nothing in the type system catches it. formatter.ts:29 computes `totalAgents = Object.keys(agentStatus ?? {}).length`; the proposed change 4 uses agentsConfigured 'instead of totalAgents', which in practice means `agentsConfigured ?? totalAgents`. For any result lacking the field -- an archived findings.json from CI, a hand-built fixture, or a chunked run if change 3 is deferred or regresses -- the fallback IS the shrinking denominator, now printed under an INCOMPLETE headline that makes it read as a verified count. A fail-fast run stopping after coverage+security renders `INCOMPLETE - **1 finding** from 2/2 agents that completed`. That is worse than today's silence, because today the reader gets no incompleteness claim at all rather than a false one.

**Fix:** Absence must be fail-safe, not fall back. In formatter.ts, when `result.earlyExit` is set and `agentsPlanned` is undefined, suppress the `N/M agents that completed` clause entirely and render `stopped early at ${earlyExit.stoppedAt} - the remaining agents never ran`. Only render the ratio when the field is actually present. Keep `?` (the timings precedent at schema.ts:330-337 is right: archived results are real inputs), but treat absent as 'unknown', never as 'equal to the agents that started'.

### [IMPORTANT] OBJ-4

**Where:** `src/core/runner.ts:915-937`

**Problem:** `total` can legitimately be 0, and `agentsConfigured: total` as written is the only unguarded field in that return. Every neighbouring entry at runner.ts:918-936 is spread-guarded (`...(x.length > 0 ? {x} : {})`). An empty config.agents, or an agentPolicy that excludes everything, gives total=0 and emits `agentsConfigured: 0`, which a ratio renderer turns into `0/0 agents that completed`.

**Fix:** Emit it unconditionally (a spread guard would create OBJ-3's absence case for a legitimately-zero run) and guard in the RENDERER instead: only build the ratio clause when the value is a number greater than 0, otherwise fall through to OBJ-3's `stopped early at <agent>` wording.

### [MINOR] OBJ-5

**Where:** `src/cli/index.ts:195`

**Problem:** Duplicate agent names overcount `total`. cli/index.ts:186-195 validates each `--agents` entry against AGENT_NAMES but never dedupes, and buildAgents (runner.ts:173-181) flatMaps config.agents one-to-one into instances. `--agents security,security` gives agents.length=2 and total=2, while agentStatus is keyed by AgentName and holds exactly one entry. A fully successful fail-fast run then renders `1/2 agents that completed`, asserting an agent went missing when none did.

**Fix:** Dedupe at the parse site: `config.agents = [...new Set(requested)] as AgentName[]`. One line, and it also removes the duplicate LLM call that exists today.

**Would render:**

```
⚠️ INCOMPLETE — **1 finding** from 2/14 agents that completed | 45231ms
```

---

## src/cli/formatter.ts — formatMarkdown (change 4)

Verdict: `yes-with-changes`

### [BLOCKER] O1-green-check-survives

**Where:** `src/cli/formatter.ts:201-226`

**Problem:** The no-findings path returns early at line 228 and its verdict is gated on `failedAgents.length === 0` (line 202), not on `incomplete`. Folding earlyExit into `incomplete` changes ONLY the headline; the early-return block still falls through the truncation ternary at 218 to `'✅ No issues found.'`. A fail-fast run whose triggering finding was dropped downstream (shouldEarlyExit at runner.ts:239-245 runs on RAW agent findings inside runAgentsSequential; the returned `findings` at runner.ts:880 is the post-synthesize/post-hallucination-filter list) renders a ⚠️ INCOMPLETE headline and a ✅ pass verdict in the same report. That is precisely the state the file's own comment at 210-216 calls unacceptable ('the glyph IS the verdict for a skimming reader'), and the sibling invariant test 'does not render a truncated run as clean on ANY surface' (tests/unit/formatters/markdown.test.ts:288) asserts not.toContain('✅') for the analogous case.

**Fix:** Gate the verdict on `failedAgents.length === 0 && !result.earlyExit`, or add an earlyExit arm to the ternary at 218 that leads with the stop, e.g. `⚠️ STOPPED EARLY — `security` met the threshold; the remaining N agents never ran.` Add a test asserting formatMarkdown(result with earlyExit and 0 findings) does not contain '✅', on BOTH paths.

### [BLOCKER] O2-undefined-denominator

**Where:** `src/cli/formatter.ts:67-69`

**Problem:** `agentsConfigured` is proposed as optional (`agentsConfigured?: number`, change 1) for the same reason `timings` is optional — archived findings.json from CI and hand-built fixtures are real inputs (schema.ts:328-334 states this explicitly). Substituting it directly into the scope template renders the literal string `from 3/undefined agents that completed` for any result that carries earlyExit or failed agents but no agentsConfigured — every result produced before this change, including the replayed CI artifacts this project deliberately validates against.

**Fix:** `const configured = result.agentsConfigured ?? totalAgents`, and when agentsConfigured is absent do NOT print a ratio at all for the earlyExit case (a `3/3` ratio on an old artifact is the exact 'reads as full coverage' trap). Print the stop clause without a denominator: 'stopped after `security`; remaining agents not run'.

### [BLOCKER] O3-chunk-defeats-the-denominator-fix

**Where:** `src/cli/formatter.ts:69`

**Problem:** The denominator fix does not defuse the trap under --chunk. mergeResults unions agentStatus across chunks (chunkRunner.ts, mergeAgentStatus), so a 3-chunk run where chunks 1-2 completed all 15 agents and chunk 3 stopped after 3 produces a merged agentStatus with 15 'ok' keys. With agentsConfigured merged as last-chunk-wins/max (15), the headline renders 'INCOMPLETE — 5 findings from 15/15 agents that completed' — full-coverage wording on an early-exited run, the literal failure mode the brief forbids. If mergeResults sums instead, it renders '15/45', which is nonsense. The agent RATIO is structurally incapable of carrying the earlyExit fact.

**Fix:** Do not express earlyExit through the agent ratio. Give it its own headline clause driven by `result.earlyExit` directly (which mergeResults already carries as last.earlyExit), e.g. `| 3 of 15 agents ran, stopped after \`security\``, and keep the ratio clause for agent FAILURES only. Also specify in change 3 that agentsConfigured is last-chunk-wins, never summed, and say so in a comment at the consumption site here.

### [IMPORTANT] O4-truncation-branch-swallows-earlyexit

**Where:** `src/cli/formatter.ts:67-69`

**Problem:** The `scope` ternary is truncation-first, so when truncation.truncated AND earlyExit are both set the headline renders only 'in 2000/6578 lines reviewed' and the stop disappears from the headline entirely. Both are reachable together on a plain run (the diff is truncated, then fail-fast fires on the reviewed portion), and change 3 makes it the NORMAL case for chunked fail-fast runs by setting truncation when a chunk early-exits. Worse, once truncation is set the banner at lines 77-89 fires and advises 'Use --chunk to review the whole diff' — false advice to a run that already used --chunk.

**Fix:** Make `scope` composable rather than a ternary: build an array of clauses (truncation clause, agent-failure ratio clause, early-exit clause) and join them. And gate the '--chunk' advice in the 77-89 banner on `!result.earlyExit` (or on a chunked flag) so a chunked run is not told to chunk.

### [IMPORTANT] O5-wrong-word-completed

**Where:** `src/cli/formatter.ts:69`

**Problem:** 'agents that completed' is the wrong predicate for agents that never STARTED. Three distinct populations exist: configured/scheduled (runner.ts:775 `total`), started (Object.keys(agentStatus) — runner writes a key only at :434 'ok' or :452 on error), and completed (started minus failed). 'from 3/15 agents that completed' is arithmetically true but reads as '12 agents broke', when in fact the run deliberately chose to stop. Separately, `total` at runner.ts:773-775 is derived from allowedAgents, i.e. AFTER evaluatePolicy (runner.ts:721-731), so the field name `agentsConfigured` misdescribes it — policy-skipped agents are excluded from it. And the policy footer that would explain them (line 304) renders only on the findings path, so a 0-finding fail-fast run with policy skips shows a shrunken denominator with no explanation.

**Fix:** Name the field `agentsScheduled` (or document at the consumption site that it excludes agentPolicy skips), and word the clause by population: '3 of 15 agents ran' for earlyExit, keeping 'completed' only where failures are being counted. Move the policy footer above the early return so the 0-finding path can explain its own denominator.

### [IMPORTANT] O6-two-denominators-one-report

**Where:** `src/cli/formatter.ts:184-187`

**Problem:** Changing only the headline's denominator leaves line 186 rendering `${failedAgents.length}/${totalAgents} agents failed` against the OLD started-count denominator. A run with 15 scheduled, 3 started, 1 failed prints 'INCOMPLETE — ... from 2/15 agents that completed' at the top and '1/3 agents failed' 100 lines below. Two different denominators for the same population in one report is the same class of defect as the shrinking denominator this change exists to fix.

**Fix:** Reword line 186 against an explicit base: `${failedAgents.length} of ${totalAgents} agents that ran failed` (and, when agentsConfigured > totalAgents, add '— N never started').

### [IMPORTANT] O7-footer-placement-and-setext

**Where:** `src/cli/formatter.ts:40, 227, 309`

**Problem:** The footer must render on both exit paths, and the only construct already doing that is `timingLines`, built once at line 40 and pushed at BOTH 227 and 309. A footer appended after the timing block would sit under `*Full per-agent timings are in the \`--format json\` output.*` — a paragraph line — so a footer opening with a bare '---' becomes a setext h2 underline for it (the hazard documented at 316-326, and the reason the sanitizer/context/policy footers at 289-307 are noted as exhibiting it today). The existing regression helper only checks adjacency around '*Timing', so it would not catch this.

**Fix:** Build `const earlyExitLines = result.earlyExit ? ['', `> ${useEmoji ? '⚡ ' : ''}**Fail-fast**: ...`] : []` next to `buildTimingLines` at line 40, and push it BEFORE timingLines at both 227 and 309. Leading '' is mandatory; do not open the block with '---'. Add a rendersRuleNotHeading-style test anchored on the fail-fast line.

### [MINOR] O8-emoji-convention

**Where:** `src/cli/formatter.ts:72, 79, 113, 163, 177, 186`

**Problem:** The file's convention is a glyph plus trailing space inside the conditional — `${useEmoji ? '⚠️ ' : ''}`, `${useEmoji ? '🔍 ' : ''}`, `${useEmoji ? '🔧 ' : ''}` — with no bracketed text substitute (SEVERITY_TEXT's '[HIGH]' style applies to severities only; footers simply drop the glyph). The existing bolted-on footer in index.ts already matches this shape via `options.emoji !== false ? '⚡ ' : ''`.

**Fix:** Use `${useEmoji ? '⚡ ' : ''}` for the footer and `${useEmoji ? '⚠️ ' : ''}` for the headline (do not put ⚡ in the headline — ⚠️ is the established incompleteness glyph there). Moving index.ts's string verbatim keeps --no-emoji output byte-identical.

### [MINOR] O9-incomplete-word-vs-exit-0

**Where:** `src/cli/formatter.ts:56-65`

**Problem:** The comment at 56-64 justifies the `incomplete` gate partly by citing 'cli/index.ts:421 sets exit code 2 — so the process called the run degraded while its own headline called it complete'. Under the hard no-exit-code-change constraint, earlyExit deliberately produces the inverse asymmetry: headline INCOMPLETE, exit 0. Left undocumented, that recorded reasoning will be cited against this change later; and 'INCOMPLETE' overstates a stop the caller explicitly requested.

**Fix:** Prefer a distinct word — 'STOPPED EARLY' — which conveys not-full-coverage without claiming degradation or colliding with exit 2/3 semantics, and extend the comment at 56-64 to state explicitly why earlyExit keeps exit 0 while still refusing a clean headline.

### [MINOR] O10-untested-footer-removal

**Where:** `src/cli/index.ts:403-412`

**Problem:** Change 8 deletes index.ts:404-412, and nothing tests it — grep for 'Fail-fast' across tests/ returns zero hits. If the new footer is mis-gated (e.g. only on the findings path), the deletion silently removes the one signal --fail-fast users have today, on the very path that needs it most. Note also that the footer currently lands AFTER the timing block (`output += '\n\n> ...'`), so moving it before the timing lines changes byte output of existing --out reports.

**Fix:** Land the formatter footer and its two-path tests FIRST, then delete the index.ts block in the same PR; mention the position change in the commit body.

**Would render:**

```
=== A. WHAT THE PROPOSAL AS WRITTEN EMITS — fail-fast, 0 findings after filtering, agentStatus={security:ok,quality:ok,performance:ok}, agentsConfigured=15, no truncation, no timings ===
# AI Code Review Report

⚠️ INCOMPLETE — **0 findings** from 3/15 agents that completed | 100ms

✅ No issues found.

> ⚡ **Fail-fast**: swarm stopped after `security` (severity threshold met). Remaining agents were not run.

(The "✅ No issues found." line is emitted by the early-return block at formatter.ts:217-225, which the proposal does not touch. Headline and verdict contradict each other four lines apart, and this is the exact path the whole fix exists to cover.)

=== B. WHAT THE PROPOSAL AS WRITTEN EMITS — same run, 2 findings survive ===
# AI Code Review Report

⚠️ INCOMPLETE — **2 findings** from 3/15 agents that completed | 100ms

## 🟠 High (2)
[... finding bodies ...]

> ⚡ **Fail-fast**: swarm stopped after `security` (severity threshold met). Remaining agents were not run.

=== C. WHAT IT SHOULD EMIT (recommended), 0-findings case ===
# AI Code Review Report

⚠️ STOPPED EARLY — **0 findings** | 3 of 15 agents ran, stopped after `security` | 100ms

⚠️ Stopped early (--fail-fast): `security` met the --fail-on threshold, so the remaining 12 agents never ran. Not a clean result — re-run without --fail-fast for full coverage.

=== D. WHAT IT SHOULD EMIT (recommended), 2-findings case ===
# AI Code Review Report

⚠️ STOPPED EARLY — **2 findings** | 3 of 15 agents ran, stopped after `security` | 100ms

## 🟠 High (2)
[... finding bodies ...]

⚠️ Stopped early (--fail-fast): `security` met the --fail-on threshold, so the remaining 12 agents never ran. Not a clean result — re-run without --fail-fast for full coverage.

=== E. --no-emoji variant of C's headline ===
STOPPED EARLY — **0 findings** | 3 of 15 agents ran, stopped after `security` | 100ms
```

---

## src/cli/formatters/sarif.ts (change 6) + src/cli/formatters/githubAnnotations.ts (change 7)

Verdict: `yes-with-changes`

### [BLOCKER] O1-sarif-executionSuccessful-is-the-wrong-field

**Where:** `src/cli/formatters/sarif.ts:71`

**Problem:** VERDICT ON THE SARIF QUESTION: unconditional executionSuccessful=false for earlyExit is semantically wrong, and it breaks an invariant this repo currently holds. BOTH SIDES: (a) FOR false — the field's operative meaning HERE is recorded at sarif.ts:61-66 as 'was the analysis complete', chosen to defeat consumers gating on '0 results = pass'; a fail-fast run is by construction incomplete (11 of 15 agents never ran), so on that reading false is consistent. (b) AGAINST false — SARIF defines invocation.executionSuccessful as a property of the TOOL'S EXECUTION (siblings: exitCode, exitSignalName, processStartFailureMessage); the mechanism SARIF provides for 'a condition arose during execution that a consumer should know about' is toolExecutionNotifications, which is exactly why the existing code emits both. A fail-fast stop is the tool exiting normally having done precisely what it was configured to do. (b) wins on an in-repo fact that settles it independently of spec reading: today executionSuccessful=false fires only in two states that ALSO exit nonzero — failed agents (exit 2, index.ts:423-426) and truncation (exit 3, index.ts:434-435). The hard constraint pins fail-fast at exit 0. So change 6 would create the first run in this tool's history that reports exit 0 ('ran to the end of what it was asked to do') while its own SARIF says the execution was not successful. That is the same one-run-two-verdicts split that formatter.ts:56-63 was written to forbid, just rotated 180 degrees. It also has a live cost: a CI gate of the shape 'if executionSuccessful is false, the scan is broken — retry it' will retry a fail-fast run forever, since the re-run reproduces the same early exit.

**Fix:** Keep executionSuccessful computed from failedAgents/truncation only. Express earlyExit as a toolExecutionNotifications entry at level 'warning' with a machine-matchable descriptor ({ id: 'earlyExit' }) plus a run property. Do NOT reach for invocation.exitCode/exitCodeDescription as the alternative: the formatter runs at index.ts:395-402, before process.exitCode is set at 423-436, so it would have to invent the value.

### [IMPORTANT] O2-but-the-zero-results-hole-is-real-and-narrow

**Where:** `src/cli/formatters/sarif.ts:71`

**Problem:** The counter to O1 is that a warning-level notification does not defeat '0 results = pass', which is the entire recorded reason the field was added. That counter is weaker than it looks, and quantifying it gives a better fix than either extreme. shouldEarlyExit only returns true when a finding at or above failOn already exists (runner.ts:239-244), so an early-exit run normally carries the triggering finding into results — SARIF is NOT structurally identical to a clean scan in the ordinary case, and the CLI exits 1 via hasBlocker (index.ts:422-427), not 0. The premise 'a --fail-fast run ... exits 0' is therefore only true on one path: the triggering finding is dropped after the fact by synthesize's hallucination filter (a hallucinated CRITICAL tripping fail-fast is exactly what that filter exists to catch). That path yields 0 findings, 0 failed agents, no truncation, exit 0, 11 agents unrun — genuinely indistinguishable from clean.

**Fix:** If the team wants belt-and-braces on the filter-drop path, scope the flag narrowly: executionSuccessful = failedAgents.length === 0 && !truncated && !(result.earlyExit && result.findings.length === 0). That is the only fail-fast state that both exits 0 and presents as clean, so the flag and the exit code still agree, and the recorded rationale is preserved rather than overwritten. Separately, verify empirically (I could not, offline) whether the target consumer uses executionSuccessful to suppress auto-resolution of alerts absent from a newer analysis. If it does, that changes the answer: under fail-fast, absent results are not evidence of absence, and silently closing every alert from the 11 agents that never ran is a worse harm than the exit-0 contradiction — flip to unconditional false and document the contradiction deliberately.

### [BLOCKER] O3-change-3-detonates-inside-change-6

**Where:** `src/core/chunkRunner.ts:167`

**Problem:** Not strictly my two files, but it lands in them. Change 3 proposes emitting `truncation` from mergeResults when the chunk loop breaks on earlyExit (chunkRunner.ts:90). That value flows straight into sarif.ts:71 and githubAnnotations.ts:74 and into index.ts:434. Consequences: SARIF sets executionSuccessful=false via the TRUNCATION branch regardless of what change 6 decides, and emits a 'Diff truncated: reviewed X/Y lines' notification alongside the new earlyExit notification — two notifications, two causes claimed, one event. Worse, index.ts:434-435 then sets exit 3, which is the exit code the downstream consumer defines as 'partial coverage of a complete run, remedy: re-run with --chunk' — advice that is nonsense for a run that already used --chunk. Change 3 breaks the NO-EXIT-CODE-CHANGE constraint through a side door.

**Fix:** Do not reuse the `truncation` field to describe a chunk-loop early exit. Carry chunk progress on earlyExit itself (e.g. earlyExit: { stoppedAt, chunksRun, chunksTotal }) and let sarif.ts render it in the earlyExit notification and run properties. `truncation` stays what it is — lines dropped inside one run — and the exit-code chain is untouched.

### [IMPORTANT] O4-message-is-untrue-under-chunk

**Where:** `src/core/chunkRunner.ts:90`

**Problem:** Both proposed messages inherit the existing footer's wording ('Remaining agents were not run', index.ts:411). Under --chunk --fail-fast that is true but badly incomplete: the break at chunkRunner.ts:90 means whole chunks — whole FILES — were never seen by ANY agent, and mergeResults carries only `last.earlyExit` (chunkRunner.ts:159). A reviewer told 'remaining agents were not run' will assume the whole diff was at least scanned by the agents that did run. It wasn't.

**Fix:** Branch the message on chunk progress (from O3's chunksRun/chunksTotal). Unchunked: 'stopped after <agent>; the remaining agents did not run'. Chunked: 'stopped after <agent> in chunk 2 of 9; chunks 3-9 were not reviewed by any agent'.

### [IMPORTANT] O5-agentsConfigured-yes-for-sarif-optional-for-annotations

**Where:** `src/cli/formatters/sarif.ts:119`

**Problem:** ANSWER TO 'does either surface need agentsConfigured to say something truthful': SARIF yes, annotations no-but-conditionally. SARIF publishes properties.agentStatus verbatim (sarif.ts:119), and runner.ts:434 writes that map only for agents that actually ran. On a fail-fast run a machine consumer reads a four-key, all-'ok' map and has no way to tell 'four agents configured, all fine' from 'fifteen configured, eleven skipped'. That is the shrinking-denominator trap the parent identified in the markdown headline, in machine-readable form, and unlike the headline nobody is reading prose next to it that could correct the impression. githubAnnotations needs no count to be truthful if the line names the stopping agent and says the rest did not run — but if it prints ANY ratio it must come from agentsConfigured, never Object.keys(agentStatus).length.

**Fix:** Put agentsConfigured in SARIF run properties next to agentStatus, and state the ran/configured ratio in the earlyExit notification text. Both surfaces must tolerate agentsConfigured === undefined (schema.ts:328-333 records why these fields stay optional — archived findings.json and hand-built fixtures are real inputs; markdown.test.ts:296 is such a fixture and pins '1/3' from agentStatus alone). Fall back to the stoppedAt-only wording with no ratio rather than printing a wrong denominator or NaN.

### [MINOR] O6-annotation-line-ordering-and-the-empty-string-contract

**Where:** `src/cli/formatters/githubAnnotations.ts:80`

**Problem:** githubAnnotations tests pin exact line indices (the multi-severity test asserts exactly four lines and checks lines[0..3]) and pin two 'emits nothing' contracts for clean runs. An earlyExit line inserted in the wrong place, or emitted on a result without earlyExit, breaks them.

**Fix:** Append the earlyExit line to the warning block — [...warningLines, ...truncationLines, ...earlyExitLines, ...findingLines] — gated strictly on result.earlyExit, so the two 'emits nothing' tests stay green unchanged.

### [MINOR] O7-warning-lines-bypass-the-escaper

**Where:** `src/cli/formatters/githubAnnotations.ts:71`

**Problem:** escapeAnnotationValue is applied only to finding titles/messages (githubAnnotations.ts:25,42); the failed-agent and truncation warning lines interpolate raw. That is safe today because those values are enum-typed, and earlyExit.stoppedAt is AgentName, so the new line is equally safe as long as it interpolates only stoppedAt and numbers. It stops being safe the moment a ReviewResult arrives from a parsed findings.json rather than from SwarmRunner — there is no such entry point today, which is why this is minor and not more.

**Fix:** Route stoppedAt through escapeAnnotationValue in the new line, matching findingToAnnotation. One call, no downside.

**Would render:**

```
--- github-annotations (fail-fast, stopped after `security`, 4 of 15 agents, 1 critical finding surviving filters) ---
::warning::Review stopped early after agent security (--fail-fast: severity threshold met) — 4/15 agents ran, the rest were not run and their findings are unknown
::error file=src/auth.ts,line=42,title=Hardcoded secret::Use an environment variable

--- github-annotations (same run, triggering finding dropped by the hallucination filter — the exit-0 case; today this surface emits "") ---
::warning::Review stopped early after agent security (--fail-fast: severity threshold met) — 4/15 agents ran, the rest were not run and their findings are unknown

--- github-annotations (chunked: stopped in chunk 2 of 9) ---
::warning::Review stopped early after agent security in chunk 2/9 (--fail-fast: severity threshold met) — chunks 3-9 were not reviewed by any agent

--- sarif invocations[0] + run properties, per my recommended fix (executionSuccessful NOT flipped) ---
"invocations": [
  {
    "executionSuccessful": true,
    "toolExecutionNotifications": [
      {
        "level": "warning",
        "descriptor": { "id": "earlyExit" },
        "message": {
          "text": "Review stopped early after agent \"security\" (--fail-fast: severity threshold met) — 4/15 configured agents ran. Findings from the 11 agents that did not run are unknown; absent results are not evidence of absence."
        }
      }
    ]
  }
],
"properties": {
  "agentStatus": { "coverage": "ok", "security": "ok", "correctness": "ok", "performance": "ok" },
  "agentsConfigured": 15,
  "earlyExit": { "stoppedAt": "security" }
}
```

---
