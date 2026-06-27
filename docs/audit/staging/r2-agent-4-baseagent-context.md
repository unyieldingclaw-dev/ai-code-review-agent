# Agent 4 — BaseAgent Architecture & contextLoader Semantic Path
**Date:** 2026-06-26
**Status:** Complete
**Finding count:** 8

---

## Check 1: SRP Audit — BaseAgent Responsibility Count

Distinct concerns identified in `src/core/agents/base.ts`:

**In `run()`:**
1. LLM/HTTP call dispatch (`provider.chat`)
2. Message array construction (system + user messages)

**In `buildUserPrompt()`:**
3. User prompt construction (context concatenation + diff wrapping)

**In `parseFindings()`:**
4. Code-fence stripping (`raw.replace(...)`)
5. Stage-1 JSON parse: bare array path
6. Stage-1 JSON parse: wrapped-object path (`{findings:[]}`)
7. Stage-2 balanced-bracket extraction (`extractJsonArray`)
8. Stage-2 JSON re-parse of extracted substring
9. Error logging on total parse failure

**In `validateFindings()`:**
10. Structural field validation / filter (7-field type check)
11. Field aliasing: `detail → evidence` (via `f.evidence ?? f.detail`)
12. Field aliasing: `suggestion ↔ recommendation` (bidirectional)
13. Confidence clamping (`Math.max(0, Math.min(100, ...))`)
14. Confidence defaulting (string/null/undefined → 70)
15. ID stamping (`${this.name}-${i}`)
16. Domain defaulting (`agentDefaultDomain`)
17. `blocking` defaulting (`severity === 'critical'`)
18. `source` defaulting (`'llm'`)
19. `lineEnd` clamping (`Math.max(f.line, f.lineEnd)`)

**Total: 19 distinct concerns in one 150-line class.**

---

### Finding: BaseAgent violates SRP with 19 distinct concerns

