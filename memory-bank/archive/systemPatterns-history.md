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

Fifth through seventh moves, 2026-08-28: the three release-tagging incidents, the
`isPreImageOnlyEvidence` probe-vs-wiring narrative, and the BaseAgent parse-stage mechanics —
the first two to make room for handoff conventions, the third to bring the file back under its
target range. All the rules they support stay upstream.

Ninth move, 2026-08-31: the `main`-hash narrative, archived to make room for the stale-list rule.
The rule and its immutable-identifier exception stay upstream; the two-PR story is below.

Eighth move, 2026-08-31: three verification-lesson narratives (the `elapsedMs` rounds, the
duration-span measurement, and the vitest-4 harness bug), archived to make room for the
peer-coordination protocol and the proxy-assertion pattern. Their rules stay upstream as
one-line statements; the measurements are at the end of this file.

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

## Release-tagging incidents — narrative (2026-08-27)

Three incidents in one session, archived 2026-08-28 to make room for the working conventions
carried in from the handoff. The rule and the guard command stay upstream.

1. `v1.14.0` was tagged from its release branch before the PR merged, so its SLSA provenance
   attests a commit that is not on `main`. Identical content; not worth fixing.
2. `v1.15.0` was tagged onto `main` after a merge that branch protection had _rejected_ — the tag
   named a commit whose `package.json` still read `1.14.0`.
3. The **good** `v1.15.0` tag was then deleted by re-running the cleanup written minutes earlier
   for the bad one, flipping the published GitHub Release back to a draft. Recovered by re-tagging
   `6e2ed34` and re-publishing.

**npm's refusal to republish an existing version limited the damage twice** — the registry
compensating for the process, not the process working. A tag naming an as-yet unpublished version
would have shipped wrong content irreversibly. Prose prevented none of them: a command already
pasted does not re-read the rule it violates.

## "A probe proves the idea, not the wiring" — the isPreImageOnlyEvidence case (2026-08-21)

Archived 2026-08-28. The rule stays upstream under "Falsify Before You Trust It".

`isPreImageOnlyEvidence` was first wired to the section from `sliceDiffByFile`, which stores
`diffSectionCode(section)` — post-image by construction — so the filter could never fire. Every
predicate unit test passed, because the predicate was correct, and a scratch probe agreed, because
it read removed lines from the raw diff instead of going through `sliceDiffByFile`. Only replaying
a real artifact through `OrchestratorAgent.synthesize` exposed it, showing `dropped: 0` where the
probe predicted 1.

## Moved 2026-08-28 — BaseAgent 4-stage parse, stage mechanics

Archived to bring `systemPatterns.md` back under its target range. The **rules** stay upstream:
four stages, never resolve silently to "0 findings" on a response that did not parse, and
`format:'json'` increases truncation rather than preventing it. What lives here is how each
stage works.

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

## Three verification lessons — full narratives (moved 2026-08-31)

Moved out of `systemPatterns.md`'s "Falsify Before You Trust It" section to make room for the
peer-coordination protocol and the proxy-assertion pattern. The rules stay upstream as one-line
statements pointing here; these are the measurements that established them. Nothing deleted.

**When a review round's findings are mostly defects introduced by the previous round's fixes,
the change has had enough passes** (2026-08-27, named by PMB). The `elapsedMs` rounds are the
instance, and the middle one is the whole point: round 1 found retry-inflated elapsed; round 2's
fix recorded the _last_ attempt instead of the _longest_, hiding a slow attempt behind a fast
retry; round 3 caught that. Getting a thing wrong from **opposite directions** while fixing it is
the signal to ship, not to run a fourth round.

**A duration is not a measurement until you say what it spans** (2026-08-27). Wall time
covering retries, printed against a per-attempt ceiling, reads as exceeding a limit no
attempt approached — measured at 611.7 s vs 354.7 s, all retry. State the span in the type.

**A uniform verdict from a verification harness is a harness bug until proven otherwise**
(2026-08-27). A mutation run reported 0 failures for all 13: `--reporter=basic` was removed in
vitest 4, so vitest errored before running a test and the parser read empty output as "passed".
Assert the harness ran (parse `Tests N failed`) before reading it.

