import type { ReviewConfig } from '../config.js'
import type {
  Finding,
  Severity,
  AgentName,
  EvidenceSource,
  DroppedHallucinatedFinding,
} from '../schema.js'
import { SEVERITY_RANK } from '../schema.js'
import { normalizeFilePath, stripDiffPrefix } from '../filePath.js'
import {
  claimsInjection,
  claimsSwallowedException,
  claimsNullRaisesError,
  hasDynamicConstruction,
  hasExceptionHandling,
  isSqlFile,
  sqlSectionCanRaise,
  sliceDiffByFile,
  lookupFileSection,
} from '../claimSupport.js'

// WHY only these two: DETERMINISTIC_SOURCES exempts a solo critical/high finding from the
// corroboration-required downgrade below (hallucinationCrossCheck), on the premise that a real
// external tool -- not the LLM's own judgment -- produced it. 'gitleaks' and 'npm-audit' are the
// only two labels ever actually set by code (parseGitleaksOutput/parseNpmAuditOutput), on the
// code path that bypasses the LLM entirely -- see secrets.ts/dependencies.ts's `run()` overrides.
// Previously this list also included 'lizard', 'git', and 'policy' (never set by code -- only by
// an LLM prompt instructing the model to self-report one of those strings) plus 'trufflehog',
// 'semgrep', 'osv' (never emitted by anything in this codebase at all). Any agent's own
// hallucinated or merely-confident output could self-tag one of the spoofable values and skip the
// safety net this list exists to enforce -- confirmed concretely for breakingChange.ts
// ("git")/licenseCompliance.ts ("policy")/migrationSafety.ts ("git"), whose prompts have since
// been corrected to stop instructing that self-tag (see docs/superpowers/specs/
// 2026-08-17-full-system-integrity-hardening-audit.md, finding C5).
export const DETERMINISTIC_SOURCES: EvidenceSource[] = ['gitleaks', 'npm-audit']

// Dedup tie-breaker: when multiple agents flag the same file:line, the agent
// with the highest index is kept; others are recorded in corroboratingAgents.
//
// Rationale (highest index = most likely to be kept):
//   secrets / error-handling — high-signal, specific, rarely false-positive
//   security / complexity / migration-safety — precise, domain-specific findings
//   correctness / performance — common but important
//   design / dependencies / license — broader, more interpretive
//   integration / breaking-change — widest scope, most overlap with other agents
//   coverage / testgen / adversarial — supportive signals, escalate others
const AGENT_PRIORITY: AgentName[] = [
  'integration',
  'breaking-change',
  'coverage',
  'testgen',
  'adversarial',
  'design',
  'dependencies',
  'license',
  'correctness',
  'performance',
  'security',
  'complexity',
  'migration-safety',
  'observability',
  'error-handling',
  'secrets',
]

// Findings within this many lines of each other are treated as "the same location" for
// cross-referencing and hallucination-corroboration purposes -- close enough to plausibly
// describe the same code, without requiring an exact line match (agents don't always agree on
// which line within a multi-line statement/block a finding belongs to).
const SAME_LOCATION_LINE_PROXIMITY = 5

export class OrchestratorAgent {
  // No LLMProvider param -- synthesis is 100% deterministic (dedup, cross-reference, hallucination
  // filtering), no LLM calls.
  constructor(private readonly config: ReviewConfig) {}

  // changedFiles is optional so existing/other callers that don't have a diff's file list handy
  // (e.g. every existing test in this file) are unaffected -- the filter simply no-ops when
  // omitted. The real runner.ts call site always provides it.
  // dropped is an optional sink the caller can pass to collect findings this filter drops, so
  // they can be surfaced in the report instead of only logged -- no-op to omit it.
  // diffText is optional for the same reason changedFiles is -- every existing test calls
  // synthesize(findings) bare, and the claim-support filter simply no-ops when it's omitted. The
  // real runner.ts call site always provides it.
  synthesize(
    findings: Finding[],
    changedFiles?: string[],
    dropped?: DroppedHallucinatedFinding[],
    diffText?: string
  ): Finding[] {
    let result = [...findings]
    // Drop findings referencing a file the diff never touched, before anything downstream
    // (corroboration, dedup) can act on a fabricated finding as if it were real. See
    // hallucinationCrossCheck below for the sibling defense against uncorroborated severity.
    // WHY require non-empty changedFiles: an empty list doesn't mean "this diff touches no
    // files" in practice -- it means extractChangedFiles couldn't confidently parse any from
    // this input (malformed/non-standard diff format). Filtering against an empty set would
    // reject every finding, which is a worse failure mode than the one this defends against --
    // fail open (skip the check) when we can't determine changed files with confidence, matching
    // this project's existing convention elsewhere for uncertain/missing state.
    if (changedFiles && changedFiles.length > 0) {
      result = this.filterNonexistentFiles(result, changedFiles, dropped)
    }
    // WHY before crossReference and not later: crossReference escalates a security finding whose
    // location matches an adversarial one, which is exactly the co-fabrication case this filter
    // exists to catch -- both agents were measured inventing injection findings on the same lines
    // of the same safe SQL function. Filtering afterwards would let a fabricated pair escalate
    // each other's severity first.
    if (diffText) {
      result = this.filterUnsupportedClaims(result, diffText, dropped)
    }
    // Cross-reference before dedup so coverage gaps can escalate correctness findings
    result = this.crossReference(result)
    // Require 2+ independent agents for Critical/High before publishing
    result = this.hallucinationCrossCheck(result)
    result = this.deduplicate(result)
    result = this.applyPublicationFilter(result)
    result = this.capAndSort(result)
    return result
  }

