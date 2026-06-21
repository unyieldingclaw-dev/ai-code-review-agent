# ACR + PMB Integration Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `--profile` flag and profile map to ACR; add MB/PMB-compatible fields to the `Finding` schema; update all 15 agent system prompts to emit the new fields; update markdown and JSON formatters; add PMB `/change-review` slash command that uses ACR when available.

**Architecture:** New `src/core/profiles.ts` constant map. `Finding` schema extended in-place (backward compatible — `suggestion` kept as alias). All 15 agents updated in separate sub-tasks. PMB gets a new slash command that delegates to ACR with graceful degradation.

**Tech Stack:** TypeScript (ACR), Markdown (PMB slash command), Vitest

**Dependency:** Complete Plan 1 (ACR P0 Fixes) before starting — testgen must already be removed from defaults and schema types must be clean.

---

## File Map

**ACR (`ai-code-review-agent`):**

| Operation | File |
|---|---|
| Create | `src/core/profiles.ts` |
| Modify | `src/core/schema.ts` — extend Finding interface |
| Modify | `src/cli/index.ts` — add `--profile` flag |
| Modify | `src/core/agents/security.ts` |
| Modify | `src/core/agents/performance.ts` |
| Modify | `src/core/agents/correctness.ts` |
| Modify | `src/core/agents/design.ts` |
| Modify | `src/core/agents/dependencies.ts` |
| Modify | `src/core/agents/coverageAnalyst.ts` |
| Modify | `src/core/agents/adversarial.ts` |
| Modify | `src/core/agents/integrationScout.ts` |
| Modify | `src/core/agents/breakingChange.ts` |
| Modify | `src/core/agents/licenseCompliance.ts` |
| Modify | `src/core/agents/errorHandling.ts` |
| Modify | `src/core/agents/observability.ts` |
| Modify | `src/core/agents/migrationSafety.ts` |
| Modify | `src/core/agents/secrets.ts` |
| Modify | `src/core/agents/complexity.ts` |
| Modify | `src/cli/formatter.ts` — print new fields |
| Create | `tests/unit/profiles.test.ts` |

**PMB (`personal-memory-bank`):**

| Operation | File |
|---|---|
| Create | `.claude/commands/change-review.md` |
| Create | `templates/claude-commands/change-review.md` |

---

### Task 1: Create profiles.ts and add --profile to CLI

**Files:**
- Create: `src/core/profiles.ts`
- Modify: `src/cli/index.ts`
- Create: `tests/unit/profiles.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/profiles.test.ts`:

```ts
// tests/unit/profiles.test.ts
import { describe, it, expect } from 'vitest'
import { PROFILES, resolveProfile } from '../../src/core/profiles.js'
import { DEFAULT_CONFIG } from '../../src/core/config.js'

describe('PROFILES', () => {
  it('has a fast profile with 3 agents', () => {
    expect(PROFILES.fast).toHaveLength(3)
    expect(PROFILES.fast).toContain('security')
    expect(PROFILES.fast).toContain('correctness')
    expect(PROFILES.fast).toContain('secrets')
  })

  it('has a full profile with all 15 default agents', () => {
    expect(PROFILES.full).toHaveLength(15)
    expect(PROFILES.full).not.toContain('testgen')
  })

  it('has a change-review profile', () => {
    expect(PROFILES['change-review']).toBeDefined()
    expect(PROFILES['change-review'].length).toBeGreaterThan(0)
  })

  it('no profile contains testgen', () => {
    for (const [name, agents] of Object.entries(PROFILES)) {
      expect(agents, `profile ${name} should not include testgen`).not.toContain('testgen')
    }
  })
})

describe('resolveProfile', () => {
  it('returns agents for a valid profile name', () => {
    const agents = resolveProfile('fast')
    expect(agents).toEqual(PROFILES.fast)
  })

  it('throws with helpful message for unknown profile', () => {
    expect(() => resolveProfile('nonexistent')).toThrow(/unknown profile/i)
    expect(() => resolveProfile('nonexistent')).toThrow(/fast|full|change-review/)
  })

  it('is case-sensitive', () => {
    expect(() => resolveProfile('Fast')).toThrow()
  })
})
```

