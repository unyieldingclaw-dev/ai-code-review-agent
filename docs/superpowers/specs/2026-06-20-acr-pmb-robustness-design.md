---
status: approved
created: 2026-06-20
approved: 2026-06-20
scope: cross-repo
risk: medium
source: human-approved
related_projects:
  - ai-code-review-agent (ACR)
  - personal-memory-bank (PMB)
---

# ACR + PMB Robustness Design

**Date:** 2026-06-20
**Status:** Approved
**Scope:** Cross-repo — `ai-code-review-agent` (ACR) and `personal-memory-bank` (PMB)

## Context

ACR is at v0.9.4 with 120 unit tests and 16 specialist agents. PMB is at v1.1.1, clean after a 58-finding audit. Both projects have been reviewed against their respective implementation briefs and a live codebase audit. This spec captures all agreed changes across four tracks.

**Dependency chain driving the design:**

```
PMB /change-review  →  ai-review-agent --profile change-review
                        └── outputs findings with domain/evidence/impact/recommendation/blocking
                        └── PMB formats into its /code-review report schema
```

**Models installed in Ollama:**

| Model | Size | Role |
|---|---|---|
| `devstral:latest` | 14 GB | Primary code review model — ACR default |
| `qwen3:latest` | 5.2 GB | Available for `--model` override; no tests require it live |
| `nomic-embed-text:latest` | 274 MB | Embedding model — reserved for future semantic context selection when `--context memory-bank` is built; not wired yet |

---

## Track 1 — ACR P0 Fixes

### 1.1 testgen opt-in

Remove `testgen` from `DEFAULT_CONFIG.agents` in `src/core/config.ts`.

Add two new CLI flags:
- `--suggest-tests` — enables testgen agent; output included in report only, no files written
- `--write-tests` — enables testgen AND writes generated test files to `testOutputDir`

The file-writing block in `src/cli/index.ts:106-113` gates exclusively on `--write-tests`. Running `--agents testgen` without `--write-tests` includes suggestions in the markdown report but writes nothing to disk. Default run never writes files.

### 1.2 Shell injection → spawnSync

Replace all `execSync` string interpolation with `spawnSync` array arguments. Three call sites:

- `src/cli/index.ts:145` — `execSync(\`git -C "${dir}" diff HEAD\`)`
- `src/mcp/tool.ts:24` — `execSync(\`git -C "${repoPath}" diff --cached\`)`
- `src/mcp/tool.ts:26` — `execSync(\`git diff\`)`

Replacement pattern:
```ts
import { spawnSync } from 'child_process'
spawnSync('git', ['-C', dir, 'diff', 'HEAD'], { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 })
```

Paths containing spaces and shell metacharacters become safe. All three sites updated.

### 1.3 Remove Anthropic provider

ACR is Ollama-only. Complete removal:
- `src/core/config.ts`: `provider: 'ollama' | 'anthropic'` → `provider: 'ollama'`; remove `anthropicModel` field from `ReviewConfig` and `DEFAULT_CONFIG`
- Any README mention of Anthropic provider as "planned" removed

No guard needed — just deletion.

### 1.4 MCP server version sync

`src/mcp/server.ts:22` hardcodes `'0.6.0'`. Replace with a runtime read of `package.json` version. Same approach as CLI version — read at startup, not build time.

### 1.5 Agent count drift — three wrong numbers

Three files each claim a different agent count:

| File | Claims | Correct |
|---|---|---|
| `.claude/commands/ai-review.md` | 11-agent | 15-agent (testgen now opt-in) |
| `src/mcp/server.ts` tool description | 10 agents | 15 agents |
| `.github/workflows/review.yml` comment | 15 agents | 15 agents ✓ |

Single source of truth: `DEFAULT_CONFIG.agents.length` after testgen removal = 15.

Update `.claude/commands/ai-review.md` description and `src/mcp/server.ts` tool description to match. Workflow comment is already correct.

Canonical wording:
> Local multi-agent AI code review powered by Ollama. Runs a configurable review swarm with 15 observe-only default agents; test generation is opt-in.

### 1.6 gitignore additions

```gitignore
# AI-generated scratch planning/session state
.claude/plans/
.claude/worktrees/

# Tool-neutral runtime state
.memory-bank/state/
```

### 1.7 Dead config field removal

Remove `contextLines` from `ReviewConfig` interface and `DEFAULT_CONFIG` in `src/core/config.ts`. It is defined nowhere in agents or runner and has no runtime effect.

---

## Track 2 — Test Foundation

### 2.1 requireOllamaModel helper

New file: `src/tests/helpers/requireOllama.ts`

Two distinct failure modes with distinct messages:

