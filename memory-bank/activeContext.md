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

**Last Updated**: 2026-08-20

## Current Focus

**v1.12.1 published, npm publishing now runs on Trusted Publishing (OIDC) — no token in the repo
at all.** `NPM_TOKEN` is deleted from GitHub secrets; `npm view ai-review-agent version` → `1.12.1`.

Four hallucination classes now have deterministic backstops instead of prompt wording: injection,
swallowed-exception, SQL NULL-error, and fabricated licenses. Prompt-only fixes were measured live
against Ollama across three separate agents and failed every time — for `license` a prompt fix made
it _worse_ (6/10 → 9/10) — matching what `secrets.ts` already recorded for
`hasCredentialShapedValue`. Measurements and the review/audit rounds are in `progress.md`.

**Verified state:** 717 unit tests · `npm audit` 0 (prod + dev) · `npm run check` green ·
calibration 21–22/22. Calibration is nondeterministic — treat a single run as weak evidence, and
use `grep "orchestrator] dropped"` to tell a real filter regression from model variance.

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

**Open risks, detailed in `progress.md`:**

- Claim matchers are regexes over model prose. Both audit rounds found false negatives there; the
  evidence side has produced none. That is the fragile half.
- Two calibration cases were coupled to this repo's own state (`license-clean`, `dependencies`) —
  worth auditing the rest for the same shape.

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
- **717 unit tests**; `npm audit` clean (prod + dev)
- `SecretsAgent`/`DependenciesAgent` use gitleaks/`npm audit` directly when available, skipping the
  LLM entirely; `ReviewResult.toolAvailability` surfaces degraded-mode fallback (markdown + SARIF)
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

**Infrastructure**: Ollama must be running on port 11434 for integration tests and calibration (not required for unit tests)

**Git**: `main`, clean, at `v1.12.1`.

## Key Commands

```bash
npm test                    # all unit tests (717 passing)
npm run typecheck           # 0 errors
npm run build               # compile to dist/
node dist/cli/index.js --help   # smoke test CLI
```
