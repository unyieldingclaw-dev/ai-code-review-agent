#!/usr/bin/env sh
# scripts/_review-gate-lib.sh — shared helpers for review-reminders.sh / review-reminders-post.sh
# (PreToolUse / PostToolUse review-gate hook pair). Dot-sourced, not executed directly.
#
# WHY this file exists: sha256_file(), diff_hash(), and resolve_cd_root() used to be defined
# verbatim in both review-reminders.sh and review-reminders-post.sh -- a fix to one (e.g. the
# 2026-07-09 trailing-newline hash bug) had to be manually ported to the other, and a missed
# port silently reintroduced whatever the other file already fixed. See
# docs/superpowers/specs/2026-07-29-review-gate-hook-lib-dedup-design.md for the full design.
#
# WHY sha256sum with a shasum fallback: sha256sum is standard on Linux and in Git for
# Windows' bundled coreutils, but macOS ships shasum instead. If neither is available,
# fail open (skip the gate entirely) rather than deny everything -- matches this repo's
# established "fail open on missing dependency" convention (see check-contract.sh/python3).
sha256_file() {
    file="$1"
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$file" | cut -d' ' -f1
    elif command -v shasum >/dev/null 2>&1; then
        shasum -a 256 "$file" | cut -d' ' -f1
    else
        printf ''
    fi
}

# WHY this helper: the commit and push cases in both hook files need "redirect a git diff to
# a temp file, hash it, clean up" -- inlining that repeatedly risked exactly the kind of
# copy-paste drift that caused the original trailing-newline bug. One helper, one place to
# get it right.
#
# WHY hash a file written via redirection, not piped/captured output: on any machine where
# BOTH pwsh and bash exist, a marker written by one must validate under the other's hook --
# whichever runs is a coin flip the writer can't control. Piping `git diff | sha256sum`
# preserves the trailing newline; capturing via `$(git diff ...)` strips it.
# _review-gate-lib.ps1 redirects to a file (`>`), which also preserves it. Hashing a
# redirected file here, instead of piping or capturing, makes this file's hash byte-identical
# to the PowerShell lib's for the same diff, regardless of which one actually enforces the
# gate on a given machine. Empirically confirmed: command substitution and redirect-to-file
# produced different SHA-256 hashes for the same diff (differing by exactly the trailing
# newline byte) before this fix.
#
# WHY return git diff's exit code, not the hash computation's: the push case needs to try
# `origin/main...HEAD` and fall back to `HEAD` if that ref doesn't exist (no upstream). The
# caller decides whether to fall back based on whether the underlying `git diff` succeeded,
# not whether hashing succeeded (sha256_file degrades gracefully to an empty string on its
# own, unrelated failure mode) -- so this returns git diff's own exit code via `$rc`,
# captured before sha256_file has a chance to run and overwrite `$?`.
#
# WHY no EXIT trap here, despite `mktemp` needing cleanup: an earlier version of this function
# set `trap 'rm -f "$tmp"' EXIT` then unconditionally `trap - EXIT` at the end -- which silently
# clears ANY trap a caller had already armed in the SAME shell before calling this function (sh
# traps are shell-global, not function-scoped). A save-and-restore fix (`trap -p EXIT` before,
# `eval` that value back afterward) was tried and reverted: it's safe for a direct, same-shell
# call, but callers that invoke this via command substitution (`$(diff_hash ...)`, or
# `$(commit_diff_hash)`, which wraps it -- how review-reminders.sh calls it at all 3 of its call
# sites) run it in a subshell that
# *inherits* the caller's trap at fork time. Empirically confirmed: bash treats an inherited-but-
# never-explicitly-touched EXIT trap as dormant for that subshell's own exit, but the moment this
# function calls `trap` explicitly -- even just to restore the exact same value via eval -- bash
# arms it for that subshell's exit too, firing the CALLER's cleanup early (e.g. deleting the
# caller's own working directory) the instant this function returns, not at the caller's real
# exit. Reproduced directly against tests/test-review-gate-lib.sh, which wraps `diff_hash` calls
# in `$(cd "$TMPDIR_LIB" && diff_hash HEAD)` under its own top-level `trap 'rm -rf "$TMPDIR_LIB"'
# EXIT` -- the save/restore version deleted $TMPDIR_LIB mid-test-run. Given real callers today
# never set their own trap (so nothing to clobber in practice) and no in-repo caller relies on
# the leaked-temp-file safety net firing on an abnormal signal mid-`git diff` (a low-stakes OS
# temp-file leak, not a correctness or security issue), the safest fix is to not touch trap state
# at all: rely solely on the explicit `rm -f "$tmp"` below on the normal-completion path.
diff_hash() {
    tmp=$(mktemp)
    git diff "$@" > "$tmp" 2>/dev/null
    rc=$?
    sha256_file "$tmp"
    rm -f "$tmp"
    return $rc
}

