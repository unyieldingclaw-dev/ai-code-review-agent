# Round 3 Pre-Production Audit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close 5 deferred high-priority issues from Round 2, verify all Round 2 fixes held, and produce a Round 3 confirmation report.

**Architecture:** Phase 1 — Task 1 (regression read-only) and Task 2 (PMB code fixes) run in PARALLEL. Phase 2 — Tasks 3, 4, 5 run SEQUENTIALLY (all write to ACR, different files). Phase 3 — Task 6 verifies everything and writes the report.

**Tech Stack:** TypeScript/vitest (ACR), Bash/PowerShell (PMB), Node.js child_process (vscode-extension).

---

## Repositories

- **PMB:** `C:\Users\Mizzo\Claude\Personal-Memory-Bank`
- **ACR:** `C:\Users\Mizzo\Claude\AI-Code-Review-Agent`

## Output Paths

- Staging: `docs/audit/staging/r3-agent-N-*.md`
- Report: `docs/audit/2026-06-26-round3-audit-report.md`

## Finding Format

```markdown
### Finding: [Short title]

- **Tag:** [REGRESSION] | [FIXED] | [NEW]
- **Severity:** Critical | High | Medium | Low | Advisory
- **Confidence:** Verified | Strong Evidence | Likely | Speculative
- **Repository:** PMB | ACR | Both
- **Evidence:** [path:line or command output]
- **Reproduction:** [steps]
- **Root Cause:** [why]
- **Fix:** [actionable] (or "Fixed in this round — commit <SHA>")
- **Impact:** [what improves]
- **Effort:** XS | S | M | L | XL
```

---

## Task 0: Pre-Audit Setup

**Files:**

- Create: `docs/audit/staging/r3-agent-1-regression.md`
- Create: `docs/audit/staging/r3-agent-2-pmb-fixes.md`
- Create: `docs/audit/staging/r3-agent-3-baseagent-srp.md`
- Create: `docs/audit/staging/r3-agent-4-semantic-tests.md`
- Create: `docs/audit/staging/r3-agent-5-extension-timeout.md`

- [ ] **Step 1: Create staging files**

```bash
mkdir -p "C:/Users/Mizzo/Claude/AI-Code-Review-Agent/docs/audit/staging"
for f in r3-agent-1-regression r3-agent-2-pmb-fixes r3-agent-3-baseagent-srp r3-agent-4-semantic-tests r3-agent-5-extension-timeout; do
  echo "# $f — IN PROGRESS" > "C:/Users/Mizzo/Claude/AI-Code-Review-Agent/docs/audit/staging/$f.md"
done
```

Expected: 5 files created.

- [ ] **Step 2: Verify baseline**

```bash
cd "C:/Users/Mizzo/Claude/AI-Code-Review-Agent" && npm run check 2>&1 | tail -3 && npm test 2>&1 | grep "Tests "
```

Expected: check passes, Tests 284 passed.

- [ ] **Step 3: Commit**

```bash
cd "C:/Users/Mizzo/Claude/AI-Code-Review-Agent"
git add docs/audit/staging/r3-agent-*.md
git commit -m "chore: scaffold Round 3 audit staging files"
```

---

## Task 1: Agent 1 — Regression Inspector

> **Read-only. Dispatch in parallel with Task 2. Scope: both repos.**

**Files to read:**

- `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\src\core\llm\ollamaProvider.ts`
- `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\src\core\agents\base.ts`
- `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\src\mcp\server.ts`
- `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\.github\workflows\release.yml`
- `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\.github\dependabot.yml`
- `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\docs\HOOKS-GUIDE.md`
- `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\docs\CONTRACTS-GUIDE.md`
- `C:\Users\Mizzo\Claude\Personal-Memory-Bank\scripts\check-contract.sh`
- `C:\Users\Mizzo\Claude\Personal-Memory-Bank\scripts\check-contract.ps1`
- `C:\Users\Mizzo\Claude\Personal-Memory-Bank\.github\workflows\pmb-health.yml`

**Output file:** `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\docs\audit\staging\r3-agent-1-regression.md`

- [ ] **Step 1: Run full check suite**

```bash
cd "C:/Users/Mizzo/Claude/AI-Code-Review-Agent" && npm run check 2>&1
```

Pass = no finding. Any `[warn]` line = Critical/[REGRESSION].

- [ ] **Step 2: Run test suite**

```bash
cd "C:/Users/Mizzo/Claude/AI-Code-Review-Agent" && npm test 2>&1 | grep "Tests "
```

Must be ≥284. Lower count = Critical/[REGRESSION].

- [ ] **Step 3: Verify OllamaProvider — 0.0.0.0 removed, scheme check present, try/catch present**

Read `src/core/llm/ollamaProvider.ts`. Verify:

