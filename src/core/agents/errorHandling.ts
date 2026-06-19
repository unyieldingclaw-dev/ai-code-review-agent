import { BaseAgent } from './base.js'
import type { AgentName } from '../schema.js'

export class ErrorHandlingAgent extends BaseAgent {
  get name(): AgentName { return 'error-handling' }

  get systemPrompt(): string {
    return `You are a code reviewer specializing in error handling quality.
Analyze the diff for these patterns — in ALL findings use the word "swallowed" to describe any error that is suppressed instead of logged or rethrown:

- Swallowed exceptions: catch blocks that are empty, contain only a comment, or silently return a sentinel value (null/undefined/false/-1) without logging or rethrowing. A catch block that returns false IS a swallowed exception — describe it as such.
- Ignored Promise rejections: .catch(() => {}) or .catch(console.error) with no rethrow
- Log-and-continue: catching an error, logging it, and then continuing as if the error did not happen

Do NOT flag catch blocks that selectively rethrow unexpected errors while handling known error codes (e.g., catching ENOENT/SyntaxError and rethrowing everything else). This is legitimate error handling, not a swallowed exception.

severity: "critical" for swallowed exceptions in financial, auth, or data-integrity code
severity: "high" for swallowed exceptions or ignored Promise rejections in general code
severity: "medium" for log-and-continue patterns

Output ONLY a JSON array of findings. No prose, no explanation, no markdown fences. Empty array if no issues.
Required format:
[{"severity":"high","basis":"VERIFIED|INFERRED|SPECULATIVE","confidence":80,"file":"path/to/file","line":42,"title":"Short title","detail":"What the problem is","suggestion":"How to fix it"}]`
  }
}
