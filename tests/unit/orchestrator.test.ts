// tests/unit/orchestrator.test.ts
import { describe, it, expect } from 'vitest'
import { OrchestratorAgent } from '../../src/core/agents/orchestrator.js'
import { DEFAULT_CONFIG } from '../../src/core/config.js'
import type { Finding } from '../../src/core/schema.js'

const finding = (overrides: Partial<Finding> = {}): Finding => ({
  id: 'security-0',
  agent: 'security',
  domain: 'Security',
  severity: 'high',
  basis: 'VERIFIED',
  file: 'src/auth.ts',
  line: 10,
  title: 'Test finding',
  detail: 'Detail',
  evidence: 'test evidence',
  impact: 'test impact',
  recommendation: 'Fix it',
  suggestion: 'Fix it',
  blocking: false,
  source: 'llm',
  ...overrides,
})

function makeFinding(overrides: Partial<Finding>): Finding {
  return {
    id: 'f1',
    agent: 'secrets',
    domain: 'Secrets',
    severity: 'critical',
    basis: 'VERIFIED',
    file: 'src/api.ts',
    line: 10,
    title: 'Hardcoded API key',
    detail: 'API key hardcoded in source',
    evidence: 'Detected by gitleaks rule generic-api-key',
    impact: 'Credential exposure',
    recommendation: 'Move to environment variable',
    suggestion: 'Move to environment variable',
    blocking: true,
    source: 'gitleaks',
    confidence: 50,
    ...overrides,
  }
}

