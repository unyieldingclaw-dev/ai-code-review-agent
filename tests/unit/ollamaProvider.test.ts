import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Agent } from 'undici'
import { OllamaProvider } from '../../src/core/llm/ollamaProvider.js'

// chat() calls undici's fetch; the capability probe and ping() call the global one. Both are routed
// to the same mockFetch so every test below stubs Ollama in one place, while undiciFetch records
// which fetch chat() actually used.
const { mockFetch, undiciFetch } = vi.hoisted(() => {
  const mockFetch = vi.fn()
  return { mockFetch, undiciFetch: vi.fn((...args: unknown[]) => mockFetch(...args)) }
})

// Wraps the real Agent so the options chat()'s dispatcher was built with can be asserted; a plain
// function, not an arrow, because the provider calls it with `new`.
vi.mock('undici', async (importOriginal) => {
  const actual = await importOriginal<typeof import('undici')>()
  return {
    ...actual,
    fetch: undiciFetch,
    Agent: vi.fn(function (opts: ConstructorParameters<typeof actual.Agent>[0]) {
      return new actual.Agent(opts)
    }),
  }
})

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

    // The regression this pins: Node's default undici dispatcher gives up on any response whose
    // headers take over 300s (headersTimeout) -- the reasoning is at chatDispatcher in the source.
    it('sends chat through undici fetch with header and body timeouts disabled', async () => {
      let capturedDispatcher: unknown
      mockFetch.mockImplementation(async (_url?: string, init?: RequestInit) => {
        if (init) capturedDispatcher = (init as { dispatcher?: unknown }).dispatcher
        return { ok: true, json: async () => ({ message: { content: 'ok' } }) }
      })
      undiciFetch.mockClear()
      const provider = new OllamaProvider('http://localhost:11434', 'devstral:latest')
      await provider.chat([{ role: 'user', content: 'test' }])

      // Found by its options rather than by position, so another Agent elsewhere can't stand in.
      const AgentMock = vi.mocked(Agent)
      const at = AgentMock.mock.calls.findIndex(
        ([opts]) => opts?.headersTimeout === 0 && opts?.bodyTimeout === 0
      )
      expect(at).toBeGreaterThanOrEqual(0)
      expect(capturedDispatcher).toBe(AgentMock.mock.results[at]?.value)
      expect(undiciFetch).toHaveBeenCalledWith('http://localhost:11434/api/chat', expect.anything())
    })

    // With undici's own timeouts off, the AbortSignal is the only thing that ends a call, so a
    // call with no options must still get one.
    it('still passes an AbortSignal when called with no options', async () => {
      let capturedSignal: unknown
      mockFetch.mockImplementation(async (_url?: string, init?: RequestInit) => {
        if (init) capturedSignal = init.signal
        return { ok: true, json: async () => ({ message: { content: 'ok' } }) }
      })
      const provider = new OllamaProvider('http://localhost:11434', 'devstral:latest')
      await provider.chat([{ role: 'user', content: 'test' }])
      expect(capturedSignal).toBeInstanceOf(AbortSignal)
    })

    // A real socket rather than the fetch mock, because what matters is that the caller's signal
    // still ends a request travelling through the custom dispatcher.
    it('aborts a real request through the dispatcher when the caller signal fires', async () => {
      const server = createServer(() => {
        // Never answer: the only way out is the abort.
      })
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
      const { port } = server.address() as AddressInfo
      const { fetch: realFetch } = await vi.importActual<typeof import('undici')>('undici')
      // See the phantom-invocation note above: a no-args call must not reach the real fetch.
      mockFetch.mockImplementation(async (...args: Parameters<typeof realFetch>) =>
        args.length ? realFetch(...args) : { ok: true, json: async () => ({}) }
      )
      try {
        const provider = new OllamaProvider(`http://127.0.0.1:${port}`, 'devstral:latest')
        const start = Date.now()
        // The signal's own reason, not just any failure: a broken dispatcher would also reject.
        await expect(
          provider.chat([{ role: 'user', content: 'test' }], { signal: AbortSignal.timeout(200) })
        ).rejects.toHaveProperty('name', 'TimeoutError')
        expect(Date.now() - start).toBeLessThan(2_000)
      } finally {
        server.closeAllConnections()
        await new Promise<void>((resolve) => server.close(() => resolve()))
      }
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
