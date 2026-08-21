---
authority: volatile
review-cycle: 7d
retention: archive-after-6m
staleness-threshold: 14d
tags:
  - session/focus
  - session/blockers
  - session/next-steps
last-reviewed: 2026-06-26
compaction_generation: 0
source_type: canonical
confidence: high
lineage: []
---

# Active Context - Current State

**Last Updated**: 2026-08-21

## Current Focus

**v1.12.1 published, npm publishing now runs on Trusted Publishing (OIDC) — no token in the repo
at all.** `NPM_TOKEN` is deleted from GitHub secrets; `npm view ai-review-agent version` → `1.12.1`.

Four hallucination classes now have deterministic backstops instead of prompt wording: injection,
swallowed-exception, SQL NULL-error, and fabricated licenses. Prompt-only fixes were measured live
against Ollama across three separate agents and failed every time — for `license` a prompt fix made
it _worse_ (6/10 → 9/10) — matching what `secrets.ts` already recorded for
`hasCredentialShapedValue`. Measurements and the review/audit rounds are in `progress.md`.

**Calibration is now falsifiable, and no case is coupled to this repo's own state (2026-08-21).**
The 21–22/22 score used to aggregate assertions of very different strength — three cases asserted on
the agent's own domain vocabulary, and `DependenciesAgent` had **no** case that could fail (both
were `expectEmpty`, so an agent returning `[]` passed). Added `dependencies-vulnerable` plus a
per-case `projectPathFixture` so tool-backed cases run against their own materialised project.
`license-clean` was then moved onto its own `license-clean-lockfile.json` — it had passed only
because `commander` happens to be an ACR dependency. Keyword strengthening is measured, not assumed:
`calculateShippingCost` 5/5, `notifyWebhook` 4/4, `cancelOrder` 4/6 → reverted. Failing cases now
print what the agent actually returned. Details in `progress.md`.

**`toolAvailability` is now honest end-to-end (2026-08-21).** `'partial'` was added (a partial
gitleaks scan used to claim the tool never ran), then surfaced in MCP output — which ignored the
field entirely, so a partial scan, a missing tool, and a clean run were identical to a calling LLM —
and merged across chunks rather than last-chunk-wins, which had re-created the same false "complete
scan" claim one layer up. `TOOL_LABELS` moved to `schema.ts` so the formatters cannot drift.
Generalisable lesson from the deferral that held `'partial'` back: **a rationale recorded in a code
comment is a claim, not a finding** — re-check it before inheriting it. It asserted a
markdown/SARIF/MCP ripple; only one site actually branched on the value.

**Verified state:** 752 unit tests · `npm audit` 0 (prod + dev) · `npm run check` green ·
calibration 21–22/22. Calibration is nondeterministic — treat a single run as weak evidence, and
use `grep "orchestrator] dropped"` to tell a real filter regression from model variance. Target one
case with `CALIBRATION_CASE=name1,name2` rather than running all 21.

**Review-gate tooling investigation (2026-08-20).** Dogfooding `/code-review` and `/change-review`
surfaced twelve defects in the PMB-owned hook scripts, all sharing one shape: the enforcement did
not happen and the output said everything was fine. Findings and the recommended order were handed
to the PMB session as verbiage — **none of it is fixable here.** Those scripts are `TEMPLATE_OWNED`
and `mb upgrade` overwrites them unconditionally; see `systemPatterns.md` for the ownership rule
and the two working conventions that came out of it (keep the literal strings `git push`/`git
commit` out of command text; use `gh pr update-branch` rather than rebasing a pushed branch, since
force-push is blocked here).

**Upgrade to PMB 1.2.1 — deliberately on hold.** It would fix a live breakage (see below), but
`mb upgrade` copies from `$MB_HOME/templates`, i.e. PMB's **working tree**, not a tag or release.
That tree currently has uncommitted in-flight edits, so upgrading now would import someone's
half-finished work. Revisit once PMB's tree is clean and committed.

**Live breakage inherited from 1.1.1 — `last-reviewed` is not being maintained.**
`update-reviewed.*` reads a flat `.file_path` where the payload nests under `tool_input`, so it
exits 0 on every call and never stamps the date. Verified: files edited 2026-08-20 still carry
June/July dates. `mb doctor` reads those dates for staleness detection, so it is consuming a dead
sensor and will report actively-edited files as months stale. Fixed in PMB 1.2.1 — arrives with the
upgrade above, not with a local edit.

