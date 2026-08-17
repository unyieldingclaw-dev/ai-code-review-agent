# Review Reliability Fixes — Design Spec

**Status:** Draft
**Date:** 2026-08-16

## Problem

A live run (`ai-review-agent --profile security --diff <patch>` against a real Flutter/Dart
project) surfaced four independent, reproducible reliability gaps, each verified directly against
this codebase's source (not assumed from the report):

1. **Silent diff truncation.** `runner.ts:253-270` keeps only the first `maxDiffLines` (default 2000) lines of an oversized diff and drops the rest, with a single stderr line plus one
   markdown-report line as the only signal. On the reproducing run, 2989 of 4989 lines (60%) were
   never analyzed. Exit code is unaffected by truncation — confirmed in `exitCode.ts`/`cli/index.ts`,
   whose only exit-code inputs are agent failures (code 2) and finding severity (code 1). A caller
   gating CI on exit code alone gets a "clean" result on a review that silently skipped most of the
   diff. (Citation note: the "different kind of incomplete than an agent that outright failed"
   reasoning for this being a deliberate prior decision is in `activeContext.md`'s 2026-07-18 entry,
   not `progress.md`'s — both files corroborate the same decision, but the exact wording lives in
   `activeContext.md`.)

2. **Response parsing issues on every agent, every run.** All four agents in the reproducing run
   (security, secrets, dependencies, adversarial) hit `base.ts`'s Stage 4 recovery ("response
   appears truncated -- recovered 1 complete finding(s) before the cutoff") — the reported symptom.
   Initial hypothesis (missing `num_predict`) was investigated live against real Ollama and ruled
   out — see Design, Issue 2 below for the full investigation and the actual confirmed root cause
   (a `format: 'json'` object-vs-array shape mismatch, not a length cap), plus a second, separate,
   out-of-scope finding (model under-reporting) that surfaced during that investigation.

3. **Prose-vs-code confusion on documentation files.** `security.ts`/`adversarial.ts` prompts have
   no file-type awareness at all (confirmed by reading both in full) — nothing distinguishes a
   `.md` file's prose description of a vulnerability pattern from an actual vulnerable code path.
   The reproducing run's two highest-confidence findings (95%, 90%) were both the security/
   adversarial agents misreading `.claude/commands/*.md` — process documentation — as executable
   code, with one finding's own quoted "evidence" directly contradicting its claim.

4. **Dependencies agent assumes a Node.js project unconditionally.** `dependencies.ts`'s `run()`
   only gates the _deterministic_ `npm audit` path on whether `package.json`/`package-lock.json`
   changed in the diff; when that's false it falls through unconditionally to the LLM fallback
   (`super.run()`), whose prompt is entirely npm-shaped. There is no project-type detection
   anywhere in the agent. On a Dart project with no `package.json` anywhere in the repo, this
   produced a "Missing package.json changes" finding against a project that has never had one.

## Goals

- Fix all four without adding cost to the common case — several of these fixes should _reduce_
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
- Fixing model under-reporting (finding only 1 of several real issues in a diff). Discovered
  during Issue 2's live investigation, confirmed real and reproducible, but distinct from what
  Issue 2 originally scoped (truncation) and not fixable by any `ChatOptions`/config change — see
  Issue 2's Non-Goal paragraph below for detail. Documented, not solved, here.

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
  deliberately outranks truncation: a run that's both truncated _and_ found a genuine Critical
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

**Status: root cause investigated live against real Ollama; the original hypothesis (missing
`num_predict`) was empirically ruled out, and a different, verified, fixable root cause was found
instead.** This section documents the investigation because the conclusion doesn't match the
Problem statement's original framing — worth being explicit about what changed and why, per this
project's own standard of not asserting rationale that isn't backed by observed behavior.

**What was measured (calibration/responseTruncationDiagnostic.ts, run live against
`devstral:latest`):**

1. Across `security`/`secrets`/`dependencies`/`adversarial`'s real system prompts, at diff sizes
   from 2000 (matching `DEFAULT_CONFIG.maxDiffLines` — what agents actually receive in production)
   up to 6777 lines, `done_reason` was `stop` in every single run. Never `length`. The originally
   hypothesized cause (a token-length cap cutting generation short) does not occur at any tested
   size.
