#!/usr/bin/env bash
# check-contract.sh — PreToolUse hook for Write/Edit
# Checks the active task contract and warns if the target file is out of scope.
# WARN tier by default (advisory, allows the write); PMB_CONTRACT_HARD_BLOCK=1 promotes this to a
# real block. All logic lives in check-contract-core.py beside this file; this wrapper only finds
# python3 and hands it stdin.
#
# WHY no PowerShell twin ([NS-67] (a)): a second implementation kept reaching different decisions
# from this one, review round after review round. The core is the only implementation.

# WHY no python3 = silent pass: it is a documented requirement for enforcement
# (docs/CONTRACTS-GUIDE.md); this hook is a scope guardrail, not a security boundary.
command -v python3 >/dev/null 2>&1 || exit 0

# WHY the script's own directory, not the CWD: one fixed file is run, whatever directory the
# hook starts in. WHY -I: a json.py or re.py in the repo, or a PYTHON* variable, is ignored.
CORE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/check-contract-core.py"
[ -f "$CORE" ] || exit 0
python3 -I "$CORE"
exit 0
