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
        json: async () => ({ message: { content: '<think>reasoning here</think>\n{"findings":[]}' } })
      })
      const provider = new OllamaProvider('http://localhost:11434', 'devstral:latest')
      const result = await provider.chat([{ role: 'user', content: 'test' }])
      expect(result).toBe('{"findings":[]}')
      expect(result).not.toContain('<think>')
    })

    it('passes think:true for qwen models when think option is set', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message: { content: 'response' } })
      })
      const provider = new OllamaProvider('http://localhost:11434', 'qwen3:latest')
      await provider.chat([{ role: 'user', content: 'test' }], { think: true })
      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.think).toBe(true)
      expect(body.stream).toBe(false)
    })

    it('omits think for models that do not support it', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message: { content: 'response' } })
      })
      const provider = new OllamaProvider('http://localhost:11434', 'devstral:latest')
      await provider.chat([{ role: 'user', content: 'test' }], { think: true })
      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.think).toBeUndefined()
      expect(body.stream).toBe(false)
    })

    it('throws on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 })
      const provider = new OllamaProvider('http://localhost:11434', 'devstral:latest')
      await expect(provider.chat([{ role: 'user', content: 'test' }])).rejects.toThrow('Ollama HTTP 500')
    })
  })

  describe('ping', () => {
    it('returns ok:true when model is present', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: [{ name: 'devstral:latest' }] })
      })
      const provider = new OllamaProvider('http://localhost:11434', 'devstral:latest')
      const result = await provider.ping()
      expect(result.ok).toBe(true)
    })

    it('returns ok:false when model is missing', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: [{ name: 'other-model:latest' }] })
      })
      const provider = new OllamaProvider('http://localhost:11434', 'devstral:latest')
      const result = await provider.ping()
      expect(result.ok).toBe(false)
      expect(result.error).toContain('devstral')
    })
  })
})
