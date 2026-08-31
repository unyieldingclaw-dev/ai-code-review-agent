---
authority: stable
review-cycle: 90d
retention: permanent
staleness-threshold: 180d
tags:
  - architecture/decisions
  - patterns/code
  - anti-patterns
last-reviewed: 2026-07-26
compaction_generation: 0
source_type: canonical
confidence: high
lineage: []
---

# System Patterns & Architecture Decisions

**Last Updated**: 2026-08-31

## Architecture Patterns

### Agent Swarm (16 Specialists + 1 Orchestrator)

**Decision**: One abstract `BaseAgent`, sixteen concrete specialist subclasses (fifteen run by default, `testGen` is opt-in), one `Orchestrator`, driven by `SwarmRunner`.

**Rationale**:

- Specialist agents don't bias each other (each sees only the diff + its own system prompt)
- Orchestrator deduplicates and cross-references after all agents complete
- Matches how humans divide code review by domain

**Implementation**:

```
SwarmRunner
  └─ ping check (Ollama live?)
  └─ sequential: Agent[] → Finding[][]     15 default + TestGenAgent (opt-in)
  └─ Orchestrator → deduplicated Finding[]
```

The canonical agent list is `DEFAULT_CONFIG.agents` in `src/core/config.ts:58` — read it there. An
enumeration here previously named 9 of the 16 under a heading claiming 16, which is the failure this
file's own "record the delta, not the level" rule warns about.

### Sequential Execution

**Decision**: Agents run one-at-a-time by default. `--parallel` is available as an explicit,
off-by-default opt-in for hardware that's been verified to benefit from it.

**Rationale**: Ollama serializes `devstral:latest` inference on this hardware — measured, not
assumed. A 2026-07-25 attempt to default to parallel looked good small and failed at real scale:
a queued request's timeout clock starts when it is _dispatched_, not when Ollama begins generating,
so most agents would time out on queue wait alone — the "everything times out, 0 findings" failure
this tool exists to prevent. Reverted before shipping.

Load-bearing premise: no Anthropic/Claude integration, so every run is local inference and there is
no token-cost pressure to trade reliability for a hardware-dependent speedup. `--parallel` stays
available for setups verified to benefit. Measurements:
[`archive/systemPatterns-history.md`](archive/systemPatterns-history.md).

### Option B — Coexistence with PMB `/code-review`

`/ai-review` is a separate slash command that does **not** replace `/code-review`: PMB's spawns
cloud subagents, ours is local-only. Different tradeoffs; keep both. Final — see **Never Do This**.

## Code Patterns

### BaseAgent — 4-Stage JSON Parse (2026-07-25)

LLMs produce messy output, so `BaseAgent.parseFindings` degrades through four stages: whole-response
parse, wrapped-object parse, balanced-bracket extraction, then truncation recovery that salvages
whatever complete `{...}` objects exist even if no enclosing array ever closed. Stage mechanics and
the two shared `src/core/parsing.ts` helpers:
[`archive/systemPatterns-history.md`](archive/systemPatterns-history.md).

The rules that govern the behaviour are what matter here, and they are not optional.

