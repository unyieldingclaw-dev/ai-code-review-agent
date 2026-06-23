import type { LLMProvider, Message, ChatOptions } from './provider.js'

const DEFAULT_TIMEOUT_MS = 300_000

export class OllamaProvider implements LLMProvider {
  constructor(
    private readonly baseUrl: string,
    private readonly model: string
  ) {}

  private supportsThinking(): boolean {
    const m = this.model.toLowerCase()
    return m.startsWith('qwen') || m.startsWith('deepseek-r1')
  }

  async chat(messages: Message[], options: ChatOptions = {}): Promise<string> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        stream: false,
        ...(options.think && this.supportsThinking() ? { think: true } : {}),
        ...(options.format ? { format: options.format } : {}),
        messages,
      }),
      signal: AbortSignal.timeout(options.timeout ?? DEFAULT_TIMEOUT_MS),
    })
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`)
    const data = (await res.json()) as { message?: { content?: string } }
    const raw = data.message?.content ?? ''
    return this.stripThinkTags(raw)
  }

  async ping(): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(5_000),
      })
      if (!res.ok) return { ok: false, error: `Ollama returned HTTP ${res.status}` }
      const data = (await res.json()) as { models?: Array<{ name: string }> }
      const modelBase = this.model.split(':')[0].toLowerCase()
      const hasModel = (data.models ?? []).some((m) => m.name.toLowerCase().includes(modelBase))
      if (!hasModel) {
        return { ok: false, error: `Model ${this.model} not found. Run: ollama pull ${this.model}` }
      }
      return { ok: true }
    } catch (err) {
      return {
        ok: false,
        error: `Ollama not reachable at ${this.baseUrl}: ${(err as Error).message}`,
      }
    }
  }

  private stripThinkTags(text: string): string {
    return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
  }
}
