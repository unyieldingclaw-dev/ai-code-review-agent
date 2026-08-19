import { BaseAgent } from './base.js'
import { extractChangedFiles } from '../policyFilter.js'
import { allAddedDependenciesArePermissive } from '../licenseFacts.js'
import type { AgentName, Finding, ReviewInput } from '../schema.js'

export class LicenseComplianceAgent extends BaseAgent {
  get name(): AgentName {
    return 'license'
  }

  // WHY skip whenever the diff doesn't touch a manifest, rather than always making the LLM call:
  // this agent's own prompt already instructs the model to return [] when "the diff has no
  // package.json changes adding new dependencies" -- unlike DependenciesAgent/SecretsAgent, this
  // agent had no code-level skip at all before this fix, so it burned a full-diff LLM call on
  // every review regardless of relevance, for an outcome the model would return empty anyway.
  async run(input: ReviewInput, signal?: AbortSignal): Promise<Finding[]> {
    const touchesManifest = extractChangedFiles(input.diff).some(
      (f) => f === 'package.json' || f === 'package-lock.json'
    )
    if (!touchesManifest) return []
    const findings = await super.run(input, signal)

    // Deterministic backstop: the prompt below asks the model to recall each package's license
    // from training knowledge, which measured 6/10 wrong on a lodash fixture (asserting LGPL-3.0,
    // with basis=VERIFIED, for a famously MIT package). If the reviewed project's own lockfile or
    // node_modules proves every added dependency is permissively licensed, a
    // commercial-incompatibility finding contradicts that ground truth and is dropped. NOTE: this
    // drops ALL of this agent's findings for that diff, not a filtered subset -- safe only because
    // this agent's prompt asks for exactly one finding class. Revisit if it ever reports more.
    // Fails open
    // whenever any added package can't be resolved -- see licenseFacts.ts for why corroboration is
    // deliberately NOT required.
    const { verified, resolved } = allAddedDependenciesArePermissive(
      input.diff,
      input.projectPath ?? '.'
    )
    if (!verified || findings.length === 0) return findings

    const summary = resolved.map((r) => `${r.name}=${r.license}`).join(', ')
    for (const f of findings) {
      console.error(
        `[license] dropped finding "${f.title}" -- every dependency added by this diff is ` +
          `verifiably permissive (${summary}) per the project's own package metadata, so a ` +
          `commercial-incompatibility finding contradicts it (likely a hallucinated license)`
      )
    }
    return []
  }

  get systemPrompt(): string {
    return `You are a license compliance reviewer. Analyze the provided git diff for newly added dependencies with licenses incompatible with commercial use.

Focus on package.json changes (dependencies, devDependencies, peerDependencies). For each newly added package (lines starting with +):
- Identify the package name and recall its license. Only assert a license you actually know for
  that exact package — if you are not certain, say so via basis=SPECULATIVE rather than guessing a
  plausible-sounding one. Most of the npm ecosystem is permissively licensed (MIT/ISC/Apache-2.0),
  so do not assign a copyleft license to a package you cannot specifically place. Reporting a
  permissive package as copyleft is a costly false alarm, not a safe default — it is worse than
  reporting nothing. Do not name example packages in your output that the diff does not contain.
- Flag any package with these commercially-incompatible licenses:
  - GPL-2.0, GPL-3.0 (GNU General Public License)
  - AGPL-3.0 (GNU Affero General Public License)
  - SSPL-1.0 (Server Side Public License — copyleft terms triggered by offering the software as a hosted network service)
  - Commons Clause addendum (restricts commercial sale)
  - EUPL (European Union Public License, copyleft)
  - CDDL-1.0 (Common Development and Distribution License)
  - LGPL is often OK for dynamic linking but flag it as medium severity for review
- Permissive licenses (MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, 0BSD) are fine — do not flag these
- If you are uncertain about a package's license, use basis=SPECULATIVE

Output ONLY a JSON array. No prose, no explanation, no markdown fences.

Required format:
[{"severity":"high","basis":"VERIFIED|INFERRED|SPECULATIVE","confidence":85,"file":"package.json","line":42,"title":"Short title under 60 chars","detail":"Package name, its license, and why it's problematic","suggestion":"MIT-licensed alternative or advice to obtain a commercial license","domain":"License","evidence":"<specific diff line(s) showing the added dependency>","impact":"<legal/compliance risk, e.g. GPL copyleft would require open-sourcing proprietary code, or AGPL triggers on network use>","recommendation":"<MIT-licensed alternative or steps to obtain a commercial license>","blocking":false,"source":"llm"}]

Rules:
- severity=high for GPL, AGPL, SSPL, Commons Clause
- severity=medium for LGPL, EUPL, CDDL (based on the license type itself, regardless of how
  certain you are it applies — do not lower severity just because you're unsure; uncertainty
  belongs in basis, not severity)
- basis=VERIFIED: you know this package's license from training data
- basis=INFERRED: the package name or description strongly implies the license
- basis=SPECULATIVE: you're unsure — flag for human review
- confidence: your certainty this is a real issue (0-100)
- evidence: quote the specific diff line(s) that triggered this finding
- recommendation: write corrected code, not just a description
- blocking: true for critical/high, false for medium/low
- source: always "llm" — this agent has no deterministic license-lookup tool backing it
- If the diff has no package.json changes adding new dependencies, return: []`
  }
}
