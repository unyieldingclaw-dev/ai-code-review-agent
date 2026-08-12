import type { LLMProvider, Message } from './llm/provider.js'
import type { Finding, EvidenceCheckFinding, EvidenceCheckFilterMetadata } from './schema.js'
import { DETERMINISTIC_SOURCES } from './agents/orchestrator.js'

// Independent from config.ts's retryAttempts/retryDelayMs (2 attempts, 2000ms) -- those govern
// full agent-generation calls, a heavier and slower request shape than this per-finding
// evidence check. 2 attempts here matches that convention's attempt count; the shorter 1000ms
// backoff is an intentional, deliberately separate choice for a lighter call, not parameter
// drift.
const MAX_ATTEMPTS = 2
const RETRY_DELAY_MS = 1000

// Validated against 13 unique synthetic cases spanning both evidence-contradicts-claim and
// genuinely-correct-finding controls -- qwen3:latest scored 13/13, including the same 8 cases
// both times they were tested across two validation rounds. See docs/superpowers/specs/
// 2026-08-10-evidence-grounding-verification-design.md's Validation section. Not tuned further
// without re-validating.
const SYSTEM_PROMPT = `You are verifying a code review finding, written by someone else. You did not write this finding and have no stake in it being correct -- evaluate it fresh and skeptically.

You will be given a CLAIM and the EVIDENCE cited to support it. Read the evidence literally and carefully. If the evidence shows the exact opposite of what's claimed (e.g. a guard/check that IS present when the claim says it's missing), the claim is NOT_SUPPORTED, regardless of how plausible the claim sounds on its own.

Respond with exactly one line in this format: VERDICT: <SUPPORTED or NOT_SUPPORTED> — <one sentence reason>`

interface PreFilterPattern {
  name: string
  claimPattern: RegExp
  evidencePattern: RegExp
}

// Only ever used as a second, independent signal alongside the LLM verdict (preFilterAgreed) --
// never to skip the LLM call or stand alone as a verdict. This codebase's evidence snippets can
// carry diff context ("- console.log(...)" for a removed line, or a commented-out call), which a
// naive text match can't distinguish from currently-executing code -- letting a match veto a
// finding outright risked a confident-looking false rejection with nothing downstream to catch
// it. See the design spec's Architecture section (pre-filter) for the full reasoning.
const PRE_FILTER_PATTERNS: PreFilterPattern[] = [
  {
    name: 'not-logged',
    claimPattern: /\bnot logged\b|\bisn't logged\b|\bno logging\b/i,
    // `echo` has no parenthesized-call form in shell (unlike log(...)/logger.x(...)/console.x(...)),
    // so it's matched as a bare keyword rather than requiring a trailing "(".
    evidencePattern: /\b(log|logger|console\.\w+)\s*\(|\becho\b/i,
  },
  {
    name: 'not-closed',
    claimPattern: /\bnot (explicitly )?closed\b|\bnever closes?\b/i,
    evidencePattern: /\bwith\b[^\n]*\bas\b|\.close\(\)|\bfinally\b/i,
  },
  {
    name: 'not-validated',
    claimPattern: /\bnot validated\b|\bno validation\b|\bnot checked\b/i,
    evidencePattern: /\bif\s*\(|\bassert\b|\bthrow\b/i,
  },
]

function matchPreFilter(claim: string, evidence: string): string | null {
  const pattern = PRE_FILTER_PATTERNS.find(
    (p) => p.claimPattern.test(claim) && p.evidencePattern.test(evidence)
  )
  return pattern?.name ?? null
}

export interface VerifyEvidenceResult {
  verified: boolean
  reason: string
  preFilterAgreed: boolean | null
  unavailable: boolean
}

// Deliberately takes an already-constructed LLMProvider rather than (verifierModel, ollamaUrl) --
// matches how every existing agent takes `provider: LLMProvider` via constructor injection, and
// the caller (runEvidenceChecks) is the one responsible for constructing a verifier-model
// instance that's genuinely independent from the main review's provider.
export async function verifyEvidence(
  finding: Finding,
  provider: LLMProvider
): Promise<VerifyEvidenceResult> {
  const claim = `${finding.title} ${finding.detail}`
  const evidence = finding.evidence
  const matchedPattern = matchPreFilter(claim, evidence)

  const messages: Message[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `CLAIM: ${claim}\n\nEVIDENCE:\n${evidence}` },
  ]

  let lastErr: Error | null = null
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const raw = await provider.chat(messages)
      const match = raw.match(/VERDICT:\s*(SUPPORTED|NOT_SUPPORTED)/i)
      if (!match) {
        // WHY no retry here (unlike the catch block below): an unparseable response is a
        // malformed-output problem with the prompt/model, not a transient one -- retrying the
        // identical request is unlikely to produce a differently-shaped response.
        console.error(
          `[evidenceVerifier] unparseable verdict for "${finding.title}": ${raw.slice(0, 200)}`
        )
        return {
          verified: true,
          reason: 'verification unavailable — unparseable verdict from verifier model',
          preFilterAgreed: null,
          unavailable: true,
        }
      }
      const notSupported = match[1].toUpperCase() === 'NOT_SUPPORTED'
      const reason = raw.replace(/^VERDICT:\s*(SUPPORTED|NOT_SUPPORTED)\s*[—-]?\s*/i, '').trim()
      return {
        verified: !notSupported,
        reason: reason || raw.trim(),
        preFilterAgreed: matchedPattern === null ? null : notSupported,
        unavailable: false,
      }
    } catch (err) {
      // Unlike the unparseable-verdict case above, a thrown error (network failure, timeout) is
      // exactly the kind of transient condition a retry can plausibly recover from.
      lastErr = err as Error
      if (attempt < MAX_ATTEMPTS - 1) {
        console.warn(
          `[evidenceVerifier] verification call failed for "${finding.title}" (attempt ${attempt + 1}/${MAX_ATTEMPTS}): ` +
            `${lastErr.message} — retrying in ${RETRY_DELAY_MS}ms`
        )
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS))
      }
    }
  }
  console.error(
    `[evidenceVerifier] verification unavailable for "${finding.title}": ${lastErr?.message}`
  )
  return {
    verified: true,
    reason: `verification unavailable — ${lastErr?.message}`,
    preFilterAgreed: null,
    unavailable: true,
  }
}

