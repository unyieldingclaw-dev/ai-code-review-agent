#!/usr/bin/env bash

if git diff --cached --name-only | grep -q "^handoff\.md$"; then
  echo "ERROR: handoff.md is staged for commit. This file is ephemeral and must not be committed."
  echo "Remove it from staging: git rm --cached handoff.md"
  exit 1
fi

# memory-bank/ is edited and committed only in the MAIN worktree, so every branch shares one
# authoritative copy. `mb commit` refuses in a linked worktree, but a plain `git commit` never
# reaches `mb commit`. Git runs pre-commit for `git commit` (including one that concludes a
# conflicted merge) and for `cherry-pick --continue` / `revert --continue` after a conflict. A clean
# merge or pull, a clean cherry-pick or revert, `rebase --continue`, `am` and plumbing commit
# without it. docs/HOOKS-GUIDE.md lists what that leaves.
#
# Every failure below REFUSES. An empty result from a git command that errored reads exactly like
# "nothing staged" or "nothing differs", so treating it as a pass would wave the commit through.
mb_unstage_advice="memory-bank/ is edited and committed only in the main worktree. Unstage it here
(git restore --staged memory-bank/), make the change in the main worktree, and commit it there."
# mb_refuse MESSAGE [PATHS] [ADVICE]
mb_refuse() {
  echo "ERROR: $1"
  [ -n "${2:-}" ] && printf '%s\n' "$2" | sed 's/^/    /'
  printf '%s\n' "${3:-$mb_unstage_advice}"
  exit 1
}

# -z because git C-quotes unusual names by default ("memory-bank/caf\303\251.md", leading quote
# included), which a ^memory-bank/ match never sees. --no-renames so a file moved OUT of
# memory-bank/ still lists its old path. pipefail so a failed diff is not read as an empty one.
if ! staged=$(set -o pipefail; git diff --cached --name-only --no-renames -z | tr '\0' '\n'); then
  mb_refuse "could not list staged files, so the linked-worktree memory-bank/ check could not run."
fi
mb_staged=$(printf '%s\n' "$staged" | grep -i '^memory-bank/')

if [ -n "$mb_staged" ]; then
  # A linked worktree is exactly the case where --git-dir and --git-common-dir differ. Compared
  # after `cd && pwd -P` rather than `realpath`, which is missing on some systems and whose empty
  # output then compared equal on both sides. Checked non-empty BEFORE `cd`: some shells treat
  # `cd ""` as "stay here", which would make both sides equal.
  git_dir=$(git rev-parse --git-dir 2>/dev/null)
  common_dir=$(git rev-parse --git-common-dir 2>/dev/null)
  [ -n "$git_dir" ] && git_dir=$(cd "$git_dir" 2>/dev/null && pwd -P)
  [ -n "$common_dir" ] && common_dir=$(cd "$common_dir" 2>/dev/null && pwd -P)
  if [ -z "$git_dir" ] || [ -z "$common_dir" ]; then
    mb_refuse "memory-bank/ changes are staged, but this hook could not tell whether this is a linked worktree." "$mb_staged"
  fi

  if [ "$git_dir" != "$common_dir" ]; then
    if [ -f "$git_dir/MERGE_HEAD" ]; then
      # Finishing a conflicted merge of main stages main's memory-bank/ changes here. A file whose
      # staged content matches the merged branch was not edited in this worktree, so it passes;
      # anything that differs from BOTH sides -- a hand edit, or git combining the two -- does not.
      if ! merged_diff=$(set -o pipefail; git diff --cached --name-only --no-renames -z MERGE_HEAD | tr '\0' '\n'); then
        mb_refuse "a merge is in progress but MERGE_HEAD could not be compared, so memory-bank/ changes are refused." "$mb_staged"
      fi
      mb_staged=$(printf '%s\n' "$mb_staged" | while IFS= read -r p; do
        printf '%s\n' "$merged_diff" | grep -qxF -- "$p" && printf '%s\n' "$p"
      done)
      # Unstaging here would drop the merged branch's memory-bank/ changes from the merge result,
      # so the advice is to take that branch's version instead.
      if [ -n "$mb_staged" ]; then
        mb_refuse "in this linked worktree's merge, these memory-bank/ files differ from the branch being merged (edited here, or combined by git from both sides):" \
          "$mb_staged" \
          "Take the merged branch's version of each: git checkout MERGE_HEAD -- <path>
Any memory-bank/ change of your own belongs in the main worktree."
      fi
    else
      mb_refuse "memory-bank/ changes cannot be committed from a linked worktree (main worktree: ${common_dir%/*})." "$mb_staged"
    fi
  fi
fi

if [ -f ".claude/settings.json" ] && ! grep -q "CLAUDE_AUTOCOMPACT_PCT_OVERRIDE" .claude/settings.json; then
  echo "WARNING: CLAUDE_AUTOCOMPACT_PCT_OVERRIDE not found in .claude/settings.json."
  echo "Token budget auto-compaction may not be configured. Add it to avoid mid-task context loss."
