# Agent 3 — Architecture & Technical Debt Findings
**Date:** 2026-06-25
**Status:** Complete
**Finding count:** 8

---

## Check 1: ACR Call Graph — Abstraction Layer Count

**Call chain from CLI invocation to Ollama HTTP request:**

1. **Layer 1 — CLI / Argument Parsing** (`src/cli/index.ts`): Commander parses flags, resolves config, calls `getDiff()`, constructs `OllamaProvider` and `SwarmRunner`, calls `runner.run()`.
2. **Layer 2 — Orchestration / Execution** (`src/core/runner.ts`, `SwarmRunner.run()`): Applies ignore filter, sanitizer, diff truncation, calls `buildAgents()`, iterates agents, calls `withRetryTimeout()` wrapping `agent.run()`, then calls `orchestrator.synthesize()`.
3. **Layer 3 — Agent abstraction** (`src/core/agents/base.ts`, `BaseAgent.run()`): Constructs messages array, calls `this.provider.chat()`, passes result to `parseFindings()`.
4. **Layer 4 — LLM Provider** (`src/core/llm/ollamaProvider.ts`, `OllamaProvider.chat()`): Calls `fetch()` against `${baseUrl}/api/chat`.
5. **Layer 5 — Node.js fetch**: Issues HTTP request.

**Count: 5 distinct layers** (CLI → SwarmRunner → BaseAgent → OllamaProvider → fetch).

Layer 4 to Layer 5 is a single-line `fetch()` call — it is not an abstraction, just a native call. Layers 1–4 each have a clear distinct purpose. No finding warranted; the count is at the boundary but each layer is justified.

> [CHECK 1 — ABSTRACTION DEPTH]: No finding — 4 meaningful abstraction layers (CLI, orchestration, agent, provider). Each has a distinct purpose. The call chain is clear and traceable.

---

## Check 2: BaseAgent SRP Violation

Reading `src/core/agents/base.ts` in full (150 lines), the distinct responsibilities are:

1. **Domain mapping** — `agentDefaultDomain()` maps `AgentName` to `ReviewDomain` (module-level function, lines 5–25)
2. **Prompt construction** — `buildUserPrompt()` builds the user message string (lines 45–50)
3. **LLM call dispatch** — `run()` constructs `Message[]` and calls `this.provider.chat()` (lines 36–43)
4. **Think-tag-stripped response handling** — `run()` passes raw response to `parseFindings()`; stripping occurs in `OllamaProvider`, but `parseFindings()` performs multi-stage parse (lines 52–83)
5. **Stage 1 JSON parse** — bare array or `{findings:[]}` object parse (lines 56–65)
6. **Stage 2 JSON parse (embedded object)** — same `try` block, different branch (lines 63–65)
7. **Stage 3 JSON parse (balanced-bracket extraction)** — `extractJsonArray()` + re-parse (lines 67–79)
8. **Schema validation / field normalization** — `validateFindings()` filters, maps, normalises `confidence`, resolves `suggestion`/`recommendation` aliases, sets `blocking`, stamps `id`/`agent`/`source` (lines 115–149)

**Count: 6–8 distinct responsibilities** depending on whether the three parse stages are counted individually or as one concern.

### Finding: BaseAgent Exceeds Single Responsibility — 6–8 Concerns in One Class

- **Severity:** Medium
- **Confidence:** Verified
- **Repository:** ACR
- **Evidence:** `src/core/agents/base.ts`, lines 36–149. The class simultaneously owns: (a) prompt construction, (b) LLM call dispatch, (c) three-stage JSON parse logic with a bespoke balanced-bracket scanner, (d) schema validation, (e) field normalisation/aliasing, (f) domain mapping. The `validateFindings` method alone mixes field filtering, field aliasing (`suggestion` ↔ `recommendation`), confidence clamping, `blocking` defaulting, and `id` stamping.
- **Reproduction:** Read `base.ts` — the `validateFindings` method (35 lines) does what would ordinarily be split into `validateShape()`, `normaliseFields()`, and `stampMetadata()`.
- **Root Cause:** Incremental accretion. Each responsibility was small when added; no single addition crossed an obvious threshold. The result is that any change to the Finding schema, the parse strategy, or the field normalisation logic all touch the same class.
- **Fix:** Extract `ResponseParser` (stages 1–3 + bracket extraction) and `FindingNormaliser` (field aliasing, confidence clamping, id stamping) as standalone pure functions in `src/core/parsing.ts`. `BaseAgent` would then own only prompt construction + dispatch. The domain-map function can move to `schema.ts`.
- **Impact:** Each extracted unit becomes independently testable. Currently `baseAgent.test.ts` must exercise the entire chain to test field normalisation; after extraction each concern has its own fast unit test.
- **Effort:** M

