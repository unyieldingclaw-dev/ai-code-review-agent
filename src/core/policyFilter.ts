// src/core/policyFilter.ts
// Evaluates per-agent include/exclude glob policies against changed file paths.

import type { AgentName, PolicyResult } from './schema.js'
import type { ReviewConfig } from './config.js'
import { matchPattern } from './ignoreFilter.js'

function matchesAny(files: string[], patterns: string[]): boolean {
  return files.some((f) => patterns.some((p) => matchPattern(f, p)))
}

function matchesAll(files: string[], patterns: string[]): boolean {
  return files.every((f) => patterns.some((p) => matchPattern(f, p)))
}

export function evaluatePolicy(
  agents: AgentName[],
  changedFiles: string[],
  config: ReviewConfig
): { allowed: AgentName[]; policy: PolicyResult } {
  const policy: PolicyResult = { agentsSkipped: [], reason: {} }

  if (!config.agentPolicy || changedFiles.length === 0) {
    return { allowed: agents, policy }
  }

  const allowed: AgentName[] = []
  for (const agent of agents) {
    const rule = config.agentPolicy[agent]
    if (!rule) {
      allowed.push(agent)
      continue
    }

    // include: agent only runs if at least one changed file matches
    if (rule.include && rule.include.length > 0) {
      if (!matchesAny(changedFiles, rule.include)) {
        policy.agentsSkipped.push(agent)
        policy.reason[agent] =
          `no changed files matched include patterns: ${rule.include.join(', ')}`
        continue
      }
    }

    // exclude: agent is skipped if ALL changed files match exclude patterns
    if (rule.exclude && rule.exclude.length > 0) {
      if (matchesAll(changedFiles, rule.exclude)) {
        policy.agentsSkipped.push(agent)
        policy.reason[agent] =
          `all changed files matched exclude patterns: ${rule.exclude.join(', ')}`
        continue
      }
    }

    allowed.push(agent)
  }

  return { allowed, policy }
}

/** Extract changed file paths from a unified diff string */
export function extractChangedFiles(diff: string): string[] {
  const files = new Set<string>()
  const lines = diff.split('\n')
  for (const line of lines) {
    // Match: +++ b/path/to/file
    const m = line.match(/^\+\+\+ b\/(.+)$/)
    if (m && m[1] !== '/dev/null') files.add(m[1])
  }
  return [...files]
}
