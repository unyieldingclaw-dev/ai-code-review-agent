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

**Last Updated**: 2026-07-26

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
  └─ sequential: Agent[] → Finding[][]
       ├─ SecurityAgent
       ├─ PerformanceAgent
       ├─ CorrectnessAgent
       ├─ DesignAgent
       ├─ DependenciesAgent
       ├─ AdversarialAgent
       ├─ IntegrationScoutAgent
       ├─ CoverageAnalystAgent   (returns gaps + findings)
       └─ TestGenAgent           (produces test file content)
  └─ Orchestrator → deduplicated Finding[]
```

### Sequential Execution

**Decision**: Agents run one-at-a-time by default. `--parallel` is available as an explicit,
off-by-default opt-in for hardware that's been verified to benefit from it.

**Rationale**: Ollama serializes `devstral:latest` inference on this hardware — confirmed
directly, not assumed. A 2026-07-25 investigation (prompted by a real bug report about slow
security-profile runs) tried flipping this default to parallel-by-default. An initial test (4
concurrent requests, a trivial short prompt) showed a ~1.63x wall-clock speedup and looked
promising, but that result didn't hold at the scale and prompt size the default swarm actually
uses. A follow-up test at real scale — 14 concurrent requests (matching the default agent count)
with a realistic ~30KB diff prompt — showed near-linear serialization instead: completions at
58.7s, 91.5s, 120.6s, 172.7s, 235.0s, 305.7s, then a header-timeout failure past 300s for a
still-pending request. Reproduced with `curl` directly (bypassing Node's fetch client) using the
short prompt to rule out a client-side connection-pool artifact — same staggered pattern. Since
each queued request's client-side timeout clock starts the moment it's dispatched (not when
Ollama actually begins generating for it), firing the full default swarm concurrently would have
caused most agents to spuriously time out purely from queue wait — reproducing the exact
"everything times out, 0 findings" failure mode this tool exists to prevent. The original
"parallel requests queue anyway and add overhead" rationale was correct; the parallel-by-default
change was reverted before shipping (`config.ts`'s `parallel: false` has the short version of
this note). `ai-review-agent` has no Anthropic/Claude API integration — every review run is 100%
local Ollama inference, so there's no token-cost pressure to justify accepting this reliability
risk for a modest, hardware-dependent wall-clock speedup. `--parallel` remains available for
users who've verified their own Ollama setup (e.g. more VRAM headroom, `OLLAMA_NUM_PARALLEL` > 1)
actually benefits from it.

### Option B — Coexistence with PMB `/code-review`

**Decision**: `/ai-review` is a separate slash command that does NOT replace `/code-review`.

**Rationale**: PMB's `/code-review` spawns cloud subagents. `/ai-review` is local-only. Different tradeoffs; keep both.

## Code Patterns

### BaseAgent — 4-Stage JSON Parse (2026-07-25)

LLMs produce messy output. `BaseAgent.parseFindings` tries, in order:

1. Parse entire response as a JSON array (or a `{"findings": [...]}` wrapped object)
2. Parse `{"findings": [...]}` wrapped object (same try block as stage 1)
3. Balanced-bracket extraction — find the first `[...]` span and require it to actually close,
   handling trailing prose/code fences around the array
4. Truncation recovery — scan the whole response for whatever complete `{...}` objects exist,
   regardless of whether the enclosing array or a wrapper object around it ever closed. Salvages
   findings the model finished before getting cut off instead of discarding all of them.

Stages 3 and 4 share two helpers exported from `src/core/parsing.ts` — `extractBalancedSpan`
(single balanced span) and `extractCompleteObjects` (every complete `{...}` object anywhere in
the text, at any nesting depth, via a stack of open-brace positions rather than a depth counter
so a stray unmatched `}` can't desync the rest of the scan). `CoverageAnalystAgent` reuses the
same two helpers for its own two-stage parse (its schema is `{"findings":[...],"gaps":[...]}`,
one level of nesting deeper, which is exactly why it needs `extractCompleteObjects` rather than
`extractBalancedSpan` alone to recover anything once the outer wrapper object is truncated).

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

### Agent Config

All agents request `think: true`, but `OllamaProvider.supportsThinking()` only honors it for
models whose name starts with `qwen` or `deepseek-r1` — it's silently a no-op for the actual
configured default (`devstral`), which doesn't support it. Unlike Google-Organizer (which uses
`think: false` unconditionally), the intent is that reasoning depth matters for code review
quality on models that support it.

### Finding Schema

All agents return `Finding[]`. Key fields: `severity`, `category`, `file`, `line`, `message`, `suggestion`. Defined in `src/core/schema.ts`.

## Data Flow

1. User runs `ai-review` on a git diff
2. SwarmRunner pings Ollama (fail fast if down)
3. Each specialist agent receives the diff + its system prompt
4. Agent calls OllamaProvider, strips think-tags, 3-stage parses JSON
5. Orchestrator deduplicates across agents, applies cap, escalates cross-references
6. Formatter renders findings as markdown or JSON

## Git & Version Control

### Commit Message Format

```
<type>: <short description>

