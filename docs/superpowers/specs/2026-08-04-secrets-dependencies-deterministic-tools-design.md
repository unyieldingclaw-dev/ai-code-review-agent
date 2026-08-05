# Secrets/Dependencies Deterministic-Tool Integration + Hallucination Guardrails — Design Spec

**Date:** 2026-08-04
**Status:** Approved

## Problem

Follow-up to the dependencies-agent hallucination fix (PR #17, 2026-08-04) — a user report showed
`secrets` and `adversarial` hallucinating fabricated findings against a real diff
(`review-reminders.sh`/`.ps1`, PMB repo), not occasionally but on every run. Live reproduction
(patched `main`, not the unpublished npm binary) confirmed this directly: 9/9 runs across
`secrets`/`adversarial`/`dependencies` against genuinely benign content produced a confidently
wrong (`VERIFIED`, 90-95% confidence) finding. Examples:

- `secrets`: flagged `marker="$root/.claude/.change-review-ok"` (a real line) as a "Database
  Connection String Pattern... AWS_SESSION_TOKEN" — the quoted evidence doesn't even contain what
  it claims. A separate clean-shape run flagged `git diff HEAD | sha256sum` as a "hardcoded API
  key."
- `adversarial`: flagged `[ -z "$input" ] && exit 0` (real line) as "an attacker could bypass the
  review process" — mischaracterizing a local git hook reading Claude Code's own tool-call JSON as
  if it had an external, attacker-controlled network boundary.
- `dependencies`: even with PR #17's fix active, invented a "command injection vulnerability"
  finding under the wrong domain when it had nothing real to report.

In every case the **evidence quotes were genuine** (verbatim substrings of the real file) — the
hallucination is entirely in classification, not fabrication from nothing. This means an
evidence-must-exist-in-diff check (the kind of defense PR #17 added) would not catch it.

**Two independent, compounding root causes**, both confirmed by direct reproduction:

1. **Parsing/diagnostics bug (not itself a hallucination source).** `secrets`/`adversarial`
   frequently return a single bare `{...}` object instead of the array the prompt requires. None
   of `parseFindings`'s first 3 stages handle "unwrapped single object," so it falls through to
   Stage 4 (`extractCompleteObjects`), built for genuine truncation recovery — it finds the one
   complete object and logs `"response appears truncated -- recovered 1 complete finding(s)"`.
   That log line is false in these cases: captured raw responses were complete, syntactically
   valid, non-truncated single objects. This produced the "every hallucination comes with a
   truncation warning" pattern originally reported — truncation wasn't actually happening.
2. **Content/reasoning hallucination — the real problem, independent of Bug 1.** 7/7
   `secrets`/`adversarial` reproduction runs fabricated a finding on the *first* attempt, several
   with the fully correct `{"findings": [...]}` shape (no parsing ambiguity, no truncation, Stage 2
   accepts cleanly) — proving the fabrication doesn't depend on Bug 1's shape mismatch. The
   evidence-must-exist defense from PR #17 doesn't apply either, since the cited evidence is real.

## Goals

1. Eliminate the hallucination class for `secrets` and `dependencies` specifically, by replacing
   LLM judgment with real deterministic tools (gitleaks, `npm audit`) for the parts of those
   domains that are actually pattern-matchable rather than judgment calls — verified directly
   against the real tools (gitleaks 8.30.1 installed and tested this session; `npm audit` already
   available via the existing `npm` install) rather than assumed from memory.
2. Reduce (not eliminate — this is judgment work, not pattern-matching) the hallucination severity
   for `adversarial`, whose findings can't be replaced by a deterministic tool.
3. Fix the Stage 4 mislabeling so the "response appears truncated" diagnostic is trustworthy again
   (only fires for genuine truncation).
4. No new silent-stderr-only gap: when a tool-integrated agent falls back to LLM-only because the
   tool isn't installed, that degraded state must be visible in `ReviewResult`, not just logged —
   matching the fix already applied once for dropped hallucinated findings.

## Non-Goals

- Replacing `correctness`/`design`/other judgment-heavy agents with tools or applying the
  `adversarial` corroboration-downgrade guardrail to them — no reproduced evidence they have this
  problem; scope is bounded to what was actually observed.
- `trufflehog` or `osv-scanner` integration — `gitleaks` and `npm audit` cover the two domains in
  scope; adding more scanners is a separate decision if gitleaks/npm-audit prove insufficient.
- Diff-scoped `npm audit` filtering (cross-referencing audit output against only the packages this
  specific diff added/changed) — `package-lock.json` diffs are large, deeply nested, and vary by
  lockfile format version; reliably parsing "which packages did this diff touch" is its own
  fragile-parsing problem, ironic given this spec's purpose. Full-tree audit (gated on the diff
  touching `package.json`/`package-lock.json`) matches how `npm audit` is used in practice (CI
  audit gates run against the whole tree, not diff-scoped).
- Auto-installing gitleaks/npm for the end user, or failing the review when a tool is missing —
  graceful LLM-only fallback with a visible degraded flag, consistent with `lizard`'s existing
  optional-tool pattern in `complexity.ts`.

## Design

### A. `SecretsAgent` — gitleaks replaces LLM judgment when available

`run()` gains a pre-check before building the LLM prompt: for each file in
`extractChangedFiles(diff)` that exists on disk (skip deleted/inaccessible files), call
`runTool('gitleaks', ['detect', '--no-git', '--source', file, '-f', 'json', '-r', '-',
'--exit-code', '0', '--no-banner'])`. `runTool` already returns `null` on `ENOENT` (verified
against `lizard`'s existing usage), so tool-not-installed is already handled by existing
infrastructure.

Verified directly this session (gitleaks 8.30.1, real invocations, not assumed):

- `--source <file>` scanning a real on-disk file gives accurate `StartLine`/`File` matching the
  actual file content — critical, since `--pipe` mode (scanning raw diff text) reports line
  numbers relative to the piped text stream, not the real file, which would have introduced a
  *new* confidently-wrong-line-number bug. `--source` is required, not `--pipe`.
- Ran against the exact content that fooled the LLM 3/3 times: `[]`, correctly.
  Ran against a realistic Stripe key: correctly detected with accurate `StartLine`, `RuleID:
  "stripe-access-token"`, `Secret`, `Entropy`.
  AWS's own documentation placeholder key was correctly *not* flagged (gitleaks' default
  allowlist) — better calibrated than the current LLM prompt's "not example/placeholder values"
  instruction, which didn't stop the LLM from inventing false positives on real content.

If gitleaks output is non-empty: map each leak to `Finding` (`source: 'gitleaks'`,
`basis: 'VERIFIED'`, `file`/`line` from gitleaks directly, `evidence` from `Match`,
`title`/`detail` from `RuleID`/`Description`). Gitleaks' own JSON output has no `severity` field
(confirmed against real output this session — `RuleID`, `Description`, `StartLine`, `Match`,
`Secret`, `Entropy`, `Tags`, `Fingerprint`, no severity), so this is a flat default of `high` for
every leak, not a per-rule mapping — building and maintaining a severity table across gitleaks'
~150 rules is unnecessary complexity for now; a flat default is fine since gitleaks only reports
things it's confident are real secrets in the first place. Per-rule severity tuning (e.g.
`Critical` for private-key/certificate rule categories) is a reasonable future refinement, not
required for this pass. Return these findings, **skip the LLM call entirely** for this diff.

