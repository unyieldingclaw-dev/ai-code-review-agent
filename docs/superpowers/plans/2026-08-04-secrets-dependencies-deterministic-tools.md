# Secrets/Dependencies Deterministic-Tool Integration + Hallucination Guardrails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the hallucination class reproduced against `secrets`/`dependencies` by replacing LLM judgment with real deterministic tools (gitleaks, `npm audit`) where available, reduce (not eliminate) the `adversarial` hallucination rate via prompt-tightening, fix a parsing-diagnostics bug that mislabeled non-truncated responses as truncated, and surface degraded (LLM-fallback) mode in the report instead of only logging it.

**Architecture:** `SecretsAgent`/`DependenciesAgent` gain a pre-check in `run()`: if the relevant deterministic tool is available, use it exclusively and skip the LLM call; otherwise fall back to the existing (now prompt-tightened) LLM path. Two new flat modules (`src/core/gitleaksParser.ts`, `src/core/npmAuditParser.ts`) hold the tool-output-to-`Finding[]` mapping, unit-testable against captured real JSON fixtures with no live tool dependency. `runner.ts` collects which path each agent took into a new `ReviewResult.toolAvailability` field, surfaced in markdown/SARIF via the same conditional-spread pattern already used for `hallucinationFilter`/`truncation`/`policy`.

**Tech Stack:** TypeScript, Vitest, gitleaks 8.30.1 (external binary via existing `runTool` subprocess wrapper), `npm audit` (bundled with npm).

**Spec:** `docs/superpowers/specs/2026-08-04-secrets-dependencies-deterministic-tools-design.md`

---

## Task 0: Capture and commit real tool-output fixtures

**Files:**
- Create: `tests/fixtures/gitleaks-clean.json`
- Create: `tests/fixtures/gitleaks-leak-found.json`
- Create: `tests/fixtures/npm-audit-sample.json`

These are real captured tool output (not hand-written), so parser tests exercise the actual shape gitleaks/npm audit produce, not an assumed one.

- [ ] **Step 1: Create the fixtures directory if it doesn't exist**

Run: `mkdir -p tests/fixtures` (no-op if it already exists)

- [ ] **Step 2: Write the clean (no leaks) gitleaks fixture**

Create `tests/fixtures/gitleaks-clean.json`:

```json
[]
```

- [ ] **Step 3: Write the leak-found gitleaks fixture**

Create `tests/fixtures/gitleaks-leak-found.json` (captured this session against a real gitleaks 8.30.1 run with `--redact`, field values are what `--redact` produces — `Match`/`Secret` become the literal string `"REDACTED"`):

```json
[
  {
    "RuleID": "stripe-access-token",
    "Description": "Found a Stripe Access Token, posing a risk to payment processing services and sensitive financial data.",
    "StartLine": 5,
    "EndLine": 5,
    "StartColumn": 28,
    "EndColumn": 79,
    "Match": "REDACTED",
    "Secret": "REDACTED",
    "File": "src/config/database.ts",
    "SymlinkFile": "",
    "Commit": "",
    "Entropy": 5.2410526,
    "Author": "",
    "Email": "",
    "Date": "",
    "Message": "",
    "Tags": [],
    "Fingerprint": "src/config/database.ts:stripe-access-token:5"
  }
]
```

- [ ] **Step 4: Write the npm-audit fixture**

Create `tests/fixtures/npm-audit-sample.json` (trimmed from a real `npm audit --json` run against this repo — includes: a `moderate` entry with full `via` detail, a `moderate` entry whose `via` is just a string reference to another package, a `critical` entry, and a `low` entry to verify the moderate+ floor correctly excludes it):

```json
{
  "auditReportVersion": 2,
  "vulnerabilities": {
    "@hono/node-server": {
      "name": "@hono/node-server",
      "severity": "moderate",
      "isDirect": false,
      "via": [
        {
          "source": 1124006,
          "name": "@hono/node-server",
          "dependency": "@hono/node-server",
          "title": "Node.js Adapter for Hono: Path traversal in `serve-static` on Windows via encoded backslash (`%5C`)",
          "url": "https://github.com/advisories/GHSA-frvp-7c67-39w9",
          "severity": "moderate",
          "cwe": ["CWE-22"],
          "cvss": { "score": 5.9, "vectorString": "CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:N/A:N" },
          "range": "<2.0.5"
        }
      ],
      "effects": ["@modelcontextprotocol/sdk"],
      "range": "<2.0.5",
      "nodes": ["node_modules/@hono/node-server"],
      "fixAvailable": true
    },
    "@modelcontextprotocol/sdk": {
      "name": "@modelcontextprotocol/sdk",
      "severity": "moderate",
      "isDirect": true,
      "via": ["@hono/node-server"],
      "effects": [],
      "range": "1.25.0 - 1.29.0",
      "nodes": ["node_modules/@modelcontextprotocol/sdk"],
      "fixAvailable": true
    },
    "@vitest/coverage-v8": {
      "name": "@vitest/coverage-v8",
      "severity": "critical",
      "isDirect": true,
      "via": ["vitest"],
      "effects": [],
      "range": "<=3.2.5",
      "nodes": ["node_modules/@vitest/coverage-v8"],
      "fixAvailable": { "name": "@vitest/coverage-v8", "version": "4.1.10", "isSemVerMajor": true }
    },
    "body-parser": {
      "name": "body-parser",
      "severity": "low",
      "isDirect": false,
      "via": [
        {
          "source": 1123976,
          "name": "body-parser",
          "dependency": "body-parser",
          "title": "body-parser vulnerable to denial of service when invalid limit value silently disables size enforcement",
          "url": "https://github.com/advisories/GHSA-v422-hmwv-36x6",
          "severity": "low",
          "cwe": ["CWE-770"],
          "cvss": { "score": 3.7, "vectorString": "CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:N/I:N/A:L" },
          "range": ">=2.0.0 <2.3.0"
        }
      ],
      "effects": [],
      "range": "2.0.0 - 2.2.2",
      "nodes": ["node_modules/body-parser"],
      "fixAvailable": true
    }
  },
  "metadata": {
    "vulnerabilities": { "info": 0, "low": 1, "moderate": 6, "high": 5, "critical": 2, "total": 14 },
    "dependencies": { "prod": 156, "dev": 254, "optional": 76, "peer": 0, "peerOptional": 0, "total": 409 }
  }
}
```

- [ ] **Step 5: Commit**

```bash
git add tests/fixtures/gitleaks-clean.json tests/fixtures/gitleaks-leak-found.json tests/fixtures/npm-audit-sample.json
git commit -m "test: add captured real gitleaks/npm-audit output fixtures"
```

---

## Task 1: `gitleaksParser.ts`

**Files:**
- Create: `src/core/gitleaksParser.ts`
- Test: `tests/unit/gitleaksParser.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/gitleaksParser.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { parseGitleaksOutput } from '../../src/core/gitleaksParser.js'

describe('parseGitleaksOutput', () => {
  it('returns an empty array for a clean scan', () => {
    const raw = readFileSync('tests/fixtures/gitleaks-clean.json', 'utf-8')
    const findings = parseGitleaksOutput(raw, 'secrets')
    expect(findings).toEqual([])
  })

  it('maps a real gitleaks leak to a Finding with correct field mapping', () => {
    const raw = readFileSync('tests/fixtures/gitleaks-leak-found.json', 'utf-8')
    const findings = parseGitleaksOutput(raw, 'secrets')
    expect(findings).toHaveLength(1)
    const f = findings[0]
    expect(f.agent).toBe('secrets')
    expect(f.domain).toBe('Secrets')
    expect(f.severity).toBe('high')
    expect(f.basis).toBe('VERIFIED')
    expect(f.source).toBe('gitleaks')
    expect(f.file).toBe('src/config/database.ts')
    expect(f.line).toBe(5)
    expect(f.title).toContain('stripe access token')
    expect(f.detail).toBe(
      'Found a Stripe Access Token, posing a risk to payment processing services and sensitive financial data.'
    )
    expect(f.blocking).toBe(true)
    expect(f.evidence).toBe('REDACTED')
  })

  it('returns an empty array for malformed JSON instead of throwing', () => {
    const findings = parseGitleaksOutput('not json at all', 'secrets')
    expect(findings).toEqual([])
  })

  it('returns an empty array when the parsed JSON is not an array', () => {
    const findings = parseGitleaksOutput('{"unexpected": "shape"}', 'secrets')
    expect(findings).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/gitleaksParser.test.ts --exclude '.claude/worktrees/**'`