- [ ] **Step 2: Run to verify tests fail**

```bash
npm test -- tests/unit/profiles.test.ts
```

Expected: FAIL — `profiles.ts` does not exist yet.

- [ ] **Step 3: Create src/core/profiles.ts**

```ts
import type { AgentName } from './schema.js'

export const PROFILES: Record<string, AgentName[]> = {
  fast: ['security', 'correctness', 'secrets'],
  full: [
    'security', 'performance', 'correctness', 'design', 'dependencies',
    'coverage', 'adversarial', 'integration', 'breaking-change', 'license',
    'error-handling', 'observability', 'migration-safety', 'secrets', 'complexity'
  ],
  'change-review': [
    'security', 'correctness', 'design', 'coverage',
    'integration', 'migration-safety', 'secrets', 'complexity'
  ],
  ui: ['security', 'performance', 'correctness', 'coverage', 'integration'],
  migration: ['migration-safety', 'correctness', 'secrets', 'dependencies'],
  security: ['security', 'secrets', 'dependencies', 'adversarial']
}

export function resolveProfile(name: string): AgentName[] {
  const agents = PROFILES[name]
  if (!agents) {
    const valid = Object.keys(PROFILES).join(', ')
    throw new Error(`Unknown profile "${name}". Valid profiles: ${valid}`)
  }
  return agents
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- tests/unit/profiles.test.ts
```

Expected: All PASS.

- [ ] **Step 5: Add --profile flag to src/cli/index.ts**

In `src/cli/index.ts`, add after the `--agents` option:

```ts
.option('--profile <name>', 'Run a named agent subset (fast, full, change-review, ui, migration, security)')
```

Add `profile?: string` to the options type.

In the action handler, after the `--agents` processing block, add:

```ts
// --profile sets agents unless --agents was explicitly provided
if (options.profile && !options.agents) {
  try {
    const { resolveProfile } = await import('../core/profiles.js')
    config.agents = resolveProfile(options.profile)
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  }
}
```

- [ ] **Step 6: Build and smoke-test**

```bash
npm run build
node dist/cli/index.js --profile fast --diff /dev/null 2>&1 || true
node dist/cli/index.js --profile nonexistent 2>&1
```

Expected: `--profile fast` runs with 3 agents. `--profile nonexistent` prints "Unknown profile" with the valid list.

- [ ] **Step 7: Run full test suite**

```bash
npm test
```

Expected: All tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/core/profiles.ts tests/unit/profiles.test.ts src/cli/index.ts
git commit -m "feat: add --profile flag and PROFILES map (fast, full, change-review, ui, migration, security)"
```

---

### Task 2: Extend Finding schema with MB/PMB fields

**Files:**
- Modify: `src/core/schema.ts`

- [ ] **Step 1: Update src/core/schema.ts**

Replace the `Finding` interface and add the new types:

```ts
export type AgentName =
  | 'security'
  | 'performance'
  | 'correctness'
  | 'design'
  | 'dependencies'
  | 'coverage'
  | 'testgen'
  | 'adversarial'
  | 'integration'
  | 'breaking-change'
  | 'license'
  | 'secrets'
  | 'error-handling'
  | 'observability'
  | 'migration-safety'
  | 'complexity'

export type Severity = 'critical' | 'high' | 'medium' | 'low'
export type Basis = 'VERIFIED' | 'INFERRED' | 'SPECULATIVE'
export type TestFramework = 'vitest' | 'jest' | 'mocha' | 'pytest'

export type ReviewDomain =
  | 'Security'
  | 'Correctness'
  | 'Performance'
  | 'Maintainability'
  | 'Testing'
  | 'Architecture Drift'
  | 'Dependencies'
  | 'Secrets'
  | 'Migration Safety'
  | 'License'
  | 'Observability'
  | 'Complexity'
  | 'Integration'
  | 'Breaking Change'
  | 'Error Handling'
  | 'Adversarial'

export type EvidenceSource =
  | 'llm'
  | 'heuristic'
  | 'gitleaks'
  | 'trufflehog'
  | 'semgrep'
  | 'npm-audit'
  | 'osv'
  | 'lizard'
  | 'git'
  | 'policy'

