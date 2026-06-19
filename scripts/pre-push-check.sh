#!/usr/bin/env bash
# Pre-push git hook — full error and warning check before any push.
# Called by .git/hooks/pre-push. Blocks on errors; warns on advisory issues.
# Fails open: unexpected errors print [HOOK ERROR] and allow the push.

set -euo pipefail 2>/dev/null || true   # bash 3 compat

FAILED=0
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
CONFLICTS=$(git diff --name-only --diff-filter=U 2>&1 || true)
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
DIRTY=$(git status --porcelain 2>&1 || true)
if [ -n "$DIRTY" ]; then
    echo -e "${YELLOW}[WARN] Uncommitted changes in working tree:${RESET}"
    echo "$DIRTY" | head -10 | while IFS= read -r line; do echo "       $line"; done
    echo -e "${YELLOW}       Commit or stash before pushing if these should be included.${RESET}"
    echo ""
fi

# Check 4: .gitattributes present (warn)
if [ ! -f ".gitattributes" ]; then
    echo -e "${YELLOW}[WARN] No .gitattributes — line-ending normalization not enforced.${RESET}"
    echo "       Create .gitattributes with '* text=auto eol=lf' to suppress CRLF warnings."
    echo ""
else
    echo -e "${GREEN}[OK]   .gitattributes present${RESET}"
fi

# Check 5: Possible secrets in commits being pushed (block)
# When a tracking ref exists, diff against it. When there is none (first push or
# untracked branch), scan all commits not yet on any known remote so first pushes
# are covered rather than silently skipped.
REMOTE=$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>&1 || true)
HAS_UPSTREAM=0
if [[ "$REMOTE" != *"fatal"* ]] && [ -n "$REMOTE" ]; then HAS_UPSTREAM=1; fi

# WHY: fixtures/ and docs/ are excluded from secret scanning:
# fixtures/security/ intentionally contains vulnerable code for regression testing;
# docs/ (specs, plans) may quote fixture content as documentation examples.
if [ "$HAS_UPSTREAM" -eq 1 ]; then
    PUSH_DIFF=$(git diff "${REMOTE}..HEAD" 2>&1 | awk '
        /^\+\+\+ b\// { in_excl = ($0 ~ /^\+\+\+ b\/(fixtures|docs)\//) }
        /^\+[^+]/ && !in_excl { print }
    ' || true)
else
    # WHY: --not --remotes finds every commit reachable from HEAD but not from any
    # remote-tracking ref — exactly what a first push would send. --format="" drops
    # commit headers so only patch lines remain.
    PUSH_DIFF=$(git log --not --remotes --format="" -p 2>&1 | awk '
        /^\+\+\+ b\// { in_excl = ($0 ~ /^\+\+\+ b\/(fixtures|docs)\//) }
        /^\+[^+]/ && !in_excl { print }
    ' || true)
    if [ -z "$PUSH_DIFF" ]; then
        echo -e "${GRAY}[SKIP] Secret scan — no commits to push (all already on a remote).${RESET}"
        echo ""
    fi
fi

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
if [ "$HAS_UPSTREAM" -eq 1 ]; then
    PUSH_FILE_LIST=$(git diff --name-only "${REMOTE}..HEAD" 2>/dev/null || true)
else
    PUSH_FILE_LIST=$(git log --not --remotes --format="" --name-only 2>/dev/null | sort -u | grep -v '^$' || true)
fi
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
    echo ""
fi

# Check 7: mb validate (warn if mb available)
if command -v mb &>/dev/null; then
    if ! mb validate &>/dev/null; then
        echo -e "${YELLOW}[WARN] mb validate reported issues — memory bank may be inconsistent:${RESET}"
        mb validate 2>&1 | while IFS= read -r line; do echo "       $line"; done
        echo ""
    else
        echo -e "${GREEN}[OK]   mb validate passed${RESET}"
    fi
else
    echo -e "${GRAY}[SKIP] mb not in PATH — skipping mb validate.${RESET}"
fi

echo ""
if [ "$FAILED" -ne 0 ]; then
    echo -e "${RED}[BLOCKED] Push aborted. Fix the errors above, then push again.${RESET}"
    echo ""
    exit 1
else
    echo -e "${GREEN}[PASS] All pre-push checks passed.${RESET}"
    echo ""
    exit 0
fi
