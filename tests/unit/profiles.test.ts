import { describe, it, expect } from 'vitest'
import { PROFILES, resolveProfile } from '../../src/core/profiles.js'

describe('PROFILES', () => {
  it('has a fast profile with 3 agents', () => {
    expect(PROFILES.fast).toHaveLength(3)
    expect(PROFILES.fast).toContain('security')
    expect(PROFILES.fast).toContain('correctness')
    expect(PROFILES.fast).toContain('secrets')
  })

  it('has a full profile with all 15 default agents', () => {
    expect(PROFILES.full).toHaveLength(15)
    expect(PROFILES.full).not.toContain('testgen')
  })

  it('has a change-review profile', () => {
    expect(PROFILES['change-review']).toBeDefined()
    expect(PROFILES['change-review'].length).toBeGreaterThan(0)
  })

  it('no profile contains testgen', () => {
    for (const [name, agents] of Object.entries(PROFILES)) {
      expect(agents, `profile ${name} should not include testgen`).not.toContain('testgen')
    }
  })
})

describe('resolveProfile', () => {
  it('returns agents for a valid profile name', () => {
    expect(resolveProfile('fast')).toEqual(PROFILES.fast)
  })

  it('throws with helpful message for unknown profile', () => {
    expect(() => resolveProfile('nonexistent')).toThrow(/unknown profile/i)
    expect(() => resolveProfile('nonexistent')).toThrow(/fast|full|change-review/)
  })

  it('is case-sensitive', () => {
    expect(() => resolveProfile('Fast')).toThrow()
  })
})