describe('OrchestratorAgent', () => {
  describe('deduplication', () => {
    it('merges duplicate findings from multiple agents into one with corroboratingAgents', () => {
      const orch = new OrchestratorAgent(DEFAULT_CONFIG)
      const findings = [
        finding({
          id: 'security-0',
          agent: 'security',
          file: 'src/auth.ts',
          line: 10,
          title: 'SQL injection',
        }),
        finding({
          id: 'correctness-0',
          agent: 'correctness',
          file: 'src/auth.ts',
          line: 10,
          title: 'Null pointer',
        }),
      ]
      const result = orch.synthesize(findings)
      expect(result).toHaveLength(1)
      expect(result[0].agent).toBe('security')
      expect(result[0].corroboratingAgents).toContain('correctness')
    })

    it('merges findings whose file field carries a leading "a/" diff-header prefix with the unprefixed form (real captured bug)', () => {
      // Reproduced live: error-handling's finding hallucinated an "a/" prefix into its own
      // file field ("a/.claude/settings.json"), while secrets' finding on the SAME underlying
      // file at the SAME line used the correct, unprefixed form (".claude/settings.json").
      // deduplicate() built its map key from the raw, unnormalized file field, so these two
      // representations of the same location never merged.
      const orch = new OrchestratorAgent(DEFAULT_CONFIG)
      const findings = [
        finding({
          id: 'secrets-0',
          agent: 'secrets',
          file: '.claude/settings.json',
          line: 10,
          title: 'Hardcoded token',
        }),
        finding({
          id: 'error-handling-0',
          agent: 'error-handling',
          file: 'a/.claude/settings.json',
          line: 10,
          title: 'Swallowed error',
        }),
      ]
      const result = orch.synthesize(findings)
      expect(result).toHaveLength(1)
      expect(result[0].agent).toBe('secrets')
      expect(result[0].corroboratingAgents).toContain('error-handling')
    })

    it('merges findings whose file field carries a leading "b/" diff-header prefix with the unprefixed form', () => {
      const orch = new OrchestratorAgent(DEFAULT_CONFIG)
      const findings = [
        finding({
          id: 'security-0',
          agent: 'security',
          file: 'src/auth.ts',
          line: 10,
          title: 'SQL injection',
        }),
        finding({
          id: 'correctness-0',
          agent: 'correctness',
          file: 'b/src/auth.ts',
          line: 10,
          title: 'Null pointer',
        }),
      ]
      const result = orch.synthesize(findings)
      expect(result).toHaveLength(1)
      expect(result[0].agent).toBe('security')
      expect(result[0].corroboratingAgents).toContain('correctness')
    })

    it('removes duplicate findings at same file:line from different agents', () => {
      const orch = new OrchestratorAgent(DEFAULT_CONFIG)
      const findings = [
        finding({
          id: 'security-0',
          agent: 'security',
          file: 'src/auth.ts',
          line: 10,
          title: 'SQL injection',
        }),
        finding({
          id: 'correctness-0',
          agent: 'correctness',
          file: 'src/auth.ts',
          line: 10,
          title: 'Null pointer',
        }),
      ]
      const result = orch.synthesize(findings)
      expect(result).toHaveLength(1)
      // Security takes precedence over correctness
      expect(result[0].agent).toBe('security')
    })
  })

  describe('severity escalation', () => {
    it('escalates severity when correctness bug has no test coverage at same location', () => {
      const orch = new OrchestratorAgent(DEFAULT_CONFIG)
      const findings = [
        finding({
          id: 'correctness-0',
          agent: 'correctness',
          severity: 'medium',
          file: 'src/foo.ts',
          line: 20,
          title: 'Logic bug',
        }),
        finding({
          id: 'coverage-0',
          agent: 'coverage',
          severity: 'medium',
          file: 'src/foo.ts',
          line: 20,
          title: 'No test coverage',
        }),
      ]
      const result = orch.synthesize(findings)
      const corrFinding = result.find((f) => f.agent === 'correctness')
      expect(corrFinding?.severity).toBe('high') // escalated from medium
    })

    it('escalates severity when correctness bug and coverage gap use differently-prefixed representations of the same file (real captured bug class)', () => {
      // Same failure mode already fixed in deduplicate() and hallucinationCrossCheck: a
      // hallucinated "a/" diff-header prefix on one finding's file field prevents crossReference's
      // raw === comparison from recognizing the two findings share the same real file/line, so the
      // escalation silently fails to fire.
      const orch = new OrchestratorAgent(DEFAULT_CONFIG)
      const findings = [
        finding({
          id: 'correctness-0',
          agent: 'correctness',
          severity: 'medium',
          file: 'a/src/foo.ts',
          line: 20,
          title: 'Logic bug',
        }),
        finding({
          id: 'coverage-0',
          agent: 'coverage',
          severity: 'medium',
          file: 'src/foo.ts',
          line: 20,
          title: 'No test coverage',
        }),
      ]
      const result = orch.synthesize(findings)
      const corrFinding = result.find((f) => f.agent === 'correctness')
      expect(corrFinding?.severity).toBe('high') // escalated from medium
    })
  })

  describe('cap', () => {
    it('limits output to maxFindings sorted by severity', () => {
      const config = { ...DEFAULT_CONFIG, maxFindings: 3 }
      const orch = new OrchestratorAgent(config)
      const findings = Array.from({ length: 10 }, (_, i) =>
        finding({
          id: `security-${i}`,
          line: i + 1,
          title: `Finding ${i}`,
          severity: i < 3 ? 'critical' : 'medium',
        })
      )
      const result = orch.synthesize(findings)
      expect(result).toHaveLength(3)
      expect(result.every((f) => f.severity === 'critical')).toBe(true)
    })
  })

  describe('hallucination cross-check', () => {
    it('downgrades solo Critical to High (not Medium) when confidence < 60', () => {
      const orch = new OrchestratorAgent(DEFAULT_CONFIG)
      const findings = [
        finding({
          id: 'security-0',
          agent: 'security',
          severity: 'critical',
          confidence: 45,
          file: 'src/foo.ts',
          line: 5,
        }),
        finding({
          id: 'correctness-0',
          agent: 'correctness',
          severity: 'low',
          file: 'src/bar.ts',
          line: 99,
        }),
      ]
      const result = orch.synthesize(findings)
      const f = result.find((r) => r.id === 'security-0')
      // confidence < 60 → downgraded to high, not medium
      expect(f?.severity).toBe('high')
    })

    it('keeps critical finding when a second agent flags the same file+line region', () => {
      const orch = new OrchestratorAgent(DEFAULT_CONFIG)
      const findings = [
        finding({
          id: 'security-0',
          agent: 'security',
          severity: 'critical',
          file: 'src/foo.ts',
          line: 10,
        }),
        finding({
          id: 'correctness-0',
          agent: 'correctness',
          severity: 'high',
          file: 'src/foo.ts',
          line: 12,
        }),
      ]
      const result = orch.synthesize(findings)
      const secFinding = result.find((f) => f.agent === 'security')
      expect(secFinding?.severity).toBe('critical')
    })

    it('skips cross-check when only one agent ran', () => {
      const orch = new OrchestratorAgent(DEFAULT_CONFIG)
      const findings = [
        finding({
          id: 'security-0',
          agent: 'security',
          severity: 'critical',
          file: 'src/foo.ts',
          line: 5,
        }),
      ]
      const result = orch.synthesize(findings)
      const f = result.find((r) => r.id === 'security-0')
      expect(f?.severity).toBe('critical')
    })

    it('does not downgrade severity when the only corroborating agent used a differently-prefixed file path (real captured bug)', () => {
      // Reproduced live: secrets flagged ".claude/settings.json" at line 10, error-handling
      // flagged the SAME underlying file/line but with a hallucinated "a/" diff-header prefix
      // ("a/.claude/settings.json"). hallucinationCrossCheck runs before deduplicate() and
      // compared other.file === f.file with raw, unnormalized strings, so it failed to see these
      // as corroborating each other and solo-downgraded BOTH from high to medium -- even though
      // deduplicate() correctly merges them afterward with a corroboratingAgents entry. A finding
      // should not be scored as if it had zero corroboration when it demonstrably has one.
      const orch = new OrchestratorAgent(DEFAULT_CONFIG)
      const findings = [
        finding({
          id: 'secrets-0',
          agent: 'secrets',
          severity: 'high',
          file: '.claude/settings.json',
          line: 10,
        }),
        finding({
          id: 'error-handling-0',
          agent: 'error-handling',
          severity: 'high',
          file: 'a/.claude/settings.json',
          line: 10,
        }),
      ]
      const result = orch.synthesize(findings)
      expect(result).toHaveLength(1)
      expect(result[0].severity).toBe('high')
    })
  })

  describe('file-existence filter (hallucination defense)', () => {
    it('drops a finding whose file is not in the diff’s changed files', () => {
      const orch = new OrchestratorAgent(DEFAULT_CONFIG)
      const findings = [
        finding({ id: 'dependencies-0', agent: 'dependencies', file: 'package.json' }),
      ]
      const result = orch.synthesize(findings, ['src/other.ts'])
      expect(result).toHaveLength(0)
    })

    it('keeps a finding whose file is in the diff’s changed files', () => {
      const orch = new OrchestratorAgent(DEFAULT_CONFIG)
      const findings = [finding({ id: 'security-0', file: 'src/auth.ts' })]
      const result = orch.synthesize(findings, ['src/auth.ts', 'package.json'])
      expect(result).toHaveLength(1)
    })

    it('does not filter anything when changedFiles is omitted (backward compatible)', () => {
      const orch = new OrchestratorAgent(DEFAULT_CONFIG)
      const findings = [finding({ id: 'security-0', file: 'anything/not/real.ts' })]
      const result = orch.synthesize(findings)
      expect(result).toHaveLength(1)
    })

    it('matches despite a leading "./" on the finding’s file path', () => {
      const orch = new OrchestratorAgent(DEFAULT_CONFIG)
      const findings = [finding({ id: 'security-0', file: './src/auth.ts' })]
      const result = orch.synthesize(findings, ['src/auth.ts'])
      expect(result).toHaveLength(1)
    })

    it('matches despite a git-diff "a/" prefix on the finding’s file path', () => {
      // Reproduced live: the model sometimes echoes the diff's own `a/`/`b/` path prefix
      // (from "--- a/path" / "+++ b/path" headers) into the file field, even though
      // extractChangedFiles always strips it. A real finding was wrongly dropped as
      // hallucinated because of this exact mismatch.
      const orch = new OrchestratorAgent(DEFAULT_CONFIG)
      const findings = [finding({ id: 'correctness-0', file: 'a/src/cart/calculator.ts' })]
      const result = orch.synthesize(findings, ['src/cart/calculator.ts'])
      expect(result).toHaveLength(1)
      // Surviving the filter was never the whole job: this assertion is what was missing, and its
      // absence is why the prefix reached SARIF and the GitHub annotations for so long.
      expect(result[0]?.file).toBe('src/cart/calculator.ts')
    })

    it('rewrites the echoed prefix so the emitted path actually resolves', () => {
      // Measured on the real findings.json from PR #44's CI run: 5 of 15 findings (33%) carried an
      // a/ prefix. filterNonexistentFiles stripped it only for the membership test and never
      // corrected the stored value, so SARIF's artifactLocation.uri and the GitHub annotations
      // both received a path that does not exist -- GitHub cannot map it to a file, so the
      // annotation silently lands nowhere while the run still exits normally.
      const orch = new OrchestratorAgent(DEFAULT_CONFIG)
      const findings = [
        finding({ id: 'security-0', file: 'a/src/core/schema.ts' }),
        finding({ id: 'security-1', file: 'b/src/mcp/formatter.ts' }),
      ]
      const result = orch.synthesize(findings, ['src/core/schema.ts', 'src/mcp/formatter.ts'])
      expect(result.map((f) => f.file).sort()).toEqual([
        'src/core/schema.ts',
        'src/mcp/formatter.ts',
      ])
    })

    it('leaves the path alone when a/ is a real top-level directory in the reviewed repo', () => {
      // The strip is deliberately conditional. A repository may legitimately contain a top-level
      // directory named `a` or `b`; there `a/src/foo.ts` IS the real path and appears in
      // changedFiles as-is. Testing the unstripped form first keeps it intact -- an unconditional
      // strip would rewrite it to a path that does not exist, causing the very bug being fixed.
      const orch = new OrchestratorAgent(DEFAULT_CONFIG)
      const findings = [finding({ id: 'security-0', file: 'a/src/foo.ts' })]
      const result = orch.synthesize(findings, ['a/src/foo.ts'])
      expect(result).toHaveLength(1)
      expect(result[0]?.file).toBe('a/src/foo.ts')
    })

    it('does not filter anything when changedFiles is an empty array (fail open, not fail closed)', () => {
      // An empty list means extractChangedFiles couldn't confidently parse any files from the
      // diff -- not "this diff touches zero files." Filtering against an empty set would reject
      // every finding, a worse failure mode than the one this feature defends against.
      const orch = new OrchestratorAgent(DEFAULT_CONFIG)
      const findings = [finding({ id: 'security-0', file: 'anything/not/real.ts' })]
      const result = orch.synthesize(findings, [])
      expect(result).toHaveLength(1)
    })

    it('records a dropped finding into the optional sink instead of only logging it', () => {
      // A dropped finding used to be visible only via console.error -- invisible to any caller
      // reading the ReviewResult itself. The sink lets runner.ts surface this in the report.
      const orch = new OrchestratorAgent(DEFAULT_CONFIG)
      const findings = [
        finding({
          id: 'dependencies-0',
          agent: 'dependencies',
          file: 'package.json',
          title: 'Wildcard version',
        }),
      ]
      const dropped: Array<{ agent: string; title: string; file: string }> = []
      const result = orch.synthesize(findings, ['src/other.ts'], dropped)
      expect(result).toHaveLength(0)
      expect(dropped).toEqual([
        { agent: 'dependencies', title: 'Wildcard version', file: 'package.json' },
      ])
    })

    it('does not push into the sink when nothing is dropped', () => {
      const orch = new OrchestratorAgent(DEFAULT_CONFIG)
      const findings = [finding({ id: 'security-0', file: 'src/auth.ts' })]
      const dropped: Array<{ agent: string; title: string; file: string }> = []
      orch.synthesize(findings, ['src/auth.ts'], dropped)
      expect(dropped).toEqual([])
    })
  })

  describe('publication filter', () => {
    it('excludes SPECULATIVE findings below high severity', () => {
      const orch = new OrchestratorAgent(DEFAULT_CONFIG)
      const findings = [
        finding({ id: 'security-0', severity: 'medium', basis: 'SPECULATIVE' }),
        finding({ id: 'security-1', severity: 'high', basis: 'SPECULATIVE' }),
        finding({ id: 'security-2', severity: 'medium', basis: 'VERIFIED' }),
      ]
      const result = orch.synthesize(findings)
      expect(result.find((f) => f.id === 'security-0')).toBeUndefined()
      expect(result.find((f) => f.id === 'security-1')).toBeDefined()
      expect(result.find((f) => f.id === 'security-2')).toBeDefined()
    })
  })
})

