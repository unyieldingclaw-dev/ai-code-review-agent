# Calibration Model Comparison — Devstral vs Ornith-1.5:9b vs Qwen3.5:9b

**Status:** measured, 2026-09-18. **Result: the three models fail in different shapes, not just
different amounts — Devstral fails more often but moderately, Qwen3.5 fails less often but louder,
Ornith has the fewest raw false positives yet the worst reliability and guard-bypass rate. Qwen3.5
is the current restraint leader; this is not yet sufficient evidence to change ACR's production
model.** See Results, What This Doesn't Show, and Next Test Design below.

**Provenance:** triggered by `#85`'s own CI comment reporting 11 fabricated ACR findings across
multiple agent domains (design, complexity, observability, correctness, adversarial), extending the
pattern `2026-09-17-acr-locationcheck-fpr-measurement.md` had already measured for `devstral:latest`
on `adversarial` alone (N=20, 31 false positives, `mismatch`=74.2%/`verified`=25.8%). That raised the
question of whether a different local model would exhibit less of this behavior.

## Method

Same instrumentation as the `locationCheck` measurement contract: `calibration/calibrate.ts` run
against the `adversarial-clean` true-negative fixture (`calibration/fixtures/adversarial-clean.diff`
— four functions, each already guarded against a specific edge case), N=20 trials per model, every
surviving finding logged as `{case, agent, locationCheck, title}`. Any finding on this fixture is a
false positive by construction.

`ornith-1.5:9b` and `qwen3.5:9b` were both confirmed via `/api/show` to report the `thinking`
capability, same as each other; `devstral:latest` does not. `src/core/agents/base.ts:72`
unconditionally requests `think: true` whenever the model supports it, and
`OllamaProvider.chat()` uses `stream: false`, so the full reasoning trace must complete before the
HTTP response returns. Ornith's first batch had a ~60% timeout rate; root-caused via direct raw
Ollama API calls (one trial alone: 111.5s / ~2,872 reasoning tokens) before any retest, not assumed.

**Correction (2026-09-19):** this section originally attributed the retest's lower timeout rate to
raising `agentTimeoutMs` from 180s to 300s via a `CALIBRATION_TIMEOUT_MS=300000` override passed to
`calibrate.ts`. That attribution is wrong. `calibrate.ts`'s agent-invocation call site never passed a
`signal` argument to `BaseAgent.run()` (confirmed by reading `src/core/agents/base.ts` and
`git log` on this call site — it predates this experiment), so `OllamaProvider.chat()`'s
`signal: options.signal ?? AbortSignal.timeout(options.timeout ?? DEFAULT_TIMEOUT_MS)` always fell
through to its own hardcoded `DEFAULT_TIMEOUT_MS` (300,000ms), regardless of
`CALIBRATION_TIMEOUT_MS`, `agentTimeoutMs`, or anything in `config.ts`. Every batch measured in this
document — Devstral's, and both of Ornith's — ran under the same ~300s ceiling the entire time; no
run here was ever actually governed by 180s. The drop in Ornith's timeout rate between its two
batches (below) is real but must be attributed to run-to-run variance, not to a timeout increase that
never took effect. The plumbing bug is fixed as of the `chore/model-recall-calibration` branch
(`calibrate.ts` now passes `AbortSignal.timeout(agentTimeoutMs)` explicitly), so a real
180s-vs-300s comparison is possible going forward but has not been run.

## DO NOT ASSUME

**This fixture only measures the true-negative side of review quality — restraint, not recall.** A
model that reports fewer/less-dangerous false positives on a clean diff has not been shown to still
catch real defects. `adversarial-clean` cannot answer that; only a known-positive/adversarial-dirty
fixture can. Do not read these results as "Qwen3.5 is a better reviewer," only as "Qwen3.5 shows
more restraint on this specific true-negative fixture."

**The experiment does not isolate what causes Ornith's difference from Qwen3.5.** Ornith is
Qwen3.5-based with an added RL self-improvement stage, but likely has additional training beyond
just "Qwen + RL." Do not attribute the gap to RL specifically — the safe claim is about the observed
behavior, not its cause.

