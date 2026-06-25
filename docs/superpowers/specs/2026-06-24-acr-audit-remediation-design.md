---
status: approved
created: 2026-06-24
approved: 2026-06-24
related_spec: null
scope: repo
risk: low
source: approved
---

# ACR Audit Remediation Design

**Date:** 2026-06-24
**Status:** Approved
**Scope:** `ai-code-review-agent` only

## Background

A comprehensive audit of ACR v1.0.0 surfaced 30 findings across correctness, test coverage, documentation, and cleanup categories. This spec covers all four remediation tracks in priority order.

---

## Track 1 — Correctness

### 1.1 BaseAgent validation gap

**File:** `src/core/agents/base.ts` — `validateFindings()`

**Problem:** The filter only validates `severity`, `basis`, `file`, `line`, `title`, `detail`, and `suggestion|recommendation`. The required fields added in the schema extension (`domain`, `evidence`, `impact`, `blocking`, `source`) are not validated before the map step. Malformed LLM output can produce findings with missing required fields that pass through.

**Fix:** Expand the filter predicate to check all required Finding fields. For fields that have safe defaults (domain, evidence, impact, blocking, source), fill them in the map step rather than rejecting the finding — rejection causes false negatives; defaulting is more robust.

Specifically:
- Validate presence of `domain` — if missing, fill from `agentDefaultDomain(this.name)` (already exists)
- Validate `evidence` — if missing, default to `f.detail`
- Validate `impact` — if missing, default to `''`
- Validate `blocking` — if missing, default to `f.severity === 'critical'`
- Validate `source` — if missing, default to `'llm'`

These defaults already exist in the map step but are applied even when the field is present in raw output (which is the correct behavior). The goal is to ensure no finding reaches the caller with `undefined` for a required field.

**Testing:** Add assertions to `tests/unit/baseAgent.test.ts` that a finding with missing `domain`, `evidence`, etc. gets the correct defaults rather than `undefined`.

### 1.2 Sanitizer partial match

**File:** `src/core/sanitizer.ts`

**Problem:** `.replace(pattern, '[REDACTED]')` replaces only the first match when a diff line contains multiple injection patterns.

**Fix:** Add the `g` (global) flag to each regex pattern in the sanitizer so all occurrences on a line are redacted. Node 18+ supports `String.prototype.replaceAll()` but the regex-based approach with `/g` flag is already idiomatic here.

**Testing:** Add a test in `tests/unit/sanitizer.test.ts` for a line containing two injection patterns — both should be redacted.

### 1.3 MCP coverage agent

**Status:** False positive — no fix required. Coverage agent's `run()` method returns `Finding[]` via BaseAgent, which the MCP formatter handles correctly. The coverage gap data from `runForCoverage()` is only invoked by SwarmRunner directly, not through MCP.

---

## Track 2 — Test Coverage

### 2.1 GitHub adapter tests

**File:** Create `tests/unit/adapters/github.test.ts`

**Problem:** `src/adapters/github.ts` exports `upsertPRComment()` and `buildStepSummary()` with zero test coverage. The adapter makes real GitHub API calls. `vitest.config.ts` explicitly excludes `src/adapters/**` from coverage measurement.

**Fix:** Create tests using `vi.stubGlobal('fetch', ...)` to mock the GitHub API. Cover:

For `buildStepSummary()` (pure function — no mocking needed):
- Empty findings → table with "No findings" row
- Single finding → correct row format (severity, agent, file:line, title, basis)
- Multiple findings across severities → all rows present
- Duration formatted correctly

For `upsertPRComment()` (mock fetch):
- Creates new comment when no existing comment matches `COMMENT_MARKER`
- Patches existing comment when COMMENT_MARKER found in comment body
- Prepends COMMENT_MARKER to body in both create and update
- Throws on GitHub API error (non-2xx response)
- Throws on list comments failure

### 2.2 Vitest coverage config

**File:** `vitest.config.ts`

**Problem:** `coverage.exclude` lists `['src/cli/**', 'src/adapters/**']`, hiding real coverage gaps from reports.

**Fix:** Remove both exclusions. `src/cli/**` already has formatter tests (sarif, githubAnnotations, etc.). `src/adapters/**` will have coverage once 2.1 lands.

---

## Track 3 — Documentation

### 3.1 CHANGELOG v1.0.0 entry

**File:** `CHANGELOG.md`

**Problem:** CHANGELOG ends at v0.8.0. Six version increments (v0.9.0–v1.0.0) are undocumented.

**Fix:** Add entries for:

```
[1.0.0] — 2026-06-24
- --profile flag: fast, full, change-review, ui, migration, security presets
- --context memory-bank: per-agent memory-bank file injection with budget
- --format sarif: SARIF 2.1.0 output for GitHub Code Scanning
- --format github-annotations: GitHub Actions workflow annotation output
- Policy layer: agentPolicy per-agent include/exclude path filtering
- Finding schema: domain, evidence, impact, recommendation, blocking, source fields
- All 15 agent system prompts updated to emit new fields
- 16/16 calibration passing (design + complexity prompt fixes)
- 236 unit tests across 33 files
- Anthropic provider removed — ACR is Ollama-only

[0.9.x] — 2026-06-18 to 2026-06-22
- v0.9.4: --parallel flag, 120 unit tests, improved agent prompts
- v0.9.0-0.9.3: --fail-fast, progress events, calibration tuning

[0.8.0] — 2026-06-15 (already documented)
```