export interface Finding {
  id: string
  agent: AgentName
  domain: ReviewDomain
  severity: Severity
  basis: Basis
  file: string
  line: number
  lineEnd?: number
  title: string
  detail: string
  evidence: string
  impact: string
  recommendation: string
  /** @deprecated use recommendation */
  suggestion: string
  blocking: boolean
  source: EvidenceSource
  confidence?: number
  relatedFindings?: string[]
  corroboratingAgents?: AgentName[]
}

export interface CoverageGap {
  file: string
  functionName: string
  lineStart: number
  lineEnd: number
  description: string
}

export interface GeneratedTestFile {
  path: string
  content: string
  framework: TestFramework
}

export interface ReviewInput {
  diff: string
  projectPath?: string
}

export interface ReviewSummary {
  totalFindings: number
  bySeverity: Partial<Record<Severity, number>>
  byAgent: Partial<Record<AgentName, number>>
  durationMs: number
}

export interface ReviewResult {
  findings: Finding[]
  testFiles: GeneratedTestFile[]
  summary: ReviewSummary
  earlyExit?: { stoppedAt: AgentName }
}

export const SEVERITY_RANK: Record<Severity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1
}

export type FailOnLevel = 'critical' | 'high' | 'medium' | 'any' | 'never'
export const FAIL_ON_OPTIONS: FailOnLevel[] = ['critical', 'high', 'medium', 'any', 'never']

