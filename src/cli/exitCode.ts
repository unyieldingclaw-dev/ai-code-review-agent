import type { Severity, FailOnLevel, AgentStatus, AgentName } from '../core/schema.js'
import { SEVERITY_RANK, FAIL_ON_OPTIONS } from '../core/schema.js'

export type { FailOnLevel }
export { FAIL_ON_OPTIONS }

export const AGENT_FAILURE_EXIT_CODE = 2
// Distinct from AGENT_FAILURE_EXIT_CODE (an agent's status came back timeout/parse-error/error --
// it ran, but its output couldn't be trusted) and the severity-gate exit code 1 (a real finding
// was found) -- a truncated-but-otherwise-clean run means every agent that ran succeeded, they
// just didn't see the whole diff. Will be wired into cli/index.ts's exit-priority logic in a
// follow-up task, so that a genuine blocker finding is never masked by "the run was also
// incomplete."
export const TRUNCATION_EXIT_CODE = 3

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
