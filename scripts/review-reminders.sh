#!/usr/bin/env sh
# PreToolUse hook — blocks git commit/push until the matching review slash command has run.
# /code-review writes .claude/.code-review-ok on an Approve verdict; /change-review writes
# .claude/.change-review-ok when no finding is Blocking. Each marker authorizes exactly one
# commit or push attempt -- consumed the moment this hook sees it, so the next change needs a
# fresh review. Known limitation: the marker is consumed even if the commit/push itself then
# fails (e.g. a separate pre-commit hook rejects it) -- an accepted false-strict tradeoff, not
# a security gap, since the failure mode is "re-run the review," not "skip it."
#
# WHY hookSpecificOutput.permissionDecision, not top-level "continue": top-level
# {"continue": false} only stops the agent's turn *after* the tool call has already run --
# it does not prevent execution. Verified empirically: an earlier version of this hook using
# {"continue": false} let a real `git commit` through untouched, then interrupted the next
# turn. hookSpecificOutput.permissionDecision = "deny" is the mechanism that actually denies
# the tool call before it executes.
#
# WHY match raw stdin instead of extracting the "command" field: a `grep -o '"command":"[^"]*"'`
# extraction breaks on any JSON-escaped quote inside the command (e.g. `git commit -m "wip"`),
# silently truncating the match and letting anything after it -- including a chained
# `&& git push` -- through unchecked. Since "git commit"/"git push" only plausibly appear in
# this hook's stdin inside the command field itself, matching the raw payload directly is
# robust to that escaping edge case, at the cost of a theoretical false-positive if those exact
# substrings appeared in some unrelated field. For a security gate, over-blocking (recoverable
# by re-running the review) is the safe direction; under-blocking is not.

input=$(cat 2>/dev/null)
[ -z "$input" ] && exit 0

root=$(git rev-parse --show-toplevel 2>/dev/null)
[ -z "$root" ] && exit 0

deny() {
    printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}\n' "$1"
}

case "$input" in
    *'git commit'*)
        marker="$root/.claude/.code-review-ok"
        if [ -f "$marker" ]; then
            rm -f "$marker"
        else
            deny "Run /code-review before committing -- it writes the review-ok marker this hook checks."
        fi
        ;;
    *'git push'*)
        marker="$root/.claude/.change-review-ok"
        if [ -f "$marker" ]; then
            rm -f "$marker"
        else
            deny "Run /change-review before pushing -- it writes the review-ok marker this hook checks."
        fi
        ;;
esac
exit 0
