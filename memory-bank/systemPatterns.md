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

### 10-Agent Swarm (9 Specialists + 1 Orchestrator)

**Decision**: One abstract `BaseAgent`, nine concrete specialist subclasses, one `Orchestrator`, driven by `SwarmRunner`.

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

### Validate a Filter Through the Pipeline, Not a Probe (learned 2026-08-21)

A standalone script that reimplements a check and reports it working proves the _idea_, not the
_wiring_. `isPreImageOnlyEvidence` was first wired to the section from `sliceDiffByFile` — but that
function stores `diffSectionCode(section)`, which is **post-image by construction**, so the filter
could never fire. Every unit test of the predicate passed, because the predicate was correct. A
scratch probe had also reported it working, because the probe extracted removed lines from the raw
diff itself rather than going through `sliceDiffByFile`.

It was caught only by replaying a real `findings.json` artifact through `OrchestratorAgent.synthesize`
and seeing `dropped: 0` where the probe predicted 1.

- **Replay real captured output through the real entry point.** `gh run download <run-id>` retrieves
  the `ai-review-findings` artifact `review.yml` uploads; it is the highest-value test input this
  project has, because it is what the tool actually produced rather than what a fixture author
  imagined. It also revealed two bugs nobody was looking for (33% of findings carrying unresolvable
  `a/` paths, and same-agent duplicates surviving dedup).
- **A filter needs a test at the wiring seam, not only on its predicate.** The orchestrator-level
  test pins this: reintroducing `isPreImageOnlyEvidence(f.evidence, section, section)` fails it while
  all 109 `claimSupport` unit tests still pass.
- **Watch for a probe that agrees with you.** If a scratch script and the real pipeline disagree,
  the pipeline is right. Prefer importing the actual exported function over reimplementing it.

### Prompt Wording Does Not Fix Measured Defect Rates Here (reconfirmed 2026-08-21)

Fourth independent confirmation, and the first where the prediction was explicitly argued the other
way first. The reasoning was: the three prior failures were _hallucination_ (the model inventing a
mechanism, then rationalizing), whereas reporting deleted code looked like a _missing frame_ — the
model had its facts right and nothing in the prompt said `-` lines were gone. Supplying genuinely
absent information seemed different in kind, and worth measuring rather than dismissing by analogy.

It was not different. An explicit instruction ("lines starting with '-' have been DELETED and are
NOT in the resulting code — never report a problem that exists only on a '-' line") measured **7/7
still reporting the deleted defect**, against 8/8 before. The instruction was reverted rather than
kept as decoration.

Measuring it was still correct — the datapoint is worth more than the assumption either way. But the
prior stands: for a _measured_ defect rate in this project, reach for a deterministic filter and
treat prompt wording as unproven until measured.

### Verify a Regression Test Fails Before Trusting It (learned 2026-08-21)

A regression test that passes against the unfixed code proves nothing, and this repo has shipped at
least one assertion that could not fail (`DependenciesAgent`'s calibration cases were both
`expectEmpty`, so an agent returning `[]` passed — proven by patching it to `return []`).

Before trusting any new test: revert the fix, confirm the test fails **and that the failure message
is the one you expect**, then restore. The message matters as much as the failure — it is what
proves the test is exercising the mechanism rather than tripping on setup. Recent examples:
`expected 'unavailable-llm-fallback' to be 'partial'`, `expected null to be 'MIT'`,
`expected 'not-applicable' to be 'used'`.

Watch for tests that pass under both old and new behavior by accident of ordering. A chunk-merge
test with `not-applicable` in the last position passes under last-chunk-wins too; putting the
substantive value last is what makes it falsifying. Check which of a batch actually fail — if
fewer fail than you expected, the rest are guard tests, not regression tests, and should not be
counted as evidence the bug is covered.

**Confirmed defect (reproduced 2026-08-20):** `review-reminders-post.*` is supposed to reissue the
marker when a gated command fails, but **PostToolUse does not fire when the tool call exits
non-zero** — so the reissue never happens and the marker is lost. Proven by A/B on the same failing
push: with `; echo "EXIT=$?"` appended (overall exit 0) the marker is correctly reissued; bare
(exit 1) it is not, and `.claude/.pending-push-presha` survives — the post-hook deletes that file
unconditionally at entry, so its survival proves the hook never ran. Practical consequence: a
failed push burns the marker and forces a pointless re-review.

Separately latent: the ref-move check uses `git rev-parse '@{u}'`, which never moves for a **tag**
push, so a successful tag push would read as a failure.

**Do not patch these scripts here.** `review-reminders*`, `pre-push-check*`, `dangerous-commands*`,
`check-contract*`, and `update-reviewed*` are PMB-owned (`TEMPLATE_OWNED` in `mb.sh`), overwritten
unconditionally by `mb upgrade` — PMB's own comment on that list reads "no project customization."
A local fix is erased on the next upgrade. Report upstream instead. PMB has a structural fix for
this defect (Layer 1 downgraded to peek-only, with the git hook as sole marker consumer) on an
unmerged branch.

**Live consequence in this repo — `last-reviewed` is not being maintained.** `update-reviewed.*`
(PostToolUse on Write/Edit) reads a flat `.file_path` from the hook payload, but the real payload
nests it under `tool_input`. The field is always null, so the script exits 0 on every call and
never stamps the date. Verified 2026-08-20: three memory-bank files edited that day still carried
`last-reviewed` dates from June and July. Consequence beyond the stale field — `mb doctor` uses
those dates to detect stale memory-bank files, so it is reading a dead sensor and will report
actively-edited files as months stale. Fixed in PMB 1.2.1; this repo is on 1.1.1
(`.pmb-version`), so the fix arrives with `mb upgrade`, not with a local edit.

**Do not "fix" this by loosening the matcher without measurement.** Anchoring to command position
would reduce false trips, but the failure direction is _missing a real push_ (`xargs git push`, a
push inside a loop) — silently disabling a security gate. Same rule as the `claimSupport.ts`
filters: measure, don't inspect.

## Never Do This

- ❌ Default agent execution to parallel without verifying it actually helps on real hardware at
  real scale (see "Sequential Execution" above — a 2026-07-25 attempt looked good on a small,
  unrepresentative test and made things worse at the real default scale)
- ❌ Hard-fail on JSON parse errors (degrade gracefully)
- ❌ Call Anthropic/OpenAI APIs in the review pipeline
- ❌ Replace PMB's `/code-review` — both coexist
- ❌ Use `think: false` for agents (reasoning depth required)
- ❌ Re-litigate Option B (coexistence decision is final)
