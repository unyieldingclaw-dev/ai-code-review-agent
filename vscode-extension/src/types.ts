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

export type AgentStatus = 'ok' | 'timeout' | 'parse-error' | 'error'

export interface ReviewResult {
  findings: Finding[]
  testFiles: GeneratedTestFile[]
  summary: ReviewSummary
  // Incompleteness fields. This extension is a SEPARATE package with its own hand-maintained
  // copy of the envelope, so it does not inherit changes to src/core/schema.ts -- which is
  // exactly how it came to be the only surface still rendering a green check for a truncated
  // run, a run whose agents all failed, AND a fail-fast run. It received none of that work
  // because the four-formatter rule in systemPatterns.md enumerates formatters, and this is not
  // one; it is a second renderer behind a duplicated type.
  //
  // All optional, because the extension may be pointed at an older ai-review-agent than the one
  // these fields shipped in: `renderReport` must treat absent as "not reported", never as
  // "did not happen".
  earlyExit?: { stoppedAt: string }
  agentStatus?: Partial<Record<string, AgentStatus>>
  truncation?: { truncated: boolean; originalLines: number; keptLines: number }
  agentsPlanned?: number
  chunking?: { total: number; reviewed: number }
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
