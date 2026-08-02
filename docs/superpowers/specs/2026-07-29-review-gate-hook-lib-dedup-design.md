---
status: draft
created: 2026-07-29
scope: cross-repo
risk: medium
source: human-approved
related_projects:
  - ai-code-review-agent (ACR)
  - personal-memory-bank (PMB)
---

# Review-Gate Hook Helper Dedup — Design Spec

**Date:** 2026-07-29
**Status:** Draft — pending review in a PMB session before implementation
**Scope:** Cross-repo — authored in `ai-code-review-agent` (ACR); every file it describes
changing lives in `personal-memory-bank` (PMB). No ACR file is affected by this design.

**This spec was written and reviewed in ACR as a design-only session.** No PMB files were
changed while producing this document. Implementation must happen in a PMB session/worktree.
Throughout this document, "PMB" always refers to `personal-memory-bank`; ACR's own
`scripts/review-reminders.sh`/`.ps1` are a separate, differently-shaped implementation with
none of the functions discussed below (confirmed: zero matches for `sha256_file`, `diff_hash`,
or `resolve_cd_root` in ACR's own `scripts/review-reminders*.sh`) — do not apply this design to
ACR's hook scripts.

## Background

PMB ships a PreToolUse/PostToolUse hook pair that gates `git commit`/`git push` behind a
diff-hash-bound review marker written by `/code-review` and `/change-review`. It exists in two
languages (bash, PowerShell) and two locations (the live `scripts/` copy PMB uses on itself, and
the `templates/scripts/` copy `mb init`/`mb upgrade` distribute to downstream projects):

- `scripts/review-reminders.sh` / `.ps1` (PreToolUse)
- `scripts/review-reminders-post.sh` / `.ps1` (PostToolUse)
- `templates/scripts/*` — mirrors of all 4 above

A `/change-review` pass flagged (Medium) that several helper functions are duplicated verbatim
across these files: any future fix has to be manually ported to all 4 copies, and a missed one
silently reintroduces whatever the other 3 fixed. This has already happened once (a
trailing-newline hashing bug fixed in one shell's recipe before the other's), which is why a
byte-parity test suite (`tests/test-review-reminders.sh`) exists today.

## Goals

- Eliminate the verbatim duplication of `sha256_file`/`diff_hash`/`resolve_cd_root`
  (bash) and `Get-FileHashHex`/`Get-CommitDiffHash`/`Get-PushDiffHash` (PowerShell) across the
  4 hook files, so a future fix is written once per language, not ported by hand 4 times.
- Do so without weakening the hook's existing fail-open convention or its worktree-root-safe
  path resolution — both are load-bearing, previously-hard-won properties.
- Leave the marker format, hash algorithm, and PreToolUse/PostToolUse gating logic unchanged.

## Non-Goals / Out of Scope

(See the `## Out of Scope` section at the end of this document — kept there since some items
reference specifics introduced later in Design.)

## Actual duplication surface (corrects the original finding)

The original finding catalogued 4 duplicated functions per language (`sha256_file`,
`diff_hash`, `extract_command`, `resolve_cd_root`/equivalent). Reading the real files, the
surface is different:

**Bash** — 3 functions duplicated verbatim across both `.sh` files:

- `sha256_file(file)`
- `diff_hash(...)` (mktemp + redirect + hash + cleanup, with an EXIT trap)
- `resolve_cd_root()` — already embeds the JSON `tool_input.command` extraction inline via a
  `python3` heredoc. There is no separate `extract_command()`.

**PowerShell** — duplication is uneven, and worse in one place than the finding assumed:

- `Get-FileHashHex($Path)` — duplicated verbatim, both files.
- `Get-CommitDiffHash` / `Get-PushDiffHash` — defined in `review-reminders.ps1`, but
  `review-reminders-post.ps1` does **not** call them. It inlines the same diff+hash pattern a
  third, slightly different way (no `Get-FileHashHex` reuse for that specific call site). This
  is a genuine (if minor) behavior divergence today, not just a duplication concern — see the
  Testing section below for how this refactor's fix to it gets verified.
- The cd-chain-walk + JSON command extraction (~20 lines) is duplicated as **raw inline code**
  in both `.ps1` files — never wrapped in a function at all today.

So this refactor is not purely mechanical extraction. For PowerShell it also means formalizing
an unnamed duplicated block into a new function, and making `-post.ps1` actually reuse the
shared diff-hash functions instead of maintaining its own third copy — a deliberate, small
behavior change that needs its own verification, not an assumption that nothing changed.

## Decision: shared dot-sourced library (not documentation-only)

Two options were considered:

- **Document as a deliberate tradeoff** (add one canonical WHY comment, keep duplication) —
  zero new failure surface, but does not fix the actual recurring cost: a future fix still
  needs manual porting to 4 files, just now an acknowledged burden instead of a silent one.
- **Extract into a shared dot-sourced library** — eliminates the duplication. Chosen.

The library approach was initially scoped against 4 open questions (path resolution
reliability, whether `mb init`/`upgrade` copy arbitrary files or a fixed list, CI
template-integrity coverage, and blast radius of a shared-lib bug). Investigation during this
design session clarified the first three with concrete findings from reading the actual PMB
code (see below) — clarified, not necessarily "resolved as safe": the CI/mb-doctor question in
particular clarified into a real, currently-unmitigated gap that this design now requires
closing (see "Detection gap" below), not a question that turned out to be a non-issue. The
fourth (blast radius) is an accepted, deliberate tradeoff, addressed explicitly below.

## Design

### New files

- `scripts/_review-gate-lib.sh` — `sha256_file()`, `diff_hash()`, `resolve_cd_root()`
- `scripts/_review-gate-lib.ps1` — `Get-FileHashHex`, `Get-CommitDiffHash`, `Get-PushDiffHash`,
  new `Resolve-CdRoot($cmd)`
- Mirrored at `templates/scripts/_review-gate-lib.sh` / `.ps1`

**Calling contracts, stated explicitly (both must be documented in each lib file's header):**

- Bash `resolve_cd_root()` stays **parameterless**, relying on the caller having already set
  the global `$input` (raw JSON stdin payload) before calling it — today's implicit contract,
  preserved as-is rather than changed to take a parameter, to keep the extraction surgical.
  This is safe to leave implicit because nothing else in either bash hook file needs the
  _parsed_ command value — the surrounding `case "$input" in *'git commit'*)` matching in both
  bash files operates on the **raw** stdin string, not a parsed field, so JSON parsing only
  ever happens inside `resolve_cd_root()` itself.
- PowerShell `Resolve-CdRoot($cmd)` **takes the already-parsed `$cmd` string as an explicit
  parameter** — a deliberate divergence from bash's implicit-global convention, not an
  oversight. Both PowerShell hook files already parse `$raw` into `$cmd` near the top of the
  file (`($raw | ConvertFrom-Json).tool_input.command`) because their _own_ subsequent
  case-matching (`$cmd -match 'git\s+commit\b'`, etc.) operates on the parsed value, not the
  raw payload — unlike bash, PowerShell needs the parsed command string for reasons unrelated
  to root-resolution. Since the caller has already parsed `$cmd` for its own purposes before
  root-resolution runs, having `Resolve-CdRoot` re-parse the raw JSON internally would just be
  redundant, not a reduction in duplication. Taking `$cmd` as an explicit parameter is therefore
  the correct contract for PowerShell, not an inconsistency with bash's design — the two
  languages' surrounding scripts have genuinely different structure at this point.

### Sourcing

Each of the 4 hook files replaces its local function definitions with one sourcing line at the
very top of the file, before any `cd`/`Set-Location`:

- bash: `. "$(dirname "$0")/_review-gate-lib.sh" 2>/dev/null || exit 0`
- ps1: dot-source `$PSScriptRoot\_review-gate-lib.ps1` inside the file's existing top-of-file
  try/catch, falling through to `exit 0` on failure.

**Path resolution is confirmed safe.** `dirname "$0"` / `$PSScriptRoot` resolve correctly
regardless of the worktree/subagent ambient-cwd bug this repo already fought (see
`docs/superpowers/specs/2026-07-22-review-hook-worktree-root-fix-design.md` in PMB), because
the source happens before any `cd`, using the same relative-path convention that already gets
these scripts invoked successfully by `settings.json`. `$PSScriptRoot` is PowerShell's built-in
mechanism for exactly this and is more robust than the bash `$0` convention. This claim is
backed by reasoning about the existing invocation contract, not yet by an automated regression
test — see Testing below for the test this design requires to close that gap.

**Dot-sourcing variable scope.** Sourcing pulls the lib's internal variable names (bash:
`file`, `tmp`, `rc`; PowerShell: no `param`-scoped locals since these are top-level script
functions) into the caller's scope. Before implementation, grep each of the 4 hook files for
reuse of these exact names elsewhere in the caller and rename on either side if any collision
exists (none is known today, but this wasn't checked as part of this design and is cheap to
verify at implementation time).

`deny()`/`consume_marker()` (bash) and `Deny`/`Test-AndConsumeMarker` (PowerShell) stay local to
the PreToolUse files only — they are not duplicated today (only one copy of each exists), so
they are out of scope for this dedup.

### Fail-open contract (new failure path — explicit, justified, tested)

A missing/corrupt lib file makes the sourcing line fail and the hook exits 0 (gate skipped) —
matching PMB's established "fail open on missing dependency" convention (same as the
`python3`/`sha256sum` fallbacks already in these files).

