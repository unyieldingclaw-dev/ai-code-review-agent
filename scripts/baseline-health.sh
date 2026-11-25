#!/usr/bin/env bash
# scripts/baseline-health.sh — run this repo's deterministic CI checks locally.
#
# WHY THIS EXISTS: the review commands (`/code-review`, `/change-review`) each carried a prose
# description of which CI checks to run and how. That is a transcription of logic, re-performed by
# hand on every review, and it was measurably unreliable: reproducing the spec placeholder scan
# correctly requires a 20-line awk function with a fence-parity guard and a per-line backtick-parity
# guard, and an orchestrator's naive `grep` reimplementation reported 3 false positives on a clean
# tree. Transcribed CI *numbers* had already bitten this repo three times (see
# tests/test-threshold-parity.sh's header); transcribed CI *logic* is the same defect one level up.
#
# WHY EXTRACTION RATHER THAN REIMPLEMENTATION: this script does not contain a copy of any check. It
# locates each step by name in .github/workflows/pmb-health.yml, lifts the body of its `run:` block,
# and executes that verbatim. The workflow stays the single source of truth, so a threshold or
# pattern changed there takes effect here on the next run with no edit to this file. Nothing in this
# script needs updating when a cap is ratcheted.
#
# WHY AN EMPTY EXTRACTION IS A HARD ERROR RATHER THAN A SKIP: measured before this script was
# written — asking the extractor for a step name that does not exist yields zero bytes, and running
# zero bytes of bash exits 0. A runner that did not check would report a confident PASS for a check
# that never executed, and would do so the moment anyone renamed a step or re-indented the workflow.
# That is the "check that cannot fail" defect standards/CODE-REVIEW.md forbids by name, and it would
# make this script strictly WORSE than the prose it replaces, because prose does not emit a green
# tick. Every expected step must extract non-empty or this script fails loudly, naming the step, with
# an exit code distinct from a real check failure so the two are never confused.
#
# WHY CI'S OWN SHELL FLAGS: every step in the workflow declares `shell: bash`, which in GitHub
# Actions means `bash --noprofile --norc -eo pipefail`. Running the bodies under a plain `bash`
# would be measuring with a different instrument than the one being mirrored — the results happened
# to agree on both a clean and a deliberately broken tree when tested, but agreeing by luck is not
# the same as being correct.
#
# NETWORK: not fully offline by default. The "Check file sizes" step includes the startup-context
# ratchet, which runs `git fetch --depth=1 origin main || true` to establish its baseline. That is
# one shallow fetch, it fails soft, and it is disclosed here rather than denied — an earlier version
# of the review-command prose claimed this whole set was "fully local and offline", which was false.
#
# --no-fetch SUPPRESSES that fetch (and any other `git fetch` call a step's body happens to make) by
# prepending a throwaway directory to PATH containing a `git` wrapper: it intercepts the `fetch`
# subcommand and exits 0 without contacting the network, and delegates every other subcommand to the
# real git via `exec`, untouched. This is what a read-only caller — a review subagent with no write
# permission on this repository — needs to run every check without a repository write. An earlier
# version of this flag matched `git fetch` lines by regex and rewrote them in the extracted body
# before running it; that missed several shapes a fetch invocation can take (a bare `git fetch` with
# no trailing text, `git fetch-pack`, one wrapped in `if ...; then`) and needed two separate patterns
# — one to detect, one to rewrite — to ever agree with each other. Intercepting at invocation instead
# of text is shape-agnostic by construction, and it never edits the body: "executes that verbatim"
# (WHY EXTRACTION RATHER THAN REIMPLEMENTATION, one section up) holds under --no-fetch exactly as it
# does without it.
#
# WHY THIS IS SAFE TO DO GENERICALLY, without reimplementing the ratchet's own logic: the ratchet
# already fails soft to an advisory SKIP when `origin/main` cannot be read at all (`git cat-file -s
# origin/main:...` failing sets BASE_OK=0), which is exactly the outcome an absent or never-fetched
# `origin/main` produces once the fetch is suppressed. So --no-fetch does not need its own separate
# "is origin/main resolvable" guard; the workflow body's existing one already covers it.
#
# WHAT --no-fetch DOES NOT DO: refresh a stale local `origin/main`. The ratchet's design is that
# main's tracked aggregate only ever ratchets down (see .github/workflows/pmb-health.yml), so an
# OLDER cached ref is expected to read AT LEAST AS LARGE as a fresh one — a stale ref should make the
# comparison MORE lenient, not less, and so should not manufacture a FAIL a fresh fetch would clear.
# That protection is only as good as the ratchet's own enforcement history, not a guarantee this
# script can verify on its own. Report this honestly: a suppressed fetch prints a NOTE line naming
# the step and how many fetch attempts it made — observed after the body runs, not predicted from
# its text beforehand — and the NOTE does not claim a baseline was used: the step's own output still
# reports its own SKIP if origin/main isn't resolvable, exactly as it would with the network reachable.
#
# EXIT CODES — deliberately distinct, because these mean different things:
#   0  every check passed
#   1  at least one check FAILED (the repo has a real problem)
#   2  the workflow is not present (checks were SKIPPED, nothing was verified)
#   3  a step could not be extracted (this script or the workflow is broken — NOT a clean tree)

