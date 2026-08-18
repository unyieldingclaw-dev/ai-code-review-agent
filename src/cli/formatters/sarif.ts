// Converts ReviewResult to SARIF 2.1.0 format for GitHub Code Scanning.

import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import type { ReviewResult, Finding, Severity } from '../../core/schema.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const { version } = JSON.parse(readFileSync(join(__dirname, '../../../package.json'), 'utf-8')) as {
  version: string
}

function severityToLevel(severity: Severity): 'error' | 'warning' | 'note' {
  if (severity === 'critical' || severity === 'high') return 'error'
  if (severity === 'medium') return 'warning'
  return 'note'
}

function findingToSarifResult(f: Finding) {
  return {
    ruleId: f.id,
    level: severityToLevel(f.severity),
    message: { text: f.title },
    locations: [
      {
        physicalLocation: {
          artifactLocation: { uri: f.file, uriBaseId: '%SRCROOT%' },
          region: {
            startLine: f.line,
            endLine: f.lineEnd !== undefined && f.lineEnd >= f.line ? f.lineEnd : f.line,
          },
        },
      },
    ],
    properties: {
      agent: f.agent,
      domain: f.domain,
      basis: f.basis,
      confidence: f.confidence ?? 70,
      impact: f.impact,
      recommendation: f.recommendation,
    },
  }
}

// WHY a standard `invocations[].executionSuccessful`/`toolExecutionNotifications` signal, not
// just the non-standard `properties.agentStatus`/`properties.truncation` below: GitHub Code
// Scanning (and most SARIF-consuming CI systems) don't surface arbitrary `properties` to a
// reviewer, but `executionSuccessful` is a first-class SARIF field many consumers do check. Before
// this, a run where every agent timed out (0 results, `properties.agentStatus` all non-"ok") was
// structurally identical to a genuinely clean scan for any consumer gating on "0 results = pass."
function buildInvocation(result: ReviewResult) {
  const failedAgents = Object.entries(result.agentStatus ?? {}).filter(
    ([, status]) => status !== 'ok'
  )
  const executionSuccessful = failedAgents.length === 0 && !result.truncation?.truncated
  const notifications = [
    ...failedAgents.map(([name, status]) => ({
      level: 'error' as const,
      message: { text: `Agent "${name}" failed: ${status} — results may be incomplete.` },
    })),
    ...(result.truncation?.truncated
      ? [
          {
            level: 'warning' as const,
            message: {
              text:
                `Diff truncated: reviewed ${result.truncation.keptLines}/` +
                `${result.truncation.originalLines} lines — findings past this point were never ` +
                `analyzed.`,
            },
          },
        ]
      : []),
  ]
  return {
    executionSuccessful,
    ...(notifications.length > 0 ? { toolExecutionNotifications: notifications } : {}),
  }
}

export function formatSarif(result: ReviewResult): string {
  const sarif = {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'ai-review-agent',
            version,
            informationUri: 'https://github.com/unyieldingclaw-dev/ai-code-review-agent',
            rules: [],
          },
        },
        results: result.findings.map(findingToSarifResult),
        invocations: [buildInvocation(result)],
        // Add run-level properties for context, policy, agent-status, and truncation metadata
        properties: {
          ...(result.context ? { context: result.context } : {}),
          ...(result.policy && result.policy.agentsSkipped.length > 0
            ? { policy: result.policy }
            : {}),
          ...(result.agentStatus ? { agentStatus: result.agentStatus } : {}),
          ...(result.truncation?.truncated ? { truncation: result.truncation } : {}),
          ...(result.hallucinationFilter && result.hallucinationFilter.dropped.length > 0
            ? { hallucinationFilter: result.hallucinationFilter }
            : {}),
          ...(result.toolAvailability ? { toolAvailability: result.toolAvailability } : {}),
          ...(result.evidenceCheckFilter
            ? { evidenceCheckFilter: result.evidenceCheckFilter }
            : {}),
        },
      },
    ],
  }
  return JSON.stringify(sarif, null, 2)
}
