# Evidence-Grounding Verification Pass — Design Spec

**Date:** 2026-08-10
**Status:** Approved

## Problem

A consolidated report from two independent ACR runs against an identical real-world diff
(Personal-Memory-Bank's concurrent-session-claims feature, ~8000 lines) surfaced a hallucination
class none of this project's existing defenses catch: **findings whose own cited evidence
contradicts their claim.** Examples from the report:

- `observability`: claimed lock-failure isn't logged and "recommended" adding
  `echo "WARN: could not acquire session-claims lock, skipping" >&2` — that exact line already
  existed in the reviewed file.
- `performance`: claimed a Python temp file isn't explicitly closed, risking fd exhaustion, citing
  `with open(tmp, 'w') as f:` as evidence — `with` is a context manager; it closes by definition.
- `adversarial`: claimed `release` with no `--claim-id` silently no-ops, while its own quoted
  evidence block showed `if [ -z "$claim_id" ]; then echo usage...; exit 2` — the guard it says is
  missing is in the quote it cites.
- `breaking-change`: labeled "a new hook was added to SessionStart" as Critical/Blocking — a purely
  additive change that matches none of `breakingChange.ts`'s own 9 stated breaking-change criteria
  (verified directly against the prompt).
- The same false claim (`${2:-}; shift 2 2>/dev/null || shift` flagged as an unbound-variable
  hazard, when it's literally the fix for that bug class) reproduced across two independent runs on
  identical input — a fixed prior in the model's pattern-matching, not real evaluation.

**Root cause, verified against this codebase's own existing defenses, not assumed:**
`filterNonexistentFiles` (`orchestrator.ts`) checks whether a finding's `file` exists in the diff's
changed-file set. `hallucinationCrossCheck` (`orchestrator.ts`) downgrades severity for
uncorroborated solo findings from non-deterministic sources. **Neither checks whether a finding's
reasoning is actually consistent with the evidence it quotes.** A finding can cite a real line, in
a real changed file, and still be wrong — and every current defense would let it through.

A live, first-party example of the same failure surfaced during this project's own audit-fix work
(2026-08-10): ACR's security profile (npm-installed `v1.9.0`) flagged `resolveWriteTestPath` — the
function added specifically to *fix* a path-traversal bug — as introducing path traversal, citing
the containment check that prevents it. Confirmed false positive by reading the code directly.

This is a genuinely different problem from prior hallucination work in this codebase
(`dependencies`/`license`'s prompt-template bait removal, `secrets`/`dependencies`'s
deterministic-tool replacement) — those addressed *fabrication from nothing* or *judgment
unreliability on domains that are actually pattern-matchable*. This is *reasoning that doesn't
follow from evidence the model itself quoted correctly.*

## Goals

1. Catch findings whose cited evidence doesn't actually support their claim, for the
   highest-stakes subset of findings (Critical/High — the ones that gate `--fail-on` and get
   treated as urgent), before they're published.
2. Validate the mechanism empirically before building pipeline integration around it — this
   project has direct precedent for prompt-only fixes *not* working (`adversarial`'s
   prompt-tightening: 3/3 → 3/3 hallucinated, no measurable improvement) and for a
   promising-looking-at-small-scale change needing a deeper test before being trusted
   (`parallel: true`'s reversal after real-scale testing revealed the small test's assumption
   didn't hold).
3. Ship in a way that doesn't put existing users at risk from an unproven mechanism: opt-in, not
   default; report-only before enforcing drops.
4. When a finding is dropped, make it auditable — a human must be able to check the verifier's
   call without hunting elsewhere in the report.

## Non-Goals

- Fixing Medium/Low-severity hallucination — scoped to Critical/High only. No evidence from the
  report that lower-severity findings cause comparable real-world harm (they don't gate
  `--fail-on` by default), and checking every finding would scale the added latency with total
  finding count instead of keeping it proportional to what's actually at stake.
- The "only trigger verification when it would change the `--fail-on` outcome" optimization —
  genuinely good idea, deferred as a documented follow-up once the opt-in flag has real usage
  behind it. Coupling the trigger to `failOn` config now, before the base mechanism is proven,
  is exactly the kind of complexity this project's own guardrails (YAGNI) warn against building
  on spec.
- A two-tier verifier-model strategy (e.g. `qwen3` for routine runs, `deepseek-r1:14b` for a
  "final" pass). Both models scored identically (100%) on every case tested in this spec's
  validation — there is currently no measured accuracy gap to justify tiering. The verifier model
  is configurable (see Design), so this remains a cheap future change if a real gap is ever
  observed, not a wall.
- Same-call self-critique (asking the original generating agent to double-check itself in the same
  response) — considered and rejected. This project's own precedent (`adversarial` prompt-tightening
  showing no improvement) is exactly why: a model defending a claim it just made in-context tends to
  rationalize rather than reverse itself.
- A pure deterministic/regex heuristic check — considered and rejected as the *sole* mechanism.
  Zero latency cost, but only catches failure shapes already pattern-matched by hand; won't
  generalize. (A future, additive heuristic pre-filter isn't ruled out, just not part of this spec.)

## Validation (done before committing to this design)

Built `verify-poc.mjs` (scratch script, not shipped) calling Ollama's `/api/chat` directly — same
request shape as `OllamaProvider`, bypassing the review pipeline entirely, matching this project's
established practice of validating a prompt directly before building it into the pipeline.

**Round 1** (3 models, 8 synthetic cases modeled on the report's specific patterns — 5 evidence-
contradicts-claim cases, 3 genuinely-correct-finding controls):

| Model | Score |
|---|---|
| `qwen3:latest` | 8/8 |
| `devstral:latest` (same-model baseline) | 7/8 — missed the observability case |
| `gemma3:4b` | 3/8 — disqualified: approved 3/5 bad claims, false-rejected 2/3 good ones |

**Round 2** (4 models, 13 new cases — no wording overlap with round 1, better good/bad balance,
messier multi-line diff-style evidence instead of only clean one-liners; `gemma3:4b` dropped as
already disqualified, `deepseek-r1:14b` and `gemma3:12b` added):

| Model | Score | Latency/call |
|---|---|---|
| `qwen3:latest` | 13/13 | 8.8s–55s (mostly <16s) |
| `deepseek-r1:14b` | 13/13 | 20s–72s (reasoning model, 2-3x slower) |
| `devstral:latest` (baseline) | 12/13 | 5-25s — **missed the same case as round 1**, not noise |
| `gemma3:12b` | 6/13 | 3-17s — disqualified, same weakness as the 4b variant regardless of size |

**Conclusion:** `qwen3:latest` is 21/21 across two independently-built test rounds.
`deepseek-r1:14b` matches it on accuracy but at 2-3x the latency. `devstral` (same model as
generation) reproducibly missed the identical case in both rounds — direct evidence that
cross-model verification catches something same-model verification systematically doesn't. Both
`gemma3` variants are unsuitable regardless of size.

**Known limitation of this validation, carried into the design below:** these cases were designed
by the same person building the verification prompt, with full knowledge of the exact failure
pattern being tested for. They are clean-cut (evidence obviously supports or obviously
contradicts) and the prompt's wording is somewhat tailored to "evidence shows the exact
opposite" specifically. Real diffs will produce messier cases — partial support, evidence that's
simply irrelevant to the claim rather than contradictory, evidence about the wrong part of the
code. 21/21 proves the mechanism works on the shapes tested; it does not prove the false-rejection
rate is this low in the wild. This is the direct motivation for shipping report-only before
enforcing drops (see Design).

## Design

### Architecture

A new pure function, `verifyEvidence(finding, verifierModel, ollamaUrl): Promise<{ verified:
boolean; reason: string }>`, in a new module (`src/core/evidenceVerifier.ts`). Constructs its own
`OllamaProvider` instance against the configured verifier model — deliberately independent from
the main review's provider/model, since the whole point is a fresh model with no memory of the
original claim. Internally catches all errors (network failure, timeout, malformed response) and
resolves to `{ verified: true, reason: 'verification unavailable — <error>' }` — fails open,
matching this project's established convention for uncertain state (malformed config, empty
`changedFiles`, unset `AI_REVIEW_ALLOWED_ROOTS` all fail open already), and logs via
`console.error` so the failure is visible, not silently swallowed. This mirrors `embed()`'s and
`loadAgentContextSemantic()`'s existing pattern of catching internally and returning a safe value,
not `OllamaProvider.chat()`'s pattern of throwing — a broken verifier call must not trigger the
agent-retry/timeout machinery upstream, since this isn't agent generation, it's post-processing.

Called from a new step in `runner.ts`, *after* `orchestrator.synthesize()` produces the final
deduped/filtered findings list, *before* `ReviewResult` is assembled — not inside
`OrchestratorAgent` itself. `OrchestratorAgent` is (as of this project's Batch 3 audit-fix work)
explicitly 100% deterministic with no `LLMProvider` dependency; adding an LLM call there would
undo that property, and synthesis/verification are different concerns (dedup+cross-reference vs.
judgment-checking) that deserve separate homes. Only `severity === 'critical' || 'high'` findings
from the final list are checked. Runs sequentially — this project has direct prior evidence
(`parallel: true`'s investigation and reversal) that concurrent Ollama requests serialize badly on
VRAM-constrained local hardware; concurrency isn't the point of this feature, so it isn't
reintroduced here.

### Rollout: report-only before enforcement

Given the validation's known limitation (clean-cut synthetic cases, unmeasured real-world
false-rejection rate), this ships in two stages under the same flag:

- **Stage 1 (this implementation):** `--verify-evidence` runs the check and populates
  `ReviewResult.evidenceCheckFilter` with what *would* be dropped and why — but does not remove
  anything from the published `findings`. This lets real usage validate the false-rejection rate
  with zero risk of losing a real finding.
- **Stage 2 (follow-up, not part of this implementation):** once Stage 1 has real usage behind it,
  promote to actually dropping `NOT_SUPPORTED` findings from the published set.

This sequencing is itself a smaller version of the same judgment already applied to the feature as
a whole (opt-in, not default) — an unproven mechanism gets a safety stage before it can affect
what a user sees, the same way it gets a safety gate before it runs at all.

### Schema

```ts
export interface EvidenceCheckFinding {
  agent: AgentName
  title: string
  file: string
  line: number
  claim: string        // the finding's own detail/title, what was actually checked
  evidence: string      // the finding's own evidence field, what was actually checked
  reason: string        // the verifier's stated reason for its verdict
}

export interface EvidenceCheckFilterMetadata {
  flagged: EvidenceCheckFinding[]   // Stage 1: findings that failed verification but were kept
}
```

Added to `ReviewResult`: `evidenceCheckFilter?: EvidenceCheckFilterMetadata`. Deliberately carries
more context than the precedent it's modeled after (`DroppedHallucinatedFinding` only has `agent`/
`title`/`file`) — that filter's decision (is this file in the diff) is objectively checkable from
outside; this filter's decision is a judgment call, so a human must be able to audit the verifier's
work without digging elsewhere in the report. Field renamed `flagged` (not `dropped`) for Stage 1
since nothing is actually removed yet; Stage 2 can add a `dropped` field alongside or rename, once
that behavior exists.

### Config surface

```ts
verifyEvidence?: boolean   // default false — opt-in
verifierModel?: string    // default 'qwen3:latest', only read when verifyEvidence is true
```

Plus a `--verify-evidence` CLI flag (`cli/index.ts`), matching existing boolean-flag conventions
(`--no-sanitize`, `--parallel`).

### Formatter updates

`cli/formatter.ts`'s `formatMarkdown` gets a new block surfacing `result.evidenceCheckFilter`,
placed with the other integrity-warning blocks (`hallucinationFilter`, `coverageGapFilter`) near
the top of the report, showing each flagged finding's claim/evidence/reason so a human can review
without cross-referencing. SARIF (`formatters/sarif.ts`) gets the same metadata added to run
properties, matching how `hallucinationFilter`/`truncation`/`toolAvailability` are already
surfaced there. MCP formatter (`mcp/formatter.ts`) is left untouched, matching existing precedent
that it carries none of this class of metadata today.

## Testing

- `evidenceVerifier.test.ts`: unit tests for `verifyEvidence` with mocked Ollama responses —
  `SUPPORTED` verdict, `NOT_SUPPORTED` verdict, malformed response, network error (fails open,
  logs via `console.error`), verdict parsing from realistic raw model output.
- `runner.test.ts`: integration tests — with `verifyEvidence: true`, Critical/High findings get
  checked and populate `evidenceCheckFilter.flagged` on a mocked `NOT_SUPPORTED` verdict; Medium/
  Low findings are never sent to the verifier at all (asserts the mock was never called for them,
  proving the coverage-scope boundary); with `verifyEvidence: false` (default), behavior and
  `ReviewResult` shape are fully unchanged from today (regression safety for every existing test).
- A permanent, cleaned-up version of `verify-poc.mjs`, living in `calibration/` alongside the
  existing agent-calibration harness but as its own script — this checks verifier *judgment*
  quality against real Ollama, which doesn't fit the agent-generation-oriented calibration loop
  (`calibrate.ts` calibrates what agents generate; this calibrates what the verifier judges).
  Carries forward the full 21-case set from this spec's validation as a permanent regression guard.
