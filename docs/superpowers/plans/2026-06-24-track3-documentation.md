# Track 3 — Documentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add CHANGELOG entries for v0.9.x and v1.0.0, remove the stale `@anthropic-ai/sdk` dependency, and add JSDoc comments to the PROFILES constant.

**Architecture:** Pure documentation and metadata changes. No production code logic changes. No tests needed (these are docs/config). Verify with `npm run check` at the end.

**Tech Stack:** Markdown, JSON, TypeScript JSDoc

---

## File Map

| Operation | File |
|---|---|
| Modify | `CHANGELOG.md` — add v0.9.x and v1.0.0 entries |
| Modify | `package.json` — remove `@anthropic-ai/sdk` from optionalDependencies |
| Modify | `src/core/profiles.ts` — add JSDoc to PROFILES |

---

### Task 1: Add CHANGELOG entries

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Insert v1.0.0 and v0.9.x entries at the top of CHANGELOG.md**

The current CHANGELOG starts at `## [0.8.0]`. Insert the following block immediately after the header (after line 5, before `## [0.8.0]`):

```markdown
## [1.0.0] — 2026-06-24

### Added

- **`--profile` flag**: named agent subsets — `fast` (3 agents), `full` (15 agents), `change-review` (8 agents), `ui`, `migration`, `security`. `--agents` overrides `--profile`.
- **`--context memory-bank`**: loads per-agent project context from `memory-bank/` files before each agent runs. Budget-bounded at 4000 chars per agent by default.
- **`--format sarif`**: SARIF 2.1.0 output for upload to GitHub Code Scanning.
- **`--format github-annotations`**: GitHub Actions workflow annotation output (`::error`/`::warning`/`::notice` per finding).
- **Policy layer** (`agentPolicy` config): per-agent include/exclude glob path filtering. Skip agents whose include/exclude rules don't match changed files. Policy footer added to JSON and markdown output.
- **Extended Finding schema**: `domain` (ReviewDomain), `evidence`, `impact`, `recommendation`, `blocking`, `source` (EvidenceSource), `lineEnd` fields. `suggestion` kept as deprecated alias.
- All 15 specialist agent system prompts updated to emit new schema fields.
- `tests/helpers/requireOllama.ts`: visible error box with solution steps when Ollama or required model is unavailable (replaces silent skip).
- Unit tests for all 16 specialist agents (including 10 previously untested core agents).
- `src/core/contextLoader.ts`: per-agent memory-bank file routing with budget enforcement.
- `src/core/policyFilter.ts`: glob-based agent path filtering (no external dependency).
- `src/core/profiles.ts`: PROFILES map + `resolveProfile()`.
- Self-hosted GitHub Actions runner setup with Task Scheduler (calibration CI).
- `npm run check` script: single command runs tests + typecheck + build + format:check.

### Changed

- **testgen is now opt-in**: removed from `DEFAULT_CONFIG.agents`. Enable with `--suggest-tests` (report only) or `--write-tests` (writes files).
- Anthropic provider removed — ACR is Ollama-only. `provider` type narrowed to `'ollama'`.
- Removed dead config fields: `anthropicModel`, `contextLines`.
- MCP server version now reads from `package.json` at runtime (was hardcoded `'0.6.0'`).
- Shell injection fix: `execSync` with string interpolation replaced by `spawnSync` with array args in CLI and MCP tool.
- Calibration CI: `continue-on-error: true` + `timeout-minutes: 10` so releases aren't blocked when runner is offline.

### Removed

- `@anthropic-ai/sdk` from `optionalDependencies` — Anthropic provider was never implemented and has been removed.

### Tests

- 248 unit tests across 34 test files (up from 112 at v0.8.0).
- 16/16 calibration PASS (design agent: SOLID principle naming in detail; complexity agent: concise recommendations).

---

## [0.9.4] — 2026-06-19

### Added

- `--parallel` flag: runs specialist agents via `Promise.allSettled` for faster review (disables fail-fast).
- Two-phase `AgentProgressEvent`: `start` event fires synchronously before agents run, `end` fires with findings and elapsed time.

### Tests

- 120 unit tests (up from 117): added 2 parallel execution tests.

---

## [0.9.3] — 2026-06-19

### Changed

- DependenciesAgent prompt restructured: REQUIRED OUTPUT FORMAT + few-shot example leads the prompt. Fixes JSON parse failures on `package.json` diffs.

### Tests

- 16/16 calibration PASS confirmed.

---

## [0.9.2] — 2026-06-19

### Fixed

- Balanced-bracket JSON parser in `base.ts`: handles wildcard characters in dependency version strings.
- `integrationScout.ts` prompt: corrected integration-tests wording.
- `dependencies.ts` prompt: corrected wildcard version wording.
- `license.diff` calibration fixture: updated `node-lame` package reference.

### Tests

- 118 unit tests.

---

## [0.9.1] — 2026-06-19

### Changed

- Calibration prompt tuning: ErrorHandlingAgent (swallowed keyword + selective-rethrow exclusion), ObservabilityAgent (pure-function exclusion), MigrationSafetyAgent (safe DDL exclusion).

---

## [0.9.0] — 2026-06-18

### Added

- `--fail-fast` flag: stops the swarm on the first finding at or above the `--fail-on` threshold.
- `failFast` and `failOn` fields on `ReviewConfig`.
- `earlyExit` field on `ReviewResult` (`{ stoppedAt: AgentName }`).
- stderr progress renderer: per-agent start/end events with elapsed time and finding counts.

### Tests

- 117 unit tests (up from 112): added 5 fail-fast/progress tests.

```