set -u

WORKFLOW=".github/workflows/pmb-health.yml"

# The steps to run, by their exact `- name:` in the workflow. Semgrep, PSScriptAnalyzer and
# gitleaks are deliberately absent: each needs a registry fetch, module install or network action,
# and per this repo's layering rule they are correctly CI-only.
#
# One list, used by both review commands. Previously each command carried its own prose list and
# the two had already drifted apart — one included Template Integrity, the other the ratchet.
STEPS=(
    "Check file sizes"
    "Credential grep"
    "Spec placeholder grep"
    "Invisible Unicode characters"
    "Hidden HTML comments in Markdown"
    "LLM bypass phrases"
    "Validate hook scripts referenced in templates/.claude/settings.json exist in templates/scripts/"
    "Check mirror parity"
)

VERBOSE=0
NO_FETCH=0
for arg in "$@"; do
    case "$arg" in
        -v|--verbose) VERBOSE=1 ;;
        --no-fetch) NO_FETCH=1 ;;
        -h|--help)
            echo "usage: bash scripts/baseline-health.sh [-v|--verbose] [--no-fetch]"
            echo "Runs the deterministic checks from $WORKFLOW by extracting and executing them."
            echo "--no-fetch intercepts git fetch at runtime (a wrapper ahead of PATH) instead of"
            echo "editing the body, so a read-only caller can run every check with no repository"
            echo "write. The ratchet's own SKIP-when-unavailable path handles the rest."
            echo "Exit: 0 pass  1 a check failed  2 workflow absent  3 extraction failed"
            exit 0
            ;;
        *) echo "baseline-health: unknown argument '$arg'" >&2; exit 3 ;;
    esac
done

# Run from the repository root: the workflow steps are written for that working directory.
ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
if [ -z "$ROOT" ]; then
    echo "baseline-health: not inside a git repository" >&2
    exit 3
fi
cd "$ROOT" || exit 3

if [ ! -f "$WORKFLOW" ]; then
    echo "=== baseline health ==="
    for s in "${STEPS[@]}"; do
        printf 'SKIPPED: %s\n' "$s"
    done
    echo ""
    echo "baseline-health: SKIPPED — $WORKFLOW is not present in this repository."
    echo "Nothing was verified. Do not report these checks as passing, and do not substitute"
    echo "remembered thresholds; this repository may not define these caps at all."
    exit 2
fi

# Lift the body of a step's `run: |` block. Matches the step by its exact name, then strips the
# 10-space block indent the workflow uses. Blank lines are preserved as blank rather than treated
# as the end of the block, since a blank line inside a run block is common and legal.
extract_step() {
    awk -v want="$1" '
        $0 ~ /^      - name: / {
            name = $0; sub(/^      - name: /, "", name)
            instep = (name == want); inrun = 0; next
        }
        instep && /^        run: \|/ { inrun = 1; next }
        inrun {
            if ($0 ~ /^[[:space:]]*$/) { print ""; next }
            if ($0 !~ /^          /) { inrun = 0; instep = 0; next }
            sub(/^          /, ""); print
        }
    ' "$WORKFLOW"
}

echo "=== baseline health ($WORKFLOW) ==="
FAILED=0
BODY=$(mktemp) || exit 3
OUT=$(mktemp) || exit 3

# --no-fetch: build the interceptor once, up front — its behavior does not depend on step content,
# so there is nothing step-specific to rebuild per iteration. REAL_GIT is resolved now, before this
# directory is on PATH, so the wrapper's own delegation can never resolve to itself.
SHIM_DIR=""
FETCH_LOG=""
if [ "$NO_FETCH" -eq 1 ]; then
    SHIM_DIR=$(mktemp -d) || exit 3
    FETCH_LOG=$(mktemp) || exit 3
    REAL_GIT=$(command -v git) || { echo "baseline-health: --no-fetch: git not found on PATH" >&2; exit 3; }
    cat > "$SHIM_DIR/git" <<EOF
#!/bin/bash
if [ "\$1" = "fetch" ]; then
    printf '%s\n' "\$*" >> "$FETCH_LOG"
    exit 0
fi
exec "$REAL_GIT" "\$@"
EOF
    chmod +x "$SHIM_DIR/git"
