import { BaseAgent } from './base.js'
import type { AgentName, CoverageGap, Finding, ReviewInput } from '../schema.js'
import type { Message } from '../llm/provider.js'
import { ParseFailureError } from '../parsing.js'

export interface CoverageAnalystResult {
  findings: Finding[]
  gaps: CoverageGap[]
}

export class CoverageAnalystAgent extends BaseAgent {
  get name(): AgentName {
    return 'coverage'
  }

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
  "findings": [{
    "severity": "medium",
    "basis": "VERIFIED",
    "confidence": 85,
    "domain": "Testing",
    "file": "path/to/file",
    "line": 42,
    "title": "No test for X function",
    "detail": "The X function added in this diff has no test coverage",
    "evidence": "The specific function or branch from the diff that has no corresponding test",
    "impact": "Bugs in this code path will remain undetected until production",
    "recommendation": "Add unit test covering the happy path and error case — show the test skeleton",
    "blocking": false,
    "source": "llm",
    "suggestion": "Add unit test covering the happy path and error case"
  }],
  "gaps": [{"file":"path/to/file","functionName":"functionName","lineStart":10,"lineEnd":25,"description":"What the function does and what cases need testing"}]
}

Rules:
- Every gap should have a corresponding finding
- basis=VERIFIED: function is clearly new/changed with no test file changes in the diff
- basis=INFERRED: likely untested based on file patterns
- confidence: your certainty this is a real issue (0-100)
- evidence: quote or reference the specific function/branch from the diff that lacks coverage
- recommendation: show a test skeleton, not just "add a test"
- blocking: true for critical/high, false for medium/low
- If fully covered, return: {"findings":[],"gaps":[]}`
  }

  async runForCoverage(input: ReviewInput, signal?: AbortSignal): Promise<CoverageAnalystResult> {
    const messages: Message[] = [
      { role: 'system', content: this.systemPrompt },
      { role: 'user', content: this.buildUserPrompt(input) },
    ]
    const raw = await this.provider.chat(messages, { think: true, signal })
    return this.parseCoverageResult(raw, input)
  }

  private parseCoverageResult(raw: string, _input: ReviewInput): CoverageAnalystResult {
    const cleaned = raw.replace(/```json\s*|```\s*/g, '').trim()

    // Stage 1: direct parse
    try {
      const parsed = JSON.parse(cleaned) as { findings?: unknown[]; gaps?: unknown[] }
      return {
        findings: this.parseFindings(JSON.stringify(parsed.findings ?? [])),
        gaps: this.validateGaps(parsed.gaps ?? []),
      }
    } catch (err) {
      if (err instanceof ParseFailureError) throw err
      /* fall through */
    }

    // Stage 2: balanced-brace extraction
    try {
      const extracted = this.extractJsonObject(cleaned)
      if (extracted) {
        const parsed = JSON.parse(extracted) as { findings?: unknown[]; gaps?: unknown[] }
        return {
          findings: this.parseFindings(JSON.stringify(parsed.findings ?? [])),
          gaps: this.validateGaps(parsed.gaps ?? []),
        }
      }
    } catch (err) {
      if (err instanceof ParseFailureError) throw err
      /* fall through */
    }

    console.error(`[coverage] parse failure. Raw snippet: ${raw.slice(0, 200)}`)
    throw new ParseFailureError('coverage', raw)
  }

  private extractJsonObject(text: string): string | null {
    const start = text.indexOf('{')
    if (start === -1) return null
    let depth = 0
    let inString = false
    let esc = false
    for (let i = start; i < text.length; i++) {
      const ch = text[i]
      if (esc) {
        esc = false
        continue
      }
      if (ch === '\\' && inString) {
        esc = true
        continue
      }
      if (ch === '"') {
        inString = !inString
        continue
      }
      if (inString) continue
      if (ch === '{') depth++
      else if (ch === '}') {
        depth--
        if (depth === 0) return text.slice(start, i + 1)
      }
    }
    return null
  }

  private validateGaps(items: unknown[]): CoverageGap[] {
    return (items as CoverageGap[]).filter(
      (g) =>
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
