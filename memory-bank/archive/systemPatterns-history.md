# System Patterns — archived detail

Forensic detail moved out of `memory-bank/systemPatterns.md`. The **rules** these establish stay in
that file; what lives here is the evidence that established them, which is history rather than
guidance. Nothing was deleted.

First move, 2026-08-27: two PMB-owned script defects, both still true and both still summarised
upstream, archived when `systemPatterns.md` hit its 300-line CI cap recording the timing-measurement
lessons.

Second move, 2026-08-27: the parallel-execution measurements, archived to make room for the
release-tag guard. The decision and its load-bearing reasons stay upstream; these are the
numbers behind them.

Third move, 2026-08-27: the prompt-wording four-confirmation narrative, archived to make room
for the release-tagging incidents. The rule it establishes stays upstream.

Fourth move, 2026-08-27: the DependenciesAgent unfalsifiable-assertion illustration, archived
to make room for the squash-merge branch-cleanup rule. The rule it illustrates stays upstream.

## PostToolUse marker-reissue defect — reproduction (2026-08-20)

**Confirmed defect (reproduced 2026-08-20):** `review-reminders-post.*` is supposed to reissue the
marker when a gated command fails, but **PostToolUse does not fire when the tool call exits
non-zero** — so the reissue never happens and the marker is lost. Proven by A/B on the same failing
push: with `; echo "EXIT=$?"` appended (overall exit 0) the marker is correctly reissued; bare
(exit 1) it is not, and `.claude/.pending-push-presha` survives — the post-hook deletes that file
unconditionally at entry, so its survival proves the hook never ran. Practical consequence: a
failed push burns the marker and forces a pointless re-review.

Separately latent: the ref-move check uses `git rev-parse '@{u}'`, which never moves for a **tag**
push, so a successful tag push would read as a failure.

## `last-reviewed` / update-reviewed payload-shape defect — diagnosis (2026-08-20)

**Live consequence in this repo — `last-reviewed` is not being maintained.** `update-reviewed.*`
(PostToolUse on Write/Edit) reads a flat `.file_path` from the hook payload, but the real payload
nests it under `tool_input`. The field is always null, so the script exits 0 on every call and
never stamps the date. Verified 2026-08-20: three memory-bank files edited that day still carried
`last-reviewed` dates from June and July. Consequence beyond the stale field — `mb doctor` uses
those dates to detect stale memory-bank files, so it is reading a dead sensor and will report
actively-edited files as months stale. Fixed in PMB 1.2.1; this repo is on 1.1.1
(`.pmb-version`), so the fix arrives with `mb upgrade`, not with a local edit.

## Parallel-vs-sequential execution — measurements (2026-07-25)

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

## Prompt wording vs measured defect rate — the fourth confirmation (2026-08-21)

**Prompt wording does not move a measured defect rate here — four independent confirmations.** The
fourth was argued the other way first: the prior three were _hallucination_, whereas reporting
deleted code looked like a _missing frame_, and supplying genuinely absent information seemed
different in kind. It was not. An explicit instruction ("lines starting with '-' have been DELETED
… never report a problem that exists only on a '-' line") measured **7/7 still reporting** the
deleted defect against 8/8 before, and was reverted rather than kept as decoration. Measuring was
still right — the datapoint beats the assumption either way — but the prior stands: reach for a
deterministic filter, and treat prompt wording as unproven until measured.

## Unfalsifiable regression assertion — the DependenciesAgent case

**A regression test that passes against the unfixed code proves nothing.** This repo shipped an
assertion that could not fail: `DependenciesAgent`'s calibration cases were both `expectEmpty`, so an
agent returning `[]` passed — proven by patching it to `return []`.
