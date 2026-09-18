# Corroboration-Based Severity Downgrade — Measurement Contract

**Status:** approved by the operator, not started. **Blocked on Ollama** (shared with the PMB peer).

**Provenance:** approved during the 2026-08-31 session, then displaced when the `filteredFiles`
contract overwrote `.claude/contracts/active-task.json`. It survived only in a session scratchpad
and then in `handoff.md` — which is gitignored — so it existed on one disk and in no commit until
this document. Re-establish it as the active contract before starting; do not start from memory.

---

## Task

**MEASURE** whether corroboration-based severity downgrade helps or hurts finding quality. The
target is the `orchestrator`'s `hallucinationCrossCheck` — the "Solo High → Medium" rule.

This is **measurement only.** Whether to change the behaviour is an operator decision that the
measurement informs. Do not change the orchestrator as part of this work.

## Motivation

Minority Sentinel (arXiv 2606.29270), **verified by reading the paper, not a search summary.**

Majority voting suppresses correct minority opinions because LLM errors correlate through shared
pretraining, violating the Condorcet independence assumption that majority voting rests on. Across
1,754 questions the paper measured ~39% divergence, and in **25.5% of divergent cases the minority
was correct** (74.3% majority accuracy against an 84.3% oracle).

The part that matters for us: **they used three vendors** — GPT-4o-mini, Gemini-2.0-Flash, and
Claude Haiku 4.5 — deliberately seeking architectural diversity, and still measured that. ACR runs
**one model with sixteen system prompts**. Our agents share identical weights, so error correlation
should be strictly _higher_ than what the paper measured, not lower.

Compounding it: the security literature favours recall over precision — a false negative ships a
vulnerability, a false positive costs engineer time — and our downgrade optimises the other way.

## DO NOT ASSUME

**The 25.5% figure does not transfer.** It comes from QA benchmarks, not code review, and the paper
explicitly does not evaluate same-model-different-prompt setups. That gap is precisely what this
measurement exists to fill.

Do not cite 25.5% as our rate. Do not change the orchestrator on a borrowed number.

## Method

A/B the downgrade against the calibration suite.

- Add an **off-by-default** switch controlling the downgrade.
- Run both arms **interleaved, minimum three passes each.** One pass per arm is not enough: the
  2026-08-30 model-choice measurement was recommended on one pass each and then **reversed by
  three**.
- Target specific cases with `CALIBRATION_CASE=name1,name2` rather than running all 21.
- Use `grep "orchestrator] dropped"` to separate a real filter effect from model variance.
- **Record the delta, not the level.** Calibration is nondeterministic; absolute pass counts drift.

## Falsification

The measurement must be capable of showing the downgrade is **harmful**. Report:

1. How many findings moved High → Medium.
2. How many of those the fixture expected as real.
3. Whether any expected-High case passes with the downgrade off and fails with it on.

**If it changes nothing measurable, that is a real result to record — not a reason to retry until
it moves.**

## Blocked on

Ollama, shared with the PMB peer session. **Announce before starting.** A full calibration pass is
~11–13 minutes, and `ollama ps` cannot tell you whether a multi-pass run is already in flight — a
chunked run between chunks is indistinguishable from idle. Ask the consumer side.

---

# Second finding — needs its own contract, do not fold it in

**Grammar-constrained decoding may be costing reasoning accuracy.**

Constrained decoding (`format: 'json'`) is reported to cost **10–30% reasoning accuracy**, because
the model must begin emitting answer fields before it has finished its chain of thought.

`systemPatterns.md` records that enabling it raised truncation here from **1/16 to 11/16**, and
treats the 4-stage recovery parser as the answer — machinery built around a symptom rather than its
cause. ACR is unusually well placed to drop the constraint, since that tolerant parser already
exists and would catch the fallout.

**UNVERIFIED beyond search summaries. Read the primary sources before acting on any of this.** It is
recorded here so the thread is not lost, not because it is established. It warrants a separate
contract with its own measurement design — do not append it to the corroboration work above.
