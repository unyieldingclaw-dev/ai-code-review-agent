import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runTool } from '../../src/utils/shell.js'

vi.mock('../../src/utils/shell.js', () => ({
  runTool: vi.fn(),
}))
const mockRunTool = vi.mocked(runTool)

import { readFileSync } from 'fs'
import { SecretsAgent } from '../../src/core/agents/secrets.js'
import { DEFAULT_CONFIG } from '../../src/core/config.js'
import { ParseFailureError } from '../../src/core/parsing.js'
import type { LLMProvider } from '../../src/core/llm/provider.js'

const makeProvider = (response: string): LLMProvider => ({
  chat: vi.fn().mockResolvedValue(response),
  ping: vi.fn().mockResolvedValue({ ok: true }),
})

const FAKE_DIFF = `--- a/src/config.ts
+++ b/src/config.ts
@@ -1,1 +1,3 @@
+const API_KEY = 'sk_live_REPLACE_WITH_REAL_KEY_DO_NOT_COMMIT'
+const SECRET = 'AAAAAAAAAAAAAAAAAAAAAA'`

beforeEach(() => {
  vi.resetAllMocks()
  mockRunTool.mockResolvedValue(null) // default: gitleaks not found, existing tests unaffected
})

describe('SecretsAgent', () => {
  it('has name secrets', () => {
    expect(new SecretsAgent(makeProvider('[]'), DEFAULT_CONFIG).name).toBe('secrets')
  })

  it('uses LLM to analyze the diff', async () => {
    const provider = makeProvider('[]')
    const agent = new SecretsAgent(provider, DEFAULT_CONFIG)
    const findings = await agent.run({ diff: FAKE_DIFF })
    expect(findings).toEqual([])
    expect(provider.chat).toHaveBeenCalled()
  })

  it('parses LLM finding and stamps agent name', async () => {
    const raw = JSON.stringify([
      {
        severity: 'high',
        basis: 'VERIFIED',
        confidence: 90,
        file: 'src/config.ts',
        line: 2,
        title: 'Hardcoded API key',
        detail: 'API key found in source code',
        evidence: "const API_KEY = 'sk_live_REPLACE_WITH_REAL_KEY_DO_NOT_COMMIT'",
        suggestion: 'Move to environment variable',
      },
    ])
    const agent = new SecretsAgent(makeProvider(raw), DEFAULT_CONFIG)
    const findings = await agent.run({ diff: FAKE_DIFF })
    expect(findings).toHaveLength(1)
    expect(findings[0].agent).toBe('secrets')
    expect(findings[0].id).toBe('secrets-0')
  })

  // Real false positive from a live report: the LLM fallback flagged a boolean UI-toggle flag
  // (and, separately, a bare reference to it) as a "hardcoded password" purely because the
  // identifier was named "password" -- neither line has a literal secret value. Deterministic
  // backstop for the systemPrompt's equivalent instruction, which measured no effect on its own.
  const makeFinding = (evidence: string, file = 'src/config.ts') => ({
    severity: 'high',
    basis: 'VERIFIED',
    confidence: 90,
    file,
    line: 2,
    title: 'Hardcoded password',
    detail: 'Hardcoded password value',
    evidence,
    suggestion: 'Move to environment variable',
  })

  it('drops a finding whose evidence assigns a boolean, not a string literal', async () => {
    const raw = JSON.stringify([makeFinding('bool _obscurePassword = true;')])
    const findings = await new SecretsAgent(makeProvider(raw), DEFAULT_CONFIG).run({
      diff: FAKE_DIFF,
    })
    expect(findings).toEqual([])
  })

  it('drops a finding whose evidence is a bare reference, not an assignment', async () => {
    const raw = JSON.stringify([makeFinding('obscureText: _obscurePassword,')])
    const findings = await new SecretsAgent(makeProvider(raw), DEFAULT_CONFIG).run({
      diff: FAKE_DIFF,
    })
    expect(findings).toEqual([])
  })

  it('keeps a finding whose evidence assigns a quoted string literal', async () => {
    const raw = JSON.stringify([makeFinding("password: 'hunter2'")])
    const findings = await new SecretsAgent(makeProvider(raw), DEFAULT_CONFIG).run({
      diff: FAKE_DIFF,
    })
    expect(findings).toHaveLength(1)
  })

  it('keeps a finding whose evidence is an unquoted PEM key block', async () => {
    const raw = JSON.stringify([makeFinding('-----BEGIN RSA PRIVATE KEY-----')])
    const findings = await new SecretsAgent(makeProvider(raw), DEFAULT_CONFIG).run({
      diff: FAKE_DIFF,
    })
    expect(findings).toHaveLength(1)
  })

  it('keeps a finding whose evidence is an unquoted URI with embedded credentials', async () => {
    const raw = JSON.stringify([makeFinding('postgres://admin:hunter2@db.internal:5432/prod')])
    const findings = await new SecretsAgent(makeProvider(raw), DEFAULT_CONFIG).run({
      diff: FAKE_DIFF,
    })
    expect(findings).toHaveLength(1)
  })

  // Regression: the quote regex originally didn't require matching delimiters, so it would
  // cross-match from the closing quote of one short token to the opening quote of an unrelated
  // second token on the same line, misreading two short quoted fragments as one long "literal".
  it('drops a finding whose evidence has two short quoted tokens with different delimiters', async () => {
    const raw = JSON.stringify([makeFinding(`obscureText: 'x', label: "y", password: _flag`)])
    const findings = await new SecretsAgent(makeProvider(raw), DEFAULT_CONFIG).run({
      diff: FAKE_DIFF,
    })
    expect(findings).toEqual([])
  })

  // Regression: config-file formats (YAML, .env, etc.) commonly assign secrets unquoted --
  // requiring quotes universally would have silently dropped exactly the "passwords... in config
  // files" case the systemPrompt itself asks the agent to flag.
  it('keeps a finding whose evidence is an unquoted secret in a YAML config file', async () => {
    const raw = JSON.stringify([makeFinding('webhook_secret: abc123XYZ456', 'config/app.yaml')])
    const findings = await new SecretsAgent(makeProvider(raw), DEFAULT_CONFIG).run({
      diff: FAKE_DIFF,
    })
    expect(findings).toHaveLength(1)
  })

  it('keeps a finding whose evidence is an unquoted secret in a .env file', async () => {
    const raw = JSON.stringify([makeFinding('DB_PASSWORD=hunter2', '.env')])
    const findings = await new SecretsAgent(makeProvider(raw), DEFAULT_CONFIG).run({
      diff: FAKE_DIFF,
    })
    expect(findings).toHaveLength(1)
  })

  it('throws ParseFailureError on LLM parse failure', async () => {
    await expect(
      new SecretsAgent(makeProvider('not json'), DEFAULT_CONFIG).run({ diff: FAKE_DIFF })
    ).rejects.toThrow(ParseFailureError)
  })

  it('system prompt mentions credentials and secrets', () => {
    const agent = new SecretsAgent(makeProvider('[]'), DEFAULT_CONFIG)
    expect(agent.systemPrompt).toMatch(/credential/i)
    expect(agent.systemPrompt).toMatch(/secret/i)
  })

  // Regression for a real false positive: a "password"-named identifier is not itself a
  // finding -- the LLM fallback must check what value is actually assigned to it.
  it('system prompt instructs checking the assigned value, not just the identifier name', () => {
    const agent = new SecretsAgent(makeProvider('[]'), DEFAULT_CONFIG)
    expect(agent.systemPrompt).toMatch(/value.*assigned|assigned.*value/i)
    expect(agent.systemPrompt).toMatch(/boolean|UI-state/i)
  })
})