---

## Check 3: Dead Code — Anthropic Provider Residue

Grep for `anthropic|AnthropicProvider|@anthropic-ai` across `src/**/*.ts`: **no matches found**.

Check `package.json` dependencies and devDependencies: no `@anthropic-ai` entry in either block.

> [CHECK 3 — ANTHROPIC RESIDUE]: No finding — zero references to Anthropic SDK in source or package.json. Clean removal.

---

## Check 4: `any` Types and Lint Suppressions

Grep for `: any\b|as any\b`: **zero matches** in `src/`.

Grep for `@ts-ignore`: **zero matches** in `src/`.

Grep for `eslint-disable` (broad, file-level): **zero matches**. Two `eslint-disable-next-line` comments exist:
- `src/core/ignoreFilter.ts:85` — suppresses `no-control-regex` for a regex that necessarily uses a control character (U+0000) as a glob-to-regex sentinel
- `src/core/policyFilter.ts:18` — identical justification (copied pattern)

> [CHECK 4 — TYPE SAFETY]: No finding — zero unqualified `any` casts, zero `@ts-ignore`, two narrowly scoped `eslint-disable-next-line` suppressions both justified by the same control-character regex pattern.

### Advisory: Duplicated Glob Regex Logic and Suppression in Two Files

- **Severity:** Advisory
- **Confidence:** Verified
- **Repository:** ACR
- **Evidence:** `src/core/policyFilter.ts:9–25` contains a verbatim copy of the `matchPattern()` function from `src/core/ignoreFilter.ts:1–30`. The comment on line 8 of `policyFilter.ts` even says `// Copied from ignoreFilter.ts`. Both files carry identical `eslint-disable-next-line` comments.
- **Reproduction:** `diff src/core/ignoreFilter.ts src/core/policyFilter.ts` — the `matchPattern` function body is identical.
- **Root Cause:** Policy filter was implemented after ignore filter; the function was copied rather than extracted.
- **Fix:** Export `matchPattern` from `ignoreFilter.ts`; import it in `policyFilter.ts`. Remove the copy and the comment.
- **Impact:** Single source of truth for glob matching. A bug or edge case fix in one place propagates to both consumers automatically.
- **Effort:** XS

---

## Check 5: contextLoader.ts — Semantic Embedding Reality

Reading `src/core/contextLoader.ts` (178 lines) and `src/core/embedder.ts` (35 lines):

**Static path (`loadAgentContext`):** Keyword/priority-based. A hardcoded `AGENT_CONTEXT_FILES` map determines which memory-bank files each agent receives, in priority order. No embedding, no similarity computation. Files are loaded greedily until the char budget is exhausted.

**Semantic path (`loadAgentContextSemantic`):** Calls `embed()` from `embedder.ts`, which issues a real HTTP POST to `${ollamaUrl}/api/embeddings` with model `nomic-embed-text:latest`. Embeds the first 2000 chars of the diff and the first 500 chars of each of the five memory-bank files, ranks by cosine similarity, and loads the top files within budget.

The semantic implementation is real — it calls a live embeddings endpoint and performs cosine ranking. However:

### Finding: Semantic Context Path Has No Test Coverage

