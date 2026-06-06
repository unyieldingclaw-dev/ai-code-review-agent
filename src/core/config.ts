import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import type { AgentName } from './schema.js'

export interface ReviewConfig {
  model: string
  provider: 'ollama' | 'anthropic'
  ollamaUrl: string
  anthropicModel: string
  maxFindings: number
  agents: AgentName[]
  contextLines: number
  testOutputDir: string
  maxDiffLines: number
  agentTimeoutMs: number
  ignorePaths: string[]
  sanitize: boolean
}

export const DEFAULT_CONFIG: ReviewConfig = {
  model: 'devstral:latest',
  provider: 'ollama',
  ollamaUrl: 'http://localhost:11434',
  anthropicModel: 'claude-sonnet-4-5',
  maxFindings: 15,
  agents: [
    'security', 'performance', 'correctness', 'design', 'dependencies',
    'coverage', 'testgen', 'adversarial', 'integration', 'breaking-change'
  ],
  contextLines: 10,
  testOutputDir: './ai-review-tests',
  maxDiffLines: 2000,
  agentTimeoutMs: 60000,
  ignorePaths: [],
  sanitize: true
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
