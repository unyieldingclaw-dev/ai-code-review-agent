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
  preferredSecretsScanner?: 'gitleaks' | 'trufflehog' | 'none'
  complexityThreshold?: number
  failFast: boolean
  failOn: FailOnLevel
  parallel: boolean
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
  agentTimeoutMs: 60000,
  retryAttempts: 2,
  retryDelayMs: 2000,
  ignorePaths: [],
  sanitize: true,
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