Files are resolved relative to the process's current working directory, matching `lizard`'s
existing behavior in `complexity.ts` (both assume the tool is invoked from the repo root, the
standard `ai-review-agent` usage pattern) — not a new assumption introduced here.

If gitleaks is unavailable (`runTool` returns `null` for every file — i.e. gitleaks isn't
installed, not just "no leaks in this diff"): fall back to the existing LLM-only path unchanged,
and record degraded status (Section D).

New `src/core/tools/gitleaksParser.ts` holds the mapping logic, unit-testable against captured
real JSON fixtures (already captured this session) without gitleaks installed in CI.

### B. `DependenciesAgent` — `npm audit` replaces LLM judgment when triggered

`run()` gains a pre-check: if `extractChangedFiles(diff)` includes `package.json` or
`package-lock.json` and `input.projectPath` is available, run `npm audit --json` from that path
via `runTool`. Parse entries with severity ≥ `moderate` (mirrors every other agent's existing
"only report severity >= medium" convention) into `Finding` (`source: 'npm-audit'`,
`basis: 'VERIFIED'`). Skip the LLM call for this diff.

If the diff doesn't touch a manifest file, or `npm audit` isn't available/fails, or
`projectPath` isn't provided (e.g. reviewing a standalone `.diff` file with no real checkout): fall
back to the existing LLM-only path, degraded status recorded only when a manifest file was touched
but the tool couldn't run.