// Runs the up-front availability check once, then verifyEvidence for each eligible finding.
// Only Critical/High findings from non-deterministic sources are eligible -- DETERMINISTIC_SOURCES
// findings are tool output, not model reasoning, so there's nothing an evidence check would
// usefully catch; it would just spend latency confirming a tool's own report matches itself.
//
// WHY this returns an aggregate object instead of following filterNonexistentFiles/
// filterCoverageGaps's optional-sink-parameter pattern: those two are genuinely filters -- they
// take an array and return a (possibly smaller) array of the same type, with the sink an optional
// side-channel for reporting what got dropped. This function never filters or shrinks `findings`
// at all (Stage 1 is report-only), so there's no filtered array to return -- it's computing an
// independent summary over the input, the same shape as runner.ts's own buildSummary() (findings
// in, aggregate object out, no sink). That's the closer precedent to follow here.
//
// Returns undefined when there's nothing eligible at all, so ReviewResult.evidenceCheckFilter
// stays absent on runs where this had nothing to do (matching truncation/policy's existing
// "only present when relevant" convention). Once it DOES run, checkedCount/unavailableCount are
// always present even with zero flagged findings -- --format json tracking (see design spec's
// Tracking section) depends on that ratio being computable for every run that checked anything,
// not just runs that found something wrong.
export async function runEvidenceChecks(
  findings: Finding[],
  provider: LLMProvider
): Promise<EvidenceCheckFilterMetadata | undefined> {
  const candidates = findings.filter(
    (f) =>
      (f.severity === 'critical' || f.severity === 'high') &&
      !DETERMINISTIC_SOURCES.includes(f.source)
  )
  if (candidates.length === 0) return undefined

  // Checked once, up front -- not discovered incrementally on the first per-finding call. If the
  // model simply isn't pulled, looping through every finding anyway (each paying its own retry +
  // backoff) before the run finally completes would multiply a guaranteed, unrecoverable failure
  // across every finding for no benefit.
  const ping = await provider.ping()
  if (!ping.ok) {
    const reason = ping.error ?? 'verifier model unavailable'
    console.error(`[evidenceVerifier] verifier model unavailable: ${reason}`)
    return {
      checkedCount: candidates.length,
      unavailableCount: candidates.length,
      unavailableReasons: [reason],
      flagged: [],
    }
  }

  const flagged: EvidenceCheckFinding[] = []
  const unavailableReasons = new Set<string>()
  let unavailableCount = 0

  for (const finding of candidates) {
    const result = await verifyEvidence(finding, provider)
    if (result.unavailable) {
      unavailableCount++
      unavailableReasons.add(result.reason)
      continue
    }
    // flagged contains only genuine NOT_SUPPORTED verdicts -- a fail-open result never appears
    // here (handled above), since "we couldn't check this" and "we checked this and it failed"
    // are different report states.
    if (!result.verified) {
      flagged.push({
        agent: finding.agent,
        title: finding.title,
        file: finding.file,
        line: finding.line,
        claim: `${finding.title} ${finding.detail}`,
        evidence: finding.evidence,
        reason: result.reason,
        preFilterAgreed: result.preFilterAgreed,
      })
    }
  }

  return {
    checkedCount: candidates.length,
    unavailableCount,
    unavailableReasons: [...unavailableReasons],
    flagged,
  }
}
