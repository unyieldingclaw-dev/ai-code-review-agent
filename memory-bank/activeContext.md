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

**Last Updated**: 2026-07-25

## Current Focus

**Actionable truncation warning; parallel-by-default investigated and rejected (2026-07-25)**:
follow-up to a real bug report (ACR's 4-agent security profile took ~22 minutes against a
4658-line diff, zero findings). Initially implemented `DEFAULT_CONFIG.parallel: true` after a
4-concurrent-request, trivial-prompt test showed a ~1.63x speedup — but a deeper test at the real
default scale (14 concurrent requests, matching the actual default agent count, with a realistic
~30KB diff prompt) showed near-linear serialization instead: completions at 58.7s, 91.5s, 120.6s,
172.7s, 235.0s, 305.7s, then a header-timeout past 300s for a still-pending request. Reproduced
with `curl` directly (bypassing Node's fetch client) to rule out a client-side artifact — same
staggered pattern. Since each queued request's client-side timeout clock starts at dispatch, not
when Ollama actually begins generating, defaulting to parallel would have caused most of the
default swarm to spuriously time out — reproducing the exact "everything times out, 0 findings"
bug this tool exists to prevent. Also confirmed `ai-review-agent` has zero Anthropic/Claude API
integration (100% local Ollama inference), so there's no token-cost pressure to justify the
reliability risk. **Reverted** `DEFAULT_CONFIG.parallel` back to `false`, `--no-parallel` back to
plain opt-in `--parallel`, and `memory-bank/systemPatterns.md`'s original "Sequential Execution"
rationale back (it was correct all along — updated with the investigation's findings rather than
struck through). Kept: the truncation-warning wording improvement (unrelated, still good), and
the `--fail-fast`+`--parallel` combination warning (still useful for opt-in parallel users).
Shipped as v1.7.0, 348 tests. This repo's own `/code-review` pre-commit gate caught 2 real
Blocking findings on the (pre-revert) parallel-default version, both moot after the revert. Model
choice was separately investigated (see "Model configuration" below) — `devstral:latest` remains
correct; a real bake-off against `qwen3:latest`/`gemma3:12b` is next. Deferred to follow-up PRs
per the same bug report: retry with a shrunk prompt on timeout, and parse-failure fallback
extraction (surface the model's raw response instead of discarding it). A separate deep
architecture review (same session) surfaced 6 more findings — see "Architecture review findings"
below.

**Architecture review findings (2026-07-25)**: a request for "true design suggestions, not made
up" prompted a verified (not speculative) pass over the core source. Highest-value: (1)
`ChatOptions.format?: 'json'` is fully plumbed (`provider.ts`, `ollamaProvider.ts`) but never
called anywhere — empirically confirmed `format: "json"` makes `devstral:latest` reliably emit
syntactically valid JSON, which should reduce the `ParseFailureError`/prose-instead-of-JSON class
of bug this project has fought since v1.4.0. (2) `--context-mode semantic`
(`loadAgentContextSemantic` in `contextLoader.ts`) has zero caching and is called once per agent
in `runner.ts`'s `withContext` closure — ~14x redundant Ollama embedding calls per run for
identical inputs, adding unnecessary contention on top of the concurrency findings above. (3)
`orchestrator.ts`'s `applyPublicationFilter` unconditionally discards all `severity: 'low'`
findings with no override, yet `complexity.ts` and `observability.ts` explicitly instruct the
model to generate them — pure wasted generation time for those two agents. (4) `sanitizer.ts`'s
regex heuristics false-positive on ordinary code — empirically reproduced: SRI integrity hashes
(`sha512-...`, common in dependency-update diffs) and comments like "act as a validator" both get
silently redacted before reaching the LLM; zero existing tests check for this. (5) `base.ts`
unconditionally sends `think: true`, but `OllamaProvider.supportsThinking()` only forwards it for
`qwen`/`deepseek-r1` models — never `devstral`, the actual default — so `systemPatterns.md`'s
"reasoning depth matters" claim doesn't describe what's actually running. (6) `OrchestratorAgent`
takes an unused `LLMProvider` constructor param (100% deterministic synthesis, no LLM calls).
User approved items 1, 2, 4 as worth implementing; not yet started.

**Model configuration investigation (2026-07-25)**: user asked to verify the correct Ollama model
is configured given more models were downloaded. Confirmed `DEFAULT_CONFIG.model: 'devstral:latest'`
(`config.ts:38`) is consistently referenced everywhere (including `calibration/calibrate.ts:138`)
— no drift or misconfiguration. Measured actual GPU/CPU split at the real 32k context for every
locally-downloaded model: `devstral:latest` 20GB/30%-GPU, `deepseek-r1:14b` 15GB/38%-GPU,
`gemma3:12b` 9.1GB/49%-GPU, `qwen3:latest` 10GB/59%-GPU, `gemma3:4b` 2.9GB/**100%-GPU** (the only
fully GPU-resident option). Recommendation: don't switch yet — no evidence any alternative
matches devstral's review quality on this project's calibration suite, and `gemma3:4b`
specifically is a large capability step down (4B vs 23.6B params). `calibration/calibrate.ts` has
no model override (hardcoded to `DEFAULT_CONFIG.model`) — adding one to run a real bake-off
against `qwen3:latest`/`gemma3:12b` is the agreed next step, not yet started.

**Truncation-aware timeout scaling (2026-07-18)**: follow-up to diff-truncation visibility
below, addressing the same bug report's other suggested fix. `agentTimeoutMs` was flat
regardless of diff size — `scaleAgentTimeout(base, diffLines, maxDiffLines)` in `runner.ts`
now linearly scales it up to 2x as the post-truncation diff size approaches `maxDiffLines`, on
by default (`ReviewConfig.timeoutScalingEnabled`). Passing `--timeout` explicitly sets
`timeoutScalingEnabled = false` so an explicit override always wins — no scaling. Threaded
through as a new `timeout` parameter to `runCoverageAgent`/`runAgentsSequential`/
`runAgentsParallel` and the inline TestGen block, computed once in `run()` right after
`preprocessDiff()` produces `truncationMeta`. Also fixed a stale CLI help-text bug found along
the way (`--timeout` still documented the old 60000ms default, pre-dating the earlier 60s→180s
fix). Shipped as v1.6.0.

**Diff-truncation visibility (2026-07-18)**: real bug report against v1.2.0 (PMB running
`/change-review` against a 4188-line diff) — truncation to `--max-lines` (default 2000) only
ever logged to stderr, never appeared in the report itself, so a caller reading just the
markdown/JSON/SARIF/annotations output had no way to know over half the diff was excluded.
Added `ReviewResult.truncation: { truncated, originalLines, keptLines }` (same conditional-spread
pattern as `agentStatus`), surfaced prominently near the top of the markdown report (not buried
at the bottom like `sanitizer`/`context`), in SARIF run properties, and as a `::warning::`
github-annotation even with zero findings. Deliberately NOT wired into exit code 2 — a truncated
but successful review is a different kind of "incomplete" than an agent that outright failed.
Shipped as v1.5.0. The bug report's core complaint (false-clean result on agent failure) turned
out to already be fixed on `main` as v1.4.0 but stuck unpublished at npm v1.2.0 — published via
`git tag v1.4.0 && git push --tags` before this follow-up started.

**Silent agent failure reporting fix (2026-07-17)**: a run where every agent timed out or
returned unparseable prose instead of JSON rendered identically to a genuinely clean review —
`0 findings | ✅ No issues found` in both cases, only visible in stderr. `parseFindings`
(`base.ts`) and `parseCoverageResult` (`coverageAnalyst.ts`) now throw `ParseFailureError`
instead of silently returning `[]`; `runner.ts`'s 4 catch blocks classify it into a new
`agentStatus: Partial<Record<AgentName, AgentStatus>>` field on
`ReviewResult`. All 4 formatters surface it; a new exit code 2 (independent of and taking
priority over `--fail-on`) means CI can no longer silently treat a broken run as passing. Shipped
as v1.4.0 (v1.3.0 was already taken by the ai-review-distribution feature below, merged first).
See `docs/superpowers/specs/2026-07-15-silent-agent-failure-reporting-design.md`.

**`/ai-review` distribution + update-notifier (2026-07-14)**: `/ai-review` previously only existed
as a slash command inside this repo's own checkout -- `package.json`'s `files` array never shipped
`.claude/commands/`. Added a `postinstall` script (`scripts/postinstall.mjs`, plain JS so it can't
be broken by an unbuilt `dist/`) that copies it to `~/.claude/commands/` on every global install
(resolving the invoking user's real home even under `sudo npm install -g`), plus an
`update-notifier` check in the CLI entrypoint (7-day cache, non-blocking, never auto-installs). See
`docs/superpowers/specs/2026-07-14-ai-review-distribution-design.md`.

**AbortSignal/timeout-cancellation fix (2026-07-14)**: `withTimeout`'s `Promise.race` never cancelled the losing side, so a timed-out agent's in-flight fetch to Ollama kept running server-side (up to `DEFAULT_TIMEOUT_MS`, 5 min) after the runner had already given up — each retry then piled another live, uncancelled request on top instead of replacing the abandoned one. Fixed by threading an `AbortController`'s signal from `withTimeout` (`runner.ts`) through `agent.run()`/`runForCoverage()`/`runWithGaps()` down to `OllamaProvider.chat()`'s `fetch` call, so a timeout now actually cancels the request. Also fixed a `clearTimeout` gap the fix itself introduced (the timer's handle was never captured, so even a successful call left a dangling timer that fired a pointless `abort()` afterward). Went through full `/code-review` (5 subagents + opponent check) — no other issues found. 297 unit tests passing (up from 295). Also fixed an unrelated CI bug in `.github/workflows/review.yml`: the "Write Step Summary" step used bash-only escaping with no `shell:` declared, defaulting to PowerShell on the self-hosted Windows runner and failing with `ParserError`/`SyntaxError` on every PR — fixed with a job-level `shell: bash` default.

**`agentTimeoutMs` default raised 60s → 180s (2026-07-14)**: dogfooding `/change-review` on this session's own diff surfaced that ACR's security profile timed out on all 4 agents against `devstral:latest` (0 findings via failure, not a clean result). Reproduced directly: a realistic diff-sized prompt (~24KB) took over 100s with no response. Root cause is this dev machine's GPU (8GB VRAM) not fitting the 23.6B-param model — `ollama ps` showed only 6.1GB offloaded to GPU, the rest running on CPU. `DEFAULT_CONFIG.agentTimeoutMs` (`src/core/config.ts:60`) was still 60000ms, far tighter than `OllamaProvider`'s own `DEFAULT_TIMEOUT_MS` (300000ms) already assumed — raised to 180000ms to close that gap. Config-only change; 297 tests still pass, typecheck clean.

**New push/PR CI gate added (2026-07-06)**: this repo previously had no CI gate on regular
push/PR to `main` — `typecheck`/`lint`/`test`/`build` only ran at release-tag time
(`release.yml`), and `review.yml` only ran `format:check` + posted an AI-review comment without
failing the build on findings. Added `.github/workflows/ci.yml`: on every push/PR to `main`, runs
typecheck, format:check, lint:eslint, test, and build as independent steps (`id:` +
`continue-on-error: true`), followed by a "Gate on all checks" step (`if: always()`) that fails
the job if any step didn't succeed — same masking-prevention pattern applied to Bowling-Tracker
and Google-Organizer this session. Also fixed pre-existing `format:check` drift on 6 docs/command
files (unrelated content, mechanical `prettier --write`) so the new gate is green from day one.
All 5 checks verified passing locally (295/295 tests) before the workflow was added.

**All audit work complete.** Three-round pre-production audit (Rounds 1–3, 2026-06-24 to 2026-06-26) resolved all 90+ findings. Zero open Critical/High issues. 295 unit tests passing. Production ready.

## What's Working

- Full 16-agent swarm (15 default + testgen opt-in): all specialists + OrchestratorAgent
- `SwarmRunner` with policy filtering, context injection, sanitizer, sequential/parallel execution
- CLI: `--profile`, `--context`, `--context-mode`, `--context-budget`, `--format` (markdown/json/sarif/github-annotations), `--no-emoji`, `--agents`, `--dir`, `--ignore`, `--no-sanitize`, `--suggest-tests`, `--write-tests`
- Finding schema: domain, evidence, impact, recommendation, blocking, source, lineEnd (MB/PMB-aligned)
- Semantic context: `--context-mode semantic` uses nomic-embed-text to rank memory-bank files by diff similarity
- Policy layer: `agentPolicy` per-agent include/exclude glob path filtering
- `.aiignore` negation patterns: `!pattern` overrides excludes (gitignore-style)
- ESLint (`npm run lint:eslint`) — 0 warnings, included in `npm run check`
- Calibration CI: self-hosted runner, continue-on-error, 10min timeout
- **348 unit tests** across 39 test files
- `src/core/parsing.ts`: `validateAndNormalizeFindings()` extracted from BaseAgent (SRP)
- `vscode-extension/src/runner.ts`: 5-minute wall-clock subprocess timeout
- `src/core/contextLoader.ts`: emits stderr warning when `nomic-embed-text` unavailable
- **GitHub repo**: https://github.com/unyieldingclaw-dev/ai-code-review-agent
- **npm**: `ai-review-agent@1.2.0`

## Guardrails (All Complete)

- [x] **G1**: Hallucination cross-check — now confidence-aware (solo Critical ≥60% → keep, <60% → High)
- [x] **G2**: Diff size guard — `--max-lines` CLI flag (was `--max-diff-lines`)
- [x] **G3**: Finding deduplication merging — `corroboratingAgents` on Finding schema
- [x] **G4**: Per-agent timeouts — `--timeout` CLI flag
- [x] **G5**: Configurable severity gating — `--fail-on` flag
- [x] **G6**: Path exclusions — `.aiignore` + `--ignore` CLI flag (was `--ignore-path`)
- [x] **G7**: Prompt injection sanitization — `--no-sanitize` to opt out

## Phase 2 Features (All Complete)

- [x] CLI consolidation: flattened `review` subcommand, 3 flag renames, `--no-sanitize`
- [x] Prompt injection sanitizer: 9 unit tests
- [x] BreakingChangeAgent: 5 unit tests
- [x] LicenseComplianceAgent: 5 unit tests
- [x] Confidence scoring: 6 unit tests
- [x] Calibration CI workflow
- [x] Documentation: README, CHANGELOG, slash command, memory-bank

## Next Steps

- **NPM token renewal**: `github-actions-publish` token expires Sep 8 2026 — create new Automation token on npmjs.com and update `NPM_TOKEN` GitHub Actions secret before then.
- **Version 1.2.0**: Ready to publish. Run `git tag v1.2.0 && git push --tags` to trigger npm release.
- **Anthropic/Claude provider** (backlog): Alternative to Ollama using `claude-sonnet-4-6` via API.
- **Marketplace publish** (VS Code extension): Explicitly DEFERRED.

## v0.5.0 Design Decisions (2026-06-11)

**Target**: Cursor IDE (VS Code-compatible extension API), Windows + Mac.

**Architecture**: Subprocess model — extension shells out to `ai-review-agent --format json`, parses `Finding[]` JSON from stdout. No monorepo, no restructuring of existing codebase. Extension is ~150 lines.

**Bundling**: Bundle `ai-review-agent` npm package inside the `.vsix` (~5 MB). Zero install friction — no global npm install required.

**Trigger**: Command palette only — `AI Review: Review Staged Changes`. User-initiated, never runs on save (Ollama latency is 30–120 s).

**Diff source**: Staged changes (`git diff --cached`). If nothing staged, show clear error: "No staged changes found. Stage your changes with `git add` and try again." No fallback magic.

**Output surfaces** (both):

1. `vscode.languages.createDiagnosticCollection` → squiggles in editor + Problems panel entries, click-to-navigate to file/line. Cleared on next run.
2. `vscode.window.createOutputChannel("AI Review")` → full markdown report, same content as CLI output. No webview.

**Repo structure**: `vscode-extension/` subfolder in existing repo. Standalone package, no pnpm workspace needed (subprocess approach requires no shared source).

**Rejected alternatives**:

- Monorepo (Option 2): too much restructuring risk for first extension release
- Workspace dep (Option 3): half the monorepo pain with fewer benefits
- Webview output: OutputChannel gives 90% of value at 10% complexity
- Quick-pick diff source: decision fatigue for the common case; two explicit commands if needed later

## Environment Status

**Infrastructure**: Ollama must be running on port 11434 for integration tests and calibration (not required for unit tests)

**Git**: `main` branch, pushed to remote

## Key Commands

```bash
npm test                    # all unit tests (297 passing)
npm run typecheck           # 0 errors
npm run build               # compile to dist/
node dist/cli/index.js --help   # smoke test CLI
```

## Recent Decisions

- **CLI flattening**: removed `review` subcommand (was implicit, confusing in help output)
- **`--dir` not `--path`**: clearer that it's a directory, not a generic path
- **`Map` instead of `Record` for agent builders**: graceful unknown-agent handling vs compile-time exhaustiveness
- **Confidence default 70**: reasonable for an LLM agent without explicit confidence output
- **Solo Critical + ≥60% stays Critical**: high-confidence agent findings don't need corroboration

## Session Notes

- 2026-06-04: Tasks 1–5 implemented and committed.
- 2026-06-04/05: Tasks 6–10 implemented and committed (agents, orchestrator, SwarmRunner).
- 2026-06-05: Tasks 11–15 implemented (CLI, GitHub Actions, slash command, calibration suite, e2e test).
- 2026-06-06: Task 16 — final verification complete. All 16 tasks shipped. Pushed to GitHub.
- 2026-06-06: Guardrails G1–G6 complete. 37 unit tests passing.
- 2026-06-06: Phase 2 — CLI consolidation, sanitizer, BreakingChangeAgent, LicenseComplianceAgent, confidence scoring, calibration CI. 62 unit tests passing.
- 2026-06-10: v0.3.0 — npm distribution. Renamed package `ai-review` → `ai-review-agent` (name taken). Published to npm via tag-triggered release workflow. Node.js upgraded to 24 in release.yml.
- 2026-06-11: v0.4.0 — prompt tuning + calibration expansion. `confidence` field added to all 10 agent systemPrompts. `calibrate.ts` rewritten to cover all 11 agents (10 standard + TestGen). New fixtures: `breaking-change.diff`, `license.diff`.
- 2026-06-11: v0.5.0 brainstorm — Cursor/VS Code extension design decisions locked. Subprocess architecture, bundled install, command palette trigger, staged-changes diff, DiagnosticCollection + OutputChannel output.
- 2026-06-11: v0.5.0 spec written and committed at `488fba2`. Implementation plan written and committed at `2fa1444`. 10 tasks, full TDD, all code included verbatim. Ready for execution.
- 2026-06-11: v0.5.0 complete — all 10 tasks (Task 0–9) implemented, reviewed, committed. Extension builds to `ai-review-agent-0.5.0.vsix` (137.85 KB, 119 files).
- 2026-06-12: Cleanup — v0.4.0 published to npm; extension dep updated from tarball to `^0.4.0`; tarball removed from repo; `.gitignore` whitelist exception cleaned. All pushed (`2be6d27`).
- 2026-06-12: v0.6.0 brainstorm → A+C hybrid output format, Cursor+Windows/Mac target, Ollama-only. Spec committed at `2852b00`, plan committed at `d277da4`. Implementation starting.
- 2026-06-12: v0.6.0 COMPLETE — `ai-review-mcp` binary ships in the package. 6 tasks, 7 commits (`27be871`→`1b697db`). 77 unit tests. Version bumped to 0.6.0. Next: `git tag v0.6.0 && git push --tags` to publish to npm.
- 2026-06-13: Configurable retry logic — `withRetryTimeout` wrapper in `runner.ts`, `retryAttempts`/`retryDelayMs` config + CLI flags, 3 new tests. 80 unit tests. Committed as `c2d2387`.
- 2026-06-18: v0.9.0 — AgentProgressEvent two-phase events, --fail-fast CLI flag, failFast/failOn on ReviewConfig, earlyExit on ReviewResult, stderr progress renderer. 117 unit tests. Published to npm.
- 2026-06-19: v0.9.1 — Calibration pass: ErrorHandlingAgent prompt (swallowed keyword + selective-rethrow exclusion), ObservabilityAgent (pure-function exclusion), MigrationSafetyAgent (safe DDL exclusion). All 117 tests still pass.
- 2026-06-19: v0.9.2 — Calibration fixes (5 failing cases): balanced-bracket parser in base.ts, wildcard wording in dependencies.ts, integration-tests wording in integrationScout.ts, license.diff fixture node-lame. 118 unit tests pass. Committed `6285207`.
- 2026-06-19: v0.9.3 — DependenciesAgent prompt restructured to lead with REQUIRED OUTPUT FORMAT + few-shot example. devstral now outputs valid Finding schema for package.json diffs. 16/16 calibration PASS confirmed. Committed `754ee08`.
- 2026-06-15: v0.8.0 — 5 new specialist agents (ErrorHandlingAgent, ObservabilityAgent, MigrationSafetyAgent, SecretsAgent, ComplexityAgent), `shell.ts` runTool(), conditional MigrationSafety skip in SwarmRunner, 32 new unit tests (112 total), 5 calibration fixtures, DEFAULT_CONFIG updated to 16 agents, package.json v0.8.0, README updated. Tasks 1–9 committed. Task 10 (final verification + tag) is next.
- 2026-07-14: AbortSignal/timeout-cancellation fix — `withTimeout` now cancels the losing side of the race instead of leaving it running server-side; fixed a `clearTimeout` gap found in review; unrelated CI fix (`shell: bash` default in `review.yml`, was silently defaulting to pwsh on the self-hosted Windows runner). 297 unit tests passing.
- 2026-07-25: v1.7.0 — attempted flipping `parallel` default to `true` after a promising small-scale test, then reverted after a deeper test at real scale (14 concurrent, realistic diff size) showed near-linear serialization and spurious-timeout risk. Kept the truncation-warning wording improvement. Separately: verified `devstral:latest` remains the correct configured model after more Ollama models were downloaded (measured GPU/CPU split for all of them); ran a "not made up" architecture deep-dive that found `format: 'json'` is unused, `--context-mode semantic` recomputes embeddings ~14x redundantly, and the sanitizer false-positives on real code (SRI hashes, common comments). 348 unit tests passing.
