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

  // Memoizes the PROMISE, not the value, so that concurrent agents share one in-flight probe
  // rather than each firing their own. A successful answer is cached for the life of the
  // instance -- the model is fixed at construction, so it cannot change within a run.
  private thinkingSupport?: Promise<boolean>

  // WHY the probe carries its own short deadline instead of the caller's AbortSignal, which is
  // what chat() does 30 lines below: this promise is SHARED. Honoring one agent's signal would
  // let the first agent to abort cancel the probe every other agent is awaiting. The bound is 5s
  // -- small against agentTimeoutMs (180s default) and paid once per run, not once per agent.
  private static readonly CAPABILITY_PROBE_TIMEOUT_MS = 5_000

  // WHY ask Ollama instead of matching the model name: the previous implementation returned true
  // for anything starting with "qwen", which is most of that family -- including qwen2.5-coder,
  // which has no thinking capability. Ollama rejects `think: true` for such models with HTTP 400
  // "does not support thinking", so EVERY agent call failed. Measured 2026-08-30: qwen2.5-coder:7b
  // scored 5/24 on calibration, 19 of those failures being HTTP 400 rather than bad findings --
  // a config bug wearing a quality bug's clothes. A name prefix is a guess about a capability;
  // /api/show reports the capability itself.
  private async supportsThinking(): Promise<boolean> {
    this.thinkingSupport ??= this.probeThinking()
    const supported = await this.thinkingSupport
    return supported
  }

  private async probeThinking(): Promise<boolean> {
    // WHY default to false on failure: the error directions are not symmetric. Omitting `think` on
    // a capable model costs some reasoning depth and still returns a review; sending it to an
    // incapable model fails the request outright. Degrade toward the call that still works.
    try {
      const res = await fetch(`${this.baseUrl}/api/show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model }),
        signal: AbortSignal.timeout(OllamaProvider.CAPABILITY_PROBE_TIMEOUT_MS),
      })
      if (!res.ok) return this.degradeThinking(`Ollama HTTP ${res.status}`)
      const data = (await res.json()) as { capabilities?: unknown }
      // WHY Array.isArray rather than trusting the cast: this is untrusted HTTP JSON. A STRING
      // value is the dangerous shape -- String.prototype.includes would substring-match, so
      // "no-thinking-support" would return TRUE and send think:true to an incapable model,
      // reproducing the exact HTTP 400 this function exists to prevent. Other wrong shapes throw
      // into the catch and degrade correctly, but only by accident; this makes it deliberate.
      if (!Array.isArray(data.capabilities)) return this.degradeThinking('malformed capabilities')
      return data.capabilities.includes('thinking')
    } catch (err) {
      return this.degradeThinking((err as Error).message)
    }
  }

  // WHY announce the degraded path and then FORGET it: silence is what let the original bug
  // masquerade as a quality problem for a whole calibration run. A cached failure would strip
  // thinking from every remaining agent after one transient hiccup, with nothing in the output
  // saying so. Clearing the memo lets the next agent re-probe once Ollama recovers; the warning
  // means a permanently degraded run is visible rather than inferred. Mirrors evidenceVerifier's
  // stderr warning on its own degraded path.
  private degradeThinking(reason: string): boolean {
    this.thinkingSupport = undefined
    process.stderr.write(
      `[ai-review] capability probe failed for ${this.model} (${reason}); ` +
        `proceeding without thinking mode for this call\n`
    )
    return false
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
        ...(options.think && (await this.supportsThinking()) ? { think: true } : {}),
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
    const withClosedTagsRemoved = text.replace(/<think>[\s\S]*?<\/think>/g, '')
    // A <think> block that never closed (response truncated mid-reasoning) has no real JSON
    // answer after it -- drop it and everything following, rather than leaving raw reasoning
    // prose in the response where BaseAgent's truncation-recovery pass could mistake a
    // coincidentally schema-shaped object inside the model's unstripped chain-of-thought for
    // a real finding it never actually asserted as output.
    const openThinkIndex = withClosedTagsRemoved.indexOf('<think>')
    const stripped =
      openThinkIndex === -1 ? withClosedTagsRemoved : withClosedTagsRemoved.slice(0, openThinkIndex)
    return stripped.trim()
  }
}
