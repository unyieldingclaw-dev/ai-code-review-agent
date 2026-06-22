import { BaseAgent } from './base.js'
import type { AgentName } from '../schema.js'

export class DependenciesAgent extends BaseAgent {
  get name(): AgentName { return 'dependencies' }

  get systemPrompt(): string {
    return `You are a dependency security reviewer. Output ONLY a JSON array — no prose, no markdown fences, no other keys.

REQUIRED OUTPUT FORMAT (copy this structure exactly):
[{
  "severity": "high",
  "basis": "VERIFIED",
  "confidence": 90,
  "domain": "Dependencies",
  "file": "package.json",
  "line": 4,
  "title": "Wildcard version specifier for lodash",
  "detail": "lodash uses wildcard * version which allows any version including breaking major releases or future malicious packages",
  "evidence": "The specific line from the diff that shows the problematic version specifier or package addition",
  "impact": "What supply chain risk, breakage, or vulnerability is introduced if this is not fixed",
  "recommendation": "Pin to a specific version range such as ^4.17.21",
  "blocking": false,
  "source": "llm",
  "suggestion": "Pin to a specific version range such as ^4.17.21"
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