New `src/core/tools/npmAuditParser.ts`, same fixture-based unit-testing approach as gitleaksParser.

### C. Stage 4 mislabeling fix (`base.ts` `parseFindings`)

New stage inserted between the existing Stage 2 (`.findings` array) and Stage 3 (balanced-bracket
extraction): if `JSON.parse` succeeded, `parsed` is a non-array object, it doesn't have a
`.findings` array, but it *is* itself finding-shaped (has `severity` as its own top-level
property), treat it as `[parsed]` and validate normally through the existing
`validateFindings`. Log distinctly:
`[${name}] response was a single object, not the required array — auto-wrapped. Raw snippet: ...`
— not the truncation message. This doesn't change any accept/reject outcome (the object goes
through the identical schema check either way); it stops a false diagnostic and means Stage 4's
"response appears truncated" log becomes trustworthy again, firing only for genuine truncation.

### D. `adversarial`-scoped corroboration downgrade

`OrchestratorAgent.hallucinationCrossCheck` currently downgrades a solo Critical finding (no
second agent corroborating the same file/region) to High when confidence <60%. Add: a solo **High**
finding specifically from `adversarial`, uncorroborated by a second agent on the same file/region,
downgrades to Medium — regardless of confidence, deliberately *not* gated the same way as the
Critical rule. The reproduced `adversarial` hallucinations were themselves reported at 90-95%
confidence — gating this downgrade on confidence <60% the same way the Critical rule does would
not have caught a single one of them. Scoped to `adversarial` only; not applied to other
judgment-heavy agents (`correctness`, `design`, etc.) since no reproduced evidence shows they have
this problem, and applying it speculatively risks suppressing real findings from agents that
haven't shown it.

### E. Degraded-mode visibility

New schema types:

```typescript
export type ToolAvailability = 'used' | 'unavailable-llm-fallback'

export interface ToolAvailabilityMetadata {
  gitleaks?: ToolAvailability
  npmAudit?: ToolAvailability
}
```

`ReviewResult.toolAvailability?: ToolAvailabilityMetadata`. `runner.ts` collects this from
`SecretsAgent`/`DependenciesAgent` (each exposes what it actually did, similar to how `agentStatus`
is already collected per-agent) and surfaces it via the same conditional-spread pattern as
`hallucinationFilter`/`truncation`/`policy`. Markdown formatter gets a note near the existing
agent-failure-warning block (not buried in the bottom footer, matching the precedent already set
for `hallucinationFilter`); SARIF gets it in run-level `properties` alongside the sibling metadata
fields.

## Testing

- `tests/unit/tools/gitleaksParser.test.ts` / `npmAuditParser.test.ts`: parse captured real JSON
  (clean-diff case, leak-detected case) into `Finding[]`, verify field mapping.
- `tests/unit/agents/secrets.test.ts` / extended `dependencies.test.ts`: mock `runTool` to return
  captured JSON — assert `provider.chat` (the LLM) is **never called** on the tool-available path;
  mock `runTool` returning `null` — assert the existing LLM path still runs and degraded status is
  recorded.
- `tests/unit/baseAgent.test.ts`: new stage correctly wraps a bare single object, with the
  corrected (non-"truncated") log message; existing Stage 4 truncation tests unaffected.
- `tests/unit/orchestrator.test.ts`: solo-High `adversarial` downgrade (uncorroborated → Medium;
  corroborated → stays High); confirm this does NOT apply to a solo High from `correctness` or
  other agents (regression guard against accidental scope creep).
- `tests/unit/runner.test.ts` + `tests/unit/formatters/markdown.test.ts` /
  `tests/unit/formatters/sarif.test.ts`: `ReviewResult.toolAvailability` surfaces end-to-end,
  same conditional-spread pattern as sibling metadata.
- Calibration: one new live case each for `secrets` (gitleaks installed — assert findings carry
  `source: 'gitleaks'`, not `'heuristic'`/`'llm'`, confirming the LLM path was actually skipped)
  and `dependencies` (npm-audit triggered). No new live case needed for the LLM-fallback path —
  it's the existing, already-calibrated agent behavior, covered by the mocked unit tests above.
- Full suite re-run at the end against the existing baseline (393 tests at time of writing) plus
  the new tests added here.
