export interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatOptions {
  think?: boolean
  // Ollama's structured-output mode: the string "json" only constrains "valid JSON" (any shape);
  // a full JSON Schema object additionally constrains the actual structure (e.g. top-level array
  // vs. object) -- see base.ts's FINDING_ARRAY_SCHEMA for why this matters. Both are forwarded
  // to Ollama unchanged; OllamaProvider itself doesn't need to know which one it's carrying.
  format?: 'json' | Record<string, unknown>
  /** Ignored when `signal` is also provided — OllamaProvider prefers the caller's signal. */
  timeout?: number
  signal?: AbortSignal
}

export interface LLMProvider {
  chat(messages: Message[], options?: ChatOptions): Promise<string>
  ping(): Promise<{ ok: boolean; error?: string }>
}
