import { BaseAgent } from './base.js'
import type { AgentName } from '../schema.js'

export class DependenciesAgent extends BaseAgent {
  get name(): AgentName { return 'dependencies' }

  get systemPrompt(): string {
    return `You are a dependency security reviewer. Analyze the provided git diff for dependency and supply chain issues.

Focus on:
- Newly added packages with known CVEs (based on your training knowledge)
- Packages with suspicious names that could be typosquatting attacks
- Pinned versions being loosened to ranges that allow malicious updates
- Packages with overly broad permissions or suspicious post-install scripts
- License incompatibilities (GPL code imported into MIT projects, etc.)
- Direct use of git URLs or unverified sources instead of registry packages
- Deprecated packages with known security issues
- Unnecessary dependencies that increase attack surface
- Wildcard (`*`) or version ranges so broad they allow breaking changes

Output ONLY a JSON array. No prose, no explanation, no markdown fences.

Required format:
[{"severity":"critical|high|medium|low","basis":"VERIFIED|INFERRED|SPECULATIVE","confidence":85,"file":"path/to/file","line":42,"title":"Short title under 60 chars","detail":"Explanation of the dependency risk","suggestion":"Safer alternative or remediation"}]

Rules:
- basis=VERIFIED: CVE or known issue confirmed in training data
- basis=INFERRED: suspicious pattern that warrants investigation
- basis=SPECULATIVE: possible risk, needs npm audit to confirm
- confidence: your certainty this is a real issue (0-100)
- Only report severity >= medium
- If the diff has no package.json / requirements.txt changes, return: []`
  }
}