Expected: FAIL — `Cannot find module '../../src/core/gitleaksParser.js'`

- [ ] **Step 3: Write the implementation**

Create `src/core/gitleaksParser.ts`:

```typescript
// src/core/gitleaksParser.ts
// Maps gitleaks' `-f json` output (verified against a real gitleaks 8.30.1 run this session) to
// the Finding schema. gitleaks' own output has no severity field -- it only reports things it's
// confident are real secrets in the first place, so every leak defaults to 'high'. Per-rule
// severity tuning (e.g. Critical for private-key/certificate rule categories) is a reasonable
// future refinement, not required here.

import type { AgentName, Finding } from './schema.js'

interface GitleaksLeak {
  RuleID: string
  Description: string
  StartLine: number
  Match: string
  Secret: string
  File: string
}

export function parseGitleaksOutput(json: string, agentName: AgentName): Finding[] {
  let leaks: unknown
  try {
    leaks = JSON.parse(json)
  } catch {
    return []
  }
  if (!Array.isArray(leaks)) return []

  return (leaks as GitleaksLeak[]).map((leak, i) => ({
    id: `${agentName}-gitleaks-${i}`,
    agent: agentName,
    domain: 'Secrets' as const,
    severity: 'high' as const,
    basis: 'VERIFIED' as const,
    file: leak.File,
    line: leak.StartLine,
    title: leak.RuleID.replace(/-/g, ' '),
    detail: leak.Description,
    evidence: leak.Secret,
    impact: 'Credential exposure if leaked via repo history, logs, or a public fork.',
    recommendation:
      'Remove the hardcoded credential and rotate it. Use an environment variable or a secrets manager.',
    suggestion:
      'Remove the hardcoded credential and rotate it. Use an environment variable or a secrets manager.',
    blocking: true,
    source: 'gitleaks' as const,
    confidence: 95,
  }))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/gitleaksParser.test.ts --exclude '.claude/worktrees/**'`
Expected: PASS — 4 tests

- [ ] **Step 5: Commit**

```bash
git add src/core/gitleaksParser.ts tests/unit/gitleaksParser.test.ts
git commit -m "feat: add gitleaksParser to map gitleaks JSON output to Finding[]"
```

---

## Task 2: `npmAuditParser.ts`

**Files:**
- Create: `src/core/npmAuditParser.ts`
- Test: `tests/unit/npmAuditParser.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/npmAuditParser.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { parseNpmAuditOutput } from '../../src/core/npmAuditParser.js'

describe('parseNpmAuditOutput', () => {
  it('maps moderate/high/critical vulnerabilities and drops low/info', () => {
    const raw = readFileSync('tests/fixtures/npm-audit-sample.json', 'utf-8')
    const findings = parseNpmAuditOutput(raw, 'dependencies')
    // Fixture has 4 vulnerabilities: 2 moderate, 1 critical, 1 low. Low must be dropped.
    expect(findings).toHaveLength(3)
    expect(findings.every((f) => f.severity !== 'low')).toBe(true)
  })

  it('maps npm audit severity vocabulary to Finding.severity correctly', () => {
    const raw = readFileSync('tests/fixtures/npm-audit-sample.json', 'utf-8')
    const findings = parseNpmAuditOutput(raw, 'dependencies')
    const critical = findings.find((f) => f.title.includes('@vitest/coverage-v8'))
    expect(critical?.severity).toBe('critical')
    const moderate = findings.find((f) => f.title.includes('@hono/node-server'))
    expect(moderate?.severity).toBe('medium')
  })

  it('uses the advisory title when via has full detail objects', () => {
    const raw = readFileSync('tests/fixtures/npm-audit-sample.json', 'utf-8')
    const findings = parseNpmAuditOutput(raw, 'dependencies')
    const f = findings.find((f) => f.title.includes('@hono/node-server'))
    expect(f?.detail).toContain('Path traversal')
    expect(f?.evidence).toContain('GHSA-frvp-7c67-39w9')
  })

  it('falls back to a generic title when via is only a string package reference', () => {
    const raw = readFileSync('tests/fixtures/npm-audit-sample.json', 'utf-8')
    const findings = parseNpmAuditOutput(raw, 'dependencies')
    const f = findings.find((f) => f.title.includes('@modelcontextprotocol/sdk'))
    expect(f).toBeDefined()
    expect(f?.detail).toContain('@hono/node-server')
  })

  it('sets source to npm-audit and basis to VERIFIED on every finding', () => {
    const raw = readFileSync('tests/fixtures/npm-audit-sample.json', 'utf-8')
    const findings = parseNpmAuditOutput(raw, 'dependencies')
    expect(findings.every((f) => f.source === 'npm-audit')).toBe(true)
    expect(findings.every((f) => f.basis === 'VERIFIED')).toBe(true)
  })

  it('returns an empty array for malformed JSON instead of throwing', () => {
    const findings = parseNpmAuditOutput('not json', 'dependencies')
    expect(findings).toEqual([])
  })

  it('returns an empty array when there are zero vulnerabilities', () => {
    const findings = parseNpmAuditOutput('{"vulnerabilities":{}}', 'dependencies')
    expect(findings).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/npmAuditParser.test.ts --exclude '.claude/worktrees/**'`
Expected: FAIL — `Cannot find module '../../src/core/npmAuditParser.js'`

- [ ] **Step 3: Write the implementation**

Create `src/core/npmAuditParser.ts`:

```typescript
// src/core/npmAuditParser.ts
// Maps `npm audit --json` output to the Finding schema. npm audit has no notion of a diff --
// it audits the entire current dependency tree -- so this is only invoked when the diff touches
// package.json/package-lock.json (see dependencies.ts), reporting the full current audit state
// rather than attempting to diff-scope it (see spec's Non-Goals: package-lock.json diffs are too
// fragile to reliably parse "which packages did this diff touch").
//
// npm audit's severity vocabulary (info/low/moderate/high/critical) doesn't match
// Finding.severity (low/medium/high/critical) -- info/low are dropped (matches every other
// agent's "only report severity >= medium" convention; moderate is the equivalent floor).

import type { AgentName, Finding, Severity } from './schema.js'

interface NpmAuditVia {
  title?: string
  url?: string
  severity?: string
}

interface NpmAuditVulnerability {
  name: string
  severity: string
  via: (string | NpmAuditVia)[]
  range: string
  fixAvailable: boolean | { name: string; version: string; isSemVerMajor: boolean }
}

interface NpmAuditReport {
  vulnerabilities?: Record<string, NpmAuditVulnerability>
}

const SEVERITY_MAP: Record<string, Severity | undefined> = {
  moderate: 'medium',
  high: 'high',
  critical: 'critical',
}

export function parseNpmAuditOutput(json: string, agentName: AgentName): Finding[] {
  let report: NpmAuditReport
  try {
    report = JSON.parse(json)
  } catch {
    return []
  }
  const vulnerabilities = report.vulnerabilities
  if (!vulnerabilities || typeof vulnerabilities !== 'object') return []

  const findings: Finding[] = []
  let i = 0
  for (const [pkgName, vuln] of Object.entries(vulnerabilities)) {
    const severity = SEVERITY_MAP[vuln.severity]
    if (!severity) continue // drops info/low

    const detailVia = vuln.via.find((v): v is NpmAuditVia => typeof v === 'object')
    const detail = detailVia?.title ?? `Vulnerable via ${vuln.via.filter((v) => typeof v === 'string').join(', ')}`
    const evidence = detailVia?.url ?? `Affected range: ${vuln.range}`
    const fixSuggestion =
      typeof vuln.fixAvailable === 'object'
        ? `Upgrade to ${vuln.fixAvailable.name}@${vuln.fixAvailable.version}${vuln.fixAvailable.isSemVerMajor ? ' (major version bump)' : ''}`
        : vuln.fixAvailable
          ? `Run npm audit fix to resolve.`
          : `No automatic fix available yet -- track the advisory for a patched release.`

    findings.push({
      id: `${agentName}-npm-audit-${i++}`,
      agent: agentName,
      domain: 'Dependencies',
      severity,
      basis: 'VERIFIED',
      file: 'package.json',
      line: 1,
      title: `Known vulnerability in ${pkgName}`,
      detail,
      evidence,
      impact: `${vuln.severity} severity vulnerability in ${pkgName} (affected range: ${vuln.range}).`,
      recommendation: fixSuggestion,
      suggestion: fixSuggestion,
      blocking: severity === 'critical' || severity === 'high',
      source: 'npm-audit',
      confidence: 95,
    })
  }
  return findings
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/npmAuditParser.test.ts --exclude '.claude/worktrees/**'`
Expected: PASS — 7 tests

