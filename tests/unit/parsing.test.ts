// tests/unit/parsing.test.ts
import { describe, it, expect } from 'vitest'
import {
  ParseFailureError,
  extractBalancedSpan,
  extractCompleteObjects,
} from '../../src/core/parsing.js'

describe('ParseFailureError', () => {
  it('is an Error subclass carrying the agent name and a raw-output snippet', () => {
    const err = new ParseFailureError('security', 'not json at all, just prose from the model')
    expect(err).toBeInstanceOf(Error)
    expect(err.agentName).toBe('security')
    expect(err.message).toContain('security')
    expect(err.message).toContain('not json at all')
  })
})

describe('extractBalancedSpan', () => {
  it('extracts a complete array span', () => {
    expect(extractBalancedSpan('prefix [1,2,3] suffix', '[', ']')).toBe('[1,2,3]')
  })

  it('returns null when the span never closes (truncated)', () => {
    expect(extractBalancedSpan('[1,2,3', '[', ']')).toBeNull()
  })

  it('returns null when the open char never appears', () => {
    expect(extractBalancedSpan('no brackets here', '[', ']')).toBeNull()
  })

  it('does not miscount brackets inside string values', () => {
    expect(extractBalancedSpan('[{"a":"]not a close]"}]', '[', ']')).toBe('[{"a":"]not a close]"}]')
  })

  it('does not miscount an escaped quote as ending a string', () => {
    expect(extractBalancedSpan('[{"a":"esc\\"aped"}]', '[', ']')).toBe('[{"a":"esc\\"aped"}]')
  })
})

describe('extractCompleteObjects', () => {
  it('recovers a complete object preceding a truncated one', () => {
    const text = '[{"a":1},{"b":2'
    expect(extractCompleteObjects(text)).toEqual([{ a: 1 }])
  })

  it('recovers multiple complete objects', () => {
    const text = '[{"a":1},{"b":2}]'
    expect(extractCompleteObjects(text)).toEqual([{ a: 1 }, { b: 2 }])
  })

  it('returns an empty array for empty or whitespace-only input', () => {
    expect(extractCompleteObjects('')).toEqual([])
    expect(extractCompleteObjects('   \n  ')).toEqual([])
  })

  it('does not miscount a brace inside a string field value', () => {
    const text = '{"detail":"if (x) { return y }"}'
    expect(extractCompleteObjects(text)).toEqual([{ detail: 'if (x) { return y }' }])
  })

  it('does not desync on a stray unmatched close-brace before real content', () => {
    // Regression test: a leading unmatched "}" previously drove the internal depth counter
    // negative and permanently prevented every later object in the text from being recovered.
    const text = '}{"a":1}{"b":2}'
    expect(extractCompleteObjects(text)).toEqual([{ a: 1 }, { b: 2 }])
  })
})