  private filterNonexistentFiles(
    findings: Finding[],
    changedFiles: string[],
    dropped?: DroppedHallucinatedFinding[]
  ): Finding[] {
    // Models sometimes echo the diff's own "--- a/path" / "+++ b/path" header prefix into a
    // finding's file field verbatim (see filePath.ts's normalizeFilePath/stripDiffPrefix, shared
    // with runner.ts's CoverageGap filter). changedFiles (from extractChangedFiles) never carries
    // an a/ or b/ prefix, so also try the finding's path with it stripped before rejecting it.
    const changedSet = new Set(changedFiles.map((p) => normalizeFilePath(p)))
    return findings.filter((f) => {
      const normalized = normalizeFilePath(f.file)
      if (changedSet.has(normalized) || changedSet.has(stripDiffPrefix(normalized))) return true
      dropped?.push({ agent: f.agent, title: f.title, file: f.file })
      console.error(
        `[orchestrator] dropped finding "${f.title}" from ${f.agent} -- references ` +
          `${f.file}, which is not in the reviewed diff (likely a hallucinated finding)`
      )
      return false
    })
  }

  // Drops findings whose claimed mechanism is structurally absent from the file they name:
  // an injection claim against a file section containing no dynamic query/command construction,
  // or a swallowed-exception claim against one containing no exception-handling construct. Both
  // are decidable from syntax by the definition of the vulnerability class -- see claimSupport.ts
  // for why prompt wording alone provably could not close this, and why IDOR is excluded.
  private filterUnsupportedClaims(
    findings: Finding[],
    diffText: string,
    dropped?: DroppedHallucinatedFinding[]
  ): Finding[] {
    const sections = sliceDiffByFile(diffText)
    // Fail open when the diff couldn't be sliced at all (malformed/non-standard format), matching
    // the empty-changedFiles reasoning above: filtering against nothing would reject everything.
    if (sections.size === 0) return findings

    return findings.filter((f) => {
      // WHY deterministic sources are exempt: an npm-audit CVE title legitimately reads e.g.
      // "SQL injection in <package>", and its finding is attributed to package.json -- whose diff
      // section will of course contain no dynamic SQL. Without this exemption the filter would
      // silently drop real, tool-sourced vulnerability reports. Same premise as
      // hallucinationCrossCheck's exemption: a real external tool, not the LLM, produced it.
      if (DETERMINISTIC_SOURCES.includes(f.source)) return true

      const section = lookupFileSection(sections, f.file)
      // Fail open: a finding whose file has no section here can't be checked. filterNonexistentFiles
      // already rejects files absent from the diff, so this is the residual parse-mismatch case.
      if (section === undefined) return true

      let reason: DroppedHallucinatedFinding['reason']
      if (claimsInjection(f) && !hasDynamicConstruction(section)) {
        reason = 'unsupported-injection-claim'
      } else if (claimsSwallowedException(f) && !hasExceptionHandling(section)) {
        reason = 'unsupported-exception-claim'
      } else if (isSqlFile(f.file) && claimsNullRaisesError(f) && !sqlSectionCanRaise(section)) {
        reason = 'unsupported-null-error-claim'
      }
      if (!reason) return true

      dropped?.push({ agent: f.agent, title: f.title, file: f.file, reason })
      const missing =
        reason === 'unsupported-injection-claim'
          ? 'no dynamic query/command construction'
          : reason === 'unsupported-exception-claim'
            ? 'no exception-handling construct'
            : 'no error-raising construct (SQL NULL comparison yields no match, not an error)'
      console.error(
        `[orchestrator] dropped finding "${f.title}" from ${f.agent} -- ${f.file} contains ` +
          `${missing}, so the claimed mechanism cannot be present (likely a fabricated finding)`
      )
      return false
    })
  }

  private hallucinationCrossCheck(findings: Finding[]): Finding[] {
    const agentsPresent = new Set(findings.map((f) => f.agent))
    if (agentsPresent.size <= 1) return findings

    return findings.map((f) => {
      if (f.severity !== 'critical' && f.severity !== 'high') return f
      const fFile = stripDiffPrefix(normalizeFilePath(f.file))
      const corroborators = new Set(
        findings
          .filter(
            (other) =>
              other.id !== f.id &&
              other.agent !== f.agent &&
              stripDiffPrefix(normalizeFilePath(other.file)) === fFile &&
              Math.abs(other.line - f.line) <= SAME_LOCATION_LINE_PROXIMITY
          )
          .map((other) => other.agent)
      )
      if (corroborators.size > 0) return f

      // Deterministic tool findings are always reliable — skip downgrade
      if (DETERMINISTIC_SOURCES.includes(f.source)) return f

      // Solo finding — apply confidence-aware downgrade
      const confidence = f.confidence ?? 70
      if (f.severity === 'critical') {
        // High-confidence solo Critical stays Critical; low-confidence → High (not Medium)
        return confidence < 60 ? { ...f, severity: 'high' as Severity } : f
      }
      // Solo High → Medium (unchanged behavior)
      return { ...f, severity: 'medium' as Severity }
    })
  }

