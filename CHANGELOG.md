# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.1.0] — 2026-06-25

### Added

- **`--no-emoji` flag**: disables emoji in markdown output for CI terminals without UTF-8 support. Severity labels become `[CRITICAL]`/`[HIGH]`/`[MEDIUM]`/`[LOW]`.
- **`--context-mode <mode>`**: `static` (default, hardcoded per-agent file routing) or `semantic` (ranks memory-bank files by cosine similarity to diff using `nomic-embed-text:latest`).
- **`--context-budget <n>`**: override the per-agent memory-bank context budget (default: 4000 chars).
- **`.aiignore` negation patterns**: lines starting with `!` now override exclude patterns (gitignore-style negation). Previously silently ignored.
- **ESLint** (`@eslint/js` + `typescript-eslint`): `npm run lint:eslint` — 0 warnings; included in `npm run check`.
- **`src/core/embedder.ts`**: cosine similarity + Ollama `/api/embeddings` for semantic context selection.
- **SARIF run-level properties**: context and policy metadata included in SARIF output when present.
- **GitHub token validation**: `upsertPRComment` throws early if token is empty.
- **Coverage agent parser**: balanced-brace extraction replaces greedy regex (prevents malformed JSON on complex outputs).
- **Orchestrator escalation**: breaking-change findings co-located with correctness or design findings are escalated one severity level.
- Migration-safety calibration fixture extended with Knex.js and Alembic patterns.
- vscode-extension v0.6.0: `aiReview.profile` dropdown, `aiReview.contextMode` dropdown, 15-agent description.

### Changed

- `npm run check` now includes `npm run lint:eslint` as a final step.
- TestGen fence regex expanded to match any language identifier (`ts`, `jsx`, `tsx`, etc.), not just `typescript`/`javascript`/`python`.
- `contextBudgetChars` added to `ReviewConfig` and `DEFAULT_CONFIG` (4000); hardcoded constant removed.

### Tests

- 276 unit tests across 35 test files (up from 264 at v1.0.1).
- 7 new markdown formatter tests (emoji/no-emoji mode).
- 5 new cosine similarity tests (`src/core/embedder.ts`).

---

## [1.0.0] — 2026-06-24

### Added

- **`--profile` flag**: named agent subsets — `fast` (3 agents), `full` (15 agents), `change-review` (8 agents), `ui`, `migration`, `security`. `--agents` overrides `--profile`.
- **`--context memory-bank`**: loads per-agent project context from `memory-bank/` files before each agent runs. Budget-bounded at 4000 chars per agent by default.
- **`--format sarif`**: SARIF 2.1.0 output for upload to GitHub Code Scanning.
- **`--format github-annotations`**: GitHub Actions workflow annotation output (`::error`/`::warning`/`::notice` per finding).
- **Policy layer** (`agentPolicy` config): per-agent include/exclude glob path filtering. Policy footer added to JSON and markdown output.
- **Extended Finding schema**: `domain`, `evidence`, `impact`, `recommendation`, `blocking`, `source`, `lineEnd` fields. `suggestion` kept as deprecated alias.
- All 15 specialist agent system prompts updated to emit new schema fields.
- `tests/helpers/requireOllama.ts`: visible error box with solution steps when Ollama or model is unavailable.
- Unit tests for all 16 specialist agents (10 previously untested core agents now covered).
- `src/core/contextLoader.ts`: per-agent memory-bank file routing with budget enforcement.
- `src/core/policyFilter.ts`: glob-based agent path filtering (no external dependency).
- `src/core/profiles.ts`: PROFILES map + `resolveProfile()`.
- `npm run check` script: single command runs tests + typecheck + build + format:check.

### Changed

- **testgen is now opt-in**: removed from `DEFAULT_CONFIG.agents`. Enable with `--suggest-tests` (report only) or `--write-tests` (writes files).
- Anthropic provider removed — ACR is Ollama-only. `provider` type narrowed to `'ollama'`.
- Removed dead config fields: `anthropicModel`, `contextLines`.
- MCP server version now reads from `package.json` at runtime (was hardcoded `'0.6.0'`).
- Shell injection fix: `execSync` with string interpolation replaced by `spawnSync` with array args.
- Calibration CI: `continue-on-error: true` + `timeout-minutes: 10` — releases not blocked when runner is offline.

