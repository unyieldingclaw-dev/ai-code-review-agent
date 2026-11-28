#!/usr/bin/env sh
# PreToolUse hook — blocks git commit/push until the matching review slash command has run
# (except a tag-only push of an already-merged commit, below), and puts `gh pr merge` to the
# user as a permission prompt in one canonical form only.
# /code-review and /change-review write typed canonical fingerprints. This early
# check only peeks; native Git hooks are the sole consumers of authorization.
#
# WHY a tag-only push of a merged commit needs no marker, and no prompt either: the push marker
# binds `git diff origin/main...HEAD`, which says nothing about what a tag push publishes, so a
# release tag needed a fresh review of whatever branch was checked out (and from main, whose
# diff is empty, could not pass at all). A tag on a commit already in refs/remotes/origin/main
# publishes nothing unreviewed, so the PUSH case checks where the tags point instead. The user
# chose an allow over a merge-style ask on 2026-10-25: the check is about review, and the
# publish itself is authorized by the user's go-ahead in chat, as for branch pushes. The shape
# is TAG_PUSH in _review-gate-classify.py; the residuals are in docs/HOOKS-GUIDE.md section 7.
#
# WHY a merge gets a permission prompt ("ask") instead of a third diff-bound marker: by the
# time a PR is mergeable, its diff already passed the commit gate, the push gate, and (per
# branch protection's required-status-checks with strict:true) CI on the current head. The
# gap at merge time isn't diff integrity, it's authorization -- the user deciding, in that
# moment, to merge that PR -- and no marker the agent can write encodes that. The harness's
# own Allow/Deny prompt is the one per-action approval the agent cannot forge. This replaced
# an unconditional deny on 2026-10-20, which forced the user to run every merge in a terminal
# and was never total anyway (escape spellings: docs/backlog/merge-gate-misses-gh-global-
# flags-graphql-and-powe.md). Measured in the desktop app in auto mode before shipping: the
# ask stopped for the user's click every time. _review-gate-merge.py decides; only one exact,
# repo-pinned form with --match-head-commit is ever asked, from the main agent, in a mode
# that can show a prompt. Everything else still denies. Spec, threat model and the residuals
# it accepts: docs/superpowers/specs/2026-10-20-merge-gate-user-approval-design.md.
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
# ORDER IS LOAD-BEARING. Classification comes FIRST, before anything that can fail open.
#
# The previous order was: source the lib (`|| exit 0`), resolve the repo root (`|| exit 0`),
# then classify. Both of those early exits are ALLOW, so any tree missing the lib -- or any
# payload whose root could not be resolved -- skipped the gate entirely for a real commit,
# push or merge. That is not hypothetical: `mb upgrade` run inside a git worktree writes this
# script (which dot-sources the lib) WITHOUT writing the lib, because the TEMPLATE_OWNED list
# it copies from is the literal in the worktree's own older mb.sh. The result is a tree whose
# gate is silently disabled, produced by the repo's own upgrade path.
#
# Classification needs neither the lib nor the root, so it runs first. Once the verdict says
# a guarded verb is being invoked, every subsequent failure DENIES instead of allowing: for a
# command we know to be gated, "I could not check" must never read as "go ahead".

input=$(cat 2>/dev/null)
[ -z "$input" ] && exit 0

# WHY escape: the reason is printed inside a JSON string. Unescaped, a `"` (the unresolved-root
# message's cd "<repo>"), or a `\` or control character in an interpolated repository path, made
# the whole output invalid JSON (measured 2026-10-19 on the unresolved-root message).
deny() {
    deny_reason=$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g' | tr -d '\000-\037')
    printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}\n' "$deny_reason"
}

# Compare exact bytes without claiming or normalizing the marker. Native Git hooks
# alone consume it, after all blocking checks have passed.
peek_marker() {
    [ -f "$1" ] && [ ! -L "$1" ] || return 1
    printf '%s\n' "$2" | cmp -s - "$1"
}

