export interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatOptions {
  think?: boolean
  format?: 'json'
  /** Ignored when `signal` is also provided — OllamaProvider prefers the caller's signal. */
  timeout?: number
  signal?: AbortSignal
}

export interface LLMProvider {
  chat(messages: Message[], options?: ChatOptions): Promise<string>
  ping(): Promise<{ ok: boolean; error?: string }>
}
