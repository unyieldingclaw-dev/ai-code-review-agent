# Track 2 — Test Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add tests for the GitHub adapter (zero coverage today) and remove incorrect coverage exclusions from vitest config so metrics accurately reflect what's tested.

**Architecture:** New test file `tests/unit/adapters/github.test.ts` using `vi.stubGlobal` to mock `fetch`. No production code changes. Vitest config change removes two exclusion lines.

**Tech Stack:** TypeScript 5, Vitest, `vi.stubGlobal` for fetch mocking

---

## File Map

| Operation | File                                                  |
| --------- | ----------------------------------------------------- |
| Create    | `tests/unit/adapters/github.test.ts`                  |
| Modify    | `vitest.config.ts:12-14` — remove coverage exclusions |

---

### Task 1: Create GitHub adapter tests — buildStepSummary

**Files:**

- Create: `tests/unit/adapters/github.test.ts`

`buildStepSummary` is a pure function — no mocking needed.

- [ ] **Step 1: Create the test file with buildStepSummary tests**

```ts
// tests/unit/adapters/github.test.ts
// Unit tests for src/adapters/github.ts
// upsertPRComment uses vi.stubGlobal('fetch') to avoid real HTTP calls.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { buildStepSummary, upsertPRComment, COMMENT_MARKER } from '../../../src/adapters/github.js'
import type { ReviewResult, Finding } from '../../../src/core/schema.js'

function makeResult(findings: Partial<Finding>[] = []): ReviewResult {
  return {
    findings: findings.map((f, i) => ({
      id: `security-${i}`,
      agent: 'security',
      domain: 'Security',
      severity: 'high',
      basis: 'VERIFIED',
      file: 'src/auth.ts',
      line: 10,
      title: 'Test finding',
      detail: 'Detail',
      evidence: 'evidence',
      impact: 'impact',
      recommendation: 'Fix it',
      suggestion: 'Fix it',
      blocking: true,
      source: 'llm' as const,
      confidence: 80,
      ...f,
    })),
    testFiles: [],
    summary: {
      totalFindings: findings.length,
      bySeverity: {},
      byAgent: {},
      durationMs: 1234,
    },
  }
}

describe('buildStepSummary', () => {
  it('renders No findings row when findings is empty', () => {
    const result = buildStepSummary(makeResult([]))
    expect(result).toContain('No findings')
    expect(result).toContain('0 findings')
    expect(result).toContain('1234ms')
  })

  it('renders one row per finding with correct columns', () => {
    const result = buildStepSummary(
      makeResult([
        {
          severity: 'critical',
          agent: 'security',
          file: 'src/a.ts',
          line: 42,
          title: 'SQL injection',
          basis: 'VERIFIED',
        },
      ])
    )
    expect(result).toContain('critical')
    expect(result).toContain('security')
    expect(result).toContain('src/a.ts:42')
    expect(result).toContain('SQL injection')
    expect(result).toContain('VERIFIED')
  })

  it('renders all findings when multiple are present', () => {
    const result = buildStepSummary(
      makeResult([
        { title: 'Finding A', severity: 'high' },
        { title: 'Finding B', severity: 'medium' },
      ])
    )
    expect(result).toContain('Finding A')
    expect(result).toContain('Finding B')
    expect(result).toContain('2 findings')
  })

  it('includes summary header', () => {
    const result = buildStepSummary(makeResult([]))
    expect(result).toContain('## AI Review Summary')
    expect(result).toContain('| Severity | Agent | Location | Issue | Basis |')
  })

  it('shows correct duration', () => {
    const result = buildStepSummary({
      ...makeResult([]),
      summary: { totalFindings: 0, bySeverity: {}, byAgent: {}, durationMs: 5678 },
    })
    expect(result).toContain('5678ms')
  })
})
```

- [ ] **Step 2: Run to confirm they pass**

```bash
cd "C:\Users\Mizzo\Claude\AI-Code-Review-Agent"
npm test -- tests/unit/adapters/github.test.ts
```

