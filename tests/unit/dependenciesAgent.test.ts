// Unit tests — mock the LLM provider. Ollama is NOT required to run these.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runTool } from '../../src/utils/shell.js'

vi.mock('../../src/utils/shell.js', () => ({
  runTool: vi.fn(),
}))
const mockRunTool = vi.mocked(runTool)

import { readFileSync } from 'fs'
import { DependenciesAgent } from '../../src/core/agents/dependencies.js'
import { DEFAULT_CONFIG } from '../../src/core/config.js'
import { ParseFailureError } from '../../src/core/parsing.js'
import type { LLMProvider } from '../../src/core/llm/provider.js'

const makeProvider = (response: string): LLMProvider => ({
  chat: vi.fn().mockResolvedValue(response),
  ping: vi.fn().mockResolvedValue({ ok: true }),
})

beforeEach(() => {
  vi.resetAllMocks()
  mockRunTool.mockResolvedValue(null) // default: npm audit not run, existing tests unaffected
})

// WHY a real manifest-touching diff, not a bare 'diff' string: DependenciesAgent now skips the
// LLM call entirely whenever the diff doesn't touch package.json/package-lock.json (see the
// agent's run() override) -- these tests need to actually reach the LLM to test its output.
const MANIFEST_DIFF = `diff --git a/package.json b/package.json
--- a/package.json
+++ b/package.json
@@ -1,1 +1,1 @@
-"a":"1"
+"a":"2"`

describe('DependenciesAgent', () => {
  it('has name dependencies', () => {
    expect(new DependenciesAgent(makeProvider('[]'), DEFAULT_CONFIG).name).toBe('dependencies')
  })

  it('returns empty array when provider returns empty JSON array', async () => {
    expect(
      await new DependenciesAgent(makeProvider('[]'), DEFAULT_CONFIG).run({ diff: MANIFEST_DIFF })
    ).toEqual([])
  })

  it('parses a valid finding and stamps agent name', async () => {
    const raw = JSON.stringify([
      {
        severity: 'high',
        basis: 'VERIFIED',
        confidence: 88,
        file: 'package.json',
        line: 12,
        title: 'Vulnerable dependency: lodash < 4.17.21',
        detail: 'Prototype pollution CVE-2021-23337',
        suggestion: 'Upgrade to lodash@4.17.21',
      },
    ])
    const findings = await new DependenciesAgent(makeProvider(raw), DEFAULT_CONFIG).run({
      diff: MANIFEST_DIFF,
    })
    expect(findings).toHaveLength(1)
    expect(findings[0].agent).toBe('dependencies')
    expect(findings[0].id).toBe('dependencies-0')
  })

  it('throws ParseFailureError on parse failure', async () => {
    await expect(
      new DependenciesAgent(makeProvider(''), DEFAULT_CONFIG).run({ diff: MANIFEST_DIFF })
    ).rejects.toThrow(ParseFailureError)
  })

  it('system prompt mentions dependencies or packages', () => {
    const agent = new DependenciesAgent(makeProvider('[]'), DEFAULT_CONFIG)
    expect(agent.systemPrompt).toMatch(/depend|package|npm|vulnerab|CVE/i)
  })
})

