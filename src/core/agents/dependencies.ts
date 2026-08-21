import { BaseAgent } from './base.js'
import { runTool } from '../../utils/shell.js'
import { extractChangedFiles } from '../policyFilter.js'
import { isUsableAuditReport, parseNpmAuditOutput } from '../npmAuditParser.js'
import type { AgentName, Finding, ReviewInput } from '../schema.js'

export class DependenciesAgent extends BaseAgent {
  readonly toolKey = 'npmAudit' as const

  get name(): AgentName {
    return 'dependencies'
  }

  async run(input: ReviewInput, signal?: AbortSignal): Promise<Finding[]> {
    const touchesManifest = extractChangedFiles(input.diff).some(
      (f) => f === 'package.json' || f === 'package-lock.json'
    )
    // WHY skip whenever the diff simply doesn't touch a manifest, not just when no package.json
    // exists anywhere in the project: this agent's own prompt already instructs the model to
    // return [] when "the diff has no package.json / requirements.txt changes" -- so the previous
    // narrower guard (only skip if package.json is ALSO absent from disk) still paid a full LLM
    // call in the far more common case of a real Node.js project (package.json present) whose
    // current diff just doesn't touch it, for an outcome the model would return empty anyway.
    // This is a strict superset of the original guard: any diff that would have skipped before
    // (no manifest touched, no package.json on disk) still skips here too.
    if (!touchesManifest) {
      this.lastToolAvailability = 'not-applicable'
      return []
    }
    if (input.projectPath) {
      // shell:true is required for npm specifically (Node refuses to spawn .cmd/.bat files on
      // Windows otherwise) -- safe here because these args are always this hardcoded literal
      // array, never diff-derived content. cwd is required too: without it, npm audit runs
      // against whatever package.json is in this process's own cwd, not the reviewed project
      // (CLI --dir / MCP repo_path routinely differ from process.cwd()).
      const output = await runTool('npm', ['audit', '--json'], undefined, true, input.projectPath)
      // WHY the shape check and not just `output !== null`: an unreachable registry makes
      // `npm audit --json` print a JSON error object to stdout and exit non-zero. runTool ignores
      // exit codes on purpose (npm audit exits non-zero on genuine findings too), so that error
      // object arrived here as ordinary output, was marked 'used', and parsed to zero findings --
      // reporting "no dependency vulnerabilities, verified by npm-audit" from an audit that never
      // ran, while skipping the LLM fallback meant for exactly this case. Treating an unusable
      // report as tool-unavailable routes it to that fallback and surfaces the degraded state in
      // ReviewResult.toolAvailability instead of silently claiming a clean audit.
      if (output !== null && isUsableAuditReport(output)) {
        this.lastToolAvailability = 'used'
        return parseNpmAuditOutput(output, this.name)
      }
    }
    // touchesManifest is always true here -- the !touchesManifest branch above already returned.
    this.lastToolAvailability = 'unavailable-llm-fallback'
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
- source: always "llm" — this prompt only runs when a real npm-audit result wasn't available; a
  genuine npm-audit finding is reported directly from its own output and never reaches this
  prompt at all, so never self-report "npm-audit" from your own training-data recall of a CVE
- Only report severity >= medium
- If the diff has no package.json / requirements.txt changes, return: []`
  }
}