- Allowlist is `['localhost', '127.0.0.1', '::1']` (NOT `'0.0.0.0'`)
- `parsed.protocol !== 'http:' && parsed.protocol !== 'https:'` check present before hostname check
- `new URL(baseUrl)` wrapped in try/catch with helpful error message

- [ ] **Step 4: Verify base.ts validateFindings accepts evidence OR basis**

Read `src/core/agents/base.ts`. Find the filter condition in `validateFindings`. Verify it contains:
`(typeof f.basis === 'string' || typeof f.evidence === 'string')`
NOT just `typeof f.basis === 'string'`.

Also verify dropped-item log is present.

- [ ] **Step 5: Verify MCP server shutdown handlers**

Read `src/mcp/server.ts`. Verify all four handlers are present after `server.connect(transport)`:
`process.on('SIGTERM', shutdown)`, `process.on('SIGINT', shutdown)`, `process.stdin.on('end', shutdown)`, `process.stdin.on('close', shutdown)`.

- [ ] **Step 6: Verify gitleaks is SHA-pinned**

Read `.github/workflows/release.yml`. Find the gitleaks step. Verify it uses a 40-char SHA, NOT `@v2`.

- [ ] **Step 7: Verify dependabot.yml exists and covers github-actions**

Read `.github/dependabot.yml`. Verify `package-ecosystem: 'github-actions'` is present.

- [ ] **Step 8: Verify extension test step has timeout-minutes**

Read `release.yml`. Find `VS Code extension tests` step. Verify `timeout-minutes: 5` is present.

- [ ] **Step 9: Verify HOOKS-GUIDE.md says warns not blocks**

Read `docs/HOOKS-GUIDE.md`. Find PreCompact section. Verify it does NOT say "Exits 2 — compaction is blocked." Should say warns/proceeds.

- [ ] **Step 10: Verify check-contract empty-scope guard**

Read `scripts/check-contract.sh`. After `SCOPE_FILES=` line, verify early-exit guard exists for empty scope.
Read `scripts/check-contract.ps1`. Verify null/empty guard before foreach loop.

- [ ] **Step 11: Verify PMB PSScriptAnalyzer Warning severity**

Read `.github/workflows/pmb-health.yml`. Find PSScriptAnalyzer invocation. Verify `-Severity Error,Warning` (not just `-Severity Error`).

- [ ] **Step 12: Run PMB test suite**

```bash
cd "C:/Users/Mizzo/Claude/Personal-Memory-Bank" && bash tests/run.sh 2>&1 | tail -5
```

Must exit 0.

- [ ] **Step 13: Write findings to staging file**

Write `docs/audit/staging/r3-agent-1-regression.md`. Include null-result line for each passing check.

---

## Task 2: Agent 2 — PMB Deep Fixes

> **Writes to PMB only. Dispatch in parallel with Task 1.**

**Files to modify:**

- Modify: `C:\Users\Mizzo\Claude\Personal-Memory-Bank\scripts\mb.sh` (check 5 grep fix)
- Modify: `C:\Users\Mizzo\Claude\Personal-Memory-Bank\tests\test-mb-doctor.sh` (isolation fix)

**Output file:** `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\docs\audit\staging\r3-agent-2-pmb-fixes.md`

---

### Fix 1: Doctor check 5 grep -c bug

- [ ] **Step 1: Read the current check 5 implementation**

Read `C:\Users\Mizzo\Claude\Personal-Memory-Bank\scripts\mb.sh` lines 665–676.

The bug: `grep -c "PATTERN" file 2>/dev/null || echo 0` captures both grep's "0" output AND the echo "0" when grep finds no matches (grep exits 1 → `||` fires), producing `"0\n0"` in the variable, which breaks integer comparison.

- [ ] **Step 2: Fix check 5 to use grep -q**

Find these two lines in `mb.sh` (around line 668–669):

```bash
        LOCAL_HAS=$(grep -c "CLAUDE_AUTOCOMPACT_PCT_OVERRIDE" "CLAUDE.md" 2>/dev/null || echo 0)
        GLOBAL_HAS=$(grep -c "CLAUDE_AUTOCOMPACT_PCT_OVERRIDE" "$GLOBAL_CLAUDE" 2>/dev/null || echo 0)
```

Replace with:

```bash
        LOCAL_HAS=0; grep -q "CLAUDE_AUTOCOMPACT_PCT_OVERRIDE" "CLAUDE.md" 2>/dev/null && LOCAL_HAS=1 || true
        GLOBAL_HAS=0; grep -q "CLAUDE_AUTOCOMPACT_PCT_OVERRIDE" "$GLOBAL_CLAUDE" 2>/dev/null && GLOBAL_HAS=1 || true
```

`grep -q` exits 0 (found) or 1 (not found), never produces stdout. The `&& LOCAL_HAS=1` only fires on exit 0. The `|| true` ensures the line always succeeds.