export interface AgentProgressEvent {
  phase: 'start' | 'end'
  name: AgentName
  index: number
  total: number
  findings?: Finding[]
  elapsedMs?: number
  earlyExit?: boolean
}
```

- [ ] **Step 2: Run typecheck to surface all breakages**

```bash
npm run typecheck 2>&1 | head -50
```

The new required fields (`domain`, `evidence`, `impact`, `recommendation`, `blocking`, `source`) will cause TypeScript errors in BaseAgent's parse logic and all agent system prompts. Note all error locations — the next tasks fix them.

- [ ] **Step 3: Add safe defaults in BaseAgent parse**

In `src/core/agents/base.ts`, find where raw LLM output is parsed into `Finding[]`. In the mapping/normalization step, add defaults for the new fields so existing tests don't break while agents are updated:

```ts
// In the finding normalization in base.ts, add after existing field extraction:
domain: raw.domain ?? agentDefaultDomain(this.name),
evidence: raw.evidence ?? raw.detail ?? '',
impact: raw.impact ?? '',
recommendation: raw.recommendation ?? raw.suggestion ?? '',
suggestion: raw.suggestion ?? raw.recommendation ?? '',
blocking: raw.blocking ?? (raw.severity === 'critical'),
source: raw.source ?? 'llm',
```

You will need to add an `agentDefaultDomain` helper that maps agent name to a sensible default domain:

```ts
function agentDefaultDomain(name: AgentName): ReviewDomain {
  const map: Record<AgentName, ReviewDomain> = {
    'security': 'Security',
    'performance': 'Performance',
    'correctness': 'Correctness',
    'design': 'Architecture Drift',
    'dependencies': 'Dependencies',
    'coverage': 'Testing',
    'testgen': 'Testing',
    'adversarial': 'Adversarial',
    'integration': 'Integration',
    'breaking-change': 'Breaking Change',
    'license': 'License',
    'secrets': 'Secrets',
    'error-handling': 'Error Handling',
    'observability': 'Observability',
    'migration-safety': 'Migration Safety',
    'complexity': 'Complexity'
  }
  return map[name] ?? 'Correctness'
}
```

- [ ] **Step 4: Run typecheck again**

```bash
npm run typecheck
```

Expected: 0 errors (defaults in BaseAgent cover all agents until their prompts are updated).

- [ ] **Step 5: Run full test suite**

```bash
npm test
```

Expected: All tests pass. Some tests may need `domain`, `evidence`, `impact`, `recommendation`, `blocking`, `source` added to fixture data — add them inline.

- [ ] **Step 6: Commit**

```bash
git add src/core/schema.ts src/core/agents/base.ts
git commit -m "feat: extend Finding schema with domain, evidence, impact, recommendation, blocking, source"
```

---

### Task 3: Update agent system prompts to emit new fields

**Files:**
- Modify all 15 agent files in `src/core/agents/`

Each agent's system prompt JSON format spec must request the new fields. The pattern is the same for every agent — update the `Required format:` example in the system prompt to include:

```json
{
  "severity": "critical|high|medium|low",
  "basis": "VERIFIED|INFERRED|SPECULATIVE",
  "confidence": 85,
  "domain": "<ReviewDomain for this agent>",
  "file": "path/to/file",
  "line": 42,
  "lineEnd": 45,
  "title": "Short title under 60 chars",
  "detail": "Detailed explanation",
  "evidence": "The specific code line or pattern that confirms this finding",
  "impact": "What breaks or degrades if this is not fixed",
  "recommendation": "Concrete fix with example code if applicable",
  "blocking": true,
  "source": "llm"
}
```

Do each agent as a separate step:

- [ ] **Step 1: Update security.ts system prompt**

In `src/core/agents/security.ts`, update the output format spec to include the new fields. The domain is `Security`. The `source` for security agent findings is `"llm"` by default (or `"semgrep"` if semgrep was used — for now use `"llm"`).

Add to the format specification:
```
"domain": "Security",
"evidence": "<specific code line or value that proves the issue>",
"impact": "<what attacker can do or what data is at risk>",
"recommendation": "<concrete remediation with example>",
"blocking": <true for critical/high, false for medium/low>,
"source": "llm"
```

- [ ] **Step 2: Update performance.ts system prompt**

Domain: `Performance`. Add same new fields with domain filled in.

- [ ] **Step 3: Update correctness.ts system prompt**

Domain: `Correctness`.

- [ ] **Step 4: Update design.ts system prompt**

Domain: `Architecture Drift`.

- [ ] **Step 5: Update dependencies.ts system prompt**

Domain: `Dependencies`. Note: source may be `"npm-audit"` or `"osv"` for known CVEs — include this in the prompt.

- [ ] **Step 6: Update coverageAnalyst.ts system prompt**

Domain: `Testing`.

- [ ] **Step 7: Update adversarial.ts system prompt**

Domain: `Adversarial`.

- [ ] **Step 8: Update integrationScout.ts system prompt**

Domain: `Integration`.

- [ ] **Step 9: Update breakingChange.ts system prompt**

Domain: `Breaking Change`.

- [ ] **Step 10: Update licenseCompliance.ts system prompt**

Domain: `License`. Note: source may be `"policy"` for license violations.

- [ ] **Step 11: Update errorHandling.ts system prompt**

Domain: `Error Handling`.

- [ ] **Step 12: Update observability.ts system prompt**

Domain: `Observability`.

- [ ] **Step 13: Update migrationSafety.ts system prompt**

Domain: `Migration Safety`.

- [ ] **Step 14: Update secrets.ts system prompt**

Domain: `Secrets`. Note: source may be `"gitleaks"` or `"trufflehog"` if external scanners were used.

- [ ] **Step 15: Update complexity.ts system prompt**

Domain: `Complexity`. Note: source may be `"lizard"` if complexity was measured with lizard.

- [ ] **Step 16: Run typecheck**

```bash
npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 17: Run full test suite**

```bash
npm test
```

Expected: All tests pass. Agent tests checking `agent.systemPrompt` content may need updating if they assert specific wording that changed.

- [ ] **Step 18: Commit**

```bash
git add src/core/agents/
git commit -m "feat: update all 15 agent system prompts to emit domain, evidence, impact, recommendation, blocking, source"
```

---

### Task 4: Update formatters to print new fields

**Files:**
- Modify: `src/cli/formatter.ts`

- [ ] **Step 1: Read current formatter**

```bash
cat src/cli/formatter.ts
```

- [ ] **Step 2: Update formatMarkdown to include new fields**

For each finding in the markdown output, add:

```
**Domain:** {finding.domain}
**Evidence:** {finding.evidence}
**Impact:** {finding.impact}
**Recommendation:** {finding.recommendation}
**Blocking:** {finding.blocking ? 'Yes' : 'No'}
**Basis:** {finding.basis} | **Confidence:** {finding.confidence ?? 70}%
**Source:** {finding.source}
```

