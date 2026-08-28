---
authority: stable
review-cycle: 30d
retention: permanent
staleness-threshold: 90d
tags:
  - stack/backend
  - stack/frontend
  - env/tools
last-reviewed: 2026-06-06
compaction_generation: 0
source_type: canonical
confidence: high
lineage: []
---

# Technical Context & Stack

**Last Updated**: 2026-08-28

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

### `mb upgrade` — what it actually overwrites

Read in PMB's `scripts/mb.sh` on 2026-08-28, not inherited, and confirmed by the PMB session in
their own tree. **There are four delivery paths, not two**, and three of them do not deliver:

**Paths below are qualified `PMB:` or `ours:` deliberately** — the two repos have same-named files
with different contents, and an unqualified path is how a cross-repo citation goes wrong.

| Delivery path              | Examples                                                     | Does a fix reach us?                        |
| -------------------------- | ------------------------------------------------------------ | ------------------------------------------- |
| `TEMPLATE_OWNED`           | `.cursor/rules/*.mdc`, `.claude/settings.json`, hook scripts | **Yes** — overwritten, local fixes erased   |
| `ADVISORY_CREATE`, present | all 15 `standards/*.md`, `docs/*-GUIDE.md`                   | **No**, but visible — prints a 20-line diff |
| `ADVISORY_CREATE`, absent  | `PMB:.github/workflows/memory-bank-size.yml`                 | Created — may **collide** with what we have |
| Neither array (init-only)  | `memory-bank/*`, including its `README.md`                   | **No, and silent** — no diff, no signal     |

PMB also identified a fifth case with no distribution path at all (`PMB:templates/AGENTS.md`,
reachable only via a standalone script the documented onboarding never invokes).

**The case that will actually fire for us is create-when-absent.**
`PMB:.github/workflows/memory-bank-size.yml` is `ADVISORY_CREATE` and we do **not** have it, so the
next upgrade creates a **second CI size gate** whose caps disagree with `ours:.github/workflows/ci.yml`:
projectbrief 120 vs our 150, techContext 300 vs 400, progress 600 vs 400, plus byte caps we have none
of, and remediation text pointing at `docs/archive/` where we use `memory-bank/archive/`. **The guard
that was supposed to prevent this is filename-based** — PMB's comment says a project with its own CI
"keeps it and just sees a diff notice", which holds only if that CI lives at the same path. Ours is
`ci.yml`, so to `mb upgrade` we simply do not have the file. Reconcile the two gates when it lands,
or the "enforced by CI" rule in `README.md` stops naming a single gate.

**And the never-copy case splits one decision across two files.** PMB's `2052c3c` changed both
`PMB:templates/cursor/rules/memory-bank.mdc` and `PMB:templates/standards/MEMORY-BANK.md`, which
carry the **same** decision — the Cursor handoff threshold 80% → 40% _and_ its reasoning. In our
tree today:

- `ours:.cursor/rules/memory-bank.mdc:51` says 80% — `TEMPLATE_OWNED`, so it **will be overwritten**.
- `ours:standards/MEMORY-BANK.md`, "Implications for Handoff Thresholds" and the Handoff Protocol
  trigger list, says Cursor 80% and justifies it with "rules re-inject on every response; 80% is
  safe" — `ADVISORY_CREATE` and present, so it **will not be touched**. (Cited by section, not line:
  editing this file shifts its own line numbers, which is how the citation here first went stale.)

So the number arrives without its justification, and the surviving justification is the one PMB has
retired ("do not re-derive a Cursor-specific number from rule-persistence behaviour"). **If you
reconcile only one file, reconcile `ours:standards/MEMORY-BANK.md`** — the reasoning lives there; the
`.mdc` only points at it. A third file, `ours:memory-bank/README.md`, also carries a stale 80% and is
in **neither** ownership array, so no upgrade will ever reach it.

**The procedure, when the tag exists.** Two repos, and the `cd` paths are load-bearing — giving a
cross-repo command without one sent the user to the wrong repository on 2026-08-28. Check PMB's tree
is clean **first**: `mb upgrade` copies from PMB's _working directory_, so uncommitted edits under
`templates/` ship as if they were the release, and PMB's tree was dirty in exactly that directory.

```powershell
cd "C:\Users\Mizzo\Claude\Personal-Memory-Bank"; git status --short
```

```powershell
cd "C:\Users\Mizzo\Claude\Personal-Memory-Bank"; git checkout v1.2.1
```

```powershell
cd "C:\Users\Mizzo\Claude\AI-Code-Review-Agent"; mb upgrade
```

That leaves PMB in detached HEAD — return it to its branch, or the next PMB session starts detached.
Afterwards verify `last-reviewed` actually starts stamping (the only proof the dead sensor is fixed),
and read the upgrade's output against the table above rather than assuming it synchronised anything.

**Do not copy PMB's replacement rationale verbatim.** Their own review flagged it (`[O2]`, open):
`PMB:standards/MEMORY-BANK.md` names absolute input length as the binding variable, then argues in
percentages of two context windows whose sizes neither repo establishes. PMB's own text avoids
naming the compaction constant; do not reintroduce it when paraphrasing. Their stated independent
basis is `PMB:memory-bank/systemPatterns.md`, which already said 40% with no IDE qualifier — **that
basis is in their repo, not ours**; `ours:memory-bank/systemPatterns.md` says nothing about handoff
thresholds at all.

**Fixed here 2026-08-28 — a constant that rotted because prose restated config.**
`standards/MEMORY-BANK.md` asserted `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=50` in three places while
`.claude/settings.json` reads 65. `ADVISORY_CREATE` meant no upgrade could ever correct it. The fix
**stops restating the value** rather than updating it to 65 — the file now points at `settings.json`,
because a second copy of a configured number is what drifted in the first place. Same fix the user's
global `CLAUDE.md` already made after the identical `=50` drift. Reported upstream to PMB; our copy
now diverges further from their template, so expect the advisory diff to keep printing.

## Current State

**Read it from the source, not from here.** This section previously pinned counts as of 2026-06-06
— "19 unit tests", "20 commits on `master`" — and every line of it had rotted by 2026-08-28 (826
tests, 456 commits, and the branch is `main`). A dated stamp made it honest and still useless. Same
defect as the `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=50` drift this file documents above.

| What                          | Where it is actually true                          |
| ----------------------------- | -------------------------------------------------- |
| Test counts                   | `npm test`                                         |
| Typecheck / build / lint      | `npm run check`                                    |
| Commits, branch, tree state   | `git`; current session state in `activeContext.md` |
| Task and milestone completion | `progress.md`                                      |

## Plan & Spec Documents

| File                                                               | Purpose                     |
| ------------------------------------------------------------------ | --------------------------- |
| `docs/superpowers/specs/2026-06-04-ai-code-review-agent-design.md` | Full design spec            |
| `docs/superpowers/plans/2026-06-04-ai-code-review-agent.md`        | 16-task implementation plan |

## Shipped Capabilities

Moved from `activeContext.md` on 2026-08-28. This is a standing inventory of what exists, not
session state — `activeContext.md`'s own frontmatter scopes it to focus, blockers and next steps,
and holding this list there is what kept that file pinned against its 150-line cap.

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
