import { describe, it, expect, vi, beforeEach } from 'vitest'
import { OllamaProvider } from '../../src/core/llm/ollamaProvider.js'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

describe('OllamaProvider', () => {
  beforeEach(() => mockFetch.mockReset())

  describe('chat', () => {
    it('strips think tags from response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: { content: '<think>reasoning here</think>\n{"findings":[]}' },
        }),
      })
      const provider = new OllamaProvider('http://localhost:11434', 'devstral:latest')
      const result = await provider.chat([{ role: 'user', content: 'test' }])
      expect(result).toBe('{"findings":[]}')
      expect(result).not.toContain('<think>')
    })

    it('drops an unclosed think block and everything after it (truncated mid-reasoning)', async () => {
      // A response cut off before </think> ever appears has no real JSON answer following it --
      // must not leave raw reasoning prose (which could coincidentally contain a schema-shaped
      // object) for BaseAgent's truncation-recovery pass to mistake for a real finding.
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: {
            content: '<think>Let me check {"severity":"high","file":"a.ts"} as an example',
          },
        }),
      })
      const provider = new OllamaProvider('http://localhost:11434', 'devstral:latest')
      const result = await provider.chat([{ role: 'user', content: 'test' }])
      expect(result).toBe('')
    })

    // Thinking support is resolved from Ollama's /api/show `capabilities`, so these tests stub two
    // endpoints. Calls are located by URL rather than by index: the capability probe precedes the
    // chat request, so a positional lookup silently reads the wrong call.
    const stubCapabilities = (capabilities: string[] | undefined, chatContent = 'response') => {
      mockFetch.mockImplementation(async (url: string) => {
        if (String(url).endsWith('/api/show')) {
          return { ok: true, json: async () => ({ capabilities }) }
        }
        return { ok: true, json: async () => ({ message: { content: chatContent } }) }
      })
    }
    const chatBody = () => {
      const call = mockFetch.mock.calls.find((c: unknown[]) => String(c[0]).endsWith('/api/chat'))
      if (!call) throw new Error('no /api/chat request was made')
      return JSON.parse((call[1] as { body: string }).body)
    }

    it('passes think:true when the model reports the thinking capability', async () => {
      stubCapabilities(['completion', 'tools', 'thinking'])
      const provider = new OllamaProvider('http://localhost:11434', 'qwen3:latest')
      await provider.chat([{ role: 'user', content: 'test' }], { think: true })
      expect(chatBody().think).toBe(true)
      expect(chatBody().stream).toBe(false)
    })

    // REGRESSION (2026-08-30). supportsThinking() matched `startsWith('qwen')`, so this model --
    // name begins with "qwen", no thinking capability -- was sent think:true and Ollama rejected
    // every call with HTTP 400 "does not support thinking". It scored 5/24 on calibration, 19 of
    // those failures being that error rather than bad findings: a config bug wearing a quality
    // bug's clothes. Reverting to the prefix match fails this with `expected true to be undefined`.
    it('omits think for a qwen-named model whose capabilities lack thinking', async () => {
      stubCapabilities(['completion', 'tools', 'insert'])
      const provider = new OllamaProvider('http://localhost:11434', 'qwen2.5-coder:7b')
      await provider.chat([{ role: 'user', content: 'test' }], { think: true })
      expect(chatBody().think).toBeUndefined()
    })

    it('omits think for models that do not support it', async () => {
      stubCapabilities(['completion'])
      const provider = new OllamaProvider('http://localhost:11434', 'devstral:latest')
      await provider.chat([{ role: 'user', content: 'test' }], { think: true })
      expect(chatBody().think).toBeUndefined()
      expect(chatBody().stream).toBe(false)
    })

    // The failure directions are asymmetric: omitting `think` still returns a review, while sending
    // it to an incapable model fails outright. An unreachable probe must degrade to the call that
    // still works, not to the one that 400s.
    it('omits think when the capability probe fails, and still completes the chat', async () => {
      mockFetch.mockImplementation(async (url: string) => {
        if (String(url).endsWith('/api/show')) throw new Error('network down')
        return { ok: true, json: async () => ({ message: { content: 'ok' } }) }
      })
      const provider = new OllamaProvider('http://localhost:11434', 'qwen3:latest')
      const result = await provider.chat([{ role: 'user', content: 'test' }], { think: true })
      expect(result).toBe('ok')
      expect(chatBody().think).toBeUndefined()
    })

    it('probes capabilities once per provider instance, not once per chat', async () => {
      stubCapabilities(['completion', 'thinking'])
      const provider = new OllamaProvider('http://localhost:11434', 'qwen3:latest')
      await provider.chat([{ role: 'user', content: 'a' }], { think: true })
      await provider.chat([{ role: 'user', content: 'b' }], { think: true })
      const probes = mockFetch.mock.calls.filter((c: unknown[]) =>
        String(c[0]).endsWith('/api/show')
      )
      expect(probes).toHaveLength(1)
    })

    // REGRESSION. The first version of this fix memoized the FAILURE, so one transient hiccup on
    // /api/show stripped thinking from every remaining agent for the whole run -- silently, since
    // nothing logged it. That invisibility is the same property that let the original prefix-match
    // bug masquerade as a quality problem. A failed probe must not poison the rest of the run.
    it('re-probes after a failed probe rather than caching the failure', async () => {
      let probes = 0
      mockFetch.mockImplementation(async (url: string) => {
        if (String(url).endsWith('/api/show')) {
          probes++
          if (probes === 1) throw new Error('transient')
          return { ok: true, json: async () => ({ capabilities: ['thinking'] }) }
        }
        return { ok: true, json: async () => ({ message: { content: 'ok' } }) }
      })
      const provider = new OllamaProvider('http://localhost:11434', 'qwen3:latest')
      await provider.chat([{ role: 'user', content: 'a' }], { think: true })
      await provider.chat([{ role: 'user', content: 'b' }], { think: true })
      expect(probes).toBe(2)
      const chatCalls = mockFetch.mock.calls.filter((c: unknown[]) =>
        String(c[0]).endsWith('/api/chat')
      )
      // First call degraded to no-thinking; the second, after recovery, gets it.
      expect(JSON.parse((chatCalls[0][1] as { body: string }).body).think).toBeUndefined()
      expect(JSON.parse((chatCalls[1][1] as { body: string }).body).think).toBe(true)
    })

    // REGRESSION. `capabilities` is untrusted HTTP JSON. A string value is the one wrong shape that
    // does not throw: String.prototype.includes substring-matches, so "no-thinking-support" would
    // have returned TRUE and sent think:true to an incapable model -- reproducing the exact HTTP
    // 400 this function exists to prevent. Without Array.isArray this fails: expected true to be undefined.
    it('treats a non-array capabilities value as no thinking support', async () => {
      stubCapabilities('no-thinking-support' as unknown as string[])
      const provider = new OllamaProvider('http://localhost:11434', 'qwen3:latest')
      await provider.chat([{ role: 'user', content: 'test' }], { think: true })
      expect(chatBody().think).toBeUndefined()
    })

    it('does not probe capabilities when think was not requested', async () => {
      stubCapabilities(['completion', 'thinking'])
      const provider = new OllamaProvider('http://localhost:11434', 'qwen3:latest')
      await provider.chat([{ role: 'user', content: 'test' }])
      const probes = mockFetch.mock.calls.filter((c: unknown[]) =>
        String(c[0]).endsWith('/api/show')
      )
      expect(probes).toHaveLength(0)
    })

    it('forwards an object-shaped format (JSON Schema) unchanged in the request body', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message: { content: '[]' } }),
      })
      const provider = new OllamaProvider('http://localhost:11434', 'devstral:latest')
      const schema = { type: 'array', items: { type: 'object' } }
      await provider.chat([{ role: 'user', content: 'x' }], { format: schema })
      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.format).toEqual(schema)
    })

    it('throws on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 })
      const provider = new OllamaProvider('http://localhost:11434', 'devstral:latest')
      await expect(provider.chat([{ role: 'user', content: 'test' }])).rejects.toThrow(
        'Ollama HTTP 500'
      )
    })

    // REGRESSION (2026-09-19). calibrate.ts's call site never passed a signal, so every
    // calibration agent call fell through to this DEFAULT_TIMEOUT_MS (300s) instead of the
    // configured agentTimeoutMs -- a "retested at 300000ms" conclusion reported as causal was
    // actually unchanged behavior. These three tests pin THIS FILE's half of that contract --
    // that chat() actually honors options.signal/options.timeout when given one -- so it cannot
    // silently regress back to always using DEFAULT_TIMEOUT_MS. They do NOT cover calibrate.ts's
    // own call site (it has no test coverage by deliberate project convention, tsx-only, excluded
    // from vitest.config.ts); a future edit that drops the AbortSignal.timeout(agentTimeoutMs)
    // argument there would reintroduce the exact bug this fixed and nothing here would catch it.
    it('passes a caller-supplied AbortSignal to fetch unchanged, ignoring the timeout option', async () => {
      let capturedSignal: AbortSignal | undefined
      // `init` is optionally-typed and guarded (rather than destructured directly) because
      // Vitest's own post-test housekeeping re-invokes the last mockImplementation once more
      // with no arguments after the test body finishes; every mock in this file must tolerate
      // that phantom call without throwing, the same way stubCapabilities' String(url) does.
      mockFetch.mockImplementation(async (_url?: string, init?: RequestInit) => {
        if (!init) return { ok: true, json: async () => ({ message: { content: 'ok' } }) }
        capturedSignal = init.signal as AbortSignal
        return { ok: true, json: async () => ({ message: { content: 'ok' } }) }
      })
      const controller = new AbortController()
      const provider = new OllamaProvider('http://localhost:11434', 'devstral:latest')
      await provider.chat([{ role: 'user', content: 'test' }], {
        signal: controller.signal,
        timeout: 999_999,
      })
      expect(capturedSignal).toBe(controller.signal)
    })

    it('enforces a caller-supplied timeout instead of the 300s internal default', async () => {
      mockFetch.mockImplementation(
        (_url?: string, init?: RequestInit) =>
          new Promise((resolve, reject) => {
            const signal = init?.signal as AbortSignal | undefined
            // See the phantom-invocation note above: a no-args call must resolve, not hang or
            // throw, since nothing awaits it.
            if (!signal) {
              resolve({ ok: true, json: async () => ({ message: { content: 'ok' } }) })
              return
            }
            signal.addEventListener('abort', () => reject(new Error('aborted')))
          })
      )
      const provider = new OllamaProvider('http://localhost:11434', 'devstral:latest')
      const start = Date.now()
      await expect(
        provider.chat([{ role: 'user', content: 'test' }], { timeout: 30 })
      ).rejects.toThrow()
      // Generous upper bound: proves the 30ms configured timeout governed this call, not
      // DEFAULT_TIMEOUT_MS (300_000ms), which this assertion would fail under.
      expect(Date.now() - start).toBeLessThan(5_000)
    })

    it('produces two different enforced deadlines for two different caller-supplied timeouts', async () => {
      mockFetch.mockImplementation(
        (_url?: string, init?: RequestInit) =>
          new Promise((resolve, reject) => {
            const signal = init?.signal as AbortSignal | undefined
            if (!signal) {
              resolve({ ok: true, json: async () => ({ message: { content: 'ok' } }) })
              return
            }
            signal.addEventListener('abort', () => reject(new Error('aborted')))
          })
      )
      const provider = new OllamaProvider('http://localhost:11434', 'devstral:latest')

      const shortStart = Date.now()
      await expect(
        provider.chat([{ role: 'user', content: 'test' }], { timeout: 20 })
      ).rejects.toThrow()
      const shortElapsed = Date.now() - shortStart

      const longStart = Date.now()
      await expect(
        provider.chat([{ role: 'user', content: 'test' }], { timeout: 150 })
      ).rejects.toThrow()
      const longElapsed = Date.now() - longStart

      expect(longElapsed).toBeGreaterThan(shortElapsed)
    })
  })

  describe('ping', () => {
    it('returns ok:true when model is present', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: [{ name: 'devstral:latest' }] }),
      })
      const provider = new OllamaProvider('http://localhost:11434', 'devstral:latest')
      const result = await provider.ping()
      expect(result.ok).toBe(true)
    })

    it('returns ok:false when model is missing', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: [{ name: 'other-model:latest' }] }),
      })
      const provider = new OllamaProvider('http://localhost:11434', 'devstral:latest')
      const result = await provider.ping()
      expect(result.ok).toBe(false)
      expect(result.error).toContain('devstral')
    })
  })
})
