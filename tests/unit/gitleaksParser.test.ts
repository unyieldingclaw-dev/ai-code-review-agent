import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'fs'
import { parseGitleaksOutput } from '../../src/core/gitleaksParser.js'

describe('parseGitleaksOutput', () => {
  it('returns an empty array for a clean scan', () => {
    const raw = readFileSync('tests/fixtures/gitleaks-clean.json', 'utf-8')
    const findings = parseGitleaksOutput(raw, 'secrets')
    expect(findings).toEqual([])
  })

  it('does not log an error for a legitimately clean scan', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const raw = readFileSync('tests/fixtures/gitleaks-clean.json', 'utf-8')
    parseGitleaksOutput(raw, 'secrets')
    expect(errorSpy).not.toHaveBeenCalled()
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

  it('logs an error for malformed JSON instead of failing silently', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    parseGitleaksOutput('not json at all', 'secrets')
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('failed to parse gitleaks'))
  })

  it('logs an error when the parsed JSON is not an array', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    parseGitleaksOutput('{"unexpected": "shape"}', 'secrets')
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('unexpected gitleaks output shape')
    )
  })
})
