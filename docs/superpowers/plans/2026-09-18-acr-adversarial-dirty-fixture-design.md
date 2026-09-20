# `adversarial-dirty` — Oracle-Backed Recall Fixture Design

**Status:** fixture, oracle, scoring rules, and run configuration locked 2026-09-18, before any
model has been run against this fixture. **Awaiting the agreed checkpoint sign-off before any
trial runs.** Do not run `CALIBRATION_CASE=adversarial-dirty` against any of the three models
until that sign-off happens — this doc itself is the artifact to review.

**Provenance:** the follow-up to
`2026-09-18-acr-model-comparison-devstral-ornith-qwen.md`, which measured restraint only
(`adversarial-clean`, a true-negative fixture) and found the three models differ in failure shape,
not just failure amount. That comparison cannot show recall. This fixture measures it, so that a
model's restraint advantage can be checked against whether it comes at the cost of missing real
defects.

## The fixture

`calibration/fixtures/adversarial-dirty.diff` — a single new file, `src/core/reviewMetrics.ts`
(fixture-only; no such file exists in the real repo, same convention as
`adversarial-clean.diff`'s `reviewSummary.ts`), on the same "small pure functions with edge-case
behavior" surface already exercised. **Deliberately has no in-diff comments revealing which
function is buggy** — unlike the older `adversarial.diff`, which labels its two functions `// REAL`
and `// FALSE POSITIVE BAIT` directly in the diff text a model reads. That labeling is a leak this
fixture avoids; all ground truth lives in the separate oracle file below, never in the diff itself.

4 planted defects, 1 intentionally-correct trap, each independently verified against real runtime
behavior (Node) before being locked in, not just reasoned about:

| ID | Category | Function (lines) | Verified behavior |
| --- | --- | --- | --- |
| `D1-clamp-upper-bound` | Straightforward local bug | `clampScore` (1-5) | `clampScore(150)` → `0` (should be `100`) |
| `D2-offbyone-nan-propagation` | Obvious location, reasoning-required consequence | `averageFindingsPerChunk` (7-13) | Returns `NaN` for every input, including `[]` |
| `D3-ms-seconds-unit-mismatch` | Cross-function/data-flow bug | `chunkDurationsMs` → `formatDurationSummary` (15-22) | 5000ms+3000ms of real duration renders as `"8000s total"` |
| `D4-empty-array-median` | Boundary-condition bug | `medianReviewTimeMs` (24-27) | `medianReviewTimeMs([])` → `undefined`, violating the declared `number` return type |
| `T1-guarded-division-normalizeWeights` (trap, not a defect) | Intentionally correct | `normalizeWeights` (29-33) | `normalizeWeights([0,0,0])` → `[0,0,0]`, no throw, no `NaN` — the `total === 0` guard works |

The optional 6th category (a `totalChunks`-shaped contract-validation bug) is **excluded from this
fixture**, per the approved adjustment: upstream reachability of untrusted input was not
established before this checkpoint, and including it would repeat the exact ambiguity the
`adversarial-clean` measurement just found rather than avoiding it.

Full oracle: `calibration/fixtures/adversarial-dirty.oracle.json` (`version: "1.0.0"`) —
`{id, location, mechanism, expectedConsequence, minimumEvidence}` per defect, plus the trap entry.
**Locked. A revision requires a new version string and a fresh N=20 run under it — no editing the
oracle after seeing any model's output.**

## Pre-registered scoring rules

Fixed now, before any trial, per the explicit concern that duplicates, partial detections, and
correct-location/wrong-mechanism findings are exactly where goalposts move after the fact:

1. **Each oracle defect can earn recall credit at most once per trial.** Multiple findings hitting
   the same defect in one trial do not multiply its credit.
2. **Duplicate or restated detections do not increase recall.** If a trial produces 3 findings all
   pointing at `D1`, that trial's recall contribution for `D1` is identical to a trial with 1
   finding on `D1` — the difference shows up in the duplicate count (rule 5), not in recall.
3. **`location-correct / mechanism-wrong` does not count as detection.** It is tracked as its own
   category, distinct from both `exact` and `miss` — a model citing the right line while inventing
   the wrong reason is not recall success, per the same lesson the `adversarial-clean` measurement
   already produced (Qwen3.5's `firstChunkLabel`/`parseStoredNotes` `verified` false positives were
   exactly this shape).
4. **Any finding whose location doesn't fall within a defect's declared range is an unrelated false
   positive**, including every finding on the trap (`T1`) — counted the same way `adversarial-clean`
   already counts findings on its already-guarded functions.
5. **Duplicates are counted separately, specifically to keep failure-amplification (or its
   recall-side analogue) visible.** Per trial, per defect, record both (a) the single best category
   achieved by any finding on that defect — `exact` beats `mechanism-correct/location-imprecise`
   beats `location-correct/mechanism-wrong` beats no-match — and (b) the raw count of findings that
   located onto that defect. A model that needs 4 restated findings to land one `exact` detection is
   not scored the same as one that lands it in 1, even though both get identical recall credit under
   rule 1 — the raw count is what makes that difference visible, the same way `adversarial-clean`'s
   FPs-per-failing-run made Qwen3.5's amplification visible.

**Classification of `exact` / `mechanism-correct-location-imprecise` / `location-correct-mechanism-
wrong` / `miss` is manual, evidence-verified against the oracle's `minimumEvidence` field and the
fixture's actual runtime behavior — not automated string/keyword matching.** This is a deliberate
scope choice, not an oversight: `activeContext.md`'s own standing risk note is that "claim matchers
are regexes over model prose... that is the fragile half," and this project has already measured
`locationCheck` verifying citation accuracy while saying nothing about claim truth. Building a new
automated mechanism-matcher would repeat that exact category of mistake. What **is** automated in
`calibration/calibrate.ts` (the deterministic, cheap part): for every raw finding, whether its cited
`file`/`line` falls inside a defect's declared range, the trap's range, or neither — logged as
`matchedDefectId` alongside the finding, using the same location-range logic
`evidenceLocation.ts` already applies elsewhere in this codebase. That bookkeeping is what makes the
subsequent manual classification checkable and complete (every finding is accounted for, none can
be quietly skipped), without pretending an NLP classifier can replace it.

Unrelated findings remain counted as false positives per rule 4, using the exact same
`locationCheck` tagging already applied throughout this experiment.

## Locked run configuration

Fixed before any trial, kept identical across all three models except where a model's own defaults
differ (disclosed, not hidden):

- **Model tags and digests** (from `ollama list`, 2026-09-18): `devstral:latest` → `9bd74193e939`;
  `ornith-1.5:9b` → `e5df7dcdd8a2`; `qwen3.5:9b` → `6488c96fa5fa`.
- **Trial count:** N=20 per model, matching the restraint measurement.
- **Timeout:** `CALIBRATION_TIMEOUT_MS=300000` was set for all three models (not just the two
  thinking-capable ones), intended to remove timeout budget as a variable entirely rather than
  leaving it asymmetric.
  **Correction (2026-09-19):** this setting had no effect. `calibrate.ts`'s agent-invocation call
  site never passed a `signal` to `BaseAgent.run()`, so `OllamaProvider.chat()` always fell through
  to its own hardcoded `DEFAULT_TIMEOUT_MS` (300,000ms) regardless of `CALIBRATION_TIMEOUT_MS` or
  `agentTimeoutMs` — confirmed by reading `src/core/agents/base.ts` and
  `src/core/llm/ollamaProvider.ts` directly. All three models in this experiment ran under that same
  hardcoded ~300s ceiling; the value was never actually 180s for any of them, at any point, so
  "removing timeout budget as a variable" was true by accident (the variable never existed at this
  call site to begin with), not because the intended override took effect. Fixed as of the
  `chore/model-recall-calibration` branch: `calibrate.ts` now passes
  `AbortSignal.timeout(agentTimeoutMs)` explicitly, so a future run of this experiment would be the
  first one where `CALIBRATION_TIMEOUT_MS` actually governs the deadline.
- **Sampling parameters (temperature, top_p, seed, etc.):** **not set anywhere in this codebase.**
  Verified by reading `OllamaProvider.chat()` (`src/core/llm/ollamaProvider.ts:107-118`) — the
  request body sends only `model`, `stream: false`, `think` (capability-gated), `format`, and
  `messages`. Every model uses its own Ollama-defined default (from its Modelfile), and the code
  path sending the request is identical for all three — no per-model branching except the
  capability-gated `think` flag. This is disclosed rather than treated as "locked to identical
  values," since there is nothing in this codebase to lock: the sampling values differ per model's
  own default, but the mechanism producing the request does not differ.
- **Prompt/agent config:** the `adversarial` agent's prompt is fixed application code
  (`src/core/agents/adversarial.ts`), not a per-experiment variable — identical for all three
  models by construction, same as every other calibration case.
- **Ollama/LiteLLM configuration:** `OllamaProvider` at `http://localhost:11434` (this project's
  only supported configuration; remote Ollama is rejected as an SSRF risk). No LiteLLM in this
  project (verified earlier this session via `grep -rli litellm`, one unrelated mention in
  `standards/SECRETS.md`).
- **Fixture/oracle version:** `adversarial-dirty.diff` (this file) paired with
  `adversarial-dirty.oracle.json` `version: "1.0.0"`. Every raw log entry records this version
  alongside the model and (via `CALIBRATION_TRIAL`) the trial number, so no future run can be
  silently compared against a since-revised oracle.

## Raw output retention

Every raw finding from every trial — not just false positives — is logged to
`calibration/adversarial-dirty-raw.json`, **deliberately not gitignored** (unlike
`calibration/locationcheck-fpr.json`, whose gitignored status combined with a mid-experiment
overwrite is why Devstral's raw per-finding data no longer exists for the restraint measurement).
Each entry carries `{ranAt, model, trial, case, oracleVersion, agentTimeoutMs, findings: [{file,
line, title, detail, locationCheck, matchedDefectId}]}`. No new logging subsystem — this reuses the
exact append-across-invocations pattern `calibration/calibrate.ts` already has for
`locationcheck-fpr.json`; the only change is the file's gitignore status and the addition of the
`matchedDefectId` tag per finding.

## Explicitly not done in this experiment

- No production model change.
- No model-specific prompt or guard tuning (including the "too many `adversarial` findings"
  heuristic Qwen3.5's restraint results made tempting — still not added, per the prior doc).
- No automated mechanism-correctness scoring (see Pre-registered scoring rules above).
- No inclusion of the optional `totalChunks`-shaped contract-bug category.

## Checkpoint

**Per the agreed checkpoint: this design — the fixture, the oracle, the scoring rules, and the
locked run configuration — is presented for sign-off before any of the three models is run against
it.** A smoke test against the current default model (`devstral:latest`) was run to confirm the new
calibration case executes end-to-end (agent runs, findings are tagged against the oracle, raw log is
written) *before* this doc was finalized — a mechanical check that the harness works, not a scored
trial. **Approved 2026-09-18**, with 5 additional procedural protections applied below before trial 1.

**Terminology correction accepted:** `T1-guarded-division-normalizeWeights` is a **negative
control**, not a fifth defect. 4 known-positive defects + 1 negative control, not "4-5 defects."

## Frozen state (recorded before trial 1, after the checkpoint's post-smoke-test hardening)

sha256 (first 16 hex chars), computed 2026-09-18, immediately before the first scored trial:

| File | Hash |
| --- | --- |
| `calibration/fixtures/adversarial-dirty.diff` | `06a5eccee4e2e255` |
| `calibration/fixtures/adversarial-dirty.oracle.json` | `c7fa4dc695363174` |
| This design doc, as it stood *before* this Frozen State section was appended | `f705467439c1613c` |
| `calibration/calibrate.ts` (with per-model logging, hashing, and the `smoke` flag added) | `e866ebf85bc01192` |

**Not committed to git.** Hashes are being used as the freeze mechanism instead, per the explicit
allowance that hashes suffice when a commit isn't wanted yet — deferred until the full experiment
(all three models' results) is ready to land as one coherent, reviewable change, matching how the
restraint measurement was handled. Any of the four files changing after this point changes its
hash, which is checkable against this table at any time.

**Fixed run order, locked now, not to be reordered based on early results:** `devstral:latest` →
`qwen3.5:9b` → `ornith-1.5:9b`.

**Devstral's smoke run is non-scored and preserved separately, not part of the N=20 dataset.**
Moved to `calibration/adversarial-dirty-raw.smoke.json` (tagged `smoke: true, scored: false`) and
excluded from the live `calibration/adversarial-dirty-raw.json` path, which no longer exists — the
harness was changed after the checkpoint to write one file per model
(`calibration/adversarial-dirty-raw.<model-slug>.json`, plus a `.smoke.json` suffix for any smoke
run), so no single shared file, and no future `rm -f` between models, can ever touch another
model's data. Every entry also carries `fixtureHash`/`oracleHash` (computed fresh per run, not
copied from this table) and `configVersion: "adversarial-dirty-run-config-v1"`, so a log entry is
self-certifying against tampering independent of this document.

**Fixture and oracle were not changed based on anything the smoke run revealed** — the three
distinct cases it surfaced (a real location + wrong mechanism on `D3`, a negative-control hit on
`T1`, and one out-of-range unmatched finding) are read as confirmation the taxonomy is doing its
job, not as a reason to adjust it.

## Results (N=20 attempted per model, 2026-09-18)

**Exact-detection recall per defect, denominator = 20 attempted trials (a timeout counts as a
miss, matching how timeouts were treated in the restraint measurement):**

| Defect | Devstral | Qwen3.5:9b | Ornith-1.5:9b |
| --- | --- | --- | --- |
| `D1-clamp-upper-bound` | 0/20 (0%) | 4/20 (20%) | 15/20 (75%) |
| `D2-offbyone-nan-propagation` | 13/20 (65%) | 16/20 (80%) | 17/20 (85%) |
| `D3-ms-seconds-unit-mismatch` | 0/20 (0%) | 0/20 (0%) | 0/20 (0%) |
| `D4-empty-array-median` | 3/20 (15%) | 6/20 (30%) | 10/20 (50%) |
| **Mean across 4 defects** | **20%** | **32.5%** | **52.5%** |
| Timeouts | 4/20 (20%) | 0/20 (0%) | 1/20 (5%) |
| Trap (`T1`) location-hit trials | 9/16 logged (56%) | 6/20 (30%) | 1/19 logged (5%) |

**`D3`'s 0% is part of the official score for all three models, not excluded or adjusted.** The
"adjacent bug dominated attention" explanation below is interpretation of *why* the miss happened —
it does not touch the number. Removing or footnoting-away a preregistered defect after seeing that
every model missed it is exactly the kind of after-the-fact goalpost move this experiment's whole
methodology exists to prevent. The `20%`/`32.5%`/`52.5%` means above already include `D3`'s `0%` for
all three models.

**The negative-control numbers here (5%/30%/56%) do not cancel or update the `verified`-false-positive
numbers from the restraint measurement (55%/25.8%/18.4%)** — they are not the same measurement and
should not be netted against each other. `adversarial-clean` was purpose-built with 4 already-guarded
functions specifically to provoke false positives on a fixture with **nothing else to look at**. This
fixture has 1 negative control competing for attention against 4 real, planted defects. Ornith's 5%
negative-control rate here says it didn't fabricate a claim about `normalizeWeights` when there were
real bugs elsewhere to find — it says nothing about whether Ornith would still fabricate claims on a
fixture engineered to have no real bugs at all, which is exactly what the restraint measurement
already showed it does, at a high rate. Both numbers stand; neither overrides the other.

**Devstral now carries a real operational strike that didn't exist before this measurement.**
0/20 timeouts on `adversarial-clean`, 4/20 (20%) here — its latency margin is thin enough that
ordinary diff-complexity variation, not just "thinking" mode, can materially change whether ACR
returns an answer at all. That risk was invisible until a fixture larger than the restraint
measurement's existed to expose it.

**The honest summary is a precision-recall-runtime frontier, not a winner:**

| Model | Restraint | Recall | Runtime |
| --- | --- | --- | --- |
| Devstral | mediocre | **weakest** (20% mean) | degraded on this harder fixture (20% timeouts, 0% before) |
| Qwen3.5:9b | **best** (45% clean, 18.4% verified) | middle (32.5% mean) | **best** (0% timeouts on both fixtures) |
| Ornith-1.5:9b | **worst on the clean fixture** (15% clean, 55% verified) | **best** (52.5% mean) | variable / timeout-prone (15%, then 5%) |

**No production model change, and deliberately no synthetic scalar score invented to force a
winner out of this table.** Weighting recall against dangerous-false-positive rate now, having
already seen both outcomes, would encode a preference into the metric after the fact rather than
measuring one. Devstral is no longer the presumed incumbent that a challenger has to decisively
beat — it is one of three candidates, and of the three it currently has the weakest empirical case:
no clear advantage on any of the three axes above, where Qwen3.5 and Ornith each have one.

**`D3` was missed by every trial of every model (0/60 total attempts) — a fixture design finding,
not a model quality signal.** All three models converged on the same *different*, real, but
unplanted observation instead: `chunkDurationsMs` doesn't validate that `startTimes` and `endTimes`
have equal length. That's a legitimate finding (confirmed: mismatched-length inputs do produce
`undefined`/`NaN` via the array read), but it is not the ms/seconds unit mismatch this defect was
built to test. Read plainly: a syntactically obvious "missing length check" pattern sitting next to
a semantic/units bug completely dominated every model's attention, across 60 independent trials. Any
future revision of this fixture should isolate the units defect from an adjacent, easier-to-spot
defect shape, or accept that this particular reasoning class (cross-function unit tracking) needs
its own uncontaminated fixture to be measured at all.

**Devstral timed out on this fixture where it never did on `adversarial-clean`** (4/20 vs 0/20) —
the larger, more substantive diff pushed it toward the 300s budget too, not just the two
thinking-capable models. Timeout is not unique to "thinking" mode; it is at minimum correlated with
diff complexity for every model tested here.

**Classification honesty notes, disclosed rather than smoothed over:**

- A recurring cross-contamination pattern emerged: findings whose *content* clearly describes one
  location (most often the trap, `normalizeWeights`, or `D3`'s `chunkDurationsMs`/`endTimes` pattern)
  but whose *cited line* fell inside a different defect's declared range. The deterministic tagger
  correctly reports these as location hits on the wrong defect; manual classification overrode the
  tagger using the finding's actual content, per the design's own stated split of labor (automated:
  location range; manual: mechanism). None of these overrides changed a trial's best-of outcome,
  because every affected trial also had a separate, genuinely on-target finding — but the raw
  `matchedDefectId` tag alone would have overcounted trap/D3-adjacent false positives as D2/D4 hits
  if taken at face value. This means the trap location-hit-rate row above is a **lower bound**: a
  full re-tag of every contaminated finding by content (not attempted, given the scale) would likely
  push Devstral's and Qwen3.5's trap-adjacent false-positive rates somewhat higher.
- Two lenient calls, applied consistently, not case-by-case: (1) for `D1`, phrasing that clearly
  states "returns/clamps to 0 instead of 100" was credited as exact even when it didn't use the
  literal words in the oracle; (2) for `D4`, phrasing naming "empty array" as the trigger for an
  incorrect/undefined-ish result was credited as exact even when the specific failure mode was
  imprecisely described (e.g. "out of bounds access" rather than "returns undefined") — but a
  finding asserting a mechanism that doesn't exist in the function at all (e.g. "division by zero"
  in `medianReviewTimeMs`, which never divides) was NOT credited, since that is a different kind of
  error from imprecise-but-correct-direction phrasing.
- Full per-trial, per-defect classification with the original finding text preserved verbatim:
  `calibration/adversarial-dirty-classifications.<model-slug>.json`.

## Next: stop building synthetic fixtures, use a labeled historical corpus (not started)

Two synthetic fixtures (`adversarial-clean` for restraint, `adversarial-dirty` for recall) have now
produced a real, load-bearing result — a genuine precision-recall-runtime frontier with no winner —
but both are small, isolated, single-file diffs, not the kind of diff ACR actually reviews in this
repo. The next measurement this points to: a small labeled historical corpus (roughly 10-20 real
past review cases, each with an established disposition — a finding acted on, a finding rejected as
wrong, and ideally a few genuinely clean changes — reviewed with actual repository context rather
than an isolated synthetic diff), run through all three models measuring the same axes (mechanism-
correct recall, unsupported findings, verified-but-false findings, timeouts, failure amplification).
That answers a question neither synthetic fixture can: which model behaves best on the kind of code
ACR actually reviews. Explicitly not doing yet: any model-specific guard, prompt tuning, routing, or
ensemble (e.g. "Ornith for recall, Qwen for verification") — the three base models already behave
very differently, and adding orchestration now would make it impossible to tell whether ACR is
improving or whether harness complexity is just masking the weaknesses this measurement surfaced.

## Manual classification protocol (applied after each model's N=20 batch)

Per-finding mechanism classification against the oracle's `minimumEvidence` field happens in a
**separate** file, `calibration/adversarial-dirty-classifications.<model-slug>.json`, keyed by
`{model, trial, findingIndex}` back to the immutable raw log — the raw finding text is never edited
or overwritten. Each classification entry records: the original finding's `title`/`detail` (copied,
not referenced, so the audit trail survives even if the raw file is later reorganized), the
`matchedDefectId` the harness already tagged, the human-assigned category (`exact` /
`mechanism-correct-location-imprecise` / `location-correct-mechanism-wrong` / `unrelated`), and a
short note citing the specific runtime behavior or oracle language the classification rests on —
the same standard of evidence used for the `adversarial-clean` measurement's `verified` false
positives (checked in Node, not just re-read). This keeps the original model output and the human
judgment call auditable as two separate, comparable records.
