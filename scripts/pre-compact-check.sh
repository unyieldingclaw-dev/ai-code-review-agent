#!/usr/bin/env sh
# PreCompact hook — warn if memory bank is stale and no handoff was taken.
#
# Fires before Claude Code auto-compacts context. Goal: surface a reminder
# so Claude updates memory-bank/ before context is permanently summarized.
# Always exits 0 — advisory only, never blocks compaction.
#
# Two conditions suppress the warning (either is sufficient):
#   1. handoff.md exists — user invoked the Handoff protocol; state is captured.
#   2. Any memory-bank/*.md was modified within the last 8 hours — memory bank
#      was updated this session; compaction summary will have up-to-date context.

# Drain stdin silently — PreCompact hooks receive a JSON payload we don't need.
# WHY: Leaving stdin open can cause the hook to hang on some shells.
cat > /dev/null 2>&1 || true

# Condition 1: handoff taken this session — state is captured elsewhere.
if [ -f "handoff.md" ]; then
    exit 0
fi

# Condition 2: memory bank updated recently (within 8 hours = one work session).
# WHY: -mmin -480 is POSIX-compatible on both GNU find (Linux) and BSD find (macOS).
# Falls back to no-op if memory-bank/ doesn't exist yet.
if [ -d "memory-bank" ]; then
    recent=$(find memory-bank -name '*.md' -mmin -480 2>/dev/null | head -1)
    if [ -n "$recent" ]; then
        exit 0
    fi
fi

# Neither condition met — warn before compaction proceeds.
printf '[PRE-COMPACT WARNING] Memory bank appears stale and no handoff was taken.\n'
printf '  Context is about to be compacted. To preserve in-flight state:\n'
printf '  1. Update memory-bank/activeContext.md with current focus and next steps\n'
printf '  2. Update memory-bank/progress.md with any completed work this session\n'
printf '  3. Or type "Handoff" to capture full session state before compacting\n'
printf '  Compaction will proceed regardless — this warning is advisory only.\n'

exit 0
