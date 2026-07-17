import { describe, it, expect } from 'vitest'
import { shouldFail, hasAgentFailures, AGENT_FAILURE_EXIT_CODE } from '../../src/cli/exitCode.js'

describe('shouldFail', () => {
  it('never returns false for any severity', () => {
    expect(shouldFail('critical', 'never')).toBe(false)
    expect(shouldFail('high', 'never')).toBe(false)
    expect(shouldFail('medium', 'never')).toBe(false)
    expect(shouldFail('low', 'never')).toBe(false)
  })

  it('any returns true for every severity', () => {
    expect(shouldFail('critical', 'any')).toBe(true)
    expect(shouldFail('high', 'any')).toBe(true)
    expect(shouldFail('medium', 'any')).toBe(true)
    expect(shouldFail('low', 'any')).toBe(true)
  })

  it('high triggers on critical and high, not medium or low', () => {
    expect(shouldFail('critical', 'high')).toBe(true)
    expect(shouldFail('high', 'high')).toBe(true)
    expect(shouldFail('medium', 'high')).toBe(false)
    expect(shouldFail('low', 'high')).toBe(false)
  })

  it('critical triggers only on critical', () => {
    expect(shouldFail('critical', 'critical')).toBe(true)
    expect(shouldFail('high', 'critical')).toBe(false)
    expect(shouldFail('medium', 'critical')).toBe(false)
  })

  it('medium triggers on critical, high, and medium', () => {
    expect(shouldFail('critical', 'medium')).toBe(true)
    expect(shouldFail('high', 'medium')).toBe(true)
    expect(shouldFail('medium', 'medium')).toBe(true)
    expect(shouldFail('low', 'medium')).toBe(false)
  })
})

describe('hasAgentFailures', () => {
  it('returns false when agentStatus is undefined', () => {
    expect(hasAgentFailures(undefined)).toBe(false)
  })

  it('returns false when every agent status is ok', () => {
    expect(hasAgentFailures({ security: 'ok', correctness: 'ok' })).toBe(false)
  })

  it('returns true when any agent status is not ok', () => {
    expect(hasAgentFailures({ security: 'ok', correctness: 'timeout' })).toBe(true)
  })
})

describe('AGENT_FAILURE_EXIT_CODE', () => {
  it('is distinct from the severity-gate exit code (1) and the clean exit code (0)', () => {
    expect(AGENT_FAILURE_EXIT_CODE).toBe(2)
  })
})
