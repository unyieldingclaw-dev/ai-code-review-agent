export interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatOptions {
  think?: boolean
  format?: 'json'
  timeout?: number
}

export interface LLMProvider {
  chat(messages: Message[], options?: ChatOptions): Promise<string>
  ping(): Promise<{ ok: boolean; error?: string }>
}