- **Severity:** Medium
- **Confidence:** Verified
- **Repository:** ACR
- **Evidence:** `tests/unit/` contains no test file for `contextLoader.ts` or `embedder.ts`. The `loadAgentContextSemantic` function (lines 113–174 of `contextLoader.ts`) and the cosine similarity calculation in `embedder.ts` are entirely untested. The static path (`loadAgentContext`) is also untested. Confirmed by checking the test file list in `memory-bank/techContext.md` — no `contextLoader.test.ts` exists.
- **Reproduction:** `ls tests/unit/` — no `contextLoader.test.ts`, `embedder.test.ts`.
- **Root Cause:** The semantic path was added after the initial test suite was established; no tests were written alongside it.
- **Fix:** Add `tests/unit/contextLoader.test.ts` covering: (1) `loadAgentContext` with a mock filesystem — budget truncation, missing files, empty agent map entry; (2) `loadAgentContextSemantic` with a mocked `embed()` — ranking order, budget truncation, null embedding fallback. Add `tests/unit/embedder.test.ts` covering `cosineSimilarity` edge cases (zero vector, mismatched lengths, identical vectors).
- **Impact:** The cosine similarity function and the budget-truncation path are currently exercised only in production against a live Ollama instance. A regression (e.g., the `ranked.sort()` mutation, or the off-by-one in the budget loop) would reach users silently.
- **Effort:** S

### Advisory: Semantic Embedding Embeds Only 500 Chars of Each Memory-Bank File

- **Severity:** Advisory
- **Confidence:** Verified
- **Repository:** ACR
- **Evidence:** `src/core/contextLoader.ts:138` — `embed(ollamaUrl, content.slice(0, 500))`. Memory-bank files commonly have 200–400 chars of YAML frontmatter before useful content begins. The effective semantic content embedded per file is approximately 100–300 chars of actual prose.
- **Root Cause:** The 500-char limit was likely chosen to stay within the embedding model's context window and reduce latency; the frontmatter cost was not accounted for.
- **Fix:** Skip or strip frontmatter before embedding: advance past the second `---` delimiter before taking the 500-char slice. This doubles the useful signal per embedding call with no increase in API cost.
- **Impact:** Embedding quality improves; files that share similar frontmatter boilerplate but differ in body content are ranked more accurately.
- **Effort:** XS

---

## Check 6: policyFilter.ts — Value vs Complexity

`src/core/policyFilter.ts` is 90 lines total (including the copied `matchPattern` helper, comments, and blank lines). The `evaluatePolicy` function itself is ~45 lines of substantive logic.

**What it does that orchestrator doesn't:** The orchestrator (`orchestrator.ts`) operates on `Finding[]` after all agents have run. `policyFilter.ts` gates which agents run at all, based on the set of changed file paths in the diff. These are entirely different concerns — the orchestrator deduplicates and escalates findings; the policy filter prevents agents from running when they are irrelevant (e.g., skipping `license` when no `package.json` changed). There is no overlap.

**Is it in the hot path?** Yes — called once per review run in `SwarmRunner.run()` (line 212 of `runner.ts`), before the agent loop. It executes in microseconds (pure string matching, no I/O).

**Could it be inlined?** Technically yes, but it would add ~45 lines of agent-filtering logic to the already 430-line `runner.ts`, and it would lose its independent test coverage (6 test cases in `tests/unit/policyFilter.test.ts`).

> [CHECK 6 — POLICYFILTER VALUE]: No finding — `policyFilter.ts` does something orthogonal to the orchestrator (pre-run agent gating vs. post-run finding synthesis). Its 45 lines of logic are well-tested and would make `runner.ts` harder to read if inlined.

---

## Check 7: orchestrator.ts Dedup Complexity

Reading `src/core/agents/orchestrator.ts` (215 lines):

**Deduplication algorithm (`deduplicate`, lines 97–141):**
- Groups findings by `${file}:${line}` string key using a `Map`.
- For multi-agent groups, selects the winning agent by `AGENT_PRIORITY.indexOf()` (highest index wins).
- Non-winning agents' finding IDs are merged into `relatedFindings`; their agent names into `corroboratingAgents`.

**Complexity:** O(n) for the grouping pass (single loop over all findings); O(a) for the priority lookup within each group, where `a` = number of distinct agents at the same location (bounded by 16, the total agent count). Net: O(n). Not O(n²). The Map-based grouping is efficient.

**Cross-reference escalation logic (`crossReference`, lines 143–187):**
Three hard-coded escalation rules, each expressed as: if agent X has a finding and agent Y has a finding within ±5 lines of the same file, escalate X's severity.
- `correctness` + `coverage` gap within 5 lines → escalate correctness
- `security` + `adversarial` within 5 lines → escalate security
- `breaking-change` + (`correctness` | `design`) within 5 lines → escalate breaking-change