describe('SecretsAgent gitleaks integration', () => {
  // src/core/config.ts is a real file in this repo -- required so the run() override's
  // existsSync filter doesn't drop it before ever reaching gitleaks.
  const DIFF = `diff --git a/src/core/config.ts b/src/core/config.ts
--- a/src/core/config.ts
+++ b/src/core/config.ts
@@ -1,1 +1,1 @@
-old
+new`

  it('uses gitleaks and never calls the LLM when gitleaks is available', async () => {
    mockRunTool.mockResolvedValue(readFileSync('tests/fixtures/gitleaks-leak-found.json', 'utf-8'))
    const provider = makeProvider('[]')
    const agent = new SecretsAgent(provider, DEFAULT_CONFIG)

    const findings = await agent.run({ diff: DIFF })

    expect(provider.chat).not.toHaveBeenCalled()
    expect(findings).toHaveLength(1)
    expect(findings[0].source).toBe('gitleaks')
    expect(agent.lastToolAvailability).toBe('used')
  })

  // Regression: gitleaks is invoked per file. When it succeeded on some files and produced no
  // output for others (unreadable, locked, or a shape it rejects -- files are existence-filtered
  // first, so absence is already excluded), gitleaksRan was true from the successes alone and the
  // agent reported a COMPLETED secret scan. The file holding an actual credential may be one of
  // the ones silently skipped, so a partial scan must not be presented as a finished one.
  it('does not report a completed scan when gitleaks skipped some files', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const TWO_FILE_DIFF = `diff --git a/src/core/config.ts b/src/core/config.ts
--- a/src/core/config.ts
+++ b/src/core/config.ts
@@ -1,1 +1,1 @@
-old
+new
diff --git a/src/core/schema.ts b/src/core/schema.ts
--- a/src/core/schema.ts
+++ b/src/core/schema.ts
@@ -1,1 +1,1 @@
-old
+new`
    // First file scans clean, second produces no stdout (gitleaks failed on it).
    mockRunTool.mockResolvedValueOnce('[]').mockResolvedValueOnce(null)
    const provider = makeProvider('[]')
    const agent = new SecretsAgent(provider, DEFAULT_CONFIG)

    await agent.run({ diff: TWO_FILE_DIFF })

    expect(agent.lastToolAvailability).toBe('partial')
    expect(provider.chat).toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('falling back to the LLM so they are not left unscanned')
    )
    errorSpy.mockRestore()
  })

  // Also the falsifying counterpart to the 'partial' assertion above: gitleaks produced nothing on
  // ANY file here, so nothing was scanned and 'unavailable-llm-fallback' is the truthful value.
  // If the partial branch were widened to fire whenever any file was skipped, this would fail.
  it('falls back to the LLM when gitleaks is not installed', async () => {
    mockRunTool.mockResolvedValue(null)
    const provider = makeProvider('[]')
    const agent = new SecretsAgent(provider, DEFAULT_CONFIG)

    await agent.run({ diff: DIFF })

    expect(provider.chat).toHaveBeenCalledOnce()
    expect(agent.lastToolAvailability).toBe('unavailable-llm-fallback')
  })

  it('records tool usage as "used" when gitleaks ran, even with zero leaks', async () => {
    mockRunTool.mockResolvedValue('[]')
    const provider = makeProvider('[]')
    const agent = new SecretsAgent(provider, DEFAULT_CONFIG)

    const findings = await agent.run({ diff: DIFF })

    expect(provider.chat).not.toHaveBeenCalled()
    expect(findings).toEqual([])
    expect(agent.lastToolAvailability).toBe('used')
  })

  it('calls gitleaks once per changed file that exists on disk', async () => {
    mockRunTool.mockResolvedValue('[]')
    const provider = makeProvider('[]')
    const agent = new SecretsAgent(provider, DEFAULT_CONFIG)
    // src/core/config.ts is a real file in this repo -- exercises the existsSync filter's
    // true branch without needing a throwaway fixture file on disk.
    const diff = `diff --git a/src/core/config.ts b/src/core/config.ts
--- a/src/core/config.ts
+++ b/src/core/config.ts
@@ -1,1 +1,1 @@
-old
+new`

    await agent.run({ diff })

    expect(mockRunTool).toHaveBeenCalledWith(
      'gitleaks',
      expect.arrayContaining(['detect', '--source', 'src/core/config.ts', '--redact']),
      undefined,
      false,
      '.'
    )
  })

  it('passes projectPath through as cwd, so gitleaks and existsSync resolve against the reviewed project instead of the process cwd', async () => {
    mockRunTool.mockResolvedValue('[]')
    const provider = makeProvider('[]')
    const agent = new SecretsAgent(provider, DEFAULT_CONFIG)

    await agent.run({ diff: DIFF, projectPath: process.cwd() })

    expect(mockRunTool).toHaveBeenCalledWith(
      'gitleaks',
      expect.any(Array),
      undefined,
      false,
      process.cwd()
    )
  })
})
