import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'fs'
import { isUsableAuditReport, parseNpmAuditOutput } from '../../src/core/npmAuditParser.js'

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

  it('does not log when there are legitimately zero vulnerabilities', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    parseNpmAuditOutput('{"vulnerabilities":{}}', 'dependencies')
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('logs an error for malformed JSON instead of failing silently', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    parseNpmAuditOutput('not json', 'dependencies')
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('failed to parse npm audit'))
  })

  it('logs an error when the vulnerabilities key is missing or malformed', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    parseNpmAuditOutput('{"unexpected": "shape"}', 'dependencies')
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('unexpected npm audit output shape')
    )
  })
})

describe('isUsableAuditReport', () => {
  // The load-bearing case: npm audit writes this to stdout and exits non-zero when it cannot
  // reach the registry. Captured from a live run against an unreachable registry. Treating it as
  // a usable report is what made a failed audit report "0 vulnerabilities, tool used".
  const registryFailure = JSON.stringify({
    message:
      'request to https://registry.npmjs.org/-/npm/v1/security/advisories/bulk failed, reason: connect ECONNREFUSED 127.0.0.1:9',
    error: { summary: '', detail: '' },
  })

  it('rejects the npm audit registry-failure error object', () => {
    expect(isUsableAuditReport(registryFailure)).toBe(false)
  })

  it('rejects unparseable output', () => {
    expect(isUsableAuditReport('not json')).toBe(false)
    expect(isUsableAuditReport('')).toBe(false)
  })

  it('rejects a parseable object with no vulnerabilities key', () => {
    expect(isUsableAuditReport('{"unexpected": "shape"}')).toBe(false)
  })

  it('rejects a non-object vulnerabilities value', () => {
    expect(isUsableAuditReport('{"vulnerabilities": "none"}')).toBe(false)
    expect(isUsableAuditReport('null')).toBe(false)
  })

  // The discrimination that matters: a genuine clean audit must stay usable, or fixing the
  // registry-failure bug would push every healthy zero-vulnerability run into the LLM fallback.
  it('accepts a genuine clean audit with an empty vulnerabilities object', () => {
    expect(isUsableAuditReport('{"auditReportVersion":2,"vulnerabilities":{}}')).toBe(true)
  })

  it('accepts a report that contains vulnerabilities', () => {
    expect(
      isUsableAuditReport('{"vulnerabilities":{"lodash":{"severity":"high","via":[],"range":"*"}}}')
    ).toBe(true)
  })
})