2. What actually happens: under `format: 'json'` (the bare string, current production behavior),
   the model reliably emits a single JSON object — not the required top-level array — then stops
   cleanly. `dependencies` returned `{"package.json":[],"requirements.txt":[]}` (no `severity`
   field at all — would throw `ParseFailureError` today, not "truncated"); `security`/`secrets`/
   `adversarial` returned a single bare finding-shaped object (has `severity`) — which
   `BaseAgent.parseFindings`'s existing Stage 2b already catches and auto-wraps correctly today,
   logging an accurate message, not "appears truncated."
3. **Confirmed root cause of the object-vs-array mismatch:** `format: 'json'` (bare string) only
   constrains "valid JSON," not array-of-N-objects. Tested directly: a diff with 3 real, unrelated,
   injected vulnerabilities (SQL injection, XSS, hardcoded credentials) sent with `format: 'json'`
   returned a bare non-array object; the identical request sent with an explicit JSON Schema
   (`format: { type: 'array', items: {...} }` — Ollama's `format` field accepts either the string
   `"json"` or a full JSON Schema object) correctly returned `array of 1`. The schema constraint
   works.
4. **A second, separate, unfixable-by-this-mechanism problem was also found:** even with the array
   schema forcing correct shape, the model still reported only 1 of 6 unambiguous, independently
   injected vulnerabilities in the same test diff (SQL injection, hardcoded API key, XSS via
   innerHTML, hardcoded password, an auth-bypass debug flag, and weak MD5 hashing — the model
   found and reported only the SQL injection, both schema-mode runs). This is not a truncation or
   format problem — the model is choosing to stop after one finding regardless of format
   constraints. No `ChatOptions` field fixes this; it would need prompt-engineering or
   generation-parameter (temperature/repeat-penalty) work, which is out of scope for this plan
   (see Non-Goals) and is tracked as a separate, deferred, documented finding rather than folded in
   here.

**Approach (revised):** add an explicit JSON Schema `format` for the array-shaped agents
(`base.ts`), fixing the verified object-vs-array mismatch — a real, cheap, narrowly-scoped fix for
a confirmed bug. Do not attempt to fix the under-reporting problem in this plan; it's a distinct
finding, documented as a Non-Goal below.

- `ChatOptions.format` (`provider.ts`) widens from `'json'` to `'json' | Record<string, unknown>`
  — Ollama's own API already accepts either; this is additive, not a breaking change to the type.
- `OllamaProvider.chat()`'s request body passes `format` through unchanged (it's already spread
  conditionally) — no new logic needed there, since the object-vs-string distinction is opaque to
  the provider; it just forwards whatever `ChatOptions.format` contains.
- A new shared constant, `FINDING_ARRAY_SCHEMA`, defined once (in `base.ts`, the shared consumer),
  describing `{ type: 'array', items: { type: 'object', properties: {...}, required: [...] } }`
  with `required` matching exactly what `parsing.ts`'s `validateAndNormalizeFindings` actually
  requires today (`severity`, `file`, `line`, `title`, `detail`, `evidence`, `recommendation` — the
  canonical field names every current agent prompt already emits, not the legacy
  `basis`/`suggestion` alternates `validateAndNormalizeFindings` also accepts). `base.ts:38`'s
  `provider.chat()` call passes `format: FINDING_ARRAY_SCHEMA` instead of `format: 'json'`.
- `coverageAnalyst.ts` needs its own, differently-shaped schema (`{ type: 'object', properties: {
findings: {...}, gaps: {...} } }`, matching its `{"findings":[...],"gaps":[...]}` top-level
  shape, which is not an array) — a second constant, not a reuse of `FINDING_ARRAY_SCHEMA`.
- `testGen.ts`/`evidenceVerifier.ts` are unchanged, same reasoning as before (raw code output /
  single short verdict line, neither is array-shaped JSON).
- No new `ReviewConfig` field is needed — unlike the original `responseTokenBudget` idea, a JSON
  Schema constraint isn't a tunable numeric knob a caller would ever want to override per-run.