- [ ] **Step 5: Commit**

```bash
git add src/core/npmAuditParser.ts tests/unit/npmAuditParser.test.ts
git commit -m "feat: add npmAuditParser to map npm audit JSON output to Finding[]"
```

---

## Task 3: Fix Stage 4 mislabeling in `base.ts`

**Files:**
- Modify: `src/core/agents/base.ts:36-87` (`parseFindings`)
- Test: `tests/unit/baseAgent.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/baseAgent.test.ts` (find the existing `describe` block for `parseFindings`/truncation-recovery tests and add alongside):

```typescript
it('wraps a single bare finding-shaped object without claiming truncation', () => {
  const raw = JSON.stringify({
    severity: 'high',
    basis: 'VERIFIED',
    confidence: 90,
    file: 'src/foo.ts',
    line: 10,
    title: 'A real finding',
    detail: 'Detail text',
    suggestion: 'Fix it',
  })
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  const agent = new TestAgent(makeProvider(), DEFAULT_CONFIG)
  // @ts-expect-error -- parseFindings is protected, test accesses it directly like existing tests in this file do
  const result = agent.parseFindings(raw)
  expect(result).toHaveLength(1)
  expect(result[0].title).toBe('A real finding')
  const loggedTruncated = errorSpy.mock.calls.some((call) =>
    String(call[0]).includes('appears truncated')
  )
  expect(loggedTruncated).toBe(false)
  const loggedAutoWrapped = errorSpy.mock.calls.some((call) =>
    String(call[0]).includes('not the required array')
  )
  expect(loggedAutoWrapped).toBe(true)
  errorSpy.mockRestore()
})
```

Check the top of `tests/unit/baseAgent.test.ts` first — if it doesn't already import `vi` from `'vitest'` or doesn't already have a `TestAgent`/`makeProvider`/`DEFAULT_CONFIG` helper matching this shape, use whatever the file's existing tests in the same `describe` block already use (this file has pre-existing Stage 1-4 tests to match against for exact helper names).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/baseAgent.test.ts --exclude '.claude/worktrees/**'`
Expected: FAIL — `loggedAutoWrapped` is `false` (current code logs "appears truncated" instead)

- [ ] **Step 3: Write the implementation**

In `src/core/agents/base.ts`, modify `parseFindings` — insert a new stage between the existing Stage 1/2 block and Stage 3:

```typescript
  protected parseFindings(raw: string): Finding[] {
    const cleaned = raw.replace(/```json\s*|```\s*/g, '').trim()

    // Stage 1: bare array or object with findings
    try {
      const parsed = JSON.parse(cleaned)
      if (Array.isArray(parsed)) {
        const valid = this.validateFindings(parsed)
        if (valid.length > 0 || parsed.length === 0) return valid
        // All items failed schema validation — log before falling through to extraction
        console.error(
          `[${this.name}] stage-1: ${parsed.length} item(s) failed schema validation. ` +
            `First item keys: ${Object.keys(parsed[0] ?? {}).join(', ')}`
        )
      }
      // Stage 2: object with .findings array
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.findings)) {
        return this.validateFindings(parsed.findings)
      }
      // Stage 2b: a single bare object that is itself finding-shaped (has its own `severity`
      // property, not nested under .findings) -- the model sometimes returns one finding
      // unwrapped instead of inside the required array. This is a COMPLETE, non-truncated
      // response that the earlier stages don't recognize the shape of -- it must not fall
      // through to Stage 4's truncation-recovery path, which would (correctly) salvage it but
      // (incorrectly) log it as truncated when nothing was cut off.
      if (
        parsed &&
        typeof parsed === 'object' &&
        !Array.isArray(parsed) &&
        typeof (parsed as { severity?: unknown }).severity === 'string'
      ) {
        const wrapped = this.validateFindings([parsed])
        if (wrapped.length > 0) {
          console.error(
            `[${this.name}] response was a single object, not the required array — ` +
              `auto-wrapped. Raw snippet: ${raw.slice(0, 200)}`
          )
          return wrapped
        }
      }
    } catch {
      /* fall through */
    }

    // Stage 3: balanced-bracket extraction (handles trailing prose/code with ']' chars)
    try {
      const extracted = extractBalancedSpan(cleaned, '[', ']')
      if (extracted) {
        const parsed = JSON.parse(extracted)
        if (Array.isArray(parsed)) return this.validateFindings(parsed)
      }
    } catch {
      /* fall through */
    }

    // Stage 4: recover complete finding objects from a truncated response (e.g. the model got
    // cut off mid-generation before the array closed) -- salvages the findings it did finish
    // instead of discarding all of them because the last one never completed. Only counts as a
    // real recovery if at least one recovered object actually passes schema validation -- a
    // trivially parseable but empty/garbage response (e.g. "{}") must still throw
    // ParseFailureError like it always has, not silently resolve to "0 findings, clean run".
    const recovered = this.validateFindings(extractCompleteObjects(cleaned))
    if (recovered.length > 0) {
      console.error(
        `[${this.name}] response appears truncated -- recovered ${recovered.length} complete ` +
          `finding(s) before the cutoff. Raw snippet: ${raw.slice(0, 200)}`
      )
      return recovered
    }

    console.error(`[${this.name}] parse failure. Raw snippet: ${raw.slice(0, 200)}`)
    throw new ParseFailureError(this.name, raw)
  }
```

The only change is the new `// Stage 2b` block inserted inside the first `try` block, after the existing Stage 2 check. Everything else in the method is unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/baseAgent.test.ts --exclude '.claude/worktrees/**'`
Expected: PASS — including the new test and all pre-existing ones (this is additive; verify no existing Stage 4 truncation test broke, since a genuinely truncated multi-object response still won't match Stage 2b's single-complete-object shape and will still correctly reach Stage 4)

- [ ] **Step 5: Run the full suite to check for regressions**

Run: `npx vitest run --exclude '.claude/worktrees/**'`
Expected: PASS — all tests, count should be baseline + 1

- [ ] **Step 6: Commit**

```bash
git add src/core/agents/base.ts tests/unit/baseAgent.test.ts
git commit -m "fix: stop mislabeling a complete single-object response as truncated"
```

---

## Task 4: Schema additions — `ToolAvailability`

**Files:**
- Modify: `src/core/schema.ts`

- [ ] **Step 1: Add the new types**

In `src/core/schema.ts`, add after the existing `HallucinationFilterMetadata` interface:

