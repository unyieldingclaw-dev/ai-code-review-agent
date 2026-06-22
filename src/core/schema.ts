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
  | 'secrets'
  | 'error-handling'
  | 'observability'
  | 'migration-safety'
  | 'complexity'

export type Severity = 'critical' | 'high' | 'medium' | 'low'
export type Basis = 'VERIFIED' | 'INFERRED' | 'SPECULATIVE'
export type TestFramework = 'vitest' | 'jest' | 'mocha' | 'pytest'

export type ReviewDomain =
  | 'Security'
  | 'Correctness'
  | 'Performance'
  | 'Maintainability'
  | 'Testing'
  | 'Architecture Drift'
  | 'Dependencies'
  | 'Secrets'
  | 'Migration Safety'
  | 'License'
  | 'Observability'
  | 'Complexity'
  | 'Integration'
  | 'Breaking Change'
  | 'Error Handling'
  | 'Adversarial'

export type EvidenceSource =
  | 'llm'
  | 'heuristic'
  | 'gitleaks'
  | 'trufflehog'
  | 'semgrep'
  | 'npm-audit'
  | 'osv'
  | 'lizard'
  | 'git'
  | 'policy'

export interface Finding {
  id: string
  agent: AgentName
  domain: ReviewDomain
  severity: Severity
  basis: Basis
  file: string
  line: number
  lineEnd?: number
  title: string
  detail: string
  evidence: string
  impact: string
  recommendation: string
  /** @deprecated use recommendation */
  suggestion: string
  blocking: boolean
  source: EvidenceSource
  confidence?: number
  relatedFindings?: string[]
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
  earlyExit?: { stoppedAt: AgentName }
}

export const SEVERITY_RANK: Record<Severity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1
}

export type FailOnLevel = 'critical' | 'high' | 'medium' | 'any' | 'never'
export const FAIL_ON_OPTIONS: FailOnLevel[] = ['critical', 'high', 'medium', 'any', 'never']

export interface AgentProgressEvent {
  phase: 'start' | 'end'
  name: AgentName
  index: number
  total: number
  findings?: Finding[]
  elapsedMs?: number
  earlyExit?: boolean
}
