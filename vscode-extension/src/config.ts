import * as vscode from 'vscode'
import * as path from 'path'
import type { ExtensionConfig } from './types'

// Guardrail constants mirroring pinned ai-review-agent@1.15.0 defaults (dist/core/config.js,
// dist/core/profiles.js, dist/core/runner.js). Deliberately approximate: does not read
// project-level ai-review.config.json overrides or budget for non-timeout retries.
const CLI_DEFAULT_AGENT_TIMEOUT_MS = 180_000
const CLI_TIMEOUT_SCALE_CAP = 2
const DEFAULT_AGENT_COUNT = 15
const SUBPROCESS_OVERHEAD_MS = 60_000
// 60-minute hard safety ceiling; clamps 15-agent full profile at >=623 diff lines (maxLines=2000).
const MAX_SUBPROCESS_TIMEOUT_MS = 60 * 60 * 1000

const PROFILE_AGENT_COUNTS: Record<string, number> = {
  fast: 3,
  security: 4,
  migration: 4,
  ui: 5,
  'change-review': 8,
  full: 15,
}

function hasExplicitTimeout(timeoutSecs: number): boolean {
  return Number.isFinite(timeoutSecs) && timeoutSecs > 0
}

/**
 * Read aiReview.* settings from the VS Code workspace configuration and
 * resolve the bundled CLI path relative to the extension install directory.
 */
export function getConfig(extensionPath: string): ExtensionConfig {
  const cfg = vscode.workspace.getConfiguration('aiReview')

  return {
    ollamaUrl: cfg.get('ollamaUrl', 'http://localhost:11434'),
    model: cfg.get('model', 'devstral:latest'),
    agents: cfg.get<string[]>('agents', []),
    profile: cfg.get('profile', ''),
    contextMode: cfg.get('contextMode', 'none'),
    maxLines: cfg.get('maxLines', 2000),
    timeoutSecs: cfg.get('timeout', 0),
    cliPath: path.join(extensionPath, 'node_modules', 'ai-review-agent', 'dist', 'cli', 'index.js'),
  }
}

/**
 * Calculate a bounded outer subprocess timeout guardrail from the selected
 * agent roster and effective per-agent timeout. Mirrors CLI 1.15.0 precedence
 * (--agents over --profile) and diff-size scaling when timeoutSecs is 0.
 */
export function calculateSubprocessTimeoutMs(config: ExtensionConfig, diffLines: number): number {
  const nonEmptyAgents = config.agents.filter((a) => a.trim().length > 0)
  const agentCount =
    nonEmptyAgents.length > 0
      ? nonEmptyAgents.length
      : (PROFILE_AGENT_COUNTS[config.profile] ?? DEFAULT_AGENT_COUNT)

  let effectiveAgentTimeoutMs: number
  if (hasExplicitTimeout(config.timeoutSecs)) {
    effectiveAgentTimeoutMs = Math.round(config.timeoutSecs * 1000)
  } else {
    const keptLines = config.maxLines > 0 ? Math.min(Math.max(0, diffLines), config.maxLines) : 0
    const ratio = config.maxLines > 0 ? keptLines / config.maxLines : 0
    effectiveAgentTimeoutMs = Math.round(
      CLI_DEFAULT_AGENT_TIMEOUT_MS * (1 + (CLI_TIMEOUT_SCALE_CAP - 1) * ratio)
    )
  }

  return Math.min(
    agentCount * effectiveAgentTimeoutMs + SUBPROCESS_OVERHEAD_MS,
    MAX_SUBPROCESS_TIMEOUT_MS
  )
}

/**
 * Build the argument array for spawning the CLI subprocess.
 * The caller provides the temp diff file path; omits --timeout when timeoutSecs <= 0
 * so CLI 1.15.0 keeps its default timeout and automatic diff-size scaling.
 */
export function buildCliArgs(
  config: ExtensionConfig,
  workspaceDir: string,
  diffFile: string
): string[] {
  const args = [
    config.cliPath,
    '--diff',
    diffFile,
    '--dir',
    workspaceDir,
    '--format',
    'json',
    '--ollama-url',
    config.ollamaUrl,
    '--model',
    config.model,
    '--max-lines',
    String(config.maxLines),
    '--fail-on',
    'never', // extension handles results; never let CLI gate on exit code
  ]

  if (hasExplicitTimeout(config.timeoutSecs)) {
    args.push('--timeout', String(Math.round(config.timeoutSecs * 1000)))
  }

  if (config.agents.length > 0) {
    args.push('--agents', config.agents.join(','))
  }

  if (config.profile) {
    args.push('--profile', config.profile)
  }

  if (config.contextMode !== 'none') {
    args.push('--context', 'memory-bank')
    if (config.contextMode === 'memory-bank-semantic') {
      args.push('--context-mode', 'semantic')
    }
  }

  return args
}
