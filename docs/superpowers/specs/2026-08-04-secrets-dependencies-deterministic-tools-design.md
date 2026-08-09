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

**A third finding, from verifying this spec's own Section D before writing the implementation
plan:** the existing `hallucinationCrossCheck` already downgrades any uncorroborated solo High
finding (non-deterministic source) to Medium — confirmed by feeding the captured raw hallucinated
responses through the real `parseFindings`/`orchestrator.synthesize()` pipeline directly (no new
LLM calls). But this safety net is unreliable in realistic multi-agent reviews: its corroboration
check (`file === file && |line diff| <= 5`, no requirement that the two findings are actually
about the same issue) is fooled by a completely unrelated finding from a different agent landing
nearby — verified directly: an unrelated `correctness` finding 3 lines away let a fabricated
`secrets` finding survive at full `high` severity, undowngraded. Tightening this to an exact-line
match isn't a clean fix either — an existing test
(`orchestrator.test.ts`: "keeps critical finding when a second agent flags the same file+line
region") deliberately relies on the ±5 window for legitimate cross-domain corroboration. This is
addressed as a documented, deliberately-deferred limitation rather than fixed in this pass — see
Non-Goals.

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
   `secrets`/`adversarial` reproduction runs fabricated a finding on the _first_ attempt, several
   with the fully correct `{"findings": [...]}` shape (no parsing ambiguity, no truncation, Stage 2
   accepts cleanly) — proving the fabrication doesn't depend on Bug 1's shape mismatch. The
   evidence-must-exist defense from PR #17 doesn't apply either, since the cited evidence is real.

## Goals

1. Eliminate the hallucination class for `secrets` and `dependencies` specifically, by replacing
   LLM judgment with real deterministic tools (gitleaks, `npm audit`) for the parts of those
   domains that are actually pattern-matchable rather than judgment calls — verified directly
   against the real tools (gitleaks 8.30.1 installed and tested this session; `npm audit` already
   available via the existing `npm` install) rather than assumed from memory.
2. Reduce (not eliminate — this is judgment work, not pattern-matching, and prompt-tightening alone
   didn't fully solve this same class of problem for `dependencies` in PR #17) the hallucination
   _rate_ for `adversarial`, whose findings can't be replaced by a deterministic tool.
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
- Fixing `hallucinationCrossCheck`'s corroboration-matching precision (the ±5-line,
  no-topical-overlap-required window documented above). A naive fix (exact-line match) breaks an
  existing, deliberately-tested legitimate behavior (cross-domain corroboration within a "file+line
  region"); a robust fix needs the two findings' content to actually be compared, which is a
  meaningfully different, content-aware design problem deserving its own spec, not a quick patch
  folded into this one. Mitigated indirectly in this spec by moving `secrets`/`dependencies` onto
  deterministic sources (which are exempt from this downgrade path entirely via
  `DETERMINISTIC_SOURCES`) rather than depending on the downgrade heuristic to protect them.

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
  _new_ confidently-wrong-line-number bug. `--source` is required, not `--pipe`.
- Ran against the exact content that fooled the LLM 3/3 times: `[]`, correctly.
  Ran against a realistic Stripe key: correctly detected with accurate `StartLine`, `RuleID:
"stripe-access-token"`, `Secret`, `Entropy`.
  AWS's own documentation placeholder key was correctly _not_ flagged (gitleaks' default
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
installed, not just "no leaks in this diff"): fall back to the existing (now prompt-tightened,
Section D) LLM-only path, and record degraded status (Section E).

New `src/core/gitleaksParser.ts` holds the mapping logic (flat under `src/core/`, matching the
existing convention of `parsing.ts`/`policyFilter.ts`/`sanitizer.ts` — no `tools/` subdirectory
exists or is warranted for two files), unit-testable against captured real JSON fixtures (already
captured this session) without gitleaks installed in CI.

### B. `DependenciesAgent` — `npm audit` replaces LLM judgment when triggered

`run()` gains a pre-check: if `extractChangedFiles(diff)` includes `package.json` or
`package-lock.json` and `input.projectPath` is available, run `npm audit --json` from that path
via `runTool`. `npm audit`'s own severity vocabulary (`info`/`low`/`moderate`/`high`/`critical`)
doesn't match `Finding.severity`'s (`low`/`medium`/`high`/`critical`) — map `moderate → medium`,
`high → high`, `critical → critical`, and drop `info`/`low` (mirrors every other agent's existing
"only report severity >= medium" convention: `npm audit`'s `moderate` is the equivalent floor).
Parsed entries become `Finding` (`source: 'npm-audit'`, `basis: 'VERIFIED'`). Skip the LLM call for
this diff.

If the diff doesn't touch a manifest file, or `npm audit` isn't available/fails, or
`projectPath` isn't provided (e.g. reviewing a standalone `.diff` file with no real checkout): fall
back to the existing LLM-only path, degraded status recorded only when a manifest file was touched
but the tool couldn't run.

New `src/core/npmAuditParser.ts` (same flat placement), same fixture-based unit-testing approach as
`gitleaksParser.ts`.

### C. Stage 4 mislabeling fix (`base.ts` `parseFindings`)

New stage inserted between the existing Stage 2 (`.findings` array) and Stage 3 (balanced-bracket
extraction): if `JSON.parse` succeeded, `parsed` is a non-array object, it doesn't have a
`.findings` array, but it _is_ itself finding-shaped (has `severity` as its own top-level
property), treat it as `[parsed]` and validate normally through the existing
`validateFindings`. Log distinctly:
`[${name}] response was a single object, not the required array — auto-wrapped. Raw snippet: ...`
— not the truncation message. This doesn't change any accept/reject outcome (the object goes
through the identical schema check either way); it stops a false diagnostic and means Stage 4's
"response appears truncated" log becomes trustworthy again, firing only for genuine truncation.

### D. Prompt-tightening for `adversarial.ts` and `secrets.ts`'s LLM-fallback path

No new orchestrator mechanism — verified redundant (see Problem section above: the generic
solo-High-to-Medium downgrade already exists and fires correctly whenever a finding is genuinely
uncorroborated). Instead, tighten both prompts with the same category of fix already applied to
`dependencies.ts` in PR #17, targeted at the specific failure patterns reproduced this session:

- **`adversarial.ts`**: add explicit guidance that "attacker"/adversarial-input framing only
  applies when the code actually has an external, untrusted-input boundary (network request,
  user-facing form, file upload) — not local tooling, git hooks, or CI scripts reading trusted
  input from the calling process. Reproduced `adversarial` hallucinations specifically
  mischaracterized a local git hook's stdin (Claude Code's own tool-call JSON) as
  attacker-controlled. Also tighten `basis=VERIFIED` guidance to require the code path is
  unambiguously exercised as described, not merely plausible.
