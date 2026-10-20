import { describe, expect, it } from 'vitest'
import { CalibrationTally } from '../../calibration/calibrationTally.js'

describe('CalibrationTally', () => {
  it('does not count an oracle measurement as a review-quality pass', () => {
    const tally = new CalibrationTally()
    tally.recordOracle()
    expect(tally.passed).toBe(0)
    expect(tally.failed).toBe(0)
    expect(tally.oracleUnscored).toBe(1)
    expect(tally.hasFailures).toBe(false)
    expect(tally.format('test-model')).toContain('0 passed, 0 failed, 1 oracle run(s) unscored')
    expect(tally.format('test-model')).toContain('manual classification required')
  })

  it('keeps scored failures separate from unscored measurements', () => {
    const tally = new CalibrationTally()
    tally.pass()
    tally.fail()
    tally.recordOracle()
    expect(tally.format('model')).toContain('1 passed, 1 failed, 1 oracle run(s) unscored')
    expect(tally.hasFailures).toBe(true)
  })

  it('does not turn an unscored oracle run into an error or approval', () => {
    const tally = new CalibrationTally()
    tally.recordOracle()
    tally.recordOracle()
    expect(tally.format('model')).toContain('0 passed, 0 failed, 2 oracle run(s) unscored')
  })
})