Expected: All 5 PASS — `buildStepSummary` is pure, no mocking needed.

- [ ] **Step 3: Commit**

```bash
cd "C:\Users\Mizzo\Claude\AI-Code-Review-Agent"
git add tests/unit/adapters/github.test.ts
git commit -m "test: add buildStepSummary tests for GitHub adapter"
```

---

### Task 2: Add upsertPRComment tests with mocked fetch

**Files:**

- Modify: `tests/unit/adapters/github.test.ts`

- [ ] **Step 1: Add upsertPRComment tests to the existing test file**

Append these describes after the `buildStepSummary` describe block:

```ts
describe('upsertPRComment', () => {
  const TOKEN = 'ghp_test123'
  const OWNER = 'testowner'
  const REPO = 'testrepo'
  const PR = 42

  // Helper: build a mock fetch that returns different responses for each call
  function mockFetch(
    ...responses: Array<{ ok: boolean; status?: number; json?: () => Promise<unknown> }>
  ) {
    let call = 0
    return vi.fn().mockImplementation(() => {
      const r = responses[call++] ?? { ok: true, status: 200, json: async () => [] }
      return Promise.resolve({
        ok: r.ok,
        status: r.status ?? (r.ok ? 200 : 422),
        json: r.json ?? (async () => ({})),
      })
    })
  }

  beforeEach(() => {
    vi.stubGlobal('fetch', undefined) // reset before each test
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('creates a new comment when no existing comment matches COMMENT_MARKER', async () => {
    // Call 1: list comments → empty array (no existing bot comment)
    // Call 2: POST new comment → 201 ok
    const fetchMock = mockFetch(
      { ok: true, status: 200, json: async () => [] },
      { ok: true, status: 201 }
    )
    vi.stubGlobal('fetch', fetchMock)

    await upsertPRComment(TOKEN, OWNER, REPO, PR, 'Hello world')

    expect(fetchMock).toHaveBeenCalledTimes(2)
    // Second call should be a POST
    const [, postUrl, postOpts] = fetchMock.mock.calls[1]
    expect(postUrl).toContain(`/issues/${PR}/comments`)
    expect(postOpts.method).toBe('POST')
    const body = JSON.parse(postOpts.body)
    expect(body.body).toContain(COMMENT_MARKER)
    expect(body.body).toContain('Hello world')
  })

  it('patches existing comment when COMMENT_MARKER is found', async () => {
    // Call 1: list comments → one existing bot comment
    // Call 2: PATCH existing comment → 200 ok
    const fetchMock = mockFetch(
      {
        ok: true,
        status: 200,
        json: async () => [{ id: 99, body: `${COMMENT_MARKER}\nOld content` }],
      },
      { ok: true, status: 200 }
    )
    vi.stubGlobal('fetch', fetchMock)

    await upsertPRComment(TOKEN, OWNER, REPO, PR, 'New content')

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [, patchUrl, patchOpts] = fetchMock.mock.calls[1]
    expect(patchUrl).toContain('/comments/99')
    expect(patchOpts.method).toBe('PATCH')
    const body = JSON.parse(patchOpts.body)
    expect(body.body).toContain('New content')
    expect(body.body).toContain(COMMENT_MARKER)
  })

  it('always prepends COMMENT_MARKER to the body', async () => {
    const fetchMock = mockFetch(
      { ok: true, status: 200, json: async () => [] },
      { ok: true, status: 201 }
    )
    vi.stubGlobal('fetch', fetchMock)

    await upsertPRComment(TOKEN, OWNER, REPO, PR, 'My body content')

    const [, , postOpts] = fetchMock.mock.calls[1]
    const body = JSON.parse(postOpts.body)
    expect(body.body.startsWith(COMMENT_MARKER)).toBe(true)
  })

  it('throws when list comments call fails', async () => {
    const fetchMock = mockFetch({ ok: false, status: 403 })
    vi.stubGlobal('fetch', fetchMock)

    await expect(upsertPRComment(TOKEN, OWNER, REPO, PR, 'body')).rejects.toThrow(
      'list comments failed: 403'
    )
  })

  it('throws when create comment call fails', async () => {
    const fetchMock = mockFetch(
      { ok: true, status: 200, json: async () => [] },
      { ok: false, status: 422 }
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(upsertPRComment(TOKEN, OWNER, REPO, PR, 'body')).rejects.toThrow(
      'create comment failed: 422'
    )
  })

  it('throws when update comment call fails', async () => {
    const fetchMock = mockFetch(
      { ok: true, status: 200, json: async () => [{ id: 99, body: COMMENT_MARKER }] },
      { ok: false, status: 500 }
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(upsertPRComment(TOKEN, OWNER, REPO, PR, 'body')).rejects.toThrow(
      'update comment failed: 500'
    )
  })

  it('sends correct Authorization header', async () => {
    const fetchMock = mockFetch(
      { ok: true, status: 200, json: async () => [] },
      { ok: true, status: 201 }
    )
    vi.stubGlobal('fetch', fetchMock)

    await upsertPRComment('my-secret-token', OWNER, REPO, PR, 'body')

    const [, , listOpts] = fetchMock.mock.calls[0]
    expect(listOpts.headers.Authorization).toBe('Bearer my-secret-token')
  })
})
```

