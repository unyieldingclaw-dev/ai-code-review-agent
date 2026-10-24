---
authority: stable
review-cycle: 30d
retention: permanent
staleness-threshold: 90d
tags:
  - stack/backend
  - stack/frontend
  - env/tools
last-reviewed: 2026-10-23
compaction_generation: 0
source_type: canonical
confidence: high
lineage: []
---

# Technical Context & Stack

**Last Updated**: 2026-08-31

## Development Environment

| Component       | Value                                                                      |
| --------------- | -------------------------------------------------------------------------- |
| OS              | Windows 11 Home 10.0.26200                                                 |
| Shell           | PowerShell (primary), Bash available via Bash tool                         |
| IDE             | Claude Code (CLI + desktop)                                                |
| Git remote      | `main` branch — https://github.com/unyieldingclaw-dev/ai-code-review-agent |
| Package Manager | npm                                                                        |

## Backend Stack

### Core

- **Language**: TypeScript (strict mode)
- **Runtime**: Node.js
- **Build**: `tsc` via `tsconfig.json`
- **Test runner**: Vitest

### LLM Backend

- **Provider**: Ollama (local HTTP, `http://localhost:11434`)
- **Model**: `devstral:latest` (14 GB, installed)
- **Context length**: 32k (set in Ollama settings)
- **Interface**: `LLMProvider` (src/core/llm/provider.ts)
- **Implementation**: `OllamaProvider` (src/core/llm/ollamaProvider.ts)

### Model Choice — measured 2026-08-30, do not re-derive from a single pass

`devstral:latest` stays the default. Three **interleaved** calibration passes per model:

| model              | cases passed | fit             | wall-clock per pass |
| ------------------ | ------------ | --------------- | ------------------- |
| `devstral:latest`  | 22, 24, 24   | 20 GB, 30% GPU  | 666–762 s           |
| `qwen2.5-coder:7b` | 20, 19, 22   | 6.8 GB, 92% GPU | 68–84 s             |

Counts are deliberately recorded without a denominator, because the suite size changes and pinning
one here is the drift this file's "Current State" section exists to avoid. For the live figure read
the `CASES` array in `calibration/calibrate.ts`, or run `npm run calibrate` (target a subset with
`CALIBRATION_CASE=name1,name2`). Both models were measured in the same session, so the comparison
holds regardless. Wall-clock spans a whole calibration pass, not one agent invocation.

**The bands do not overlap at the top, and that is the finding.** A switch to `qwen2.5-coder:7b`
was recommended on **one pass each** and was wrong; three passes reversed it. So
`qwen2.5-coder:7b` is the _fast path_ (`--model`), never the default — its value is making
`--chunk` affordable at roughly 9x the speed, not matching devstral's ceiling. The rule this
established is in `systemPatterns.md`.

**Per-agent timeout ceiling — MEASURED, CLOSED (2026-08-27). Do not raise it, do not re-derive it.**
**Timeouts are not the binding constraint — model fit is**, which is why this sits beside the model
measurement rather than in `activeContext.md` (moved 2026-09-01). The 616 s resemblance stays
_suggestive, not established_ — the original has no source. Still untested: true CPU-only. Full
measurement: [`archive/activeContext-history.md`](archive/activeContext-history.md).

**A CPU-heavy counter-datum (2026-09-01) — recorded, not acted on.** Two `--profile security` runs
through the real CLI (750 and 943 diff lines) had **both LLM agents hit the ceiling**, at 247.5 s
and 264.9 s, while `secrets` finished in 5 s and `dependencies` in 0 s. `ollama ps` showed devstral
at **70%/30% CPU/GPU**. This does **not** overturn the measurement above, which was taken on GPU: it
lands in the CPU-heavy regime that measurement lists as untested, so it fills that gap rather than
reopening a settled one. **Do not raise the ceiling on it** — n=2 in one environment, and the entry
above exists to stop exactly that kind of re-derivation. What it does establish is that the
deterministic agents are unaffected, so ACR keeps useful coverage on CPU even when the LLM agents
never complete.

**The same 70/30 split reproduced in `ai-review` CI three times in a row (2026-09-26).** **n=1
environment transition, not a fix** — the correlation (CPU-heavy → near/over ceiling;
idle-then-reload → comfortably under) matches the 2026-09-01 datum closely enough to be worth
retrying a timed-out `ai-review` job once Ollama is confirmed idle (`ollama ps`) rather than
immediately reaching for `timeout-minutes` or a config change.

### Key Source Files

