import type { LLMProvider, Message } from '../llm/provider.js'
import type { ReviewConfig } from '../config.js'
import type { Finding, ReviewInput, AgentName } from '../schema.js'
import {
  validateAndNormalizeFindings,
  ParseFailureError,
  extractBalancedSpan,
  extractCompleteObjects,
} from '../parsing.js'

export abstract class BaseAgent {
  constructor(
    protected readonly provider: LLMProvider,
    protected readonly config: ReviewConfig
  ) {}

  abstract get name(): AgentName
  abstract get systemPrompt(): string

  async run(input: ReviewInput, signal?: AbortSignal): Promise<Finding[]> {
    const messages: Message[] = [
      { role: 'system', content: this.systemPrompt },
      { role: 'user', content: this.buildUserPrompt(input) },
    ]
    const raw = await this.provider.chat(messages, { think: true, format: 'json', signal })
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
        // All items failed schema validation — log before falling through to extraction
        console.error(
          `[${this.name}] stage-1: ${parsed.length} item(s) failed schema validation. ` +
            `First item keys: ${Object.keys(parsed[0] ?? {}).join(', ')}`
        )
      }
      // Stage 2: object with .findings array
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.findings)) {
        return this.validateFindings(parsed.findings)
      }
    } catch {
      /* fall through */
    }

    // Stage 3: balanced-bracket extraction (handles trailing prose/code with ']' chars)
    try {
      const extracted = extractBalancedSpan(cleaned, '[', ']')
      if (extracted) {
        const parsed = JSON.parse(extracted)
        if (Array.isArray(parsed)) return this.validateFindings(parsed)
      }
    } catch {
      /* fall through */
    }

    // Stage 4: recover complete finding objects from a truncated response (e.g. the model got
    // cut off mid-generation before the array closed) -- salvages the findings it did finish
    // instead of discarding all of them because the last one never completed. Only counts as a
    // real recovery if at least one recovered object actually passes schema validation -- a
    // trivially parseable but empty/garbage response (e.g. "{}") must still throw
    // ParseFailureError like it always has, not silently resolve to "0 findings, clean run".
    const recovered = this.validateFindings(extractCompleteObjects(cleaned))
    if (recovered.length > 0) {
      console.error(
        `[${this.name}] response appears truncated -- recovered ${recovered.length} complete ` +
          `finding(s) before the cutoff. Raw snippet: ${raw.slice(0, 200)}`
      )
      return recovered
    }

    console.error(`[${this.name}] parse failure. Raw snippet: ${raw.slice(0, 200)}`)
    throw new ParseFailureError(this.name, raw)
  }

  private validateFindings(items: unknown[]): Finding[] {
    return validateAndNormalizeFindings(items, this.name)
  }
}
