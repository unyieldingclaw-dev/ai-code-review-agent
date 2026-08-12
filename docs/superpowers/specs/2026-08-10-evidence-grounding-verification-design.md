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
- A pure deterministic/regex heuristic check as the *sole* mechanism, or as one that can veto a
  finding without the LLM call — won't generalize, and this spec's own re-review of an earlier
  draft found a concrete way it would misfire on messy evidence (see Design, pre-filter). A narrow,
  additive version *is* part of this spec, but strictly as a second signal that never overrides or
  skips the LLM verdict in Stage 1 — see Design.
- A persistent, built-in cross-run log file (e.g. an append-only `.ai-review/evidence-log.jsonl`).
  Considered as a way to track hallucination rate over time, but this tool doesn't own persistent
  storage anywhere else — `--format json` output already carries everything needed per run,
  including a `checkedCount` (see Schema) alongside `flagged`, so an external process piping that
  into its own log/database gets a complete signal without this tool inventing a log-rotation/file-
  management subsystem it would then have to maintain.

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

**Round 2** (4 models, re-ran round 1's original 8 cases verbatim — unchanged wording, as a
same-input consistency check — plus 5 genuinely new cases with better good/bad balance and
messier multi-line diff-style evidence instead of only clean one-liners; `gemma3:4b` dropped as
already disqualified, `deepseek-r1:14b` and `gemma3:12b` added). 13 unique cases total across both
rounds, not 21 — round 1's 8 and round 2's first 8 are the same cases, not independent ones:

| Model | Score | Latency/call |
|---|---|---|
| `qwen3:latest` | 13/13 | 8.8s–55s (mostly <16s) |
| `deepseek-r1:14b` | 13/13 | 20s–72s (reasoning model, 2-3x slower) |
| `devstral:latest` (baseline) | 12/13 | 5-25s — **missed the same case as round 1**, not noise |
| `gemma3:12b` | 6/13 | 3-17s — disqualified, same weakness as the 4b variant regardless of size |

**Conclusion:** `qwen3:latest` got all 13 unique cases right, including getting the same 8 right
both times they were tested (round 1's original run, then round 2's re-run of the identical
wording). `deepseek-r1:14b` matches it on accuracy but at 2-3x the latency. `devstral` (same model
as generation) reproducibly missed the identical case both times it was tested — direct evidence
that cross-model verification catches something same-model verification systematically doesn't.
Both `gemma3` variants are unsuitable regardless of size.

**Known limitation of this validation, carried into the design below:** these cases were designed
by the same person building the verification prompt, with full knowledge of the exact failure
pattern being tested for. They are clean-cut (evidence obviously supports or obviously
contradicts) and the prompt's wording is somewhat tailored to "evidence shows the exact
opposite" specifically. Real diffs will produce messier cases — partial support, evidence that's
simply irrelevant to the claim rather than contradictory, evidence about the wrong part of the
code. 13/13 on the full unique set proves the mechanism works on the shapes tested; it does not
prove the false-rejection rate is this low in the wild. This is the direct motivation for shipping report-only before
enforcing drops (see Design).

## Design

### Architecture

Two functions in a new module (`src/core/evidenceVerifier.ts`), both taking an already-constructed
`LLMProvider` for the configured verifier model rather than building one internally — matches how
every existing agent (`SecurityAgent`, etc.) already takes `provider: LLMProvider` via constructor
injection, keeps the caller (`runner.ts`) in control of actually instantiating a provider that's
deliberately independent from the main review's, and makes both functions trivially mockable in
tests the same way `runner.test.ts` already mocks the main provider:

- The up-front, once-per-run availability check (see Model-not-installed, below), called by
  `runner.ts` before the findings loop starts. This reuses `LLMProvider.ping()` directly rather
  than a separate function — `OllamaProvider.ping()` already returns exactly the `{ ok, error }`
  shape and the same `"Model X not found. Run: ollama pull X"` message this check needs; there's
  nothing left to build.
