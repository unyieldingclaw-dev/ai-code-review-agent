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

**This paragraph originally supplied an illustrative count and got it wrong** — "26 cases", from
`grep -c "name:"`, which also matched an interface field and two type annotations; the array holds 23. Caught in review. The count is gone rather than corrected to 23, because a sentence arguing that
pinned counts rot has no business pinning one.

**The bands do not overlap at the top, and that is the finding.** A switch to `qwen2.5-coder:7b`
was recommended on **one pass each** and was wrong; three passes reversed it. So
`qwen2.5-coder:7b` is the _fast path_ (`--model`), never the default — its value is making
`--chunk` affordable at roughly 9x the speed, not matching devstral's ceiling. The rule this
established is in `systemPatterns.md`.

**Per-agent timeout ceiling — MEASURED, CLOSED (2026-08-27). Do not raise it, do not re-derive
it.** Slowest genuine attempt 213.2 s against a 315.4 s ceiling (68%); the one row that appeared
to exceed its budget is a retry artifact. **Timeouts are not the binding constraint — model fit
is**, which is why this sits beside the model measurement rather than in `activeContext.md`
(moved 2026-09-01). The 616 s resemblance stays _suggestive, not established_ — the original has
no source. Still untested: true CPU-only. Full measurement:
[`archive/activeContext-history.md`](archive/activeContext-history.md).

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

**`OLLAMA_KEEP_ALIVE=30m` is set persistently in User scope and verified** (2026-08-30) — `ollama ps`
reads ~29 min rather than the ~5 min default. It was previously set in **neither** User nor Machine
scope. Applying it required restarting the daemon: Ollama reads the variable at startup, so
exporting it in a shell does nothing to a server already running.

**`ai-review-agent` on PATH is an `npm link` symlink to this working tree, not the registry build.**
Anything concluded about "what consumers get" from the local binary is a statement about
uncommitted local code. To reason about the published package, `npm pack ai-review-agent@X` and
inspect the tarball. This is also why a git worktree is the wrong workspace for a change the PMB
peer will exercise — the symlink points at the main tree, so a worktree build never reaches it.

**This has already cost the peer a batch of measurements** (2026-09-01): every ACR figure in
their record labelled "1.15.0" in fact described our working tree at an indeterminate commit, and
they have retracted the label to "linked working tree, version indeterminate". Treat any
version-attributed measurement taken through the linked binary as unattributed until re-taken.

### PMB-owned defects — none fixable here

`TEMPLATE_OWNED`, so `mb upgrade` overwrites any local fix. Sixteen reported across two briefs, all
one shape: **the check's _result_ is disconnected from whether it ran.** Two live examples, and it
takes two to establish a shape — `update-reviewed.*` reads a flat `.file_path` where the payload
nests under `tool_input`, so `last-reviewed` is never stamped and `mb doctor` reads a dead sensor;
`pre-push-check.*` calls `mb validate`, folded into `mb doctor`, and prints its "use mb doctor"
message as evidence of inconsistency on every push. Moved here from `activeContext.md` on
2026-08-31 — a standing fact about an upstream dependency, not session state.

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
their routing. **Read directly in their checkout on 2026-08-31**, at
`PMB:.claude/commands/change-review.md:166-205` and its `templates/claude-commands/` mirror, rather
than accepted on their report — the standing rule in `progress.md`, and this is why:

| their exit  | their stated meaning                           | their action                |
| ----------- | ---------------------------------------------- | --------------------------- |
| `0`         | **"Ran fully, nothing met the threshold"**     | genuine clean pass          |
| `1`         | ran fully and **found** something at threshold | **use the findings**        |
| `2`         | an agent failed internally (outranks `1`)      | not clean; fall through     |
| `3`         | diff truncated, coverage partial               | not clean; re-run `--chunk` |
| `4` †       | preflight failed (e.g. model missing)          | not clean; configuration    |
| any other † | (unenumerated)                                 | **treated as `2`**          |

- **Their invocation is `--profile security --chunk --diff <patch>`.** Verified: `fail-fast|failFast`
  occurs **0 times** in both their command file and the shipped template, and no
  `ai-review.config.json` exists anywhere in PMB. So `earlyExit` is latent for them, not live.
- **† Peer-reported 2026-09-01, NOT read in their checkout.** Rows `0`–`3` were read directly at
  the path above; the `4` and catch-all rows come from the peer's report only and are held at
  that lower confidence until verified the same way. If true they supersede the earlier note
  that their enumeration stopped at `3`, making exit 4 live on their side — which is what the
  `ping()` fix was waiting on. **Do not act on exit 4 routing without checking their file.**
- **Their `0` row says "Ran fully", which is exactly what a `--fail-fast` run does not do.** Their
  own note at `:205` warns a presence-only check cannot separate "ran and found nothing" from "every
  agent failed", calling it "a silently skipped security check reading as a pass" — the defect
  `earlyExit` reintroduces one level up, by returning `0` from a run that stopped early.
  **#83 makes that row wrong, and they know.** It is their fix, on their side, and they asked
  explicitly that #83 not be held for it. Do not block on it.
- **`--model` claims are peer-reported, not verified**: their file pins no model, so today's tagged
  `--model` runs were manual. Treat as their word.

**Peer-reported and NOT verifiable from this repo** — hedge accordingly, since both sides have
drifted before: their 8-case UTF-16/UTF-32 BOM byte matrix (their `tests/dangerous-commands.Tests.ps1`
exists, but the result was not reproduced here) and their account of their own commit history.

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

| File                                                                       | Purpose                                                                                                          |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `docs/superpowers/specs/2026-06-04-ai-code-review-agent-design.md`         | Full design spec                                                                                                 |
| `docs/superpowers/plans/2026-06-04-ai-code-review-agent.md`                | 16-task implementation plan                                                                                      |
| `docs/superpowers/plans/2026-08-31-corroboration-downgrade-measurement.md` | Approved, unstarted: A/B the orchestrator severity downgrade. Also parks the unverified grammar-decoding thread. |

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
- **VS Code extension has no distribution channel — an open product call, not a task.** No release
  has ever carried a `.vsix`, `release.yml` has no upload step, and Marketplace publish is
  explicitly DEFERRED. #68 documented the truth (build from source) rather than choosing, so docs
  match reality either way and nothing degrades while this sits. Moved from `activeContext.md`
  2026-09-01: a standing distribution fact, not session state.
