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