## The six proxy assertions — instances (2026-08-30)

The rule ("assert from the thing, not from a proxy for it") stays in `systemPatterns.md`; these are
the instances that established it, all from a single session, all wrong:

1. **Disk size for VRAM fit** — a model's on-disk size read as its memory footprint.
2. **`npm ls` for the registry** — the local dependency tree read as what the published package
   contains. Compounded by `npm link`: `ai-review-agent` on PATH is a symlink to the working tree,
   so "broken on npm" was asserted from uncommitted local code. It happened to be true and had not
   been earned. Use `npm pack ai-review-agent@X` and inspect the tarball.
3. **An unreachable agent name for an ended session** — the PMB peer's name rotates (`7b` → `1d` →
   `c9` → `8b`) without the session ending. Misread twice, and said so out loud both times.
4. **One calibration pass for a quality ranking** — a model switch recommended on one pass each,
   reversed by three. Numbers in `techContext.md`.
5. **One's own interactive runs for "nothing queued"** — the local view of activity read as the
   server's.
6. **A loaded model for a busy server** — `ollama ps` shows what is resident, not whether a
   multi-pass run is in flight. A decaying `UNTIL` means no inference _right now_, not "no run
   active"; a chunked run between chunks looks identical to idle. Acting on that reading killed
   the peer's 979 s devstral run mid-chunk (their exit 4).

Every one was caught by a measurement or by the peer; none by re-reading one's own work.
Review-by-reading produced approximately nothing that session. Adversarial passes and real runs
produced everything — including a misdiagnosis PMB had committed and reported as a verified fix,
and a third instance of a defect created while fixing the first two.

**A seventh instance, and it is PMB correcting their own account rather than ours** (2026-08-31).
They first reported that commit as a **security regression they had introduced** — a UTF-16 BOM
bypass created by the fix itself. Their own opposition pass overturned it: they report an 8-case
byte matrix showing the change was behaviourally identical to the code it replaced, so it fixed
nothing and broke nothing, against a hole that is unreachable anyway. Their accurate statement is
_misdiagnosed, and the stated fix was a no-op on that axis_ — not _created a bypass_.

**Both versions are peer-reported and neither was reproduced here** (their
`tests/dangerous-commands.Tests.ps1` exists; the matrix was not re-run). Recorded as their account,
not as our finding — the hedge this repo's own rule requires for cross-project claims, and the same
rule that later caught their `exit 4` mapping being described in correspondence but absent from
their committed table.

**An eighth instance, committed by this repo, in the sentence warning against exactly it**
(2026-08-31). `techContext.md`'s model-choice paragraph argued that pinned counts rot — and
supplied "26 cases in `calibrate.ts`" as its illustration. The real `CASES` array holds **23**;
`grep -c "name:"` had also matched an interface field and two type annotations. Caught by the
correctness reviewer, which counted the array instead of grepping for a substring. `calibrate.ts`
was last touched ten days earlier, so this was never drift — it was **wrong on arrival**. Removed
rather than corrected to 23: a sentence arguing against pinning a count should not pin one.

**The rule this adds: overcorrecting in the self-critical direction is its own kind of false
record.** A confession is a claim and takes the same evidence as any other. Same family as the
_suggestive_ → _strong_ wording drift, but pointing the other way, which is why it is easy to miss —
an overstated admission reads as rigour. **Our memory bank carried the wrong version for a few
hours**, written from their first account and corrected here before it was ever committed.

## The `main` hash — the two PRs that both shipped stale (2026-08-28)

Moved out of `systemPatterns.md` on 2026-08-31. The rule stays upstream.

Two consecutive PRs tried to keep a recorded `main` hash current and **both shipped stale**. #78
cleared the hash and argued in its own PR body that "a current hash belongs here, since this
section exists to state current state." Merging it was the disproof: the moment #78 landed,
`activeContext.md` claimed `874b784` while `main` was `2711d4e` — stale again, by exactly one
commit, four minutes later.

The defect is **self-invalidating, not merely decaying**: a memory-bank PR moves the very commit it
names, so the value cannot be correct once written. Fixed by removing the hash rather than updating
it a third time.