```typescript
export type ToolAvailability = 'used' | 'unavailable-llm-fallback'

export interface ToolAvailabilityMetadata {
  gitleaks?: ToolAvailability
  npmAudit?: ToolAvailability
}
```

- [ ] **Step 2: Add the field to `ReviewResult`**

In the `ReviewResult` interface, add after `hallucinationFilter?: HallucinationFilterMetadata`:

```typescript
  toolAvailability?: ToolAvailabilityMetadata
```

- [ ] **Step 3: Verify typecheck still passes (no consumers yet, purely additive)**

Run: `npm run typecheck`
Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add src/core/schema.ts
git commit -m "feat: add ToolAvailability schema types for degraded-mode visibility"
```

---

## Task 5: Wire gitleaks into `SecretsAgent`

**Files:**
- Modify: `src/core/agents/secrets.ts`
- Test: `tests/unit/secretsAgent.test.ts`

- [ ] **Step 1: Read the current file to confirm exact current content before editing**

Run: read `src/core/agents/secrets.ts` and `tests/unit/secretsAgent.test.ts` in full — the exact current prompt text and existing test structure must be preserved for anything not explicitly changed here.

- [ ] **Step 2: Write the failing tests**

`tests/unit/secretsAgent.test.ts` currently has no `shell.ts` mock at all. Once this task's
implementation lands, `SecretsAgent.run()` always calls `runTool('gitleaks', ...)` first — every
*existing* test in this file that calls `.run()` would otherwise attempt a real subprocess spawn.
Add the mock at the top of the file (module-level, hoisted, following the exact proven pattern
already used in `tests/unit/complexityAgent.test.ts` for the `lizard` integration — do not invent
a different mocking approach), with a `beforeEach` default of "tool not found" so every
pre-existing test keeps exercising the LLM path unchanged unless a specific new test overrides it:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runTool } from '../../src/utils/shell.js'

vi.mock('../../src/utils/shell.js', () => ({
  runTool: vi.fn(),
}))
const mockRunTool = vi.mocked(runTool)

import { readFileSync } from 'fs'
import { SecretsAgent } from '../../src/core/agents/secrets.js'
// ... keep every other existing import in this file exactly as-is
```

(If the file already imports `describe`/`it`/`expect`/`vi` from `'vitest'`, extend that existing
import statement with `beforeEach` rather than duplicating it — check the file first.)

Add one `beforeEach` at the top of the existing `describe('SecretsAgent', ...)` block (or a new
top-level one if the file doesn't already have a `describe` wrapper) that all tests in the file
now need:

```typescript
beforeEach(() => {
  vi.resetAllMocks()
  mockRunTool.mockResolvedValue(null) // default: gitleaks not found, existing tests unaffected
})
```

Then add a new `describe` block for the new behavior:

```typescript
describe('SecretsAgent gitleaks integration', () => {
  const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
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
      expect.arrayContaining(['detect', '--source', 'src/core/config.ts', '--redact'])
    )
  })
})
```

This reuses the file's existing `makeProvider` helper (already defined at the top of
`secretsAgent.test.ts` per the file read in Step 1) rather than constructing a provider object
inline — check that helper's exact existing signature and match it exactly.

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/unit/secretsAgent.test.ts --exclude '.claude/worktrees/**'`
Expected: FAIL — `agent.lastToolAvailability` is undefined (property doesn't exist yet), gitleaks path not implemented

- [ ] **Step 4: Write the implementation**

Modify `src/core/agents/secrets.ts`:

```typescript
import { BaseAgent } from './base.js'
import { runTool } from '../../utils/shell.js'
import { extractChangedFiles } from '../policyFilter.js'
import { parseGitleaksOutput } from '../gitleaksParser.js'
import { existsSync } from 'fs'
import type { AgentName, Finding, ReviewInput, ToolAvailability } from '../schema.js'

export class SecretsAgent extends BaseAgent {
  public lastToolAvailability?: ToolAvailability

  get name(): AgentName {
    return 'secrets'
  }

  async run(input: ReviewInput, signal?: AbortSignal): Promise<Finding[]> {
    const files = extractChangedFiles(input.diff).filter((f) => existsSync(f))
    if (files.length > 0) {
      const allFindings: Finding[] = []
      let gitleaksRan = false
      for (const file of files) {
        const output = await runTool('gitleaks', [
          'detect',
          '--no-git',
          '--source',
          file,
          '-f',
          'json',
          '-r',
          '-',
          '--exit-code',
          '0',
          '--no-banner',
          '--redact',
        ])
        if (output === null) continue // gitleaks not installed
        gitleaksRan = true
        allFindings.push(...parseGitleaksOutput(output, this.name))
      }
      if (gitleaksRan) {
        this.lastToolAvailability = 'used'
        return allFindings
      }
    }
    this.lastToolAvailability = 'unavailable-llm-fallback'
    return super.run(input, signal)
  }

  get systemPrompt(): string {
    return `You are a code reviewer specializing in secrets and credentials detection.
Analyze the diff for hardcoded secrets, credentials, and sensitive values:

- API keys and tokens: hardcoded strings matching common key formats (but not example/placeholder values)
- Passwords and passphrases in source code or config files
- Private keys, certificates, or cryptographic material
- Database connection strings with embedded credentials
- OAuth secrets, webhook secrets, or signing keys
- Cloud provider credentials (AWS, GCP, Azure key patterns)

Focus only on NEW lines added in the diff (lines starting with +).
Do NOT flag commented-out code, documentation examples, or clearly fake placeholder values.
Do NOT flag environment variable references like process.env.SECRET_KEY.
Do NOT flag file paths, marker files, or config file locations (e.g. ".claude/.review-ok",
"$root/config/settings.json") -- a path is not a credential regardless of nearby variable names
like "marker" or "key".
Do NOT flag hash algorithm invocations or their output (sha256sum, shasum, Get-FileHash,
git diff | sha256sum, or variables merely named "hash"/"expected"/"checksum") -- computing or
comparing a hash is not a secret.

severity: "critical" for private keys or certificates
severity: "high" for API keys, tokens, or passwords
severity: "medium" for connection strings or other credential patterns

Output ONLY a JSON array of findings. No prose, no explanation, no markdown fences. Empty array if no issues.
Required format:
[{"severity":"high","basis":"VERIFIED|INFERRED|SPECULATIVE","confidence":90,"file":"path/to/file","line":42,"title":"Short title","detail":"What the secret is","suggestion":"How to remediate","domain":"Secrets","evidence":"<the specific added line containing the credential pattern>","impact":"<credential exposure risk — e.g. unauthorized API access, data breach, account takeover if secret is leaked via repo history>","recommendation":"<move to environment variable or secrets manager, with corrected code example>","blocking":false,"source":"heuristic"}]

Additional rules:
- evidence: quote the specific diff line(s) that triggered this finding
- recommendation: write corrected code, not just a description
- blocking: true for critical/high, false for medium/low
- source: "heuristic" for pattern-based detection; "gitleaks" if an external tool flagged it`
  }
}
```

Notes on this change:
- `run()` is overridden (not just `systemPrompt`) — this is the first agent to do so besides `ComplexityAgent` (which already overrides `run()` for its `lizard` pre-check, same pattern).
- The prompt gains the two new negative-example lines (marker paths, hash computations) — everything else in the existing prompt is unchanged.
- `files.filter((f) => existsSync(f))` mirrors the "skip files that don't exist on disk" requirement from the spec (e.g. a deleted file in the diff, or running without a real checkout).

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/unit/secretsAgent.test.ts --exclude '.claude/worktrees/**'`
Expected: PASS — all tests including the 3 new ones

- [ ] **Step 6: Run the full suite to check for regressions**

