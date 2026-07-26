// src/core/contextLoader.ts
//
// Loads per-agent context from a project's memory-bank/ directory.
// Only called when --context memory-bank is active.
// Budget-bounded: never loads more than budgetChars per agent.
// Content returned here is data, not instructions -- runner.ts's withContext() runs it through
// sanitizeText() (src/core/sanitizer.ts) before prepending it to any agent's prompt, the same
// protection sanitizeDiff() gives the diff itself.

import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import type { AgentName } from './schema.js'
import { embed, cosineSimilarity } from './embedder.js'

// All five core memory-bank files that semantic selection considers
const ALL_MEMORY_FILES = [
  'memory-bank/projectbrief.md',
  'memory-bank/systemPatterns.md',
  'memory-bank/techContext.md',
  'memory-bank/activeContext.md',
  'memory-bank/progress.md',
]

// Files each agent cares about, in priority order.
// Files are loaded in order until the budget is exhausted.
// 'never blindly load every memory file' — omit activeContext.md and progress.md from most agents.
const AGENT_CONTEXT_FILES: Partial<Record<AgentName, string[]>> = {
  security: ['memory-bank/techContext.md'],
  secrets: ['memory-bank/techContext.md'],
  design: [
    'memory-bank/systemPatterns.md',
    'memory-bank/projectbrief.md',
    'memory-bank/techContext.md',
  ],
  integration: [
    'memory-bank/systemPatterns.md',
    'memory-bank/projectbrief.md',
    'memory-bank/techContext.md',
  ],
  'migration-safety': ['memory-bank/systemPatterns.md'],
  observability: ['memory-bank/techContext.md'],
  coverage: ['memory-bank/progress.md'],
  testgen: ['memory-bank/progress.md'],
  correctness: ['memory-bank/techContext.md'],
  dependencies: ['memory-bank/techContext.md'],
  'breaking-change': ['memory-bank/systemPatterns.md', 'memory-bank/techContext.md'],
  // performance, adversarial, error-handling, license, complexity: no memory-bank context by default
}

export interface ContextResult {
  content: string // formatted context string to prepend to the diff
  filesLoaded: string[] // relative paths actually loaded
  truncated: boolean // true if budget was hit before loading all files
  estimatedTokens: number // rough estimate: chars / 4
}

export interface ContextMetadata {
  mode: 'none' | 'memory-bank'
  filesLoaded: string[]
  truncated: boolean
  estimatedTokens: number
}

export function loadAgentContext(
  projectPath: string,
  agentName: AgentName,
  budgetChars = 4000
): ContextResult {
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
    const remaining = budgetChars - charsUsed

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
    estimatedTokens: Math.round(charsUsed / 4),
  }
}

export async function loadAgentContextSemantic(
  projectPath: string,
  diff: string,
  ollamaUrl: string,
  budgetChars = 4000
): Promise<ContextResult> {
  const memoryBankPath = join(projectPath, 'memory-bank')
  if (!existsSync(memoryBankPath)) return empty()

  // Get embedding for the diff (use first 2000 chars to stay within model limits)
  const diffSnippet = diff.slice(0, 2000)
  const diffEmbedding = await embed(ollamaUrl, diffSnippet)
  if (!diffEmbedding) {
    process.stderr.write(
      '[ai-review] --context-mode semantic: nomic-embed-text unavailable — ' +
        'run `ollama pull nomic-embed-text` to enable semantic context selection. ' +
        'Continuing without memory-bank context.\n'
    )
    return empty()
  }

  // Embed each available memory-bank file and rank by similarity
  const ranked: Array<{ relPath: string; content: string; score: number }> = []

  for (const relPath of ALL_MEMORY_FILES) {
    const absPath = join(projectPath, relPath)
    if (!existsSync(absPath)) continue
    const content = readFileSync(absPath, 'utf-8')
    // Embed a snippet of each file (first 500 chars captures frontmatter + key content)
    const fileEmbedding = await embed(ollamaUrl, content.slice(0, 500))
    if (!fileEmbedding) continue
    const score = cosineSimilarity(diffEmbedding, fileEmbedding)
    ranked.push({ relPath, content, score })
  }

  // Sort by similarity descending
  ranked.sort((a, b) => b.score - a.score)

  // Load top files within budget
  const filesLoaded: string[] = []
  const sections: string[] = []
  let charsUsed = 0
  let truncated = false

  for (const { relPath, content } of ranked) {
    const remaining = budgetChars - charsUsed
    if (remaining <= 0) {
      truncated = true
      break
    }
    const chunk = content.length <= remaining ? content : content.slice(0, remaining)
    if (content.length > remaining) truncated = true
    sections.push(`### ${relPath}\n${chunk}`)
    filesLoaded.push(relPath)
    charsUsed += chunk.length
  }

  if (sections.length === 0) return empty()

  return {
    content: `## Project Context (memory-bank — semantic selection)\n\n${sections.join('\n\n')}`,
    filesLoaded,
    truncated,
    estimatedTokens: Math.round(charsUsed / 4),
  }
}

function empty(): ContextResult {
  return { content: '', filesLoaded: [], truncated: false, estimatedTokens: 0 }
}
