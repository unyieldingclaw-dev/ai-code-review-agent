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
  timeoutScalingEnabled: boolean
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
  // WHY on by default: a diff at the maxDiffLines truncation point takes meaningfully longer
  // for the model to process than a small one, but agentTimeoutMs was flat regardless of size
  // -- a real bug report hit this (488s wall time, all 4 agents timing out, on a diff truncated
  // to 2000 lines). Scaling up to 2x agentTimeoutMs as diff size approaches maxDiffLines gives
  // large diffs more headroom without changing behavior for small ones. Disabled automatically
  // when --timeout is passed explicitly -- an explicit override means the user wants exactly
  // that value, not a scaled one.
  timeoutScalingEnabled: true,
  retryAttempts: 2,
  retryDelayMs: 2000,
  ignorePaths: [],
  sanitize: true,
  contextBudgetChars: 4000,
  contextMode: 'static',
  failFast: false,
  failOn: 'high',
  // WHY false by default: a "parallel by default" change was implemented and empirically tested
  // in depth (2026-07-25) before being reverted -- see memory-bank/systemPatterns.md's "Parallel
  // Execution" section for the full investigation and data. Short version: an initial 4-request,
  // trivial-prompt test showed a ~1.63x speedup, but that didn't hold at the real default scale
  // (14 agents) or with realistic diff-sized prompts -- concurrent requests queue almost fully
  // serially on this VRAM-constrained hardware (confirmed with both Node's fetch and curl,
  // ruling out a client-side artifact), and each queued request's client-side timeout clock
  // keeps running while it waits its turn, causing most of the swarm to spuriously time out.
  // `--parallel` remains available as an explicit opt-in for hardware where it's been verified
  // to actually help.
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