Run: `npx vitest run --exclude '.claude/worktrees/**'`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/core/agents/secrets.ts tests/unit/secretsAgent.test.ts
git commit -m "feat: SecretsAgent uses gitleaks when available, skipping the LLM entirely"
```

---

## Task 6: Wire npm audit into `DependenciesAgent`

**Files:**
- Modify: `src/core/agents/dependencies.ts`
- Test: `tests/unit/dependenciesAgent.test.ts`

- [ ] **Step 1: Read the current file to confirm exact current content before editing**

Run: read `src/core/agents/dependencies.ts` and `tests/unit/dependenciesAgent.test.ts` in full.

- [ ] **Step 2: Write the failing tests**

Same consideration as Task 5: `tests/unit/dependenciesAgent.test.ts` has no `shell.ts` mock yet, and
every existing test that calls `.run()` on a diff touching `package.json` would otherwise attempt
a real `npm audit` subprocess. Add the identical proven mocking pattern from
`complexityAgent.test.ts`/Task 5 at the top of the file:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runTool } from '../../src/utils/shell.js'

vi.mock('../../src/utils/shell.js', () => ({
  runTool: vi.fn(),
}))
const mockRunTool = vi.mocked(runTool)

import { readFileSync } from 'fs'
import { DependenciesAgent } from '../../src/core/agents/dependencies.js'
// ... keep every other existing import in this file exactly as-is
```

Add (or extend an existing) `beforeEach`:

```typescript
beforeEach(() => {
  vi.resetAllMocks()
  mockRunTool.mockResolvedValue(null) // default: npm audit not run, existing tests unaffected
})
```

Then add the new `describe` block:

```typescript
describe('DependenciesAgent npm-audit integration', () => {
  const MANIFEST_DIFF = `diff --git a/package.json b/package.json
--- a/package.json
+++ b/package.json
@@ -1,1 +1,1 @@
-"a":"1"
+"a":"2"`

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

  it('falls back to the LLM when the diff does not touch a manifest file', async () => {
    const provider = makeProvider('[]')
    const agent = new DependenciesAgent(provider, DEFAULT_CONFIG)

    await agent.run({ diff: NON_MANIFEST_DIFF, projectPath: '.' })

    expect(mockRunTool).not.toHaveBeenCalled()
    expect(provider.chat).toHaveBeenCalledOnce()
    expect(agent.lastToolAvailability).toBeUndefined()
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
})
```

Reuses the file's existing `makeProvider` helper (check its exact existing signature first, same
as Task 5).

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/unit/dependenciesAgent.test.ts --exclude '.claude/worktrees/**'`
Expected: FAIL — `agent.lastToolAvailability` doesn't exist, npm-audit path not implemented

- [ ] **Step 4: Write the implementation**

Modify `src/core/agents/dependencies.ts` — add the `run()` override, keep the existing `systemPrompt` unchanged (already fixed in PR #17):

```typescript
import { BaseAgent } from './base.js'
import { runTool } from '../../utils/shell.js'
import { extractChangedFiles } from '../policyFilter.js'
import { parseNpmAuditOutput } from '../npmAuditParser.js'
import type { AgentName, Finding, ReviewInput, ToolAvailability } from '../schema.js'

export class DependenciesAgent extends BaseAgent {
  public lastToolAvailability?: ToolAvailability

  get name(): AgentName {
    return 'dependencies'
  }

  async run(input: ReviewInput, signal?: AbortSignal): Promise<Finding[]> {
    const touchesManifest = extractChangedFiles(input.diff).some(
      (f) => f === 'package.json' || f === 'package-lock.json'
    )
    if (touchesManifest && input.projectPath) {
      const output = await runTool('npm', ['audit', '--json'], undefined)
      if (output !== null) {
        this.lastToolAvailability = 'used'
        return parseNpmAuditOutput(output, this.name)
      }
    }
    if (touchesManifest) this.lastToolAvailability = 'unavailable-llm-fallback'
    return super.run(input, signal)
  }

  get systemPrompt(): string {
    return `You are a dependency security reviewer. Output ONLY a JSON array — no prose, no markdown fences, no other keys.

Required format:
[{
  "severity": "critical|high|medium|low",
  "basis": "VERIFIED|INFERRED|SPECULATIVE",
  "confidence": 90,
  "domain": "Dependencies",
  "file": "package.json",
  "line": 42,
  "title": "Short title under 60 chars",
  "detail": "Explanation of the dependency/supply-chain issue and why it matters",
  "evidence": "<specific diff line(s) showing the added/changed dependency or version specifier>",
  "impact": "<supply chain risk, breakage, or vulnerability introduced if not fixed>",
  "recommendation": "<concrete fix, e.g. an exact pinned version>",
  "blocking": false,
  "source": "llm",
  "suggestion": "<concrete fix, e.g. an exact pinned version>"
}]

Allowed field names: severity, basis, confidence, domain, file, line, title, detail, evidence, impact, recommendation, blocking, source, suggestion.
Do NOT use: type, description, details, change_type, dependency, version_specifier, or any other field name.

Analyze the git diff for dependency and supply chain issues:
- Newly added packages with known CVEs
- Packages with suspicious names (typosquatting)
- Pinned versions loosened to allow malicious updates
- Direct git URLs or unverified sources
- Deprecated packages with security issues
- Wildcard (*) or overly broad version ranges that allow breaking changes
- License incompatibilities (GPL in MIT projects)

Rules:
- basis=VERIFIED: CVE or known issue confirmed in training data
- basis=INFERRED: suspicious pattern that warrants investigation
- basis=SPECULATIVE: possible risk, needs npm audit to confirm
- confidence: your certainty this is a real issue (0-100)
- evidence: quote or reference the specific diff line(s) that triggered this finding
- recommendation: give the concrete fix (e.g. exact pinned version), not just "pin the version"
- blocking: true for critical/high, false for medium/low
- source: use "npm-audit" if this is a known published CVE, otherwise "llm"
- Only report severity >= medium
- If the diff has no package.json / requirements.txt changes, return: []`
  }
}
```

Note: `runTool('npm', ['audit', '--json'], undefined)` runs from the process's current working directory (same convention as `gitleaks`/`lizard`) — `input.projectPath` is checked as the *gate* for whether to attempt the tool call at all (consistent with the spec's "or `projectPath` isn't provided... fall back" rule), not passed as a `cwd` argument, since `runTool` doesn't support a `cwd` override and every other tool integration in this codebase shares this same assumption.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/unit/dependenciesAgent.test.ts --exclude '.claude/worktrees/**'`
Expected: PASS — all tests including the 3 new ones

- [ ] **Step 6: Run the full suite to check for regressions**

Run: `npx vitest run --exclude '.claude/worktrees/**'`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/core/agents/dependencies.ts tests/unit/dependenciesAgent.test.ts
git commit -m "feat: DependenciesAgent uses npm audit when the diff touches a manifest"
```

---

## Task 7: Wire `toolAvailability` collection into `runner.ts`

**Files:**
- Modify: `src/core/runner.ts`
- Test: `tests/unit/runner.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/unit/runner.test.ts` currently has zero `shell.ts` mocking, and most of its existing tests
construct a `SwarmRunner` with the full `DEFAULT_CONFIG` (which includes both `secrets` and
`dependencies`). After Tasks 5/6 land, any test whose diff references a file that both exists on
disk (for `secrets`) or touches `package.json` with a `projectPath` set (for `dependencies`) would
otherwise attempt a real subprocess call. Add the same proven mock pattern used in Tasks 5/6, at
the top of the file, with a FILE-LEVEL (not nested inside any single `describe`) default reset —
this file has multiple sibling top-level `describe` blocks (e.g. `SwarmRunner`,
`SwarmRunner hallucinated-file defense`), and the mock is a single shared module-level instance, so
the reset must apply to all of them, not just one:

```typescript
// tests/unit/runner.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { runTool } from '../../src/utils/shell.js'

vi.mock('../../src/utils/shell.js', () => ({
  runTool: vi.fn(),
}))
const mockRunTool = vi.mocked(runTool)