# WHY commit_diff_hash, not diff_hash HEAD, for the commit marker: in a repo with no commits yet
# (unborn HEAD) `git diff HEAD` fails with no output, so the hash was the empty-file constant and
# the gate denied every first commit, reviewed or not. Diffing against the empty tree binds what
# that commit records. Same test as .githooks/pre-commit's fc_base. Not narrowed to "HEAD is a
# symbolic ref to a missing branch": any other unresolvable HEAD makes git commit fail or write a
# root commit, and with index == working tree (enforced by the caller) the hashed bytes are the
# whole committed tree either way. An orphan branch therefore needs a whole-tree review.
# An empty base (hash-object failed) prints an empty hash, which the caller denies.
# WHY --no-ext-diff --no-textconv: a diff.external or textconv set in .git/ (unseen by any
# reviewer) can print the same bytes before and after a content change, so one marker would
# approve any later content. The unstaged-changes check already passes both flags (OPP6-1).
commit_diff_hash() {
    if git rev-parse -q --verify HEAD > /dev/null 2>&1; then
        diff_hash --no-ext-diff --no-textconv HEAD
        return
    fi
    base=$(git hash-object -t tree /dev/null 2>/dev/null)
    if [ -z "$base" ]; then
        echo ""
        return 1
    fi
    diff_hash --no-ext-diff --no-textconv "$base"
}

# WHY push_diff_hash: the push marker had the same diff-driver hole as the commit marker, and the
# push gate is the only gate on commits made by merge, cherry-pick or rebase. --no-ext-diff
# --no-textconv as in commit_diff_hash; --ignore-submodules=none because diff.ignoreSubmodules=all
# hides a pointer move between two commits; --submodule=short because diff.submodule=log prints a
# moved pointer as two abbreviated ids, so a pointer sharing the shown prefix hashed the same.
# Falls back to HEAD when origin/main...HEAD fails (no
# upstream), as before. Captured rather than streamed: a failed diff_hash still prints a hash.
push_diff_hash() {
    if h=$(diff_hash --no-ext-diff --no-textconv --ignore-submodules=none --submodule=short origin/main...HEAD); then
        echo "$h"
        return
    fi
    diff_hash --no-ext-diff --no-textconv --ignore-submodules=none --submodule=short HEAD
}
# Canonical v2 hashes always use Git's patch bytes; temporary files are explicitly removed.
_review_evidence_check() {
    gate_scripts_dir=${REVIEW_GATE_SCRIPTS_DIR:-"$(git rev-parse --show-toplevel 2>/dev/null)/scripts"}
    "$gate_scripts_dir/review-evidence-check.sh" "$@"
}

_canonical_product_patch() {
    git -c diff.relative=false diff --no-ext-diff --no-textconv --no-renames --binary --full-index --ignore-submodules=none --submodule=short "$@" -- ':(top)**' ':(exclude,top)docs/review-log/invocations/*.json' ':(exclude,top)docs/review-log/*-code-review.md' ':(exclude,top)docs/review-log/*-change-review.md'
}