- [ ] **Step 3: Verify check 5 runs without SKIP**

```bash
cd "C:/Users/Mizzo/Claude/Personal-Memory-Bank" && bash scripts/mb.sh doctor 2>&1 | grep -A2 "Token Budget\|check 5\|SKIP"
```

Expected: check 5 shows `[OK]` or `[WARN]`, never `[SKIP]`.

---

### Fix 2: test-mb-doctor.sh repo mutation

- [ ] **Step 4: Read the current test-mb-doctor.sh mutation sites**

Read `C:\Users\Mizzo\Claude\Personal-Memory-Bank\tests\test-mb-doctor.sh`. Identify every test that:

- Renames a directory in `$REPO_ROOT` (e.g., `mv "$REPO_ROOT/templates/memory-bank" ...`)
- Creates files directly under `$REPO_ROOT`
- Modifies `$REPO_ROOT/standards/` or `$REPO_ROOT/fixtures/`

Note: legitimate uses of a temp dir (already using `mktemp -d`) do not need fixing — only direct mutations of the real repo root.

- [ ] **Step 5: Fix mutation sites — use temp copies**

For each mutation site found in Step 4, apply this pattern:

**Before (mutates real repo):**

```bash
mv "$REPO_ROOT/templates/memory-bank" "$REPO_ROOT/templates/memory-bank.bak"
# ... run check ...
mv "$REPO_ROOT/templates/memory-bank.bak" "$REPO_ROOT/templates/memory-bank"
```

**After (uses temp copy):**

```bash
local TMPCHECK
TMPCHECK=$(mktemp -d)
cp -r "$REPO_ROOT/templates/memory-bank" "$TMPCHECK/memory-bank"
# ... run check against TMPCHECK ...
rm -rf "$TMPCHECK"
```

For checks that need to simulate a MISSING directory (to trigger a doctor warning):

```bash
local TMPCHECK
TMPCHECK=$(mktemp -d)
cp -r "$REPO_ROOT" "$TMPCHECK/repo"
rm -rf "$TMPCHECK/repo/templates/memory-bank"
# Run check with $TMPCHECK/repo as the repo root
rm -rf "$TMPCHECK"
```

Note: some doctor checks use `$REPO_ROOT` directly and can't easily be redirected to a temp copy. For those, preserve the backup/restore pattern but add a `trap 'restore_function' EXIT` to ensure cleanup even on crash:

```bash
setup_check_N() {
    mv "$REPO_ROOT/X" "$REPO_ROOT/X.bak"
}
teardown_check_N() {
    [ -d "$REPO_ROOT/X.bak" ] && mv "$REPO_ROOT/X.bak" "$REPO_ROOT/X" || true
}
trap teardown_check_N EXIT
setup_check_N
# ... run check ...
teardown_check_N
trap - EXIT
```

- [ ] **Step 6: Run test suite and verify clean git status**

```bash
cd "C:/Users/Mizzo/Claude/Personal-Memory-Bank"
bash tests/run.sh 2>&1 | tail -10
git status --short
```

Expected: tests pass, `git status` is clean (no modified or untracked files from test mutation).

- [ ] **Step 7: Commit PMB fixes**

```bash
cd "C:/Users/Mizzo/Claude/Personal-Memory-Bank"
git add scripts/mb.sh tests/test-mb-doctor.sh
git commit -m "$(cat <<'EOF'
fix: Round 3 — doctor check 5 grep-c bug + test isolation

- mb.sh check 5: replace grep -c (exits 1 on no-match, produces
  double output 0\n0 in Git Bash) with grep -q + explicit 0/1 assignment.
  Check 5 now correctly shows [OK] or [WARN] instead of SKIP.
- test-mb-doctor.sh: replace in-place repo mutations with temp-dir
  copies + EXIT trap guards. git status is clean after any test run.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 8: Write findings to staging file**

Write `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\docs\audit\staging\r3-agent-2-pmb-fixes.md`:

```markdown
# Agent 2 — PMB Deep Fixes

**Date:** 2026-06-26
**Status:** Complete
**Items closed:** 2 ([FIXED])

### Finding: Doctor check 5 permanently SKIP'd due to grep -c Git Bash bug

- **Tag:** [FIXED]
- **Severity:** Medium
- **Confidence:** Verified
- **Repository:** PMB
- **Evidence:** `scripts/mb.sh:668-669` — `grep -c` exits 1 on no-match in Git Bash; `|| echo 0` fires producing `"0\n0"` string that breaks `[ -eq 0 ]`
- **Reproduction:** Run `mb doctor` in Git Bash with no `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` in CLAUDE.md — check 5 silently skips
- **Root Cause:** `grep -c` exit code 1 triggers `||` even when the command succeeded (found 0 matches)
- **Fix:** Replaced with `grep -q` + explicit `LOCAL_HAS=0/1` assignment — commit <SHA>
- **Impact:** Check 5 now correctly reports [OK] or [WARN]
- **Effort:** XS