Every stage's recovered/parsed items still go through the same schema validation
(`validateAndNormalizeFindings`) before being accepted. **Never** silently resolve to "0
findings, clean run" on a response that didn't actually parse — if nothing recoverable passes
validation, throw `ParseFailureError` (see `AgentStatus`/exit-code-2 reporting above). A
trivially-parseable-but-empty response (e.g. `"{}"` for `BaseAgent`'s array-shaped schema) must
still throw, not be treated as a successful zero-finding recovery — validate before checking
`recovered.length > 0`, not after.

All JSON-emitting agents (`BaseAgent` subclasses, `CoverageAnalystAgent`) also request Ollama's
`format: 'json'` grammar-constrained decoding. This guarantees syntactic JSON validity but does
**not** extend the model's generation budget — calibration testing found it actually _increases_
truncation frequency on `devstral:latest` (1/16 → 11/16 cases in one run), which is precisely why
stage 4 exists and why every `format:'json'` call site needs equivalent recovery. Not applied to
`TestGenAgent`, which intentionally outputs raw test code, not JSON.

### OllamaProvider — Think-Tag Stripping

`devstral` emits `<think>...</think>` blocks before the JSON answer. Strip these before any parse attempt. Adapted from `Google-Organizer/src/workers/ollamaClient.ts`.

### Finding Schema

All agents return `Finding[]`. Key fields: `severity`, `category`, `file`, `line`, `message`, `suggestion`. Defined in `src/core/schema.ts`.

## Data Flow

`ai-review` on a diff → `SwarmRunner` pings Ollama (fail fast) → each specialist gets the diff plus
its own system prompt → `OllamaProvider`, think-tag strip, 4-stage parse → `Orchestrator` dedups,
caps, escalates cross-references → renderers (all six — see the formatter rule below).

## Git & Version Control

### Commit Message Format

```
<type>: <short description>

Types: feat, fix, chore, docs, refactor, test, style
```

### Branch Strategy

- `main` — default branch and the target for every PR. All work lands via PR, squash-merged.

### Working With the Review Gates (learned 2026-08-19)

The markers are consumed by a **substring match on the tool command text** in
`review-reminders.ps1`, which cannot distinguish a gated command from the same words quoted as
data. Mechanism and the matcher's exact pattern:
[`archive/systemPatterns-history.md`](archive/systemPatterns-history.md).

- **Keep the literal gated verbs out of command text.** A PR body, a `grep` pattern, or a script
  inlined into a shell command that contains them trips the gate and burns the marker. Write the
  text to a file and run the file. Commit messages go in a file passed with `-F`, never inline.
  Hit three times now, once inside the very edit that was rewriting this rule.
- **A stale PR branch is updated with `gh pr update-branch`, never a rebase.** Force-push is
  hard-blocked here, so rebasing an already-pushed branch is a dead end. Merging `main` in
  locally also works.
- **Write the marker in a separate tool call from the gated command.** The gate is `PreToolUse`,
  so a marker written in the same call does not exist yet when the hook checks.
- Tag pushes trip the push gate too. The marker is then the hash of an empty diff
  (`e3b0c442...`), which is legitimate — there is genuinely nothing to review.
- **The two markers are not interchangeable and gate different commands.** `/code-review` writes
  `.claude/.code-review-ok` (gates the commit, hashes `git diff HEAD`); `/change-review` writes
  `.claude/.change-review-ok` (gates the push, hashes `git diff origin/main...HEAD`). Both are
  needed to reach a merged PR, and the push marker must be recomputed **after** committing.
- **A failed gated command burns its marker and forces a pointless re-review** — PostToolUse does
  not fire when a tool call exits non-zero, so the reissue never happens.
- **Do not patch these scripts here.** `review-reminders*`, `pre-push-check*`, `dangerous-commands*`,
  `check-contract*` and `update-reviewed*` are `TEMPLATE_OWNED` and overwritten by `mb upgrade`.
  Report upstream. **The converse also holds:** `ADVISORY_CREATE` files are copied **only when
  absent**, so an upgrade can land a rule change without its rationale — mechanics in
  `techContext.md`.
- **`last-reviewed` is never stamped, so `mb doctor`'s staleness check reads a dead sensor.**
  Arrives with `mb upgrade`, never a local edit.
- **Do not "fix" this by loosening the matcher without measurement.** Anchoring to command position
  would cut false trips, but the failure direction is _missing a real push_ — silently disabling a
  security gate. Measure, don't inspect.

### Stacked PRs, and Fields That Must Reach Every Formatter (learned 2026-08-26)

- **Never `--delete-branch` while a stacked child exists.** GitHub closes a PR whose _base_ branch
  is deleted rather than retargeting it (this killed #56). Merge the parent bare, retarget the
  child with `gh pr edit N --base main`, then delete the branch. **Such a PR can then be neither
  reopened nor retargeted** — open a fresh PR on `main` and merge `main` in.
- **A stacked PR never runs `test`** — `ci.yml` fires on `pull_request: branches: [main]` only, so
  green on one means the check never ran, not that it passed.
- **A new `Finding`/`ReviewResult` field must reach every surface that renders a verdict — SIX,
  and the count is the point.** Four formatters (`cli/formatter.ts`,
  `cli/formatters/{sarif,githubAnnotations}.ts`, `mcp/formatter.ts`) plus two that are **not**
  formatters and were therefore invisible to this rule's own earlier wording: `review.yml`, which
  renders the PR comment and the Step Summary from two hand-written inline scripts, and
  `vscode-extension`, a separate package holding its own copy of the envelope. Check MCP first
  (its reader is an LLM with no terminal to cross-check) and remember the workflow renderer is the
  highest-visibility of the six. Which fields missed which surfaces:
  [`archive/systemPatterns-history.md`](archive/systemPatterns-history.md).
- **Release tagging: tag only after the release PR merges, verify the version first, and re-check
  a cleanup command against current state before re-running it** (2026-08-27, three incidents).
  Carries a separate rule worth stating on its own: **a remediation correct five minutes ago is not
  self-evidently correct now.** Narrative:
  [`archive/systemPatterns-history.md`](archive/systemPatterns-history.md).
  Tag with the guard, which covers the version but not the delete:

  ```powershell
  git checkout main; git pull; if ((node -p "require('./package.json').version") -eq "X.Y.Z") { git tag vX.Y.Z; git push origin vX.Y.Z } else { "ABORT: main is not at X.Y.Z" }
  ```

- **Squash-merge blinds git's own merged-detection** (2026-08-27). `git branch --merged` listed
  **0 of 11** landed branches, so a cleanup trusting it does nothing and the obvious fix
  (force-delete) drops the verification that made forcing safe. Verify the local tip equals the
  merged PR's `headRefOid`, and when one differs check **both** directions.

- **`gh pr merge` is denied to Claude** (`permissions.deny` in `.claude/settings.json`) and this is
  intentional. The user merges. Do not route around a denial; stop and ask.

- **Memory-bank line caps are CI-enforced** (`ci.yml`, "Memory bank size limits"), so an
  overflowing edit fails the build. Archive the evidence, keep the rule, and **leave headroom** —
  rationale in [`README.md`](README.md).

### Falsify Before You Trust It (2026-08-21, reconfirmed through 2026-08-27)

One principle: **a claim you have not tried to disprove is not evidence.** It applies to filters,
to prompts, and to the tests meant to protect both. (Deliberately uncounted — see the stale-list
rule below, which this heading violated first.)

**Assert from the thing, not from a proxy for it** (2026-08-30). Every instance so far has been
wrong, and **none was caught by re-reading one's own work** — each came from a measurement or the peer.
_Neither of us is finding these by looking; we find them when something else breaks nearby._
Instances: [`archive/systemPatterns-history.md`](archive/systemPatterns-history.md).

**A probe proves the idea, not the wiring.** A predicate passed every unit test and a scratch probe
while wired so it could never fire; only a real-artifact replay exposed it. Case:
[`archive/systemPatterns-history.md`](archive/systemPatterns-history.md).

- **Replay real captured output through the real entry point.** `gh run download <run-id>`
  retrieves the `ai-review-findings` artifact — the highest-value test input this project has,
  because it is what the tool produced rather than what a fixture author imagined. It has twice
  surfaced bugs nobody was looking for.
- **Test at the wiring seam, not only the predicate.** A predicate's whole unit suite can pass
  while the call site is wired so it can never fire.
- **Distrust a probe that agrees with you.** If a scratch script and the real pipeline disagree, the
  pipeline is right. Import the actual exported function rather than reimplementing it.
- **`grep` over prose reports false _absences_ AND false presences** (2026-08-27, extended
  2026-08-31). Hand-wrapped markdown splits a phrase across lines, so the text is present and the
  pattern misses; and `grep -c` counts a string that survives only inside a note recording its own
  deletion, which reads as "still there". Verify whitespace-normalised, and read the line, not the
  count.
- **Record the delta, not the level** (2026-08-27, from PMB). "This removed 20,953 bytes" stays
  true; "the file is now 46,956 bytes" decays within hours, and did. Same root as the duration
  lesson below: a figure recorded without the frame that makes it meaningful.
- **A rule that enumerates its own members is a stale-list bug waiting to fire** (2026-08-31,
  named by PMB — the sharper sibling of the above). The guard keeps passing while the family
  grows, so nothing signals the drift. The fix is always the same: point at the source of truth
  rather than restate it. Instances:
  [`archive/systemPatterns-history.md`](archive/systemPatterns-history.md).
- **A memory-bank file must never record the `main` hash** (2026-08-28) — self-invalidating rather
  than merely decaying, because a memory-bank PR _moves the commit it names_. Read it from
  `git log`. **Immutable identifiers are the exception** — a release tag like `v1.15.0` at `6e2ed34`
  is safe precisely because nothing can move it. Two PRs both shipped stale trying to keep it
  current: [`archive/systemPatterns-history.md`](archive/systemPatterns-history.md).
- **When a review round's findings are mostly defects introduced by the previous round's fixes, the
  change has had enough passes** (named by PMB). Getting a thing wrong from **opposite directions**
  while fixing it is the signal to ship, not to run a fourth round.
- **A duration is not a measurement until you say what it spans.** State the span in the type.
- **A uniform verdict from a verification harness is a harness bug until proven otherwise.** Assert
  the harness ran (parse `Tests N failed`) before reading it.
- **One calibration pass is not a ranking** (2026-08-30). A model switch recommended on one pass
  each was reversed by three. Numbers in `techContext.md`; measurements behind all four in
  [`archive/systemPatterns-history.md`](archive/systemPatterns-history.md).

**Prompt wording does not move a measured defect rate here — four independent confirmations**, the
fourth measured 7/7 unchanged after an instruction predicted to help. Reach for a deterministic
filter; treat prompt wording as unproven until measured. Detail:
[`archive/systemPatterns-history.md`](archive/systemPatterns-history.md).

**A regression test that passes against the unfixed code proves nothing** — this repo shipped an
assertion that could not fail. Illustration:
[`archive/systemPatterns-history.md`](archive/systemPatterns-history.md).

- **Revert the fix, confirm the test fails _and that the message is the one you expect_, restore.**
  The message matters as much as the failure; it proves the test exercises the mechanism rather
  than tripping on setup.
- **Count how many of a batch actually fail.** Those that do not are guard tests, and must not be
  counted as evidence the bug is covered. Ordering can hide this: put the substantive value last,
  or the assertion passes under the unfixed behaviour too.

## Never Do This

- ❌ Default agent execution to parallel without verifying it actually helps on real hardware at
  real scale (see "Sequential Execution" above — a 2026-07-25 attempt looked good on a small,
  unrepresentative test and made things worse at the real default scale)
- ❌ Hard-fail on JSON parse errors (degrade gracefully)
- ❌ Call Anthropic/OpenAI APIs in the review pipeline
- ❌ Replace PMB's `/code-review` — both coexist
- ❌ Use `think: false` for agents (reasoning depth required)
- ❌ Re-litigate Option B (coexistence decision is final)
