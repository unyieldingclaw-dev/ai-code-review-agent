import { BaseAgent } from './base.js'
import type { AgentName, CoverageGap, Finding, ReviewInput } from '../schema.js'
import type { Message } from '../llm/provider.js'

export interface CoverageAnalystResult {
  findings: Finding[]
  gaps: CoverageGap[]
}

export class CoverageAnalystAgent extends BaseAgent {
  get name(): AgentName { return 'coverage' }

  get systemPrompt(): string {
    return `You are a test coverage analyst. Analyze the provided git diff and identify code paths that lack test coverage.

Focus on:
- New functions or methods with no corresponding test
- New conditional branches (if/else, switch cases) not covered by existing tests
- New error handling paths not tested
- New async code paths (Promise rejections, async error cases)
- Changed logic in existing functions where old tests may no longer cover new behavior

Output ONLY a JSON object with two arrays: "findings" (coverage issues as review findings) and "gaps" (structured coverage gap data for test generation).

Required format:
{
  "findings": [{"severity":"medium","basis":"VERIFIED","confidence":85,"file":"path/to/file","line":42,"title":"No test for X function","detail":"The X function added in this diff has no test coverage","suggestion":"Add unit test covering the happy path and error case"}],
  "gaps": [{"file":"path/to/file","functionName":"functionName","lineStart":10,"lineEnd":25,"description":"What the function does and what cases need testing"}]
}

Rules:
- Every gap should have a corresponding finding
- basis=VERIFIED: function is clearly new/changed with no test file changes in the diff
- basis=INFERRED: likely untested based on file patterns
- confidence: your certainty this is a real issue (0-100)
- If fully covered, return: {"findings":[],"gaps":[]}`
  }

  async runForCoverage(input: ReviewInput): Promise<CoverageAnalystResult> {
    const messages: Message[] = [
      { role: 'system', content: this.systemPrompt },
      { role: 'user', content: this.buildUserPrompt(input) }
    ]
    const raw = await this.provider.chat(messages, { think: true })
    return this.parseCoverageResult(raw, input)
  }

  private parseCoverageResult(raw: string, _input: ReviewInput): CoverageAnalystResult {
    const cleaned = raw.replace(/```json\s*|```\s*/g, '').trim()
    try {
      const parsed = JSON.parse(cleaned) as { findings?: unknown[]; gaps?: unknown[] }
      const findings = this.parseFindings(JSON.stringify(parsed.findings ?? []))
      const gaps = this.validateGaps(parsed.gaps ?? [])
      return { findings, gaps }
    } catch {
      // Try regex extraction
      try {
        const objMatch = cleaned.match(/\{[\s\S]*\}/)
        if (objMatch) {
          const parsed = JSON.parse(objMatch[0]) as { findings?: unknown[]; gaps?: unknown[] }
          return {
            findings: this.parseFindings(JSON.stringify(parsed.findings ?? [])),
            gaps: this.validateGaps(parsed.gaps ?? [])
          }
        }
      } catch { /* fall through */ }
      console.error(`[coverage] parse failure. Raw snippet: ${raw.slice(0, 200)}`)
      return { findings: [], gaps: [] }
    }
  }

  private validateGaps(items: unknown[]): CoverageGap[] {
    return (items as CoverageGap[]).filter(g =>
      typeof g === 'object' &&
      g !== null &&
      typeof g.file === 'string' &&
      typeof g.functionName === 'string' &&
      typeof g.lineStart === 'number' &&
      typeof g.lineEnd === 'number' &&
      typeof g.description === 'string'
    )
  }
}