**Ollama not reachable:**
```
╔════════════════════════════════════════════════════════════╗
║  INTEGRATION TESTS SKIPPED — Ollama not reachable         ║
║                                                           ║
║  Solution:                                                ║
║    1. ollama serve                                        ║
║    2. INTEGRATION=1 npm test                              ║
╚════════════════════════════════════════════════════════════╝
```

**Ollama running but model not pulled:**
```
╔════════════════════════════════════════════════════════════╗
║  INTEGRATION TESTS SKIPPED — model not available          ║
║                                                           ║
║  Required model: devstral:latest                          ║
║  Ollama is running but this model is not pulled.          ║
║                                                           ║
║  Solution:                                                ║
║    ollama pull devstral:latest                            ║
║    then: INTEGRATION=1 npm test                           ║
╚════════════════════════════════════════════════════════════╝
```

The helper accepts `model: string` (defaults to `DEFAULT_CONFIG.model`). If `--model` is overridden at runtime, the check validates that model, not the hardcoded default. Applied in `beforeAll` of every integration/calibration test.

**Never silently skip.** Tests that cannot run must notify with the above formatted error and give a concrete solution. Silent `test.skip()` without a reason is forbidden in this codebase.

Applied to:
- `src/tests/e2e.test.ts` — requires Ollama + devstral
- `src/tests/calibrate.ts` — requires Ollama + devstral

Unit tests mock the provider entirely and never need a live model. This distinction is noted in a comment at the top of each unit test file.

### 2.2 Unit tests for 10 untested agents

The oldest/core agents have no unit tests. Each gets a test file following the established pattern from `errorHandlingAgent.test.ts`.

**Agents needing tests:**

| Agent | File |
|---|---|
| security | `src/tests/unit/securityAgent.test.ts` |
| performance | `src/tests/unit/performanceAgent.test.ts` |
| correctness | `src/tests/unit/correctnessAgent.test.ts` |
| design | `src/tests/unit/designAgent.test.ts` |
| dependencies | `src/tests/unit/dependenciesAgent.test.ts` |
| coverage | `src/tests/unit/coverageAnalystAgent.test.ts` |
| adversarial | `src/tests/unit/adversarialAgent.test.ts` |
| integration | `src/tests/unit/integrationScoutAgent.test.ts` |
| orchestrator | `src/tests/unit/orchestratorAgent.test.ts` |
| testGen | `src/tests/unit/testGenAgent.test.ts` |

**Pattern per agent (5 tests each):**
1. Returns `Finding[]` with correct shape for a relevant fixture diff
2. `severity` is populated and valid
3. `basis` is populated and valid
4. `file` and `line` are present and non-empty
5. Agent skips gracefully on empty diff

**Orchestrator tests are different** — mock a set of raw findings with intentional duplicates, assert dedup, cross-reference escalation, and cap behavior.

**Target:** ~50 new unit tests, bringing total from 120 to ~170.

### 2.3 nomic-embed-text — deferred

`nomic-embed-text` is installed and available. Best use cases: semantic finding deduplication in the orchestrator and semantic context file selection for `--context memory-bank`. Neither use case is implemented yet. Reserved for the integration track when `--context memory-bank` is built. Not wired in this track.

---

## Track 3 — PMB Infrastructure

### 3.1 Planned-folder structure

New directory layout:

```
docs/
  plans/               ← approved durable plans (tracked in git)
    README.md          ← explains scratch vs durable distinction
  archive/
    plans/             ← done/superseded/rejected plans (tracked)

.claude/
  plans/               ← AI-generated scratch drafts (gitignored)

.memory-bank/
  state/               ← runtime state (gitignored)
```

`.gitignore` additions:
```gitignore
.claude/plans/
.memory-bank/state/
```

### 3.2 Plan frontmatter template

`templates/plan.md` updated with canonical frontmatter:

```yaml
---
status: planned              # draft | planned | active | done | superseded | rejected
created: YYYY-MM-DD
approved: null
related_spec: null           # docs/specs/YYYY-MM-DD-slug.md or null
scope: local                 # local | repo | cross-repo
risk: medium                 # low | medium | high
source: ai-draft             # human | ai-draft | approved | imported
---
```

`related_spec` is optional. Personal projects are not required to have a spec before a plan.

### 3.3 `mb plan` command family

Four subcommands added to `scripts/mb.sh` and `scripts/mb.ps1`:

**`mb plan status`**
```
Plans: 1 active, 3 planned, 2 stale, 4 archived
Drafts: 2 in .claude/plans
Problems: 0 tracked scratch plans, 1 missing frontmatter
```

