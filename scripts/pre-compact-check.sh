#!/usr/bin/env sh
# PreCompact hook — quality gate before context compaction.
# Blocks compaction unless the memory bank shows substantive session work:
#   1. activeContext.md has ≥3 substantive content lines (not just a last-reviewed touch)
#   2. progress.md contains at least one entry dated today
# Exits 2 to block compaction; exits 0 to allow. Fails open on errors.

today=$(date +%Y-%m-%d)

# Bypass: handoff.md present means state is captured via handoff protocol
if [ -f "handoff.md" ]; then
    exit 0
fi

BLOCK_REASONS=()

# Check 1: activeContext.md — must have ≥3 substantive lines
# Substantive = non-frontmatter, non-heading, non-empty, ≥20 chars
ACTIVE_CTX="memory-bank/activeContext.md"
if [ -f "$ACTIVE_CTX" ]; then
    substantive=0
    in_fm=0
    fm_count=0
    while IFS= read -r line; do
        if [ "$line" = "---" ]; then
            fm_count=$((fm_count + 1))
            [ "$fm_count" -eq 1 ] && in_fm=1 || in_fm=0
            continue
        fi
        [ "$in_fm" -eq 1 ] && continue
        case "$line" in
            \#*|'') continue ;;
        esac
        length=${#line}
        # strip leading whitespace approximation
        trimmed=$(echo "$line" | sed 's/^[[:space:]]*//')
        trimlen=${#trimmed}
        [ "$trimlen" -ge 20 ] && substantive=$((substantive + 1))
    done < "$ACTIVE_CTX"
    if [ "$substantive" -lt 3 ]; then
        BLOCK_REASONS+=("activeContext.md has only ${substantive} substantive line(s) (need ≥3) — update it with current session state before compacting")
    fi
else
    BLOCK_REASONS+=("activeContext.md missing — run 'mb init'")
fi

# Check 2: progress.md — must contain at least one entry dated today
PROGRESS_FILE="memory-bank/progress.md"
if [ -f "$PROGRESS_FILE" ]; then
    if ! grep -q "$today" "$PROGRESS_FILE" 2>/dev/null; then
        BLOCK_REASONS+=("progress.md has no entry dated $today — add today's progress before compacting")
    fi
else
    BLOCK_REASONS+=("progress.md missing — run 'mb init'")
fi

if [ "${#BLOCK_REASONS[@]}" -eq 0 ]; then
    exit 0
fi

printf '[PreCompact] Compaction quality gate: %d check(s) failed.\n' "${#BLOCK_REASONS[@]}"
for reason in "${BLOCK_REASONS[@]}"; do
    printf '  - %s\n' "$reason"
done
printf 'Fix the above, then compact. Or create handoff.md to bypass via the Handoff Protocol.\n'
exit 2
