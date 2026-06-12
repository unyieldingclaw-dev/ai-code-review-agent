---
authority: volatile
review-cycle: 7d
retention: archive-after-6m
staleness-threshold: 14d
tags:
  - session/focus
  - session/blockers
  - session/next-steps
last-reviewed: 2026-06-11
compaction_generation: 0
source_type: canonical
confidence: high
lineage: []
---

# Active Context - Current State

**Last Updated**: 2026-06-12

## Current Focus

**Cleanup complete. v0.4.0 on npm. Extension dep updated.** All working-tree changes committed and pushed. Tarball removed from repo history and disk. Brainstorming was in progress for the next feature (see Session Notes) — needs to resume.

## What's Working

- Full 11-agent swarm: 9 original specialists + BreakingChangeAgent + LicenseComplianceAgent + OrchestratorAgent
- `SwarmRunner` with sanitizer, sequential execution, coverage-first ordering
- CLI: top-level flags (no subcommand), `--dir`, `--max-lines`, `--ignore`, `--no-sanitize`
- Confidence scoring: `confidence` (0–100) on Finding, shown in markdown output
- Confidence-aware hallucination check: solo Critical ≥60% confidence stays Critical; <60% → High
- Prompt injection sanitizer: strips SYSTEM:, instruction overrides, role-play directives, long base64
- Calibration CI: `.github/workflows/calibrate.yml` — weekly + release, skips gracefully without Ollama
- **62 unit tests passing** across 11 test files
- **GitHub repo**: https://github.com/unyieldingclaw-dev/ai-code-review-agent

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

- **Resume brainstorming**: Next feature brainstorm was in progress — user was leaning options A + C (hybrid), Cursor IDE target, Windows + Mac, no Anthropic provider. Context was lost to compaction; ask user to recap what A/B/C were.
- **Marketplace publish**: Explicitly DEFERRED by user — "I don't think we are even close to having this posted on marketplace."
- **Backlog**: Anthropic/Claude provider — explicitly backlogged by user; wants Ollama-only to avoid API costs.
- **NPM token renewal**: `github-actions-publish` token expires Sep 8 2026 — create new token and update `NPM_TOKEN` secret before then.

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
npm test                    # all unit tests (62 passing)
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
- 2026-06-12: Cleanup — v0.4.0 published to npm; extension dep updated from tarball to `^0.4.0`; tarball removed from repo; `.gitignore` whitelist exception cleaned. All pushed (`2be6d27`). Next feature brainstorm was in progress (user leaning options A + C hybrid, Cursor + Windows/Mac target) — lost to compaction; resume with user.
