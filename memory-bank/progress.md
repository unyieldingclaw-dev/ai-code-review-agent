---
authority: accumulating
review-cycle: 30d
retention: archive-after-6m
staleness-threshold: 90d
tags:
  - work/completed
  - work/in-progress
  - work/backlog
last-reviewed: 2026-06-10
compaction_generation: 0
source_type: canonical
confidence: high
lineage: []
---

# Progress Tracker

**Last Updated**: 2026-06-13

## ✅ Completed (Tasks 1–16)

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
- [x] **G4**: Per-agent timeouts — `agentTimeoutMs` (default 60 s) + `--timeout` CLI flag
- [x] **G5**: Severity gating — `--fail-on` flag (critical|high|medium|any|never; default: high)
- [x] **G6**: Path exclusions — `.aiignore` + `--ignore-path` + `ignorePaths` config
- [x] **G8**: Configurable retry — `retryAttempts`/`retryDelayMs` config + `--retry-attempts`/`--retry-delay` CLI flags (`c2d2387`)

## 📊 Metrics

### Test Coverage
- **Unit Tests**: 80 passing (config: 2, ollamaProvider: 5, baseAgent: 5, orchestrator: 8, runner: 8, exitCode: 5, ignoreFilter: 7, sanitizer: 9, breakingChangeAgent: 5, licenseComplianceAgent: 5, confidence: 6, mcp/formatter: 8, mcp/tool: 7)
- **Integration Tests**: 1 file, 5 tests — skip without INTEGRATION=1, run with live Ollama
- **Total**: 80

### Implementation Progress
- **Tasks complete**: 16 / 16 (100%) ✅ + Phase 2 (8 tasks) ✅
- **Agents implemented**: 12 / 12 (11 specialists + orchestrator) ✅
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

| Version | Date | Changes |
|---------|------|---------|
| 0.1.0-dev | 2026-06-04 | Tasks 1–5: scaffolding, types, config, Ollama, BaseAgent |
| 0.1.0-dev | 2026-06-05 | Tasks 6–10: all 10 agents, orchestrator, SwarmRunner (19 tests) |
| 0.1.0 | 2026-06-06 | Tasks 11–16: CLI, GitHub Actions, slash command, calibration, e2e test, final verification |
| 0.1.1 | 2026-06-06 | Guardrails G1–G6: hallucination check, diff size guard, dedup merge, timeouts, severity gate, path exclusions (37 tests) |
| 0.2.0 | 2026-06-06 | Phase 2: CLI consolidation, sanitizer, BreakingChangeAgent, LicenseComplianceAgent, confidence scoring, calibration CI (62 tests) |
| 0.3.0 | 2026-06-10 | npm distribution: package renamed `ai-review-agent`, release workflow, Node.js 24, published to npm |
| 0.4.0 | 2026-06-11 | prompt tuning + calibration expansion: `confidence` on all 10 agents, calibrate.ts covers all 11, new breaking-change + license fixtures |
| 0.5.0 | 2026-06-11 | Cursor/VS Code extension: subprocess architecture, bundled install, command palette trigger, DiagnosticCollection + OutputChannel (V5-1–V5-7) |
| 0.5.0 (cleanup) | 2026-06-12 | vscode-extension dep → `^0.4.0` (npm), tarball removed from repo, `.gitignore` stale exception removed |
| 0.6.0 | 2026-06-12 | MCP server: `ai-review-mcp` binary, `review_diff` tool, stdio transport, A+C hybrid output, 10 agents (no testgen), `.cursor/mcp.json`, 77 unit tests |
| 0.7.0 | 2026-06-13 | Configurable retry logic: `withRetryTimeout` wrapper, `retryAttempts`/`retryDelayMs` config fields, `--retry-attempts`/`--retry-delay` CLI flags, 3 new retry tests (80 total) |
