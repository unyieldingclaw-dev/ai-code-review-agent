import type { LLMProvider, Message } from '../llm/provider.js'
import type { ReviewConfig } from '../config.js'
import type { Finding, ReviewInput, AgentName, ReviewDomain } from '../schema.js'

function agentDefaultDomain(name: AgentName): ReviewDomain {
  const map: Record<AgentName, ReviewDomain> = {
    'security': 'Security',
    'performance': 'Performance',
    'correctness': 'Correctness',
    'design': 'Architecture Drift',
    'dependencies': 'Dependencies',
    'coverage': 'Testing',
    'testgen': 'Testing',
    'adversarial': 'Adversarial',
    'integration': 'Integration',
    'breaking-change': 'Breaking Change',
    'license': 'License',
    'secrets': 'Secrets',
    'error-handling': 'Error Handling',
    'observability': 'Observability',
    'migration-safety': 'Migration Safety',
    'complexity': 'Complexity'
  }
  return map[name] ?? 'Correctness'
}

export abstract class BaseAgent {
  constructor(
    protected readonly provider: LLMProvider,
    protected readonly config: ReviewConfig
  ) {}

  abstract get name(): AgentName
  abstract get systemPrompt(): string

  async run(input: ReviewInput): Promise<Finding[]> {
    const messages: Message[] = [
      { role: 'system', content: this.systemPrompt },
      { role: 'user', content: this.buildUserPrompt(input) }
    ]
    const raw = await this.provider.chat(messages, { think: true })
    return this.parseFindings(raw)
  }

  protected buildUserPrompt(input: ReviewInput): string {
    const diffContent = input.context
      ? `${input.context}\n\n## Diff to Review\n\n${input.diff}`
      : input.diff
    return `Review this diff and return a JSON array of findings.\n\n\`\`\`diff\n${diffContent}\n\`\`\``
  }

  protected parseFindings(raw: string): Finding[] {
    const cleaned = raw.replace(/```json\s*|```\s*/g, '').trim()

    // Stage 1: bare array or object with findings
    try {
      const parsed = JSON.parse(cleaned)
      if (Array.isArray(parsed)) {
        const valid = this.validateFindings(parsed)
        if (valid.length > 0 || parsed.length === 0) return valid
      }
      // Stage 2: object with .findings array
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.findings)) {
        return this.validateFindings(parsed.findings)
      }
    } catch { /* fall through */ }

    // Stage 3: balanced-bracket extraction (handles trailing prose/code with ']' chars)
    try {
      const extracted = this.extractJsonArray(cleaned)
      if (extracted) {
        const parsed = JSON.parse(extracted)
        if (Array.isArray(parsed)) return this.validateFindings(parsed)
      }
    } catch { /* fall through */ }

    console.error(`[${this.name}] parse failure. Raw snippet: ${raw.slice(0, 200)}`)
    return []
  }

  private extractJsonArray(text: string): string | null {
    const start = text.indexOf('[')
    if (start === -1) return null
    let depth = 0
    let inString = false
    let esc = false
    for (let i = start; i < text.length; i++) {
      const ch = text[i]
      if (esc) { esc = false; continue }
      if (ch === '\\' && inString) { esc = true; continue }
      if (ch === '"') { inString = !inString; continue }
      if (inString) continue
      if (ch === '[') depth++
      else if (ch === ']') { depth--; if (depth === 0) return text.slice(start, i + 1) }
    }
    return null
  }

  private validateFindings(items: unknown[]): Finding[] {
    return (items as Finding[])
      .filter(f =>
        typeof f === 'object' &&
        f !== null &&
        typeof f.severity === 'string' &&
        typeof f.basis === 'string' &&
        typeof f.file === 'string' &&
        typeof f.line === 'number' &&
        typeof f.title === 'string' &&
        typeof f.detail === 'string' &&
        // Accept either suggestion (legacy) or recommendation (new) from LLM output
        (typeof f.suggestion === 'string' || typeof f.recommendation === 'string')
      )
      .map((f, i) => {
        const rawConf = typeof f.confidence === 'number' ? f.confidence : 70
        const suggestion = f.suggestion ?? f.recommendation ?? ''
        const recommendation = f.recommendation ?? suggestion
        return {
          ...f,
          id: `${this.name}-${i}`,
          agent: this.name,
          confidence: Math.max(0, Math.min(100, rawConf)),
          domain: f.domain ?? agentDefaultDomain(this.name),
          evidence: f.evidence ?? f.detail ?? '',
          impact: f.impact ?? '',
          recommendation,
          suggestion,
          blocking: f.blocking ?? (f.severity === 'critical'),
          source: f.source ?? 'llm'
        }
      })
  }
}