describe('OrchestratorAgent.synthesize — hallucinationCrossCheck', () => {
  const orchestrator = new OrchestratorAgent({
    ...DEFAULT_CONFIG,
    maxFindings: 50,
  })

  it('does NOT downgrade a solo Critical finding from a deterministic source (gitleaks)', () => {
    const findings: Finding[] = [
      makeFinding({ source: 'gitleaks', severity: 'critical', confidence: 50, agent: 'secrets' }),
      makeFinding({
        id: 'f2',
        agent: 'security',
        file: 'src/other.ts',
        line: 99,
        source: 'llm',
        severity: 'low',
      }),
    ]
    const result = orchestrator.synthesize(findings)
    const secretFinding = result.find((f) => f.id === 'f1')
    expect(secretFinding?.severity).toBe('critical')
  })

  it('does NOT downgrade a solo High finding from a deterministic source (npm-audit)', () => {
    const findings: Finding[] = [
      makeFinding({
        id: 'f1',
        source: 'npm-audit',
        severity: 'high',
        confidence: 40,
        agent: 'dependencies',
      }),
      makeFinding({
        id: 'f2',
        agent: 'correctness',
        file: 'src/other.ts',
        line: 99,
        source: 'llm',
        severity: 'low',
      }),
    ]
    const result = orchestrator.synthesize(findings)
    const secFinding = result.find((f) => f.id === 'f1')
    expect(secFinding?.severity).toBe('high')
  })

  // Regression test for audit finding C5: DETERMINISTIC_SOURCES used to also include 'lizard',
  // 'git', and 'policy' -- labels only ever set by an LLM self-reporting its own prompt
  // instruction, never by real code. Any agent's hallucinated or merely-confident output could
  // self-tag one of those and skip the corroboration-required downgrade below entirely. Confirmed
  // empirically before the fix (a solo, low-confidence, source:"git" finding survived at its
  // original severity); this proves the fix closes it.
  it('DOES downgrade a solo Critical finding whose source is a spoofable, non-tool-backed value ("git")', () => {
    const findings: Finding[] = [
      makeFinding({
        id: 'f1',
        source: 'git',
        severity: 'critical',
        confidence: 40, // below the 60 threshold
        agent: 'breaking-change',
      }),
      // A second, unrelated finding from a different agent -- hallucinationCrossCheck no-ops
      // entirely when only one agent is present in the whole batch (agentsPresent.size <= 1),
      // so this is required to actually exercise the corroboration-required downgrade path.
      makeFinding({
        id: 'f2',
        agent: 'correctness',
        file: 'src/other.ts',
        line: 99,
        source: 'llm',
        severity: 'low',
      }),
    ]
    const result = orchestrator.synthesize(findings)
    const finding = result.find((f) => f.id === 'f1')
    expect(finding?.severity).toBe('high')
  })

  it('DOES downgrade a solo High finding whose source is a spoofable, non-tool-backed value ("policy")', () => {
    const findings: Finding[] = [
      makeFinding({
        id: 'f1',
        source: 'policy',
        severity: 'high',
        confidence: 40,
        agent: 'license',
      }),
      makeFinding({
        id: 'f2',
        agent: 'correctness',
        file: 'src/other.ts',
        line: 99,
        source: 'llm',
        severity: 'low',
      }),
    ]
    const result = orchestrator.synthesize(findings)
    const finding = result.find((f) => f.id === 'f1')
    expect(finding?.severity).toBe('medium')
  })

  it('DOES downgrade a solo High finding from llm source with low confidence', () => {
    const findings: Finding[] = [
      makeFinding({ id: 'f1', source: 'llm', severity: 'high', confidence: 40, agent: 'security' }),
      makeFinding({
        id: 'f2',
        agent: 'correctness',
        file: 'src/other.ts',
        line: 99,
        source: 'llm',
        severity: 'low',
      }),
    ]
    const result = orchestrator.synthesize(findings)
    const secFinding = result.find((f) => f.id === 'f1')
    expect(secFinding?.severity).toBe('medium')
  })

  it('does NOT downgrade when a corroborating agent exists regardless of source', () => {
    const findings: Finding[] = [
      makeFinding({
        id: 'f1',
        source: 'llm',
        severity: 'critical',
        confidence: 40,
        agent: 'security',
        file: 'src/api.ts',
        line: 10,
      }),
      makeFinding({
        id: 'f2',
        source: 'llm',
        severity: 'high',
        agent: 'adversarial',
        file: 'src/api.ts',
        line: 10,
      }),
    ]
    const result = orchestrator.synthesize(findings)
    const criticalFinding = result.find((f) => f.id === 'f1')
    expect(criticalFinding?.severity).toBe('critical')
  })
})

