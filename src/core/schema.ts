export type AgentName =
  | 'security'
  | 'performance'
  | 'correctness'
  | 'design'
  | 'dependencies'
  | 'coverage'
  | 'testgen'
  | 'adversarial'
  | 'integration'
  | 'breaking-change'
  | 'license'

export type Severity = 'critical' | 'high' | 'medium' | 'low'
export type Basis = 'VERIFIED' | 'INFERRED' | 'SPECULATIVE'
export type TestFramework = 'vitest' | 'jest' | 'mocha' | 'pytest'

export interface Finding {
  id: string
  agent: AgentName
  severity: Severity
  basis: Basis
  file: string
  line: number
  title: string
  detail: string
  suggestion: string
  /** Agent's self-reported confidence 0–100. Default: 70. */
  confidence?: number
  relatedFindings?: string[]
  /** Other agent names that independently flagged the same file+line */
  corroboratingAgents?: AgentName[]
}

export interface CoverageGap {
  file: string
  functionName: string
  lineStart: number
  lineEnd: number
  description: string
}

export interface GeneratedTestFile {
  path: string
  content: string
  framework: TestFramework
}

export interface ReviewInput {
  diff: string
  contextLines?: number
  projectPath?: string
}

export interface ReviewSummary {
  totalFindings: number
  bySeverity: Partial<Record<Severity, number>>
  byAgent: Partial<Record<AgentName, number>>
  durationMs: number
}

export interface ReviewResult {
  findings: Finding[]
  testFiles: GeneratedTestFile[]
  summary: ReviewSummary
}

export const SEVERITY_RANK: Record<Severity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1
}
