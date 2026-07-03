#!/usr/bin/env bash
# check-contract.sh — PreToolUse hook for Write/Edit
# Checks the active task contract and warns if the target file is out of scope.
# WARN tier by default (advisory, allows the write); PMB_CONTRACT_HARD_BLOCK=1
# promotes this to a real block. Exits silently if no contract or python3 unavailable.

set -euo pipefail

CONTRACT_FILE=".claude/contracts/active-task.json"

deny() {
    printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}\n' "$1"
}

# WHY: Claude Code PreToolUse hooks pass tool input as JSON via stdin, not env vars.
HOOK_INPUT=$(cat 2>/dev/null) || HOOK_INPUT=""

# --- Dependency check: python3 required for JSON parsing ---
if ! command -v python3 >/dev/null 2>&1; then
  exit 0  # Fail open: no python3, skip the check
fi

# --- Contract existence check ---
if [ ! -f "$CONTRACT_FILE" ]; then
  exit 0  # No contract — silent pass
fi

# --- Parse contract fields via python3 ---
# WHY: scope is an array of {file, op} objects per docs/CONTRACTS-GUIDE.md, not an
# object with a "files" property. The prior version read scope.get("files", []),
# which is always empty against a real contract — the scope check never matched
# anything.
#
# WHY "| tr -d '\r'": on Windows, python3's print() emits \r\n line endings. Piping
# a single value through $(...) strips the trailing \n but not \r, and multi-line
# output extracted via `tail`/`read` preserves \r entirely (unlike `sed -n Np`,
# which happens to normalize it away) -- empirically confirmed this caused exact
# scope matches to silently fail (`"scripts/foo.ps1\r" != "scripts/foo.ps1"`),
# making the scope check never actually match anything on Windows even with the
# correct schema. Stripping \r here is defensive and a no-op on POSIX systems.
CONTRACT_DATA=$(python3 - "$CONTRACT_FILE" <<'PYEOF' | tr -d '\r'
import sys, json
path = sys.argv[1]
try:
    with open(path) as f:
        data = json.load(f)
    status = data.get("status", "")
    expires_at = data.get("expires_at", "")
    task = data.get("task", "")
    files = [entry.get("file", "") for entry in data.get("scope", []) if entry.get("file")]
    print(status)
    print(expires_at)
    print(task)
    print("\n".join(files))
except Exception:
    pass
PYEOF
) || true

if [ -z "$CONTRACT_DATA" ]; then
  exit 0  # Malformed contract — fail open
fi

# Extract parsed fields (line-delimited)
STATUS=$(echo "$CONTRACT_DATA" | sed -n '1p')
EXPIRES_AT=$(echo "$CONTRACT_DATA" | sed -n '2p')
TASK=$(echo "$CONTRACT_DATA" | sed -n '3p')
SCOPE_FILES=$(echo "$CONTRACT_DATA" | tail -n +4)

# --- Status check ---
if [ "$STATUS" != "active" ]; then
  exit 0  # Contract is complete or cancelled — silent pass
fi

# --- Expiry check ---
if [ -n "$EXPIRES_AT" ]; then
  EXPIRED=$(EXPIRES_AT="$EXPIRES_AT" python3 -c "
import os
from datetime import datetime, timezone
try:
    expires = datetime.fromisoformat(os.environ['EXPIRES_AT'].replace('Z', '+00:00'))
    now = datetime.now(timezone.utc)
    print('yes' if now > expires else 'no')
except Exception:
    print('no')
" 2>/dev/null | tr -d '\r') || true
  if [ "$EXPIRED" = "yes" ]; then
    echo "⚠️  CONTRACT EXPIRED: The active task contract has expired."
    echo "    Task: $TASK"
    echo "    Propose a new contract before continuing."
    exit 0
  fi
fi

# --- Extract target file from tool input ---
# WHY .get('tool_input', {}).get('file_path', ''), not .get('file_path', ''): the real
# payload nests everything under "tool_input" (e.g. {"tool_name":"Edit","tool_input":
# {"file_path":"..."}}), confirmed by capturing a live hook payload. The prior version
# read the flat field, which is always empty against the real payload shape.
TARGET_FILE=$(echo "$HOOK_INPUT" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    print(data.get('tool_input', {}).get('file_path', ''))
except Exception:
    print('')
" 2>/dev/null | tr -d '\r') || true

if [ -z "$TARGET_FILE" ]; then
  exit 0  # Can't determine target — fail open
fi

# --- Scope check ---
IN_SCOPE=0
while IFS= read -r pattern; do
  [ -z "$pattern" ] && continue
  # Exact match
  if [ "$TARGET_FILE" = "$pattern" ]; then
    IN_SCOPE=1
    break
  fi
  # Directory prefix match (pattern ends with /)
  if [[ "$pattern" == */ ]] && [[ "$TARGET_FILE" == "$pattern"* ]]; then
    IN_SCOPE=1
    break
  fi
  # Glob match via python3 fnmatch
  MATCH=$(TARGET_FILE="$TARGET_FILE" PATTERN="$pattern" python3 -c "
import fnmatch, os
print('yes' if fnmatch.fnmatch(os.environ['TARGET_FILE'], os.environ['PATTERN']) else 'no')
" 2>/dev/null | tr -d '\r') || true
  if [ "$MATCH" = "yes" ]; then
    IN_SCOPE=1
    break
  fi
done <<< "$SCOPE_FILES"

if [ "$IN_SCOPE" -eq 0 ]; then
  SCOPE_SUMMARY=$(echo "$SCOPE_FILES" | tr '\n' ',' | sed 's/,$//' | sed 's/,/, /g')
  echo "⚠️  CONTRACT SCOPE: Writing to '$TARGET_FILE' is outside the active contract."
  echo "    Task: $TASK"
  echo "    Declared scope: $SCOPE_SUMMARY"
  # WHY: PMB_CONTRACT_HARD_BLOCK=1 promotes scope warnings to a real block. Default
  # is warn-only; hard-block is opt-in. Uses permissionDecision:deny, not an exit
  # code, for the same reason documented in dangerous-commands.sh -- exit codes are
  # unreliable under this hook's "|| true" fail-open wiring in settings.json.
  if [ "${PMB_CONTRACT_HARD_BLOCK:-}" = "1" ]; then
    deny "Writing to '$TARGET_FILE' is outside the active contract (task: $TASK). Hard-block active (PMB_CONTRACT_HARD_BLOCK=1)."
    exit 0
  fi
  echo "    Pause and confirm with user before proceeding."
fi

exit 0