### Finding: test-mb-doctor.sh mutates real PMB repo during tests

- **Tag:** [FIXED]
- **Severity:** High
- **Confidence:** Verified
- **Repository:** PMB
- **Evidence:** `tests/test-mb-doctor.sh` — renames real directories in `$REPO_ROOT`; crash mid-test leaves repo broken
- **Reproduction:** Kill `bash tests/run.sh` mid-run; `git status` shows renamed/missing directories
- **Root Cause:** Tests modify the live repo instead of working copies
- **Fix:** Replaced in-place mutations with temp-dir copies + EXIT trap cleanup — commit <SHA>
- **Impact:** `git status` is always clean after any test outcome
- **Effort:** S
```

---

## Task 3: Agent 3 — BaseAgent SRP Refactor

> **Writes to ACR. Run AFTER Tasks 1 and 2 complete.**

**Files:**

- Create: `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\src\core\parsing.ts`
- Modify: `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\src\core\agents\base.ts`
- Modify: `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\tests\unit\baseAgent.test.ts`

**Output file:** `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\docs\audit\staging\r3-agent-3-baseagent-srp.md`

- [ ] **Step 1: Write the new parsing.ts (failing at typecheck — module doesn't exist yet)**

```bash
cd "C:/Users/Mizzo/Claude/AI-Code-Review-Agent" && npm run typecheck 2>&1 | grep "parsing"
```

Expected: no output (file doesn't exist yet, no import references it).

- [ ] **Step 2: Create src/core/parsing.ts**

Create `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\src\core\parsing.ts` with this content:

```typescript
// src/core/parsing.ts
// Finding validation and normalization — extracted from BaseAgent to satisfy SRP.
// Accepts both legacy LLM field names (basis, detail, suggestion) and canonical
// schema names (evidence, description, recommendation).

import type { Finding, AgentName, ReviewDomain } from './schema.js'

function agentDefaultDomain(name: AgentName): ReviewDomain {
  const map: Record<AgentName, ReviewDomain> = {
    security: 'Security',
    performance: 'Performance',
    correctness: 'Correctness',
    design: 'Architecture Drift',
    dependencies: 'Dependencies',
    coverage: 'Testing',
    testgen: 'Testing',
    adversarial: 'Adversarial',
    integration: 'Integration',
    'breaking-change': 'Breaking Change',
    license: 'License',
    secrets: 'Secrets',
    'error-handling': 'Error Handling',
    observability: 'Observability',
    'migration-safety': 'Migration Safety',
    complexity: 'Complexity',
  }
  return map[name] ?? 'Correctness'
}

export function validateAndNormalizeFindings(items: unknown[], agentName: AgentName): Finding[] {
  const valid: Finding[] = []
  let dropped = 0
  for (const f of items as Finding[]) {
    const passes =
      typeof f === 'object' &&
      f !== null &&
      typeof f.severity === 'string' &&
      (typeof f.basis === 'string' || typeof f.evidence === 'string') &&
      typeof f.file === 'string' &&
      typeof f.line === 'number' &&
      typeof f.title === 'string' &&
      typeof f.detail === 'string' &&
      (typeof f.suggestion === 'string' || typeof f.recommendation === 'string')
    if (passes) {
      valid.push(f)
    } else {
      dropped++
    }
  }
  if (dropped > 0) {
    console.error(
      `[${agentName}] validateFindings: dropped ${dropped}/${items.length} item(s) — ` +
        `missing required fields (severity, basis/evidence, file, line, title, detail, suggestion/recommendation)`
    )
  }
  return valid.map((f, i) => {
    const rawConf = typeof f.confidence === 'number' ? f.confidence : 70
    const suggestion = f.suggestion ?? f.recommendation ?? ''
    const recommendation = f.recommendation ?? suggestion
    return {
      ...f,
      id: `${agentName}-${i}`,
      agent: agentName,
      confidence: Math.max(0, Math.min(100, rawConf)),
      domain: f.domain ?? agentDefaultDomain(agentName),
      evidence: f.evidence ?? f.detail ?? '',
      impact: f.impact ?? '',
      recommendation,
      suggestion,
      blocking: f.blocking ?? f.severity === 'critical',
      source: f.source ?? 'llm',
      ...(f.lineEnd !== undefined ? { lineEnd: Math.max(f.line, f.lineEnd) } : {}),
    }
  })
}
```

- [ ] **Step 3: Verify typecheck passes on new file**

```bash
cd "C:/Users/Mizzo/Claude/AI-Code-Review-Agent" && npm run typecheck 2>&1 | tail -5
```

Expected: 0 errors.

- [ ] **Step 4: Update base.ts to delegate to parsing.ts**

Read `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\src\core\agents\base.ts`. Replace the file with this (the `agentDefaultDomain` function and `validateFindings` method move to `parsing.ts`; `base.ts` shrinks):

The `import` at the top of `base.ts` — add:

```typescript
import { validateAndNormalizeFindings } from '../parsing.js'
```

Remove the `agentDefaultDomain` function from `base.ts` (it now lives in `parsing.ts`).

Replace the entire `private validateFindings(items: unknown[]): Finding[]` method with:

```typescript
  private validateFindings(items: unknown[]): Finding[] {
    return validateAndNormalizeFindings(items, this.name)
  }
