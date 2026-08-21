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

// Single source of truth for "is this a real agent name" -- used by the CLI to validate
// --agents (previously an unchecked `as AgentName[]` cast let any typo silently run 0 agents).
export const AGENT_NAMES: AgentName[] = [
  'security',
  'performance',
  'correctness',
  'design',
  'dependencies',
  'coverage',
  'testgen',
  'adversarial',
  'integration',
  'breaking-change',
  'license',
  'secrets',
  'error-handling',
  'observability',
  'migration-safety',
  'complexity',
]

export type Severity = 'critical' | 'high' | 'medium' | 'low'
export const SEVERITY_OPTIONS: Severity[] = ['critical', 'high', 'medium', 'low']
export type Basis = 'VERIFIED' | 'INFERRED' | 'SPECULATIVE'
export const BASIS_OPTIONS: Basis[] = ['VERIFIED', 'INFERRED', 'SPECULATIVE']
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
  | 'npm-audit'
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
  context?: string // pre-loaded context string to prepend to diff for this agent
}

export interface ReviewSummary {
  totalFindings: number
  bySeverity: Partial<Record<Severity, number>>
  byAgent: Partial<Record<AgentName, number>>
  durationMs: number
}

export interface SanitizerMetadata {
  enabled: boolean
  applied: boolean
  redactedLines: number
  warnings: string[]
}

export interface PolicyResult {
  agentsSkipped: AgentName[]
  reason: Partial<Record<AgentName, string>>
}

export interface TruncationMetadata {
  truncated: boolean
  originalLines: number
  keptLines: number
}

export interface DroppedHallucinatedFinding {
  agent: AgentName
  title: string
  file: string
  /** Why the finding was dropped. Omitted by the file-existence filter, whose drops all share the
   *  one reason its own log line already states; set by filterUnsupportedClaims, which drops for
   *  several distinguishable reasons a report reader needs to tell apart. */
  reason?:
    | 'unsupported-injection-claim'
    | 'unsupported-exception-claim'
    | 'unsupported-null-error-claim'
    // Distinct from the three above on purpose: those mean the claimed mechanism cannot exist in
    // the code at all (a fabrication). This one means the code is real but was DELETED by the diff
    // under review -- the finding describes the pre-image. A reader triaging drops needs to tell
    // "the agent invented this" apart from "the agent reviewed the wrong side of the diff".
    | 'pre-image-only-evidence'
}

export interface HallucinationFilterMetadata {
  dropped: DroppedHallucinatedFinding[]
}

export interface DroppedCoverageGap {
  file: string
  functionName: string
}

export interface CoverageGapFilterMetadata {
  dropped: DroppedCoverageGap[]
}

export interface EvidenceCheckFinding {
  agent: AgentName
  title: string
  file: string
  line: number
  claim: string
  evidence: string
  reason: string
  preFilterAgreed: boolean | null
}

export interface EvidenceCheckFilterMetadata {
  checkedCount: number
  unavailableCount: number
  unavailableReasons: string[]
  flagged: EvidenceCheckFinding[]
}

// 'partial': the tool covered some of the reviewed surface but not all of it. Distinct from
// 'unavailable-llm-fallback', which asserts the tool did not run at all -- reporting a partial
// gitleaks scan as an unavailable one is false, and the direction that matters: it tells a reader
// to install a tool that is already installed instead of asking why files were skipped.
//
// Two producers set it, and the wording stays general because of the second: SecretsAgent, when
// gitleaks succeeded on some files and was skipped on others; and chunkRunner, when chunks of a
// --chunk run disagreed about the same tool. What covers the remainder differs by tool -- for
// gitleaks and npm audit the LLM fallback does, but ComplexityAgent always calls the LLM and lizard
// only augments its prompt -- so this deliberately does not claim a specific fallback path.
export type ToolAvailability = 'used' | 'partial' | 'unavailable-llm-fallback' | 'not-applicable'

export interface ToolAvailabilityMetadata {
  gitleaks?: ToolAvailability
  npmAudit?: ToolAvailability
  lizard?: ToolAvailability
}

// WHY this lives next to ToolAvailabilityMetadata rather than in either formatter: cli/formatter.ts
// and mcp/formatter.ts both need to name which tools degraded, and a hand-typed copy in each can
// silently drift from the schema (a new tool integration added to the interface but forgotten in a
// renderer). Keying the map off `keyof ToolAvailabilityMetadata` makes that a compile error instead:
// adding a field here fails the build until every renderer accounts for it.
export const TOOL_LABELS: Record<keyof ToolAvailabilityMetadata, string> = {
  gitleaks: 'gitleaks',
  npmAudit: 'npm audit',
  lizard: 'lizard',
}

/** Tool keys whose reported availability matches `state`, in TOOL_LABELS order. */
export function toolsWithAvailability(
  toolAvailability: ToolAvailabilityMetadata | undefined,
  state: ToolAvailability
): (keyof ToolAvailabilityMetadata)[] {
  return (Object.keys(TOOL_LABELS) as (keyof ToolAvailabilityMetadata)[]).filter(
    (t) => toolAvailability?.[t] === state
  )
}

export type AgentStatus = 'ok' | 'timeout' | 'parse-error' | 'error'

export interface ReviewResult {
  schemaVersion?: 'ai-review-agent/v1'
  toolVersion?: string
  profile?: string | null
  findings: Finding[]
  testFiles: GeneratedTestFile[]
  summary: ReviewSummary
  earlyExit?: { stoppedAt: AgentName }
  context?: {
    mode: 'none' | 'memory-bank'
    filesLoaded: string[]
    truncated: boolean
    estimatedTokens: number
  }
  sanitizer?: SanitizerMetadata
  policy?: PolicyResult
  // Sibling of PolicyResult, not a field on it: PolicyResult is only ever surfaced below when
  // agentsSkipped is non-empty (see runner.ts), but the scenario this field covers is exactly the
  // opposite case -- an agent that still RAN, just with some file sections removed from its own
  // view of the diff via agentPolicy.exclude (see Task 7). Nesting inside PolicyResult would mean
  // this field never appears in the one case it exists to report.
  filteredFiles?: Partial<Record<AgentName, string[]>>
  agentStatus?: Partial<Record<AgentName, AgentStatus>>
  truncation?: TruncationMetadata
  hallucinationFilter?: HallucinationFilterMetadata
  coverageGapFilter?: CoverageGapFilterMetadata
  evidenceCheckFilter?: EvidenceCheckFilterMetadata
  toolAvailability?: ToolAvailabilityMetadata
}

export const SEVERITY_RANK: Record<Severity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
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
