# `/ai-review` Distribution + Update-Notifier — Design Spec

**Date:** 2026-07-14  
**Status:** Approved (brainstormed and approved in a separate PMB session; adapted into this repo's spec format without re-litigating decisions)

## Problem

`/ai-review` (`.claude/commands/ai-review.md`) currently only exists as a slash command when
working directly inside this repo's own checkout. `package.json`'s `files` array
(`package.json:27-31`) only publishes `dist/`, `README.md`, `LICENSE` — the `.claude/commands/`
folder is never shipped to npm, so there's no way for any other project to pick it up today.
Getting it into another project (e.g. PMB) currently requires manually copying the file, which
goes stale the moment this repo's copy changes.

Separately, `postinstall`-style distribution only refreshes things _when_ a user reinstalls —
nothing today tells them _that_ they should, so even a fixed distribution mechanism can silently
drift out of date on machines that installed once and never checked back.

This repo's changes only — nothing here touches `personal-memory-bank`. PMB gets an independent,
parallel update-notifier for its own `mb` CLI as separate work; the two are deliberately not
shared code.

## Goals

1. Every project worked in gets `/ai-review` automatically, not just this repo — with exactly one
   source of truth (this repo's own `.claude/commands/ai-review.md`), mechanically refreshed on
   every install, never hand-copied.
2. Close the "how do we know to re-run `npm install -g`" gap: detect when a newer version of
   `ai-review-agent` is available and tell the user, without auto-installing anything.
3. Fail toward silence, not toward false alarms or blocked installs/runs, on any failure in either
   mechanism.

## Non-Goals

- Auto-running `npm install -g` for the user, or auto-updating anything — detection and a clear
  instruction only; a human always makes the install/update decision.
- Detecting "should this project have ACR installed" — this only affects what happens once a user
  has already chosen to install/update the package.
- Any shared code, shared cache, or dependency with PMB beyond the existing runtime relationship
  (PMB's `/change-review` Job 7 already shells out to the `ai-review-agent` binary on PATH — that
  relationship is unaffected by this design and doesn't need to change).
- Project-scoped distribution (e.g. copying into a specific project's `.claude/commands/`) — see
  "Why global, not project-scoped" below.

## Design

### Part 1 — Self-install `/ai-review` via `postinstall`

**Changes:**

1. Add `.claude/commands/` to `package.json`'s `files` array, alongside `dist/`, `README.md`,
   `LICENSE` — so the command file actually ships in the published package.
2. Add a `postinstall` lifecycle script (`scripts/postinstall.js` or similar) that copies
   `.claude/commands/ai-review.md` → `~/.claude/commands/ai-review.md` (the user-level, global
   Claude Code commands directory — not project-scoped). Runs automatically on every
   `npm install -g ai-review-agent` and every `npm update -g ai-review-agent`.
3. Fail-open on the copy itself: if `~/.claude/commands/` can't be created/written (permissions,
   unusual environment), log a warning and exit 0 — never fail the whole npm install over this.

**Why global (`~/.claude/commands/`), not project-scoped:** ties `/ai-review`'s availability to
"is the CLI installed," not "is this a PMB-managed project" — broader coverage, and keeps this
repo fully decoupled from PMB's own template-distribution system. PMB should never need to vendor
a copy of this file.

### Part 2 — Update-notifier for the `ai-review-agent` CLI itself

**Design:**

- On every `ai-review-agent` invocation, check the npm registry's `latest` version for this
  package. Cache the result locally with a TTL (recommend 7 days) — never a live network call on
  every single invocation.
- The check must be async and timeout-bounded (recommend ~2s), and fail silently/open on any
  network error or timeout — never block or slow down an actual review run over this.
- If the cached result shows a newer version than what's installed, print one non-blocking line
  before/after the review output:
  > A newer version of ai-review-agent is available (1.2.0 → 1.3.0). Run: `npm install -g ai-review-agent@latest`
- No auto-install, ever. Detection and a clear instruction only.

**Implementation note:** this is the exact shape of the well-established `update-notifier` npm
package (used by `npm` itself, `yarn`, `create-react-app`, etc.) — worth using that directly
rather than hand-rolling the cache/TTL/async logic from scratch, unless there's a reason not to
take the dependency.

**How this closes the loop with Part 1:** user sees the nudge → runs
`npm install -g ai-review-agent@latest` → `postinstall` re-fires →
`~/.claude/commands/ai-review.md` refreshes automatically. Detection → nudge → update → refresh,
no manual file-copying anywhere, ever, for either problem.

### Design principles carried over from the full design discussion

- **Detection-first, never auto-remediate.** Every mechanism above only ever informs; a human
  always makes the actual install/update decision.
- **Fail toward silence, not toward false alarms**, on any check-mechanism failure (network,
  permissions, parsing). A check that fails open into noise trains people to ignore it.
- **Stay fully decoupled from PMB.** No shared code, no shared cache, no dependency in either
  direction beyond the existing runtime one.