| File                             | Purpose                                                                     |
| -------------------------------- | --------------------------------------------------------------------------- |
| `src/core/schema.ts`             | All shared types: Finding, Severity, Category                               |
| `src/core/config.ts`             | ReviewConfig + loadConfig() with project override                           |
| `src/core/llm/provider.ts`       | LLMProvider interface                                                       |
| `src/core/llm/ollamaProvider.ts` | Ollama HTTP client + think-tag stripping                                    |
| `src/core/agents/base.ts`        | BaseAgent abstract class + 4-stage JSON parse                               |
| `src/core/parsing.ts`            | `validateAndNormalizeFindings()`, split out of BaseAgent (SRP)              |
| `src/core/contextLoader.ts`      | Memory-bank context; warns on stderr when `nomic-embed-text` is unavailable |
| `vscode-extension/src/runner.ts` | Subprocess driver; 5-minute wall-clock timeout                              |

### Test Files

`tests/unit/` (47 files), `tests/integration/` (1 file, skipped without `INTEGRATION=1`). A table
here once listed five files with per-file counts; it was never updated as the suite grew past it and
is not reproduced — `npm test` prints the real inventory.

### Agent Thinking Config

All agents request `think: true`, but `OllamaProvider.supportsThinking()` only honors it for
models whose name starts with `qwen` or `deepseek-r1` — it's silently a no-op for the actual
configured default (`devstral`), which doesn't support it. Unlike Google-Organizer (which uses
`think: false` unconditionally), the intent is that reasoning depth matters for code review
quality on models that support it.

The _rule_ this supports — never use `think: false` — stays in `systemPatterns.md` under
**Never Do This**.

## Configuration

### Configuration Files

| File                    | Purpose                              |
| ----------------------- | ------------------------------------ |
| `ai-review.config.json` | Project-level review config override |
| `package.json`          | npm scripts, dependencies            |
| `tsconfig.json`         | TypeScript compiler options          |
| `vitest.config.ts`      | Vitest test runner config            |

### Key npm Scripts

```bash
npm test                              # run all unit tests
npm test -- baseAgent                 # run specific test file
npm run typecheck                     # tsc --noEmit
npm run build                         # compile TypeScript
INTEGRATION=1 npm run test:integration  # e2e against live Ollama
npm run calibrate                     # calibration suite (requires Ollama)
```

## Infrastructure

### Services

| Service | Port  | Status                                            |
| ------- | ----- | ------------------------------------------------- |
| Ollama  | 11434 | Must be running for reviews and integration tests |

**`OLLAMA_KEEP_ALIVE=30m` is set persistently in User scope and verified** (2026-08-30) —
`ollama ps` reads ~29 min rather than the ~5 min default. Applying it required restarting the
daemon: Ollama reads the variable at startup, so exporting it in a shell does nothing to a server
already running.

**`ai-review-agent` on PATH is an `npm link` symlink to this working tree, not the registry build.**
Anything concluded about "what consumers get" from the local binary is a statement about
uncommitted local code. To reason about the published package, `npm pack ai-review-agent@X` and
inspect the tarball. This is also why a git worktree is the wrong workspace for a change the PMB
peer will exercise — the symlink points at the main tree, so a worktree build never reaches it.

Treat any version-attributed measurement taken through the linked binary as unattributed until
re-taken.

### PMB integration — `mb upgrade`, PMB-owned files, Job 7 exit codes

Relocated verbatim to [`docs/architecture/pmb-integration.md`](../docs/architecture/pmb-integration.md)
(2026-10-23): what `mb upgrade` overwrites and how to run it, the PMB-owned defects that cannot be
fixed here, and PMB `/change-review` Job 7's exit-code contract with ACR. **Read it before running
`mb upgrade`, editing a PMB-owned file (hook scripts, `.claude/settings.json`, `.cursor/rules/`,
`standards/`), changing what any ACR exit code means, or changing the handoff threshold anywhere
(including `memory-bank/README.md`).** Narrative and measurements moved out of this file are in
[`archive/techContext-history.md`](archive/techContext-history.md).

### Sharing this machine with the PMB peer session

The Personal-Memory-Bank session runs on this machine and contends for the same two resources: the
Ollama daemon, and the **self-hosted CI runner** (which is that same Ollama). Opening a PR takes the
server via CI, so it is not a local-only act.