- [ ] **Step 2: Verify the file looks correct**

```bash
cd "C:\Users\Mizzo\Claude\AI-Code-Review-Agent"
head -30 CHANGELOG.md
```

Expected: `## [1.0.0]` appears at the top (after the file header), followed by `## [0.9.4]`, etc.

- [ ] **Step 3: Commit**

```bash
cd "C:\Users\Mizzo\Claude\AI-Code-Review-Agent"
git add CHANGELOG.md
git commit -m "docs: add CHANGELOG entries for v0.9.x and v1.0.0"
```

---

### Task 2: Remove @anthropic-ai/sdk from package.json

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Remove the optionalDependencies block**

In `package.json`, find and remove the entire `optionalDependencies` block:

```json
"optionalDependencies": {
  "@anthropic-ai/sdk": "^0.30.0"
}
```

The file currently ends with this block after `devDependencies`. Remove it entirely. The resulting `package.json` should end with `devDependencies` as the last key.

- [ ] **Step 2: Verify no code references @anthropic-ai/sdk**

```bash
cd "C:\Users\Mizzo\Claude\AI-Code-Review-Agent"
grep -r "anthropic-ai\|@anthropic" src/ 2>/dev/null
```

Expected: No output — no code references the package.

- [ ] **Step 3: Run check to confirm nothing broke**

```bash
cd "C:\Users\Mizzo\Claude\AI-Code-Review-Agent"
npm run check 2>&1 | tail -5
```

Expected: All tests pass, 0 errors.

- [ ] **Step 4: Commit**

```bash
cd "C:\Users\Mizzo\Claude\AI-Code-Review-Agent"
git add package.json
git commit -m "chore: remove @anthropic-ai/sdk from optionalDependencies (provider removed)"
```

---

### Task 3: Add JSDoc to PROFILES

**Files:**
- Modify: `src/core/profiles.ts`

- [ ] **Step 1: Add JSDoc block above the PROFILES export**

Current `src/core/profiles.ts` line 3:
```ts
export const PROFILES: Record<string, AgentName[]> = {
```

Replace with:

```ts
/**
 * Named agent subsets for common review scenarios.
 *
 * - `fast`:          3 agents — quick PR gate (security + correctness + secrets). ~3 min.
 * - `full`:          All 15 default agents. Comprehensive review. ~30–45 min.
 * - `change-review`: 8 agents — matches PMB /change-review scope. ~10–15 min.
 * - `ui`:            5 agents — frontend-focused (excludes migration-safety, license). ~8 min.
 * - `migration`:     4 agents — database/schema change focused. ~5 min.
 * - `security`:      4 agents — security audit focused. ~5 min.
 *
 * `--agents` overrides `--profile` when both are provided.
 * `testgen` is never included in any profile — always opt-in via `--suggest-tests`.
 */
export const PROFILES: Record<string, AgentName[]> = {
```

- [ ] **Step 2: Run typecheck to confirm JSDoc is valid**

```bash
cd "C:\Users\Mizzo\Claude\AI-Code-Review-Agent"
npm run typecheck 2>&1 | tail -3
```

Expected: 0 errors.

- [ ] **Step 3: Run full check**

```bash
cd "C:\Users\Mizzo\Claude\AI-Code-Review-Agent"
npm run check 2>&1 | tail -5
```

Expected: All tests pass, format clean.

- [ ] **Step 4: Commit**

```bash
cd "C:\Users\Mizzo\Claude\AI-Code-Review-Agent"
git add src/core/profiles.ts
git commit -m "docs: add JSDoc to PROFILES explaining each profile's scope and trade-offs"
```

---

### Task 4: Final push

- [ ] **Step 1: Push all commits**

```bash
cd "C:\Users\Mizzo\Claude\AI-Code-Review-Agent"
git push origin main
```