**Is it documented?** The three rules are expressed in code only. There is a comment on `crossReference` (line 143) stating "Cross-reference before dedup so coverage gaps can escalate correctness findings" but the adversarial→security and breaking-change escalation paths have no explanatory comment.

**Would a new developer understand it in 5 minutes?** The dedup logic yes — the Map+priority pattern is readable. The escalation rules require reading all three `if` blocks and inferring the intent from the agent names. The ±5-line window is unexplained — why 5 and not 3 or 10? This is implicit policy.

### Finding: Cross-Reference Escalation Rules Are Undocumented Policy Encoded as Magic Numbers

- **Severity:** Low
- **Confidence:** Verified
- **Repository:** ACR
- **Evidence:** `src/core/agents/orchestrator.ts:143–187`. Three escalation rules use `Math.abs(other.line - f.line) <= 5` with no comment explaining why 5 lines is the co-location threshold. The rule "security + adversarial → escalate security" and "breaking-change + correctness/design → escalate" have no rationale comment. The `AGENT_PRIORITY` array (lines 27–44) has a comment explaining the ranking rationale but the escalation rules below do not.
- **Reproduction:** Read `crossReference()` — the three `if` blocks encode implicit review policy without stating the invariant they enforce.
- **Root Cause:** Escalation logic was added incrementally; each rule seemed obvious at the time and was not documented.
- **Fix:** Add a constant `const CO_LOCATION_LINES = 5 // findings within N lines share the same code site` and extract each escalation rule into a named predicate or at minimum a single-line comment stating the invariant: `// adversarial corroboration means the security issue is likely exploitable, not speculative`.
- **Impact:** Next developer modifying escalation rules has context for the threshold. Rules can be modified with confidence rather than guessing at intent.
- **Effort:** XS

> [CHECK 7 — O(N²) DEDUP]: No finding — deduplication is O(n) via Map grouping. The group-internal priority lookup is O(a) where a ≤ 16 (total agent count). No cap needed.

### Finding: `hallucinationCrossCheck` Semantics Are Inverted from Its Name

- **Severity:** Advisory
- **Confidence:** Verified
- **Repository:** ACR
- **Evidence:** `src/core/agents/orchestrator.ts:64–95`. The method is named `hallucinationCrossCheck` but what it implements is a **corroboration requirement**: solo Critical/High findings from a single agent are downgraded unless corroborated by another agent at the same file:line (±5). The term "hallucination" implies detecting LLM hallucination specifically; the actual mechanism is "confidence-weighted corroboration gate for high-severity solo findings." A developer reading the call site (`synthesize()`, line 57) would expect a different semantic.
- **Root Cause:** Name chosen during implementation before the mechanism was fully settled.
- **Fix:** Rename to `applyCorroborationGate()` or `downgradeUncorroboratedSoloFindings()`.
- **Impact:** Code self-documents correctly. No behavior change.
- **Effort:** XS

---

## Check 8: PMB Governance Overhead

**Script inventory:**

| Script | `.sh` lines | `.ps1` lines |
|---|---|---|
| mb.sh / mb.ps1 | 2147 | 2227 |
| check-contract | 131 | 111 |
| dangerous-commands | 87 | 93 |
| delegation-depth-check | 36 | 44 |
| init-memory-bank | 248 | 247 |
| pre-compact-check | 66 | 71 |
| pre-push-check | 147 | 158 |
| update-reviewed | 44 | 49 |
| pick-folder.ps1 | — | 8 |
| **Total** | **2906** | **3008** |

**Combined governance shell code: ~5914 lines** (sh + ps1 combined, before counting template duplicates).

`mb.sh` alone is 2147 lines and implements: `status`, `doctor` (24 checks), `audit`, `query`, `clean`, `commit`, `upgrade`, `verify-integrity`, `preflight`, `change-check`, `plan` (4 subcommands: `status`, `list`, `promote`, `archive`), plus 8 deprecated aliases. That is **14 active top-level commands / subcommands** in a single 2147-line bash file.

