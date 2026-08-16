// One-off diagnostic (not part of the default test suite -- makes real Ollama calls) to
// determine WHY every agent hit response truncation in the reported bug (see
// docs/superpowers/specs/2026-08-16-review-reliability-fixes-design.md, Issue 2). Sends a
// realistically large diff-review prompt (matching what SecurityAgent actually sends) via a raw
// fetch to Ollama's /api/chat -- deliberately bypassing OllamaProvider.chat(), which only returns
// message.content and discards the prompt_eval_count/eval_count/done_reason fields this
// diagnostic needs. Run manually:
//   npx tsx calibration/responseTruncationDiagnostic.ts [path/to/large.diff]
import { readFileSync } from 'fs'
import { SecurityAgent } from '../src/core/agents/security.js'
import { DEFAULT_CONFIG } from '../src/core/config.js'
import type { LLMProvider, Message } from '../src/core/llm/provider.js'

const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://localhost:11434'
const MODEL = process.env.OLLAMA_MODEL ?? DEFAULT_CONFIG.model
const diffPath = process.argv[2]

if (!diffPath) {
  console.error('Usage: npx tsx calibration/responseTruncationDiagnostic.ts <path/to/large.diff>')
  process.exit(1)
}

// Mirrors OllamaProvider's own supportsThinking() gate (src/core/llm/ollamaProvider.ts) -- only
// qwen*/deepseek-r1* models accept `think: true`; devstral (this project's default model) errors
// with HTTP 400 ("does not support thinking") if it's sent unconditionally. Replicating the gate
// here keeps this diagnostic's request shape identical to what production actually sends.
function supportsThinking(model: string): boolean {
  const m = model.toLowerCase()
  return m.startsWith('qwen') || m.startsWith('deepseek-r1')
}

// Raw fetch, not OllamaProvider -- OllamaProvider.chat() only returns message.content, discarding
// exactly the fields this diagnostic needs (prompt_eval_count, eval_count, done_reason).
async function chatRaw(
  messages: Message[]
): Promise<{ content: string; promptEvalCount?: number; evalCount?: number; doneReason?: string }> {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      stream: false,
      ...(supportsThinking(MODEL) ? { think: true } : {}),
      format: 'json',
      messages,
    }),
  })
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`)
  const data = (await res.json()) as {
    message?: { content?: string }
    prompt_eval_count?: number
    eval_count?: number
    done_reason?: string
  }
  return {
    content: data.message?.content ?? '',
    promptEvalCount: data.prompt_eval_count,
    evalCount: data.eval_count,
    doneReason: data.done_reason,
  }
}

async function main(): Promise<void> {
  const diff = readFileSync(diffPath, 'utf-8')
  const agent = new SecurityAgent({} as LLMProvider, DEFAULT_CONFIG) // provider unused -- only buildUserPrompt/systemPrompt needed
  const messages: Message[] = [
    { role: 'system', content: agent.systemPrompt },
    // buildUserPrompt is protected -- reconstruct its exact shape inline rather than exposing it
    {
      role: 'user',
      content: `Review this diff and return a JSON array of findings.\n\n\`\`\`diff\n${diff}\n\`\`\``,
    },
  ]

  console.log(`Model: ${MODEL}`)
  console.log(`Diff: ${diffPath} (${diff.split('\n').length} lines)`)
  const result = await chatRaw(messages)
  console.log(`prompt_eval_count (prompt tokens): ${result.promptEvalCount}`)
  console.log(`eval_count (response tokens): ${result.evalCount}`)
  console.log(`done_reason: ${result.doneReason}`)
  console.log(`response length: ${result.content.length} chars`)
  console.log(`response tail: ...${result.content.slice(-200)}`)

  if (result.doneReason === 'length') {
    console.log(
      '\n=> done_reason is "length": generation was cut off by a token cap. If prompt_eval_count ' +
        'is small relative to 32k, the fix is an explicit num_predict. If prompt_eval_count is ' +
        'itself close to 32k, the fix is reserving response headroom instead.'
    )
  } else if (result.doneReason === 'stop') {
    console.log('\n=> done_reason is "stop": the model chose to stop -- not a length-cap issue.')
  } else {
    console.log(`\n=> unexpected done_reason "${result.doneReason}" -- investigate directly.`)
  }
}

main()
