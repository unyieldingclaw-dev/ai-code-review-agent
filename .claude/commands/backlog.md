---
description: "Manage a deliberate backlog of deferred ideas, future investigations, and things to revisit later. Use when the user wants to defer something, save an idea for later, flag something for more investigation, or asks what's in their backlog. If Claude notices such a moment itself, it offers to add an item and waits for the user to confirm; it never adds one silently."
allowed-tools:
  - Bash(mb backlog)
  - Bash(mb backlog *)
---

# /backlog

Manage backlog items with `mb backlog`. Each item is one file in `docs/backlog/<slug>.md` with
frontmatter (`status`, `created`, `last-reviewed`, `staleness-threshold`, `related_plan`).

## Usage

```
/backlog                          # same as: mb backlog list
/backlog add "<title>" ["<desc>"] # capture a new item; confirm the title with the user first if they did not give one
/backlog list [--all]             # open items only by default; --all shows every status
/backlog show <slug>
/backlog promote <slug>           # seeds a plan draft in .claude/plans/; it still needs a real plan before work starts
/backlog dismiss <slug>
/backlog resolve <slug>           # for an item fixed directly, without a plan
/backlog review <slug>            # an open item is still relevant: sets last-reviewed to today (clears the staleness warning)
```

## Statuses

- `open`: not yet acted on. The only status `list` shows by default.
- `promoted`: seeded into `.claude/plans/` as a plan draft. The file stays as an audit trail.
- `dismissed`: dropped as no longer relevant, kept for history.
- `resolved`: fixed directly, outside the promote-and-plan path.

`list --all` shows every status, including any value written by hand.

## Behavior

- If the project's own instructions (for example `CLAUDE.md`) name a different place for a kind
  of item, such as review follow-ups, put that kind there instead of using `mb backlog add`.
- If the user's message maps directly to a subcommand above, run it.
- If Claude notices a moment that fits the description above but the user did not ask, offer to
  add it ("want me to add that to the backlog?") and wait for a yes before running
  `mb backlog add`.
- If the user asks what is in their backlog, run `mb backlog list` and present the output plainly.
