import { BaseAgent } from './base.js'
import { runTool } from '../../utils/shell.js'
import { extractChangedFiles } from '../policyFilter.js'
import { parseNpmAuditOutput } from '../npmAuditParser.js'
import type { AgentName, Finding, ReviewInput, ToolAvailability } from '../schema.js'

export class DependenciesAgent extends BaseAgent {
  public lastToolAvailability?: ToolAvailability

  get name(): AgentName {
    return 'dependencies'
  }

  async run(input: ReviewInput, signal?: AbortSignal): Promise<Finding[]> {
    const touchesManifest = extractChangedFiles(input.diff).some(
      (f) => f === 'package.json' || f === 'package-lock.json'
    )
    if (touchesManifest && input.projectPath) {
      // shell:true is required for npm specifically (Node refuses to spawn .cmd/.bat files on
      // Windows otherwise) -- safe here because these args are always this hardcoded literal
      // array, never diff-derived content.
      const output = await runTool('npm', ['audit', '--json'], undefined, true)
      if (output !== null) {
        this.lastToolAvailability = 'used'
        return parseNpmAuditOutput(output, this.name)
      }
    }
    if (touchesManifest) this.lastToolAvailability = 'unavailable-llm-fallback'
    return super.run(input, signal)
  }

  get systemPrompt(): string {
    return `You are a dependency security reviewer. Output ONLY a JSON array — no prose, no markdown fences, no other keys.

Required format:
[{
  "severity": "critical|high|medium|low",
  "basis": "VERIFIED|INFERRED|SPECULATIVE",
  "confidence": 90,
  "domain": "Dependencies",
  "file": "package.json",
  "line": 42,
  "title": "Short title under 60 chars",
  "detail": "Explanation of the dependency/supply-chain issue and why it matters",
  "evidence": "<specific diff line(s) showing the added/changed dependency or version specifier>",
  "impact": "<supply chain risk, breakage, or vulnerability introduced if not fixed>",
  "recommendation": "<concrete fix, e.g. an exact pinned version>",
  "blocking": false,
  "source": "llm",
  "suggestion": "<concrete fix, e.g. an exact pinned version>"
}]

Allowed field names: severity, basis, confidence, domain, file, line, title, detail, evidence, impact, recommendation, blocking, source, suggestion.
Do NOT use: type, description, details, change_type, dependency, version_specifier, or any other field name.

Analyze the git diff for dependency and supply chain issues:
- Newly added packages with known CVEs
- Packages with suspicious names (typosquatting)
- Pinned versions loosened to allow malicious updates
- Direct git URLs or unverified sources
- Deprecated packages with security issues
- Wildcard (*) or overly broad version ranges that allow breaking changes
- License incompatibilities (GPL in MIT projects)

Rules:
- basis=VERIFIED: CVE or known issue confirmed in training data
- basis=INFERRED: suspicious pattern that warrants investigation
- basis=SPECULATIVE: possible risk, needs npm audit to confirm
- confidence: your certainty this is a real issue (0-100)
- evidence: quote or reference the specific diff line(s) that triggered this finding
- recommendation: give the concrete fix (e.g. exact pinned version), not just "pin the version"
- blocking: true for critical/high, false for medium/low
- source: use "npm-audit" if this is a known published CVE, otherwise "llm"
- Only report severity >= medium
- If the diff has no package.json / requirements.txt changes, return: []`
  }
}
