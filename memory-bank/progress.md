---
authority: accumulating
review-cycle: 30d
retention: archive-after-6m
staleness-threshold: 90d
tags:
  - work/completed
  - work/in-progress
  - work/backlog
last-reviewed: 2026-06-26
compaction_generation: 0
source_type: canonical
confidence: high
lineage: []
---

# Progress Tracker

**Last Updated**: 2026-07-14

## ✅ Completed (Tasks 1–16)

### Silent Agent Failure Reporting — 2026-07-17

- [x] `ParseFailureError` thrown by `parseFindings`/`parseCoverageResult` instead of silently
      returning `[]` on total parse failure.
- [x] `agentStatus` field added to `ReviewResult`, populated across all 4 `runner.ts`
      catch-block sites (sequential, parallel, coverage, testgen) plus their success paths.
- [x] All 4 output formats (markdown, json, sarif, github-annotations) surface agent failures
      clearly instead of an indistinguishable clean checkmark.
- [x] New exit code 2 for agent failures, independent of and taking priority over `--fail-on`.
- [x] 16 existing agent test files updated from asserting a silent `[]` return to asserting
      `ParseFailureError` is thrown; new dedicated tests for the runner-level classification,
      formatter output, exit code priority, and an end-to-end regression test for the original
      bug report scenario.
- [x] v1.4.0.

### `/ai-review` Distribution + Update-Notifier — 2026-07-14

- [x] `scripts/postinstall.mjs` (plain JS, not compiled TS -- must survive running before
      `dist/` exists) copies `.claude/commands/ai-review.md` to `~/.claude/commands/` on every
      `npm install -g`/`npm update -g`. Fails open on any error. Resolves the invoking user's
      real home directory even under `sudo npm install -g` (via `SUDO_USER`).
- [x] `package.json`'s `files` array now ships `.claude/commands/` and `scripts/postinstall.mjs`.
- [x] `update-notifier` wired into `src/cli/index.ts`: 7-day cached check, non-blocking, TTY-only
      notification, never auto-installs.
- [x] Verified end-to-end via `npm pack` + global install into a throwaway prefix/fake HOME.
- [x] v1.3.0.

### AbortSignal/Timeout-Cancellation Fix — 2026-07-14

- [x] Root cause: `withTimeout` (`runner.ts`) raced a timer against each agent's LLM call via
      `Promise.race`, which never cancels the losing side — a timed-out agent's in-flight fetch
      to Ollama kept running server-side for up to 5 minutes after the runner gave up, and each
      retry piled another live, uncancelled request on top instead of replacing the abandoned
      one, compounding contention under load.
- [x] Fix: threaded an `AbortController`'s signal from `withTimeout` through
      `agent.run()`/`runForCoverage()`/`runWithGaps()` (`base.ts`, `complexity.ts`,
      `coverageAnalyst.ts`, `testGen.ts`) down to `OllamaProvider.chat()`'s `fetch` call
      (`ollamaProvider.ts`, `provider.ts`), so a timeout now actually cancels the request.
- [x] Found and fixed during review: the fix itself left `withTimeout`'s `setTimeout` handle
      uncaptured, so even a _successful_ call left a dangling timer that fired a pointless
      `controller.abort()` afterward — closed with `.finally(() => clearTimeout(timer))`.
- [x] Full `/code-review` (5 subagents + confidence scoring + opponent check) — no other issues
      found; all call sites verified complete (only `ComplexityAgent`/`CoverageAnalystAgent`
      override `run()`, both correctly threaded).
- [x] New regression tests: proves the signal actually aborts on timeout, and proves the timer
      is cleared (no dangling abort) on success. 297 unit tests passing (up from 295).
- [x] Unrelated CI fix bundled in the same working session, landed as a separate commit:
      `.github/workflows/review.yml`'s "Write Step Summary" step used bash-only escaping with no
      `shell:` declared, silently defaulting to PowerShell on the self-hosted Windows runner and
      failing every PR with `ParserError`/`SyntaxError`. Fixed with a job-level `shell: bash`
      default so every step in the job is consistent.
