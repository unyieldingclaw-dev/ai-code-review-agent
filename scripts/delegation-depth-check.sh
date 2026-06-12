#!/usr/bin/env sh
# PreToolUse hook — agent delegation depth enforcement.
# Tracks Agent tool invocations per session; warns when depth exceeds budget (≤1).
# State stored in .pmb-delegation-depth (gitignored). Resets after 2h inactivity.
# Always exits 0 — advisory only, not blocking.

DEPTH_FILE=".pmb-delegation-depth"
MAX_AGE_MINUTES=120
BUDGET_LIMIT=1

depth=0
if [ -f "$DEPTH_FILE" ]; then
    stored_depth=$(grep '^depth=' "$DEPTH_FILE" 2>/dev/null | cut -d= -f2 | tr -d '[:space:]')
    stored_ts=$(grep '^timestamp=' "$DEPTH_FILE" 2>/dev/null | cut -d= -f2- | tr -d '\r')
    if [ -n "$stored_depth" ]; then
        depth="$stored_depth"
    fi
    if [ -n "$stored_ts" ]; then
        ts_epoch=$(date -d "$stored_ts" +%s 2>/dev/null || date -j -f "%Y-%m-%d %H:%M" "$stored_ts" +%s 2>/dev/null || echo 0)
        now_epoch=$(date +%s)
        age_minutes=$(( (now_epoch - ts_epoch) / 60 ))
        if [ "$age_minutes" -gt "$MAX_AGE_MINUTES" ]; then
            depth=0
        fi
    fi
fi

if [ "$depth" -ge "$BUDGET_LIMIT" ]; then
    printf '[WARN] Agent delegation depth: %d (budget: ≤%d per standards/PERFORMANCE-BUDGET.md)\n' "$((depth + 1))" "$BUDGET_LIMIT"
    printf '       Each nested delegation increases prompt-injection surface. Consider consolidating tasks.\n'
fi

ts=$(date '+%Y-%m-%d %H:%M')
printf 'depth=%d\ntimestamp=%s\n' "$((depth + 1))" "$ts" > "$DEPTH_FILE" 2>/dev/null || true
exit 0