### Removed

- `@anthropic-ai/sdk` from `optionalDependencies` — Anthropic provider was never implemented.

### Tests

- 255 unit tests across 34 test files (up from 112 at v0.8.0).
- 16/16 calibration PASS.

---

## [0.9.4] — 2026-06-19

### Added

- `--parallel` flag: runs specialist agents via `Promise.allSettled` for faster review.
- Two-phase `AgentProgressEvent`: `start` and `end` events with findings and elapsed time.

### Tests

- 120 unit tests (up from 117).

---

## [0.9.0–0.9.3] — 2026-06-18 to 2026-06-19

### Added

- `--fail-fast` flag: stops swarm on first finding at or above `--fail-on` threshold.
- `earlyExit` field on `ReviewResult`.
- stderr progress renderer with per-agent start/end events.

### Fixed

- Calibration prompt tuning: design (SOLID principle naming), complexity (concise recommendations).
- Balanced-bracket JSON parser fix in `base.ts`.

### Tests

- 117 unit tests.

## [0.8.0] — 2026-06-15

### Added

- **ErrorHandlingAgent**: flags swallowed exceptions, ignored Promise rejections, sentinel-value failure returns, and error paths that should propagate instead of logging-and-continuing.
- **ObservabilityAgent**: flags new code paths (branches, error cases, significant state changes, API entry points) that lack log output. Infers logging library from diff context.
- **MigrationSafetyAgent**: flags NOT NULL columns without a DEFAULT, DROP without IF EXISTS, missing FK indexes, and missing down migrations. Automatically skipped when the diff contains no migration files.
- **SecretsAgent**: detects hardcoded API keys, passwords, private keys, and connection strings in source code. Pure-LLM analysis.
- **ComplexityAgent**: flags high cyclomatic complexity and deep nesting. Uses `lizard` when installed for precise metrics; falls back to LLM estimation.
- `src/core/shell.ts` — shared `runTool()` utility for shelling out to optional external tools (`lizard`, `gitleaks`, etc.); returns `null` on ENOENT so agents degrade gracefully.
- Conditional `MigrationSafetyAgent` exclusion in `SwarmRunner`: agent is removed from the run list when `hasMigrationFiles(diff)` returns false, avoiding false positives on non-migration diffs.
- 5 new calibration fixtures covering each new agent domain.
- `preferredSecretsScanner` config field (`"gitleaks"` | `"trufflehog"` | `"none"`).
- `complexityThreshold` config field (default: `10`) — cyclomatic complexity cutoff for ComplexityAgent.

### Changed

- Default agent list extended from 11 to **16 agents** (added `error-handling`, `observability`, `migration-safety`, `secrets`, `complexity`).
- README updated: new agents table rows, optional dependencies section (gitleaks/lizard), new config field documentation.

### Tests

- 112 unit tests (up from 80): added 5 new agent test suites (5 tests each) and 6 migration-safety pattern tests.

## [0.7.0] — 2026-06-13

### Added

- **Configurable retry logic**: `withRetryTimeout` wrapper in `SwarmRunner` retries transient agent failures before skipping.
- `retryAttempts` config field (default: `2`) and `--retry-attempts` CLI flag.
- `retryDelayMs` config field (default: `2000`) and `--retry-delay` CLI flag.

### Tests

- 80 unit tests (up from 77): added 3 retry behaviour tests to runner suite.

## [0.6.0] — 2026-06-12

### Added

- **MCP server** (`ai-review-mcp` binary): exposes a `review_diff` tool over stdio MCP transport, compatible with Cursor and any MCP-aware client.
- A+C hybrid output format: agent findings as structured JSON + markdown summary in a single MCP response.
- `.cursor/mcp.json` shipped in the repo for zero-config Cursor integration.
- 15 new MCP unit tests covering the formatter and tool handler.

### Changed

- MCP server runs 15 agents (all except `testgen` — generated test files are CLI-only).
- `package.json` `bin` field now exports both `ai-review-agent` and `ai-review-mcp`.

### Tests

- 77 unit tests (up from 62): added mcp/formatter (8) and mcp/tool (7) suites.

## [0.5.0] — 2026-06-11

### Added

