---
authority: stable
review-cycle: 90d
retention: permanent
staleness-threshold: 180d
tags:
  - performance/budget
  - performance/context
last-reviewed: 2026-05-31
compaction_generation: 0
source_type: canonical
confidence: high
lineage: []
---

# Performance Budget

PMB's primary performance cost is LLM context consumption, not compute.
This document defines explicit limits to prevent gradual context bloat.

## Limits

| Dimension | Limit | Action if Exceeded |
|-----------|-------|-------------------|
| Standards files (`standards/`) | ≤ 20 | Archive or merge redundant standards |
| Memory bank entries (lines in `progress.md`) | ≤ 50 | Run `mb clean` |
| Agent spawns per session, rolling 60 minutes | ≤ 25 (provisional) | Consolidate tasks or batch |
| Agent delegation depth (nesting) | 1 | Refactor to inline; not machine-enforced — see below |
| Default scan scope | Changed files first | Full-repo is explicit opt-in only |
| Full-repo scan | Explicit request only | Never triggered automatically |
| Fixture files per security rule | 1 | Keep fixtures minimal |

## Why These Limits

**Standards proliferation** grows context linearly. Every standard added increases tokens
loaded, retrieval work, and reasoning time on every session.

**Duplicate context** is the second risk. Multiple copies of the same content (`.claude/`,
`.cursor/`, generated artifacts) each cost tokens if loaded. Maintain a single source of
truth; generate copies, do not duplicate them independently.

**Agent chains** that call other agents recursively are the primary path to O(n²) complexity.
Keep delegation depth to 1 — but read the next paragraph before treating that as enforced.

**Two different limits, and only one of them is checked.** *Depth* is how deeply delegation nests
(an agent spawning an agent). *Spawn count* is how many agents were started in a window, however
flat. `scripts/delegation-depth-check.{sh,ps1}` measures the SECOND and warns above 25, because the
first is not observable: there is no `PostToolUse:Agent` hook, so nothing can tell a returning
agent from a nesting one. The depth-1 guidance above therefore remains real guidance and is not
machine-enforced, while the number the hook actually prints is a spawn count.

**How the spawn count is sized (2026-11-14).** It counts one session's spawns in the last 60
minutes. Until then it was one counter per checkout, shared by every session there (a desktop-app
worktree session's spawns landed in the main checkout's counter, measured 2026-11-14), reset only
after 2 hours with no spawn, with a budget of 6 that one `/code-review` round (6-8 spawns) crossed
on its own. 25 covers a busy but ordinary hour: a plan review (1), a 4-task subagent-driven
implementation (3 per task, 12), and a full review cycle (up to 9: `/code-review`'s 6-8 plus
`/change-review`'s 1 opposition agent) — 22. It is provisional: it was
sized from what the commands document, not from measured use. The state file now records one line
per spawn, which is the data to re-size it from. It warns on the 26th spawn and again every 25
after (the 51st, the 76th), not on every spawn past the budget.

Recorded because these were conflated for months: this table read "≤ 1" while the shipped hook
had used 6 since `5c0e8c9`, and the hook's own comment cited *this file* as the authority for 6.
Corrected 2026-09-03. If you change the budget, change it in `delegation-depth-check.sh`, its
`.ps1` twin, this table, and `standards/AGENTIC-SAFETY.md` — four hand-synced copies, tested only
for shell-to-shell parity, not against this document.

## mb doctor Integration

`mb doctor` Check 14 counts `.md` files in `standards/` and warns if > 20.
The current count is shown at runtime — run `mb doctor` to see it.

## What to Do When Limits Are Reached

- **Standards > 20:** Review for overlap. Can two standards merge? Is one superseded?
- **Memory entries > 50:** Run `mb clean` on `progress.md` to move completed items.
- **Agent spawns > 25 in a session's last 60 minutes:** Consolidate related tasks into one well-scoped agent, or batch
  them. The hook warns and continues; it never blocks, because spawning is a user decision.
- **Agent chain nesting > 1:** Inline the sub-task or make it a separate user-invoked command. No
  hook detects this — it is caught in review, not at runtime.
