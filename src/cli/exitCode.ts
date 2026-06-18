import type { Severity, FailOnLevel } from '../core/schema.js'
import { SEVERITY_RANK, FAIL_ON_OPTIONS } from '../core/schema.js'

export type { FailOnLevel }
export { FAIL_ON_OPTIONS }

export function shouldFail(severity: Severity, failOn: FailOnLevel): boolean {
  if (failOn === 'never') return false
  if (failOn === 'any') return true
  return SEVERITY_RANK[severity] >= SEVERITY_RANK[failOn as Severity]
}