# Classify the payload via the shared classifier, which BOTH shells call so they cannot
# diverge. See scripts/_review-gate-classify.py for why this is a parser and not a substring
# match: the substring matcher produced false positives and false negatives simultaneously,
# and both were measured.
#
# Prints COMMIT / PUSH / MERGE / MULTI / AMBIGUOUS / UNREAD / NONE, or nothing when classification was impossible.
classify_payload() {
    command -v python3 >/dev/null 2>&1 || return 1
    [ -f "$(dirname "$0")/_review-gate-classify.py" ] || return 1
    printf '%s' "$input" | python3 "$(dirname "$0")/_review-gate-classify.py" 2>/dev/null
}

verdict=$(classify_payload)
classifier_rc=$?
verdict_source=classifier

# WHY a fallback rather than exiting 0: a payload we cannot classify is not evidence the call
# is safe. python3 absent, the classifier missing, or genuinely malformed JSON all land here.
# The fallback is the OLD raw-substring matcher -- imprecise, occasionally noisy, and
# fail-CLOSED, which is the correct direction for a gate. The truncated-payload class is live
# on this machine, so this path is reachable in practice (.pmb-hook-errors.log).
#
# NOTE the asymmetry this creates, which is why the classifier must be at least as WIDE as
# this fallback: the fallback fires only when classification was IMPOSSIBLE (empty output).
# A confident but wrong NONE suppresses it. Six launcher forms were measured escaping exactly
# that way before _review-gate-classify.py learned to scan launcher arguments.
if [ -z "$verdict" ]; then
    # LOWERCASED BEFORE MATCHING, closing a pre-existing hole in this fallback.
    #
    # These literals are lowercase, and `case` is case-sensitive, so an uppercase or mixed-case
    # spelling of the executable walked straight past -- while the parser's is_git() had the
    # identical defect, so BOTH matchers shared it and neither could catch the other's miss.
    # Windows and macOS default filesystems are case-insensitive, so the uppercase spelling
    # invokes the same executable, and this repo develops on Windows. That is the class the
    # branch fix/block-tier-case-sensitivity is named for.
    #
    # `tr` is POSIX and needs no python3 -- which matters here specifically, because this whole
    # branch exists for the case where python3 or the classifier is unavailable. A fallback that
    # depended on the thing it is falling back from would be no fallback at all.
    verdict_source=fallback
    lower=$(printf '%s' "$input" | tr '[:upper:]' '[:lower:]')
    fallback_count=0
    fallback_verdict=NONE
    case "$lower" in *'git commit'*) fallback_count=$((fallback_count + 1)); fallback_verdict=COMMIT ;; esac
    case "$lower" in *'git push'*) fallback_count=$((fallback_count + 1)); fallback_verdict=PUSH ;; esac
    case "$lower" in *'gh pr merge'*) fallback_count=$((fallback_count + 1)); fallback_verdict=MERGE ;; esac
    if [ "$fallback_count" -gt 1 ]; then verdict=MULTI; else verdict=$fallback_verdict; fi
fi

# Nothing guarded: leave without touching the lib, the root, or any marker.
[ "$verdict" = NONE ] && exit 0

# One diff-bound marker authorizes exactly one guarded action, never an entire command chain.
if [ "$verdict" = MULTI ]; then
    deny "Review gate: compound commands containing multiple guarded actions must be run separately so each action receives its own authorization."
    exit 0
fi

# The classifier could not tell what the command runs: two readings of it found different guarded
# invocations (bash and PowerShell with no tool_name, with and without a heredoc or here-string body,
# or a launcher's words as written and unquoted), a command word holds an escape it does not decode,
# or the command went past one of its budgets (launcher depth, substitution nesting, nested readings).
# Its own text, because MULTI's "run them separately" would invite retrying spellings until one passes.
if [ "$verdict" = AMBIGUOUS ]; then
    deny "Review gate: the gate cannot tell what this command runs, because it reads more than one way (in bash and in PowerShell, with and without a heredoc or here-string body, or a launcher's words as written and unquoted, as when part of an option value is quoted: -C\"x\"), or a command word is spelled with an escape the gate does not decode (\$'\\x..' or \`u{..}), or the command is too long or nested too deeply for the gate to read (launchers inside launchers, or nested \$( substitutions). Spell git, gh and the subcommand plainly, with no quotes or escapes inside those words, quote whole arguments (-C \"x\", not -C\"x\"), keep heredoc text out of a command that commits or pushes, split an over-long or over-nested command into simpler ones, and run it again."
    exit 0
fi