- **Tag:** [NEW]
- **Severity:** High
- **Confidence:** Verified
- **Repository:** ACR
- **Evidence:** `src/core/agents/base.ts:52–149` — all 19 concerns enumerated above are present in a single 150-line class
- **Reproduction:** Read `base.ts` in full. Count: 2 in `run()`, 1 in `buildUserPrompt()`, 9 in `parseFindings()` + `extractJsonArray()`, 10 in `validateFindings()`.
- **Root Cause:** The class was grown incrementally. Each new requirement (aliasing, clamping, defaulting, multi-stage parse) was added to `validateFindings()` or `parseFindings()` rather than extracted into collaborator classes. Round 1 deferred this.
- **Fix:** Extract three collaborators: (1) `FindingParser` — owns all parse stages + code-fence stripping; (2) `FindingNormalizer` — owns all aliasing, defaulting, clamping, ID stamping; (3) `FindingValidator` — owns the structural type-check filter. `BaseAgent` delegates to all three in sequence. Each collaborator is independently testable.
- **Impact:** `validateFindings()` currently cannot be tested in isolation (it's `private`). Extraction unlocks direct unit tests for the normalizer and parser without needing a full LLM provider mock. Reduces per-function cognitive load from 10 to ≤3 concerns.
- **Effort:** M

---

## Check 2: 3-Stage JSON Parse Interaction

**Q1: If stage-1 fails but stage-2 succeeds, are stage-2 findings passed through `validateFindings()`?**

Stage-2 here refers to balanced-bracket extraction (lines 70–79). Yes: `return this.validateFindings(parsed)` is called on line 75. Findings are validated.

**Q2: Is there a guarantee that if stage-1 (within try) returns results, stage-2 (extraction) is NOT attempted?**

Yes — any return inside the try block exits `parseFindings()` entirely. The extraction block at line 70 is only reached when the try block throws a JSON.parse exception. No double-counting is possible on the happy path.

**Q3: What if stage-1 parsed a non-empty array but validateFindings returned 0 valid findings?**

The condition on line 60 is:
```typescript
if (valid.length > 0 || parsed.length === 0) return valid
```
When `parsed.length > 0` AND `valid.length === 0` (all items failed validation), this condition is **false**. Execution falls through to check `parsed.findings`. If `parsed` is a plain array (not an object with `.findings`), both checks fail and the try block exits normally — **the catch is not triggered**. Execution falls through to the extraction stage. This means the balanced-bracket extractor re-processes the same already-successfully-parsed JSON string, looking for a `[…]` in text that is valid JSON. It will find the same array, re-parse it, and `validateFindings()` will drop all items again, returning `[]`. No data corruption, but it's wasted work and the error log at line 81 is **never reached** in this scenario — the caller gets a silent empty array with no diagnostic output.

---

### Finding: Silent zero-finding return when all items fail stage-1 validation

- **Tag:** [NEW]
- **Severity:** Medium
- **Confidence:** Verified
- **Repository:** ACR
- **Evidence:** `src/core/agents/base.ts:58–68` — the guard `valid.length > 0 || parsed.length === 0` allows fall-through without logging when a non-empty parsed array produces 0 valid findings; the error log at line 81 is unreachable in this case
- **Reproduction:**
  1. Mock `provider.chat` to return `[{"severity":"critical","file":"x.ts","line":1,"title":"T","detail":"D","suggestion":"S"}]` — note: `basis` field is missing
  2. Call `agent.run(input)`
  3. Observe: returns `[]`, no `console.error` output, no indication any findings were dropped
- **Root Cause:** The fall-through condition was designed to distinguish "LLM returned empty array (OK)" from "parse failed (need extraction fallback)". It does not handle the third case: "parse succeeded but validation rejected everything."
- **Fix:** After line 60, add an explicit log when `parsed.length > 0 && valid.length === 0`:
  ```typescript
  if (valid.length > 0 || parsed.length === 0) return valid
  if (parsed.length > 0) {
    console.error(`[${this.name}] ${parsed.length} item(s) parsed but 0 passed validation. First item: ${JSON.stringify(parsed[0]).slice(0, 200)}`)
  }
  ```
  Return `[]` after this log rather than falling through to the extraction stage (which will always produce the same result for valid JSON).
- **Impact:** Eliminates a silent failure mode. Engineers can now distinguish "LLM returned empty array" from "LLM returned findings with missing required fields." Critical for diagnosing why an agent returns fewer findings than expected.
- **Effort:** XS

---

## Check 3: validateFindings Silent Drops

**Required fields (all must pass type check):**
1. `severity` — `string`
2. `basis` — `string`
3. `file` — `string`
4. `line` — `number`
5. `title` — `string`
6. `detail` — `string`
7. `suggestion` — `string` OR `recommendation` — `string` (at least one)

**Extra unknown field `foo: "bar"`:** The filter passes if the 7 required checks succeed. The `.map()` uses `...f` spread, so `foo: "bar"` is included in the output Finding. Extra fields are preserved.

**Logging on drop:** None. A finding dropped by the filter produces no log entry. The only log in the entire parse pipeline is the "parse failure" error at line 81, which is only reached when all three stages fail to produce an array.

---

### Finding: validateFindings drops items silently with no diagnostic output

- **Tag:** [NEW]
- **Severity:** Medium
- **Confidence:** Verified
- **Repository:** ACR
- **Evidence:** `src/core/agents/base.ts:115–148` — `.filter()` at line 117 drops invalid items with no `console.warn`/`console.error` call; no count is logged
- **Reproduction:**
  1. Mock LLM to return 5 findings, 3 of which are missing the `basis` field
  2. Call agent.run()
  3. Observe: 2 findings returned, no output indicating 3 were dropped
- **Root Cause:** The filter was written for correctness, not debuggability. Logging was not added alongside it.
- **Fix:** After the `.filter()`, compare input and output lengths. If `items.length > valid.length`:
  ```typescript
  console.warn(`[${this.name}] validateFindings: ${items.length - valid.length} of ${items.length} findings dropped (missing required fields)`)
  ```
  For debug-level verbosity, log the first dropped item's missing fields.
- **Impact:** Makes it possible to diagnose prompt regressions (LLM stops emitting `basis` field) without adding manual tracing. Currently impossible to distinguish "agent found nothing" from "agent found things but the schema broke."
- **Effort:** XS

---

## Check 4: Field Aliasing Priority Conflicts

**Scenario: finding has BOTH `basis: "VERIFIED"` AND `evidence: "src/foo.ts:42"`**

In the `.filter()`, `basis` is checked (`typeof f.basis === 'string'`), so the finding passes.

In the `.map()`:
```typescript
evidence: f.evidence ?? f.detail ?? '',
```
`f.evidence` is `"src/foo.ts:42"` (truthy), so `??` short-circuits — `f.evidence` wins. The `basis` field is also present in the output via `...f` spread. So the final Finding object has:
- `evidence: "src/foo.ts:42"` (the explicit evidence value)
- `basis: "VERIFIED"` (carried as extra field via spread)

The `basis` field on the output is not a documented schema field — it is a legacy alias that the LLM sends and the filter validates against, but the schema type `Finding` uses `evidence`. The spread means any consumer reading `finding.basis` gets the raw LLM value, but `finding.evidence` gets the properly aliased value.

**Is this documented?** A single comment on line 127 says `// Accept either suggestion (legacy) or recommendation (new) from LLM output` — only for the suggestion/recommendation pair. The `basis → evidence` aliasing is entirely undocumented.

---

### Finding: basis→evidence aliasing is undocumented and produces duplicate fields

- **Tag:** [NEW]
- **Severity:** Low
- **Confidence:** Verified
- **Repository:** ACR
- **Evidence:** `src/core/agents/base.ts:127–148` — the filter validates `f.basis` (line 121) but the map produces `evidence` via `f.evidence ?? f.detail ?? ''` with no comment explaining the alias chain; `...f` spread then propagates the raw `basis` field alongside the normalized `evidence` field
- **Reproduction:** Send a finding with `{ basis: "src/x.ts:10", evidence: "src/y.ts:20", ... }`. Inspect output: `evidence = "src/y.ts:20"`, but `basis` is also present on the object as a side-effect of `...f`.
- **Root Cause:** The required field for LLM output was renamed from `basis` to `evidence` at some point, and backward compatibility was added via aliasing. The transition was never documented or completed: the filter still validates `basis`, not `evidence`, meaning a finding with `evidence` but without `basis` is **rejected** even though `evidence` is the current canonical field name.
- **Fix:** (1) Document the alias in a comment block above `validateFindings`. (2) Update the filter to accept `basis` OR `evidence`: `(typeof f.basis === 'string' || typeof f.evidence === 'string')`. (3) Normalize to `evidence` in the map: `evidence: f.evidence ?? f.basis ?? f.detail ?? ''`. (4) Remove `basis` from the required filter check once all agent prompts emit `evidence`.
- **Impact:** A finding that includes `evidence` but not `basis` (the documented schema field name) is currently silently dropped. This is a silent data loss bug caused by incomplete alias migration.
- **Effort:** S

---

## Check 5: Confidence Clamping Edge Cases

Tested inputs:
- `confidence: -1` → `rawConf = -1`, `Math.max(0, Math.min(100, -1))` = `0`. **Correct.**
- `confidence: 200` → `rawConf = 200`, `Math.max(0, Math.min(100, 200))` = `100`. **Correct.**
- `confidence: "high"` → `typeof "high" === 'number'` is false → `rawConf = 70`. **Safe.**
- `confidence: null` → `typeof null === 'object'` not number → `rawConf = 70`. **Safe.**

> CHECK 5: No finding — all four edge-case confidence inputs are handled correctly. Clamping logic is sound.

---

## Check 6: contextLoader Semantic Embedding — Is It Real?

`embed()` in `src/core/embedder.ts` makes a real HTTP POST to `${ollamaUrl}/api/embeddings` with model `nomic-embed-text:latest` (line 9). The call has a 5-second AbortSignal timeout (line 13).

**When `nomic-embed-text` is not loaded in Ollama:** Ollama returns HTTP 404 or 500. `res.ok` is false → `return null`. In `loadAgentContextSemantic` (contextLoader.ts:125): `if (!diffEmbedding) return empty()`. The `empty()` ContextResult has `content: ''`. Back in `runner.ts:407`: `return ctx.content ? { ...input, context: ctx.content } : input` — returns plain `input` with no context injected.

**No warning is emitted.** The user ran `--context-mode semantic` and received zero context — identical to running without `--context` at all — with no indication this occurred. It does not fall back to static selection (`loadAgentContext`).

---

### Finding: --context-mode semantic silently degrades to no-context when Ollama embedding fails

- **Tag:** [NEW]
- **Severity:** High
- **Confidence:** Verified
- **Repository:** ACR
- **Evidence:**
  - `src/core/embedder.ts:14–20` — catch block and `!res.ok` both return `null` with no log
  - `src/core/contextLoader.ts:125–127` — `if (!diffEmbedding) return empty()` with no log
  - `src/core/runner.ts:394–407` — no fallback to static `loadAgentContext`; empty content → no context injected
- **Reproduction:**
  1. Stop Ollama or unload `nomic-embed-text`
  2. Run `ai-review-agent --context memory-bank --context-mode semantic`
  3. Observe: review completes silently with no context injected; no warning in stderr
- **Root Cause:** `embed()` was designed to return `null` on any failure so callers can gate on it. `loadAgentContextSemantic` gates correctly but chose `return empty()` (no context) over `fallback to static`. No log was added. Runner does not inspect `filesLoaded` to detect the empty-result failure mode.
- **Fix:** Two independent changes:
  1. In `loadAgentContextSemantic` when `!diffEmbedding`: emit `console.warn('[contextLoader] nomic-embed-text embedding failed — falling back to static context selection')` and call `loadAgentContext(projectPath, agentName, budgetChars)` instead of `return empty()`. This requires adding `agentName` as a parameter.
  2. In `embed()`, log the HTTP status on non-ok responses: `console.warn(\`[embed] HTTP ${res.status} from ${ollamaUrl}/api/embeddings\`)`.
- **Impact:** Users relying on `--context-mode semantic` currently get silently degraded review quality with no feedback. After fix, they get a logged fallback and the static context they would have had anyway.
- **Effort:** S

---

## Check 7: cosineSimilarity Mathematical Correctness

From `src/core/embedder.ts:23–35`:
- Numerator: `dot += a[i] * b[i]` — correct dot product.
- Denominator: `Math.sqrt(normA) * Math.sqrt(normB)` where `normA = sum(a[i]²)` and `normB = sum(b[i]²)` — correct L2 norm product.
- Zero vector guard: `return denom === 0 ? 0 : dot / denom` — explicit, correct.
- Identity check: `[1,0,0]` vs `[1,0,0]` → dot=1, normA=1, normB=1, denom=1, result=1.0. Correct.
- Empty array guard: `if (a.length !== b.length || a.length === 0) return 0` — handles zero-length inputs.

> CHECK 7: No finding — cosineSimilarity is mathematically correct. Zero vector, mismatched length, and identical vector cases are all handled.

---

## Check 8: contextLoader Test Coverage of Semantic Path

Coverage from `npm run test:coverage`:
```
contextLoader.ts |  57.85  |   89.47  |  66.66  |  57.85  | 90-92,113-174
embedder.ts      |  48.27  |   87.5   |  50     |  48.27  | 7-21
```

- Lines 113–174 = the entire `loadAgentContextSemantic` function. **Zero coverage.**
- Lines 7–21 in `embedder.ts` = the entire `embed()` HTTP function. **Zero coverage.**
- `cosineSimilarity` is tested indirectly (line 23+ covered), but `embed()` is not.
- `tests/unit/contextLoader.test.ts` imports only `loadAgentContext` — `loadAgentContextSemantic` is not imported or called anywhere in the test suite.

---

### Finding: loadAgentContextSemantic and embed() have zero test coverage

- **Tag:** [NEW]
- **Severity:** High
- **Confidence:** Verified
- **Repository:** ACR
- **Evidence:**
  - `npm run test:coverage` output: `contextLoader.ts` lines 113-174 uncovered, `embedder.ts` lines 7-21 uncovered
  - `tests/unit/contextLoader.test.ts:4` — imports only `loadAgentContext`, never `loadAgentContextSemantic`
  - No test file imports `embed` from `embedder.ts`
- **Reproduction:** `npm run test:coverage 2>&1 | grep -A 3 "contextLoader"` — observe 0% coverage on lines 113-174
- **Root Cause:** `loadAgentContextSemantic` was implemented as a feature and the HTTP dependency (`embed()`) made it harder to unit test without mocking. No tests were written.
- **Fix:** Add `tests/unit/embedder.test.ts` and extend `tests/unit/contextLoader.test.ts`:
  1. **embedder.test.ts**: Mock `fetch` (vi.stubGlobal). Test: (a) successful embed returns `number[]`; (b) HTTP non-ok returns null; (c) network error returns null; (d) timeout returns null.
  2. **contextLoader.test.ts**: Mock `embed` from `../../src/core/embedder.js` with `vi.mock`. Test: (a) when embed returns null, `loadAgentContextSemantic` returns empty; (b) when embed returns vectors, files are ranked by cosine similarity and loaded within budget; (c) truncation when budget is exceeded; (d) missing memory-bank directory returns empty.
- **Impact:** The entire `--context-mode semantic` code path is currently unverified. Any regression (wrong similarity ranking, wrong budget enforcement, wrong empty-result handling) would ship silently.
- **Effort:** M

---

## Summary Table

| # | Finding | Severity | Tag | Effort |
|---|---------|----------|-----|--------|
| 1 | BaseAgent has 19 distinct concerns — SRP violated at High threshold | High | NEW | M |
| 2 | Silent zero-finding return when all stage-1 items fail validation | Medium | NEW | XS |
| 3 | validateFindings drops findings silently with no diagnostic log | Medium | NEW | XS |
| 4 | `basis→evidence` aliasing undocumented; filter rejects `evidence`-only findings | Low | NEW | S |
| 5 | Confidence clamping is correct for all edge cases | — | null | — |
| 6 | `--context-mode semantic` silently degrades to no-context on embed failure | High | NEW | S |
| 7 | cosineSimilarity is mathematically correct; zero vector handled | — | null | — |
| 8 | `loadAgentContextSemantic` and `embed()` have zero test coverage | High | NEW | M |

**Net-new findings: 6 (items 1–4, 6, 8)**
**Null results (clean): 2 (items 5, 7)**