Remove or deprecate any `Suggestion:` label — use `Recommendation:` instead.

- [ ] **Step 3: Update formatJson to include all new fields**

Ensure JSON output serializes `domain`, `evidence`, `impact`, `recommendation`, `blocking`, `source`, `lineEnd`. Keep `suggestion` as a deprecated alias in JSON output (set to same value as `recommendation`) for one release.

- [ ] **Step 4: Run existing formatter tests**

```bash
npm test -- tests/unit/mcp/formatter.test.ts
```

Expected: Tests pass (update any that assert the old markdown format).

- [ ] **Step 5: Commit**

```bash
git add src/cli/formatter.ts
git commit -m "feat: update formatters to print domain, evidence, impact, recommendation, blocking, source"
```

---

### Task 5: Create PMB /change-review command

**Files:**
- Create: `.claude/commands/change-review.md` (in PMB repo: `C:\Users\Mizzo\Claude\Personal-Memory-Bank`)
- Create: `templates/claude-commands/change-review.md` (in PMB repo)

- [ ] **Step 1: Create .claude/commands/change-review.md in the PMB repo**

```markdown
---
description: Review the current branch, PR, or diff as a complete change package using 9 review jobs. Optionally delegates to ACR for LLM-backed security and secrets analysis. Always observe-only — never edits files or posts comments unless explicitly asked.
---

# /change-review

Review the current branch, PR, MR, or diff as a complete change package.

## Usage

```
/change-review
/change-review --diff path/to/change.diff
/change-review --base origin/main
/change-review --pr <number>
```

## What it checks (Reviewer 9)

| # | Job | What it checks |
|---|---|---|
| 1 | Scope sanity | Diff size vs stated scope, generated/vendor junk, unrelated files, line-ending churn |
| 2 | Claim mapping | Every stated claim maps to changed files; every major changed file maps to a claim |
| 3 | Seam integrity | Layer boundaries, dependency injection, API/service/data seams, abstraction leaks |
| 4 | Runtime semantics | Defaults, env vars, startup behavior, async/concurrency issues, rollback safety |
| 5 | Test assertion strength | Tests assert behavior, not just types, truthiness, snapshots, or mocks |
| 6 | Claim-to-test coverage | Every behavior claim has a test or explicit waiver |
| 7 | Security | Delegates to `/security-review`. If ACR is available: `ai-review-agent --profile security` |
| 8 | Accessibility | Conditional — only when UI files (.html, .jsx, .tsx, .vue, .svelte, .astro, .css) are touched. Delegates to `/accessibility-review`. |
| 9 | Opposition | Final reviewer challenges overstatements, gaps, false positives, and cross-domain risk |

## Instructions

### Step 1 — Determine review target

Check how the command was invoked:
- No args → use `git diff HEAD` (unstaged + staged vs HEAD) or `git diff origin/main...HEAD` if on a branch
- `--diff <path>` → read diff from file
- `--base <ref>` → `git diff <ref>...HEAD`
- `--pr <number>` → use `gh pr diff <number>` if `gh` is available; otherwise fall back to local diff

### Step 2 — Load plan/spec if available

Check if `docs/plans/` contains an active plan matching the current branch or recent commit messages. If found, load it as context for claim mapping (Job 2). Do not automatically load all plans.

### Step 3 — Run preflight

Run `mb preflight` if available. Note result in coverage footer.

### Step 4 — Check ACR availability

```bash
which ai-review-agent 2>/dev/null && echo "available" || echo "not found"
```

If available, run for security and secrets:
```bash
ai-review-agent --profile security --format json --out /tmp/acr-security.json
```

Parse findings from JSON. Incorporate into Job 7 (Security). If ACR is unavailable:
> ACR not found in PATH. Skipping local LLM swarm. Continuing with PMB-native review.

### Step 5 — Run all 9 review jobs

Execute each job in order. For Job 8 (Accessibility), check if any changed files match UI extensions. If none match, mark as `skipped - no UI files`.

### Step 6 — Compile report

Use this schema for each finding:

```
**Domain:** <Security | Correctness | Performance | Maintainability | Testing | Architecture Drift | Dependencies | Secrets | Migration Safety | License | Observability | Complexity | Integration | Breaking Change | Error Handling | Adversarial>
**Severity:** <critical | high | medium | low>
**Location:** <file>:<line>
**Evidence:** <specific code or quote that confirms the finding>
**Basis:** <VERIFIED | INFERRED | SPECULATIVE>
**Impact:** <what breaks or degrades if not fixed>
**Recommendation:** <concrete fix>
**Blocking:** <Yes | No>
**Confidence:** <0–100>%
```

Group findings by Severity (critical → high → medium → low).

### Step 7 — Coverage footer

End the report with:

```markdown
## Coverage Footer
- Review target: <local diff | branch | PR #N | MR !N>
- Base ref: <ref or unavailable>
- Files changed: <count>
- Plan/spec loaded: <none | path>
- Preflight: <passed | warn | failed | unavailable>
- Security review: <reviewed | skipped>
- Accessibility: <reviewed | skipped - no UI files>
- ACR backend: <used (profile: security) | not installed | disabled>
```

### Step 8 — Stop

Display findings and coverage footer. **Do not edit files.** Do not post PR comments. Do not run fixes. If the user wants to address findings, they will ask in a separate follow-up.
```

