// Local mirrors of ai-review-agent's core/schema.ts types.
// Structural mirror only — do not import from the package to avoid ESM/CJS mismatch.

export type Severity = 'critical' | 'high' | 'medium' | 'low'

export interface Finding {
  id: string
  agent: string
  severity: Severity
  basis: string
  file: string
  line: number // 1-based line number in the source file
  title: string
  detail: string
  suggestion: string
  confidence?: number
  corroboratingAgents?: string[]
  relatedFindings?: string[]
}

export interface ReviewSummary {
  totalFindings: number
  bySeverity: Partial<Record<Severity, number>>
  byAgent: Partial<Record<string, number>>
  durationMs: number
}

export interface GeneratedTestFile {
  path: string
  content: string
  framework: string
}

export interface ReviewResult {
  findings: Finding[]
  testFiles: GeneratedTestFile[]
  summary: ReviewSummary
}

export interface ExtensionConfig {
  ollamaUrl: string
  model: string
  agents: string[] // empty = all agents
  profile: string // named agent subset; overrides agents when set
  contextMode: string // 'none' | 'memory-bank' | 'memory-bank-semantic'
  maxLines: number
  timeoutSecs: number // seconds; converted to ms before passing to CLI
  cliPath: string // absolute path to bundled CLI index.js
}
