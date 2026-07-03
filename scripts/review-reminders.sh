#!/usr/bin/env sh
# PreToolUse hook — blocks git commit/push until the matching review slash command has run.
# /code-review writes .claude/.code-review-ok on an Approve verdict; /change-review writes
# .claude/.change-review-ok when no finding is Blocking. Each marker authorizes exactly one
# commit or push attempt for a SPECIFIC diff -- see below.
#
# WHY the marker holds a SHA-256 hash of the reviewed diff, not an empty file: an empty
# marker is trivially fakeable with `touch` -- anyone (or a rushed agent) can satisfy the
# gate without actually reviewing anything. Binding the marker to a hash of the exact diff
# means it only authorizes committing/pushing that SPECIFIC diff; if the working tree
# changes after the review, the hash no longer matches and the gate re-engages.
#
# WHY the marker is consumed via an atomic rename (mv), not a separate [ -f ] + rm: check-
# then-delete has a TOCTOU window between the two steps. mv's underlying rename is a single
# filesystem operation -- if the source doesn't exist, the move simply fails, collapsing
# "does it exist" and "claim it" into one step.
#
# WHY this also records a pre-state SHA before consuming the marker: see the companion
# PostToolUse hook (review-reminders-post.sh) -- if the gated commit/push then fails, that
# hook detects the relevant git ref didn't move and reissues the marker, so a rejected
# attempt (e.g. a separate pre-commit hook) doesn't force a pointless re-review.
#
# WHY match raw stdin instead of extracting the "command" field: a `grep -o
# '"command":"[^"]*"'` extraction breaks on any JSON-escaped quote inside the command,
# silently truncating the match and letting anything after it through unchecked. Since
# "git commit"/"git push" only plausibly appear in this hook's stdin inside the command
# field, matching the raw payload directly is robust to that escaping edge case.
#
# WHY hookSpecificOutput.permissionDecision, not top-level "continue": top-level
# {"continue": false} only stops the agent's turn *after* the tool call has already run --
# it does not prevent execution. Verified empirically with a real git commit.
#
# WHY sha256sum with a shasum fallback: sha256sum is standard on Linux and in Git for
# Windows' bundled coreutils, but macOS ships shasum instead. If neither is available,
# fail open (skip the gate entirely) rather than deny everything -- matches this repo's
# established "fail open on missing dependency" convention (see check-contract.sh/python3).

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

root=$(git rev-parse --show-toplevel 2>/dev/null)
[ -z "$root" ] && exit 0

deny() {
    printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}\n' "$1"
}

# Attempt an atomic claim: rename the marker to a private name. Fails harmlessly if the
# marker doesn't exist. Prints the claimed marker's content (a hash) on success, empty on
# failure -- caller compares against the expected hash.
consume_marker() {
    marker="$1"
    claimed="$marker.claimed.$$"
    if ! mv "$marker" "$claimed" 2>/dev/null; then
        printf ''
        return 1
    fi
    content=$(cat "$claimed" 2>/dev/null | tr -d '[:space:]')
    rm -f "$claimed"
    printf '%s' "$content"
}

case "$input" in
    *'git commit'*)
        expected=$(git diff HEAD 2>/dev/null | sha256)
        marker="$root/.claude/.code-review-ok"
        actual=$(consume_marker "$marker")
        if [ -n "$expected" ] && [ "$actual" = "$expected" ]; then
            presha=$(git rev-parse HEAD 2>/dev/null)
            [ -n "$presha" ] && printf '%s' "$presha" > "$root/.claude/.pending-commit-presha"
        else
            deny "Run /code-review before committing -- it writes a diff-bound review-ok marker this hook checks. If you already reviewed, the working tree changed since then; re-run /code-review."
        fi
        ;;
    *'git push'*)
        expected=$(git diff origin/main...HEAD 2>/dev/null)
        if [ $? -ne 0 ]; then
            expected=$(git diff HEAD 2>/dev/null)
        fi
        expected=$(printf '%s' "$expected" | sha256)
        marker="$root/.claude/.change-review-ok"
        actual=$(consume_marker "$marker")
        if [ -n "$expected" ] && [ "$actual" = "$expected" ]; then
            presha=$(git rev-parse '@{u}' 2>/dev/null)
            [ -n "$presha" ] && printf '%s' "$presha" > "$root/.claude/.pending-push-presha"
        else
            deny "Run /change-review before pushing -- it writes a diff-bound review-ok marker this hook checks. If you already reviewed, the diff changed since then; re-run /change-review."
        fi
        ;;
esac
exit 0
