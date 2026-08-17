# AI Code Review Agent

A local, 15-agent AI code review tool powered by [Ollama](https://ollama.com). Runs against any git diff and produces structured findings across security, correctness, performance, design, dependencies, breaking changes, license compliance, adversarial patterns, integration risks, test coverage, test generation, error handling, observability, database migration safety, secrets detection, and code complexity — no cloud API calls required.

## Overview

```
git diff → sanitizer
  → CoverageAnalystAgent + 14 specialist agents
  → OrchestratorAgent → findings
```

> **testgen is opt-in.** Pass `--suggest-tests` to include generated test suggestions in the report, or `--write-tests` to write them to disk. Default runs never write files.

Each specialist agent receives only the (sanitized) diff and its own system prompt, so agents don't bias each other. The orchestrator deduplicates, cross-references, applies confidence-aware severity gating, and caps the final finding set.

### Agents

| Agent                  | Domain                                                                                                                                   |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| SecurityAgent          | Injection, auth flaws, secrets, unsafe deserialization                                                                                   |
| PerformanceAgent       | Hot paths, N+1 queries, memory pressure                                                                                                  |
| CorrectnessAgent       | Logic bugs, null dereferences, off-by-one errors                                                                                         |
| DesignAgent            | SOLID violations, coupling, abstraction leaks                                                                                            |
| DependenciesAgent      | Outdated/vulnerable packages, supply chain risks                                                                                         |
| BreakingChangeAgent    | Removed exports, changed signatures, renamed public APIs                                                                                 |
| LicenseComplianceAgent | GPL/AGPL/SSPL/Commons Clause/EUPL/CDDL-1.0 dependencies; LGPL (dynamic linking flagged at medium severity)                               |
| AdversarialAgent       | Adversarial inputs — null/empty/boundary values, concurrent access                                                                       |
| IntegrationScoutAgent  | Integration boundaries lacking tests (new HTTP calls, DB writes, queues, WebSocket connections)                                          |
| CoverageAnalystAgent   | Test coverage gaps, untested branches                                                                                                    |
| TestGenAgent           | Generates test stubs for coverage gaps (**opt-in** — use `--suggest-tests` or `--write-tests`)                                           |
| ErrorHandlingAgent     | Swallowed exceptions, ignored Promise rejections, sentinel-value failure returns, error paths that should propagate                      |
| ObservabilityAgent     | New code paths (branches, state changes, API entry points) lacking log output                                                            |
| MigrationSafetyAgent   | NOT NULL without DEFAULT, DROP without IF EXISTS, missing FK indexes, missing down migrations (skipped when diff has no migration files) |
| SecretsAgent           | Hardcoded API keys, passwords, private keys, connection strings in source code                                                           |
| ComplexityAgent        | High cyclomatic complexity, deep nesting, functions exceeding threshold (uses `lizard` if installed, falls back to LLM)                  |

> **Note:** `OrchestratorAgent` is internal infrastructure — it deduplicates findings, cross-references severity, applies confidence scoring, and caps the final set. It cannot be selected via `--agents` and does not appear in agent output.

## Requirements

- **Node.js** v18+ (v24 recommended)
- **Ollama** running locally at `http://localhost:11434`
- **devstral:latest** model pulled in Ollama (`ollama pull devstral:latest`)
- Windows 11, macOS, or Linux

## Installation

```bash
npm install -g ai-review-agent
```

Pull the model if you haven't already:

```bash
# devstral:latest is approximately 14 GB — ensure at least 15 GB free disk space before proceeding
ollama pull devstral:latest
```

## Quick Start

```bash
cd your-project
git add -p                                       # stage the changes you want reviewed
ai-review-agent                                  # run the full 15-agent swarm
ai-review-agent --profile fast                   # security + correctness + secrets only (~3 min)
ai-review-agent --profile change-review          # 8-agent change package review
ai-review-agent --profile security               # security-focused subset
ai-review-agent --agents security                # single-agent fast pass
ai-review-agent --format json                    # machine-readable output
ai-review-agent --context memory-bank            # load per-agent project context from memory-bank/
```

<details>
<summary>Install from source (development)</summary>

```bash
git clone https://github.com/unyieldingclaw-dev/ai-code-review-agent.git
cd ai-code-review-agent
npm install
npm run build
npm link
```

</details>

## Setup Scripts

Double-click to set up without opening a terminal:

| Script              | Platform | Who          |
| ------------------- | -------- | ------------ |
| `setup.bat`         | Windows  | End-users    |
| `setup.command`     | macOS    | End-users    |
| `dev-setup.bat`     | Windows  | Contributors |
| `dev-setup.command` | macOS    | Contributors |

**End-user scripts** (`setup.*`) check Node.js, verify Ollama is running, pull `devstral:latest`, install `ai-review-agent` globally, and run a smoke test.

**Contributor scripts** (`dev-setup.*`) check Node.js, run `npm install` + `npm run build` + `npm link`, and confirm the local build is wired up correctly.

> **macOS note:** If macOS blocks `setup.command` or `dev-setup.command` on first run, right-click → Open to bypass Gatekeeper.

## Cursor Integration (MCP)

After installing globally, add this to `.cursor/mcp.json` in your project root (or copy from the `.cursor/mcp.json` already in this repo):

```json
{
  "mcpServers": {
    "ai-review": {
      "command": "ai-review-mcp",
      "args": []
    }
  }
}
```

Restart Cursor. The `review_diff` tool will appear in **Settings → MCP**. In Cursor's chat panel, ask:

> Review my staged changes

or invoke directly:

> @ai-review review_diff

Requires Ollama running locally with `devstral:latest` pulled. The tool runs 15 agents (all except `testgen`). For generated test files, use the CLI (`ai-review-agent`).

By default `review_diff` accepts a `repo_path` pointing anywhere the server process can read.
To restrict it to specific project roots, set `AI_REVIEW_ALLOWED_ROOTS` to a comma-separated
list of absolute paths in the server's `env`:

```json
{
  "mcpServers": {
    "ai-review": {
      "command": "ai-review-mcp",
      "args": [],
      "env": {
        "AI_REVIEW_ALLOWED_ROOTS": "/Users/you/projects/app-one,/Users/you/projects/app-two"
      }
    }
  }
}
```

Unset (the default), any `repo_path` is allowed — unrestricted, matching prior behavior.

## `/ai-review` in Claude Code

Installing globally (`npm install -g ai-review-agent`, or via `setup.bat`/`setup.command`)
automatically installs the `/ai-review` slash command for **every** Claude Code project, not just
this repo — a `postinstall` script copies it to `~/.claude/commands/ai-review.md`. Re-running
`npm install -g ai-review-agent@latest` refreshes it automatically; there's nothing to copy by
hand and nothing to keep in sync manually.

Every `ai-review-agent` run also checks (at most once every 7 days, asynchronously, never
blocking) whether a newer version is available and prints a one-line reminder if so. It never
auto-installs anything — you decide when to update.

## Usage

### CLI

```bash
# Review staged changes (default)
ai-review-agent

# Review unstaged diff in a specific directory
ai-review-agent --dir /path/to/repo

# Review a saved diff file
ai-review-agent --diff my-changes.diff

# Run specific agents only
ai-review-agent --agents security,correctness,breaking-change,secrets,complexity

# Override model
ai-review-agent --model qwen3:latest

# JSON output (useful for CI)
ai-review-agent --format json --out findings.json

# Limit diff to first 500 lines
ai-review-agent --max-lines 500

# Set per-agent timeout to 120 seconds
ai-review-agent --timeout 120000

# Gate CI only on critical findings
ai-review-agent --fail-on critical

# Never fail CI regardless of findings
ai-review-agent --fail-on never

# Exclude generated files and test fixtures from review
ai-review-agent --ignore "dist/**" --ignore "**/*.snap"

# Skip prompt-injection sanitization (use if sanitizer causes false positives)
ai-review-agent --no-sanitize

# Use semantic context selection (requires nomic-embed-text in Ollama)
ai-review-agent --context memory-bank --context-mode semantic

# Disable emoji for CI/CD pipelines
ai-review-agent --no-emoji --format markdown

# Verify Critical/High findings against their own evidence (requires qwen3:latest in Ollama)
ai-review-agent --verify-evidence

# Full help
ai-review-agent --help
```

**Flag reference:**

| Flag                    | Default         | Description                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--diff <path>`         | —               | Review a saved .diff file                                                                                                                                                                                                                                                                                                                                                        |
| `--dir <path>`          | cwd             | Diff the given directory against HEAD                                                                                                                                                                                                                                                                                                                                            |
| `--model <model>`       | devstral:latest | Override Ollama model                                                                                                                                                                                                                                                                                                                                                            |
| `--profile <name>`      | —               | Run a named agent subset: `fast`, `full`, `change-review`, `ui`, `migration`, `security`                                                                                                                                                                                                                                                                                         |
| `--agents <list>`       | all 15 agents   | Comma-separated agent list (overrides `--profile`)                                                                                                                                                                                                                                                                                                                               |
| `--context <mode>`      | none            | `memory-bank` loads per-agent project context from `memory-bank/`                                                                                                                                                                                                                                                                                                                |
| `--format <fmt>`        | markdown        | `markdown`, `json`, `sarif`, or `github-annotations`                                                                                                                                                                                                                                                                                                                             |
| `--out <path>`          | stdout          | Write report to file                                                                                                                                                                                                                                                                                                                                                             |
| `--max-lines <n>`       | 2000            | Truncate diff before review                                                                                                                                                                                                                                                                                                                                                      |
| `--timeout <ms>`        | 180000          | Per-agent timeout, scaled up to 2x for diffs approaching `--max-lines` unless set explicitly here                                                                                                                                                                                                                                                                                |
| `--retry-attempts <n>`  | 2               | Attempts per agent before skipping                                                                                                                                                                                                                                                                                                                                               |
| `--retry-delay <ms>`    | 2000            | Backoff between retries                                                                                                                                                                                                                                                                                                                                                          |
| `--fail-on <level>`     | high            | Exit 1 when severity ≥ level (`critical\|high\|medium\|any\|never`)                                                                                                                                                                                                                                                                                                              |
| `--fail-fast`           | off             | Stop swarm on first finding at or above `--fail-on` threshold                                                                                                                                                                                                                                                                                                                    |
| `--allow-truncation`    | off             | Exit 0 on a truncated-but-otherwise-clean run instead of exit code 3                                                                                                                                                                                                                                                                                                             |
| `--chunk`               | off             | Instead of truncating an oversized diff, split it into multiple full-coverage passes. Multiplies LLM calls by chunk count -- verify it before enabling on a slow-hardware setup                                                                                                                                                                                                  |
| `--parallel`            | off             | Run specialist agents concurrently. Verify it helps on your hardware first -- Ollama often serializes requests anyway and queued agents can spuriously time out. Disables `--fail-fast` early exit                                                                                                                                                                               |
| `--ignore <glob>`       | —               | Exclude matching files (repeatable)                                                                                                                                                                                                                                                                                                                                              |
| `--no-sanitize`         | —               | Skip prompt injection sanitization — of the diff, and also of memory-bank context when `--context memory-bank` is set. **Security:** disables prompt injection protection. Do not use with untrusted diffs (e.g., reviewing PRs from external contributors). The sanitizer warning is written to stderr — it will be silently discarded if stderr is redirected (`2>/dev/null`). |
| `--suggest-tests`       | —               | Enable testgen; include suggestions in report (no files written)                                                                                                                                                                                                                                                                                                                 |
| `--write-tests`         | —               | Enable testgen and write generated test files to `testOutputDir`                                                                                                                                                                                                                                                                                                                 |
| `--context-budget <n>`  | 4000            | Max chars of memory-bank context per agent                                                                                                                                                                                                                                                                                                                                       |
| `--context-mode <mode>` | static          | `static` (hardcoded routing) or `semantic` (nomic-embed-text ranking)                                                                                                                                                                                                                                                                                                            |
| `--no-emoji`            | off             | Use text labels instead of emoji (for CI without UTF-8 support)                                                                                                                                                                                                                                                                                                                  |
| `--verify-evidence`     | off             | Verify Critical/High findings against their own cited evidence using a separate model (`qwen3:latest` by default). Report-only in this version — flags possibly-unsupported findings in the report without dropping them. Adds one LLM call per checked finding                                                                                                                  |

Exit codes, in priority order: `2` if any agent failed (timeout/parse-error/error); else `1` if any
finding meets the `--fail-on` threshold (default: `high`); else `3` if the diff was truncated
(unless `--allow-truncation` is passed); else `0`. A genuine blocker finding always wins over "the
run was also truncated" -- exit `3` only appears on an otherwise-clean run.

### Claude Code slash command

After installing, use `/ai-review` inside any Claude Code session to run the 15-agent swarm against your current diff and stream findings into the conversation.

### GitHub Actions

See `.github/workflows/review.yml` for the full PR review workflow.

A weekly calibration workflow (`.github/workflows/calibrate.yml`) runs `npm run calibrate` on a self-hosted runner and skips gracefully when Ollama is unavailable.

## Configuration

Create `ai-review.config.json` in your project root to override defaults:

```json
{
  "model": "devstral:latest",
  "ollamaUrl": "http://localhost:11434",
  "maxFindings": 15,
  "agents": [
    "security",
    "performance",
    "correctness",
    "design",
    "dependencies",
    "coverage",
    "adversarial",
    "integration",
    "breaking-change",
    "license",
    "error-handling",
    "observability",
    "migration-safety",
    "secrets",
    "complexity"
  ],
  "testOutputDir": "./ai-review-tests",
  "maxDiffLines": 2000,
  "agentTimeoutMs": 60000,
  "retryAttempts": 2,
  "retryDelayMs": 2000,
  "sanitize": true,
  "complexityThreshold": 15
}
```

> **Note:** `testgen` is not in the default agent list. Add it explicitly to `agents` if you want suggestions, or use `--suggest-tests` / `--write-tests` at the CLI.

**Config field notes:**

- `complexityThreshold`: Cyclomatic complexity number (CCN) threshold passed to `lizard` (`-C`) when it's installed — functions exceeding it are flagged. If omitted, `lizard`'s own default (`15`) applies. Has no effect when `lizard` isn't installed (the LLM-only fallback path uses its own prompt-described thresholds instead).
- `agentPolicy`: Per-agent include/exclude path rules. An agent runs only when at least one changed file matches its `include` patterns; it is skipped when **all** changed files match its `exclude` patterns. Uses gitignore-style globs. Omitting a rule means the agent always runs.

**`agentPolicy` example** — skip `license` on non-lockfile changes, restrict `migration-safety` to migration paths:

```json
{
  "agentPolicy": {
    "license": {
      "include": ["package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "LICENSE*"]
    },
    "migration-safety": {
      "include": ["**/migrations/**", "**/schema/**", "**/*.sql"]
    },
    "security": {
      "exclude": ["docs/**", "*.md"]
    }
  }
}
```

Policy decisions appear in `--format json` output under `result.policy`. They are also summarized in `--format markdown` output when any agents are skipped.

**Note on defaults:** `security` and `adversarial` exclude `**/*.md` by default (documentation
files were being misread as executable code). `ai-review.config.json`'s config loading does a
shallow merge — if you set your own `agentPolicy` for _any_ agent, it replaces the entire
`agentPolicy` object, including these defaults. Re-specify them in your own config if you want to
keep them:

```json
{
  "agentPolicy": {
    "security": { "exclude": ["**/*.md"] },
    "adversarial": { "exclude": ["**/*.md"] },
    "your-other-agent": { "exclude": ["some/pattern"] }
  }
}
```

**Optional dependencies (enhance specific agents):**

- **[gitleaks](https://github.com/gitleaks/gitleaks)** or **[trufflehog](https://github.com/trufflesecurity/trufflehog)** — improves SecretsAgent accuracy. Falls back to LLM-only if neither is installed.
- **[lizard](https://github.com/terryyin/lizard)** (`pip install lizard`) — provides precise cyclomatic complexity metrics to ComplexityAgent. Falls back to LLM estimation if not installed.

Create `.aiignore` in your repo root to exclude files from every review (gitignore syntax):

```
dist/
build/
*.min.js
**/__snapshots__/
calibration/fixtures/
```

Negation patterns (`!`) are supported — a file matching `!important.log` is kept even if it also matches a preceding exclude pattern:

```
*.log
!important.log
```

## Guardrails

| Guardrail                     | CLI flag                             | Default                                                        |
| ----------------------------- | ------------------------------------ | -------------------------------------------------------------- |
| Diff size limit               | `--max-lines`                        | 2000 lines                                                     |
| Per-agent timeout             | `--timeout`                          | 60 s                                                           |
| Transient failure retry       | `--retry-attempts` / `--retry-delay` | 2 attempts, 2 s backoff                                        |
| Severity gating               | `--fail-on`                          | high                                                           |
| Path exclusions               | `--ignore` / `.aiignore`             | —                                                              |
| Prompt injection sanitization | `--no-sanitize` to disable           | enabled                                                        |
| Hallucination cross-check     | always on                            | Critical/High require corroboration or ≥60% confidence         |
| Finding deduplication         | always on                            | same file:line across agents merged with `corroboratingAgents` |

## Confidence Scoring

Each agent self-reports a `confidence` value (0–100) alongside each finding. The orchestrator uses confidence + corroboration together:

- **Corroborated** finding (≥2 agents at same file±5 lines): kept at original severity
- **Solo Critical + confidence ≥ 60**: kept as Critical
- **Solo Critical + confidence < 60**: downgraded to High
- **Solo High (any confidence)**: downgraded to Medium

Confidence is shown in the markdown report next to each finding.

## Known Limitations

**Absence-claims can be wrong when the missing thing exists outside the diff hunk.** A finding
shaped like "no validation exists," "field can be left empty," or "missing error handling" is
only checking what's visible in the diff hunk it was given — if the actual check (a validator, a
guard, error handling) exists elsewhere in the same file, untouched by the diff, the agent has no
way to see it and can report a false positive. This was investigated directly, not assumed: three
separate mitigations were built and tested against a real reported case (a Flutter password-reset
form where `adversarial` claimed no empty-password validation existed, when a validator was
present a few lines outside the diff hunk) —

1. **Post-hoc re-verification** (send the full file to a second model, ask it to confirm the claim
   against the full file): unreliable (2/5 on synthetic cases, including a dangerous false-clear
   where the verifier confused two different functions) and slow (48–232s per call).
2. **Full-file context at generation time** (give the agent the full file up front): made no
   improvement on the real case — the agent still made the false claim in 3/3 test runs (worse
   than the 1/3 baseline rate), even once explicitly instructed to cross-check absence claims
   against the full file before reporting them. In one run it explicitly quoted the validator it
   was given and still concluded submission wasn't blocked.
3. **Deterministic confidence-capping** (flag absence-shaped findings by keyword and lower their
   reported confidence, no LLM call): rejected before shipping — tested against this project's own
   recent real findings, the keyword match fired on the majority of _unrelated, well-grounded_
   findings (a Critical command-injection finding, IDOR, insecure deserialization), which would
   have done more harm than the problem it targets.

No reliable automated mitigation currently exists for this failure class. Treat findings from
`adversarial` (and any other agent) that claim something is absent/missing with extra skepticism,
and verify manually against the full file before treating one as blocking. See
`docs/superpowers/specs/2026-08-17-absence-claim-investigation.md` for the full investigation.

## Integration Contract (PMB / MB / CI)

When calling ACR from another tool (PMB's `/change-review`, a CI script, or any JSON consumer), use these stable invocation patterns:

```bash
# Full change review with memory-bank context — write to state file
ai-review-agent --profile change-review --context memory-bank --format json \
  --out .memory-bank/state/reviews/latest.json