### 3.2 Remove `@anthropic-ai/sdk` from optionalDependencies

**File:** `package.json`

**Problem:** `@anthropic-ai/sdk` is listed in `optionalDependencies` but no code references it. The Anthropic provider was intentionally removed.

**Fix:** Remove the entry. Document in CHANGELOG under 1.0.0: "Anthropic provider removed — ACR is Ollama-only."

### 3.3 Profile JSDoc comments

**File:** `src/core/profiles.ts`

**Problem:** The `PROFILES` constant exports 6 profiles with no documentation on intent or trade-offs.

**Fix:** Add JSDoc block to the `PROFILES` export explaining each profile:

```ts
/**
 * Named agent subsets for common review scenarios.
 *
 * fast:          3 agents — quick PR gate (security + correctness + secrets). ~3 min.
 * full:          All 15 default agents. Comprehensive review. ~30-45 min.
 * change-review: 8 agents — matches PMB /change-review scope. ~10-15 min.
 * ui:            5 agents — frontend-focused (no migration-safety/license). ~8 min.
 * migration:     4 agents — database/schema change focused. ~5 min.
 * security:      4 agents — security audit focused. ~5 min.
 *
 * --agents overrides --profile when both are provided.
 * testgen is never included in any profile (always opt-in via --suggest-tests).
 */
```

---

## Track 4 — Cleanup

### 4.1 `contextBudgetChars` config option

**Files:** `src/core/config.ts`, `src/core/contextLoader.ts`, `src/cli/index.ts`

**Problem:** `CONTEXT_BUDGET_CHARS = 4000` is a hardcoded magic number.

**Fix:**
- Add `contextBudgetChars?: number` to `ReviewConfig` (default 4000)
- Pass it from runner through to `loadAgentContext(projectPath, agentName, budget)`
- Add `--context-budget <n>` CLI flag

**Testing:** Add a test to `tests/unit/contextLoader.test.ts` that respects a custom budget (already has truncation test — just parameterize it).

### 4.2 Schema `lineEnd` validation

**Files:** `src/core/agents/base.ts`, `src/cli/formatters/sarif.ts`

**Problem:** `Finding.lineEnd` has no constraint that `lineEnd >= line`. Inverted values produce invalid SARIF.

**Fix:**
- In `BaseAgent.validateFindings()` map step: clamp `lineEnd` to `Math.max(f.line, f.lineEnd ?? f.line)`
- In SARIF formatter: use `endLine: f.lineEnd && f.lineEnd >= f.line ? f.lineEnd : f.line` (defensive, even after the BaseAgent fix)

**Testing:** Add test to `tests/unit/baseAgent.test.ts` that a finding with `lineEnd < line` gets clamped.

### 4.3 `AGENT_PRIORITY` documentation

**File:** `src/core/agents/orchestrator.ts`

**Problem:** `AGENT_PRIORITY` array has no comment explaining what it controls or why agents are ranked as they are.

**Fix:** Add comment block above the constant:

```ts
// Dedup tie-breaker: when multiple agents flag the same file:line,
// the highest-priority agent's finding is kept and others become corroboratingAgents.
// Higher index = higher priority (kept on conflict).
// Rationale: secrets/error-handling are high-signal, specific findings.
// integration/breaking-change tend toward broader, overlapping concerns.
```

### 4.4 Remove `actions-runner2`

**Local cleanup only** — Delete `C:\Users\Mizzo\actions-runner2\` (created during runner setup, never configured). Not a code change, not committed.

---

## Implementation Order

Execute tracks sequentially within each session. Each track is independent — Track 2 can start after Track 1 commits land.

| Track | Files touched | Tests added | Estimated commits |
|---|---|---|---|
| 1 — Correctness | base.ts, sanitizer.ts | 3-4 | 2 |
| 2 — Test coverage | github.test.ts, vitest.config.ts | 10-12 | 2 |
| 3 — Documentation | CHANGELOG.md, package.json, profiles.ts | 0 | 2 |
| 4 — Cleanup | config.ts, contextLoader.ts, index.ts, base.ts, sarif.ts, orchestrator.ts | 2 | 3 |

## Acceptance Criteria

- [ ] `validateFindings()` never produces a Finding with `undefined` for required fields
- [ ] Sanitizer redacts all injection patterns on a multi-pattern line (not just first)
- [ ] `tests/unit/adapters/github.test.ts` exists with ≥ 8 tests, all passing
- [ ] `vitest.config.ts` no longer excludes `src/cli/**` or `src/adapters/**`
- [ ] CHANGELOG includes v1.0.0 entry
- [ ] `@anthropic-ai/sdk` removed from `package.json`
- [ ] `PROFILES` has JSDoc comments
- [ ] `contextBudgetChars` in ReviewConfig, passed to contextLoader
- [ ] `lineEnd` clamped in BaseAgent and SARIF formatter
- [ ] `AGENT_PRIORITY` has rationale comment
- [ ] `npm run check` passes (236+ tests, 0 TypeScript errors, clean build, format clean)