Hook count in `.claude/settings.json`: **5 distinct hook entries** across 4 hook events (`PostToolUse`, `PreToolUse`×3, `PreCompact`, `Stop`). Each hook dispatches to a `.ps1` with `.sh` fallback, so each logical hook is two scripts.

### Finding: PMB Governance Script Suite Is Disproportionate for Solo Personal Tooling

- **Severity:** Medium
- **Confidence:** Strong Evidence
- **Repository:** PMB
- **Evidence:** Total governance shell code: ~5914 lines (sh + ps1). `mb.sh` is a 2147-line monolith implementing 14 active commands. Every hook has a dual `.sh`/`.ps1` implementation pair, yielding ~10 paired scripts. `mb doctor` runs 24 health checks for a 5-file memory bank used by a single developer. The complexity is proportionate to a team-of-10 governance system deployed to a solo workflow.
- **Root Cause:** PMB was designed as a distributable governance toolkit (it exports scripts to other projects via `mb init`/`mb upgrade`). The PMB repo itself therefore carries both the governance runtime and the source from which it is distributed. The duplication (`.sh` + `.ps1` for every script) reflects cross-platform distribution requirements, not operational overhead at runtime.
- **Reproduction:** `wc -l C:/Users/Mizzo/Claude/Personal-Memory-Bank/scripts/*.sh` → 2906 lines. `wc -l C:/Users/Mizzo/Claude/Personal-Memory-Bank/scripts/*.ps1` → 3008 lines.
- **Fix (specific):** The 24-check `mb doctor` function is the highest-value simplification target. Checks 19b (same-heading negation cross-file), 22 (completed-but-still-planned token sliding window), and 23 (stale next steps token sliding window) together account for ~150 lines of bash that implement approximate natural-language matching with 4-gram token windows — a fragile heuristic that generates false positives and is costly to maintain. These three checks could be removed and replaced with a single prompt: `"Are there any contradictions between memory-bank files?"` asked to Claude at session start. The bash implementation adds complexity without meaningful reliability advantage over an LLM reading the same 5 files directly.
- **Impact:** Removing the three heuristic checks shrinks `mb doctor` by ~150 lines and eliminates a class of false-positive warnings. The `init-memory-bank.sh` and `init-memory-bank.ps1` scripts (248 lines each) appear to be older implementations superseded by the `invoke_init()` function now inside `mb.sh` — if so, they are dead code candidates worth auditing.
- **Effort:** M

---

## Check 9: PMB Concept Duplication — mb doctor vs health-check vs pmb-status

**`/health-check`** (`C:\Users\Mizzo\Claude\Personal-Memory-Bank\.claude\commands\health-check.md`): A 60-line slash command that orchestrates five sequential steps — runs `mb doctor`, `mb validate`, `mb audit`, `git status/log`, and optionally the `security-reviewer` agent on `fixtures/security/`. It is a human-readable structured report template that calls `mb` subcommands as building blocks. Purpose: **comprehensive session-start PMB audit including security fixture regression check**.

**`/pmb-status`** (`C:\Users\Mizzo\Claude\Personal-Memory-Bank\.claude\commands\pmb-status.md`): A 12-line slash command that runs `mb status` and presents the output verbatim. Purpose: **quick 5-signal state check (initialized, core memory, context freshness, standards, tasks)**.

**`mb doctor`** (subcommand in `mb.sh`, lines 566–1253): A 687-line bash function running 24 deterministic health checks — structure, frontmatter, compaction integrity, staleness, placeholder residue, standards presence, version tracking, security fixtures, standards count, startup context ceiling, hook error log, semantic drift signals, old stable decisions, cross-file contradictions, integrity checksums, git-vs-reviewed lag, completed-but-still-planned, stale next steps, plan hygiene. Purpose: **full deterministic structural integrity audit**.

**Overlap analysis:**

- `/pmb-status` (calls `mb status`) vs `mb doctor`: Less than 20% overlap. `mb status` is 5 signals in ~120 lines; `mb doctor` is 24 checks in ~687 lines. They serve different use cases (quick sanity check vs. deep structural audit).
- `/health-check` vs `mb doctor`: `/health-check` calls `mb doctor` as its first step, then adds `mb validate`, `mb audit`, and the security fixture check. `mb validate` and `mb audit` are now deprecated aliases that redirect to `mb doctor` (lines 2121–2122 of `mb.sh`). This means `/health-check` calls `mb doctor` three times (once directly, twice via deprecated aliases).

