# `locationCheck` as a False-Positive Predictor — Measurement Contract

**Status:** measured, 2026-09-17–18. **Result: inconclusive against the stated 80% bar (74.2%
measured) — do not act on this without further work.** See Results below.

**Provenance:** the PMB peer reported ACR's local-model findings fabricate plausible-looking
vulnerabilities under prompt pressure rather than reporting "nothing found" — reported earlier,
unquantified. Reinforced 2026-09-17 with a concrete, verified data point: ACR's `security` profile
reported 5 "high"/`blocking:true` findings against the `fix/filtered-files-visibility` branch, and
all 5 were confirmed fabricated by two independent reviewers reading the actual cited lines — every
one cited the wrong `file:line`, and 4 of 5 quoted code that already null-guards via `?.`/`??`/`&&`
(the exact guard being flagged AS the bug is the fix). All 5 came from the `adversarial` agent. All
5 self-reported `locationCheck: mismatch` or `unknown`.

## Task

**MEASURE** whether `locationCheck` (`verified`/`mismatch`/`unknown`, computed deterministically by
`src/core/evidenceLocation.ts`) predicts that a finding is a false positive, using calibration's
existing clean fixtures as ground truth rather than manual labeling.

This is **measurement only.** Whether to demote severity, exclude findings from exit-code
computation, or change anything else in the review pipeline is a follow-up decision this
measurement informs — not part of this contract. Do not change `evidenceLocation.ts`, `runner.ts`,
`orchestrator.ts`, or any agent's severity/blocking logic as part of this work.

## Motivation

`evidenceLocation.ts`'s own header comment records a **deliberate, already-litigated decision**:
`annotateEvidenceLocation` stamps every finding but never drops, reorders, or downgrades one —
"a real finding carrying bad metadata is still a real finding... Dropping is the false-negative
direction, which this project has repeatedly judged the more expensive mistake." Any proposal to
act on `locationCheck` has to either respect that decision or argue convincingly why this case is
different, with real numbers, not five data points from one diff.

`adversarial` has no clean (true-negative) calibration fixture today — `calibration/calibrate.ts`
runs it against exactly one fixture (`adversarial.diff`, a "must find real bug, must not find bait"
case). There is currently no way to measure this agent's false-positive rate the way the other four
agents with clean fixtures can be measured.

## DO NOT ASSUME

**The 5/5 correlation from 2026-09-17 does not transfer.** It is one diff, one profile
(`--profile security`), one agent (`adversarial`). `security`/`secrets`/`dependencies` ran clean on
the same diff and were not measured for their own false-positive rate under this method. Do not
cite "100%" as the established rate — that is exactly the gap this measurement exists to close.

**`mismatch` and `unknown` are not the same signal, and treating them as one is itself an
assumption to test, not a starting fact.** `checkAgainstMap`'s own comment: an `unknown` result
covers "the diff never showed the cited line... that is not evidence of misattribution" — a normal
case, not a fabrication signal. Report the two counts separately; do not pre-aggregate them into
one "bad" bucket before looking at the breakdown.

**This targets a different failure mode than the one `adversarial.ts`'s prompt already hardened
against.** That prompt already has explicit rules against attacker-framing misuse and
unevidenced SQL-injection/IDOR labels (`adversarial.ts:34-46`) — added after past incidents. The
2026-09-17 fabrications were neither; they were generic "null reference"/"uninitialized variable"
claims at wrong line numbers. Do not report this measurement as re-confirming an already-fixed
problem.

## Method

Reuse `calibration/calibrate.ts`'s existing clean-fixture mechanism instead of building a new
verification process — every clean fixture already has ground truth by construction (a documented,
correct diff with no legitimate finding of the kind under test), so any finding that survives on
one is a false positive with no manual labeling step.

- **Fixture:** `calibration/fixtures/adversarial-clean.diff` (added by this contract) — four
  functions, each already defensively guarded against one edge-case class the adversarial prompt
  explicitly hunts for (null/undefined via optional chaining, empty-array indexing, boundary-value
  clamping, malformed-JSON parsing), mirroring the exact guarded-code pattern ACR fabricated
  findings against on 2026-09-17.
- **Case:** `adversarial-clean` in `calibrate.ts`'s `CASES` array, `expectEmpty: true`.
- **Instrumentation:** every finding that survives on any `expectEmpty` /
  `expectNoInjectionOrExceptionClaims` / `forbiddenKeyword` case (i.e. every case whose fixture has
  known ground truth that the finding, or that category of finding, should not exist) is logged
  with `{case, agent, locationCheck, title}` to `calibration/locationcheck-fpr.json`
  (gitignored — this is measurement output, not a fixture). Each run appends a
  `{ranAt, model, falsePositives}` entry rather than overwriting, so trials accumulate.