**Why this is an acceptable tradeoff, stated explicitly rather than assumed:** this refactor
does introduce a new, single satellite file whose deletion (accidental, or by a rushed agent)
silently disables the gate — a materially different risk shape than today, where the gated
logic lives inside the invoked hook script itself, not a separate uninvoked file that draws
less scrutiny. Two things keep this acceptable rather than a regression:

1. **Threat model**: this gate enforces workflow discipline for an AI coding agent, not a
   hardened access-control boundary against a malicious human — a human attacker already has
   strictly easier bypasses today (`git commit --no-verify`, editing `.claude/settings.json`
   directly). The new risk is about an agent or accident silently disabling review, not about
   closing an attacker's path that was otherwise closed.
2. **Detection must be real, not aspirational** — see "Detection gap" below. The mitigation for
   the new silent-bypass risk is the hardcoded existence check, and that check's own test
   coverage must actually reach the newly-introduced risk (see Testing).

This is a new failure path that didn't exist before the refactor and needs a test per shell,
covering **all 4 independent sourcing call sites** (2 bash files + 2 PowerShell files each get
their own sourcing line — a mistake in one file's line isn't guaranteed to be caught by testing
only one representative file per language): simulate a missing lib file at each of the 4 call
sites and assert the hook exits 0 rather than hanging, crashing, or wrongfully denying.