- **VS Code / Cursor extension** (`vscode-extension/` subfolder): subprocess architecture shells out to `ai-review-agent --format json`, parses `Finding[]`, and surfaces results via `DiagnosticCollection` (squiggles + Problems panel) and an OutputChannel markdown report.
- Command palette entry: `AI Review: Review Staged Changes`.
- `ai-review-agent` npm package bundled inside the `.vsix` — zero global install required.
- Packages to `ai-review-agent-0.5.0.vsix` (~138 KB).

### Notes

- VS Code Marketplace listing is deferred; install via `code --install-extension ai-review-agent-0.5.0.vsix`.

## [0.4.0] — 2026-06-11

### Changed

- `confidence` field added to the system prompt of all 10 specialist agents, instructing each to self-report a 0–100 confidence value per finding.
- `calibrate.ts` rewritten to cover all 11 agents (10 specialists + TestGenAgent). Previously covered only the original 9.
- Added `breaking-change.diff` and `license.diff` calibration fixtures.

## [0.3.0] — 2026-06-10

### Added

- **npm distribution**: package published to npm as `ai-review-agent` (original name `ai-review` was taken).
- Tag-triggered release workflow (`.github/workflows/release.yml`): publishes to npm on `v*` tags via `NPM_TOKEN` secret.
- Node.js upgraded to 24 in the release workflow.

### Changed

- Package renamed from `ai-review` to `ai-review-agent` in `package.json`.

## [0.2.0] — 2026-06-06

### Added

- **BreakingChangeAgent**: detects removed exports, changed function signatures, renamed public APIs, and incompatible return type changes. Reports as High severity.
- **LicenseComplianceAgent**: detects newly-added dependencies with GPL, AGPL, SSPL, Commons Clause, EUPL, or CDDL-1.0 licenses incompatible with commercial use; LGPL flagged at medium severity when dynamically linked. Reports as High severity.
- **Prompt injection sanitizer**: scans added lines in the diff for LLM-manipulating patterns (SYSTEM: directives, instruction overrides, role-play directives, long base64 payloads) and redacts them before agents run. Enabled by default; disable with `--no-sanitize`.
- **Confidence scoring**: `confidence` (0–100) field added to the Finding schema. Agents self-report confidence; defaults to 70. Shown in markdown reports.
- **Calibration CI** (`.github/workflows/calibrate.yml`): runs `npm run calibrate` weekly (Monday 06:00 UTC) and on releases on a self-hosted runner; skips gracefully when Ollama is unavailable.

### Changed

- **CLI flags consolidated**: `--path` renamed to `--dir`; `--max-diff-lines` renamed to `--max-lines`; `--ignore-path` renamed to `--ignore`. The implicit `review` subcommand has been removed — all flags are now top-level on the `ai-review` command.
- **Hallucination cross-check** is now confidence-aware: solo Critical + confidence ≥ 60 keeps its severity (previously always downgraded to Medium); solo Critical + confidence < 60 downgrades to High (not Medium). Solo High still downgrades to Medium.
- Default agent list extended from 9 to **11 agents** (added `breaking-change` and `license`).
- Version bumped to **0.2.0**.

### Tests

- 62 unit tests (up from 37): added sanitizer (9), BreakingChangeAgent (5), LicenseComplianceAgent (5), confidence (6) suites.

## [0.1.1] — 2026-06-06

### Added

- Guardrail G1: hallucination cross-check — Critical/High requires ≥2 agents at same file±5 lines
- Guardrail G2: diff size guard — `--max-diff-lines` flag (now `--max-lines`)
- Guardrail G3: finding deduplication merge — `corroboratingAgents` field on Finding schema
- Guardrail G4: per-agent timeouts — `--timeout` CLI flag
- Guardrail G5: severity gating — `--fail-on` flag
- Guardrail G6: path exclusions — `.aiignore` + `--ignore-path` flag

## [0.1.0] — 2026-06-06

### Added

- Initial release: 9-agent swarm (SecurityAgent, PerformanceAgent, CorrectnessAgent, DesignAgent, DependenciesAgent, AdversarialAgent, IntegrationScoutAgent, CoverageAnalystAgent, TestGenAgent) + OrchestratorAgent
- CLI (`ai-review`) with Commander
- GitHub Actions workflow for PR review
- Claude Code slash command `/ai-review`
- Calibration suite with 9 fixture diffs
- E2E integration test against live Ollama