describe('OrchestratorAgent.synthesize — crossReference breaking-change escalation', () => {
  it('escalates breaking-change severity when correctness finding is at same location', () => {
    const orch = new OrchestratorAgent(DEFAULT_CONFIG)
    const findings = [
      makeFinding({
        id: 'bc-0',
        agent: 'breaking-change',
        severity: 'high',
        basis: 'VERIFIED',
        file: 'src/api.ts',
        line: 10,
      }),
      makeFinding({
        id: 'c-0',
        agent: 'correctness',
        severity: 'medium',
        basis: 'VERIFIED',
        file: 'src/api.ts',
        line: 13, // within 5-line window but different location
      }),
    ]
    const result = orch.synthesize(findings)
    const bc = result.find((f) => f.agent === 'breaking-change')
    expect(bc?.severity).toBe('critical') // high → critical (escalated due to nearby correctness)
  })

  it('escalates breaking-change when design finding is nearby', () => {
    const orch = new OrchestratorAgent(DEFAULT_CONFIG)
    const findings = [
      makeFinding({
        id: 'bc-0',
        agent: 'breaking-change',
        severity: 'medium',
        basis: 'VERIFIED',
        file: 'src/api.ts',
        line: 10,
      }),
      makeFinding({
        id: 'd-0',
        agent: 'design',
        severity: 'high',
        basis: 'VERIFIED',
        file: 'src/api.ts',
        line: 12,
      }),
    ]
    const result = orch.synthesize(findings)
    const bc = result.find((f) => f.agent === 'breaking-change')
    expect(bc?.severity).toBe('high') // medium → high (escalated due to nearby design)
  })

  it('does not escalate breaking-change when correctness is beyond 5-line window', () => {
    const orch = new OrchestratorAgent(DEFAULT_CONFIG)
    const findings = [
      makeFinding({
        id: 'bc-0',
        agent: 'breaking-change',
        severity: 'high',
        basis: 'VERIFIED',
        file: 'src/api.ts',
        line: 10,
      }),
      makeFinding({
        id: 'c-0',
        agent: 'correctness',
        severity: 'high',
        basis: 'VERIFIED',
        file: 'src/api.ts',
        line: 20, // > 5 lines away
      }),
    ]
    const result = orch.synthesize(findings)
    const bc = result.find((f) => f.agent === 'breaking-change')
    expect(bc?.severity).toBe('high') // unchanged
  })
})

