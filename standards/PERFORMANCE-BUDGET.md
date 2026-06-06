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
| Memory bank entries (lines in `progress.md`) | ≤ 50 | Run `mb archive` |
| Agent delegations per command | ≤ 1 | Refactor to inline or batch |
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
Keep delegation depth to 1.

## mb doctor Integration

`mb doctor` Check 14 counts `.md` files in `standards/` and warns if > 20.
The current count is shown at runtime — run `mb doctor` to see it.

## What to Do When Limits Are Reached

- **Standards > 20:** Review for overlap. Can two standards merge? Is one superseded?
- **Memory entries > 50:** Run `mb archive` on `progress.md` to move completed items.
- **Agent chain > 1:** Inline the sub-task or make it a separate user-invoked command.