- [ ] **Step 2: Copy to templates/claude-commands/**

```bash
# In the PMB repo
cp .claude/commands/change-review.md templates/claude-commands/change-review.md
```

- [ ] **Step 3: Verify the file**

```bash
head -10 .claude/commands/change-review.md
head -10 templates/claude-commands/change-review.md
```

Expected: Both files have the frontmatter description.

- [ ] **Step 4: Commit (in PMB repo)**

```bash
cd C:\Users\Mizzo\Claude\Personal-Memory-Bank
git add .claude/commands/change-review.md templates/claude-commands/change-review.md
git commit -m "feat: add /change-review command — 9-job change package review with ACR bridge"
```

---

### Task 6: Final verification — ACR

- [ ] **Step 1: Run full ACR test suite**

```bash
cd C:\Users\Mizzo\Claude\AI-Code-Review-Agent
npm test
```

Expected: All tests pass.

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 3: Build**

```bash
npm run build
```

Expected: Clean build.

- [ ] **Step 4: Smoke test --profile**

```bash
node dist/cli/index.js --profile change-review --help
node dist/cli/index.js --profile invalid-name 2>&1
```

Expected: First command shows help with change-review agents listed. Second prints "Unknown profile" with valid options.

- [ ] **Step 5: Verify JSON output includes new fields**

Create a minimal test diff and run in JSON mode:

```bash
echo 'diff --git a/x.ts b/x.ts
--- a/x.ts
+++ b/x.ts
@@ -1 +1 @@
-old
+new' > /tmp/test.diff

node dist/cli/index.js --diff /tmp/test.diff --format json --agents security 2>/dev/null | \
  node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log(Object.keys(d.findings[0] ?? {}))"
```

Expected: Output includes `domain`, `evidence`, `impact`, `recommendation`, `blocking`, `source` (or empty findings array if no issues found).

- [ ] **Step 6: Commit any remaining ACR changes**

```bash
git add -A
git commit -m "feat: ACR+PMB integration complete — profiles, schema, formatter, /change-review"
```

---

### Task 7: Final verification — PMB

- [ ] **Step 1: Verify /change-review exists in PMB**

```bash
cd C:\Users\Mizzo\Claude\Personal-Memory-Bank
ls .claude/commands/change-review.md
ls templates/claude-commands/change-review.md
```

Expected: Both files exist.

- [ ] **Step 2: Verify /change-review is picked up by mb init**

```bash
grep -n "change-review" scripts/mb.sh scripts/init-memory-bank.sh 2>/dev/null || true
```

The template copy happens automatically because `mb init` copies all files from `templates/claude-commands/`. No further changes needed.

- [ ] **Step 3: Verify graceful ACR degradation message is in the command**

```bash
grep "not found in PATH\|not installed" .claude/commands/change-review.md
```

Expected: Degradation message is present.

- [ ] **Step 4: Final PMB commit**

```bash
git status
git add -A
git commit -m "chore: verify /change-review distributed via mb init"
```
