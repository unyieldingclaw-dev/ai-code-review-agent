// tests/unit/parsing.test.ts
import { describe, it, expect } from 'vitest'
import { ParseFailureError } from '../../src/core/parsing.js'

describe('ParseFailureError', () => {
  it('is an Error subclass carrying the agent name and a raw-output snippet', () => {
    const err = new ParseFailureError('security', 'not json at all, just prose from the model')
    expect(err).toBeInstanceOf(Error)
    expect(err.agentName).toBe('security')
    expect(err.message).toContain('security')
    expect(err.message).toContain('not json at all')
  })
})