**Devstral's raw per-finding data no longer exists.** `calibration/locationcheck-fpr.json` is
gitignored and was overwritten before this comparison began; only the prior doc's aggregate numbers
and qualitative summary survive. The mechanism-level analysis below (verifying each `verified` false
positive against actual runtime behavior) was only possible for Qwen3.5, whose raw log was preserved
during this run. Do not treat the two models' `verified` buckets as demonstrated to be equally
fabricated — that symmetry is asserted in the prior doc's summary, not independently re-verified here.

**`adversarial-clean` is not a perfect oracle, and this was discovered by the results, not assumed
beforehand.** `coveragePercent`'s guard (`Math.max(1, input.totalChunks)`) is documented against
negative/zero, not `undefined`/`NaN` — confirmed empirically, `coveragePercent(5, {totalChunks:
undefined})` returns `NaN`. Whether that is a real defect depends on whether untrusted/parsed data
can ever reach this function without first satisfying the declared non-optional `totalChunks:
number` type — a question this fixture does not settle. **Do not retroactively subtract Qwen3.5's 3
findings on this basis; that would move the goalposts after seeing the data.** The published N=20
numbers in the table below are preserved exactly as measured. The correct fix is a stronger oracle
in the next fixture (see Next Test Design), not a revised count in this one. These 3 findings are
recorded as **scope-dependent/ambiguous**, a category distinct from the other 35 ordinary false
positives across all three models.

## Results (N=20 each, `adversarial-clean`, 2026-09-18)

| Metric | Devstral (prior) | Ornith-1.5:9b @300s | Qwen3.5:9b @300s |
| --- | --- | --- | --- |
| Timeouts | 0 | 3 (15%) | 0 |
| Clean runs (no findings) | 6/20 (30%) | 3/20 (15%)\* | 9/20 (45%) |
| Failing runs | 14 | 17\* | 11 |
| Total false positives | 31 | 20\* | 38 |
| FPs per failing run | 2.21 | 1.18\* | 3.45 |
| `locationCheck: verified` | 8 (25.8%) | 11 (55%) | 7 (18.4%) |
| `locationCheck: mismatch` | 23 (74.2%) | 9 (45%) | 31 (81.6%) |

\* Ornith's 3 timed-out trials produced no output and are excluded from the failing/FP-density
denominators; they are not genuinely "clean," they simply never completed.

**The operationally meaningful result is not "38 > 31" — it's that the three models fail in
different shapes, not just different amounts:**

- **Devstral: fails more often (70% of runs), moderately noisy per failure** (2.21 FPs/failing run).
- **Qwen3.5: fails less often (55% of runs), substantially noisier per failure** (3.45
  FPs/failing run) — fewer entries into a bad state, more output once in one.
- **Ornith: fewest raw FPs of the three (20, vs 31/38), but the worst clean-run rate (15%,
  generously counting timeouts as excluded rather than failed), the only timeout problem (15% even
  at 300s), and by far the worst guard-bypass rate (55% `verified` vs 18.4%/25.8%)** — its low raw
  FP count is not a safety signal once reliability and detectability are accounted for.

**This is enough to reject "fewer findings = safer reviewer" as a sufficient heuristic.** Ornith has
the fewest total false positives of the three and is the worst performer on every measure that
matters for trustworthiness. Qwen3.5 has the most total false positives and is the best performer on
clean-run rate and guard-bypass rate. Total FP count alone would have ranked all three backwards.