- **Run:** `CALIBRATION_CASE=adversarial-clean npm run calibrate`, repeated for **N≥20 trials**
  minimum. One or three passes is not enough — the 2026-08-30 model-choice measurement was
  recommended on one pass each and reversed by three; a false-positive _rate_ needs more trials
  than a pass/fail regression check does, since the thing being measured is itself the rare event.
  Extend to the other 4 agents' existing clean fixtures (`dependencies-clean`, `license-clean`,
  `security-sql-clean`, `performance-postimage-clean`) if `adversarial-clean` alone doesn't produce
  enough false positives to say anything (devstral may simply pass most trials clean, in which case
  the absence of data is itself a finding — see Falsification).

## Falsification

The measurement must be capable of showing `locationCheck` does **not** predict false positives.
Report, per agent measured:

1. Total false positives observed across N trials, and N itself (a rate needs a denominator).
2. The `verified`/`mismatch`/`unknown` breakdown among those false positives, **not pre-combined**.
3. Whether any false positive was `locationCheck: verified` — if a fabricated finding can still
   pass the evidence-location check, that alone falsifies "locationCheck predicts fabrication" for
   at least some fraction of cases, however the other numbers land.

**Decision criterion, stated before seeing the data:** if `mismatch`/`unknown` accounts for
≥80% of false positives across N≥20 trials, that is grounds for a follow-up contract proposing a
concrete mitigation (severity demotion or exclusion from exit-code computation — a decision for
that contract, not this one). Below that, the correlation is not clean enough to act on, and this
gets recorded as **measured and inconclusive** rather than re-opened on the strength of five data
points again.

**If it produces too few false positives to reach N≥20 at all, that is a real result too** — it
would mean 2026-09-17's 5/5 was closer to a bad-luck cluster than a standing rate, which is
information the operator needs either way.

## Blocked on

Nothing — Ollama is reachable locally (`devstral:latest` pulled) as of 2026-09-17. Unlike the
corroboration-downgrade contract, this does not need to be interleaved A/B against a second arm, so
it does not need exclusive access the way a multi-pass calibration comparison does.

## Results (N=20, `adversarial-clean` only, `devstral:latest`, 2026-09-17–18)

Ran to the planned N≥20 threshold on the first agent before extending to others, per the Method's
own stopping condition ("if `adversarial-clean` alone doesn't produce enough false positives to say
anything" — it did, so the other 4 agents' clean fixtures were not run this pass).

- **20/20 trials completed. 6 trials (30%) reported zero findings — correct.** The other 14 (70%)
  produced at least one false positive; **31 false positives total** across those 14 (avg. 1.55 per
  failing trial, several trials producing 3–4 distinct fabricated findings against the same four
  already-guarded functions).
- **Breakdown, not pre-combined:** `mismatch` = 23 (74.2%), `verified` = 8 (25.8%), `unknown` = 0.
- **Decision criterion was ≥80% for `mismatch`+`unknown`. Measured: 74.2%. Below the pre-committed
  bar.** Per the falsification design, this is recorded as measured-and-inconclusive, not rounded
  up to "confirmed."
- **Item 3 of Falsification — did any false positive come back `verified`? Yes, 8 of 31 (25.8%).**
  All 8 are the same shape: `skippedAgentCount`, `coveragePercent`, `firstChunkLabel`, and
  `parseStoredNotes` are all already null/empty/malformed-input-guarded in the fixture, and the
  model's quoted evidence for the "verified" false positives accurately cites those exact guarded
  lines — `checkAgainstMap` correctly confirms the quote occurs there, because it does. The claim
  layered on top of the accurate quote ("Potential null policy in skippedAgentCount") is what's
  false. **`locationCheck` verifies citation accuracy, not claim truth** — it was built to catch
  misattributed location, not fabricated content sitting on a correctly-cited line, and this result
  shows those are genuinely separable failure modes, not one masquerading as the other.

**What this rules out:** a blanket "demote severity when `locationCheck != verified`" rule would
have caught the 74.2% majority but silently kept treating the other quarter — the `verified`
fabrications — as fully trustworthy, since by definition they'd pass. That's not a reason the
majority-case mitigation is worthless, but it is a reason it can't be sold as solving the false
positive problem for this agent; **any follow-up contract needs to say explicitly which quarter of
the problem it doesn't touch**, rather than implying `locationCheck` catches fabrication in general.

**What this doesn't rule out:** whether 74.2% would clear the bar with a larger N, a different
model, or averaged across all 5 agents with clean fixtures rather than `adversarial` alone — none
of that was tested. The stopping condition in Method was met (this agent alone produced plenty of
data), so the other agents were deliberately not run this pass; that is a scope choice, not a null
result for them.

**Not started, and deliberately out of scope for this contract:** any code change. The next contract
this could motivate, if the operator wants one, is narrower than "demote on `locationCheck` mismatch" —
it would need to separately address the `verified`-but-fabricated quarter, likely via a mechanism
that checks whether the code at the cited line actually does what the finding claims (not just that
the quote occurs there), which is a materially harder problem than what `evidenceLocation.ts`
currently solves.