# Fast gate (no Ollama context overhead)
ai-review-agent --profile fast --context none --format markdown

# Security audit with SARIF upload
ai-review-agent --profile security --format sarif --out ai-review.sarif
```

Every `--format json` response includes a stable envelope:

```json
{
  "schemaVersion": "ai-review-agent/v1",
  "toolVersion": "1.1.0",
  "profile": "change-review",
  "findings": [],
  "summary": { "totalFindings": 0, "bySeverity": {}, "byAgent": {}, "durationMs": 0 },
  "sanitizer": { "enabled": true, "applied": false, "redactedLines": 0, "warnings": [] },
  "policy": { "agentsSkipped": [], "reason": {} },
  "context": { "mode": "memory-bank", "filesLoaded": [], "truncated": false, "estimatedTokens": 0 }
}
```

- `schemaVersion` is bumped on breaking schema changes — parse this to detect incompatible versions.
- `profile` is `null` when `--agents` was used instead of `--profile`.
- `policy` only appears when at least one agent was skipped by policy rules.
- `context` only appears when `--context memory-bank` is active.

## Development

```bash
npm run check                           # full local gate: tests + typecheck + build + format
npm test                                # unit tests only — no Ollama needed (295 passing)
npm run test:extension                  # VS Code extension tests (25 passing)
npm run typecheck                       # 0 TypeScript errors
npm run build                           # compile to dist/
INTEGRATION=1 npm run test:integration  # e2e pipeline — requires Ollama + devstral
npm run calibrate                       # calibration suite — requires Ollama + devstral (~30-45 min)
```