# WHY commit_touches_gitlink: a staged submodule pointer (mode 160000) whose submodule is not
# checked out never appears in the working-tree diff commit_diff_hash hashes, nor in the
# unstaged-changes check, whatever --ignore-submodules says; diff.ignoreSubmodules=all hides a
# checked-out one too. So one marker approved a commit that also moved a pointer nobody saw.
# The commit gate refuses any commit whose index or working tree changes a gitlink instead.
# The working-tree side is what git commit -a would stage: a checked-out submodule whose HEAD
# moved. It passes --ignore-submodules=dirty, not none, because a submodule that only holds
# untracked or modified files shows as a gitlink line too, though no commit records it.
# Returns 0 (refuse) on a gitlink change and on any git or grep failure; 1 only when grep found
# no gitlink line, so a missing or failing grep refuses too.
# Optional root is resolved inside a subshell; the caller's working directory is unchanged.
commit_touches_gitlink() (
    [ "$#" -eq 0 ] || cd "$1" || exit 0
    raw=$(git diff --cached --raw --no-ext-diff --no-renames --ignore-submodules=none 2>/dev/null) || exit 0
    wt=$(git diff --raw --no-ext-diff --no-renames --ignore-submodules=dirty 2>/dev/null) || exit 0
    printf '%s\n%s\n' "$raw" "$wt" | grep -Eq '^:(160000 [0-7]{6}|[0-7]{6} 160000) '
    [ $? -eq 1 ] && exit 1
    exit 0
)

