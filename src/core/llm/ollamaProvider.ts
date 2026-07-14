import type { LLMProvider, Message, ChatOptions } from './provider.js'

const DEFAULT_TIMEOUT_MS = 300_000

export class OllamaProvider implements LLMProvider {
  constructor(
    private readonly baseUrl: string,
    private readonly model: string
  ) {
    let parsed: URL
    try {
      parsed = new URL(baseUrl)
    } catch {
      throw new Error(
        `Invalid Ollama URL: "${baseUrl}". Use http://localhost:11434 (or http://127.0.0.1:11434).`
      )
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(
        `Ollama URL must use http or https. Got: ${parsed.protocol}. ` +
          `Use http://localhost:11434 instead.`
      )
    }
    // 0.0.0.0 is excluded: on Linux it routes to all interfaces including external ones.
    if (!['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)) {
      throw new Error(
        `Ollama URL must point to localhost. Got: ${parsed.hostname}. ` +
          `Use http://localhost:11434 (or http://127.0.0.1:11434) instead. ` +
          `Remote Ollama instances are not supported (SSRF risk).`
      )
    }
  }

  private supportsThinking(): boolean {
    const m = this.model.toLowerCase()
    return m.startsWith('qwen') || m.startsWith('deepseek-r1')
  }

  async chat(messages: Message[], options: ChatOptions = {}): Promise<string> {
    // WHY prefer the caller's signal over our own timeout: the caller (SwarmRunner) already
    // races this call against its own agentTimeoutMs and gives up at that deadline -- but
    // Promise.race doesn't cancel the losing side, so without this the fetch kept running
    // server-side for up to DEFAULT_TIMEOUT_MS after the runner had already moved on. Each
    // retry then piled another live, uncancelled request onto Ollama instead of replacing the
    // abandoned one, making contention worse under load. Honoring the caller's signal lets a
    // "timed out" agent's request actually stop. Falls back to the old internal timeout for
    // any caller that doesn't provide one (e.g. direct use outside SwarmRunner).
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
      signal: options.signal ?? AbortSignal.timeout(options.timeout ?? DEFAULT_TIMEOUT_MS),
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
