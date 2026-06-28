// tests/unit/embedder.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { embed, cosineSimilarity } from '../../src/core/embedder.js'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('embed', () => {
  it('returns embedding array on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ embedding: [0.1, 0.2, 0.3] }),
      })
    )
    const result = await embed('http://localhost:11434', 'test text')
    expect(result).toEqual([0.1, 0.2, 0.3])
  })

  it('returns null when fetch throws (Ollama unreachable)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))
    const result = await embed('http://localhost:11434', 'test text')
    expect(result).toBeNull()
  })

  it('returns null when HTTP response is not ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
      })
    )
    const result = await embed('http://localhost:11434', 'test text')
    expect(result).toBeNull()
  })
})

describe('cosineSimilarity', () => {
  it('returns 1.0 for identical vectors', () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1.0)
  })

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0)
  })

  it('returns 0 (not NaN) for a zero vector', () => {
    const result = cosineSimilarity([0, 0, 0], [1, 0, 0])
    expect(result).toBe(0)
    expect(Number.isNaN(result)).toBe(false)
  })

  it('returns 0 for mismatched-length vectors', () => {
    expect(cosineSimilarity([1, 0], [1, 0, 0])).toBe(0)
  })

  it('returns -1 for opposite vectors', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1)
  })

  it('returns 0 for empty vectors', () => {
    expect(cosineSimilarity([], [])).toBe(0)
  })

  it('returns 0 when vectors have different lengths', () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0)
  })
})
