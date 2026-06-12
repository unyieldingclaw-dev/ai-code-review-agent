// src/mcp/tool.ts
import { execSync } from 'child_process'
import { resolve } from 'path'
import { SwarmRunner } from '../core/runner.js'
import { loadConfig } from '../core/config.js'
import { OllamaProvider } from '../core/llm/ollamaProvider.js'
import { formatMcpOutput } from './formatter.js'
import type { AgentName } from '../core/schema.js'

// testgen writes files to disk — never run it in the MCP context.
// WHY: Chat tools should not write to the project without explicit user intent.
const MCP_EXCLUDED_AGENTS: AgentName[] = ['testgen']

export interface ReviewToolParams {
  repo_path?: string
}

export async function runReviewTool(params: ReviewToolParams): Promise<string> {
  const repoPath = resolve(params.repo_path ?? process.cwd())

  // --- Diff acquisition (staged → HEAD fallback) ---
  let diff: string
  try {
    diff = execSync(`git -C "${repoPath}" diff --cached`, { encoding: 'utf-8' })
    if (!diff.trim()) {
      diff = execSync(`git -C "${repoPath}" diff HEAD`, { encoding: 'utf-8' })
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // Friendly message for the common case of not being in a repo
    return `## AI Code Review\n\nNot a git repository: \`${repoPath}\`.\n\n_${msg}_`
  }

  if (!diff.trim()) {
    return '## AI Code Review\n\nNo staged changes found. Stage some changes with `git add` and try again.'
  }

  // --- Config ---
  const config = loadConfig(repoPath)
  // Remove testgen regardless of what the config file says
  config.agents = config.agents.filter(
    (a): a is AgentName => !MCP_EXCLUDED_AGENTS.includes(a)
  )

  // --- Run swarm ---
  const provider = new OllamaProvider(config.ollamaUrl, config.model)
  const runner = new SwarmRunner(config, provider)

  try {
    const result = await runner.run({ diff, projectPath: repoPath })
    return formatMcpOutput(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('provider not available') || msg.includes('ECONNREFUSED') || msg.includes('fetch')) {
      return `## AI Code Review\n\nOllama is not reachable at \`${config.ollamaUrl}\`. Start Ollama and try again.\n\n_${msg}_`
    }
    return `## AI Code Review\n\nReview failed: ${msg}`
  }
}
