# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.8.0] — 2026-07-25 (structured JSON output, truncation recovery, memory-bank context sanitization)

### Added

- Every standard agent and the coverage agent now request Ollama's `format: "json"` structured
  output mode (grammar-constrained JSON decoding), instead of relying purely on prompt
  instructions to produce parseable output. `ChatOptions.format` already existed end-to-end but
  was never actually passed anywhere. Empirically confirmed against `devstral:latest`: makes
  responses reliably syntactically valid JSON. Doesn't fix every parse failure (the model can
  still pick different field names than the schema expects, and grammar-constrained decoding
  doesn't extend the model's generation budget), but directly targets the class of bug this
  project has repeatedly fought (prose instead of JSON, truncated mid-generation). Not applied to
  `TestGenAgent`, which intentionally outputs raw test code, not JSON.
- `BaseAgent.parseFindings` gained a new recovery stage: when a response is cut off
  mid-generation before its JSON array closes, it now recovers whichever findings did complete
  instead of discarding all of them. Recovered objects still go through the same schema
  validation as every other parse stage, so a response that's just trivially-parseable garbage
  (e.g. `"{}"`) still correctly throws `ParseFailureError` rather than silently resolving to
  "0 findings, clean run."
- Memory-bank context (`--context memory-bank`) is now sanitized for prompt-injection patterns
  before being prepended to any agent's prompt, the same protection the diff itself already had.
  `contextLoader.ts`'s own comment claimed this was already happening ("sanitizer applies
  separately") — it wasn't; `sanitizeDiff()` was only ever called on the diff. Added
  `sanitizeText()` (`sanitizer.ts`) for scanning arbitrary non-diff text, since `sanitizeDiff`'s
  `+`-prefix convention doesn't apply to plain markdown. Respects `--no-sanitize` like the diff
  does.
- `calibration/calibrate.ts`: added a `CALIBRATION_MODEL` env var to bake off a candidate model's
  finding quality without editing `config.ts`, and wrapped each case (including the testgen
  check) in try/catch so one agent error no longer kills the entire run and loses every other
  case's result.