**`mb plan list`**
- Reads frontmatter from `docs/plans/*.md`
- Groups by status
- Shows path, status, created date, related spec, stale flag (30+ days no activity)
- Does not load full plan bodies

**`mb plan promote <draft>`**
- Accepts file under `.claude/plans/`
- Validates or adds frontmatter (prompts for missing required fields)
- Copies to `docs/plans/`
- Sets `status: planned` unless draft already has `active` or `approved`
- Refuses to overwrite existing durable plan without `--force`

**`mb plan archive <plan>`**
- Moves from `docs/plans/` to `docs/archive/plans/`
- Requires `status: done`, `status: superseded`, or `status: rejected` unless `--force`

### 3.4 `mb doctor` plan hygiene checks

Five new diagnostics added to the existing doctor output:

```
[OK]    docs/plans/ exists
[OK]    docs/archive/plans/ exists
[ERROR] .claude/plans/foo.md is tracked by git
[WARN]  docs/plans/bar.md missing frontmatter
[WARN]  2 plans have status: planned with no activity for 30+ days
[WARN]  1 active plan has no related task contract
```

Tone is friendly. A stale plan is a warning, not a failure.

### 3.5 `/feature-dev` and workflow update

`standards/WORKFLOW.md` and `.claude/commands/feature-dev.md` Phase 3 updated:

> Create the implementation plan as a draft in `.claude/plans/YYYY-MM-DD-slug.md`. After user approval, promote with `mb plan promote`. Do not treat `.claude/plans/` as durable memory. Summarize only active next steps in `memory-bank/activeContext.md`.

---

## Track 4 — Integration Layer

### 4.1 ACR `--profile` flag

New file: `src/core/profiles.ts`

```ts
export const PROFILES: Record<string, AgentName[]> = {
  fast: ['security', 'correctness', 'secrets'],
  full: [/* all 15 default agents */],
  'change-review': ['security', 'correctness', 'design', 'coverage', 'integration', 'migration-safety', 'secrets', 'complexity'],
  ui: ['security', 'performance', 'correctness', 'coverage', 'integration'],
  migration: ['migration-safety', 'correctness', 'secrets', 'dependencies'],
  security: ['security', 'secrets', 'dependencies', 'adversarial']
}
```

CLI flag: `--profile <name>`

Rules:
- `--agents` overrides `--profile` when both are provided
- `--profile full` never includes `testgen`
- Invalid profile name fails with list of valid options printed to stderr

### 4.2 ACR schema alignment

`src/core/schema.ts` — `Finding` interface gains MB/PMB fields:

```ts
export type ReviewDomain =
  | 'Security' | 'Correctness' | 'Performance' | 'Maintainability'
  | 'Testing' | 'Architecture Drift' | 'Dependencies' | 'Secrets'
  | 'Migration Safety' | 'License' | 'Observability' | 'Complexity'
  | 'Integration' | 'Breaking Change' | 'Error Handling' | 'Adversarial'

export type EvidenceSource =
  | 'llm' | 'heuristic' | 'gitleaks' | 'trufflehog' | 'semgrep'
  | 'npm-audit' | 'osv' | 'lizard' | 'git' | 'policy'

export interface Finding {
  // existing fields preserved
  id: string
  agent: AgentName
  severity: Severity
  basis: Basis
  file: string
  line: number
  lineEnd?: number          // new — end line for multi-line findings
  title: string
  detail: string
  suggestion: string        // deprecated alias for recommendation
  confidence?: number
  relatedFindings?: string[]
  corroboratingAgents?: AgentName[]
  // new MB/PMB fields
  domain: ReviewDomain
  evidence: string
  impact: string
  recommendation: string
  blocking: boolean
  source: EvidenceSource
}
```

`suggestion` is kept as a deprecated alias for one release. Formatters print `Recommendation`, not `Suggestion`. JSON output includes both during transition; `suggestion` deprecation noted in CHANGELOG.

Each agent's system prompt updated to emit `domain`, `evidence`, `impact`, `recommendation`, `blocking`, `source`. `BaseAgent` parse logic updated to handle the new fields with safe defaults on parse failure.

### 4.3 PMB `/change-review`

New files:
- `.claude/commands/change-review.md`
- `templates/claude-commands/change-review.md`

**Purpose:** Review the current branch, PR, MR, or diff as a complete change package.

**Inputs:**
```
/change-review
/change-review --diff path/to/change.diff
/change-review --base origin/main
/change-review --pr <number>
```

**Nine review jobs (Reviewer 9):**

