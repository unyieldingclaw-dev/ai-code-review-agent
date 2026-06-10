import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import type { AgentName } from './schema.js'

const VALID_AGENT_NAMES = new Set<AgentName>([
  'security', 'performance', 'correctness', 'design', 'dependencies',
  'coverage', 'testgen', 'adversarial', 'integration', 'breaking-change', 'license'
])

const ALLOWED_OLLAMA_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1'])

export interface ReviewConfig {
  model: string
  ollamaUrl: string
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
  ollamaUrl: 'http://localhost:11434',
  maxFindings: 15,
  agents: [
    'security', 'performance', 'correctness', 'design', 'dependencies',
    'coverage', 'testgen', 'adversarial', 'integration', 'breaking-change', 'license'
  ],
  contextLines: 10,
  testOutputDir: './ai-review-tests',
  maxDiffLines: 2000,
  agentTimeoutMs: 60000,
  ignorePaths: [],
  sanitize: true
}

const ALLOWED_CONFIG_KEYS = new Set<keyof ReviewConfig>([
  'model', 'ollamaUrl', 'maxFindings', 'agents', 'contextLines',
  'testOutputDir', 'maxDiffLines', 'agentTimeoutMs', 'ignorePaths', 'sanitize'
])

function sanitizePartial(raw: Record<string, unknown>): Partial<ReviewConfig> {
  const result: Partial<ReviewConfig> = {}
  for (const key of Object.keys(raw) as (keyof ReviewConfig)[]) {
    if (ALLOWED_CONFIG_KEYS.has(key)) {
      (result as Record<string, unknown>)[key] = raw[key]
    }
  }
  return result
}

export function loadConfig(projectPath: string): ReviewConfig {
  const configPath = join(projectPath, 'ai-review.config.json')
  if (!existsSync(configPath)) return { ...DEFAULT_CONFIG }
  try {
    const raw = readFileSync(configPath, 'utf-8')
    const partial = sanitizePartial(JSON.parse(raw) as Record<string, unknown>)
    const merged = { ...DEFAULT_CONFIG, ...partial }

    if (partial.ollamaUrl !== undefined) {
      try {
        const parsed = new URL(merged.ollamaUrl)
        if (!ALLOWED_OLLAMA_HOSTS.has(parsed.hostname)) {
          console.warn(`[ai-review] Config: ollamaUrl must point to localhost. Using default.`)
          merged.ollamaUrl = DEFAULT_CONFIG.ollamaUrl
        }
      } catch {
        console.warn(`[ai-review] Config: ollamaUrl is invalid. Using default.`)
        merged.ollamaUrl = DEFAULT_CONFIG.ollamaUrl
      }
    }

    if (partial.agents !== undefined) {
      const validAgents = (merged.agents as unknown[]).filter(
        (a): a is AgentName => typeof a === 'string' && VALID_AGENT_NAMES.has(a as AgentName)
      )
      merged.agents = validAgents.length > 0 ? validAgents : DEFAULT_CONFIG.agents
    }

    return merged
  } catch {
    console.warn(`[ai-review] Failed to parse ai-review.config.json — using defaults.`)
    return { ...DEFAULT_CONFIG }
  }
}