Types: feat, fix, chore, docs, refactor, test, style
```

### Branch Strategy

- `main` — default branch and the target for every PR. All work lands via PR, squash-merged.

### Working With the Review Gates (learned 2026-08-19)

The `/code-review` and `/change-review` markers are consumed by a **substring match on the tool
command text** (`$cmd -match 'git\s+push\b'` in `review-reminders.ps1`, which is the hook that
actually runs — pwsh is tried first, `.sh` is only a fallback). The matcher cannot distinguish
`git push` in command position from `git push` as quoted data.

- **Keep the literal strings `git push` / `git commit` out of command text.** A PR-body heredoc
  mentioning `git push --delete`, or a `grep "git push"` pattern, trips the gate and burns the
  marker — forcing a pointless re-review. Hyphenate, reword ("pushing"), or write prose to a file
  instead of inlining it in the command.
- **A stale PR branch is updated with `gh pr update-branch`, never a rebase.** Force-push is
  hard-blocked in this environment, so rebasing an already-pushed branch is a dead end (you cannot
  publish the rewritten history). `gh pr update-branch` merges the base branch in server-side and
  needs no force-push. Merging `main` into the branch locally also works.
- **Write the marker in a separate tool call from the gated command.** The gate is `PreToolUse`, so
  it evaluates before the command runs — writing the marker and pushing in one call always fails,
  because the marker does not exist yet at the moment the hook checks.
- Tag pushes trip the push gate too, even though they carry no diff. The marker is then the hash
  of an empty diff (`e3b0c442...`), which is legitimate — there is genuinely nothing to review.
- **The two markers are not interchangeable and gate different commands.** `/code-review` writes
  `.claude/.code-review-ok`, which gates `git commit`, and its hash covers `git diff HEAD`.
  `/change-review` writes `.claude/.change-review-ok`, which gates the push, and its hash covers
  `git diff origin/main...HEAD`. Both are needed to take a change from working tree to merged PR,
  and the push marker must be recomputed **after** committing — the branch diff changes the moment
  a commit exists, so a marker written pre-commit no longer matches.

**A failed gated command burns its marker and forces a pointless re-review** — the post-hook that
should reissue it never fires, because PostToolUse does not run when the tool call exits non-zero.
Reproduction and the latent tag-push variant: [`archive/systemPatterns-history.md`](archive/systemPatterns-history.md).

**Do not patch these scripts here.** `review-reminders*`, `pre-push-check*`, `dangerous-commands*`,
`check-contract*`, and `update-reviewed*` are PMB-owned (`TEMPLATE_OWNED` in `mb.sh`), overwritten
unconditionally by `mb upgrade` — PMB's own comment on that list reads "no project customization."
A local fix is erased on the next upgrade. Report upstream instead. PMB has a structural fix for
this defect (Layer 1 downgraded to peek-only, with the git hook as sole marker consumer) on an
unmerged branch.

**`last-reviewed` is never stamped, so `mb doctor`'s staleness check reads a dead sensor** —
`update-reviewed.*` reads a flat `.file_path` where the payload nests it under `tool_input`. Fixed
in PMB 1.2.1; this repo is on 1.1.1, so it arrives with `mb upgrade`, not a local edit. Diagnosis:
[`archive/systemPatterns-history.md`](archive/systemPatterns-history.md).

**Do not "fix" this by loosening the matcher without measurement.** Anchoring to command position
would reduce false trips, but the failure direction is _missing a real push_ (`xargs git push`, a
push inside a loop) — silently disabling a security gate. Same rule as the `claimSupport.ts`
filters: measure, don't inspect.

### Stacked PRs, and Fields That Must Reach Every Formatter (learned 2026-08-26)

- **Never `--delete-branch` while a stacked child exists.** GitHub closes a PR whose _base_ branch
  is deleted rather than retargeting it (this killed #56). Merge the parent bare, retarget the child
  with `gh pr edit N --base main`, then delete the branch.
- **Such a PR can be neither reopened nor retargeted.** Open a fresh PR on `main` and merge `main`
  in — the branch holds the parent's pre-squash commit, so otherwise the diff replays it entirely.
- **A stacked PR never runs `test`** — `ci.yml` fires on `pull_request: branches: [main]` only, so
  green on one means the check never ran, not that it passed.
- **A new `Finding`/`ReviewResult` field must reach all four formatters** — `cli/formatter.ts`,
  `cli/formatters/{sarif,githubAnnotations}.ts`, `mcp/formatter.ts`. `toolAvailability` missed MCP
  and `locationCheck` missed SARIF+MCP, both caught post-merge by a reader. Check MCP first: its
  reader is an LLM with no terminal to cross-check against.
- **Tag only AFTER the release PR merges** (2026-08-27). `v1.14.0` was tagged from the release
  branch, so its provenance attests a commit that is not on `main`. Content is identical and it is
  not worth fixing, but a pushed tag publishes irreversibly — do not repeat it.
- **`gh pr merge` is denied to Claude** (`permissions.deny` in `.claude/settings.json`) and this is
  intentional. The user merges. Do not route around a denial; stop and ask.

### Falsify Before You Trust It (2026-08-21, reconfirmed through 2026-08-27)

Three findings that are one principle: **a claim you have not tried to disprove is not evidence.**
It applies to filters, to prompts, and to the tests that are supposed to protect both.

**A probe proves the idea, not the wiring.** `isPreImageOnlyEvidence` was first wired to the section
from `sliceDiffByFile`, which stores `diffSectionCode(section)` — post-image by construction — so the
filter could never fire. Every predicate unit test passed, because the predicate was correct, and a
scratch probe agreed, because it read removed lines from the raw diff instead of going through
`sliceDiffByFile`. Only replaying a real artifact through `OrchestratorAgent.synthesize` exposed it,
showing `dropped: 0` where the probe predicted 1.

- **Replay real captured output through the real entry point.** `gh run download <run-id>` retrieves
  the `ai-review-findings` artifact `review.yml` uploads — the highest-value test input this project
  has, because it is what the tool produced rather than what a fixture author imagined. It has twice
  surfaced bugs nobody was looking for: 33% of findings carrying unresolvable `a/` paths, same-agent
  duplicates surviving dedup, and later six findings all citing wrong lines.
- **Test at the wiring seam, not only the predicate.** The orchestrator-level test pins it:
  reintroducing `isPreImageOnlyEvidence(f.evidence, section, section)` fails while all 109
  `claimSupport` unit tests still pass.
- **Distrust a probe that agrees with you.** If a scratch script and the real pipeline disagree, the
  pipeline is right. Import the actual exported function rather than reimplementing it.
- **Record the delta, not the level** (2026-08-27, from PMB). "This removed 20,953 bytes" stays
  true; "the file is now 46,956 bytes" decays within hours, and did — three times on their side,
  twice inside the branch that wrote it. Same root as the duration lesson below: a figure recorded
  without the frame that makes it meaningful.
- **When a review round's findings are mostly defects introduced by the previous round's fixes,
  the change has had enough passes** (2026-08-27, named by PMB, and this repo is a clean instance).
  Round 1 found retry-inflated elapsed; round 2's fix recorded the last attempt instead of the
  longest, hiding a slow attempt behind a fast retry; round 3 caught that. Getting a thing wrong
  from _opposite directions_ while fixing it is the signal to stop reviewing and ship, not to run
  a fourth round.
- **A duration is not a measurement until you say what it spans** (2026-08-27). Wall time
  covering retries, printed against a per-attempt ceiling, reads as exceeding a limit no
  attempt approached — measured at 611.7 s vs 354.7 s, all retry. State the span in the type.
- **A uniform verdict from a verification harness is a harness bug until proven otherwise**
  (2026-08-27). A mutation run reported 0 failures for all 13 mutations: `--reporter=basic` was
  removed in vitest 4, so vitest errored before running a test and the parser read empty output as
  "passed". Same rule as the line above, in the direction that discards good tests rather than
  keeping bad ones. Assert the harness ran (parse the `Tests N failed` line) before reading it.

**Prompt wording does not move a measured defect rate here — four independent confirmations.** The
fourth was argued the other way first: the prior three were _hallucination_, whereas reporting
deleted code looked like a _missing frame_, and supplying genuinely absent information seemed
different in kind. It was not. An explicit instruction ("lines starting with '-' have been DELETED
… never report a problem that exists only on a '-' line") measured **7/7 still reporting** the
deleted defect against 8/8 before, and was reverted rather than kept as decoration. Measuring was
still right — the datapoint beats the assumption either way — but the prior stands: reach for a
deterministic filter, and treat prompt wording as unproven until measured.

**A regression test that passes against the unfixed code proves nothing.** This repo shipped an
assertion that could not fail: `DependenciesAgent`'s calibration cases were both `expectEmpty`, so an
agent returning `[]` passed — proven by patching it to `return []`.

- **Revert the fix, confirm the test fails _and that the message is the one you expect_, restore.**
  The message matters as much as the failure; it is what proves the test exercises the mechanism
  rather than tripping on setup. Examples: `expected 'unavailable-llm-fallback' to be 'partial'`,
  `expected null to be 'MIT'`, `expected 'not-applicable' to be 'used'`.
- **Count how many of a batch actually fail.** If fewer fail than expected, the rest are guard tests,
  not regression tests, and must not be counted as evidence the bug is covered. Ordering can hide
  this — a chunk-merge test with `not-applicable` last passes under last-chunk-wins too; putting the
  substantive value last is what makes it falsifying.

## Never Do This

- ❌ Default agent execution to parallel without verifying it actually helps on real hardware at
  real scale (see "Sequential Execution" above — a 2026-07-25 attempt looked good on a small,
  unrepresentative test and made things worse at the real default scale)
- ❌ Hard-fail on JSON parse errors (degrade gracefully)
- ❌ Call Anthropic/OpenAI APIs in the review pipeline
- ❌ Replace PMB's `/code-review` — both coexist
- ❌ Use `think: false` for agents (reasoning depth required)
- ❌ Re-litigate Option B (coexistence decision is final)
