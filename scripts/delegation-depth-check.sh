#!/usr/bin/env sh
# PreToolUse hook — agent spawn count advisory.
# Counts this session's Agent invocations in a rolling 60-minute window (not nesting depth) and
# warns when the count reaches the budget, then again at every further budget's worth. True nesting
# depth cannot be tracked — no PostToolUse:Agent hook exists. State in .pmb-delegation-depth
# (gitignored): one "<session-id> <epoch-seconds>" line per spawn.
# Always exits 0 — advisory only, not blocking.

# WHY C: the session-id and line checks use bracket ranges, which only mean ASCII in the C locale.
LC_ALL=C
export LC_ALL

DEPTH_FILE=".pmb-delegation-depth"
WINDOW_SECONDS=3600
BUDGET_LIMIT=25  # spawns per session per rolling 60 minutes; see standards/PERFORMANCE-BUDGET.md
FUTURE_SLACK=300  # seconds of clock skew tolerated before a future-dated line is dropped
PRUNE_OVER=200    # rewrite the file to in-window lines only once it holds more lines than this

# WHY the payload first: session_id is part of every hook's input. CLAUDE_CODE_SESSION_ID is the
# fallback; with neither, every session here shares the "unknown" bucket, as before this change.
payload=$(cat 2>/dev/null || true)
sid=$(printf '%s' "$payload" | tr -d '\r\n' | grep -o '"session_id"[[:space:]]*:[[:space:]]*"[A-Za-z0-9_-]*"' | head -1 | sed 's/.*"\([A-Za-z0-9_-]*\)"$/\1/')
[ -n "$sid" ] || sid="${CLAUDE_CODE_SESSION_ID:-}"
case "$sid" in
    '' | *[!A-Za-z0-9_-]*) sid=unknown ;;
esac
[ "${#sid}" -le 128 ] || sid=unknown

now=$(date +%s)
case "$now" in '' | *[!0-9]*) exit 0 ;; esac

# WHY awk with a strict line pattern, never $(( )) on file content: bash evaluates a value such as
# a[$(cmd)] inside arithmetic, so the old depth= parse could run a command planted in this file
# ([NS-67](c)). Lines that do not match are ignored; the 12-digit cap keeps awk's numbers exact.
# WHY $1 "" == sid "": awk compares two numeric-looking strings as numbers, so ids 1e5 and 100000
# would match; the ps1 twin compares strings.
count_lines() {
    tr -d '\r' < "$DEPTH_FILE" 2>/dev/null | awk -v sid="$1" -v now="$now" -v win="$WINDOW_SECONDS" -v slack="$FUTURE_SLACK" '
        /^[A-Za-z0-9_-]+ [0-9]+$/ && length($2) <= 12 && $2 + 0 > now - win && $2 + 0 <= now + slack && $1 "" == sid "" { n++ }
        END { print n + 0 }'
}

count=0
if [ -f "$DEPTH_FILE" ]; then
    count=$(count_lines "$sid")
    case "$count" in '' | *[!0-9]*) count=0 ;; esac
fi

# WHY a systemMessage JSON object, not plain text: a PreToolUse hook's plain stdout never reaches
# the model and is not shown in the visible transcript (per Claude Code's docs). systemMessage ONLY
# (user decision 2026-10-14): the agent budget is the operator's call, and telling the model to
# "consolidate" mid-review would nudge it to drop reviewers. WHY only at each multiple of the
# budget: a notice repeated on every spawn past it is noise the operator learns to ignore.
if [ "$count" -ge "$BUDGET_LIMIT" ] && [ $(( (count - BUDGET_LIMIT) % BUDGET_LIMIT )) -eq 0 ]; then
    where="this session"
    [ "$sid" = unknown ] && where="this checkout (no session id)"
    printf '{"systemMessage":"[WARN] Agent spawn count: %d in %s in the last 60 minutes (budget: ≤%d per standards/PERFORMANCE-BUDGET.md). High agent volume increases prompt-injection surface. Consider consolidating tasks."}\n' "$((count + 1))" "$where" "$BUDGET_LIMIT"
fi

# WHY append-only: Agent calls in one message can run their hooks at once, and a read-then-rewrite
# loses entries under that race; a short append does not. The rare prune can still lose a
# concurrent append, so the count can run low, never high. A legacy depth= file is replaced
# outright: it has no trailing newline, so an append would fuse onto its last line.
if [ -f "$DEPTH_FILE" ] && grep -q '^depth=' "$DEPTH_FILE" 2>/dev/null; then
    : > "$DEPTH_FILE" 2>/dev/null || true
elif [ -f "$DEPTH_FILE" ]; then
    lines=$(wc -l < "$DEPTH_FILE" 2>/dev/null | tr -d ' ')
    case "$lines" in '' | *[!0-9]*) lines=0 ;; esac
    if [ "$lines" -gt "$PRUNE_OVER" ]; then
        tmp="$DEPTH_FILE.tmp.$$"
        tr -d '\r' < "$DEPTH_FILE" 2>/dev/null | awk -v now="$now" -v win="$WINDOW_SECONDS" -v slack="$FUTURE_SLACK" '
            /^[A-Za-z0-9_-]+ [0-9]+$/ && length($2) <= 12 && $2 + 0 > now - win && $2 + 0 <= now + slack' > "$tmp" 2>/dev/null \
            && mv -f "$tmp" "$DEPTH_FILE" 2>/dev/null
        rm -f "$tmp" 2>/dev/null
    fi
fi
printf '%s %s\n' "$sid" "$now" >> "$DEPTH_FILE" 2>/dev/null || true
exit 0
