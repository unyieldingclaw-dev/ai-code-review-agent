// tests/unit/adapters/github.test.ts
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

describe('upsertPRComment', () => {
  const TOKEN = 'ghp_test123'
  const OWNER = 'testowner'
  const REPO = 'testrepo'
  const PR = 42

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
    vi.stubGlobal('fetch', undefined)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('creates a new comment when no existing comment matches COMMENT_MARKER', async () => {
    const fetchMock = mockFetch(
      { ok: true, status: 200, json: async () => [] },
      { ok: true, status: 201 }
    )
    vi.stubGlobal('fetch', fetchMock)

    await upsertPRComment(TOKEN, OWNER, REPO, PR, 'Hello world')

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [postUrl, postOpts] = fetchMock.mock.calls[1]
    expect(postUrl).toContain(`/issues/${PR}/comments`)
    expect(postOpts.method).toBe('POST')
    const body = JSON.parse(postOpts.body)
    expect(body.body).toContain(COMMENT_MARKER)
    expect(body.body).toContain('Hello world')
  })

  it('patches existing comment when COMMENT_MARKER is found', async () => {
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
    const [patchUrl, patchOpts] = fetchMock.mock.calls[1]
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

    const [, postOpts] = fetchMock.mock.calls[1]
    const body = JSON.parse(postOpts.body)
    expect(body.body.startsWith(COMMENT_MARKER)).toBe(true)
  })

  it('throws when list comments call fails', async () => {
    const fetchMock = mockFetch({ ok: false, status: 403 })
    vi.stubGlobal('fetch', fetchMock)

    await expect(upsertPRComment(TOKEN, OWNER, REPO, PR, 'body')).rejects.toThrow('403')
  })

  it('throws when create comment call fails', async () => {
    const fetchMock = mockFetch(
      { ok: true, status: 200, json: async () => [] },
      { ok: false, status: 422 }
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(upsertPRComment(TOKEN, OWNER, REPO, PR, 'body')).rejects.toThrow('422')
  })

  it('throws when update comment call fails', async () => {
    const fetchMock = mockFetch(
      { ok: true, status: 200, json: async () => [{ id: 99, body: COMMENT_MARKER }] },
      { ok: false, status: 500 }
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(upsertPRComment(TOKEN, OWNER, REPO, PR, 'body')).rejects.toThrow('500')
  })

  it('sends correct Authorization header', async () => {
    const fetchMock = mockFetch(
      { ok: true, status: 200, json: async () => [] },
      { ok: true, status: 201 }
    )
    vi.stubGlobal('fetch', fetchMock)

    await upsertPRComment('my-secret-token', OWNER, REPO, PR, 'body')

    const [, listOpts] = fetchMock.mock.calls[0]
    expect(listOpts.headers.Authorization).toBe('Bearer my-secret-token')
  })
})