**Non-Goal (new, from this investigation): model under-reporting multiple real findings.**
Documented above as a real, verified, but distinct problem from what Issue 2 originally scoped.
Not fixed here. Worth a separately-scoped future investigation into prompt phrasing (e.g.
explicitly instructing "list every issue you find, not just the most severe one") or generation
parameters — but guessing at either without its own dedicated measurement would be exactly the
kind of unverified fix this plan has been trying to avoid throughout.

**Efficiency note:** the schema fix is a pure win under the stated efficiency constraint — it
doesn't change token cost at all (same request shape, same model, same `format` field just
carrying more information), it just makes the model's output conform to the shape every agent
already asks for in its own prompt text, reducing reliance on `BaseAgent`'s Stage 2b/3/4 recovery
paths having to compensate for a preventable shape mismatch.

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
0`, but the target scenario for this field is exactly the case where an agent is _not_ skipped
  (still runs) and just has some file sections dropped from what it sees — nesting inside
  `PolicyResult` would mean this field silently never appears in the one case it exists to cover.
- **Known limitation, accepted rather than fixed here:** `config.ts`'s `loadConfig` does a shallow
  merge (`{ ...DEFAULT_CONFIG, ...partial }`). Once `DEFAULT_CONFIG.agentPolicy` is non-empty (this
  spec is what first populates it), a project's own `ai-review.config.json` setting _any_
  `agentPolicy` key for _any_ agent will replace the entire `agentPolicy` object, silently
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
- `provider.ts`: `ChatOptions.format` widens from `'json'` to `'json' | Record<string, unknown>`.
- `ollamaProvider.ts`: no logic change — `format` is already forwarded opaquely.
- `base.ts`: new `FINDING_ARRAY_SCHEMA` constant; `format: FINDING_ARRAY_SCHEMA` replaces
  `format: 'json'` in its `provider.chat()` call.
- `coverageAnalyst.ts`: new, differently-shaped schema constant for its `{findings, gaps}` object
  shape; replaces `format: 'json'` in its own `provider.chat()` call.
- `config.ts`: `DEFAULT_CONFIG.agentPolicy` gains `security`/`adversarial` `.md` excludes. (No new
  config field for Issue 2 — the schema fix isn't a tunable value.)
- `schema.ts`: new **top-level** `ReviewResult.filteredFiles?: Partial<Record<AgentName,
string[]>>` (sibling of `PolicyResult`, not nested inside it); `ToolAvailability` gains
  `'not-applicable'`.
- `dependencies.ts`: `run()` gains a manifest-existence pre-check, guarded to `!touchesManifest`
  only.
- `runner.ts`: per-agent `filterDiff()` call site added, threaded from `agentPolicy`, populating
  the new `filteredFiles` field; `--chunk` handling in `preprocessDiff()`.
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
- Issue 2: the diagnostic script (run live against Ollama, already complete — see the Approach
  section above for the actual measurements and confirmed root cause) informed the fix; a
  regression test with a mocked provider confirms `format: FINDING_ARRAY_SCHEMA` (not the string
  `'json'`) is sent in `base.ts`'s request body, `coverageAnalyst.ts` sends its own distinct
  object-shaped schema, and `testGen.ts`/`evidenceVerifier.ts` requests are unchanged. A live
  sanity check (real Ollama, a diff with 2+ known findings) confirms the array shape is now
  correct — not that under-reporting is fixed, since that's an explicitly out-of-scope, separate
  finding (see Non-Goals in the Issue 2 section above).
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
  diff that _adds_ `package.json` for the first time (`touchesManifest: true`, file not yet on
  disk) still reaches the existing npm-audit-then-LLM-fallback path unaffected — the new check must
  not fire here; (c) existing behavior for actual Node projects is unchanged. `cli/formatter.ts`
  gains a test confirming `'not-applicable'` produces no degraded-tools warning.
- Full regression pass (`npm test`) plus a live run against a real non-Node project diff, mirroring
  the original bug report, to confirm all four symptoms are actually gone end-to-end — not just
  covered by unit tests in isolation.

## Open Questions

- None remaining for the scope of this spec. Issue 2's original open question (what the live
  measurement would show) is resolved — see the Approach section above. The model under-reporting
  finding that surfaced during that investigation is a new, separate, deliberately out-of-scope
  item (Issue 2's Non-Goal paragraph), not an open question for this plan to resolve.
