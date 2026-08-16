# Review Reliability Fixes — Design Spec

**Status:** Draft
**Date:** 2026-08-16

## Problem

A live run (`ai-review-agent --profile security --diff <patch>` against a real Flutter/Dart
project) surfaced four independent, reproducible reliability gaps, each verified directly against
this codebase's source (not assumed from the report):

1. **Silent diff truncation.** `runner.ts:253-270` keeps only the first `maxDiffLines` (default
   2000) lines of an oversized diff and drops the rest, with a single stderr line plus one
   markdown-report line as the only signal. On the reproducing run, 2989 of 4989 lines (60%) were
   never analyzed. Exit code is unaffected by truncation — confirmed in `exitCode.ts`/`cli/index.ts`,
   whose only exit-code inputs are agent failures (code 2) and finding severity (code 1). A caller
   gating CI on exit code alone gets a "clean" result on a review that silently skipped most of the
   diff. (Citation note: the "different kind of incomplete than an agent that outright failed"
   reasoning for this being a deliberate prior decision is in `activeContext.md`'s 2026-07-18 entry,
   not `progress.md`'s — both files corroborate the same decision, but the exact wording lives in
   `activeContext.md`.)

2. **Response truncation on every agent, every run.** All four agents in the reproducing run
   (security, secrets, dependencies, adversarial) hit `base.ts`'s Stage 4 recovery ("response
   appears truncated -- recovered 1 complete finding(s) before the cutoff"). Verified: `provider.ts`'s
   `ChatOptions` has no `num_predict`/token-budget field at all, and `base.ts:38` sends
   `format: 'json'` unconditionally on every call. This project's own prior measurement
   (`activeContext.md`, 2026-07-25/26) already found `format: 'json'` alone raises truncation
   frequency roughly 11x (1/16 → 11/16 calibration cases) — likely because grammar-constrained
   decoding runs out of its (unreserved) response budget before it can close the JSON structure.
   `num_ctx` is already generously set to 32k at the Ollama server level (`techContext.md`), so
   context-window exhaustion alone is an unlikely primary cause, but hasn't been ruled out for
   large diffs. Net effect: real findings are silently discarded after already being paid for in
   generation time.

3. **Prose-vs-code confusion on documentation files.** `security.ts`/`adversarial.ts` prompts have
   no file-type awareness at all (confirmed by reading both in full) — nothing distinguishes a
   `.md` file's prose description of a vulnerability pattern from an actual vulnerable code path.
   The reproducing run's two highest-confidence findings (95%, 90%) were both the security/
   adversarial agents misreading `.claude/commands/*.md` — process documentation — as executable
   code, with one finding's own quoted "evidence" directly contradicting its claim.

4. **Dependencies agent assumes a Node.js project unconditionally.** `dependencies.ts`'s `run()`
   only gates the *deterministic* `npm audit` path on whether `package.json`/`package-lock.json`
   changed in the diff; when that's false it falls through unconditionally to the LLM fallback
   (`super.run()`), whose prompt is entirely npm-shaped. There is no project-type detection
   anywhere in the agent. On a Dart project with no `package.json` anywhere in the repo, this
   produced a "Missing package.json changes" finding against a project that has never had one.

## Goals

- Fix all four without adding cost to the common case — several of these fixes should *reduce*
  wasted tokens/calls, not just trade one cost for another (explicit design constraint from the
  user: token + performance efficiency, without sacrificing review quality).
- Prefer deterministic fixes over prompt-only instructions where this project already has evidence
  prompt-tightening alone underperforms (secrets/dependencies/adversarial prior history).
- Preserve existing, deliberate design decisions unless there's a stated reason to revisit them
  (see Issue 1 below — truncation was intentionally kept out of the agent-failure exit code once
  already).

## Non-Goals

- Full multi-ecosystem dependency scanning (pubspec.yaml/Cargo.toml/go.mod detection with
  per-ecosystem deterministic tools, mirroring the gitleaks/npm-audit precedent). Real value, but
  a much larger feature — deferred to its own future effort.
