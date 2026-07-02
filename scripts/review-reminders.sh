#!/usr/bin/env sh
# PreToolUse hook — blocks git commit/push until the matching review slash command has run.
# /code-review writes .claude/.code-review-ok on an Approve verdict; /change-review writes
# .claude/.change-review-ok when no finding is Blocking. Each marker authorizes exactly one
# commit or push -- this hook deletes it the moment it's consumed, so the next change needs a
# fresh review.
#
# WHY hookSpecificOutput.permissionDecision, not top-level "continue": top-level
# {"continue": false} only stops the agent's turn *after* the tool call has already run --
# it does not prevent execution. Verified empirically: an earlier version of this hook using
# {"continue": false} let a real `git commit` through untouched, then interrupted the next
# turn. hookSpecificOutput.permissionDecision = "deny" is the mechanism that actually denies
# the tool call before it executes.

input=$(cat 2>/dev/null)
[ -z "$input" ] && exit 0

cmd=$(printf '%s' "$input" | grep -o '"command":"[^"]*"' | sed 's/"command":"//;s/"$//' 2>/dev/null)
[ -z "$cmd" ] && exit 0

root=$(git rev-parse --show-toplevel 2>/dev/null)
[ -z "$root" ] && exit 0

deny() {
    printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}\n' "$1"
}

case "$cmd" in
    "git commit"*|*"&& git commit"*|*"; git commit"*|*"| git commit"*)
        marker="$root/.claude/.code-review-ok"
        if [ -f "$marker" ]; then
            rm -f "$marker"
        else
            deny "Run /code-review before committing -- it writes the review-ok marker this hook checks."
        fi
        ;;
    "git push"*|*"&& git push"*|*"; git push"*|*"| git push"*)
        marker="$root/.claude/.change-review-ok"
        if [ -f "$marker" ]; then
            rm -f "$marker"
        else
            deny "Run /change-review before pushing -- it writes the review-ok marker this hook checks."
        fi
        ;;
esac
exit 0
