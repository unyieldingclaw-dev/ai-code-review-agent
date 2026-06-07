# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