# The classifier found git ... push/commit or gh pr merge after a program it does not read (UNREAD):
# the command may run it, but nothing binds it to a review. A deny in every mode, which claims and
# checks no marker: running git directly makes the same action reviewable.
if [ "$verdict" = UNREAD ]; then
    deny "Review gate: the gate cannot read the program in front of git or gh in this command (it is not a wrapper or launcher the gate decodes, such as flock, nsenter or watch), so this commit, push or merge cannot be bound to a review. Run git or gh directly so it can be reviewed; if the words are text, not a command, put the whole phrase inside one pair of quotes, as one word."
    exit 0
fi

# A merge needs no root and no marker. It is put to the user as a permission prompt only when
# _review-gate-merge.py answers ASK; anything else -- a fallback verdict, a missing helper, no
# python3, a crash -- denies. See the WHY at the top of this file.
if [ "$verdict" = MERGE ]; then
    merge_decision=""
    if [ "$verdict_source" = classifier ] && [ -f "$(dirname "$0")/_review-gate-merge.py" ]; then
        merge_decision=$(printf '%s' "$input" | python3 "$(dirname "$0")/_review-gate-merge.py" 2>/dev/null)
    fi
    merge_verdict=$(printf '%s\n' "$merge_decision" | sed -n 1p | tr -d '\r')
    merge_reason=$(printf '%s\n' "$merge_decision" | sed -n 2p | tr -d '\r')
    if [ "$merge_verdict" = ASK ]; then
        ask_reason=$(printf '%s' "$merge_reason" | sed 's/\\/\\\\/g; s/"/\\"/g' | tr -d '\000-\037')
        printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"%s"}}\n' "$ask_reason"
        # Written after the decision, and allowed to fail: a convenience record of what was
        # asked, not of the user's answer. GitHub's "merged by" is the authoritative record.
        merge_audit=$(printf '%s\n' "$merge_decision" | sed -n 3p | tr -d '\r')
        printf '%s\t%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$merge_audit" \
            >> "${CLAUDE_PROJECT_DIR:-.}/.claude/merge-asks.log" 2>/dev/null || true
    elif [ "$merge_verdict" = DENY ] && [ -n "$merge_reason" ]; then
        deny "$merge_reason"
    else
        deny "This agent merges a pull request only after the merge gate has checked it, and the check could not run here (no classifier verdict, python3 or scripts/_review-gate-merge.py unavailable). Merge in the GitHub UI instead."
    fi
    exit 0
fi

# From here the command IS gated, so every failure below denies.
#
# sha256_file()/diff_hash()/resolve_cd_root() live in _review-gate-lib.sh -- see that file for
# their WHY (byte-parity hashing, worktree-safe root resolution).
if ! . "$(dirname "$0")/_review-gate-lib.sh" 2>/dev/null; then
    deny "Review gate cannot run: scripts/_review-gate-lib.sh is missing or unreadable, so the marker check is unavailable. This is a broken installation, not a passed review -- restore the file (or run mb upgrade from the MAIN worktree) before committing or pushing."
    exit 0
fi

root=""
if [ "$classifier_rc" -eq 0 ]; then
    context=$(printf '%s' "$input" | python3 "$(dirname "$0")/_review-gate-classify.py" --git-context 2>/dev/null)
    context_rc=$?
    if [ "$context_rc" -ne 0 ]; then
        deny "Review gate classified a guarded command but could not resolve its repository context."
        exit 0
    fi
    context=$(printf '%s' "$context" | tr -d '\r')
    if [ "$context" = "__UNSUPPORTED_GIT_CONTEXT__" ]; then
        deny "Review gate cannot safely bind this command's git context to a repository: it uses --git-dir/--work-tree, a wrapper option that changes directory (env -C, sudo -D), or names GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE, GIT_OBJECT_DIRECTORY or GIT_COMMON_DIR. Run the command from that repository without them. A commit message that mentions one of those names must be passed with -F <file>, not -m."
        exit 0
    fi
    if [ -n "$context" ]; then
        context_dir=$(pwd -P)
        context_ok=1
        while IFS= read -r context_path; do
            [ -z "$context_path" ] && continue
            next_dir=$(cd "$context_dir" 2>/dev/null && cd "$context_path" 2>/dev/null && pwd -P) || {
                context_ok=0
                break
            }
            context_dir="$next_dir"
        done <<EOF
