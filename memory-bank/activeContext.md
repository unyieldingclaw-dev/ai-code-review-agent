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

**Last Updated**: 2026-08-19

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

**Open, undecided:**

- Dependabot PR #14 (gitleaks-action 2→3): undecided — needs an actual look, not an auto-merge.

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

- **Dependabot PR #14** (gitleaks-action 2→3): a major bump to the action the pre-push secret scan
  depends on — needs an actual look, not an auto-merge.
- **Anthropic/Claude provider** (backlog): alternative to Ollama.
- **Marketplace publish** (VS Code extension): explicitly DEFERRED.

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