describe('DependenciesAgent npm-audit integration', () => {
  const NON_MANIFEST_DIFF = `diff --git a/src/foo.ts b/src/foo.ts
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,1 +1,1 @@
-a
+b`

  it('uses npm audit and never calls the LLM when the diff touches package.json and projectPath is set', async () => {
    mockRunTool.mockResolvedValue(readFileSync('tests/fixtures/npm-audit-sample.json', 'utf-8'))
    const provider = makeProvider('[]')
    const agent = new DependenciesAgent(provider, DEFAULT_CONFIG)

    const findings = await agent.run({ diff: MANIFEST_DIFF, projectPath: '.' })

    expect(provider.chat).not.toHaveBeenCalled()
    expect(findings.length).toBeGreaterThan(0)
    expect(findings.every((f) => f.source === 'npm-audit')).toBe(true)
    expect(agent.lastToolAvailability).toBe('used')
  })

  // Regression: `npm audit --json` prints a JSON error object to stdout and exits non-zero when it
  // cannot reach the registry. runTool ignores exit codes by design, so that object used to arrive
  // as ordinary non-null output -- the agent marked the run 'used' and the parser mapped the
  // unrecognised shape to [], reporting "0 dependency vulnerabilities, verified by npm-audit" from
  // an audit that never ran. Offline operation is this tool's primary use case, so that path is
  // reachable in normal use, not just under failure injection.
  it('treats an npm audit registry failure as tool-unavailable, not as a clean audit', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockRunTool.mockResolvedValue(
      JSON.stringify({
        message:
          'request to https://registry.npmjs.org/-/npm/v1/security/advisories/bulk failed, reason: connect ECONNREFUSED',
        error: { summary: '', detail: '' },
      })
    )
    const provider = makeProvider('[]')
    const agent = new DependenciesAgent(provider, DEFAULT_CONFIG)

    await agent.run({ diff: MANIFEST_DIFF, projectPath: '.' })

    expect(agent.lastToolAvailability).toBe('unavailable-llm-fallback')
    expect(provider.chat).toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  // Guards the other direction: a healthy audit that genuinely found nothing must stay 'used'.
  // Without this, the fix above could push every clean run into the LLM fallback and nothing
  // would fail.
  it('keeps a genuine zero-vulnerability audit on the tool path', async () => {
    mockRunTool.mockResolvedValue('{"auditReportVersion":2,"vulnerabilities":{}}')
    const provider = makeProvider('[]')
    const agent = new DependenciesAgent(provider, DEFAULT_CONFIG)

    const findings = await agent.run({ diff: MANIFEST_DIFF, projectPath: '.' })

    expect(agent.lastToolAvailability).toBe('used')
    expect(provider.chat).not.toHaveBeenCalled()
    expect(findings).toEqual([])
  })

  it('skips the LLM (and npm audit) when the diff does not touch a manifest file, regardless of projectPath', async () => {
    // WHY this changed from "falls back to the LLM": the agent's own prompt already returns []
    // when the diff has no manifest changes, so paying a full LLM call for that guaranteed-empty
    // outcome was pure waste -- see the run() override's WHY comment.
    const provider = makeProvider('[]')
    const agent = new DependenciesAgent(provider, DEFAULT_CONFIG)

    const findings = await agent.run({ diff: NON_MANIFEST_DIFF, projectPath: '.' })

    expect(findings).toEqual([])
    expect(mockRunTool).not.toHaveBeenCalled()
    expect(provider.chat).not.toHaveBeenCalled()
    expect(agent.lastToolAvailability).toBe('not-applicable')
  })

  it('falls back to the LLM with degraded status when manifest changed but projectPath is missing', async () => {
    const provider = makeProvider('[]')
    const agent = new DependenciesAgent(provider, DEFAULT_CONFIG)

    await agent.run({ diff: MANIFEST_DIFF })

    expect(mockRunTool).not.toHaveBeenCalled()
    expect(provider.chat).toHaveBeenCalledOnce()
    expect(agent.lastToolAvailability).toBe('unavailable-llm-fallback')
  })

  it('falls back to the LLM with degraded status when npm audit is unavailable', async () => {
    mockRunTool.mockResolvedValue(null)
    const provider = makeProvider('[]')
    const agent = new DependenciesAgent(provider, DEFAULT_CONFIG)

    await agent.run({ diff: MANIFEST_DIFF, projectPath: '.' })

    expect(provider.chat).toHaveBeenCalledOnce()
    expect(agent.lastToolAvailability).toBe('unavailable-llm-fallback')
  })

  it('passes projectPath through as cwd, so npm audit runs against the reviewed project instead of the process cwd', async () => {
    mockRunTool.mockResolvedValue('{"vulnerabilities":{}}')
    const provider = makeProvider('[]')
    const agent = new DependenciesAgent(provider, DEFAULT_CONFIG)

    await agent.run({ diff: MANIFEST_DIFF, projectPath: '/some/other/project' })

    expect(mockRunTool).toHaveBeenCalledWith(
      'npm',
      ['audit', '--json'],
      undefined,
      true,
      '/some/other/project'
    )
  })

  it('skips the LLM entirely when the diff does not touch a manifest and projectPath has no package.json', async () => {
    const provider = makeProvider('[]')
    const agent = new DependenciesAgent(provider, DEFAULT_CONFIG)

    const findings = await agent.run({ diff: NON_MANIFEST_DIFF, projectPath: '/no/such/project' })

    expect(findings).toEqual([])
    expect(provider.chat).not.toHaveBeenCalled()
    expect(mockRunTool).not.toHaveBeenCalled()
    expect(agent.lastToolAvailability).toBe('not-applicable')
  })

  it('also skips the LLM when the diff does not touch a manifest even though package.json DOES exist (e.g. this repo itself)', async () => {
    // WHY this changed from "still runs the LLM fallback": skipping is correct regardless of
    // whether the project happens to be a Node project -- the agent's own prompt already returns
    // [] for a diff with no manifest changes, so running the LLM for that case was pure waste.
    const provider = makeProvider('[]')
    const agent = new DependenciesAgent(provider, DEFAULT_CONFIG)

    // projectPath: '.' resolves to the real repo root during `npm test`, which has package.json
    const findings = await agent.run({ diff: NON_MANIFEST_DIFF, projectPath: '.' })

    expect(findings).toEqual([])
    expect(provider.chat).not.toHaveBeenCalled()
    expect(agent.lastToolAvailability).toBe('not-applicable')
  })

  it('does NOT skip when touchesManifest is true, even if package.json is not yet on disk (new project)', async () => {
    mockRunTool.mockResolvedValue(null) // npm audit unavailable -- e.g. patch not applied to disk
    const provider = makeProvider('[]')
    const agent = new DependenciesAgent(provider, DEFAULT_CONFIG)

    await agent.run({ diff: MANIFEST_DIFF, projectPath: '/brand/new/project/not/on/disk' })

    // Falls through to the existing touchesManifest branch, not the new skip -- still calls the LLM
    expect(provider.chat).toHaveBeenCalledOnce()
    expect(agent.lastToolAvailability).toBe('unavailable-llm-fallback')
  })
})
