// tests/helpers/requireOllama.ts
//
// Use in integration tests that require a live Ollama instance.
// Call checkOllamaModel() at the top of the test file (top-level await, ESM).
// Pass the result to describe.skipIf().
//
// WHY top-level: printing the message before describe.skipIf() ensures the
// reason appears in the reporter output even when tests are skipped.
//
// Unit tests MUST NOT import this. Unit tests mock the provider entirely.

import { DEFAULT_CONFIG } from '../../src/core/config.js'

const BORDER = '╔════════════════════════════════════════════════════════════╗'
const BORDER_BOTTOM = '╚════════════════════════════════════════════════════════════╝'

function pad(text: string, width: number): string {
  return text + ' '.repeat(Math.max(0, width - text.length))
}

function row(text: string): string {
  return `║  ${pad(text, 56)}║`
}

function printSkipBox(lines: string[]): void {
  process.stderr.write('\n' + BORDER + '\n')
  for (const line of lines) process.stderr.write(row(line) + '\n')
  process.stderr.write(BORDER_BOTTOM + '\n\n')
}

export interface OllamaCheckResult {
  skip: boolean
  reason: string
}

export async function checkOllamaModel(
  ollamaUrl = DEFAULT_CONFIG.ollamaUrl,
  model = DEFAULT_CONFIG.model
): Promise<OllamaCheckResult> {
  // Check 1: Is Ollama reachable?
  let tagsResponse: Response
  try {
    tagsResponse = await fetch(`${ollamaUrl}/api/tags`, {
      signal: AbortSignal.timeout(2000),
    })
  } catch {
    printSkipBox([
      'INTEGRATION TESTS SKIPPED — Ollama not reachable',
      '',
      'Solution:',
      '  1. ollama serve',
      '  2. INTEGRATION=1 npm test',
    ])
    return { skip: true, reason: 'Ollama not reachable' }
  }

  if (!tagsResponse.ok) {
    printSkipBox([
      'INTEGRATION TESTS SKIPPED — Ollama API error',
      '',
      `  Status: ${tagsResponse.status}`,
      '',
      'Solution:',
      '  1. ollama serve',
      '  2. INTEGRATION=1 npm test',
    ])
    return { skip: true, reason: `Ollama API returned ${tagsResponse.status}` }
  }

  // Check 2: Is the required model pulled?
  const data = (await tagsResponse.json()) as { models: Array<{ name: string }> }
  const available = data.models.map((m) => m.name)
  if (!available.includes(model)) {
    printSkipBox([
      'INTEGRATION TESTS SKIPPED — model not available',
      '',
      `  Required model: ${model}`,
      '  Ollama is running but this model is not pulled.',
      '',
      'Solution:',
      `  ollama pull ${model}`,
      '  then: INTEGRATION=1 npm test',
    ])
    return { skip: true, reason: `Model ${model} not pulled` }
  }

  return { skip: false, reason: '' }
}