| # | Job | What it checks |
|---|---|---|
| 1 | Scope sanity | Diff size vs stated scope, generated junk, unrelated files |
| 2 | Claim mapping | Every stated claim maps to files; every major touched file maps to a claim |
| 3 | Seam integrity | Layer boundaries, dependency injection, API/service/data seams |
| 4 | Runtime semantics | Defaults, env vars, startup behavior, async/concurrency, rollback |
| 5 | Test assertion strength | Tests assert behavior, not just types/truthiness/snapshots |
| 6 | Claim-to-test coverage | Every behavior claim has a test or explicit waiver |
| 7 | Security | Delegates to `/security-review` or ACR security/secrets agents |
| 8 | Accessibility | Conditional — delegates to `/accessibility-review` when UI files are touched |
| 9 | Opposition | Challenges overstatements, gaps, false positives, cross-domain risk |

**Report schema:** Domain / Severity / Location / Evidence / Basis / Impact / Recommendation / Blocking / Confidence

**Coverage footer:**
```
## Coverage Footer
- Review target: local diff | branch | PR | MR
- Base ref: <ref or unavailable>
- Files changed: <count>
- Plan/spec loaded: <none | path>
- Security review: reviewed | skipped
- Accessibility: reviewed | skipped - no UI files
- ACR backend: used | not installed | disabled
```

**ACR integration is graceful degradation:**
```
ACR not found in PATH. Skipping local LLM swarm. Continuing with PMB-native review.
```

No hard dependency on ACR. `/change-review` is fully functional without it.

### 4.4 `--context` placeholder

`--context <mode>` flag reserved in CLI with `none` wired. `memory-bank` mode prints:
```
--context memory-bank is not yet implemented. Use --context none.
```

`nomic-embed-text` semantic selection deferred to when this is fully built.

---

## Implementation Order

### Phase 1 — ACR P0 (one session)
1. Remove testgen from DEFAULT_CONFIG; add `--suggest-tests` / `--write-tests` flags
2. Replace execSync with spawnSync in cli/index.ts and mcp/tool.ts
3. Remove Anthropic provider entirely from config and types
4. Sync MCP server version from package.json
5. Fix agent count in ai-review.md and mcp/server.ts
6. Add gitignore entries; remove dead `contextLines` field

### Phase 2 — Test Foundation (one to two sessions)
1. Write `src/tests/helpers/requireOllama.ts`
2. Apply to e2e.test.ts and calibrate.ts
3. Write unit tests for 10 untested agents (~50 tests)

### Phase 3 — PMB Infrastructure (one session)
1. Add docs/plans/ structure and gitignore entries
2. Update plan template with frontmatter
3. Add `mb plan` subcommands to mb.sh and mb.ps1
4. Add mb doctor plan hygiene checks
5. Update /feature-dev and WORKFLOW.md

### Phase 4 — Integration (one to two sessions)
1. Add src/core/profiles.ts and --profile flag
2. Update Finding schema with MB/PMB fields
3. Update agent system prompts to emit new fields
4. Update formatters (markdown + JSON)
5. Add PMB /change-review command
6. Wire --context placeholder

---

## Acceptance Criteria

### ACR
- [ ] Default run never writes files
- [ ] `--write-tests` is required to write generated test files
- [ ] `--dir` and MCP `repoPath` are safe against shell metacharacters
- [ ] No `anthropic` in config type, no `anthropicModel` in config
- [ ] `ai-review-agent --version` matches package.json
- [ ] MCP server version matches package.json
- [ ] All docs consistently say 15 default agents
- [ ] `requireOllamaModel` helper used in all integration/calibration tests
- [ ] Integration tests that skip output a visible error with solution steps — no silent skips
- [ ] 10 previously untested agents each have ≥5 unit tests
- [ ] Total unit tests ≥170
- [ ] `--profile change-review` exists and runs correct agent subset
- [ ] `Finding` includes `domain`, `evidence`, `impact`, `recommendation`, `blocking`, `source`
- [ ] Markdown output includes all MB/PMB fields
- [ ] JSON output includes all MB/PMB fields

### PMB
- [ ] `.claude/plans/` is gitignored and flagged by `mb doctor` if tracked
- [ ] `.memory-bank/state/` is gitignored
- [ ] `docs/plans/README.md` exists
- [ ] `mb plan status`, `mb plan list`, `mb plan promote`, `mb plan archive` all work
- [ ] `mb doctor` includes plan hygiene checks
- [ ] `/feature-dev` drafts plans to `.claude/plans/`, promotes approved to `docs/plans/`
- [ ] `/change-review` exists and reviews a local diff without requiring ACR, GitHub, or Ollama
- [ ] `/change-review` uses ACR when available, degrades gracefully when not
- [ ] All existing PMB tests pass
