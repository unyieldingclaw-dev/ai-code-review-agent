// src/mcp/tool.ts
import { spawnSync } from 'child_process'
import { resolve } from 'path'
import { SwarmRunner } from '../core/runner.js'
import { loadConfig } from '../core/config.js'
import { OllamaProvider } from '../core/llm/ollamaProvider.js'
import { formatMcpOutput } from './formatter.js'
import { isPathWithin } from '../core/filePath.js'
import type { AgentName } from '../core/schema.js'

// testgen writes files to disk — never run it in the MCP context.
// WHY: Chat tools should not write to the project without explicit user intent.
const MCP_EXCLUDED_AGENTS: AgentName[] = ['testgen']

export interface ReviewToolParams {
  repo_path?: string
}

function gitSync(cwd: string, args: string[]): string {
  const result = spawnSync('git', ['-C', cwd, ...args], {
    encoding: 'utf-8',
    maxBuffer: 50 * 1024 * 1024,
  })
  if (result.error || result.status !== 0) return ''
  return result.stdout
}

// Opt-in scoping for repo_path, which is client-supplied -- in practice populated by whatever
// LLM/agent is calling this MCP tool from its own context, which could itself be influenced by
// injected instructions in content it previously read (see standards/AGENTIC-SAFETY.md).
// AI_REVIEW_ALLOWED_ROOTS is a comma-separated list of absolute paths; when set, repo_path must
// resolve inside one of them. There's no single "correct" workspace root to hardcode (this
// server is used across arbitrary projects), so unset means unrestricted -- fail open, matching
// this project's established convention for missing/unconfigured state (see config.ts's
// malformed-config fallback and orchestrator.ts's filterNonexistentFiles empty-changedFiles
// behavior), so this doesn't break existing single-repo MCP setups that never configured it.
function isWithinAllowedRoots(repoPath: string, allowedRoots: string[]): boolean {
  return allowedRoots.some((root) => isPathWithin(repoPath, resolve(root)))
}

export async function runReviewTool(params: ReviewToolParams): Promise<string> {
  const repoPath = resolve(params.repo_path ?? process.cwd())

  const allowedRootsEnv = process.env.AI_REVIEW_ALLOWED_ROOTS
  if (allowedRootsEnv) {
    const allowedRoots = allowedRootsEnv
      .split(',')
      .map((r) => r.trim())
      .filter(Boolean)
    if (!isWithinAllowedRoots(repoPath, allowedRoots)) {
      return (
        `## AI Code Review\n\nRefused: \`${repoPath}\` is outside the configured allowed roots ` +
        '(AI_REVIEW_ALLOWED_ROOTS). Add it to the allowlist, or unset the variable to allow any path.'
      )
    }
  }

  // --- Diff acquisition (staged → HEAD fallback) ---
  let diff: string
  try {
    diff = gitSync(repoPath, ['diff', '--cached'])
    if (!diff.trim()) {
      diff = gitSync(repoPath, ['diff', 'HEAD'])
    }
  } catch {
    return `## AI Code Review\n\nNot a git repository: \`${repoPath}\`.`
  }

  if (!diff.trim()) {
    return '## AI Code Review\n\nNo staged changes found. Stage some changes with `git add` and try again.'
  }

  // --- Config ---
  const config = loadConfig(repoPath)
  // Remove testgen regardless of what the config file says
  config.agents = config.agents.filter((a): a is AgentName => !MCP_EXCLUDED_AGENTS.includes(a))

  // --- Run swarm ---
  const provider = new OllamaProvider(config.ollamaUrl, config.model)
  const runner = new SwarmRunner(config, provider)

  try {
    const result = await runner.run({ diff, projectPath: repoPath })
    return formatMcpOutput(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (
      msg.includes('provider not available') ||
      msg.includes('ECONNREFUSED') ||
      msg.includes('fetch')
    ) {
      return `## AI Code Review\n\nOllama is not reachable at \`${config.ollamaUrl}\`. Start Ollama and try again.`
    }
    return `## AI Code Review\n\nReview failed: ${msg}`
  }
}
