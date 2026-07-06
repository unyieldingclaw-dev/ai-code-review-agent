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

**Last Updated**: 2026-07-06

## Current Focus

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
- **295 unit tests** across 37 test files
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
npm test                    # all unit tests (295 passing)
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
