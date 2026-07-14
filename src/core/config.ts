import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import type { AgentName, FailOnLevel } from './schema.js'

export interface ReviewConfig {
  model: string
  provider: 'ollama'
  ollamaUrl: string
  maxFindings: number
  agents: AgentName[]
  testOutputDir: string
  maxDiffLines: number
  agentTimeoutMs: number
  retryAttempts: number
  retryDelayMs: number
  ignorePaths: string[]
  sanitize: boolean
  contextBudgetChars: number
  contextMode?: 'static' | 'semantic'
  preferredSecretsScanner?: 'gitleaks' | 'trufflehog' | 'none'
  complexityThreshold?: number
  failFast: boolean
  failOn: FailOnLevel
  parallel: boolean
  agentPolicy?: Partial<
    Record<
      AgentName,
      {
        include?: string[] // agent only runs if a changed file matches at least one pattern
        exclude?: string[] // agent is skipped if ALL changed files match exclude patterns
      }
    >
  >
}

export const DEFAULT_CONFIG: ReviewConfig = {
  model: 'devstral:latest',
  provider: 'ollama',
  ollamaUrl: 'http://localhost:11434',
  maxFindings: 15,
  agents: [
    'security',
    'performance',
    'correctness',
    'design',
    'dependencies',
    'coverage',
    'adversarial',
    'integration',
    'breaking-change',
    'license',
    'error-handling',
    'observability',
    'migration-safety',
    'secrets',
    'complexity',
  ],
  testOutputDir: './ai-review-tests',
  maxDiffLines: 2000,
  // 60s was too tight for devstral:latest (23.6B) on VRAM-constrained hardware where it's
  // partially CPU-offloaded — a realistic diff-sized prompt can take well over a minute to
  // generate. 180s aligns with the 5-minute ceiling OllamaProvider already assumed
  // (DEFAULT_TIMEOUT_MS) without being needlessly long for fast hardware.
  agentTimeoutMs: 180000,
  retryAttempts: 2,
  retryDelayMs: 2000,
  ignorePaths: [],
  sanitize: true,
  contextBudgetChars: 4000,
  contextMode: 'static',
  failFast: false,
  failOn: 'high',
  parallel: false,
}

export function loadConfig(projectPath: string): ReviewConfig {
  const configPath = join(projectPath, 'ai-review.config.json')
  if (!existsSync(configPath)) return { ...DEFAULT_CONFIG }
  try {
    const raw = readFileSync(configPath, 'utf-8')
    const partial = JSON.parse(raw) as Partial<ReviewConfig>
    return { ...DEFAULT_CONFIG, ...partial }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}
