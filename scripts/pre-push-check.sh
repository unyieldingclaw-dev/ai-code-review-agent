#!/usr/bin/env bash
# Pre-push git hook — full error and warning check before any push.
# Called by .git/hooks/pre-push. Blocks on errors; warns on advisory issues.
# Parser and fingerprint errors fail closed.

set -euo pipefail 2>/dev/null || true   # bash 3 compat

REVIEW_GATE_SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$REVIEW_GATE_SCRIPTS_DIR/_review-gate-lib.sh"
deny_push() { echo "[BLOCKED] Review gate: $*" >&2; exit 1; }
HEAD_OID=$(git rev-parse --verify HEAD) || deny_push "missing HEAD"
OBJECT_FORMAT=$(git rev-parse --show-object-format) || deny_push "unknown object format"
case "$OBJECT_FORMAT" in sha1) OID_LENGTH=40 ;; sha256) OID_LENGTH=64 ;; *) deny_push "unsupported object format" ;; esac
OID_PATTERN="^[0-9a-f]{$OID_LENGTH}$"
CONTENT=0
TUPLES=0
PUSH_PATCH=""
PUSH_FILE_LIST=""
while IFS= read -r tuple || [ -n "$tuple" ]; do
    read -r local_ref local_oid remote_ref remote_oid extra <<< "$tuple"
    [ "$tuple" = "$local_ref $local_oid $remote_ref $remote_oid" ] || deny_push "malformed tuple spacing"
    [ -n "$local_ref" ] && [ -n "$remote_ref" ] && [ -z "$extra" ] || deny_push "malformed tuple"
    [[ "$local_oid" =~ $OID_PATTERN ]] && [[ "$remote_oid" =~ $OID_PATTERN ]] || deny_push "invalid oid"
    git check-ref-format "$remote_ref" >/dev/null 2>&1 || deny_push "invalid remote ref"
    TUPLES=$((TUPLES+1))
    if [[ "$local_oid" =~ ^0+$ ]]; then
        [ "$local_ref" = "(delete)" ] && ! [[ "$remote_oid" =~ ^0+$ ]] || deny_push "invalid deletion"
        continue
    fi
    git check-ref-format "$local_ref" >/dev/null 2>&1 || deny_push "invalid local ref"
    resolved=$(git rev-parse --verify "$local_ref" 2>/dev/null) || deny_push "unknown local ref"
    [ "$resolved" = "$local_oid" ] || deny_push "local ref mismatch"
    if [[ "$remote_ref" == refs/tags/* && "$local_ref" == refs/tags/* ]]; then
        git symbolic-ref -q "$local_ref" >/dev/null 2>&1 && deny_push "symbolic tag"
        git --no-replace-objects merge-base --is-ancestor "$local_oid" refs/remotes/origin/main 2>/dev/null || deny_push "tag target not merged to main"
        continue
    fi
    [[ "$local_ref" == refs/heads/* && "$remote_ref" == refs/heads/* ]] || deny_push "unsupported refs"
    head_ref=$(git symbolic-ref -q HEAD) || deny_push "detached HEAD"
    [ "$local_ref" = "$head_ref" ] && [ "$local_oid" = "$HEAD_OID" ] || deny_push "non-HEAD source"
    if ! [[ "$remote_oid" =~ ^0+$ ]]; then
        git cat-file -e "$remote_oid^{commit}" 2>/dev/null || deny_push "unknown remote object"
        git merge-base --is-ancestor "$remote_oid" "$local_oid" || deny_push "non-fast-forward update"
    fi
    [ "$local_oid" != "$remote_oid" ] || continue
    CONTENT_OID="$local_oid"
    CONTENT=$((CONTENT+1))
    [ "$CONTENT" -eq 1 ] || deny_push "multiple content refs"
    if [[ "$remote_oid" =~ ^0+$ ]]; then
        PUSH_PATCH=$(git log "$local_oid" --format="" -p) || deny_push "history scan failed"
        PUSH_FILE_LIST=$(git log "$local_oid" --format="" --name-only) || deny_push "file scan failed"
    else
        PUSH_PATCH=$(git log "$remote_oid..$local_oid" --format="" -p) || deny_push "history scan failed"
        PUSH_FILE_LIST=$(git log "$remote_oid..$local_oid" --format="" --name-only) || deny_push "file scan failed"
    fi
done
[ "$TUPLES" -gt 0 ] || deny_push "empty stdin"

# WHY three counters, not one flag: a check has three possible outcomes — it passed,
# it failed, or it could not run. The original model had only FAILED, so both "warned"
# and "could not determine" rendered as success, and the summary printed
# "All pre-push checks passed" over the top of them. Four of the eight checks below are
# advisory and can never set FAILED, so that summary was asserting a result it had not
# earned. UNKNOWN exists specifically so a check that did not execute cannot be
# mistaken for one that passed.
FAILED=0
WARNED=0
UNKNOWN=0

# ENFORCE=true promotes warnings and unknowns to blocking. Default is advisory, matching
# templates/.github/workflows/memory-bank-size.yml — a gate that blocks on a stale
# template gets disabled within a week, so honesty is the default and enforcement opt-in.
ENFORCE="${ENFORCE:-false}"

RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
GRAY='\033[0;90m'
RESET='\033[0m'

echo ""
echo -e "${GREEN}Pre-push checks${RESET}"
echo "==============="
echo ""

# Check 1: Unresolved merge conflicts (block)
CONFLICTS=$(git diff --name-only --diff-filter=U 2>/dev/null || true)
if [ -n "$CONFLICTS" ]; then
    echo -e "${RED}[ERROR] Unresolved merge conflicts:${RESET}"
    echo "$CONFLICTS" | while IFS= read -r f; do echo "        $f"; done
    FAILED=1
    echo ""
fi

# Check 2: Conflict markers in tracked files (block)
if git grep -lq "^<<<<<<< " --cached 2>/dev/null; then
    echo -e "${RED}[ERROR] Conflict markers found in staged files:${RESET}"
    git grep -l "^<<<<<<< " --cached | while IFS= read -r f; do echo "        $f"; done
    FAILED=1
    echo ""
fi

# Check 3: Uncommitted changes in working tree (warn)
DIRTY=$(git status --porcelain 2>/dev/null || true)
if [ -n "$DIRTY" ]; then
    echo -e "${YELLOW}[WARN] Uncommitted changes in working tree:${RESET}"
    echo "$DIRTY" | head -10 | while IFS= read -r line; do echo "       $line"; done
    echo -e "${YELLOW}       Commit or stash before pushing if these should be included.${RESET}"
    WARNED=$((WARNED + 1))
    echo ""
fi

# Check 4: .gitattributes present (warn)
if [ ! -f ".gitattributes" ]; then
    echo -e "${YELLOW}[WARN] No .gitattributes — line-ending normalization not enforced.${RESET}"
    echo "       Create .gitattributes with '* text=auto eol=lf' to suppress CRLF warnings."
    WARNED=$((WARNED + 1))
    echo ""
else
    echo -e "${GREEN}[OK]   .gitattributes present${RESET}"
fi

# Check 5: Possible secrets in commits being pushed (block)
# Scan the actual outgoing commit range; a new branch scans its full reachable history.
PUSH_DIFF=$(printf '%s\n' "$PUSH_PATCH" | awk '
    /^\+\+\+ b\// { in_excl = ($0 ~ /^\+\+\+ b\/(fixtures|docs)\//) }
    /^\+[^+]/ && !in_excl { print }
')
check_secret() {
    local label="$1" pattern="$2"
    local hits
    hits=$(echo "$PUSH_DIFF" | grep -E "$pattern" | head -3 || true)
    if [ -n "$hits" ]; then
        echo -e "${RED}[ERROR] Possible ${label} in push diff:${RESET}"
        echo "$hits" | while IFS= read -r line; do echo "        $line"; done
        FAILED=1
        echo ""
    fi
}

check_secret "AWS access key"            'AKIA[0-9A-Z]{16}'
check_secret "OpenAI/Anthropic API key"  'sk-[a-zA-Z0-9]{32,}'
check_secret "GitHub personal token"     'ghp_[a-zA-Z0-9]{36}'
check_secret "Generic password"          'password[[:space:]]*=[[:space:]]*["'"'"'][^"'"'"'[:space:]]{8,}'
check_secret "Generic secret"            'secret[[:space:]]*=[[:space:]]*["'"'"'][^"'"'"'[:space:]]{8,}'

# Check 6: Files over 500 KB in push (warn)
LARGE=$(echo "$PUSH_FILE_LIST" | while IFS= read -r f; do
    if [ -n "$f" ] && [ -f "$f" ]; then
        bytes=$(wc -c < "$f" 2>/dev/null || echo 0)
        if [ "$bytes" -gt 512000 ]; then
            kb=$(( bytes / 1024 ))
            echo "$f (${kb} KB)"
        fi
    fi
done || true)
if [ -n "$LARGE" ]; then
    echo -e "${YELLOW}[WARN] Large files in push (>500 KB):${RESET}"
    echo "$LARGE" | while IFS= read -r line; do echo "       $line"; done
    echo "       Consider .gitignore or Git LFS for binary/generated files."
    WARNED=$((WARNED + 1))
    echo ""
fi

# Check 7: memory-bank integrity via mb doctor
#
# WHY this no longer calls `mb validate`: that command was deprecated into `mb doctor` and
# now resolves to a shim that prints a redirect notice and exits 2 (measured, not assumed).
# The old check treated any non-zero exit as a memory-bank problem, so every push in every
# managed project emitted "[WARN] mb validate reported issues — memory bank may be
# inconsistent:" and then quoted the redirect notice underneath it as though that were the
# evidence. Nothing could clear it: the warning did not describe the memory bank at all, and
# it was immediately followed by "[PASS] All pre-push checks passed" — a self-contradicting
# gate. Observed on ai-code-review-agent, which is pinned at PMB 1.1.1 and still runs the old
# check. An exit code cannot distinguish "ran and passed" from "ran and failed" from "never
# ran" — that is the general trap, and every deprecated alias inherits it.
#
# WHY the verdict is parsed from output rather than taken from an exit code: doctor exits 1
# only for a FATAL finding; its advisory [ERROR] lines (checksum mismatch, startup-context
# ceiling) leave the exit code at 0, so the exit code cannot carry the verdict this check
# reports — and `|| true` below discards it anyway so a fatal run still gets parsed. Its
# output is structured — every check emits [OK], [WARN] or [ERROR] — so counting those lines
# yields both the verdict AND a positive assertion that the command actually ran. Zero result
# lines means no checks executed (deprecated shim, crash, missing binary, or an mb.ps1 old
# enough to reject --check), which is UNKNOWN, never success. Measured: a real run emits ~51
# result lines; the shim emits 0.
#
# WHY `--check`, and why the marker is required: plain `mb doctor` rewrites .pmb-checksums at
# the end of every run, so calling it here re-baselined on every push — a memory-bank
# mismatch was reported once, by the run that then erased it. `--check` compares without
# writing, and confirms so with a fixed ASCII marker line. An mb.sh that predates --check
# ignores the flag and rewrites silently; the missing marker is how that run is caught, as
# UNKNOWN rather than trusted.
#
# WHY the checksum mismatch gets its own line: it would otherwise be folded into the generic
# error count and can fall outside the first-five echo. It counts as a warning, so
# ENFORCE=true blocks until the mismatch is accepted with `mb verify-integrity`.
if command -v mb >/dev/null 2>&1; then
    DOCTOR_OUT=$(mb doctor --check 2>&1 || true)
    RESULT_LINES=$(printf '%s\n' "$DOCTOR_OUT" | grep -cE '\[(OK|WARN|ERROR)\]' 2>/dev/null || true)
    RESULT_LINES=${RESULT_LINES:-0}
    if [ "$RESULT_LINES" -eq 0 ]; then
        echo -e "${YELLOW}[UNKNOWN] mb doctor produced no check results — memory bank NOT verified.${RESET}"
        echo "          The command ran but emitted no [OK]/[WARN]/[ERROR] lines."
        # WHY the fix names the clone, not just `mb upgrade`: upgrade copies templates FROM the
        # PMB clone behind `mb` (MB_HOME), so run from an outdated clone it reinstalls the old
        # hook — clearing this message by bringing back the silent re-baseline.
        echo "          One cause: an mb older than this hook, which rejects --check."
        echo "          Fix: update the PMB clone that MB_HOME points at, then run: mb upgrade"
        UNKNOWN=$((UNKNOWN + 1))
        echo ""
    else
        CHECK_MODE_SEEN=false
        printf '%s\n' "$DOCTOR_OUT" | grep -qF 'Integrity check mode:' && CHECK_MODE_SEEN=true
        if [ "$CHECK_MODE_SEEN" != true ]; then
            echo -e "${YELLOW}[UNKNOWN] mb doctor did not confirm check mode — integrity NOT verified.${RESET}"
            echo "          The mb on PATH predates 'doctor --check' and may have re-baselined .pmb-checksums."
            echo "          Fix: update the PMB clone that MB_HOME points at, then run: mb upgrade"
            UNKNOWN=$((UNKNOWN + 1))
            echo ""
        fi
        MISMATCH_LINES=$(printf '%s\n' "$DOCTOR_OUT" | grep -E '\[ERROR\].*hash mismatch' || true)
        OTHER_ERRORS=$(printf '%s\n' "$DOCTOR_OUT" | grep -E '\[ERROR\]' | grep -v 'hash mismatch' || true)
        if [ -n "$MISMATCH_LINES" ]; then
            MISMATCH_COUNT=$(printf '%s\n' "$MISMATCH_LINES" | grep -c . || true)
            echo -e "${YELLOW}[WARN] memory-bank changed since the last accepted integrity baseline: ${MISMATCH_COUNT} file(s)${RESET}"
            printf '%s\n' "$MISMATCH_LINES" | while IFS= read -r line; do echo "       $line"; done
            echo "       Review the changes, then accept them with: mb verify-integrity"
            WARNED=$((WARNED + 1))
            echo ""
        fi
        if [ -n "$OTHER_ERRORS" ]; then
            DOCTOR_ERRORS=$(printf '%s\n' "$OTHER_ERRORS" | grep -c . || true)
            echo -e "${YELLOW}[WARN] mb doctor reported ${DOCTOR_ERRORS} error(s) across ${RESULT_LINES} result lines:${RESET}"
            # `|| true` guards the pipeline: `head -5` closes the pipe once satisfied, and
            # under `set -o pipefail` printf's resulting SIGPIPE would abort the script before
            # the summary block ever runs — turning a warning into a verdict-less exit.
            { printf '%s\n' "$OTHER_ERRORS" | head -5 || true; } | while IFS= read -r line; do echo "       $line"; done
            WARNED=$((WARNED + 1))
            echo ""
        fi
        if printf '%s\n' "$DOCTOR_OUT" | grep -qF 'Integrity checksums: no baseline'; then
            # INFO, not a warning: a fresh clone or worktree has no baseline (.pmb-checksums is
            # gitignored) and --check never creates one, so counting it would warn — and with
            # ENFORCE, block — on every push until someone ran a command unrelated to the push.
            echo "[INFO] No memory-bank integrity baseline yet — run 'mb verify-integrity' to start tracking edits."
            echo ""
        fi
        if [ "$CHECK_MODE_SEEN" = true ] && [ -z "$MISMATCH_LINES" ] && [ -z "$OTHER_ERRORS" ]; then
            # "result lines", not "checks": this counts emitted [OK]/[WARN]/[ERROR] markers,
            # which exceeds the number of named doctor checks. Claiming a check count this
            # figure does not represent would repeat the unearned-assertion bug being fixed.
            echo -e "${GREEN}[OK]   mb doctor: ${RESULT_LINES} result lines, no errors${RESET}"
        fi
    fi
else
    echo -e "${YELLOW}[UNKNOWN] mb not in PATH — memory bank NOT verified.${RESET}"
    UNKNOWN=$((UNKNOWN + 1))
fi

# Check 8: review-evidence containment, the check CI's Trusted Review Containment job runs
#
# WHY here and blocking: before this check a branch whose committed review records did not
# cover its commits passed locally and failed only in CI, after a run's minutes were spent
# (13 of 18 failed runs in one 60-run window, 2026-11-20). Running the same checker against
# the same base turns that into a local deny. Not being able to run it (no Python, a shallow
# clone, no origin/main) is UNKNOWN, never a pass. PMB's own CI still checks; adopter repos ship
# no containment job, so there this check is the only one.
if [ "$CONTENT" -eq 1 ]; then
    if ! command -v python3 >/dev/null 2>&1 && ! command -v python >/dev/null 2>&1; then
        echo -e "${YELLOW}[UNKNOWN] Review evidence NOT checked: Python is not on PATH (CI checks it only where the repo runs a containment job).${RESET}"
        UNKNOWN=$((UNKNOWN + 1))
    elif [ "$(git rev-parse --is-shallow-repository 2>/dev/null)" != false ]; then
        echo -e "${YELLOW}[UNKNOWN] Review evidence NOT checked: the clone is shallow (CI checks it only where the repo runs a containment job).${RESET}"
        UNKNOWN=$((UNKNOWN + 1))
    elif ! git rev-parse --verify -q refs/remotes/origin/main >/dev/null 2>&1; then
        echo -e "${YELLOW}[UNKNOWN] Review evidence NOT checked: no origin/main to compare against (CI checks it only where the repo runs a containment job).${RESET}"
        UNKNOWN=$((UNKNOWN + 1))
    elif EVIDENCE_OUT=$(_review_evidence_check contain refs/remotes/origin/main "$CONTENT_OID" 2>&1); then
        echo -e "${GREEN}[OK]   Review evidence covers every commit since origin/main${RESET}"
    else
        echo -e "${RED}[ERROR] Review evidence does not cover this push:${RESET}"
        printf '%s\n' "$EVIDENCE_OUT" | while IFS= read -r line; do echo "        $line"; done
        echo "        If a commit changed after its /code-review (amend, rebase, squash), review it again."
        echo "        Otherwise run /change-review on this branch and commit its record before pushing."
        echo "        If main moved since your last fetch, run: git fetch origin main, then push again."
        FAILED=1
    fi
    echo ""
fi

echo ""
# Spend approval only after every blocking health check.
if [ "$FAILED" -eq 0 ] && { [ "$ENFORCE" != true ] || { [ "$UNKNOWN" -eq 0 ] && [ "$WARNED" -eq 0 ]; }; } && [ "$CONTENT" -eq 1 ]; then
    expected=$(push_review_fingerprint) || deny_push "canonical fingerprint unavailable"
    [ "$(git rev-parse --verify HEAD)" = "$CONTENT_OID" ] || deny_push "HEAD changed during checks"
    marker=".claude/.change-review-ok"
    [ -f "$marker" ] || deny_push "missing change review"
    printf '%s\n' "$expected" | cmp -s - "$marker" || deny_push "stale or wrong-type marker"
    claim=$(mktemp ".claude/.push-consume.XXXXXX") || deny_push "cannot claim marker"
    mv "$marker" "$claim" 2>/dev/null || { rm -f "$claim"; deny_push "marker already consumed"; }
    if ! printf '%s\n' "$expected" | cmp -s - "$claim"; then
        deny_push "marker changed during claim; retained at $claim"
    fi
    rm -f "$claim"
fi
# WHY the summary distinguishes three states: "[PASS] All pre-push checks passed" may
# only print when every check actually passed. Previously it printed whenever no
# BLOCKING check failed, so it appeared directly beneath warnings it contradicted, and
# beneath a check that had not run at all. A summary that cannot express "warned" or
# "could not verify" will always overstate the result.
if [ "$FAILED" -ne 0 ]; then
    echo -e "${RED}[BLOCKED] Push aborted. Fix the errors above, then push again.${RESET}"
    echo ""
    exit 1
elif [ "$UNKNOWN" -ne 0 ]; then
    echo -e "${YELLOW}[DEGRADED] ${UNKNOWN} check(s) could not run; ${WARNED} warning(s). Not all checks were verified.${RESET}"
    if [ "$ENFORCE" = "true" ]; then
        echo -e "${RED}           ENFORCE=true — treating unverified checks as blocking.${RESET}"
        echo ""
        exit 1
    fi
    echo ""
    exit 0
elif [ "$WARNED" -ne 0 ]; then
    echo -e "${YELLOW}[PASS with ${WARNED} warning(s)] No blocking issues; review the warnings above.${RESET}"
    if [ "$ENFORCE" = "true" ]; then
        echo -e "${RED}           ENFORCE=true — treating warnings as blocking.${RESET}"
        echo ""
        exit 1
    fi
    echo ""
    exit 0
else
    echo -e "${GREEN}[PASS] All pre-push checks passed.${RESET}"
    echo ""
    exit 0
fi