fi

# Format check [NS-58], opted into per repo by adding .githooks/format-check (repo-owned; `mb
# upgrade` replaces only pre-commit and pre-push here). Choosing WHICH staged paths to check is the
# part that went wrong three ways when written per repo, so it lives in this TEMPLATE_OWNED hook and
# a fix reaches every repo; the formatter itself belongs to the repo. A prettier example ships in
# PMB's templates/examples/format-check/. Git runs this hook from the top of the working tree.
#
# Last, so a repo's script can never change the refusals' verdicts. It could still change what they
# examined -- the index -- so the index is compared before and after the script, below.
if [ -f .githooks/format-check ]; then
  # Plumbing, so diff.renames, color and external-diff config cannot change the output.
  # --no-renames reports a rename or copy as an add of the new path, so it is checked (a rename was
  # skipped by the --diff-filter=ACM of the first per-repo attempt). Only regular files: a gitlink is
  # a directory, and a symlink's target can be outside the repo.
  fc_base=HEAD
  git rev-parse -q --verify HEAD > /dev/null || fc_base=$(git hash-object -t tree /dev/null)
  # Read record by record, never through $(...): command substitution drops NUL bytes and runs every
  # path together. The trailing "end" marker proves diff-index finished, since a process
  # substitution's exit status is lost.
  fc_files=()
  fc_complete=
  while IFS= read -r -d '' fc_meta; do
    [ "$fc_meta" = end ] && { fc_complete=1; break; }
    IFS= read -r -d '' fc_path || break
    fc_mode=${fc_meta#* }
    case "${fc_mode%% *}" in 100644|100755) fc_files+=("$fc_path") ;; esac
  done < <(git diff-index --cached -z --no-renames --diff-filter=AMT "$fc_base" && printf 'end\0')
  if [ -z "$fc_complete" ]; then
    mb_refuse "could not list staged files, so the format check (.githooks/format-check) could not run." "" \
      "Fix the git error above and commit again."
  fi

  # Paths go on stdin, NUL-terminated, not as arguments: no command-line length limit, no MSYS
  # rewriting of path-like arguments on Windows, no path mistaken for an option. Run with bash so the
  # file needs no executable bit, and not at all when nothing is left to check.
  if [ "${#fc_files[@]}" -gt 0 ]; then
    # A script that stages anything (a formatter that re-adds what it fixed, a `git add -u`) would
    # otherwise commit content the checks above never saw -- handoff.md, or memory-bank/ in a linked
    # worktree. git commits whatever the index holds when this hook returns.
    fc_tree_before=$(git write-tree) || mb_refuse "could not record the staged tree before the format check." "" \
      "Fix the git error above and commit again."
    printf '%s\0' "${fc_files[@]}" | bash .githooks/format-check
    fc_rc=$?
    if [ "$fc_rc" -ne 0 ]; then
      echo "ERROR: the format check (.githooks/format-check) failed with exit $fc_rc, so the commit is refused."
      echo "Its own output above says what to fix. Re-stage the fixed files and commit again."
      exit 1
    fi
    if [ "$(git write-tree)" != "$fc_tree_before" ]; then
      mb_refuse "the format check (.githooks/format-check) changed the staged files, so the checks above no longer cover them." "" \
        "After a plain git commit, review what is staged now (git diff --cached) and commit again; the checks then run on it.
After git commit -a or git commit -- <path>, git has discarded what the script staged; only its edits on disk remain (git status)."
    fi
  fi
fi

# Review authorization is consumed only after every existing blocking check succeeds.
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || exit 1
REVIEW_GATE_SCRIPTS_DIR=$script_dir
export REVIEW_GATE_SCRIPTS_DIR
. "$script_dir/_review-gate-lib.sh"
if commit_touches_gitlink; then
    echo 'ERROR: Review gate: a staged submodule pointer or checked-out submodule HEAD changed, or git failed; this commit is refused.'
    exit 1
fi
if "$script_dir/review-evidence-check.sh" index >/dev/null 2>&1; then
    exit 0
fi
expected=$(commit_review_fingerprint) || { echo 'ERROR: no valid staged product review fingerprint.'; exit 1; }
marker=.claude/.code-review-ok
[ -f "$marker" ] && [ ! -L "$marker" ] || { echo 'ERROR: code review authorization missing.'; exit 1; }
printf '%s\n' "$expected" | cmp -s - "$marker" || { echo 'ERROR: code review authorization stale or malformed.'; exit 1; }
# Claim by atomic rename; a competing consumer cannot claim the same path.
claim=$(mktemp .claude/.code-review-claim.XXXXXX) || exit 1
if ! mv "$marker" "$claim" 2>/dev/null; then rm -f "$claim"; exit 1; fi
if ! printf '%s\n' "$expected" | cmp -s - "$claim"; then
    # Keep the unique claim: restoring could overwrite a concurrent writer's marker.
    echo "ERROR: code review authorization changed during claim; retained at $claim"
    exit 1
fi
rm -f "$claim"