import { BaseAgent } from './base.js'
import { runTool } from '../../utils/shell.js'
import type { AgentName } from '../schema.js'
import type { ReviewInput, Finding } from '../schema.js'

function extractChangedFiles(diff: string): string[] {
  const files: string[] = []
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ b/')) {
      files.push(line.slice(6))
    }
  }
  return files
}

export class ComplexityAgent extends BaseAgent {
  get name(): AgentName {
    return 'complexity'
  }

  get systemPrompt(): string {
    return `You are a code reviewer specializing in code complexity.
Analyze the diff for functions and methods with high cyclomatic complexity:
- Functions with deeply nested conditionals (3+ levels of nesting)
- Functions with high cyclomatic complexity (more than 10 decision paths)
- Large functions that do too many things (more than 50 lines)
- Functions with too many parameters (more than 5)
- Complex switch statements with many cases that could be simplified

severity: "high" for functions exceeding cyclomatic complexity of 15 or with 5+ levels of nesting
severity: "medium" for functions with complexity 10-15 or 3-4 levels of nesting
severity: "low" for long functions that could be split but are otherwise clear

Output ONLY a JSON array of findings. No prose, no explanation, no markdown fences. Empty array if no issues.
Required format:
[{"severity":"high","basis":"VERIFIED|INFERRED|SPECULATIVE","confidence":80,"file":"path/to/file","line":42,"title":"Short title under 60 chars","detail":"What the problem is and why it matters — mention the word 'complexity'","suggestion":"How to fix it","domain":"Complexity","evidence":"<specific diff line(s) or lizard metric showing the complexity>","impact":"<maintainability burden — harder to review, test, debug, or onboard>","recommendation":"<describe the decomposition approach in 1-2 sentences — do NOT write full code>","blocking":false,"source":"llm"}]

Additional rules:
- detail: always include the word "complexity" to describe the problem
- evidence: quote the specific function signature or nesting level that triggered this finding
- recommendation: describe the refactoring approach briefly (1-2 sentences max) — do not write full example code
- blocking: true for critical/high, false for medium/low
- source: "llm" by default; "lizard" if complexity metrics from the tool are shown in the input`
  }

  async run(input: ReviewInput, signal?: AbortSignal): Promise<Finding[]> {
    const files = extractChangedFiles(input.diff)
    if (files.length === 0) {
      // No new/modified files in diff — nothing to pass to lizard; fall back to LLM-only.
      return super.run(input, signal)
    }

    // WHY pass projectPath as cwd: files are paths relative to the reviewed project, not this
    // process's own cwd -- without it, lizard silently resolved them against the wrong directory
    // whenever the caller pointed elsewhere (CLI --dir, MCP repo_path). Same bug already fixed
    // for SecretsAgent/DependenciesAgent's gitleaks/npm-audit calls.
    const lizardOutput = await runTool('lizard', files, undefined, false, input.projectPath ?? '.')
    if (lizardOutput === null) {
      // lizard not found — LLM receives plain diff
      return super.run(input, signal)
    }

    // lizard found — prepend metrics so LLM can focus on high-complexity functions
    const enhancedDiff = `=== Lizard Complexity Metrics ===\n${lizardOutput}\n\n=== Diff ===\n${input.diff}`
    return super.run({ ...input, diff: enhancedDiff }, signal)
  }
}