describe('OrchestratorAgent.synthesize — filterUnsupportedClaims', () => {
  // The reproduction fixture for the originally-reported bug: a parameterized, auth.uid()-scoped
  // Postgres RLS function with no dynamic-SQL-construction or exception-handling syntax at all.
  const CLEAN_SQL_DIFF = `diff --git a/supabase/migrations/x.sql b/supabase/migrations/x.sql
new file mode 100644
--- /dev/null
+++ b/supabase/migrations/x.sql
@@ -0,0 +1,10 @@
+create or replace function is_group_member(gid uuid)
+returns boolean
+language sql
+security definer
+set search_path = ''
+as $$
+  select exists (
+    select 1 from public.group_members
+    where group_id = gid and user_id = auth.uid()
+  );
+$$;
`

  // A genuine injection: string concatenation feeding EXECUTE.
  const VULNERABLE_SQL_DIFF = `diff --git a/supabase/migrations/y.sql b/supabase/migrations/y.sql
new file mode 100644
--- /dev/null
+++ b/supabase/migrations/y.sql
@@ -0,0 +1,8 @@
+create or replace function search_visits(term text)
+returns setof public.visits
+language plpgsql
+as $$
+begin
+  return query execute 'select * from public.visits where note like ''%' || term || '%''';
+end;
+$$;
`

  it('drops an injection finding whose file section has no dynamic construction', () => {
    const orch = new OrchestratorAgent(DEFAULT_CONFIG)
    const findings = [
      finding({
        id: 'security-0',
        agent: 'security',
        file: 'supabase/migrations/x.sql',
        title: 'SQL Injection in is_group_member',
        detail: 'The gid parameter is interpolated into the query.',
      }),
    ]
    const result = orch.synthesize(findings, undefined, undefined, CLEAN_SQL_DIFF)
    expect(result).toHaveLength(0)
  })

  it('keeps an injection finding whose file section contains genuine dynamic construction', () => {
    const orch = new OrchestratorAgent(DEFAULT_CONFIG)
    const findings = [
      finding({
        id: 'security-0',
        agent: 'security',
        file: 'supabase/migrations/y.sql',
        title: 'SQL Injection in search_visits',
        detail: 'term is concatenated directly into the executed query string.',
      }),
    ]
    const result = orch.synthesize(findings, undefined, undefined, VULNERABLE_SQL_DIFF)
    expect(result).toHaveLength(1)
  })

  it('drops a swallowed-exception finding whose file section has no exception-handling construct', () => {
    const orch = new OrchestratorAgent(DEFAULT_CONFIG)
    const findings = [
      finding({
        id: 'error-handling-0',
        agent: 'error-handling',
        file: 'supabase/migrations/x.sql',
        title: 'Swallowed exception',
        detail: 'Errors from this function are silently discarded.',
      }),
    ]
    const result = orch.synthesize(findings, undefined, undefined, CLEAN_SQL_DIFF)
    expect(result).toHaveLength(0)
  })

  it('keeps a swallowed-exception finding whose file section contains a real exception-handling construct', () => {
    const orch = new OrchestratorAgent(DEFAULT_CONFIG)
    const tryCatchDiff = `diff --git a/src/handler.ts b/src/handler.ts
--- a/src/handler.ts
+++ b/src/handler.ts
@@ -1,3 +1,5 @@
+try {
+  risky()
+} catch (e) { }
`
    const findings = [
      finding({
        id: 'error-handling-0',
        agent: 'error-handling',
        file: 'src/handler.ts',
        title: 'Swallowed exception',
        detail: 'The catch block is empty.',
      }),
    ]
    const result = orch.synthesize(findings, undefined, undefined, tryCatchDiff)
    expect(result).toHaveLength(1)
  })

  it('does not touch a finding that makes neither an injection nor a swallowed-exception claim', () => {
    const orch = new OrchestratorAgent(DEFAULT_CONFIG)
    const findings = [
      finding({
        id: 'security-0',
        agent: 'security',
        file: 'supabase/migrations/x.sql',
        title: 'Missing rate limiting',
        detail: 'This policy has no rate limit.',
      }),
    ]
    const result = orch.synthesize(findings, undefined, undefined, CLEAN_SQL_DIFF)
    expect(result).toHaveLength(1)
  })

  it('does not filter anything when diffText is omitted (backward compatible)', () => {
    const orch = new OrchestratorAgent(DEFAULT_CONFIG)
    const findings = [
      finding({
        id: 'security-0',
        file: 'supabase/migrations/x.sql',
        title: 'SQL Injection',
        detail: 'unsanitized input reaches the query',
      }),
    ]
    const result = orch.synthesize(findings)
    expect(result).toHaveLength(1)
  })

  it('fails open when the finding’s file has no matching section in the diff', () => {
    const orch = new OrchestratorAgent(DEFAULT_CONFIG)
    const findings = [
      finding({
        id: 'security-0',
        file: 'src/unrelated.ts',
        title: 'SQL Injection',
        detail: 'unsanitized input reaches the query',
      }),
    ]
    const result = orch.synthesize(findings, undefined, undefined, CLEAN_SQL_DIFF)
    expect(result).toHaveLength(1)
  })

  it('exempts deterministic-source findings (e.g. npm-audit) from the claim-support check', () => {
    // A real npm-audit CVE can legitimately be titled "SQL injection in <package>" and is
    // attributed to package.json, whose diff section will of course contain no dynamic SQL.
    // Without this exemption the filter would silently drop real, tool-sourced findings.
    const orch = new OrchestratorAgent(DEFAULT_CONFIG)
    const findings = [
      finding({
        id: 'dependencies-0',
        agent: 'dependencies',
        source: 'npm-audit',
        file: 'package.json',
        title: 'SQL injection in vulnerable-orm@1.2.3',
        detail: 'CVE-2026-00000: known SQL injection vulnerability.',
      }),
    ]
    const diffWithPackageJson = `diff --git a/package.json b/package.json
--- a/package.json
+++ b/package.json
@@ -1,3 +1,3 @@
-  "vulnerable-orm": "1.2.2",
+  "vulnerable-orm": "1.2.3",
`
    const result = orch.synthesize(findings, undefined, undefined, diffWithPackageJson)
    expect(result).toHaveLength(1)
  })

  it('records a dropped claim into the sink with a distinguishing reason', () => {
    const orch = new OrchestratorAgent(DEFAULT_CONFIG)
    const findings = [
      finding({
        id: 'security-0',
        agent: 'security',
        file: 'supabase/migrations/x.sql',
        title: 'SQL Injection in is_group_member',
        detail: 'unparameterized query',
      }),
    ]
    const dropped: Array<{ agent: string; title: string; file: string; reason?: string }> = []
    const result = orch.synthesize(findings, undefined, dropped, CLEAN_SQL_DIFF)
    expect(result).toHaveLength(0)
    expect(dropped).toEqual([
      {
        agent: 'security',
        title: 'SQL Injection in is_group_member',
        file: 'supabase/migrations/x.sql',
        reason: 'unsupported-injection-claim',
      },
    ])
  })

  it('drops a NULL-raises-an-error claim against SQL that contains no raising construct', () => {
    // In SQL, comparing to NULL yields unknown and filters the row -- it does not error. With no
    // RAISE, cast, or constraint anywhere in the section, the claimed mechanism cannot occur.
    const orch = new OrchestratorAgent(DEFAULT_CONFIG)
    const findings = [
      finding({
        id: 'adversarial-0',
        agent: 'adversarial',
        file: 'supabase/migrations/x.sql',
        title: 'Null UUID Input Breaks Function',
        detail: 'Passing null to is_group_member causes an SQL syntax error',
      }),
    ]
    const dropped: Array<{ agent: string; title: string; file: string; reason?: string }> = []
    const result = orch.synthesize(findings, undefined, dropped, CLEAN_SQL_DIFF)
    expect(result).toHaveLength(0)
    expect(dropped[0].reason).toBe('unsupported-null-error-claim')
  })

  it('keeps a NULL-raises claim when the SQL section really can raise', () => {
    const orch = new OrchestratorAgent(DEFAULT_CONFIG)
    const castDiff = `diff --git a/supabase/migrations/z.sql b/supabase/migrations/z.sql
new file mode 100644
--- /dev/null
+++ b/supabase/migrations/z.sql
@@ -0,0 +1,2 @@
+create function f(t text) returns uuid language sql as $$
+  select t::uuid;
+$$;
`
    const findings = [
      finding({
        id: 'adversarial-0',
        agent: 'adversarial',
        file: 'supabase/migrations/z.sql',
        title: 'Malformed input causes an error',
        detail: 'Passing an invalid uuid string causes a cast error',
      }),
    ]
    const result = orch.synthesize(findings, undefined, undefined, castDiff)
    expect(result).toHaveLength(1)
  })

  it('never applies the NULL-raises check outside SQL files', () => {
    // In an imperative language a null dereference raises with no raising keyword present, so
    // acting on this claim there would drop genuine crash findings.
    const orch = new OrchestratorAgent(DEFAULT_CONFIG)
    const tsDiff = `diff --git a/src/handler.ts b/src/handler.ts
--- a/src/handler.ts
+++ b/src/handler.ts
@@ -1,2 +1,3 @@
+export const name = (u) => u.profile.name
`
    const findings = [
      finding({
        id: 'adversarial-0',
        agent: 'adversarial',
        file: 'src/handler.ts',
        title: 'Null user crashes handler',
        detail: 'Passing null as u causes a TypeError when reading profile',
      }),
    ]
    const result = orch.synthesize(findings, undefined, undefined, tsDiff)
    expect(result).toHaveLength(1)
  })

  it('runs before crossReference, so an unsupported pair cannot escalate each other first', () => {
    // The diagnosed co-fabrication case: security and adversarial invented matching injection
    // findings at the same location on the same safe function. If crossReference ran first it
    // would escalate the security finding's severity before this filter could drop it.
    const orch = new OrchestratorAgent(DEFAULT_CONFIG)
    const findings = [
      finding({
        id: 'security-0',
        agent: 'security',
        severity: 'medium',
        file: 'supabase/migrations/x.sql',
        line: 1,
        title: 'SQL Injection in is_group_member',
        detail: 'unparameterized query',
      }),
      finding({
        id: 'adversarial-0',
        agent: 'adversarial',
        severity: 'medium',
        file: 'supabase/migrations/x.sql',
        line: 1,
        title: 'SQL Injection exploit path',
        detail: 'attacker-controlled gid reaches the query',
      }),
    ]
    const result = orch.synthesize(findings, undefined, undefined, CLEAN_SQL_DIFF)
    expect(result).toHaveLength(0)
  })
})