- [ ] **Step 2: Run all adapter tests**

```bash
cd "C:\Users\Mizzo\Claude\AI-Code-Review-Agent"
npm test -- tests/unit/adapters/github.test.ts
```

Expected: All 12 tests PASS.

- [ ] **Step 3: Commit**

```bash
cd "C:\Users\Mizzo\Claude\AI-Code-Review-Agent"
git add tests/unit/adapters/github.test.ts
git commit -m "test: add upsertPRComment tests with mocked fetch for GitHub adapter"
```

---

### Task 3: Remove coverage exclusions from vitest.config.ts

**Files:**

- Modify: `vitest.config.ts`

- [ ] **Step 1: Update vitest.config.ts**

Current content of `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    exclude: ['**/node_modules/**', 'vscode-extension/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json'],
      include: ['src/**/*.ts'],
      exclude: ['src/cli/**', 'src/adapters/**'], // ← REMOVE these two entries
    },
  },
})
```

Remove the `exclude` array from the `coverage` block entirely (the `include: ['src/**/*.ts']` already covers everything correctly):

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    exclude: ['**/node_modules/**', 'vscode-extension/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json'],
      include: ['src/**/*.ts'],
    },
  },
})
```

- [ ] **Step 2: Run tests to confirm nothing broke**

```bash
cd "C:\Users\Mizzo\Claude\AI-Code-Review-Agent"
npm test 2>&1 | tail -5
```

Expected: All 248 tests pass (236 original + 12 new adapter tests).

- [ ] **Step 3: Verify coverage now includes cli and adapters**

```bash
cd "C:\Users\Mizzo\Claude\AI-Code-Review-Agent"
npm run test:coverage 2>&1 | grep -E "src/cli|src/adapters|All files"
```

Expected: `src/cli/` and `src/adapters/` now appear in coverage output.

- [ ] **Step 4: Commit**

```bash
cd "C:\Users\Mizzo\Claude\AI-Code-Review-Agent"
git add vitest.config.ts
git commit -m "fix: remove src/cli and src/adapters from vitest coverage exclusions"
```

---

### Task 4: Final verification and push

- [ ] **Step 1: Run full check**

```bash
cd "C:\Users\Mizzo\Claude\AI-Code-Review-Agent"
npm run check 2>&1 | tail -8
```

Expected: All tests pass, 0 TypeScript errors, clean build, Prettier clean.

- [ ] **Step 2: Push**

```bash
cd "C:\Users\Mizzo\Claude\AI-Code-Review-Agent"
git push origin main
```