**ACR was reviewing the wrong side of its own diffs (2026-08-21).** Two false findings on PR #44 led
to four bugs. Fixed: finding paths kept the diff's `a/` prefix so 33% of real findings pointed at
nonexistent files and their GitHub annotations landed nowhere (#45); and agents reported deleted
code as a current defect (8/8 measured), now dropped by a `filterUnsupportedClaims` rule. A prompt
fix for the latter measured 7/7 — no effect — and was reverted. **The method mattered more than
either fix:** `gh run download` on the CI run yields the real `ai-review-findings` artifact, and
replaying it through `synthesize()` caught a miswiring that every unit test and a scratch probe both
missed. See `systemPatterns.md`.

**Open risks, detailed in `progress.md`:**

- Claim matchers are regexes over model prose. Both audit rounds found false negatives there; the
  evidence side has produced none. That is the fragile half.
- The two calibration cases coupled to this repo's own state (`license-clean`, `dependencies`) are
  both closed. The remaining cases have not been audited for the same shape.
- `policy`, `filteredFiles`, and `context` are still last-chunk-wins in `chunkRunner`. That remains
  a deliberate, documented simplification — none of them asserts anything about coverage the way
  `toolAvailability` does, which is why only that field was promoted to a real merge.
- The `ai-review` CI runner can hang indefinitely (observed 43 min without starting step 1). This is
  environment-side — the runner runs interactively via `run.cmd`, not as a supervised service, so
  nothing restarts it. `review.yml`'s `timeout-minutes: 45` is a backstop, not a fix.

> Prior session history: [`archive/activeContext-history.md`](archive/activeContext-history.md).

## What's Working

- Full 16-agent swarm (15 default + testgen opt-in): all specialists + OrchestratorAgent
- `SwarmRunner` with policy filtering, context injection, sanitizer, sequential/parallel execution
- CLI: `--profile`, `--context`, `--context-mode`, `--context-budget`, `--format` (markdown/json/sarif/github-annotations), `--no-emoji`, `--agents`, `--dir`, `--ignore`, `--no-sanitize`, `--suggest-tests`, `--write-tests`
- Finding schema: domain, evidence, impact, recommendation, blocking, source, lineEnd (MB/PMB-aligned)
- Semantic context: `--context-mode semantic` uses nomic-embed-text to rank memory-bank files by diff similarity
- Policy layer: `agentPolicy` per-agent include/exclude glob path filtering
- `.aiignore` negation patterns: `!pattern` overrides excludes (gitignore-style)
- ESLint (`npm run lint:eslint`) — 0 warnings, included in `npm run check`
- Calibration CI: self-hosted runner, 20min timeout. Calibration is nondeterministic — 21–22/22
  is normal; a single failing case is usually model variance, not a regression.
- **752 unit tests**; `npm audit` clean (prod + dev)
- `SecretsAgent`/`DependenciesAgent` use gitleaks/`npm audit` directly when available, skipping the
  LLM entirely; `ReviewResult.toolAvailability` surfaces degraded and partial runs (markdown, SARIF,
  and MCP), merged across chunks rather than last-chunk-wins
- `src/core/parsing.ts`: `validateAndNormalizeFindings()` extracted from BaseAgent (SRP)
- `vscode-extension/src/runner.ts`: 5-minute wall-clock subprocess timeout
- `src/core/contextLoader.ts`: emits stderr warning when `nomic-embed-text` unavailable
- **GitHub repo**: https://github.com/unyieldingclaw-dev/ai-code-review-agent
- **npm**: `ai-review-agent@1.12.1` published via Trusted Publishing (OIDC), provenance attached.
  `release.yml` has no npm secret dependency at all — `id-token: write` + the Trusted Publisher
  relationship configured on npmjs.com (GitHub Actions / `unyieldingclaw-dev` /
  `ai-code-review-agent` / `release.yml`) is sufficient. `npm install -g npm@latest` runs early in
  the workflow since OIDC publishing needs npm >= 11.5.1.

## Next Steps

- **PMB 1.2.1 upgrade** — blocked on PMB's working tree being clean (see Current Focus). Fixes the
  `last-reviewed` breakage; nothing else here depends on it.
- **Marketplace publish** (VS Code extension): explicitly DEFERRED.

> Removed 2026-08-20: an "Anthropic/Claude provider (backlog)" item sat here contradicting three
> higher-authority statements — `projectbrief.md` Non-Negotiable Constraints ("Ollama-only backend
> — no Anthropic/OpenAI API calls in the review pipeline"), `systemPatterns.md` **Never Do This**,
> and `systemPatterns.md`'s Sequential Execution rationale, which uses "no Anthropic/Claude API
> integration" as a load-bearing premise ("no token-cost pressure to justify accepting this
> reliability risk"). It also contradicts the shipped product identity — `package.json` says "zero
> API costs", the README says no cloud API calls required. No decision authorizing it exists
> anywhere in the archive. Reinstating it is a product decision requiring a projectbrief amendment
> plus revisiting the parallel-vs-sequential rationale, not a backlog line.

## Environment Status

**Infrastructure**: Ollama on port 11434 — required for integration tests and calibration, not for
unit tests. **Git**: `main` at `v1.12.1`. Commands are in `techContext.md`; `npm run check` covers
typecheck/build/format/lint/test in one pass.
