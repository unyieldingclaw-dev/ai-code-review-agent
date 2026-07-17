import type { Severity, FailOnLevel, AgentStatus, AgentName } from '../core/schema.js'
import { SEVERITY_RANK, FAIL_ON_OPTIONS } from '../core/schema.js'

export type { FailOnLevel }
export { FAIL_ON_OPTIONS }

export const AGENT_FAILURE_EXIT_CODE = 2

export function shouldFail(severity: Severity, failOn: FailOnLevel): boolean {
  if (failOn === 'never') return false
  if (failOn === 'any') return true
  return SEVERITY_RANK[severity] >= SEVERITY_RANK[failOn as Severity]
}

export function hasAgentFailures(
  agentStatus: Partial<Record<AgentName, AgentStatus>> | undefined
): boolean {
  if (!agentStatus) return false
  return Object.values(agentStatus).some((status) => status !== 'ok')
}