- Auto-chunking a truncated diff into multiple merged passes. Would fix coverage completely but
  multiplies token cost by chunk count on every oversized diff by default, which conflicts with
  the stated efficiency constraint. An opt-in flag for callers who explicitly want this is in
  scope; an always-on default is not.
- Fully solving response-truncation with a single guessed config value. The right fix depends on
  measuring where the real budget goes (see Issue 2) — this spec defines the diagnostic step and
  the config surface, not a specific hardcoded number.

## Design

### Issue 1: Diff truncation visibility

**Approach:** introduce a new, dedicated exit code for "incomplete coverage," separate from the
existing agent-failure code. `activeContext.md`'s 2026-07-18 entry recorded a deliberate prior
decision to keep truncation out of exit code 2 specifically because "a truncated but successful
review is a different kind of incomplete than an agent that outright failed" — that distinction is
preserved by using a new code rather than reusing 2, and further refined below so a genuine
severity-based failure is never masked by the new code either.

- New `TRUNCATION_EXIT_CODE = 3` in `exitCode.ts`, alongside the existing
  `AGENT_FAILURE_EXIT_CODE = 2`.
- `cli/index.ts`'s exit sequence gains a truncation check. **Priority order (highest first):
  agent failure (2) → blocker severity (1) → truncation (3) → clean (0).** Blocker severity
  deliberately outranks truncation: a run that's both truncated *and* found a genuine Critical
  finding in the reviewed portion must still exit 1, not 3 — a CI gate keyed on exit code 1 has to
  see the real blocker. Truncation (3) only distinguishes "clean because nothing was found" from
  "clean-looking because coverage was incomplete" on runs with no severity-based failure. Agent
  failure stays highest priority since it means agents didn't run at all, a strictly worse state
  than "ran but incomplete."
- New `--allow-truncation` CLI flag (default off) to opt back into exit 0 on a truncated-but-
  otherwise-clean run, for callers who've deliberately accepted partial coverage (e.g. CI configured
  to just warn). Mirrors `--fail-on never`'s existing opt-out pattern.
- New opt-in `--chunk` flag: when a diff exceeds `maxDiffLines` and `--chunk` is passed,
  `preprocessDiff()` splits it into sequential `maxDiffLines`-sized chunks instead of truncating to
  one. The existing per-agent loop (including Issue 3's per-agent `filterDiff()` policy step, which
  runs unchanged inside each chunk) then runs once per chunk. No new merge/dedup step is needed:
  `runner.ts:716` already accumulates every agent's findings into one `allFindings` array across
  the existing single vs. sequential vs. parallel code paths and calls the (already-public)
  `orchestrator.synthesize()` exactly once at the end — chunked runs just add more `agent.run()`
  calls into that same accumulator before synthesis, so deduplication happens for free through the
  existing mechanism. Off by default — the default path's cost is unchanged from today. This is
  the only mechanism in this spec that meaningfully increases token cost, and only when explicitly
  requested. When `--chunk` achieves full coverage, `truncationMeta.truncated` is `false` and exit
  code 3 does not fire — chunking and truncation are mutually exclusive outcomes for a given run.
- Markdown/SARIF/github-annotations formatters already surface `result.truncation` — no format
  changes needed beyond ensuring the new exit code is documented alongside it.

### Issue 2: Response truncation