**Failure topology (Qwen3.5, from the 38 raw findings):** all from the `adversarial` agent, clustered
on the same 4 already-guarded functions this fixture exercises. Claims recur across runs with
cosmetic wording changes rather than being genuinely diverse — not broad reasoning instability. The
higher FP/failing-run figure is substantially **failure amplification**: when Qwen3.5 decides
something is wrong, it tends to enumerate several related concerns in the same run (up to 5 in one
trial) rather than reasoning instability producing novel hallucinations each time. Qwen3.5 fails less
often (55% of runs vs Devstral's 70%) but louder when it does.

**The 7 `verified` findings, checked against actual runtime behavior (not just re-read), split into
two groups — they do not collapse into one deterministically-fixable pattern:**

- **3 of 7** (the `totalChunks`/undefined family, three different wordings of the same
  observation): `coveragePercent`'s guard `Math.max(1, input.totalChunks)` is documented as
  preventing "division by zero or negative percentage" but says nothing about `undefined`/`NaN`.
  Verified empirically: `coveragePercent(5, {totalChunks: undefined})` returns `NaN`, not a clamped
  value. This requires the caller to violate the declared non-optional `totalChunks: number` type at
  runtime — whether that counts as a real defect depends on whether unvalidated input can reach this
  function, a scope question the fixture doesn't settle. **This is not fabrication; it's a legitimate
  observation about an incompletely-documented guard.**
- **4 of 7** are false claims sitting on accurately-cited lines, each wrong for a different specific
  reason: an integer-overflow claim that doesn't apply to JS numbers; a non-array-`agentsSkipped`
  claim that imagines a declared-type violation with no basis; a "`firstChunkLabel` throws on
  non-string elements" claim, verified false (`firstChunkLabel([null])` returns `null`, array
  indexing never throws); and a "`parseStoredNotes` returns `{}` on valid-but-wrong-schema JSON"
  claim, verified false (`parseStoredNotes('42')` returns `42`, not `{}` — there is a real, narrower
  gap here, unvalidated-schema-cast, but the finding's own stated mechanism is wrong).

## What this doesn't show

Restraint-only evidence. **Where ACR stands as of this measurement: no production change; Qwen3.5:9b
is the current restraint leader; this clean-fixture test exposed an ambiguity in the fixture itself
(see above); known-positive recall is the next gating measurement.** If Qwen3.5 maintains its
restraint advantage and demonstrates comparable-or-better mechanism-correct recall than Devstral,
that is enough evidence to start seriously discussing replacing `devstral:latest` — not before.

**Explicitly not added yet:** a heuristic gating on excessive `adversarial` finding count per run.
Qwen3.5's 3.45 FPs/failing-run is tempting to act on directly, but that would be tuning the harness
around behavior discovered on one true-negative fixture, before knowing whether the same
failure-amplification pattern holds on a known-positive fixture. Building a Qwen-specific guard
before choosing Qwen risks optimizing for a model that isn't adopted.

## Next test design — oracle-backed known-positive fixture (not started)

The next fixture must not be "add some bugs and see what's found." Every planted defect needs an
explicit expected result recorded **before** any model sees the diff:

**ID → location → actual mechanism → expected consequence → minimum evidence required to count as
detected.**

Target 4–6 planted defects, preferably on the same `reviewSummary.ts`-style code surface already
exercised, each testing a different reasoning requirement:

1. A straightforward local correctness bug.
2. A bug whose location is obvious but whose consequence requires reasoning to state correctly.
3. A cross-function/data-flow bug.
4. A boundary-condition bug.
5. A plausible-looking construct that is intentionally correct — a trap for false positives sitting
   next to real defects.
6. Optionally, a contract-validation bug in the shape of the `totalChunks`/`undefined` case found
   here — only if it's first established that untrusted runtime data can actually reach that
   function without validation. Do not repeat the ambiguity this measurement just found.

**Score each model's output against 5 categories per planted defect, not a single hit/miss:**

- Exact detection
- Mechanism-correct but location-imprecise
- Location-correct but mechanism-wrong (the case this measurement's `verified`-but-fabricated
  findings already demonstrate happens — a model citing the right line while inventing the reason is
  not recall success)
- Miss
- Unrelated false positive

**Retention is part of the experiment contract this time, not an optional debugging artifact.**
Raw per-finding logs (title, agent, `locationCheck`, and now the detection category against the
oracle) get copied out of the gitignored `calibration/locationcheck-fpr.json` into a committed or
otherwise durable location immediately after each model's batch completes — the loss of Devstral's
raw log for this measurement is the reason this is now a requirement, not a suggestion.

**Not started, and out of scope for this measurement:** any code or config change. The
`CALIBRATION_TIMEOUT_MS` override added to `calibrate.ts` for this experiment remains local and
uncommitted pending a decision on whether to keep it.

**Update (2026-09-19):** that override never had any effect (see the Method correction above) —
`calibrate.ts` did not read the resulting `agentTimeoutMs` into a `signal` anywhere the provider
call could see it. The call site is now fixed on `chore/model-recall-calibration` to pass
`AbortSignal.timeout(agentTimeoutMs)` explicitly, so `CALIBRATION_TIMEOUT_MS` (and
`DEFAULT_CONFIG.agentTimeoutMs`) are enforced for every case, not just this one.
