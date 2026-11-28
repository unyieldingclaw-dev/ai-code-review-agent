#!/bin/bash
#
# Auto-update last-reviewed frontmatter in memory-bank files after edits.
#
# Called by the PostToolUse hook after Write/Edit tool calls. Reads tool input
# JSON from stdin, checks if the edited file is inside memory-bank/, and updates
# the last-reviewed: frontmatter line with today's date. Silent on success; failures
# are appended to .pmb-hook-errors.log and the hook still exits 0.

set -e

# WHY log instead of failing: this hook must never block agent work, but failing silently
# hid both bugs PR #59 fixed. .pmb-hook-errors.log is where update-reviewed.ps1 already logs,
# and mb doctor check 16 reports it.
log_error() {
    printf '[%s] [HOOK] update-reviewed.sh: %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" \
        >> .pmb-hook-errors.log 2>/dev/null || true
}

# WHY plain `cat` (fd 0), not `cat /dev/stdin`: Claude Code passes the tool input as JSON on
# stdin. When a native Windows process launches Git Bash, fd 0 is a native pipe that
# /dev/stdin -> /proc/self/fd/0 -> pipe:[0] cannot reopen by path (ENOENT). The other
# stdin-reading hooks already read fd 0 directly.
INPUT=$(cat 2>/dev/null || true)
if [ -z "$INPUT" ]; then log_error "empty stdin, nothing to stamp"; exit 0; fi

# WHY: Use python3 for JSON parsing — available on all supported platforms (Mac, Linux).
# Falls back to exit 0 if python3 is missing rather than blocking agent work.
# WHY tool_input.file_path, not file_path: the real payload nests everything under
# "tool_input" (e.g. {"tool_name":"Edit","tool_input":{"file_path":"..."}}), matching
# the same fix already applied in check-contract.ps1 (confirmed there via a live hook
# payload). This script had the same flat-read bug and, unlike
# check-contract.sh/dangerous-commands.sh, was never included in that fix -- FILE_PATH
# was always empty, so the script silently exited 0 on every call without ever
# updating last-reviewed.
FILE_PATH=$(echo "$INPUT" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print(d.get('tool_input', {}).get('file_path', ''))
except Exception:
    print('')
" 2>/dev/null || true)

if [ -z "$FILE_PATH" ]; then exit 0; fi

# WHY: Normalize path separators before checking — may receive mixed slashes.
NORMALIZED=$(echo "$FILE_PATH" | tr '\\' '/')
if [[ "$NORMALIZED" != */memory-bank/* ]]; then exit 0; fi

# WHY use the normalized path from here on: perl -i places its temp file by splitting the path
# on '/', so a backslash-only Windows path puts the temp file in the cwd. Cygwin perl unlinks
# the original before renaming the temp over it, so when the cwd is on another drive the rename
# fails and the file is lost. That loss was seen on Side-Quest-Atlas's Windows CI; it was not
# reproduced on a single-drive machine, where the temp-in-cwd and unlink-before-rename steps were
# confirmed with strace. One path also keeps the -f check, the grep and the edit on the same
# file. Trade-off: a POSIX filename containing a literal backslash is now looked up by its slash
# form, so the file at that path (a different file) is stamped if it exists, else skipped.
FILE_PATH="$NORMALIZED"

if [ ! -f "$FILE_PATH" ]; then exit 0; fi

# WHY: Only update if last-reviewed: already exists in frontmatter.
# Don't add frontmatter to files that don't have it — that's a human decision.
# WHY `--` here and on perl: a path starting with '-' would otherwise be read as an option.
if ! grep -q -- 'last-reviewed:' "$FILE_PATH"; then exit 0; fi

TODAY=$(date +%Y-%m-%d)

# WHY: Use perl -i for cross-platform in-place sed (BSD sed and GNU sed have
# incompatible -i syntax; perl works identically on macOS and Linux).
# WHY [^\r\n]* and no trailing $: `.*` also consumes the \r of a CRLF line, which left the
# stamped line LF-only in a CRLF file. A `$` after [^\r\n]* cannot match before that \r, so
# CRLF files would not be stamped at all.
if ! perl_err=$(perl -i -pe "s/^last-reviewed:[^\r\n]*/last-reviewed: $TODAY/" -- "$FILE_PATH" 2>&1); then
    log_error "perl could not stamp $FILE_PATH: $(printf '%s' "$perl_err" | tr '\r\n' '  ')"
elif [ ! -f "$FILE_PATH" ]; then
    # WHY check even when perl exits 0: a lost file is the outcome that matters, whatever
    # perl reported (the PR #59 loss was a failed rename after the original was unlinked).
    log_error "$FILE_PATH is missing after the edit"
fi

exit 0