- `verifyEvidence(finding, provider): Promise<{ verified: boolean; reason: string; preFilterAgreed:
  boolean | null }>` — the per-finding check, only called once availability is confirmed.

**Claim composition:** the `claim` sent to the verifier is `finding.title` + `finding.detail`
concatenated (`title` alone is often too terse to judge — e.g. "Lock failure not logged" needs
`detail`'s fuller sentence to give the verifier enough to check against `evidence`). `evidence` is
`finding.evidence` verbatim, unmodified — it's already the quoted source snippet the original
agent cited, and re-deriving or truncating it here would risk checking the verifier against
different text than what the finding actually claims to be grounded in.

**Retry:** one retry (two attempts total) on *transient* network/timeout errors before failing
open, with a short fixed backoff — matching `OllamaProvider`'s own retry convention for transient
failures elsewhere in this codebase, rather than treating a single blip as a verdict. This does
not apply to model-not-installed (below) — retrying an identical request against a model that
doesn't exist can't succeed, so that case is terminal on the first response, not retried.

**Unparseable verdicts:** if the model responds but the reply doesn't match the expected
`VERDICT: (SUPPORTED|NOT_SUPPORTED)` shape (seen occasionally in validation — see round-2 script's
`UNPARSEABLE` handling), this is treated the same as any other verifier failure: fails open,
logged via `console.error` with the raw (truncated) response included, not silently coerced to
either verdict.

Both retry-exhaustion and unparseable verdicts resolve to `{ verified: true, reason: 'verification
unavailable — <error>' }` — fails open, matching this project's established convention for
uncertain state (malformed config, empty `changedFiles`, unset `AI_REVIEW_ALLOWED_ROOTS` all fail
open already), and logs via `console.error` so the failure is visible, not silently swallowed.
This mirrors `embed()`'s and `loadAgentContextSemantic()`'s existing pattern of catching internally
and returning a safe value, not `OllamaProvider.chat()`'s pattern of throwing — a broken verifier
call must not trigger the agent-retry/timeout machinery upstream, since this isn't agent
generation, it's post-processing.

**Model-not-installed:** checked *once*, up front, before the runner.ts step loops over any
findings — not discovered incrementally on the first per-finding call. Sequential Stage 1 already
means each Critical/High finding can take up to the validation's observed worst case (~55s for
`qwen3:latest`); if the model simply isn't pulled, looping through every finding anyway (each
paying its own retry + backoff, per above) before the run finally completes would multiply a
guaranteed, unrecoverable failure across every finding for no benefit, needlessly stalling the
whole report. Instead this mirrors `OllamaProvider.ping()`'s existing pattern of a cheap up-front
availability check: one call against the verifier model before the loop starts; on a
model-not-found response, every Critical/High finding in this run is immediately marked
unavailable with the same actionable reason (`"verifier model '<model>' not found — run: ollama
pull <model>"`, mirroring `contextLoader.ts`'s existing `nomic-embed-text`-unavailable message)
without a single per-finding call being attempted. `unavailableCount` in this case equals
`checkedCount` for the run — a clear, immediate signal in the report, not N repeated timeouts
before the user finds out.

**Deterministic pre-filter (checked first, alongside — not instead of — the LLM call):** a small,
explicit table of `{ claimPattern, evidencePattern }` regex pairs in `evidenceVerifier.ts`, seeded
directly from this spec's validation cases (e.g. a claim matching `/\bnot logged\b|\bisn't
logged\b/i` whose evidence matches `/\b(log|logger|console\.\w+)\s*\(|\becho\b/i` is a candidate
contradiction — `echo` is matched as a bare keyword rather than requiring a trailing `(`, since
shell `echo` has no parenthesized-call form, unlike `log(...)`/`logger.x(...)`/`console.x(...)`;
this codebase's own headline `echo "WARN: ..." >&2` example from the Problem section wouldn't
match a `\(`-requiring version of this pattern, an inconsistency caught during implementation);
similarly for "not closed"/`with`-`.close()`-`finally`, "not validated"/`if`-`assert`-`throw`).

Unlike the first draft of this idea, **a pre-filter match does not skip the LLM call in Stage 1.**
This codebase's own evidence snippets can carry diff context (the validation set's own
`bad-6-messy-diff-context` case exists specifically because real evidence isn't always clean) — a
naive text match for `log(` doesn't distinguish a currently-executing line from a `-`-prefixed
removed line or a commented-out one. A pre-filter match on messy evidence like that would produce
a confident-looking `NOT_SUPPORTED` with nothing downstream to catch the mistake, which is exactly
the small-scale-success trap this project has already been burned by twice (`parallel: true`,
`adversarial` prompt-tightening) — and unlike the LLM path, this pattern table was never
empirically validated against messy evidence, only asserted from clean cases. So for now the
pre-filter always runs, but only as a second, independent signal alongside the LLM verdict:
`verifyEvidence` records, per finding, whether a pattern matched at all and — only when one did —
whether the LLM's own verdict agreed with it (the pre-filter's only possible implied verdict is
`NOT_SUPPORTED`, so "agreement" means the LLM also said `NOT_SUPPORTED`; see `preFilterAgreed` in
Schema, below), without ever letting the pre-filter's own verdict stand alone. This still delivers
the code-based signal this feature is after — a pattern that reliably matches what
the (validated) LLM independently concludes is a strong, auditable candidate for later promotion —
without asserting reliability the pre-filter hasn't earned yet. Once real usage shows a given
pattern agreeing with the LLM at a high rate (see Tracking, below), promoting that specific pattern
to skip-the-LLM status is a documented follow-up, not part of this implementation — the same
staging judgment already applied to Stage 1 vs. Stage 2 of the feature as a whole.

Called from a new step in `runner.ts`, *after* `orchestrator.synthesize()` produces the final
deduped/filtered findings list, *before* `ReviewResult` is assembled — not inside
`OrchestratorAgent` itself. `OrchestratorAgent` is (as of this project's Batch 3 audit-fix work)
explicitly 100% deterministic with no `LLMProvider` dependency; adding an LLM call there would
undo that property, and synthesis/verification are different concerns (dedup+cross-reference vs.
judgment-checking) that deserve separate homes. Only `severity === 'critical' || 'high'` findings
from the final list are checked, and findings from `DETERMINISTIC_SOURCES` (gitleaks, trufflehog,
semgrep, npm-audit, osv, lizard, git, policy) are skipped entirely — these already bypass
`hallucinationCrossCheck`'s downgrade logic for the same reason (their evidence is tool output, not
model reasoning, so there's nothing for an LLM evidence-check to usefully catch; it would just
spend latency confirming a tool's own report matches itself). Runs sequentially — this project has
direct prior evidence (`parallel: true`'s investigation and reversal) that concurrent Ollama
requests serialize badly on VRAM-constrained local hardware; concurrency isn't the point of this
feature, so it isn't reintroduced here.

**MCP:** `src/mcp/tool.ts` calls the same `loadConfig()` as the CLI, so `verifyEvidence: true` in
project config would otherwise be silently inherited by MCP callers too. This is added to
`MCP_EXCLUDED_AGENTS`'s neighboring exclusion list as an explicit forced-off for MCP specifically
(mirroring how `testgen` is already force-excluded there) — an interactive MCP review is
latency-sensitive in a different way than a CLI/CI run (a human or agent is waiting synchronously
on the response), and Stage 1's added per-finding LLM round-trip isn't worth that cost until Stage
2 enforcement gives it a payoff beyond a report-only flag most MCP callers won't read anyway.

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
  claim: string          // finding.title + finding.detail, concatenated — what was sent as the claim
  evidence: string        // finding.evidence verbatim — what was sent as the evidence
  reason: string          // the verifier's stated reason for its verdict (or the fail-open reason)
  preFilterAgreed: boolean | null   // did the deterministic pre-filter also flag this? null if no
                                     // pattern applied to this claim/evidence pair at all — always
                                     // an *additional signal* alongside the LLM verdict in Stage 1,
                                     // never the sole source of a verdict — see pre-filter, above
}

export interface EvidenceCheckFilterMetadata {
  checkedCount: number               // total findings sent through verification this run
  unavailableCount: number           // of checkedCount, how many fell back to fail-open (retry
                                      // exhaustion, unparseable verdict, or model-not-installed)
  unavailableReasons: string[]       // deduped fail-open reasons this run (e.g. the actionable
                                      // "ollama pull <model>" message) — mirrors
                                      // SanitizerMetadata.warnings's array-of-strings convention
  flagged: EvidenceCheckFinding[]    // Stage 1: findings that failed verification but were kept
}
```

`flagged` contains only genuine `NOT_SUPPORTED` verdicts — a fail-open result (`verified: true`,
whatever the reason) never appears there, since "we couldn't check this" and "we checked this and
it failed" are different findings-review states and conflating them would make a run where the
model wasn't installed look identical, in `flagged`, to a run that genuinely caught nothing wrong.
Fail-open events are visible only in aggregate, via `unavailableCount`/`unavailableReasons` — the
latter is what actually carries the model-not-installed "ollama pull" fix (see Model-not-installed,
above) into the published report; without it, `unavailableCount` alone would tell a reader
something failed but not what to do about it.

Added to `ReviewResult`: `evidenceCheckFilter?: EvidenceCheckFilterMetadata`. Deliberately carries
more context than the precedent it's modeled after (`DroppedHallucinatedFinding` only has `agent`/
`title`/`file`) — that filter's decision (is this file in the diff) is objectively checkable from
outside; this filter's decision is a judgment call, so a human must be able to audit the verifier's
work without digging elsewhere in the report. Field renamed `flagged` (not `dropped`) for Stage 1
since nothing is actually removed yet; Stage 2 can add a `dropped` field alongside or rename, once
that behavior exists.

### Tracking

`checkedCount`/`unavailableCount` exist specifically so `--format json` output is enough, on its
own, to track verification health and hallucination rate across runs without this tool owning any
persistent storage (see the rejected built-in log file in Non-Goals) — a `flagged.length /
checkedCount` ratio per run, captured by whatever the user already pipes JSON output into, is a
complete longitudinal signal. `unavailableCount` separately surfaces verifier *reliability* (is the
mechanism itself working this run) from verifier *findings* (`flagged`), so a spike in one isn't
misread as the other — a run where the model wasn't installed should look different from a run
where the model ran fine and genuinely caught more hallucinations. This is also the feedback loop
for the deterministic pre-filter above: `preFilterAgreed` on every flagged finding gives a running
agreement rate per pattern (of the findings pattern P matched, what fraction did the LLM
independently also mark `NOT_SUPPORTED`?) — the empirical basis Goal #2 requires before trusting a
pattern to skip the LLM call outright. A pattern with a high, stable agreement rate across enough
real runs is a documented candidate for promotion to skip-eligible; a pattern that disagrees often
is evidence it's too naive (e.g. catching diff-removed lines, per the messy-evidence risk noted
above) and needs tightening before it's trusted with anything, let alone a skip. This promotion
decision is a manual, human-reviewed edit to `evidenceVerifier.ts` (not an auto-learning system —
an auto-expanding regex table trained on model output would reintroduce the same reliability
problem this whole feature exists to catch), but the data to make that call is already sitting in
`flagged` across a project's own run history, with no extra instrumentation needed.

### Config surface

```ts
verifyEvidence?: boolean   // default false — opt-in
verifierModel?: string    // default 'qwen3:latest', only read when verifyEvidence is true
```

Plus a `--verify-evidence` CLI flag (`cli/index.ts`), matching existing boolean-flag conventions
(`--no-sanitize`, `--parallel`). `verifyEvidence` is force-excluded for MCP callers regardless of
project config — see Architecture, MCP.

### Formatter updates

`cli/formatter.ts`'s `formatMarkdown` gets a new block surfacing `result.evidenceCheckFilter`,
placed with the other integrity-warning blocks (`hallucinationFilter`, `coverageGapFilter`) near
the top of the report, showing each flagged finding's claim/evidence/reason so a human can review
without cross-referencing. SARIF (`formatters/sarif.ts`) gets the same metadata added to run
properties, matching how `hallucinationFilter`/`truncation`/`toolAvailability` are already
surfaced there. MCP formatter (`mcp/formatter.ts`) is left untouched, matching existing precedent
that it carries none of this class of metadata today, and moot regardless since MCP force-excludes
`verifyEvidence` (see Architecture, MCP).

### Documentation

`README.md` gets a new entry under the existing flags table/section for `--verify-evidence` and
`verifierModel`, plus a short paragraph in whatever section already documents the opt-in-flag
pattern (matching how `--parallel`/hallucination-filter flags are documented today).
`CHANGELOG.md` gets a new entry under the next unreleased version heading describing the feature
as Stage 1 / report-only, explicitly noting it does not drop findings yet — this distinction
matters enough (an opt-in flag that silently doesn't do what a user might assume from its name)
that it belongs in the changelog, not just the README.

## Testing

- `evidenceVerifier.test.ts`: unit tests for the up-front availability check (mocked
  `provider.ping()` returning model-present, model-not-found parsed into the actionable "ollama
  pull" reason, and a generic network error) and for `verifyEvidence` with mocked `LLMProvider`
  responses — `SUPPORTED` verdict, `NOT_SUPPORTED`
  verdict, malformed response, network error exhausting the retry (fails open, logs via
  `console.error`), unparseable verdict (fails open, distinct log message), verdict parsing from
  realistic raw model output, and one case per deterministic pre-filter pattern in both an
  agreeing and a disagreeing configuration (asserts `preFilterAgreed` is set correctly in each
  direction, and that the mock Ollama client **is** still called even when the pre-filter matches
  — proving Stage 1 never lets the pre-filter's verdict stand alone).
- `runner.test.ts`: integration tests — with `verifyEvidence: true`, Critical/High findings get
  checked and populate `evidenceCheckFilter.flagged` on a mocked `NOT_SUPPORTED` verdict, and
  `checkedCount`/`unavailableCount` are populated correctly; a fail-open verdict is asserted to
  increment `unavailableCount` but never appear in `flagged`, proving the two states stay distinct;
  Medium/Low findings are never sent to the verifier at all (asserts the mock was never called for
  them, proving the coverage-scope boundary); findings from `DETERMINISTIC_SOURCES` are likewise
  skipped; a mocked model-not-installed response on the up-front check results in exactly one mock
  call total (not one per finding), with every Critical/High finding in the run marked unavailable
  from that single check; with `verifyEvidence: false` (default), behavior and `ReviewResult` shape
  are fully unchanged from today (regression safety for every existing test).
- `mcp/tool.test.ts`: asserts `verifyEvidence: true` in project config is force-excluded when the
  config is loaded via the MCP path, mirroring the existing `testgen`-exclusion test.
- A permanent, cleaned-up version of `verify-poc.mjs`, living in `calibration/` alongside the
  existing agent-calibration harness but as its own script — this checks verifier *judgment*
  quality against real Ollama, which doesn't fit the agent-generation-oriented calibration loop
  (`calibrate.ts` calibrates what agents generate; this calibrates what the verifier judges).
  Carries forward the full 13-case set from this spec's validation as a permanent regression guard.