- [x] `/change-review` dogfooding (9-job review + ACR invocation) surfaced that ACR's security
      profile timed out on all 4 agents against `devstral:latest` — reproduced directly with a
      realistic diff-sized prompt (~24KB) taking over 100s with no response. Root cause: this
      machine's 8GB-VRAM GPU only fits ~6.1GB of the 23.6B-param model, the rest runs on CPU.
      `DEFAULT_CONFIG.agentTimeoutMs` (`src/core/config.ts:60`) was 60000ms, far tighter than
      `OllamaProvider`'s own `DEFAULT_TIMEOUT_MS` (300000ms) already assumed. Raised to 180000ms
      to close the gap. Config-only change; 297 tests still pass, typecheck clean.

### CI Gate Added — 2026-07-06

- [x] `.github/workflows/ci.yml` created — first real push/PR quality gate (previously only
      `release.yml` ran the full check suite, at release-tag time only). Runs typecheck, format:check,
      lint:eslint, test, build each as an independent `continue-on-error` step, gated by a final
      "Gate on all checks" step that fails the job on any non-success outcome.
- [x] Fixed pre-existing `format:check` drift on 6 files (`.claude/commands/change-review.md`,
      `.claude/commands/code-review.md`, 4 files under `docs/superpowers/`) via `prettier --write` so
      the new gate starts green.

### Core Infrastructure

- [x] **Task 1**: Project scaffolding — package.json, tsconfig, vitest.config.ts (`d21e3c7`)
- [x] **Task 2**: Core types — Finding schema, LLMProvider interface (`d9b31bd`)
- [x] **Task 3**: Config loading — ReviewConfig + loadConfig() with project override (`c510e03`)
- [x] **Task 4**: OllamaProvider — HTTP client, think-tag stripping, ping (`91cac35`)
- [x] **Task 5**: BaseAgent — abstract class with 3-stage JSON parse (`fbc8713`)

### Specialist Agents

- [x] **Task 6**: SecurityAgent, PerformanceAgent, CorrectnessAgent (`37ea95c`)
- [x] **Task 7**: DesignAgent, DependenciesAgent, AdversarialAgent, IntegrationScoutAgent (`6eb735b`)
- [x] **Task 8**: CoverageAnalystAgent (gaps + findings) + TestGenAgent (`ccd09d5`)

### Orchestration

- [x] **Task 9**: OrchestratorAgent — dedup, cross-reference escalation, publication filter, cap (`c9b7835`, `46b3585`)
- [x] **Task 10**: SwarmRunner — sequential orchestration with coverage-first ordering (`0634500`)

### Distribution

- [x] **Task 11**: CLI — Commander entry point + markdown/json formatters (`c26fab1`)
- [x] **Task 12**: GitHub Actions adapter + workflow (PR comment upsert, Step Summary) (`4bc5298`)
- [x] **Task 13**: Claude Code slash command `.claude/commands/ai-review.md` (`9c7db4a`)

### Quality & Verification

- [x] **Task 14**: Calibration suite — 9 fixture diffs + calibrate.ts runner (`c90d63b`)
- [x] **Task 15**: Integration test — E2E against live Ollama, skippable via INTEGRATION=1 (`46e0d7a`)
- [x] **Task 16**: Final wiring + verification — build clean, 19 unit tests pass, CLI --help, typecheck 0 errors (`945217d`)

## ✅ Guardrails (G1–G6, 2026-06-06)

- [x] **G1**: Hallucination cross-check — Critical/High requires ≥2 agents at same file+line (±5)
- [x] **G2**: Diff size guard — `maxDiffLines` (default 2000) + `--max-diff-lines` CLI flag
- [x] **G3**: Finding merge dedup — `corroboratingAgents` field on Finding schema
- [x] **G4**: Per-agent timeouts — `agentTimeoutMs` (default 180 s, raised from 60 s on 2026-07-14) + `--timeout` CLI flag
- [x] **G5**: Severity gating — `--fail-on` flag (critical|high|medium|any|never; default: high)
- [x] **G6**: Path exclusions — `.aiignore` + `--ignore-path` + `ignorePaths` config
- [x] **G8**: Configurable retry — `retryAttempts`/`retryDelayMs` config + `--retry-attempts`/`--retry-delay` CLI flags (`c2d2387`)