**Approach:** diagnose before fixing. Add a diagnostic harness (a script under `calibration/`,
matching the pattern already established by `calibration/evidenceVerifierCalibration.ts`) that
runs a real oversized-diff prompt through `OllamaProvider.chat()` directly, logging: prompt token
count (via Ollama's own `prompt_eval_count` response field, not estimated), response token count
at the point of cutoff (`eval_count`), and whether `done_reason` reports `length` (hit a cap) vs.
`stop` (model chose to stop) vs. something else. Ollama's `/api/chat` response already includes
these fields — this doesn't require new instrumentation, just reading fields already returned and
currently discarded.

Based on what that measurement shows, the fix is one of (not all) the following — this spec
intentionally leaves the final choice to what's measured rather than guessing:

- If `done_reason: length` and prompt tokens are small relative to 32k: the model/Ollama's default
  `num_predict` is capping generation too early. Add an explicit `num_predict` to `ChatOptions`,
  sized generously (e.g. 4096) based on the measured shortfall, not an arbitrary round number.
- If prompt tokens are consuming most of the 32k budget on large diffs: the fix is reserving
  response headroom relative to `num_ctx`, not just raising `num_predict` blindly (raising a cap
  that's already unreachable because the prompt ate the budget wouldn't help).
- If truncation correlates specifically with `format: 'json'` requests independent of both of the
  above: worth re-confirming today's measurement still holds on the current model, and considering
  whether `format: 'json'` should stay on for agents most prone to this on large diffs.

Whichever mechanism the measurement points to, `ChatOptions.numPredict?: number` is added as a new
optional field either way (needed regardless of which branch above fires), threaded through
`OllamaProvider.chat()`'s request body the same way `format`/`think` already are.

**Call sites (explicit, since there are 4 and they differ):** `numPredict` is wired into
`base.ts:38` and `coverageAnalyst.ts:70`'s `provider.chat()` calls only — both send
`format: 'json'` and are the two call sites actually implicated by the measured truncation
problem. `testGen.ts:66` outputs raw test code, not JSON (already excluded from `format: 'json'`
per prior work), and is out of scope. `evidenceVerifier.ts:102` sends a single short
SUPPORTED/NOT_SUPPORTED verdict line, not a findings array, and has not been observed to truncate
— also out of scope. The value itself comes from a new `ReviewConfig.responseTokenBudget?: number`
field (not a CLI flag — this is an internal reliability knob, not something most callers need to
tune), defaulted to whatever the diagnostic script's measurement indicates.

**Efficiency note:** this is very likely to be a net token-efficiency win, not a cost — currently
the model already generates tokens up to whatever the silent cutoff is, and everything past the
one salvaged finding is generated, paid for, and discarded. Fixing the cutoff means those tokens
produce usable output instead of being wasted.

### Issue 3: Prose-vs-code confusion

**Approach:** per-agent diff-content filtering, reusing the existing `filterDiff()`
(`ignoreFilter.ts`) rather than writing new diff-parsing logic. `filterDiff` already splits a diff
into per-file sections and drops sections matching an exclude glob — currently only ever applied
once, globally, via `ignorePaths`.

- `runner.ts` gains a per-agent diff-preparation step: right before an agent with a
  configured `agentPolicy[agent].exclude` runs, call `filterDiff(diff, { excludes: rule.exclude,
  includes: rule.include ?? [] })` to produce that agent's own view of the diff, instead of relying
  solely on `evaluatePolicy`'s existing whole-agent skip-if-all-match decision. The existing
  skip-if-all-match behavior is unchanged and still runs first (an agent that would see an empty
  diff after filtering is skipped entirely, saving the call rather than sending nothing).
- `DEFAULT_CONFIG.agentPolicy` gains default excludes of `**/*.md` for `security` and
  `adversarial` specifically — scoped to only the two agents actually demonstrated to have this
  failure mode. This is a deliberately narrow default, not a claim that other agents are immune:
  read `licenseCompliance.ts`/`breakingChange.ts` in full while writing this spec — neither
  prompt mentions `.md`/README/LICENSE at all (`licenseCompliance.ts` is scoped to `package.json`
  dependency licenses; `breakingChange.ts` to exported signatures) — so there was no evidence
  either way for those two, and the minimal, verified fix is to exclude only where the bug was
  actually reproduced.
- **New top-level `ReviewResult.filteredFiles?: Partial<Record<AgentName, string[]>>` field**
  (not nested inside `PolicyResult`), with its own conditional spread in `runner.ts`, matching the
  independent-top-level-field convention already used by `hallucinationFilter`/`coverageGapFilter`/
  `evidenceCheckFilter`. This must be a sibling of `PolicyResult`, not a field on it:
  `runner.ts:739` only spreads `policy` into the result when `policyResult.agentsSkipped.length >
  0`, but the target scenario for this field is exactly the case where an agent is *not* skipped
  (still runs) and just has some file sections dropped from what it sees — nesting inside
  `PolicyResult` would mean this field silently never appears in the one case it exists to cover.
- **Known limitation, accepted rather than fixed here:** `config.ts`'s `loadConfig` does a shallow
  merge (`{ ...DEFAULT_CONFIG, ...partial }`). Once `DEFAULT_CONFIG.agentPolicy` is non-empty (this
  spec is what first populates it), a project's own `ai-review.config.json` setting *any*
  `agentPolicy` key for *any* agent will replace the entire `agentPolicy` object, silently
  dropping the new security/adversarial `.md` defaults with no warning. This is a pre-existing
  property of shallow-merging the whole config object, not something new introduced by this spec —
  every other object/array-valued config field has the same characteristic today. Fixing config
  merge semantics generally is out of scope here (a much larger, unrelated change); this spec
  documents the interaction explicitly (README note: "if you set your own `agentPolicy`, re-specify
  the security/adversarial `.md` excludes if you want to keep them") rather than silently letting
  users discover it.

**Non-Goal within this issue:** a `.md` file containing a real, shipped, executable script (e.g. a
fenced install script in a README that's genuinely run) could still be under-reviewed by
security/adversarial. This is an accepted trade-off, not silently overlooked — the default only
applies to two agents, is fully overridable per-project, and the demonstrated failure mode (process
documentation misread as code) is common; a `.md` file containing genuinely executed code is rare
enough that a deterministic default optimized for the common case is the right call per the
Non-Goals section above (avoiding prompt-only fixes this project has evidence don't work
reliably).

**Efficiency note:** this reduces tokens sent to the affected agents (fewer file sections in their
prompt), not just quality — another net win under the stated constraint.

### Issue 4: Dependencies agent assumes Node.js

**Approach:** minimal manifest-existence gate, no new ecosystem support (see Non-Goals).

- `dependencies.ts`'s `run()` gains a new pre-check, guarded specifically to `!touchesManifest`:
  if the diff doesn't touch `package.json`/`package-lock.json` AND `input.projectPath` has no
  root-level `package.json` on disk (plain `existsSync(join(projectPath, 'package.json'))` — root
  only, not a recursive/monorepo-aware walk; a project with only a workspace-nested `package.json`
  and none at root is a known, accepted gap, not silently mishandled), skip the LLM call entirely
  and return `[]`. **This check must not fire when `touchesManifest` is true** — a diff that adds
  `package.json` for the first time (a genuine new Node project) has `touchesManifest: true` but
  `existsSync` may still be `false` if the diff hasn't been applied to disk (e.g. `--diff
  <patch-file>` review of an unapplied patch); the existing `touchesManifest` branch already
  handles that case correctly today (tries npm audit, falls back to LLM with
  `'unavailable-llm-fallback'` if the tool can't run) and must be left untouched. The new check
  only ever affects the case the bug report actually demonstrated: a diff that doesn't mention any
  manifest, in a project that never had one.
- `lastToolAvailability` gains a distinct value for this path (`'not-applicable'`, alongside the
  existing `'used'`/`'unavailable-llm-fallback'`) so formatters can report "not an npm project"
  distinctly from "npm audit unavailable, fell back to LLM."
- `cli/formatter.ts`'s `degradedTools` logic (keyed on `=== 'unavailable-llm-fallback'`) is updated
  so `'not-applicable'` is explicitly excluded from the degraded-tools warning — it's an expected,
  correct outcome, not a degradation, and should produce no warning at all rather than being
  miscategorized as one. `sarif.ts`/`githubAnnotations.ts` need the same exclusion wherever they
  read `toolAvailability` for warnings. Without this, the new enum value is either invisible (if a
  formatter only checks for the old two values) or wrongly flagged as a problem.
- No prompt changes needed — the existing prompt is fine for actual Node projects; the fix is not
  calling it at all when there's nothing for it to be right about.

**Efficiency note:** this removes an LLM call entirely for every non-Node project — a strict win on
both cost and quality, no trade-off.

## Schema/Config Changes Summary

- `exitCode.ts`: new `TRUNCATION_EXIT_CODE = 3`.
- `cli/index.ts`: new `--allow-truncation`, `--chunk` flags; exit-code priority updated to
  agent-failure(2) > blocker-severity(1) > truncation(3) > clean(0).
- `provider.ts`: `ChatOptions` gains `numPredict?: number`.
- `ollamaProvider.ts`: request body includes `num_predict` when set.
- `config.ts`: new `ReviewConfig.responseTokenBudget?: number`; `DEFAULT_CONFIG.agentPolicy` gains
  `security`/`adversarial` `.md` excludes.
- `schema.ts`: new **top-level** `ReviewResult.filteredFiles?: Partial<Record<AgentName,
  string[]>>` (sibling of `PolicyResult`, not nested inside it); `ToolAvailability` gains
  `'not-applicable'`.
- `dependencies.ts`: `run()` gains a manifest-existence pre-check, guarded to `!touchesManifest`
  only.
- `runner.ts`: per-agent `filterDiff()` call site added, threaded from `agentPolicy`, populating
  the new `filteredFiles` field; `--chunk` handling in `preprocessDiff()`.
- `base.ts`, `coverageAnalyst.ts`: pass `numPredict` (from `responseTokenBudget`) into their
  `provider.chat()` calls. `testGen.ts`/`evidenceVerifier.ts` are explicitly unchanged.
- `cli/formatter.ts`, `cli/formatters/sarif.ts`, `cli/formatters/githubAnnotations.ts`: exclude
  `'not-applicable'` from degraded-tools warnings.
- `README.md`: documents the `agentPolicy` shallow-merge interaction with the new
  security/adversarial defaults.

## Testing/Validation Plan

- Issue 1: unit tests for the new exit-code priority ordering — specifically a case with both a
  truncated diff AND a real blocker finding in the reviewed portion, asserting exit code 1 (not 3)
  — plus `--allow-truncation` opt-out, and `--chunk` producing complete, deduplicated findings
  across a synthetic oversized diff (verify via the existing accumulator/synthesize path, not a
  new merge function) with `truncationMeta.truncated === false` on full-coverage chunked runs.
- Issue 2: the diagnostic script is run against live Ollama first (not mocked) to determine which
  branch of the fix applies; once chosen, a regression test with a mocked provider confirms
  `num_predict` is sent in `base.ts`/`coverageAnalyst.ts`'s request bodies specifically, and
  confirms `testGen.ts`/`evidenceVerifier.ts` requests are unchanged.
- Issue 3: regression test confirming a mixed diff (one `.md` file + one `.ts` file) sent to
  `security`/`adversarial` no longer includes the `.md` file's diff section, while the `.ts`
  section is untouched, the agent still runs (not skipped), and `ReviewResult.filteredFiles` (the
  new top-level field) reflects the drop. A second test confirms an all-`.md` diff still triggers
  the existing whole-agent skip via `agentsSkipped`, with `filteredFiles` absent for that agent
  (nothing to report — it never ran). A third test confirms a user's own `agentPolicy` override for
  an unrelated agent doesn't silently need to preserve the security/adversarial defaults (i.e.
  documents/exercises the shallow-merge interaction rather than leaving it undiscovered).
- Issue 4: regression tests confirming (a) `DependenciesAgent.run()` returns `[]` without calling
  `provider.chat()` when no `package.json` exists anywhere and the diff doesn't touch one; (b) a
  diff that *adds* `package.json` for the first time (`touchesManifest: true`, file not yet on
  disk) still reaches the existing npm-audit-then-LLM-fallback path unaffected — the new check must
  not fire here; (c) existing behavior for actual Node projects is unchanged. `cli/formatter.ts`
  gains a test confirming `'not-applicable'` produces no degraded-tools warning.
- Full regression pass (`npm test`) plus a live run against a real non-Node project diff, mirroring
  the original bug report, to confirm all four symptoms are actually gone end-to-end — not just
  covered by unit tests in isolation.

## Open Questions

- Issue 2's exact `num_predict` value (or whether the fix ends up being about `format: 'json'`
  instead) is genuinely undetermined until the diagnostic script runs against live Ollama — this
  is intentional, not an oversight.
