import type { Severity, FailOnLevel, AgentStatus, AgentName } from '../core/schema.js'
import { SEVERITY_RANK, FAIL_ON_OPTIONS } from '../core/schema.js'

export type { FailOnLevel }
export { FAIL_ON_OPTIONS }

export const AGENT_FAILURE_EXIT_CODE = 2
// Distinct from AGENT_FAILURE_EXIT_CODE (an agent's status came back timeout/parse-error/error --
// it ran, but its output couldn't be trusted) and the severity-gate exit code 1 (a real finding
// was found) -- a truncated-but-otherwise-clean run means every agent that ran succeeded, they
// just didn't see the whole diff. Ranked in cli/index.ts's exit-priority chain below both of
// those, so a genuine blocker finding is never masked by "the run was also incomplete."
export const TRUNCATION_EXIT_CODE = 3
// Distinct from exit 1 (a real blocking finding was found): this covers every error caught by
// the action handler's top-level try/catch -- Ollama unreachable, the configured model missing,
// the diff file not found, a write failure on --out, etc. Before this code existed, all of these
// collapsed into exit 1, the same code as "review ran clean and found a blocker" -- a CI script
// branching only on `exit code === 1` to "read the report" would find no report was ever
// produced. This code means exactly one thing: the tool did not complete a review run at all.
export const STARTUP_FAILURE_EXIT_CODE = 4

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