$context
EOF
        if [ "$context_ok" -ne 1 ]; then
            deny "Review gate cannot resolve the command's explicit repository path, so it cannot verify the correct marker."
            exit 0
        fi
        root=$(git -C "$context_dir" rev-parse --show-toplevel 2>/dev/null)
        if [ -z "$root" ]; then
            deny "Review gate could not resolve a repository from the command's explicit path."
            exit 0
        fi
    fi
fi
[ -z "$root" ] && root=$(resolve_cd_root)
[ -z "$root" ] && root=$(git rev-parse --show-toplevel 2>/dev/null)
if [ -z "$root" ]; then
    deny "Review gate cannot run: the repository root could not be resolved for this command, so the marker check is unavailable. Run the command from inside the repository, or prefix it with cd \"<repo>\" && so the gate can bind to the right tree."
    exit 0
fi

# WHY cd here, not -C "$root" on every git call below: resolving root fixes where the marker
# is looked FOR, but diff_hash() and the pre-commit/pre-push SHA capture further down still
# run bare `git diff`/`git rev-parse` calls with no directory anchor -- the exact same ambient-
# cwd assumption just fixed above, just at different call sites. Anchoring the whole rest of
# this script to $root once, here, means every git call downstream is correct by construction
# instead of each one needing to remember -C "$root" individually (and any git call added to
# this file later inherits correctness for free instead of silently reintroducing the bug).
#
# script_dir is fixed BEFORE that cd, because settings.json runs this hook by a relative path. A
# "$(dirname "$0")" evaluated after the cd names the TARGET repository's scripts/, so the tag
# route below ran that repository's own classifier (measured 2026-10-30: a crafted one let a
# branch push through with no marker). An empty value fails closed: the call then finds nothing.
script_dir=$(cd "$(dirname "$0")" 2>/dev/null && pwd -P)
if ! cd "$root" 2>/dev/null; then
    deny "Review gate cannot run: the resolved repository root $root is not enterable, so the marker check is unavailable."
    exit 0
fi

# WHY name the root in the empty-diff denials: a command whose cd was not its first word
# (`N=...; cd "<worktree>" && git push`) fell back to the hook's working directory, the main
# checkout, whose diff was empty -- and the denial gave no hint which tree it had checked.
# The cd form named here is the one the resolvers accept: quoted, first in the command, then &&
# (_review-gate-classify.py CD_PREFIX). An unquoted cd falls back to the working directory again.
root_hint="The gate checked $root: it takes the repository from a quoted cd \"<path>\" && chain at the very start of the command plus any git -C path, else from the hook's working directory. If that is the wrong tree, start the command with cd \"<repo>\" &&."