fi

cleanup() {
    rm -f "$BODY" "$OUT"
    [ -n "$FETCH_LOG" ] && rm -f "$FETCH_LOG"
    if [ -n "$SHIM_DIR" ]; then
        rm -f "$SHIM_DIR/git"
        rmdir "$SHIM_DIR" 2>/dev/null || true
    fi
}
trap cleanup EXIT

# extract_step only understands block-style steps. Refuse flow-style entries, including ones
# prefixed by an anchor, tag, or alias, before the exact-line duplicate check below.
# Match step indentation: a run: | body may legitimately contain the same text as shell data.
if grep -Eq '^      -[[:space:]]*[{&*!]|^    steps:[[:space:]]*\[' "$WORKFLOW"; then
    echo "baseline-health: UNSUPPORTED FLOW-STYLE STEP in $WORKFLOW"
    echo "  Step names cannot be verified safely; nothing ran. Use block-style steps."
    exit 3
fi

for step in "${STEPS[@]}"; do
    # WHY uniqueness is checked BEFORE extraction, and separately from emptiness:
    # extract_step matches on the step name and is not job-scoped, so a second step with the same
    # name anywhere in the file has its body CONCATENATED onto the first. Duplicate step names are
    # legal YAML — verified with a parser, not assumed — so this is reachable through a workflow
    # GitHub accepts, and the resulting body is non-empty, which means the emptiness guard below
    # passes it. That combination executes content nobody intended, under a known check's name,
    # and still reports PASS. The emptiness guard cannot catch it; only a count can.
    #
    matches=$(grep -Fxc "      - name: ${step}" "$WORKFLOW" || true)
    if [ "${matches:-0}" -eq 0 ]; then
        echo ""
        echo "baseline-health: EXTRACTION FAILED for step: $step"
        echo "  No step with that exact name exists in $WORKFLOW."
        echo "  It was probably renamed or the file re-indented. This is NOT a passing check —"
        echo "  nothing ran. Fix the name in this script's STEPS list, or fix the workflow."
        exit 3
    fi
    if [ "$matches" -ne 1 ]; then
        echo ""
        echo "baseline-health: AMBIGUOUS STEP NAME: $step"
        echo "  Found $matches steps with this exact name in $WORKFLOW; expected exactly 1."
        echo "  Extraction concatenates every match, so this would run unintended content under"
        echo "  this check's name. NOTHING WAS VERIFIED for this step."
        exit 3
    fi

    extract_step "$step" > "$BODY"

    # See the header: an empty extraction is a broken workflow or a broken extractor, never a pass.
    if [ ! -s "$BODY" ]; then
        echo ""
        echo "baseline-health: EXTRACTION FAILED for step: $step"
        echo "  No 'run:' body was found under that exact name in $WORKFLOW."
        echo "  The step was probably renamed or the file re-indented. This is NOT a passing check —"
        echo "  nothing ran. Fix the name in this script's STEPS list, or fix the workflow."
        exit 3
    fi

    # --no-fetch: run this step's body with the interceptor ahead of PATH. FETCH_LOG is truncated
    # first so a NOTE below reflects only THIS step's suppressed calls, never a prior step's.
    RUN_PATH="$PATH"
    if [ "$NO_FETCH" -eq 1 ]; then
        : > "$FETCH_LOG"
        RUN_PATH="$SHIM_DIR:$PATH"
    fi

    if PATH="$RUN_PATH" bash --noprofile --norc -eo pipefail "$BODY" > "$OUT" 2>&1; then
        printf 'PASS:    %s\n' "$step"
        [ "$VERBOSE" -eq 1 ] && sed 's/^/         /' "$OUT"
    else
        printf 'FAIL:    %s\n' "$step"
        sed 's/^/         /' "$OUT"
        FAILED=1
    fi

    # Reported from what was actually observed running the body, not predicted from its text
    # beforehand, so this can never claim a suppression that didn't happen. Does not claim a
    # baseline was used: the step's own output above still reports its own SKIP if origin/main
    # isn't resolvable, exactly as it would with the network reachable and empty.
    if [ "$NO_FETCH" -eq 1 ] && [ -s "$FETCH_LOG" ]; then
        n=$(grep -c . "$FETCH_LOG" || true)
        printf 'NOTE:    %s — --no-fetch suppressed %s git-fetch call(s); any origin/main comparison uses whatever ref is already resolvable locally.\n' "$step" "${n:-0}"
    fi
done

echo ""
if [ "$FAILED" -eq 0 ]; then
    echo "baseline-health: PASS (${#STEPS[@]} checks)"
else
    echo "baseline-health: FAIL — at least one check above failed."
    echo "A failure here is a real CI failure: these are the same check bodies the workflow runs."
fi
exit "$FAILED"
