# Memory Bank

This directory contains structured project knowledge that persists across AI coding sessions.

## How It Works

The AI reads all files in this directory at the start of every conversation, ensuring it always has full project context without you needing to re-explain anything.

## Files

| File                | Purpose                               | Update Frequency          |
| ------------------- | ------------------------------------- | ------------------------- |
| `projectbrief.md`   | Core requirements, goals, constraints | Rarely                    |
| `systemPatterns.md` | Architecture decisions, code patterns | When patterns established |
| `techContext.md`    | Tech stack, dependencies, environment | When tech changes         |
| `activeContext.md`  | Current focus, recent decisions       | Every session             |
| `progress.md`       | What's done, in progress, planned     | After milestones          |

## Quick Start

1. Fill in each file with your project details
2. Update `activeContext.md` at the end of each session
3. The AI will automatically read these files

## Usage Tips

### Keep Files Focused

- `activeContext.md`: Only current state, not history
- `progress.md`: Move completed items out of "In Progress"
- `systemPatterns.md`: Consolidate similar patterns

### When Context Fills Up

At 80% context, type "Handoff" and the AI will:

1. Create `handoff.md` in project root
2. Stop working
3. You start a new chat
4. New AI reads `handoff.md` and continues

### Quick Commands

- `mb update` - Update all Memory Bank files
- `mb status` - Show file sizes and health
- `mb slim` - Trim activeContext.md

## File Size Guidelines

| File              | Target        | Max |
| ----------------- | ------------- | --- |
| projectbrief.md   | 50-80 lines   | 150 |
| systemPatterns.md | 100-180 lines | 300 |
| techContext.md    | 150-250 lines | 400 |
| activeContext.md  | 50-100 lines  | 150 |
| progress.md       | 100-250 lines | 400 |

**These maxima are enforced by CI**, not advice — `ci.yml`'s "Memory bank size limits" step fails
the build on overflow. `archive/` is excluded, which is what it exists for: move the evidence there
and keep the rule in the live file.

**Leave headroom; do not land on the cap.** A file sitting at its limit forces the next session to
refactor before it can record anything, and that session is usually the one with the least context
to spare. Aim for the target column, not the max.

**Archive; do not compress.** This rule was written on 2026-08-28 because the opposite was tried
that day. With `activeContext.md` at 149/150 and `systemPatterns.md` at 299/300, a handoff merge
compressed prose to fit — and silently deleted five substantive fragments, two of them corrections a
previous PR existed to make. A review caught it; nothing else would have. **Moving text to
`archive/` is lossless and compressing is not**, so when a file is full, move a section out or
relocate it to the file it actually belongs in. If a section is not focus, blockers, or next steps,
it does not belong in `activeContext.md` at all.

## More Information

See the full [Memory Bank Standard](https://github.com/unyieldingclaw-dev/personal-memory-bank) for detailed documentation.
