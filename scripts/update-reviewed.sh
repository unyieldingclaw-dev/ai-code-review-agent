#!/bin/bash
#
# Auto-update last-reviewed frontmatter in memory-bank files after edits.
#
# Called by the PostToolUse hook after Write/Edit tool calls. Reads tool input
# JSON from stdin, checks if the edited file is inside memory-bank/, and updates
# the last-reviewed: frontmatter line with today's date. Silent on success.

set -e

# WHY: Reads from stdin because Claude Code PostToolUse hooks pass tool input as JSON.
INPUT=$(cat /dev/stdin 2>/dev/null || true)
if [ -z "$INPUT" ]; then exit 0; fi

# WHY: Use python3 for JSON parsing — available on all supported platforms (Mac, Linux).
# Falls back to exit 0 if python3 is missing rather than blocking agent work.
FILE_PATH=$(echo "$INPUT" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print(d.get('file_path', ''))
except Exception:
    print('')
" 2>/dev/null || true)

if [ -z "$FILE_PATH" ]; then exit 0; fi

# WHY: Normalize path separators before checking — may receive mixed slashes.
NORMALIZED=$(echo "$FILE_PATH" | tr '\\' '/')
if [[ "$NORMALIZED" != */memory-bank/* ]]; then exit 0; fi

if [ ! -f "$FILE_PATH" ]; then exit 0; fi

# WHY: Only update if last-reviewed: already exists in frontmatter.
# Don't add frontmatter to files that don't have it — that's a human decision.
if ! grep -q 'last-reviewed:' "$FILE_PATH"; then exit 0; fi

TODAY=$(date +%Y-%m-%d)

# WHY: Use perl -i for cross-platform in-place sed (BSD sed and GNU sed have
# incompatible -i syntax; perl works identically on macOS and Linux).
perl -i -pe "s/^last-reviewed:.*\$/last-reviewed: $TODAY/" "$FILE_PATH" 2>/dev/null || true

exit 0