## 📊 Metrics

### Test Coverage

- **Unit Tests**: 295 passing across 37 test files (run `npm test` for current count)
- **Integration Tests**: 1 file, 5 tests — skip without INTEGRATION=1, run with live Ollama
- **Total**: 295

### Implementation Progress

- **Tasks complete**: 16 / 16 (100%) ✅ + Phase 2 (8 tasks) ✅ + v0.8.0 (5 new agents) ✅
- **Agents implemented**: 17 / 17 (16 specialists + orchestrator) ✅
- **TypeScript errors**: 0
- **GitHub**: https://github.com/unyieldingclaw-dev/ai-code-review-agent

## ✅ Phase 2 Improvements (2026-06-06)

- [x] **P2-1**: CLI consolidation — flatten review subcommand; --path→--dir, --max-diff-lines→--max-lines, --ignore-path→--ignore; add --no-sanitize
- [x] **P2-2**: Schema extensions — confidence field on Finding, sanitize on ReviewConfig, breaking-change/license AgentNames
- [x] **P2-3**: Prompt injection sanitizer — 9 unit tests
- [x] **P2-4**: BreakingChangeAgent — detects removed exports, signature changes, renamed APIs — 5 unit tests
- [x] **P2-5**: LicenseComplianceAgent — flags GPL/AGPL/SSPL/Commons Clause — 5 unit tests
- [x] **P2-6**: Confidence scoring — self-reported 0–100, confidence-aware hallucination check, shown in formatter — 6 unit tests
- [x] **P2-7**: Calibration CI — weekly + release schedule, self-hosted runner, graceful skip
- [x] **P2-8**: Documentation — README v0.2.0, CHANGELOG, slash command, memory-bank

## ✅ v0.5.0 Cursor/VS Code Extension (Complete)

- [x] **V5-1**: `vscode-extension/` scaffold — `package.json` (type: `extensionKind: ["workspace"]`), `tsconfig.json`, `esbuild` bundler config
- [x] **V5-2**: Core subprocess runner — spawn `ai-review-agent --format json`, capture stdout, parse `Finding[]`
- [x] **V5-3**: DiagnosticCollection adapter — map `Finding` → `vscode.Diagnostic`, push to collection
- [x] **V5-4**: OutputChannel renderer — format findings as markdown in "AI Review" output channel
- [x] **V5-5**: Command registration — `aiReview.reviewStagedChanges`, progress notification during run
- [x] **V5-6**: Bundling — bundle `ai-review-agent` into `.vsix` via esbuild/webpack, verify size
- [x] **V5-7**: README + publish — marketplace metadata, `vsce package`, smoke test in Cursor

## 🎯 Milestones

### Phase 1: Core Infrastructure (Complete)

- ✅ Project scaffold, type system, config, LLM provider, BaseAgent
- **Completed**: 2026-06-04

### Phase 2: Agents + Orchestration (Complete)

- ✅ 9 specialist agents (Tasks 6–8)
- ✅ Orchestrator (Task 9)
- ✅ SwarmRunner (Task 10)
- **Completed**: 2026-06-05

### Phase 3: CLI + Distribution (Complete)

- ✅ CLI + formatters (Task 11)
- ✅ GitHub Actions adapter + workflow (Task 12)
- ✅ Slash command (Task 13)
- ✅ Calibration suite (Task 14)
- ✅ Integration test — E2E (Task 15)
- ✅ Final wiring + verification (Task 16)
- **Completed**: 2026-06-06

## 📈 Version History