beforeEach(() => {
  mockRunTool.mockResolvedValue(null) // default: tools not found, every existing test unaffected
})

import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs'
// ... keep every other existing import in this file exactly as-is
```

This top-level `beforeEach` (outside any `describe` block) runs before every test in the file,
including the existing nested `beforeEach`/`afterEach` pair already in the file (Vitest runs
outer-to-inner hooks in order, so this doesn't conflict with it) — check the file first to place
this correctly relative to the existing hook.

Then add the new describe block (matching the location/style of the existing
`hallucinationFilter`/`hallucination-file defense` blocks):

```typescript
describe('SwarmRunner tool-availability visibility', () => {
  const DIFF = `diff --git a/src/core/config.ts b/src/core/config.ts
--- a/src/core/config.ts
+++ b/src/core/config.ts
@@ -1,1 +1,1 @@
-a
+b`

  it('surfaces gitleaks degraded-mode when it is not installed', async () => {
    mockRunTool.mockResolvedValue(null)
    const provider = makeProvider('[]')
    const config = { ...DEFAULT_CONFIG, agents: ['secrets'] as AgentName[] }
    const runner = new SwarmRunner(config, provider)

    const result = await runner.run({ diff: DIFF })

    expect(result.toolAvailability?.gitleaks).toBe('unavailable-llm-fallback')
  })

  it('surfaces gitleaks "used" when it ran, even with zero leaks', async () => {
    mockRunTool.mockResolvedValue('[]')
    const provider = makeProvider('[]')
    const config = { ...DEFAULT_CONFIG, agents: ['secrets'] as AgentName[] }
    const runner = new SwarmRunner(config, provider)

    const result = await runner.run({ diff: DIFF })

    expect(result.toolAvailability?.gitleaks).toBe('used')
  })

  it('does not include toolAvailability when secrets/dependencies did not run', async () => {
    const provider = makeProvider('[]')
    const config = { ...DEFAULT_CONFIG, agents: ['correctness'] as AgentName[] }
    const runner = new SwarmRunner(config, provider)

    const result = await runner.run({ diff: DIFF })

    expect(result.toolAvailability).toBeUndefined()
    expect(mockRunTool).not.toHaveBeenCalled()
  })
})
```

Reuses the file's existing `makeProvider` helper (defined near the top, confirmed in this task's
Step 1 file read) unchanged.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/runner.test.ts --exclude '.claude/worktrees/**'`
Expected: FAIL — `result.toolAvailability` is undefined in all three new cases (first two expect it
set, third expects `mockRunTool` never called since `correctness` alone doesn't trigger either
tool path)

- [ ] **Step 3: Write the implementation**

In `src/core/runner.ts`:

1. Add the import: change `import { SEVERITY_RANK } from './schema.js'` line's neighboring type import block to also bring in `ToolAvailability` and `ToolAvailabilityMetadata`:

```typescript
import type {
  AgentName,
  Severity,
  Finding,
  ReviewInput,
  ReviewResult,
  CoverageGap,
  GeneratedTestFile,
  AgentProgressEvent,
  SanitizerMetadata,
  AgentStatus,
  TruncationMetadata,
  DroppedHallucinatedFinding,
  ToolAvailability,
  ToolAvailabilityMetadata,
} from './schema.js'
```

2. Declare the accumulator next to `agentStatus` (around line 470):

```typescript
    const agentStatus: Partial<Record<AgentName, AgentStatus>> = {}
    const toolAvailability: ToolAvailabilityMetadata = {}
```

3. Thread `toolAvailability` through both `runAgentsSequential` and `runAgentsParallel` as a new parameter, and populate it right after each agent's `run()` resolves. In `runAgentsSequential`'s signature, add the parameter:

```typescript
  private async runAgentsSequential(
    agents: BaseAgent[],
    ctx: (name: AgentName) => Promise<ReviewInput>,
    baseIndex: number,
    total: number,
    agentStatus: Partial<Record<AgentName, AgentStatus>>,
    toolAvailability: ToolAvailabilityMetadata,
    timeout: number,
    onProgress?: (e: AgentProgressEvent) => void
  ): Promise<{ findings: Finding[]; earlyExitAgent?: AgentName }> {
```

Inside the loop, right after `findings.push(...agentFindings)` and before `agentStatus[agent.name] = 'ok'`, add:

```typescript
        recordToolAvailability(agent, toolAvailability)
```

Do the identical two changes (signature + call site) in `runAgentsParallel`.

4. Add the small shared helper function near `scaleAgentTimeout` (module-level, not a class method, since it needs to check `instanceof` against the two concrete agent classes already imported at the top of this file):

```typescript
function recordToolAvailability(agent: BaseAgent, toolAvailability: ToolAvailabilityMetadata): void {
  if (agent instanceof SecretsAgent && agent.lastToolAvailability) {
    toolAvailability.gitleaks = agent.lastToolAvailability
  }
  if (agent instanceof DependenciesAgent && agent.lastToolAvailability) {
    toolAvailability.npmAudit = agent.lastToolAvailability
  }
}
```