  private deduplicate(findings: Finding[]): Finding[] {
    // Group by file:line; within each group, if multiple different agents reported,
    // keep only the highest-priority agent's finding and record all other agents in
    // corroboratingAgents. Same-agent findings at the same location are kept as-is.
    const byLocation = new Map<string, Finding[]>()
    for (const f of findings) {
      const key = `${stripDiffPrefix(normalizeFilePath(f.file))}:${f.line}`
      const group = byLocation.get(key) ?? []
      group.push(f)
      byLocation.set(key, group)
    }

    const result: Finding[] = []
    for (const group of byLocation.values()) {
      const agents = new Set(group.map((f) => f.agent))
      if (agents.size === 1) {
        // All from same agent — keep all as-is
        result.push(...group)
      } else {
        // Multiple agents at same location — keep highest-priority agent's finding,
        // merge all other agents into corroboratingAgents
        let bestPriority = -Infinity
        let bestAgent: AgentName | null = null
        for (const agent of agents) {
          const priority = AGENT_PRIORITY.indexOf(agent)
          if (priority > bestPriority) {
            bestPriority = priority
            bestAgent = agent
          }
        }
        const kept = group.filter((f) => f.agent === bestAgent)
        const dropped = group.filter((f) => f.agent !== bestAgent)
        const droppedAgents = [...new Set(dropped.map((f) => f.agent))]
        const droppedIds = dropped.map((f) => f.id)
        result.push(
          ...kept.map((f) => ({
            ...f,
            corroboratingAgents: [...new Set([...(f.corroboratingAgents ?? []), ...droppedAgents])],
            relatedFindings: [...(f.relatedFindings ?? []), ...droppedIds],
          }))
        )
      }
    }
    return result
  }

  private crossReference(findings: Finding[]): Finding[] {
    return findings.map((f) => {
      const fFile = stripDiffPrefix(normalizeFilePath(f.file))
      // Correctness bug at same file:line as a coverage gap → escalate severity
      if (f.agent === 'correctness') {
        const coverageGap = findings.find(
          (other) =>
            other.agent === 'coverage' &&
            stripDiffPrefix(normalizeFilePath(other.file)) === fFile &&
            Math.abs(other.line - f.line) <= SAME_LOCATION_LINE_PROXIMITY
        )
        if (coverageGap) {
          return {
            ...f,
            severity: this.escalate(f.severity),
            relatedFindings: [...(f.relatedFindings ?? []), coverageGap.id],
          }
        }
      }
      // Security finding at same location as adversarial → escalate
      if (f.agent === 'security') {
        const hasAdversarial = findings.some(
          (other) =>
            other.agent === 'adversarial' &&
            stripDiffPrefix(normalizeFilePath(other.file)) === fFile &&
            Math.abs(other.line - f.line) <= SAME_LOCATION_LINE_PROXIMITY
        )
        if (hasAdversarial) {
          return { ...f, severity: this.escalate(f.severity) }
        }
      }
      // Breaking change at same location as correctness or design issue → escalate
      if (f.agent === 'breaking-change') {
        const hasCorrectnessOrDesign = findings.some(
          (other) =>
            (other.agent === 'correctness' || other.agent === 'design') &&
            stripDiffPrefix(normalizeFilePath(other.file)) === fFile &&
            Math.abs(other.line - f.line) <= SAME_LOCATION_LINE_PROXIMITY
        )
        if (hasCorrectnessOrDesign) {
          return { ...f, severity: this.escalate(f.severity) }
        }
      }
      return f
    })
  }

  private escalate(severity: Severity): Severity {
    const levels: Severity[] = ['low', 'medium', 'high', 'critical']
    const idx = levels.indexOf(severity)
    return levels[Math.min(idx + 1, levels.length - 1)]
  }

  private applyPublicationFilter(findings: Finding[]): Finding[] {
    return findings.filter((f) => {
      if (f.severity === 'low') return false
      if (f.basis === 'SPECULATIVE' && SEVERITY_RANK[f.severity] < SEVERITY_RANK['high'])
        return false
      return true
    })
  }

  private capAndSort(findings: Finding[]): Finding[] {
    return findings
      .sort((a, b) => {
        const sevDiff = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]
        if (sevDiff !== 0) return sevDiff
        // Secondary sort: VERIFIED > INFERRED > SPECULATIVE
        const basisOrder = { VERIFIED: 2, INFERRED: 1, SPECULATIVE: 0 }
        return basisOrder[b.basis] - basisOrder[a.basis]
      })
      .slice(0, this.config.maxFindings)
  }
}