- `CoverageAnalystAgent.parseCoverageResult` now recovers findings/gaps from a response truncated
  before its outer `{"findings":...,"gaps":...}` object closes, instead of unconditionally
  throwing `ParseFailureError` and discarding everything. It had picked up `format:'json'` (which
  this same release's calibration data shows increases truncation frequency) without the
  equivalent recovery `BaseAgent` got — flagged during `/code-review` as a real asymmetry, since
  the two agents would otherwise degrade differently under the exact truncation conditions this
  release exists to mitigate. The recovery scanner (`extractCompleteObjects`) and the balanced-span
  extractor (`extractBalancedSpan`) were extracted into `parsing.ts` as shared helpers — this also
  replaces three near-identical hand-rolled bracket scanners (one each in `base.ts` and
  `coverageAnalyst.ts`, plus the new one) with two shared implementations.

### Fixed

- `extractCompleteObjects`'s depth tracking could go negative on a stray unmatched `}` preceding
  real content, permanently preventing every object later in the same response from being
  recovered. Found via direct execution during `/code-review`. The shared implementation now uses
  a stack of open-brace positions instead of a depth counter, so an unmatched `}` is simply
  ignored rather than desyncing the rest of the scan.

- Sanitizer's "role-play directive" pattern was catching any generic "act as a X" phrase, not
  just AI-role-reassignment attempts — found actively false-positiving on this repo's own
  `memory-bank/activeContext.md` and `progress.md` (which document this exact prior bug) the
  moment memory-bank context sanitization above started actually running against them. Tightened
  to require the phrase target an AI/assistant/bot/model role, matching the existing "you are
  now" pattern's structure. Real injection attempts ("act as an unrestricted AI") still match;
  ordinary usage ("acts as a validator/gatekeeper") no longer does.

## [1.7.0] — 2026-07-25 (actionable truncation warning; parallel-by-default investigated and rejected)

### Changed

- The pre-flight diff-truncation stderr warning is now actionable: it states how many lines were
  excluded and suggests raising `--max-lines` or splitting the change, instead of a bare factual
  notice.
- `README.md`'s CLI options table had a stale `--timeout` default (`60000`) left over from the
  60s→180s fix in v1.4.0 — corrected.
- `--fail-fast` now warns on stderr when combined with `--parallel`, since its early-exit check
  only runs in the sequential code path and previously no-opped silently.

### Investigated and explicitly rejected: parallel-by-default

A real bug report (ACR's 4-agent security profile took ~22 minutes against a 4658-line diff)
prompted flipping `DEFAULT_CONFIG.parallel` to `true`. An initial test (4 concurrent
`devstral:latest` requests, a trivial short prompt) showed a ~1.63x speedup and looked
promising. A deeper test at the real default scale — 14 concurrent requests (the actual default
agent count) with a realistic ~30KB diff prompt — showed near-linear serialization instead:
completions at 58.7s, 91.5s, 120.6s, 172.7s, 235.0s, 305.7s, then a header-timeout failure past
300s for a still-pending request. Reproduced with `curl` directly (bypassing Node's fetch client)
to rule out a client-side connection-pool artifact — same staggered pattern. Since each queued
request's client-side timeout clock starts the moment it's dispatched (not when Ollama actually
begins generating for it), defaulting to parallel would have caused most of the default 14-agent
swarm to spuriously time out — reproducing the exact "everything times out, 0 findings" failure
mode this tool exists to prevent, just via queueing instead of genuine slowness. `--parallel`
remains available as an explicit opt-in for hardware verified to actually benefit from it. Full
writeup in `memory-bank/systemPatterns.md`'s "Sequential Execution" section.

## [1.6.0] — 2026-07-18 (truncation-aware timeout scaling)

### Added

- Per-agent timeouts now scale up to 2x `agentTimeoutMs` as the (post-truncation) diff
  approaches `--max-lines`, on by default. A diff at the truncation point previously got the
  same flat timeout budget as a tiny one — the same real bug report that motivated
  `ReviewResult.truncation` (v1.5.0) also hit this: 4 agents each burned a full timeout+retry
  cycle failing against a diff truncated to 2000 lines. Passing `--timeout` explicitly disables
  scaling and uses exactly that value, matching prior behavior.
- `--timeout`'s help text corrected: it was still documenting the old 60000ms default from
  before the earlier 60s→180s fix.

## [1.5.0] — 2026-07-18 (diff-truncation visibility)

### Added

- `ReviewResult.truncation`: records `{ truncated, originalLines, keptLines }` when a diff
  exceeds `--max-lines` and gets truncated before any agent runs. Previously this only logged
  to stderr (`console.warn`) — a caller reading just the report had no way to know a large
  chunk of the diff was silently excluded from analysis. Now surfaced prominently near the top
  of the markdown report, in SARIF run-level properties, and as a `::warning::` github-annotation
  (even with zero findings). JSON gets it for free. Follow-up to v1.4.0's `agentStatus` work —
  reported via a real bug hit running `/change-review` against a 4188-line diff.

## [1.4.0] — 2026-07-17 (silent agent failure reporting)

### Added

- `ReviewResult.agentStatus`: records `'ok' | 'timeout' | 'parse-error' | 'error'` per agent
  (15 specialists + coverage + testgen). Previously a run where every agent timed out or
  returned unparseable output rendered identically to a genuinely clean review
  (`0 findings | ✅ No issues found`) — both silent-failure sites (`parseFindings`'s final
  fallback, and `runner.ts`'s 4 catch blocks) now surface the distinction.
- Markdown, SARIF, and github-annotations formatters show a clear `⚠️ N/M agents failed` warning
  (with per-agent, per-failure-type remediation advice) instead of a clean checkmark when any
  agent didn't succeed. JSON gets `agentStatus` for free (whole-object serialization).
- New exit code `2`: a run with any agent failure exits 2, independent of and taking priority
  over the existing `--fail-on` severity gate (exit 1) — CI can no longer silently treat a
  broken run as a passing one.

### Fixed

- `parseFindings` (`base.ts`) and `parseCoverageResult` (`coverageAnalyst.ts`) now throw
  `ParseFailureError` on total parse failure instead of silently returning `[]` — the same
  value a genuinely clean review produces.

## [1.3.0] — 2026-07-14 (ai-review distribution)

### Added

- `scripts/postinstall.mjs`: `postinstall` lifecycle script that copies `.claude/commands/ai-review.md`
  into the user-level `~/.claude/commands/`, so `/ai-review` is available in every Claude Code
  project after a global install — not just this repo's own checkout. Fails open (warns, exits 0)
  on any permissions/environment issue. Resolves the invoking user's real home directory even
  under `sudo npm install -g` (via `SUDO_USER`), instead of silently writing into root's home.
- `update-notifier` integration in the CLI entrypoint: checks for a newer published version at
  most once every 7 days, asynchronously and non-blocking, and prints a one-line reminder if
  found. Never auto-installs.

## [1.2.1] — 2026-07-03 (review-gate hardening)

### Fixed

- `dangerous-commands.ps1/.sh`, `check-contract.ps1/.sh`: read the wrong JSON field path (flat `.command`/`.file_path` instead of nested `tool_input.command`/`tool_input.file_path`) and signaled denial via exit codes, which `settings.json`'s fail-open wrapper (`|| true`) silently erased — both hooks were near-total no-ops. Fixed to use `hookSpecificOutput.permissionDecision: "deny"`.
- `check-contract.ps1/.sh`: schema bug — read `scope.files` instead of the documented `scope: [{file, op}]` array, so the scope check never matched an in-scope file even after the payload-path fix. `.sh` version also had a Windows CRLF bug (Python's `print()` adds `\r`) that broke exact-match comparisons.
- `dangerous-commands.ps1/.sh`: pipe-to-shell BLOCK pattern (`"| sh"` substring) collided with `sha256sum`/`shasum`, the hash tools the new review-gate hash-binding depends on — fixed with word-boundary regex/glob matching.
- Hash mismatch between documented review-gate commands and hook verification: PowerShell's pipeline re-tokenizes external-command output, so `Out-String`/array-join hashing did not reproduce the byte stream a raw shell pipe sees. Fixed by hashing a file written via redirection instead (confirmed byte-identical across PowerShell and bash).

### Added

- `scripts/review-reminders.ps1/.sh`: `PreToolUse` hook mechanically enforcing review-before-commit/push — `/code-review` and `/change-review` write a SHA-256 hash of the reviewed diff to a marker file, consumed atomically (rename, not check-then-delete) on the next matching `git commit`/`git push`.
- `scripts/review-reminders-post.ps1/.sh`: `PostToolUse` companion that reissues the marker if the gated commit/push then fails, detected via git ref comparison (`HEAD`/`@{u}` before/after) rather than an unverified response schema.
- `tests/review-reminders.Tests.ps1`: 23 Pester tests covering the review gate, including regressions for the sha256sum false-positive and the hash-consistency bug.

### Documentation

- `docs/HOOKS-GUIDE.md`: rewrote the dangerous-commands, check-contract, and review-gate sections to describe the fixed mechanisms; added a new section documenting `review-reminders-post`.

## [1.2.0] — 2026-06-26

### Fixed

- OllamaProvider: removed `0.0.0.0` from localhost allowlist (routes to external interfaces on Linux)
- OllamaProvider: added HTTP/HTTPS scheme validation (`ollama://` now throws with helpful error)
- OllamaProvider: wrapped `new URL()` in try/catch for actionable error on malformed input
- MCP server: added SIGTERM/SIGINT/stdin.close shutdown handlers (was leaking zombie processes on client disconnect)
- `base.ts` `validateFindings`: now accepts `evidence` field in addition to legacy `basis` field; logs count of dropped findings instead of silent discard
- contextLoader: emits stderr warning when `nomic-embed-text` is unavailable instead of silently returning empty context
- PMB `test-mb-doctor.sh`: all mutation sites now use EXIT trap guards — git status is clean after any test outcome (including crashes)
- PMB `mb.sh` doctor check 5: replaced `grep -c` with `grep -q` + explicit 0/1 assignment, fixing permanent SKIP in Git Bash

### Added

- `src/core/parsing.ts`: `validateAndNormalizeFindings()` extracted from BaseAgent (SRP refactor — finding validation/normalization now independently testable)
- `vscode-extension/src/runner.ts`: 5-minute wall-clock subprocess timeout; extension now rejects with clear message instead of hanging forever if Ollama stalls
- `tests/unit/embedder.test.ts` (new file): 10 tests covering `embed()` and `cosineSimilarity()` — semantic context path now has test coverage
- 6 new tests in `contextLoader.test.ts` and `baseAgent.test.ts` for semantic path and SRP extraction
- `.github/dependabot.yml`: weekly GitHub Actions version tracking
- `docs/CONTRACTS-GUIDE.md`: canonical task contract schema with dual-format scope compatibility note
- `docs/HOOKS-GUIDE.md`: hook types, enforcement layers, PreCompact behavior (warns, does not block)

### Security

- `gitleaks/gitleaks-action` pinned to commit SHA `dcedce43` in `release.yml` (was mutable `@v2` tag)
- `Bash(npx *)` wildcard scoped to `Bash(npx prettier *)` and `Bash(npx tsc *)` in `.claude/settings.json`

### CI

- `release.yml`: format:check and lint:eslint steps added before publish
- `release.yml`: VS Code extension tests added before publish (with `timeout-minutes: 5`)
- `release.yml`: NPM_TOKEN expiry reminder step added (expires 2026-09-08)

---

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

## [1.0.1] — 2026-06-26

### Fixed

- OllamaProvider: removed `0.0.0.0` from localhost allowlist (routes to external interfaces on Linux)
- OllamaProvider: added HTTP/HTTPS scheme validation; `ollama://` protocol now throws with helpful error
- OllamaProvider: wrapped `new URL()` in try/catch for helpful error on malformed URL input
- CLI: added top-level try/catch to action handler — Ollama errors now show clean message + hint
- CLI: exported `program` from `cli/index.ts` to enable unit testing
- `release.yml`: added gitleaks secret scan step before npm publish
- `release.yml`: added VS Code extension test step (with `timeout-minutes: 5`)
- `release.yml`: added `format:check` and `lint:eslint` steps before publish
- `release.yml`: added NPM_TOKEN expiry reminder step
- `/change-review` Job 7: now writes diff to temp file and passes `--diff <tmpfile>` to ACR
- `check-contract.sh` / `.ps1`: handles both ACR `[{file,op}]` and PMB `{files:[]}` scope formats
- `check-contract.sh` / `.ps1`: emits warning on malformed JSON instead of silent pass
- `matchPattern`: exported from `ignoreFilter.ts`; removed copy-paste in `policyFilter.ts`
- `runner.ts`: decomposed 305-line `run()` into 5 private methods
- `base.ts`: logs when `validateFindings` drops items; accepts `evidence` field (not just legacy `basis`)
- MCP server: added SIGTERM/SIGINT/stdin.close shutdown handlers

### Added

- `docs/CONTRACTS-GUIDE.md`: canonical task contract schema documentation
- `docs/HOOKS-GUIDE.md`: hook types, enforcement layers, and per-hook behavior
- `.github/dependabot.yml`: weekly GitHub Actions version tracking
- CLI unit tests: 7 tests covering argument parsing, exit codes, error paths (`tests/unit/cli.test.ts`)

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