5. Update both call sites of `runAgentsSequential`/`runAgentsParallel` (search for them, they're invoked from within `run()`) to pass `toolAvailability` in the new parameter position, matching the signature change.

6. Add to the final `return` block, alongside the existing `hallucinationFilter` conditional spread:

```typescript
      ...(Object.keys(toolAvailability).length > 0 ? { toolAvailability } : {}),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/runner.test.ts --exclude '.claude/worktrees/**'`
Expected: PASS — including both new tests

- [ ] **Step 5: Run the full suite to check for regressions**

Run: `npx vitest run --exclude '.claude/worktrees/**'`
Expected: PASS — this touches two call sites of a widely-used private method, verify nothing else broke

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck`
Expected: 0 errors

- [ ] **Step 7: Commit**

```bash
git add src/core/runner.ts tests/unit/runner.test.ts
git commit -m "feat: surface secrets/dependencies tool-fallback status on ReviewResult"
```

---

## Task 8: Surface `toolAvailability` in the markdown formatter

**Files:**
- Modify: `src/cli/formatter.ts`
- Test: `tests/unit/formatters/markdown.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/formatters/markdown.test.ts`:

```typescript
it('shows a degraded-mode note when a tool-integrated agent fell back to the LLM', () => {
  const result = makeResult({
    findings: [],
    toolAvailability: { gitleaks: 'unavailable-llm-fallback' },
  })
  const output = formatMarkdown(result)
  expect(output).toMatch(/gitleaks/i)
  expect(output).toMatch(/not installed|fallback|degraded/i)
})

it('does not show a degraded-mode note when the tool was used', () => {
  const result = makeResult({
    findings: [],
    toolAvailability: { gitleaks: 'used' },
  })
  const output = formatMarkdown(result)
  expect(output).not.toMatch(/degraded|fallback/i)
})

it('does not show a degraded-mode note when toolAvailability is absent', () => {
  const output = formatMarkdown(makeResult())
  expect(output).not.toMatch(/gitleaks|npm.audit|degraded/i)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/formatters/markdown.test.ts --exclude '.claude/worktrees/**'`
Expected: FAIL — no `toolAvailability` handling exists yet

- [ ] **Step 3: Write the implementation**

In `src/cli/formatter.ts`, add a note near the top of the report, right after the existing `hallucinationFilter` block added previously (same placement rationale — a degraded-quality signal belongs near the top, not the bottom footer):

```typescript
  const TOOL_LABELS: Record<'gitleaks' | 'npmAudit', string> = {
    gitleaks: 'gitleaks',
    npmAudit: 'npm audit',
  }
  const degradedTools = (['gitleaks', 'npmAudit'] as const).filter(
    (t) => result.toolAvailability?.[t] === 'unavailable-llm-fallback'
  )
  if (degradedTools.length > 0) {
    const names = degradedTools.map((t) => TOOL_LABELS[t]).join(', ')
    lines.push(
      `${useEmoji ? '🔧 ' : ''}Degraded mode: ${names} not installed — falling back to LLM-only ` +
        `detection for the affected agent(s), which is less reliable. Install the missing tool(s) ` +
        `for accurate results.`
    )
    lines.push('')
  }
```

Insert this block right after the existing `hallucinationFilter` block (which was inserted right after the truncation-warning block), before the `failedAgents` check.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/formatters/markdown.test.ts --exclude '.claude/worktrees/**'`
Expected: PASS — including the 3 new tests

- [ ] **Step 5: Commit**

```bash
git add src/cli/formatter.ts tests/unit/formatters/markdown.test.ts
git commit -m "feat: surface tool-fallback degraded mode in the markdown report"
```

---

## Task 9: Surface `toolAvailability` in the SARIF formatter

**Files:**
- Modify: `src/cli/formatters/sarif.ts`
- Test: `tests/unit/formatters/sarif.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/formatters/sarif.test.ts`:

```typescript
it('includes toolAvailability in run-level properties when present', () => {
  const result = makeResult({ toolAvailability: { gitleaks: 'unavailable-llm-fallback' } })
  const sarif = JSON.parse(formatSarif(result))
  expect(sarif.runs[0].properties.toolAvailability).toEqual({
    gitleaks: 'unavailable-llm-fallback',
  })
})

it('omits toolAvailability from run-level properties when absent', () => {
  const sarif = JSON.parse(formatSarif(makeResult()))
  expect(sarif.runs[0].properties.toolAvailability).toBeUndefined()
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/formatters/sarif.test.ts --exclude '.claude/worktrees/**'`
Expected: FAIL — property not present in output

- [ ] **Step 3: Write the implementation**

In `src/cli/formatters/sarif.ts`, add to the `properties` object alongside the sibling metadata fields:

```typescript
          ...(result.toolAvailability ? { toolAvailability: result.toolAvailability } : {}),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/formatters/sarif.test.ts --exclude '.claude/worktrees/**'`
Expected: PASS — including the 2 new tests

- [ ] **Step 5: Commit**

```bash
git add src/cli/formatters/sarif.ts tests/unit/formatters/sarif.test.ts
git commit -m "feat: surface tool-fallback degraded mode in SARIF output"
```

---

## Task 10: Prompt-tightening — `adversarial.ts`

**Files:**
- Modify: `src/core/agents/adversarial.ts`

No unit test — prompt wording is only verifiable live (see Task 12/13). This is a text-only change to the existing prompt.

- [ ] **Step 1: Read the current file to confirm exact current content**

Run: read `src/core/agents/adversarial.ts` in full (already captured earlier in this session, but re-read before editing to catch any drift).

- [ ] **Step 2: Add threat-model-fit and basis-discipline guidance**

Modify the prompt's `Rules` section (the last part of the template string) to add two new bullet points, inserted after the existing `basis=SPECULATIVE` line and before `confidence:`:

```typescript
  get systemPrompt(): string {
    return `You are an adversarial testing agent. Analyze the provided git diff and identify inputs that would break the changed code.

Focus on finding inputs that cause:
- Null/undefined where not expected (passing null to a function expecting an object)
- Empty collections (empty array, empty string, empty object) where the code assumes non-empty
- Boundary values (INT_MAX, INT_MIN, 0, -1, very large numbers)
- Malformed data (invalid JSON, truncated strings, wrong encoding)
- Unicode edge cases (emoji in strings, RTL characters, null bytes)
- Concurrent access (two requests mutating the same resource simultaneously)
- Extremely long inputs that cause timeouts or stack overflows
- Negative numbers where only positive are expected
- Missing required fields in objects/payloads

For each finding, describe the specific breaking input and which code path it exercises.

Output ONLY a JSON array. No prose, no explanation, no markdown fences.

Required format:
[{"severity":"critical|high|medium|low","basis":"VERIFIED|INFERRED|SPECULATIVE","confidence":85,"file":"path/to/file","line":42,"title":"Short title under 60 chars","detail":"The specific input that breaks this code and why","suggestion":"Guard condition or validation that would prevent the break","domain":"Adversarial","evidence":"<specific diff line(s) proving the finding>","impact":"<what an adversarial actor could exploit if this input is sent>","recommendation":"<guard condition or validation with corrected code example>","blocking":false,"source":"llm"}]

Rules:
- basis=VERIFIED: the code clearly does not handle this input
- basis=INFERRED: likely unhandled based on common patterns
- basis=SPECULATIVE: might fail depending on upstream validation
- "Attacker"/adversarial-actor framing only applies when the code has an actual external,
  untrusted-input boundary (a network request, a user-facing form, a file upload, an API endpoint).
  Do NOT use attacker/exploit framing for local development tooling, git hooks, or CI scripts
  reading input from the calling process (e.g. Claude Code's own tool-call JSON piped to a local
  hook) — that input is not attacker-controlled. Describe those as ordinary edge-case bugs instead.
- confidence: your certainty this is a real issue (0-100)
- Only report severity >= medium
- evidence: quote the specific diff line(s) that triggered this finding
- recommendation: write corrected code, not just a description
- blocking: true for critical/high, false for medium/low
- source: "llm" for reasoning-based findings, "heuristic" when based on a recognizable pattern match
- If no breaking inputs found, return: []`
  }
```

The only change from the current file is the new bullet point ("Attacker"/adversarial-actor framing...) inserted into the `Rules` list — everything else is byte-identical to the existing prompt.

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: 0 errors (this is a string literal change only)

- [ ] **Step 4: Commit**

```bash
git add src/core/agents/adversarial.ts
git commit -m "fix: adversarial.ts requires attacker-framing to fit the code's real trust boundary"
```

---

## Task 11: Prompt-tightening — `secrets.ts` fallback path

Already done as part of Task 5 (the two new negative-example lines were added directly in that task's implementation step, since `secrets.ts` was already being edited there). No separate task needed — verify it's present:

- [ ] **Step 1: Confirm the negative examples are in the current `secrets.ts`**

Run: `grep -n "marker files\|hash algorithm invocations" src/core/agents/secrets.ts`
Expected: both lines present (added in Task 5, Step 4)

If missing (e.g. Task 5 was executed by a different session/agent that didn't include them), add them now to the `systemPrompt` getter, in the same position shown in Task 5's implementation step, then run `npm run typecheck` and commit as `fix: secrets.ts LLM-fallback prompt rejects file-path and hash-computation false positives`.

---

## Task 12: Calibration cases

**Files:**
- Modify: `calibration/calibrate.ts`
- Create: `calibration/fixtures/secrets-gitleaks-target.ts` (a real on-disk file with a synthetic but non-functional detectable secret pattern)
- Create: `calibration/fixtures/secrets-gitleaks.diff`
- Modify: `.gitignore` (not needed — this file IS committed, see rationale below)

**Design note on the gitleaks calibration fixture:** unlike the LLM-only calibration cases (which only need diff *text*, since the LLM reads the diff content directly), gitleaks scans real files *on disk* via `--source <file>`. The fixture file must actually exist in the repo at the path the fixture diff references. This repo's own CI likely runs gitleaks against pushes (see `gitleaks-action` in git history) — committing a realistic-looking fake secret risks tripping that scan or GitHub's push protection. Use a value that is syntactically detectable by gitleaks' generic high-entropy/pattern rules but is unambiguously a test fixture, not shaped like a real vendor key format (avoiding rule-specific patterns like `sk_live_`/`ghp_`/`AKIA` entirely sidesteps this) — instead use gitleaks' own **generic-api-key** rule, which matches a labeled `key`/`token`/`secret` assignment with sufficient entropy, using a value that is clearly a placeholder by content (repeated/structured, not real-looking).

- [ ] **Step 1: Find a fixture value that gitleaks' generic rule detects but is unambiguously fake**

Run this verification before adding anything to the plan permanently — test candidate values against the real installed gitleaks to confirm detection, from the scratchpad (not the repo):

```bash
cd /tmp || cd "$TEMP"
mkdir -p gitleaks-fixture-test/src
cat > gitleaks-fixture-test/src/sample.ts << 'EOF'
export const apiKey = "test-fixture-not-a-real-secret-aB3xY9zQ7mK2pL5wR8vN4tH6"
EOF
cd gitleaks-fixture-test && gitleaks detect --no-git --source src/sample.ts -f json -r - --exit-code 0 --no-banner --redact
```

If this reports a leak, use this exact value in the fixture. If it does NOT report a leak (gitleaks' generic rule may require the variable name to look more credential-like, or a different entropy profile), iterate on the value (e.g. try `secretToken`/`privateKey` as the variable name) until a real detection is confirmed — do not guess; verify against the actual installed binary before finalizing the fixture content in Step 2.

- [ ] **Step 2: Create the on-disk target file with the verified-detectable value**

Create `calibration/fixtures/secrets-gitleaks-target.ts` using the exact value confirmed in Step 1, e.g.:

```typescript
// Calibration fixture for the secrets-agent gitleaks-integration test case. This value is a
// synthetic placeholder verified to trip gitleaks' generic-api-key rule during Task 12's setup --
// it is not a real credential and never was.
export const apiKey = 'test-fixture-not-a-real-secret-aB3xY9zQ7mK2pL5wR8vN4tH6'
```

- [ ] **Step 3: Create the matching fixture diff**

Create `calibration/fixtures/secrets-gitleaks.diff` — the `+++ b/` path must exactly match `secrets-gitleaks-target.ts`'s path relative to the repo root:

```diff
diff --git a/calibration/fixtures/secrets-gitleaks-target.ts b/calibration/fixtures/secrets-gitleaks-target.ts
new file mode 100644
index 0000000..1111111
--- /dev/null
+++ b/calibration/fixtures/secrets-gitleaks-target.ts
@@ -0,0 +1,3 @@
+// Calibration fixture for the secrets-agent gitleaks-integration test case.
+export const apiKey = 'test-fixture-not-a-real-secret-aB3xY9zQ7mK2pL5wR8vN4tH6'
```

- [ ] **Step 4: Add the new calibration case to `calibrate.ts`**

In `calibration/calibrate.ts`, add a new entry to the `CASES` array (after the existing `secrets` case if one exists — check the file first):

```typescript
  {
    name: 'secrets-gitleaks',
    agentName: 'secrets',
    fixtureFile: 'calibration/fixtures/secrets-gitleaks.diff',
    expectedKeyword: 'test-fixture-not-a-real-secret',
    baitKeyword: 'AWS_SESSION_TOKEN',
  },
```

This asserts the real gitleaks path is exercised (finds the actual fixture secret) rather than the LLM hallucinating something unrelated (the `baitKeyword` from this session's reproduced `secrets` run 1 hallucination).

Also check whether `calibrate.ts` currently imports/constructs `SecretsAgent`/`DependenciesAgent` in a way that's still compatible after Tasks 5/6's `run()` override — since `agent.run({ diff })` is called without a `projectPath`, `DependenciesAgent`'s existing calibration case (touches `package.json`) will now hit the "manifest changed but projectPath missing" fallback path (LLM-only, degraded) unless `projectPath` is added. Add `projectPath: process.cwd()` to the existing `agentMap[...].run({ diff })` call in the calibration loop so the `dependencies` calibration cases (both existing and the new one in Step 5) exercise the real npm-audit path when applicable.

- [ ] **Step 5: Add the npm-audit calibration case**

Add another entry to `CASES`, reusing the existing `calibration/fixtures/dependencies.diff` fixture (already touches `package.json`) rather than creating a new one:

```typescript
  {
    name: 'dependencies-npm-audit',
    agentName: 'dependencies',
    fixtureFile: 'calibration/fixtures/dependencies.diff',
    expectedKeyword: 'vulnerability',
    baitKeyword: 'wildcard',
  },
```

`baitKeyword: 'wildcard'` here specifically checks that the OLD LLM-hallucination pattern (the wildcard-lodash claim) does NOT appear — since this diff should now go through the real npm-audit path instead.

- [ ] **Step 6: Run the calibration suite**

Run: `npm run calibrate`
Expected: `secrets-gitleaks` and `dependencies-npm-audit` both PASS. Report the full pass/fail summary — some pre-existing cases (`adversarial`, `breaking-change`) may still show pre-existing flakiness unrelated to this work (documented earlier this session); don't treat those as a regression unless the failure reason changed.

- [ ] **Step 7: Commit**

```bash
git add calibration/calibrate.ts calibration/fixtures/secrets-gitleaks-target.ts calibration/fixtures/secrets-gitleaks.diff
git commit -m "test: add live calibration cases for gitleaks/npm-audit tool integration"
```

---

## Task 13: Manual before/after rate verification for prompt-tightening

**Files:** none (verification only, informs the final report to the user)

- [ ] **Step 1: Re-run this session's `repro-raw.mjs`-style reproduction against the patched `adversarial`/`secrets` agents**

Rebuild first: `npm run build`

Reuse the same diff content from this session's `repro.diff` (the real `review-reminders.sh`/`.ps1` content) — write a small one-off script (in the scratchpad, not the repo) that imports the freshly-built `dist/core/agents/adversarial.js` and `dist/core/agents/secrets.js`, and calls `provider.chat()` directly 3 times per agent exactly as this session's original reproduction did, capturing raw output.

For `secrets` specifically, since gitleaks will now intercept `run()` before the LLM is ever called against real on-disk content, this spot-check should call `agent.systemPrompt` + `provider.chat()` directly (bypassing `run()`) to isolate and measure the *prompt's* fallback-quality improvement specifically — the gitleaks-available path is already covered by Task 5's unit tests and Task 12's calibration case.

- [ ] **Step 2: Compare against this session's original findings**

Report the before/after: this session's original reproduction showed `secrets` 3/3 and `adversarial` 3/3 hallucinating. Report the new rate honestly, whatever it is — per the spec's Non-Goal, this is an expected rate reduction, not a guaranteed zero.

---

## Task 14: Final full-suite verification

**Files:** none

- [ ] **Step 1: Run the full unit test suite**

Run: `npx vitest run --exclude '.claude/worktrees/**'`
Expected: PASS, count = baseline (393 at time of writing) + all new tests added across Tasks 0-9

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: 0 errors

- [ ] **Step 3: Run lint**

Run: `npm run lint:eslint`
Expected: 0 warnings/errors

- [ ] **Step 4: Run prettier check**

Run: `npx prettier --check src tests calibration`
Expected: all files formatted; if not, run `npx prettier --write <file>` on anything flagged and re-verify

- [ ] **Step 5: Run the full calibration suite one more time**

Run: `npm run calibrate`
Expected: no new regressions vs. Task 12's Step 6 baseline

- [ ] **Step 6: Update memory-bank**

Update `memory-bank/activeContext.md` and `memory-bank/progress.md` with a summary of this work (root causes found, fixes applied, before/after rates from Task 13), following this session's established pattern for prior entries in the same files.

- [ ] **Step 7: Update the task contract**

Update `.claude/contracts/active-task.json` status to `"complete"`.

- [ ] **Step 8: Final commit**

```bash
git add memory-bank/activeContext.md memory-bank/progress.md .claude/contracts/active-task.json
git commit -m "docs: update memory bank after secrets/dependencies deterministic-tools work"
```

- [ ] **Step 9: Run `/code-review` and `/change-review`, then push and open a PR**

Follow this session's established pattern (PR #17, etc.): `/code-review` first (writes `.claude/.code-review-ok`), then `/change-review` (writes `.claude/.change-review-ok`), then `git push -u origin <branch>` and `gh pr create`. Do not skip either review gate.