describe('OrchestratorAgent.synthesize — pre-image findings', () => {
  // WHY this is an orchestrator-level test and not only a claimSupport unit test: the first
  // version of this filter was WIRED wrong -- it was handed the section from sliceDiffByFile,
  // which is post-image by construction, so it could never fire. Every unit test of the predicate
  // passed anyway, because the predicate itself was correct. Only running findings through
  // synthesize() exposes it. The bug was caught by replaying the real findings.json from PR #44's
  // CI run through this path; this test pins that shape.
  const N_PLUS_ONE_REMOVED_DIFF = `diff --git a/src/users/service.ts b/src/users/service.ts
--- a/src/users/service.ts
+++ b/src/users/service.ts
@@ -1,8 +1,5 @@
 export async function getUsersWithPosts(userIds: string[]) {
-  const users = await db.query('SELECT * FROM users WHERE id = ANY($1)', [userIds])
-  for (const user of users.rows) {
-    user.posts = await db.query('SELECT * FROM posts WHERE user_id = $1', [user.id])
-  }
-  return users.rows
+  const rows = await db.query('SELECT u.*, p.title FROM users u LEFT JOIN posts p ON p.user_id = u.id WHERE u.id = ANY($1)', [userIds])
+  return groupPostsByUser(rows.rows)
 }`

  it('drops a finding whose evidence quotes only lines the diff deletes', () => {
    const orch = new OrchestratorAgent(DEFAULT_CONFIG)
    const dropped: import('../../src/core/schema.js').DroppedHallucinatedFinding[] = []
    const findings = [
      finding({
        id: 'performance-0',
        agent: 'performance',
        file: 'src/users/service.ts',
        line: 3,
        title: 'N+1 query pattern',
        evidence:
          "for (const user of users.rows) { user.posts = await db.query('SELECT * FROM posts WHERE user_id = $1', [user.id]) }",
      }),
    ]
    const result = orch.synthesize(
      findings,
      ['src/users/service.ts'],
      dropped,
      N_PLUS_ONE_REMOVED_DIFF
    )
    expect(result).toHaveLength(0)
    expect(dropped[0]?.reason).toBe('pre-image-only-evidence')
  })

  it('keeps a finding whose evidence quotes code the diff adds', () => {
    const orch = new OrchestratorAgent(DEFAULT_CONFIG)
    const findings = [
      finding({
        id: 'performance-0',
        agent: 'performance',
        file: 'src/users/service.ts',
        line: 2,
        title: 'Unbounded join',
        evidence:
          "const rows = await db.query('SELECT u.*, p.title FROM users u LEFT JOIN posts p ON p.user_id = u.id WHERE u.id = ANY($1)', [userIds])",
      }),
    ]
    const result = orch.synthesize(findings, ['src/users/service.ts'], [], N_PLUS_ONE_REMOVED_DIFF)
    expect(result).toHaveLength(1)
  })
})
