#!/usr/bin/env sh
if command -v python3 >/dev/null 2>&1; then
    python_cmd=python3
elif command -v python >/dev/null 2>&1; then
    python_cmd=python
else
    exit 1
fi
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || exit 1
exec "$python_cmd" "$script_dir/_review-evidence-check.py" "$@"
