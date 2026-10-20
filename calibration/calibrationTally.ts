// Calibration oracle runs retain evidence for later mechanism-level scoring. They are not
// assertions of reviewer correctness and must never inflate the ordinary PASS count.
export class CalibrationTally {
  passed = 0
  failed = 0
  oracleUnscored = 0

  pass(): void {
    this.passed++
  }

  fail(): void {
    this.failed++
  }

  recordOracle(): void {
    this.oracleUnscored++
  }

  get hasFailures(): boolean {
    return this.failed > 0
  }

  format(model: string): string {
    const scored = `${this.passed} passed, ${this.failed} failed`
    const unscored = `${this.oracleUnscored} oracle run(s) unscored (manual classification required)`
    return `\nCalibration [${model}]: ${scored}, ${unscored}`
  }
}