- **Announce before restarting Ollama or opening a PR.** Both take the server.
- **`ollama ps` cannot tell you whether a multi-pass run is in flight.** A decaying `UNTIL` means no
  inference _right now_, not "no run active" — a chunked run between chunks is indistinguishable
  from idle. The server cannot see its own clients between requests; ask the consumer side. Acting
  on that reading once killed the peer's 979 s run mid-chunk.
- **A peer session's name rotates without the session ending** (`7b` → `1d` → `c9` → `8b`). Absence
  under a known name is not evidence it ended — read the current name from `ListAgents`.
- **An all-markdown PR takes no server**: `review.yml` `paths-ignore`s `**/*.md`, so no `ai-review`
  job is queued. A memory-bank PR therefore needs no announcement.
- **An `ai-review` check showing _fail_ on a merged PR may be a cancellation, not a result** — the
  job is cancelled by hand when it would contend with the peer.

**PMB `/change-review` Job 7 shells out to ACR and branches on our exit codes — a consumer
contract.** Changing what a code means, or making a new condition emit an existing one, changes
their routing. Their exit-code table and how they invoke us:
[`docs/architecture/pmb-integration.md`](../docs/architecture/pmb-integration.md).

## Current State

**Read it from the source, not from here.**

| What                          | Where it is actually true                          |
| ----------------------------- | -------------------------------------------------- |
| Test counts                   | `npm test`                                         |
| Typecheck / build / lint      | `npm run check`                                    |
| Commits, branch, tree state   | `git`; current session state in `activeContext.md` |
| Task and milestone completion | `progress.md`                                      |

## Plan & Spec Documents

| File                                                                       | Purpose                                                                                                          |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `docs/superpowers/specs/2026-06-04-ai-code-review-agent-design.md`         | Full design spec                                                                                                 |
| `docs/superpowers/plans/2026-06-04-ai-code-review-agent.md`                | 16-task implementation plan                                                                                      |
| `docs/superpowers/plans/2026-08-31-corroboration-downgrade-measurement.md` | Approved, unstarted: A/B the orchestrator severity downgrade. Also parks the unverified grammar-decoding thread. |

## Shipped Capabilities

This is a standing inventory of what exists, not session state — `activeContext.md`'s own
frontmatter scopes it to focus, blockers and next steps, and holding this list there is what kept
that file pinned against its 150-line cap.

- Full 16-agent swarm (15 default + testgen opt-in): all specialists + OrchestratorAgent
- `SwarmRunner` with policy filtering, context injection, sanitizer, sequential/parallel execution
- CLI: `--profile`, `--context`, `--context-mode`, `--context-budget`, `--format` (markdown/json/sarif/github-annotations), `--no-emoji`, `--agents`, `--dir`, `--ignore`, `--no-sanitize`, `--suggest-tests`, `--write-tests`
- Finding schema: domain, evidence, impact, recommendation, blocking, source, lineEnd (MB/PMB-aligned)
- Semantic context: `--context-mode semantic` uses nomic-embed-text to rank memory-bank files by diff similarity
- Policy layer: `agentPolicy` per-agent include/exclude glob path filtering
- `.aiignore` negation patterns: `!pattern` overrides excludes (gitignore-style)
- ESLint (`npm run lint:eslint`) — 0 warnings, included in `npm run check`
- Calibration CI: self-hosted runner, 20min timeout. It is nondeterministic — the guidance for
  reading a single run lives under "Verified state" in `activeContext.md`.
- `npm run test:docker` is the fallback when native modules will not load (Smart App Control) or CI
  is unreliable. Key source files are tabulated under "Key Source Files" above.
- `SecretsAgent`/`DependenciesAgent` use gitleaks/`npm audit` directly when available, skipping the
  LLM entirely; `ReviewResult.toolAvailability` surfaces degraded and partial runs (markdown, SARIF,
  and MCP), merged across chunks rather than last-chunk-wins
- **GitHub repo**: https://github.com/unyieldingclaw-dev/ai-code-review-agent
- **npm**: `ai-review-agent@1.15.0` via Trusted Publishing (OIDC), SLSA v1 provenance attached;
  `main` and npm are in sync. `release.yml` has no npm secret dependency — `id-token: write` + the
  Trusted Publisher relationship on npmjs.com suffices; `npm install -g npm@latest` runs early
  (OIDC needs npm >= 11.5.1).
- **VS Code extension has no distribution channel — an open product call, not a task.** No release
  has ever carried a `.vsix`, `release.yml` has no upload step, and Marketplace publish is
  explicitly DEFERRED. #68 documented the truth (build from source) rather than choosing, so docs
  match reality either way and nothing degrades while this sits.
