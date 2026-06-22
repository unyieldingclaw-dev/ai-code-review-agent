// src/core/contextLoader.ts
//
// Loads per-agent context from a project's memory-bank/ directory.
// Only called when --context memory-bank is active.
// Budget-bounded: never loads more than CONTEXT_BUDGET_CHARS per agent.
// Treats memory-bank content as data, not instructions (sanitizer applies separately).

import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import type { AgentName } from './schema.js'

const CONTEXT_BUDGET_CHARS = 4000

// Files each agent cares about, in priority order.
// Files are loaded in order until the budget is exhausted.
// 'never blindly load every memory file' — omit activeContext.md and progress.md from most agents.
const AGENT_CONTEXT_FILES: Partial<Record<AgentName, string[]>> = {
  'security':        ['memory-bank/techContext.md'],
  'secrets':         ['memory-bank/techContext.md'],
  'design':          ['memory-bank/systemPatterns.md', 'memory-bank/projectbrief.md', 'memory-bank/techContext.md'],
  'integration':     ['memory-bank/systemPatterns.md', 'memory-bank/projectbrief.md', 'memory-bank/techContext.md'],
  'migration-safety':['memory-bank/systemPatterns.md'],
  'observability':   ['memory-bank/techContext.md'],
  'coverage':        ['memory-bank/progress.md'],
  'testgen':         ['memory-bank/progress.md'],
  'correctness':     ['memory-bank/techContext.md'],
  'dependencies':    ['memory-bank/techContext.md'],
  'breaking-change': ['memory-bank/systemPatterns.md', 'memory-bank/techContext.md'],
  // performance, adversarial, error-handling, license, complexity: no memory-bank context by default
}

export interface ContextResult {
  content: string          // formatted context string to prepend to the diff
  filesLoaded: string[]    // relative paths actually loaded
  truncated: boolean       // true if budget was hit before loading all files
  estimatedTokens: number  // rough estimate: chars / 4
}

export interface ContextMetadata {
  mode: 'none' | 'memory-bank'
  filesLoaded: string[]
  truncated: boolean
  estimatedTokens: number
}

export function loadAgentContext(projectPath: string, agentName: AgentName): ContextResult {
  const memoryBankPath = join(projectPath, 'memory-bank')
  if (!existsSync(memoryBankPath)) {
    return empty()
  }

  const targetFiles = AGENT_CONTEXT_FILES[agentName] ?? []
  if (targetFiles.length === 0) {
    return empty()
  }

  const filesLoaded: string[] = []
  const sections: string[] = []
  let charsUsed = 0
  let truncated = false

  for (const relPath of targetFiles) {
    const absPath = join(projectPath, relPath)
    if (!existsSync(absPath)) continue

    const raw = readFileSync(absPath, 'utf-8')
    const remaining = CONTEXT_BUDGET_CHARS - charsUsed

    if (remaining <= 0) {
      truncated = true
      break
    }

    const chunk = raw.length <= remaining ? raw : raw.slice(0, remaining)
    if (raw.length > remaining) truncated = true

    sections.push(`### ${relPath}\n${chunk}`)
    filesLoaded.push(relPath)
    charsUsed += chunk.length
  }

  if (sections.length === 0) return empty()

  const content = `## Project Context (memory-bank)\n\n${sections.join('\n\n')}`
  return {
    content,
    filesLoaded,
    truncated,
    estimatedTokens: Math.round(charsUsed / 4)
  }
}

function empty(): ContextResult {
  return { content: '', filesLoaded: [], truncated: false, estimatedTokens: 0 }
}
