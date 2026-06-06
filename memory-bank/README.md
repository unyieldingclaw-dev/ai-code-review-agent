# Memory Bank

This directory contains structured project knowledge that persists across AI coding sessions.

## How It Works

The AI reads all files in this directory at the start of every conversation, ensuring it always has full project context without you needing to re-explain anything.

## Files

| File | Purpose | Update Frequency |
|------|---------|-----------------|
| `projectbrief.md` | Core requirements, goals, constraints | Rarely |
| `systemPatterns.md` | Architecture decisions, code patterns | When patterns established |
| `techContext.md` | Tech stack, dependencies, environment | When tech changes |
| `activeContext.md` | Current focus, recent decisions | Every session |
| `progress.md` | What's done, in progress, planned | After milestones |

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

| File | Target | Max |
|------|--------|-----|
| projectbrief.md | 50-80 lines | 150 |
| systemPatterns.md | 100-180 lines | 300 |
| techContext.md | 150-250 lines | 400 |
| activeContext.md | 50-100 lines | 150 |
| progress.md | 100-250 lines | 400 |

## More Information

See the full [Memory Bank Standard](https://github.com/unyieldingclaw-dev/personal-memory-bank) for detailed documentation.