case "$verdict" in
    COMMIT)
        if commit_touches_gitlink "$root"; then
            deny "Review gate: a staged submodule pointer or checked-out submodule HEAD changed, or git failed; this commit is refused. $root_hint"
        fi
        # Only the strict validator can exempt evidence-only staged commits. Its default
        # mode rejects empty indexes, malformed evidence and every product/evidence mix.
        if "$script_dir/review-evidence-check.sh" index >/dev/null 2>&1; then
            exit 0
        fi
        expected=$(commit_review_fingerprint "$root")
        rc=$?
        if [ "$rc" -ne 0 ] || [ -z "$expected" ]; then
            deny "Review gate: no diff to review or canonical staged fingerprint unavailable. $root_hint"
        elif ! peek_marker "$root/.claude/.code-review-ok" "$expected"; then
            deny "Run /code-review before committing -- the typed marker must match the current index and parent HEAD. $root_hint"
        fi
        ;;
    PUSH)
        # A TAG-ONLY PUSH IS CHECKED BY WHERE ITS TAGS POINT, NOT BY A MARKER. The marker binds
        # `git diff origin/main...HEAD`, which says nothing about what a tag push publishes:
        # pushing a release tag needed a fresh /change-review of whatever branch was checked
        # out, and from main (an empty diff) could not pass at all. A tag on a commit already
        # in refs/remotes/origin/main publishes nothing unreviewed. --tag-push prints names only
        # for the exact shape its TAG_PUSH regex describes; anything else takes the marker path
        # below. So does a fallback verdict: --tag-push skips the verdict computation, so it
        # could still answer when that computation failed, and the .ps1 twin never takes the
        # route then either.
        # show-ref --verify: refs/tags/<t> must exist as written, or rev-parse would resolve a
        # look-alike such as refs/heads/refs/tags/<t>, which git would push as a branch.
        # symbolic-ref: a refs/tags/<t> that is a symref to a branch is pushed as that branch
        # (measured with git 2.55: `* [new branch] sym -> feat`).
        # merge-base peels an annotated tag to its commit and fails on a tag of a tree or blob.
        # --no-replace-objects: a `git replace --graft` can make an unreviewed commit look like
        # an ancestor of origin/main, while the pack a push sends ignores replace refs
        # (measured 2026-10-30, git 2.39).
        # refs/remotes/origin/main spelled out: a local branch named origin/main would win.
        # Any remote.<name>.push refspec refuses the route: git maps a refs/tags/<t> with no
        # :<dst> onto that refspec's destination, which can be a branch, with its force flag
        # (git-push(1), <refspec>).
        # Off Windows, a C:/... cd path is relative (a directory named C:), so the gate and the
        # shell would resolve it in two places. The .ps1 twin refuses it as not fully qualified.
        # The TAG-PUSH header line is required: a classifier from before --tag-push prints its
        # verdict, PUSH, which would otherwise be read as a tag name.
        tag_names=""
        if [ "$verdict_source" = classifier ]; then
            tag_output=$(printf '%s' "$input" | python3 "$script_dir/_review-gate-classify.py" --tag-push 2>/dev/null | tr -d '\r')
            if [ "$(printf '%s\n' "$tag_output" | sed -n 1p)" = TAG-PUSH ]; then
                tag_names=$(printf '%s\n' "$tag_output" | sed 1d)
            fi
        fi
        case "$(uname -s)" in
            MINGW*|MSYS*|CYGWIN*) ;;
            *) case "$context" in [A-Za-z]:*) tag_names="" ;; esac ;;
        esac
        if git config --get-regexp '^remote\..*\.push$' >/dev/null 2>&1; then
            tag_names=""
        fi
        if [ -n "$tag_names" ]; then
            while IFS= read -r tag; do
                if ! git show-ref --verify --quiet "refs/tags/$tag" \
                    || git symbolic-ref -q "refs/tags/$tag" >/dev/null 2>&1 \
                    || ! tag_target=$(git rev-parse --verify --quiet "refs/tags/$tag") \
                    || ! git --no-replace-objects merge-base --is-ancestor "$tag_target" refs/remotes/origin/main 2>/dev/null; then
                    deny "Review gate: refs/tags/$tag does not exist, is a symbolic ref, does not point at a commit, or points at a commit that is not in refs/remotes/origin/main, so pushing it could publish unreviewed history. A tag push needs no review marker only when every tag it names is on a commit already merged to main; if the merge is recent, run git fetch origin first. $root_hint"
                    exit 0
                fi
            done <<EOF
$tag_names
EOF
            exit 0
        fi
        tag_hint="To push a tag of a commit already on origin/main, make the whole command cd \"<absolute repo path>\" && git push <remote> refs/tags/<tag> (or tag <tag>), with nothing else chained."
        expected=$(push_review_fingerprint "$root")
        rc=$?
        if [ "$rc" -ne 0 ] || [ -z "$expected" ]; then
            deny "Review gate: canonical branch fingerprint unavailable (missing base, no diff to review, or invalid history/evidence). Run /change-review after restoring origin/main; no working-tree fallback authorizes a push. $tag_hint $root_hint"
        elif ! peek_marker "$root/.claude/.change-review-ok" "$expected"; then
            deny "Run /change-review before pushing -- the typed marker must match the committed branch content and ordered history. $tag_hint $root_hint"
        fi
        ;;
    *)
        # A verdict this hook does not know -- a newer classifier beside an older hook, or
        # garbage -- must not fall through to exit 0, which is allow.
        deny "Review gate: unrecognised classifier verdict, so this command cannot be checked. The hook and scripts/_review-gate-classify.py are probably from different versions; run mb upgrade from the main worktree."
        ;;
esac
exit 0