```

The `stage-1 fall-through log` in `parseFindings` stays in `base.ts` — only the normalisation logic moves.

- [ ] **Step 5: Typecheck after refactor**

```bash
cd "C:/Users/Mizzo/Claude/AI-Code-Review-Agent" && npm run typecheck 2>&1 | tail -5
```

Expected: 0 errors.

- [ ] **Step 6: Run tests — all must pass**

```bash
cd "C:/Users/Mizzo/Claude/AI-Code-Review-Agent" && npm test 2>&1 | tail -6
```

Expected: ≥284 tests passing, 0 failing.

- [ ] **Step 7: Add 3 direct tests for validateAndNormalizeFindings in baseAgent.test.ts**

Read `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\tests\unit\baseAgent.test.ts`. Add these three tests inside the existing `describe` block (or in a new `describe('validateAndNormalizeFindings')` block):

```typescript
import { validateAndNormalizeFindings } from '../../src/core/parsing.js'

describe('validateAndNormalizeFindings', () => {
  const AGENT = 'security' as const

  it('keeps a finding that has evidence (canonical) but no basis (legacy)', () => {
    const item = {
      severity: 'high',
      evidence: 'src/foo.ts:42 — unescaped input',
      file: 'src/foo.ts',
      line: 42,
      title: 'XSS risk',
      detail: 'User input not escaped',
      recommendation: 'Escape before render',
    }
    const result = validateAndNormalizeFindings([item], AGENT)
    expect(result).toHaveLength(1)
    expect(result[0].evidence).toBe('src/foo.ts:42 — unescaped input')
  })

  it('keeps a finding that has basis (legacy) but no evidence (canonical)', () => {
    const item = {
      severity: 'medium',
      basis: 'VERIFIED',
      file: 'src/bar.ts',
      line: 10,
      title: 'Missing null check',
      detail: 'Potential NPE',
      suggestion: 'Add null guard',
    }
    const result = validateAndNormalizeFindings([item], AGENT)
    expect(result).toHaveLength(1)
  })

  it('drops findings missing required fields and logs the count', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const badItem = { severity: 'high' } // missing file, line, title, detail, basis/evidence
    const result = validateAndNormalizeFindings([badItem], AGENT)
    expect(result).toHaveLength(0)
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('dropped 1/1'))
    consoleSpy.mockRestore()
  })
})
```

- [ ] **Step 8: Run tests again to confirm new tests pass**

```bash
cd "C:/Users/Mizzo/Claude/AI-Code-Review-Agent" && npm test 2>&1 | tail -6
```

Expected: ≥287 tests (284 + 3 new) passing.

- [ ] **Step 9: Format**

```bash
cd "C:/Users/Mizzo/Claude/AI-Code-Review-Agent" && npx prettier --write src/core/parsing.ts src/core/agents/base.ts tests/unit/baseAgent.test.ts
```

- [ ] **Step 10: Full check**

```bash
cd "C:/Users/Mizzo/Claude/AI-Code-Review-Agent" && npm run check 2>&1 | tail -4
```

Expected: all pass.

- [ ] **Step 11: Commit**

```bash
cd "C:/Users/Mizzo/Claude/AI-Code-Review-Agent"
git add src/core/parsing.ts src/core/agents/base.ts tests/unit/baseAgent.test.ts
git commit -m "$(cat <<'EOF'
refactor: extract validateAndNormalizeFindings from BaseAgent into parsing.ts

Closes Round 2 deferred item: BaseAgent SRP (19 concerns in one class).
Finding validation, aliasing, and normalization now live in src/core/parsing.ts.
BaseAgent.validateFindings() delegates to validateAndNormalizeFindings().
3 new direct tests for the extracted function. 287+ tests passing.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 12: Write findings to staging file**

Write `docs/audit/staging/r3-agent-3-baseagent-srp.md` confirming the fix and commit SHA.

---

## Task 4: Agent 4 — Semantic Context Tests

> **Writes to ACR. Run AFTER Task 3 commits.**

**Files:**

- Create: `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\tests\unit\embedder.test.ts`
- Modify: `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\tests\unit\contextLoader.test.ts`