commit_review_fingerprint() (
    [ "$#" -eq 0 ] || cd "$1" || exit 1
    repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 1
    cd "$repo_root" || exit 1
    revision=HEAD
    if ! parent=$(git rev-parse --verify HEAD 2>/dev/null); then
        branch=$(git symbolic-ref -q HEAD 2>/dev/null) || exit 1
        case "$branch" in refs/heads/*) ;; *) exit 1 ;; esac
        git show-ref --verify --quiet "$branch" 2>/dev/null
        [ "$?" -eq 1 ] || exit 1
        case "$(git rev-parse --show-object-format=storage 2>/dev/null)" in
            sha1) parent=$(printf '%040d' 0) ;;
            sha256) parent=$(printf '%064d' 0) ;;
            *) exit 1 ;;
        esac
        revision=
    fi
    _review_evidence_check index --allow-mixed >/dev/null 2>&1 || exit 1
    patch=$(mktemp) || exit 1
    if ! _canonical_product_patch --cached ${revision:+"$revision"} > "$patch" 2>/dev/null || [ ! -s "$patch" ]; then
        rm -f "$patch"; exit 1
    fi
    hash=$(sha256_file "$patch")
    rm -f "$patch"
    [ -n "$hash" ] || exit 1
    printf 'v2 commit %s %s\n' "$parent" "$hash"
)

push_review_fingerprint() (
    [ "$#" -eq 0 ] || cd "$1" || exit 1
    repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 1
    cd "$repo_root" || exit 1
    bases=$(git merge-base --all origin/main HEAD 2>/dev/null) || exit 1
    set -- $bases
    [ "$#" -eq 1 ] || exit 1
    patch=$(mktemp) || exit 1
    stream=$(mktemp) || { rm -f "$patch"; exit 1; }
    if ! _canonical_product_patch "$bases" HEAD > "$patch" 2>/dev/null || [ ! -s "$patch" ]; then
        rm -f "$patch" "$stream"; exit 1
    fi
    base_hash=$(sha256_file "$patch")
    : > "$stream"
    commits=$(git rev-list --reverse "$bases..HEAD" 2>/dev/null) || { rm -f "$patch" "$stream"; exit 1; }
    [ -n "$commits" ] || { rm -f "$patch" "$stream"; exit 1; }
    for commit in $commits; do
        parents=$(git rev-list --parents -n 1 "$commit" 2>/dev/null) || { rm -f "$patch" "$stream"; exit 1; }
        set -- $parents
        [ "$#" -eq 2 ] || { rm -f "$patch" "$stream"; exit 1; }
        parent=$2
        _review_evidence_check "$commit" --allow-mixed >/dev/null 2>&1 || { rm -f "$patch" "$stream"; exit 1; }
        if ! _canonical_product_patch "$parent" "$commit" > "$patch" 2>/dev/null; then
            rm -f "$patch" "$stream"; exit 1
        fi
        if [ -s "$patch" ]; then
            hash=$(sha256_file "$patch")
            [ -n "$hash" ] || { rm -f "$patch" "$stream"; exit 1; }
            printf '%s %s %s\n' "$commit" "$parent" "$hash" >> "$stream"
        fi
    done
    [ -s "$stream" ] || { rm -f "$patch" "$stream"; exit 1; }
    digest=$(sha256_file "$stream")
    rm -f "$patch" "$stream"
    [ -n "$base_hash" ] && [ -n "$digest" ] || exit 1
    printf 'v2 push %s %s %s\n' "$bases" "$base_hash" "$digest"
)

# WHY this helper: review-reminders-post.sh reissues a review-ok marker (after a commit/push
# that consumed one then failed) by redirecting straight into the marker path -- a plain `>`
# truncates-then-writes in place, which a concurrent reader racing to consume the same marker
# via consume_marker()'s `mv` could observe mid-write. Routes the write through the same
# mktemp-in-same-dir + mv pattern already established for the version cache (mb.sh's
# get_cached_pmb_version) -- one helper instead of duplicating the fix inline at two call
# sites in review-reminders-post.sh, matching this file's own reason for existing.
#
# WHY stdin, not a string argument: this repo has been bitten more than once by exactly this
# class of bug -- `$(...)` command substitution silently strips a trailing newline that a
# direct redirect preserves (see diff_hash()'s own WHY comment above, and the 2026-07-09
# trailing-newline hash-mismatch bug this whole shared-lib file exists to prevent recurring).
# `diff_hash HEAD | write_marker_atomic path` pipes diff_hash's raw stdout straight through,
# byte-for-byte including its trailing newline, into this function's own `cat > "$tmp"` --
# no command substitution anywhere in the chain. A string-argument design
# (`write_marker_atomic path "$(diff_hash HEAD)"`) would have reintroduced the exact bug class
# this file's own dedup refactor was built to eliminate.
write_marker_atomic() {
    path="$1"
    dir=$(dirname "$path")
    tmp=$(mktemp "$dir/.marker-write.XXXXXX" 2>/dev/null) || return 1
    if cat > "$tmp" 2>/dev/null; then
        mv "$tmp" "$path" 2>/dev/null || { rm -f "$tmp"; return 1; }
    else
        rm -f "$tmp"
        return 1
    fi
}

# WHY parameterless, relying on the caller's global $input: the caller (review-reminders.sh /
# review-reminders-post.sh) reads raw stdin into $input and does its own raw-stdin case-match
# BEFORE calling this function -- $input is already a shell global by the time this runs, and
# adding a parameter here would just duplicate what's already in scope. This is an implicit
# contract: any caller of resolve_cd_root() must set $input first.
#
# WHY this exists: `git rev-parse --show-toplevel` (the caller's fallback) trusts the hook
# process's own ambient cwd. That's correct for a session whose Bash tool cwd persists across
# calls, but empirically false for some dispatched-subagent sessions -- confirmed via direct
# reproduction during the 2026-07-16 review-gate self-attestation fix session (see
# memory-bank/progress.md's 2026-07-16 entry -- that fix's own design spec explicitly scoped
# this hook as untouched): a bare `pwd` with no `cd` kept returning the wrong directory even
# after many prior `cd "<path>" && ...` calls in the same subagent conversation. Every gated
# commit from inside a worktree was denied even with a correct, matching marker present,
# because root resolved to the wrong directory. Deriving root from the gated command's own
# leading `cd` instead of the hook's ambient state fixes this regardless of the underlying
# cause -- see docs/superpowers/specs/2026-07-22-review-hook-worktree-root-fix-design.md.
#
# WHY python3, not a regex on raw stdin: the raw-text matching in the caller's case statement
# only needs to detect presence ("git commit" appears somewhere"). This needs the actual
# VALUE of tool_input.command to check its prefix. Matches check-contract.sh's existing
# precedent in this repo for the same class of need (extracting an actual field value, not
# just detecting presence).
#
# WHY resolve the FULL leading cd chain, not just the first cd: a chained command like
# `cd "A" && cd "B" && git commit ...` must resolve to B's root, not A's -- reproduced
# directly against the OLD implementation (a sed pattern that only ever matched the first
# `cd "X" &&` prefix): it extracted "A" from that exact string, so a chained command could
# reuse a marker earned reviewing A to authorize a commit that actually runs in B. python3
# walks every leading `cd "<path>" && ` / `cd '<path>' && ` segment in order, applying each
# cd's relative-path semantics against the previously resolved directory (matching what a
# real shell does with the same chain), so the git-root check below runs against the FINAL
# directory, not the first one.
#
# WHY `[^"]+`/`[^']+` (one-or-more), not `*`: must match _review-gate-lib.ps1's
# Resolve-CdRoot regex exactly -- a `*` vs `+` mismatch between the two would make bash and
# PowerShell resolve the SAME input differently (e.g. `cd "" && cd "/real/path" && ...`: `*`
# lets bash match the empty segment and continue the chain; `+` would reject it on PowerShell
# and abandon the chain entirely), defeating the point of a hook meant to behave identically
# on both platforms.
#
# WHY a single-quoted heredoc + argv instead of `python3 -c "..."` + stdin: the regex needs
# to match BOTH `cd "X"` and `cd 'X'` forms, so its source must contain literal double-quote
# AND single-quote characters together -- no shell quoting style for a `-c` argument avoids
# colliding with one or the other. A single-quoted heredoc (<<'PYEOF') isn't interpreted by
# the shell at all (no expansion, no quote handling), so both characters can appear freely;
# $input moves to argv only because the heredoc already claims stdin.
#
# WHY fail open to the ambient root on any failure: this is a best-effort correction layered
# on top of the existing resolution, not a replacement for it. No python3, malformed JSON, no
# leading cd, or an extracted path that isn't a git repo all fall back to exactly today's
# behavior -- a session where ambient cwd is already correct is completely unaffected.
resolve_cd_root() {
    command -v python3 >/dev/null 2>&1 || return 1
    cd_path=$(python3 - "$input" <<'PYEOF' 2>/dev/null | tr -d '\r'
import sys, json, os, re

try:
    data = json.loads(sys.argv[1])
    cmd = data.get("tool_input", {}).get("command", "")
except Exception:
    cmd = ""

dq = re.compile(r'^cd\s+"([^"]+)"\s*&&\s*')
sq = re.compile(r"^cd\s+'([^']+)'\s*&&\s*")
rest = cmd
cur = os.getcwd()
matched = False
while True:
    m = dq.match(rest) or sq.match(rest)
    if not m:
        break
    matched = True
    p = m.group(1)
    cur = p if os.path.isabs(p) else os.path.normpath(os.path.join(cur, p))
    rest = rest[m.end():]

print(cur if matched else "")
PYEOF
)
    [ -z "$cd_path" ] && return 1
    cd_root_result=$(git -C "$cd_path" rev-parse --show-toplevel 2>/dev/null)
    [ -z "$cd_root_result" ] && return 1
    printf '%s' "$cd_root_result"
}
