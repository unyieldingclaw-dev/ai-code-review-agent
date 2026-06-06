import type { Severity } from '../core/schema.js'
import { SEVERITY_RANK } from '../core/schema.js'

export type FailOnLevel = 'critical' | 'high' | 'medium' | 'any' | 'never'

export const FAIL_ON_OPTIONS: FailOnLevel[] = ['critical', 'high', 'medium', 'any', 'never']

/** Returns true if a finding of the given severity should trigger exit code 1. */
export function shouldFail(severity: Severity, failOn: FailOnLevel): boolean {
  if (failOn === 'never') return false
  if (failOn === 'any') return true
  return SEVERITY_RANK[severity] >= SEVERITY_RANK[failOn as Severity]
}
