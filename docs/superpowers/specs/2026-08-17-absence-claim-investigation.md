# Absence-Claim False Positives — Investigation and Decision

**Date:** 2026-08-17
**Status:** Investigated, no fix — documented as a known limitation (see README's Known
Limitations section)

## Problem

A bug report ("ai-review-agent (ACR) reliability issues — observed on side-quest-atlas") surfaced
a false positive: the `adversarial` agent flagged "Password fields can be left empty"
(`VERIFIED`, 90% confidence) against `reset_password_screen.dart` in a real Flutter/Dart project.
The claim was wrong — all three affected screens had a pre-existing validator
(`validator: (v) => (v == null || v.length < 6) ? 'Min 6 characters' : null`) that already
rejects empty strings. The validator was untouched by the diff, so it wasn't in the hunk ACR was
given — the agent had no way to see it.

**Root cause, as stated in the original report:** ACR only sees diff hunks, not full-file
context, for absence-based claims ("no X exists"), yet reports such claims at
high confidence as if it had checked the whole file. The report's own suggested fixes: give
absence-claims full-file context, or cap their confidence.

## Investigation

Three mechanisms were designed and empirically tested — brainstormed via `superpowers:brainstorming`,
validated before any implementation, matching this project's established practice (see
`2026-08-10-evidence-grounding-verification-design.md`'s own validation-before-commit precedent,
and the `parallel: true` / `adversarial` prompt-tightening history of designs that looked
reasonable on paper and failed real testing).

### 1. Post-hoc full-file re-verification

Modeled on the existing `evidenceVerifier.ts` pattern: send the full file + the specific claim to
a second model (`qwen3:latest`, the existing default verifier model), ask it to confirm whether
the claimed-absent thing actually exists elsewhere in the file.

**Validation (6 synthetic cases, modeled on the real report plus controls):** 2/5 correct (the
6th crashed on a network error before completing). Failures were not edge cases:

- The real motivating case itself failed — given the actual validator (`v.length < 6` rejects
  empty strings), the model still said "ABSENT_CONFIRMED," reasoning it "does not explicitly
  prevent leaving the field empty" — incorrect application of its own stated logic.
- A dangerous failure: given a claim about `getUserName` lacking a null check, the model said
  "FOUND*ELSEWHERE" — but cited a null check that exists in a \_different function*,
  `getUserAge`. It conflated two functions in the same file. In a report-only design this
  wouldn't delete the real finding, but it would attach a wrong, trust-undermining annotation
  to a genuinely correct one.
- Response times: 48–232 seconds per call, far slower than `evidenceVerifier.ts`'s own validation
  (8.8–55s for the same model, on shorter evidence-snippet prompts, not full files) — directly
  compounding the diff-review timeout problem this whole investigation started from.

**Rejected**: unreliable and too slow.

### 2. Full-file context at generation time

Give the agent the full file up front (via `ReviewInput.context`, the same field already used for
memory-bank context), instead of checking after the fact.

**Validation, against the real case** (real diff hunk + real full file from the actual
`Side-Quest-Atlas` commit, run through the real `AdversarialAgent`, 3 runs each condition):

| Condition                                           | False-claim rate | Notes                                                                     |
| --------------------------------------------------- | ---------------- | ------------------------------------------------------------------------- |
| Baseline (hunk only)                                | 1/3              | Reproduces the reported bug                                               |
| Hunk + full file context                            | 3/3              | Worse than baseline, and higher severity (`high` vs `medium`) in 2/3 runs |
| Hunk + full file + explicit cross-check instruction | 2/3              | Still fails majority of the time despite direct instruction               |

The clearest evidence this isn't an information problem: in the context-only condition, one run's
own reasoning was _"The form can be submitted with an empty password, which triggers a null check
in the validator but does not prevent submission"_ — the model explicitly referenced the
validator it was given, then drew a wrong conclusion from it anyway. In the instructed condition,
one run stated _"The full file does not show any validation for non-empty password before
submission"_ — flatly false about content it was directly told to check.

This matches a prior finding in this project's own history: `adversarial`'s 2026-08-06
prompt-tightening pass (adding explicit negative-example instructions) also showed **zero
measurable improvement** (3/3 → 3/3 hallucinated). Between that and this investigation's result,
the pattern looks like a `devstral:latest`-specific judgment/calibration limitation on this agent
that doesn't respond to more information, more explicit instructions, or a different
context-delivery mechanism.

**Rejected**: no improvement over baseline; made it worse.

### 3. Deterministic confidence-capping (no LLM call)

Detect absence-shaped claims by keyword match against `title`/`detail` (no/missing/lacks/without/
doesn't/can be left/can be null/unvalidated/unchecked/not verified/fails to/allows empty), cap
`confidence` on a match, surface it in a new `ReviewResult` metadata field. No LLM cost, so no
latency concern — the risk moved from "wasted verification call" (harmless) to "false trigger
directly damages a legitimate finding's displayed confidence" (harmful), once the LLM-verification
backstop was removed.

**Validation**: ran the regex against real findings already generated during this session's own
`/change-review` gates (`sqa-run7-editvisit.json`, `cr-security3.json`, and others). 6 of 9 real
findings matched, including a **Critical** "Command injection vulnerability in shell script"
finding, plus IDOR, insecure deserialization, and path traversal findings — none of which are
actually absence-claims needing full-file context; they're regular findings about code patterns
directly visible in their own diff hunks, described with similar words ("without", "missing",
"no"). A broad-enough net to plausibly catch real absence claims fires on the majority of
unrelated, well-grounded security findings.

**Rejected**: precision far too low; would do more harm (undermining trust in correct findings)
than the problem it targets.

## Decision

No automated mitigation for this failure class currently exists that clears the bar of "actually
helps and doesn't cause new harm." Documented as a known limitation in README.md's new "Known
Limitations" section rather than shipping a mechanism that looks like a fix but isn't one.

**Not ruled out for a future revisit:** a different generation or verifier model performing
better on this specific claim shape (only `devstral:latest` was tested for generation;
`qwen3:latest` for verification) — but the cost of testing (another full validation round, tens
of minutes of real Ollama time) wasn't judged worthwhile given the task itself looks
architecturally fragile (holistic cross-function/cross-scope attribution), not simply
capability-limited.
