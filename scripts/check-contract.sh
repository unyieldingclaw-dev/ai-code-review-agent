#!/usr/bin/env bash
# check-contract.sh — PreToolUse hook for Write/Edit
# Checks the active task contract and warns if the target file is out of scope.
# Always exits 0 (WARN tier). Exits silently if no contract or python3 unavailable.

set -euo pipefail

CONTRACT_FILE=".claude/contracts/active-task.json"

# --- Dependency check: python3 required for JSON parsing ---
if ! command -v python3 >/dev/null 2>&1; then
  exit 0  # Fail open: no python3, skip the check
fi

# --- Contract existence check ---
if [ ! -f "$CONTRACT_FILE" ]; then
  exit 0  # No contract — silent pass
fi

# --- Parse contract fields via python3 ---
CONTRACT_DATA=$(python3 - "$CONTRACT_FILE" <<'PYEOF'
import sys, json
path = sys.argv[1]
try:
    with open(path) as f:
        data = json.load(f)
    status = data.get("status", "")
    expires_at = data.get("expires_at", "")
    task = data.get("task", "")
    files = data.get("scope", {}).get("files", [])
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
" 2>/dev/null) || true
  if [ "$EXPIRED" = "yes" ]; then
    echo "⚠️  CONTRACT EXPIRED: The active task contract has expired."
    echo "    Task: $TASK"
    echo "    Propose a new contract before continuing."
    exit 0
  fi
fi

# --- Extract target file from tool input ---
TARGET_FILE=$(python3 -c "
import sys, json, os
try:
    data = json.loads(os.environ.get('CLAUDE_TOOL_INPUT', '{}'))
    print(data.get('file_path', ''))
except Exception:
    print('')
" 2>/dev/null) || true

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
" 2>/dev/null) || true
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
  echo "    Pause and confirm with user before proceeding."
fi

exit 0
