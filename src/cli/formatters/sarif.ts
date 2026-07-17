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
        // Add run-level properties for context and policy metadata
        properties: {
          ...(result.context ? { context: result.context } : {}),
          ...(result.policy && result.policy.agentsSkipped.length > 0
            ? { policy: result.policy }
            : {}),
          ...(result.agentStatus ? { agentStatus: result.agentStatus } : {}),
        },
      },
    ],
  }
  return JSON.stringify(sarif, null, 2)
}