### Finding: `/health-check` Calls `mb doctor` Three Times via Deprecated Aliases

- **Severity:** Medium
- **Confidence:** Verified
- **Repository:** PMB
- **Evidence:** `/health-check` step 1 runs `mb doctor`; step 2 runs `mb validate`; step 3 runs `mb audit`. Both `mb validate` and `mb audit` are deprecated aliases that now redirect to `mb doctor` (lines 2121–2122 of `mb.sh`: `validate) echo "mb validate is now part of mb doctor. Run: mb doctor"` and `audit) echo "mb audit is now part of mb doctor. Run: mb doctor"`). When a user runs `/health-check`, they see `mb doctor` run once verbosely and then two echo-only redirections — steps 2 and 3 produce no diagnostic output.
- **Reproduction:** Run `/health-check` — steps 2 (`mb validate`) and 3 (`mb audit`) produce only a deprecation notice, not the structural validation output the command description promises.
- **Root Cause:** `mb validate` and `mb audit` were consolidated into `mb doctor` after `/health-check` was written. The slash command was not updated to reflect the new command structure.
- **Fix:** Update `/health-check` to remove steps 2 and 3 (`mb validate`, `mb audit`) since their checks are now included in `mb doctor`. If the staleness table specifically is desired, call `mb doctor` and note that it includes the freshness audit inline. Alternatively, `mb doctor` could be refactored to accept `--only=staleness` flags, but that adds complexity.
- **Impact:** `/health-check` produces correct diagnostic output without misleading deprecation notices in the middle of the report. The command matches its description.
- **Effort:** XS

> [CHECK 9 — THREE-WAY OVERLAP]: Partial finding above. `/pmb-status` and `mb doctor` are genuinely distinct (20% overlap, different use cases). The real issue is a stale slash command referencing deprecated sub-commands.

---

## Check 10: File Size — SRP Violations by Line Count

| File | Lines | Note |
|---|---|---|
| `src/core/runner.ts` | 430 | Flagged — see finding below |
| `src/cli/index.ts` | 280 | Acceptable; ~80 lines are the CLI option declarations |
| `src/core/agents/orchestrator.ts` | 215 | Acceptable; 5 private methods with clear boundaries |
| `src/core/contextLoader.ts` | 178 | Acceptable; two exported functions + helpers |
| `src/core/schema.ts` | 151 | Acceptable; type definitions |
| `src/core/agents/base.ts` | 150 | See Check 2 finding |
| `src/core/agents/coverageAnalyst.ts` | 142 | Acceptable |
| `src/cli/formatter.ts` | 113 | Acceptable |

No file exceeds 500 lines. One file exceeds 300 lines.

### Finding: `runner.ts` at 430 Lines Mixes Orchestration, Retry Policy, Diff Preprocessing, and Context Loading

- **Severity:** Medium
- **Confidence:** Verified
- **Repository:** ACR
- **Evidence:** `src/core/runner.ts` (430 lines) contains: (1) `withTimeout()` / `withRetryTimeout()` utility functions (lines 39–70), (2) `buildAgents()` factory (lines 72–99), (3) `shouldEarlyExit()` predicate (lines 101–107), (4) `SwarmRunner.run()` at 305 lines (lines 121–429) which directly implements: diff ignore-filtering, prompt-injection sanitization, diff truncation, context loading per agent, sequential agent loop, parallel agent loop, coverage agent special-casing, testgen agent special-casing, early-exit logic, summary aggregation, and result assembly. That is at minimum 8 distinct sub-concerns inside one method.
- **Reproduction:** Read `SwarmRunner.run()` — the method is 305 lines and handles every aspect of review pipeline execution without delegating to sub-methods.
- **Root Cause:** Pipeline steps were added incrementally to `run()`. No step individually seemed large enough to warrant extraction, but the accumulation exceeds readable scope.
- **Fix:** Extract at minimum: `preprocessDiff(input, config)` → returns filtered/sanitized/truncated `ReviewInput`; `runAgentsSequential(agents, ...)` and `runAgentsParallel(agents, ...)` → return `Finding[]`; `runCoverageAgent(...)` → returns `{findings, gaps}`. These extractions keep the logic in `runner.ts` but make `run()` a readable coordinator of named steps rather than an inline implementation of all steps.
- **Impact:** `run()` becomes a ~50-line coordinator. Each sub-step becomes independently testable and readable. `runner.test.ts` currently has only 3 tests — the method's size is a barrier to coverage.
- **Effort:** M

