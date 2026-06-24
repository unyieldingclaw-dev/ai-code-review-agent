import { describe, it, expect } from 'vitest'
import { evaluatePolicy, extractChangedFiles } from '../../src/core/policyFilter.js'
import { DEFAULT_CONFIG } from '../../src/core/config.js'

describe('extractChangedFiles', () => {
  it('extracts file paths from unified diff', () => {
    const diff = `diff --git a/src/api.ts b/src/api.ts\n--- a/src/api.ts\n+++ b/src/api.ts\n@@ -1 +1 @@\n-old\n+new\n`
    expect(extractChangedFiles(diff)).toEqual(['src/api.ts'])
  })

  it('returns empty array for empty diff', () => {
    expect(extractChangedFiles('')).toEqual([])
  })

  it('deduplicates multiple hunks in same file', () => {
    const diff = `+++ b/src/a.ts\n+++ b/src/a.ts\n`
    expect(extractChangedFiles(diff)).toEqual(['src/a.ts'])
  })
})

describe('evaluatePolicy', () => {
  const agents = ['security', 'license', 'design'] as const

  it('allows all agents when no agentPolicy configured', () => {
    const { allowed, policy } = evaluatePolicy([...agents], ['src/api.ts'], DEFAULT_CONFIG)
    expect(allowed).toEqual([...agents])
    expect(policy.agentsSkipped).toHaveLength(0)
  })

  it('skips agent when no changed files match include patterns', () => {
    const config = {
      ...DEFAULT_CONFIG,
      agentPolicy: { license: { include: ['package.json', 'package-lock.json'] } },
    }
    const { allowed, policy } = evaluatePolicy([...agents], ['src/api.ts'], config)
    expect(allowed).not.toContain('license')
    expect(policy.agentsSkipped).toContain('license')
    expect(policy.reason.license).toMatch(/include/)
  })

  it('keeps agent when at least one changed file matches include', () => {
    const config = {
      ...DEFAULT_CONFIG,
      agentPolicy: { license: { include: ['package.json'] } },
    }
    const { allowed } = evaluatePolicy([...agents], ['package.json', 'src/api.ts'], config)
    expect(allowed).toContain('license')
  })

  it('skips agent when ALL changed files match exclude patterns', () => {
    const config = {
      ...DEFAULT_CONFIG,
      agentPolicy: { security: { exclude: ['docs/**'] } },
    }
    const { allowed, policy } = evaluatePolicy(
      [...agents],
      ['docs/README.md', 'docs/guide.md'],
      config
    )
    expect(allowed).not.toContain('security')
    expect(policy.agentsSkipped).toContain('security')
  })

  it('keeps agent when only SOME changed files match exclude', () => {
    const config = {
      ...DEFAULT_CONFIG,
      agentPolicy: { security: { exclude: ['docs/**'] } },
    }
    const { allowed } = evaluatePolicy([...agents], ['docs/README.md', 'src/api.ts'], config)
    expect(allowed).toContain('security')
  })

  it('allows all agents when changedFiles is empty (no diff to filter on)', () => {
    const config = {
      ...DEFAULT_CONFIG,
      agentPolicy: { license: { include: ['package.json'] } },
    }
    const { allowed } = evaluatePolicy([...agents], [], config)
    expect(allowed).toContain('license')
  })
})