**Output file:** `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\docs\audit\staging\r3-agent-4-semantic-tests.md`

- [ ] **Step 1: Read embedder.ts and contextLoader.ts to understand signatures**

Read `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\src\core\embedder.ts`.
Read `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\src\core\contextLoader.ts` lines 113–174 (the semantic path).

Note the exact signatures:

- `embed(ollamaUrl: string, text: string): Promise<number[] | null>`
- `cosineSimilarity(a: number[], b: number[]): number`
- `loadAgentContextSemantic(projectPath: string, diff: string, ollamaUrl: string, budgetChars?: number): Promise<ContextResult>`

- [ ] **Step 2: Create tests/unit/embedder.test.ts**

```typescript
// tests/unit/embedder.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { embed, cosineSimilarity } from '../../src/core/embedder.js'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('embed', () => {
  it('returns embedding array on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ embedding: [0.1, 0.2, 0.3] }),
      })
    )
    const result = await embed('http://localhost:11434', 'test text')
    expect(result).toEqual([0.1, 0.2, 0.3])
  })

  it('returns null when Ollama is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))
    const result = await embed('http://localhost:11434', 'test text')
    expect(result).toBeNull()
  })

  it('returns null when HTTP response is not ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
      })
    )
    const result = await embed('http://localhost:11434', 'test text')
    expect(result).toBeNull()
  })
})

describe('cosineSimilarity', () => {
  it('returns 1.0 for identical vectors', () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1.0)
  })

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0)
  })

  it('returns 0 (not NaN) for zero vector', () => {
    const result = cosineSimilarity([0, 0, 0], [1, 0, 0])
    expect(result).toBe(0)
    expect(Number.isNaN(result)).toBe(false)
  })

  it('returns 0 for mismatched length vectors', () => {
    expect(cosineSimilarity([1, 0], [1, 0, 0])).toBe(0)
  })
})
```

- [ ] **Step 3: Run new tests to verify they pass**

```bash
cd "C:/Users/Mizzo/Claude/AI-Code-Review-Agent" && npx vitest run tests/unit/embedder.test.ts 2>&1 | tail -8
```

Expected: 7 tests pass.

- [ ] **Step 4: Add loadAgentContextSemantic tests to contextLoader.test.ts**

Read `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\tests\unit\contextLoader.test.ts` in full to understand existing structure. Then add this describe block at the end of the file:

```typescript
import { loadAgentContextSemantic } from '../../src/core/contextLoader.js'

// Use vi.mock to intercept fetch for semantic path tests
vi.mock('../../src/core/embedder.js', () => ({
  embed: vi.fn(),
  cosineSimilarity: vi.fn(),
}))

import { embed, cosineSimilarity } from '../../src/core/embedder.js'
const mockEmbed = vi.mocked(embed)
const mockCosine = vi.mocked(cosineSimilarity)

describe('loadAgentContextSemantic', () => {
  it('returns empty context when embed returns null (Ollama unavailable)', async () => {
    mockEmbed.mockResolvedValue(null)
    const result = await loadAgentContextSemantic(
      '/nonexistent',
      'diff content',
      'http://localhost:11434'
    )
    expect(result.content).toBe('')
    expect(result.filesLoaded).toHaveLength(0)
  })

  it('returns empty context when memory-bank/ does not exist', async () => {
    mockEmbed.mockResolvedValue([0.1, 0.2])
    const result = await loadAgentContextSemantic('/nonexistent', 'diff', 'http://localhost:11434')
    expect(result.content).toBe('')
  })

  it('returns ranked files when embeddings succeed', async () => {
    // Set up a real memory-bank in the tmp dir
    setup({
      'projectbrief.md': 'This project uses TypeScript.',
      'techContext.md': 'Node.js 24, vitest.',
    })
    mockEmbed.mockResolvedValue([1, 0])
    // Make cosine similarity return predictable values
    mockCosine.mockReturnValueOnce(0.9).mockReturnValueOnce(0.1)
    const result = await loadAgentContextSemantic(TMP, 'some diff', 'http://localhost:11434')
    // Should have loaded at least one file
    expect(result.filesLoaded.length).toBeGreaterThan(0)
    expect(result.content).toContain('Project Context')
  })
})
```

- [ ] **Step 5: Run all contextLoader tests**

```bash
cd "C:/Users/Mizzo/Claude/AI-Code-Review-Agent" && npx vitest run tests/unit/contextLoader.test.ts 2>&1 | tail -8
```

Expected: all tests pass (existing + new).

- [ ] **Step 6: Run full test suite**

```bash
cd "C:/Users/Mizzo/Claude/AI-Code-Review-Agent" && npm test 2>&1 | tail -6
```

Expected: ≥294 tests passing (287 + 7 new).

- [ ] **Step 7: Format**