| Version         | Date          | Changes                                                                                                                                                                                                                                                                       |
| --------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.1.0-dev       | 2026-06-04    | Tasks 1–5: scaffolding, types, config, Ollama, BaseAgent                                                                                                                                                                                                                      |
| 0.1.0-dev       | 2026-06-05    | Tasks 6–10: all 10 agents, orchestrator, SwarmRunner (19 tests)                                                                                                                                                                                                               |
| 0.1.0           | 2026-06-06    | Tasks 11–16: CLI, GitHub Actions, slash command, calibration, e2e test, final verification                                                                                                                                                                                    |
| 0.1.1           | 2026-06-06    | Guardrails G1–G6: hallucination check, diff size guard, dedup merge, timeouts, severity gate, path exclusions (37 tests)                                                                                                                                                      |
| 0.2.0           | 2026-06-06    | Phase 2: CLI consolidation, sanitizer, BreakingChangeAgent, LicenseComplianceAgent, confidence scoring, calibration CI (62 tests)                                                                                                                                             |
| 0.3.0           | 2026-06-10    | npm distribution: package renamed `ai-review-agent`, release workflow, Node.js 24, published to npm                                                                                                                                                                           |
| 0.4.0           | 2026-06-11    | prompt tuning + calibration expansion: `confidence` on all 10 agents, calibrate.ts covers all 11, new breaking-change + license fixtures                                                                                                                                      |
| 0.5.0           | 2026-06-11    | Cursor/VS Code extension: subprocess architecture, bundled install, command palette trigger, DiagnosticCollection + OutputChannel (V5-1–V5-7)                                                                                                                                 |
| 0.5.0 (cleanup) | 2026-06-12    | vscode-extension dep → `^0.4.0` (npm), tarball removed from repo, `.gitignore` stale exception removed                                                                                                                                                                        |
| 0.6.0           | 2026-06-12    | MCP server: `ai-review-mcp` binary, `review_diff` tool, stdio transport, A+C hybrid output, 10 agents (no testgen), `.cursor/mcp.json`, 77 unit tests                                                                                                                         |
| 0.7.0           | 2026-06-13    | Configurable retry logic: `withRetryTimeout` wrapper, `retryAttempts`/`retryDelayMs` config fields, `--retry-attempts`/`--retry-delay` CLI flags, 3 new retry tests (80 total)                                                                                                |
| 0.8.0           | 2026-06-15    | 5 new specialist agents: ErrorHandlingAgent, ObservabilityAgent, MigrationSafetyAgent, SecretsAgent, ComplexityAgent; shell.ts runTool(); conditional MigrationSafety skip; 32 new unit tests (112 total); 5 calibration fixtures; README + config updated                    |
| 0.9.0–0.9.4     | 2026-06-18–19 | --fail-fast, progress events, calibration tuning, --parallel flag; 120 unit tests                                                                                                                                                                                             |
| 1.0.0           | 2026-06-24    | --profile (6 presets), --context memory-bank, --format sarif/github-annotations, policy layer (agentPolicy), extended Finding schema (domain/evidence/impact/recommendation/blocking/source), 15 agent prompts updated, 16/16 calibration, 248 tests                          |
| 1.0.1           | 2026-06-24    | Audit remediation: sanitizer multi-pattern fix, BaseAgent defaults tests, GitHub adapter tests, vitest coverage fix, CHANGELOG, JSDoc, contextBudgetChars, lineEnd clamp, AGENT_PRIORITY docs; 264 tests                                                                      |
| 1.1.0           | 2026-06-25    | --no-emoji, --context-mode semantic (nomic-embed-text), --context-budget, .aiignore negation, ESLint (0 warnings), coverage parser fixed, orchestrator breaking-change escalation, vscode-extension v0.6.0 (profiles + context), migration-safety fixture expanded; 276 tests |
| 1.2.0           | 2026-06-26    | SRP: parsing.ts extraction; semantic context warning; vscode-extension timeout; OllamaProvider SSRF hardening; MCP shutdown handlers; 295 tests; all 3-round audit findings resolved                                                                                          |