### Detection gap — hardcoded checks required, not a check "extension"

`mb doctor`'s "Hook scripts present" check (`scripts/mb.sh`, the check function is around lines
720-747 as of this writing) and the CI `template-integrity` job
(`.github/workflows/pmb-health.yml`, around line 362) both work by **dynamically parsing
`templates/.claude/settings.json`'s command strings** to find expected script files. That's why
they'll automatically cover `review-reminders*.sh/.ps1` once those are added to the export lists
(they're invoked directly in a command string) — but the new lib files are **never referenced
in `settings.json`**; they're only reachable by dot-sourcing from inside another script, one hop
away. The dynamic-parsing mechanism structurally cannot see them.

This is not a minor gap: PMB already has a live, concrete instance of this failure class —
`review-reminders*.sh/.ps1` themselves were never added to `mb init`'s copy loop
(`scripts/mb.sh:514-524`) or the `TEMPLATE_OWNED` array (`scripts/mb.sh:1681-1703`), and this
went unnoticed until this design session found it. A lib file with weaker detection coverage
than the files that already slipped through once is a real risk, not a theoretical one.

**Requirement:** add a separate, hardcoded existence assertion (not settings.json-derived) in
both `mb doctor` (`scripts/mb.sh`, near the existing check at ~720-747) and the CI workflow
(`.github/workflows/pmb-health.yml`): "if `review-reminders.sh` is present, `_review-gate-lib.sh`
must also be present" (and the PowerShell equivalent), for both `scripts/` and
`templates/scripts/`. Add a fixture test that deletes the lib file in a scratch copy and asserts
both `mb doctor` and the CI check report failure — not just a general instruction to "add a
test," but this specific delete-and-assert mechanism, so the check's own regression is caught
the same way the original export gap should have been.

The existing shellcheck/PSScriptAnalyzer scan-directory lists already include
`templates/scripts/`, so the new lib files get linted automatically — no change needed there.

### Prerequisite (hard, not a scheduling nicety)

A separate background task (`task_fce968c6`, check current status via `TaskGet`/`TaskList`
before starting implementation) is already in flight to fix the fact that
`review-reminders*.sh/.ps1` are missing from `mb init`'s copy loop and `TEMPLATE_OWNED` today.
**This refactor must not ship ahead of, or independently from, that fix.** Introducing 2 new
files that depend on the same list-based export mechanism, without first hardening that
mechanism's detection (previous section), compounds the exact risk this design is trying to
close.

**`task_fce968c6`'s current scope covers only the 4 existing hook files, not the 2 new lib
files this spec introduces** — do not assume it will automatically extend to cover them. When
implementing this design, either broaden that task's scope explicitly to include the 2 lib
files and the hardcoded existence checks, or land them as an immediate, tightly-sequenced
follow-up in the same PMB session — but confirm explicitly (e.g., in the implementation PR's
description) that all 6 files (4 hook + 2 lib) are covered by the export lists and the new
hardcoded checks before merging, since nothing mechanical enforces this ordering today; it is
a process requirement, not a CI gate.

### Testing

- `tests/test-review-reminders.sh` is black-box (runs the real `.sh`/`.ps1` scripts end-to-end,
  checks marker/hash behavior). It exercises external behavior, so it is expected to catch a
  regression in the unified `-post.ps1` diff-hash computation described above — but this must
  be **verified, not assumed**: before/after this refactor, run the suite against the specific
  scenario where `-post.ps1`'s old inline computation and the canonical
  `Get-CommitDiffHash`/`Get-PushDiffHash` would have differed (the trailing-newline/line-ending
  class of edge case called out in Background), and confirm the suite's existing fixtures
  actually exercise that case. If they don't, add a fixture that does, so the fix to `-post.ps1`
  is verified as a fix rather than shipped as an unverified assumption of "no change."
- New: a unit-level test for `sha256_file()`/`diff_hash()`/`Get-FileHashHex` covering
  trailing-newline and empty-file inputs directly, independent of the end-to-end suite — this
  is the exact edge-case class that caused the original historical bug this design cites as
  precedent for accepting a higher blast radius (see Accepted tradeoff below); relying solely on
  the end-to-end suite happening to cover it is not sufficient given how central this edge case
  is to the design's own risk argument.
- New: fail-open test covering **all 4 sourcing call sites** (not one representative per
  shell) — see Fail-open contract above.
- New: fixture test that deletes the lib file and asserts `mb doctor` and the CI check both
  report failure — see Detection gap above.
- Convert the worktree-root path-resolution check from a manual-only verification step into an
  automated regression test: invoke each hook with a simulated worktree-subdirectory cwd
  (matching the original bug's repro conditions from
  `2026-07-22-review-hook-worktree-root-fix-design.md`) and assert the lib still sources and
  resolves root correctly. This bug class has already recurred once in this codebase and
  deserves durable regression coverage, not a one-time manual check.

### Documentation

Each hook file's current "WHY" comment blocks for the now-shared functions move to the lib
file (one canonical copy instead of 4 near-identical ones). Each hook file keeps a one-line
pointer ("see `_review-gate-lib.sh`/`.ps1` for `sha256_file`/`diff_hash`/`resolve_cd_root` and
their rationale") instead of restating the WHY.

## Accepted tradeoff

A bug in the shared lib now affects all 4 hook paths simultaneously, instead of one file until
the fix is ported to the others. This is a deliberate tradeoff, not a free win: it trades a
slower, incremental porting risk (today) for a larger, immediate blast radius per bug (after
this refactor). It is accepted because the fix — eliminating the duplication that causes
manual-porting misses in the first place — directly addresses the finding's actual complaint,
and because the mitigations above (per-edge-case unit tests for the historically-risky
functions, fail-open tests at all 4 call sites, and hardcoded existence checks with their own
regression tests) are concrete, testable requirements added by this design specifically to
compensate for the larger blast radius — not a generic appeal to "the test suite will probably
catch it."

## Out of Scope

- The `mb init`/`upgrade` export-gap fix itself (tracked separately as `task_fce968c6`) — this
  spec only requires it land first/alongside (with its scope explicitly broadened per the
  Prerequisite section above), not that this design session implement it.
- Any change to `Deny`/`Test-AndConsumeMarker`/`deny`/`consume_marker` — not duplicated today.
- Any change to the PreToolUse/PostToolUse gating logic, marker format, or hash algorithm.