```bash
cd "C:/Users/Mizzo/Claude/AI-Code-Review-Agent" && npx prettier --write tests/unit/embedder.test.ts tests/unit/contextLoader.test.ts
```

- [ ] **Step 8: Commit**

```bash
cd "C:/Users/Mizzo/Claude/AI-Code-Review-Agent"
git add tests/unit/embedder.test.ts tests/unit/contextLoader.test.ts
git commit -m "$(cat <<'EOF'
test: add semantic context coverage — embed, cosineSimilarity, loadAgentContextSemantic

Closes Round 2 deferred item: 0% test coverage on semantic context path.
7 new tests for embed() and cosineSimilarity() in embedder.test.ts.
3 new tests for loadAgentContextSemantic() in contextLoader.test.ts.
Covers: success, Ollama-unreachable fallback, zero-vector safety, ranking.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 9: Write findings to staging file**

Write `docs/audit/staging/r3-agent-4-semantic-tests.md` confirming coverage added and commit SHA.

---

## Task 5: Agent 5 — vscode-extension Subprocess Timeout

> **Writes to ACR. Run AFTER Task 4 commits.**

**Files:**

- Modify: `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\vscode-extension\src\runner.ts`
- Modify: `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\vscode-extension\tests\runner.test.ts`

**Output file:** `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\docs\audit\staging\r3-agent-5-extension-timeout.md`

- [ ] **Step 1: Read the current runner.ts and runner.test.ts**

Read `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\vscode-extension\src\runner.ts` in full.
Read `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\vscode-extension\tests\runner.test.ts` lines 1–60.

- [ ] **Step 2: Add wall-clock timeout to spawnCli**

In `vscode-extension/src/runner.ts`, replace the `spawnCli` function with this:

```typescript
const DEFAULT_SUBPROCESS_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes

function spawnCli(
  config: ExtensionConfig,
  workspaceDir: string,
  diffFile: string,
  token: vscode.CancellationToken,
  subprocessTimeoutMs = DEFAULT_SUBPROCESS_TIMEOUT_MS
): Promise<ReviewResult> {
  return new Promise((resolve, reject) => {
    const args = buildCliArgs(config, workspaceDir, diffFile)
    const child = spawn(process.execPath, args, { cwd: workspaceDir })

    // Wall-clock timeout — kills the child and rejects if CLI hangs
    const timeoutHandle = setTimeout(() => {
      child.kill('SIGTERM')
      reject(
        new Error(
          `ai-review-agent timed out after ${Math.round(subprocessTimeoutMs / 1000)}s. ` +
            `Is Ollama running? Try reducing --timeout or agent count.`
        )
      )
    }, subprocessTimeoutMs)

    const cancelDisposable = token.onCancellationRequested(() => {
      clearTimeout(timeoutHandle)
      child.kill()
      reject(new Error('cancelled'))
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    child.on('close', (code: number) => {
      clearTimeout(timeoutHandle)
      cancelDisposable.dispose()

      if (code !== 0) {
        if (stderr.includes('ECONNREFUSED')) {
          reject(new Error(`ollama-unreachable:${config.ollamaUrl}`))
        } else {
          reject(new Error(`cli-error:${stderr.slice(0, 500)}`))
        }
        return
      }

      const jsonStart = stdout.indexOf('{')
      if (jsonStart === -1) {
        reject(new Error(`parse-error:${stdout.slice(0, 200)}`))
        return
      }

      try {
        const result: ReviewResult = JSON.parse(stdout.slice(jsonStart))
        resolve(result)
      } catch {
        reject(new Error(`parse-error:${stdout.slice(jsonStart, jsonStart + 200)}`))
      }
    })
  })
}
```

Also update the call site inside `runReview` to pass `subprocessTimeoutMs` if needed (or keep using the default — the function signature is backward-compatible).

- [ ] **Step 3: Add timeout test to runner.test.ts**

Read `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\vscode-extension\tests\runner.test.ts` for the `makeFakeChild` helper pattern, then add this test:

```typescript
it('rejects with timeout error when process does not close within timeoutMs', async () => {
  // Child that never closes
  const child = makeFakeChild()
  vi.mocked(spawn).mockReturnValue(child as ReturnType<typeof spawn>)
  vi.mocked(execSync).mockReturnValue('diff content\n' as unknown as Buffer)
  vi.mocked(writeFileSync).mockImplementation(() => {})
  vi.mocked(unlinkSync).mockImplementation(() => {})

  // Use vi.useFakeTimers to control setTimeout
  vi.useFakeTimers()
  const promise = runReview(mockConfig, '/workspace', mockToken, 100) // 100ms timeout
  vi.advanceTimersByTime(101)
  vi.useRealTimers()

  await expect(promise).rejects.toThrow('timed out after')
})
```

Note: `runReview` needs to accept an optional `subprocessTimeoutMs` parameter and pass it through to `spawnCli`. Update the `runReview` signature:

```typescript
export async function runReview(
  config: ExtensionConfig,
  workspaceDir: string,
  token: vscode.CancellationToken,
  subprocessTimeoutMs?: number // only used in tests
): Promise<ReviewResult>
```

- [ ] **Step 4: Run extension tests**

```bash
cd "C:/Users/Mizzo/Claude/AI-Code-Review-Agent" && npm run test:extension 2>&1 | tail -8
```

Expected: all tests pass including the new timeout test.

- [ ] **Step 5: Format**

```bash
cd "C:/Users/Mizzo/Claude/AI-Code-Review-Agent" && npx prettier --write vscode-extension/src/runner.ts vscode-extension/tests/runner.test.ts
```

- [ ] **Step 6: Full ACR check**

```bash
cd "C:/Users/Mizzo/Claude/AI-Code-Review-Agent" && npm run check 2>&1 | tail -4
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
cd "C:/Users/Mizzo/Claude/AI-Code-Review-Agent"
git add vscode-extension/src/runner.ts vscode-extension/tests/runner.test.ts
git commit -m "$(cat <<'EOF'
feat(vscode-extension): add wall-clock subprocess timeout to spawnCli

Closes Round 2 deferred item: no subprocess timeout in extension runner.
Default timeout: 5 minutes. If Ollama stalls, the extension now rejects
with a clear message rather than spinning forever. Test covers the timeout
path using vi.useFakeTimers. runReview accepts optional subprocessTimeoutMs
for test control.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 8: Write findings to staging file**

Write `docs/audit/staging/r3-agent-5-extension-timeout.md` confirming the fix and commit SHA.

---

## Task 6: Agent 6 — Verification + Round 3 Report

> **Read-only. Run AFTER all Tasks 1–5 complete.**

**Files to read:**

- All 5 `r3-agent-*.md` staging files
- `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\docs\audit\2026-06-26-round2-audit-report.md` (for comparison)

**Output file:** `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\docs\audit\2026-06-26-round3-audit-report.md`

- [ ] **Step 1: Run final verification suite**

```bash
cd "C:/Users/Mizzo/Claude/AI-Code-Review-Agent" && npm run check 2>&1 | tail -4
```

```bash
cd "C:/Users/Mizzo/Claude/AI-Code-Review-Agent" && npm test 2>&1 | tail -5
```

```bash
cd "C:/Users/Mizzo/Claude/AI-Code-Review-Agent" && npm run test:extension 2>&1 | tail -5
```

```bash
cd "C:/Users/Mizzo/Claude/Personal-Memory-Bank" && bash tests/run.sh 2>&1 | tail -5
```

All must pass.

- [ ] **Step 2: Read all 5 staging files**

Read each staging file. Collect all findings. Separate into:

- `[REGRESSION]` — any Round 2 fix that degraded
- `[FIXED]` — deferred items now closed (expect 5)
- `[NEW]` — net-new issues found while implementing

- [ ] **Step 3: Write the Round 3 report**

Write `docs/audit/2026-06-26-round3-audit-report.md` using the standard 20-section structure. This report is shorter than Rounds 1 and 2 — most sections will say "No findings in this category." Focus on:

- §1: Executive Summary — regression count, 5 items closed, overall trajectory
- §2: Readiness Assessment — how ratings changed vs Round 2
- §3: §3.1 Round 2 Regression Summary table, §3.2 any Critical findings
- §18: Quick Wins — any new XS items found
- §20: Production Readiness Verdict — one blunt paragraph

Report header:

```markdown
# Round 3 Pre-Production Readiness Audit Report

**Date:** 2026-06-26
**Auditor:** Claude Sonnet 4.6 — Hybrid regression+fix audit (Round 3)
**Repositories:** Personal-Memory-Bank | AI-Code-Review-Agent
**Approach:** Regression Verification + Deferred Item Closure
**Total Findings:** [N] ([R] regressions, [F] fixed, [N_new] new)
**Round 2 baseline:** 37 findings (2026-06-26)
**Items closed this round:** 5
```

- [ ] **Step 4: Commit the report**

```bash
cd "C:/Users/Mizzo/Claude/AI-Code-Review-Agent"
git add docs/audit/
git commit -m "docs: add Round 3 pre-production readiness audit report 2026-06-26"
```

---

## Execution Order Summary

```
Phase 1 (PARALLEL):   Task 1 + Task 2
Phase 2 (SEQUENTIAL): Task 3 → Task 4 → Task 5
Phase 3:              Task 6
```

Tasks 1 and 2 have no git overlap (Task 1 is read-only; Task 2 writes to PMB only).
Tasks 3, 4, 5 write to different ACR files but must be sequential to avoid commit conflicts.
Task 6 reads all staging files and both repos — runs last.
