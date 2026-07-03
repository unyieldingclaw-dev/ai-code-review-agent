#!/usr/bin/env sh
# PostToolUse hook — companion to review-reminders.sh (PreToolUse). If a git commit/push
# that consumed a review-ok marker then failed, reissues the marker so a rejected attempt
# (e.g. a separate pre-commit hook, nothing staged, a merge conflict) doesn't force a
# pointless re-review -- the diff hasn't changed, so the same review still applies.
#
# WHY compare git ref state instead of parsing tool_response: the exact PostToolUse
# response schema isn't worth depending on when the question can be answered from ground
# truth instead -- if HEAD (for commit) or the upstream ref (for push) didn't move, the
# command failed, full stop.

sha256() {
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum | cut -d' ' -f1
    elif command -v shasum >/dev/null 2>&1; then
        shasum -a 256 | cut -d' ' -f1
    else
        printf ''
    fi
}

input=$(cat 2>/dev/null)
[ -z "$input" ] && exit 0

cmd=""
case "$input" in
    *'git commit'*) cmd="commit" ;;
    *'git push'*) cmd="push" ;;
esac
[ -z "$cmd" ] && exit 0

root=$(git rev-parse --show-toplevel 2>/dev/null)
[ -z "$root" ] && exit 0

if [ "$cmd" = "commit" ]; then
    preshafile="$root/.claude/.pending-commit-presha"
    if [ -f "$preshafile" ]; then
        presha=$(cat "$preshafile" 2>/dev/null | tr -d '[:space:]')
        rm -f "$preshafile"
        postsha=$(git rev-parse HEAD 2>/dev/null)
        if [ -n "$presha" ] && [ -n "$postsha" ] && [ "$postsha" = "$presha" ]; then
            git diff HEAD 2>/dev/null | sha256 > "$root/.claude/.code-review-ok"
        fi
    fi
elif [ "$cmd" = "push" ]; then
    preshafile="$root/.claude/.pending-push-presha"
    if [ -f "$preshafile" ]; then
        presha=$(cat "$preshafile" 2>/dev/null | tr -d '[:space:]')
        rm -f "$preshafile"
        postsha=$(git rev-parse '@{u}' 2>/dev/null)
        if [ -n "$presha" ] && [ -n "$postsha" ] && [ "$postsha" = "$presha" ]; then
            diff=$(git diff origin/main...HEAD 2>/dev/null)
            if [ $? -ne 0 ]; then
                diff=$(git diff HEAD 2>/dev/null)
            fi
            printf '%s' "$diff" | sha256 > "$root/.claude/.change-review-ok"
        fi
    fi
fi
exit 0