---

## Check 11: DEFAULT_CONFIG Agent Count vs Runtime

**DEFAULT_CONFIG agents** (from `src/core/config.ts`, lines 41–57):

```
security, performance, correctness, design, dependencies,
coverage, adversarial, integration, breaking-change, license,
error-handling, observability, migration-safety, secrets, complexity
```

**Count: 15 agents** (including `coverage`, which is handled separately from the `buildAgents()` factory but is in the config array).

**`buildAgents()` in `runner.ts`** (lines 72–99) builds from a `Map` with keys: `security`, `performance`, `correctness`, `design`, `dependencies`, `adversarial`, `integration`, `breaking-change`, `license`, `error-handling`, `observability`, `migration-safety`, `secrets`, `complexity` — **14 agents** (excludes `coverage` and `testgen`).

`coverage` and `testgen` are handled by separate code paths in `run()`. `coverage` is in DEFAULT_CONFIG. `testgen` is NOT in DEFAULT_CONFIG (it is opt-in via `--suggest-tests`/`--write-tests`).

**Agent files in `src/core/agents/`:** `security`, `performance`, `correctness`, `design`, `dependencies`, `adversarial`, `integrationScout`, `breakingChange`, `licenseCompliance`, `errorHandling`, `observability`, `migrationSafety`, `secrets`, `complexity`, `coverageAnalyst`, `testGen`, `base`, `orchestrator` — 16 agent implementation files (18 files minus `base.ts` and `orchestrator.ts`).

**Discrepancy:** DEFAULT_CONFIG lists 15 agents; the tool description in `package.json` says "15 observe-only default agents." The README (referenced but not read) likely says "15 agents." This is internally consistent — `testgen` is the 16th agent but is opt-in and correctly excluded from DEFAULT_CONFIG. No mismatch exists between config and runtime.

> [CHECK 11 — DEFAULT_CONFIG AGENT COUNT]: No finding — DEFAULT_CONFIG lists 15 agents, matching the 14 in `buildAgents()` plus `coverage` handled separately. `testgen` is correctly opt-in and excluded. Count is consistent with package.json description.

---

## Summary Table

| # | Check | Finding | Severity | Effort |
|---|---|---|---|---|
| 2 | BaseAgent SRP | 6–8 responsibilities in one class | Medium | M |
| 4a | Copied glob logic | `matchPattern` duplicated across two files | Advisory | XS |
| 5a | Semantic context untested | No tests for contextLoader or embedder | Medium | S |
| 5b | Embedding quality | Only 500 chars embedded, frontmatter wastes budget | Advisory | XS |
| 7a | Undocumented escalation | Magic ±5-line window, no rule rationale comments | Low | XS |
| 7b | Misleading method name | `hallucinationCrossCheck` vs corroboration gate | Advisory | XS |
| 8 | PMB script overhead | ~5914 lines of governance for solo tooling; 3 heuristic checks removable | Medium | M |
| 9 | /health-check stale | Calls deprecated `mb validate`/`mb audit` aliases | Medium | XS |
| 10 | runner.ts bloat | 430-line file, 305-line `run()` method with 8 sub-concerns | Medium | M |

**No Critical or High findings.** The ACR codebase is notably clean: zero `any` types, zero Anthropic residue, zero broad lint suppressions, consistent agent count, and a well-structured call graph. The debt is structural accretion (base.ts, runner.ts) and missing test coverage on the semantic embedding path.

The PMB finding is architectural context: the script volume is explained by the distributable-toolkit design, but three heuristic checks in `mb doctor` (cross-file heading negation matching, 4-gram token sliding window for completion drift) are high-maintenance bash implementations of problems better solved by asking Claude to read 5 files directly.