- **`secrets.ts`**: extend the existing negative-example list ("not example/placeholder values",
  "not `process.env.X` references") with two more concrete categories matched to what was actually
  reproduced: file/marker paths are not credentials regardless of surrounding variable names; hash
  algorithm invocations (`sha256sum`, `shasum`, `Get-FileHash`, variables merely named
  `hash`/`expected`/`checksum`) are not secrets.

Framed honestly as a rate reduction, not a fix: PR #17 showed removing `dependencies.ts`'s one
concrete triggering example stopped that _specific_ pattern but didn't stop the agent from
inventing new fabrications elsewhere. This is a smaller, complementary improvement to Sections A/B
(which remain the primary, structural defense for `secrets`/`dependencies` specifically) and to
the residual corroboration-check risk documented in Non-Goals for `adversarial`, which has no
tool-replacement option available.

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

- `tests/unit/gitleaksParser.test.ts` / `tests/unit/npmAuditParser.test.ts` (flat, matching
  `tests/unit/policyFilter.test.ts`'s existing convention): parse captured real JSON (clean-diff
  case, leak-detected case) into `Finding[]`, verify field mapping.
- Extended `tests/unit/secretsAgent.test.ts` / `tests/unit/dependenciesAgent.test.ts` (existing
  files, confirmed at these exact paths — not `tests/unit/agents/`): mock `runTool` to return
  captured JSON — assert `provider.chat` (the LLM) is **never called** on the tool-available path;
  mock `runTool` returning `null` — assert the existing LLM path still runs and degraded status is
  recorded.
- `tests/unit/baseAgent.test.ts`: new stage correctly wraps a bare single object, with the
  corrected (non-"truncated") log message; existing Stage 4 truncation tests unaffected.
- No new `orchestrator.test.ts` cases needed for Section D — no orchestrator code changes.
- `tests/unit/runner.test.ts` + `tests/unit/formatters/markdown.test.ts` /
  `tests/unit/formatters/sarif.test.ts`: `ReviewResult.toolAvailability` surfaces end-to-end,
  same conditional-spread pattern as sibling metadata.
- Calibration: one new live case each for `secrets` (gitleaks installed — assert findings carry
  `source: 'gitleaks'`, not `'heuristic'`/`'llm'`, confirming the LLM path was actually skipped)
  and `dependencies` (npm-audit triggered). No new permanent `expectEmpty` calibration gate for
  `adversarial`'s prompt-tightening — since Section D is an explicitly-acknowledged rate reduction,
  not elimination, a hard pass/fail gate on a single sample would be flaky by the fix's own honest
  framing, not a meaningful regression signal. Instead, verify Section D manually during
  implementation with a multi-run spot-check (reusing this session's `repro-raw.mjs` approach)
  against the same `review-reminders.sh`/`.ps1` content, and report the before/after rate directly
  rather than encoding it as a CI gate.
- Full suite re-run at the end against the existing baseline (393 tests at time of writing) plus
  the new tests added here.
