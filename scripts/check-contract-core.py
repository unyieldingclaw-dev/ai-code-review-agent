"""check-contract-core.py -- the whole Contract Scope Check, called by check-contract.sh.

Reads the PreToolUse payload on stdin and .claude/contracts/active-task.json from the CWD, and
writes the hook's entire stdout: nothing (allow), the plain-text scope or expiry warning, or, with
PMB_CONTRACT_HARD_BLOCK=1, exactly one deny JSON object. Always exits 0.

WHY one Python file and no PowerShell twin ([NS-67] (a)): four review rounds of the sh/ps1 pair
each found new inputs on which the twins reached different decisions (status case, a BOM, a
top-level array, a timezone-less expiry, a list-valued "file", path normalization, output
encoding). One implementation cannot disagree with itself. Run it with python3 -I, so a json.py
or re.py planted in the repo is never imported.
"""
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone

CONTRACT = ".claude/contracts/active-task.json"
HARD = os.environ.get("PMB_CONTRACT_HARD_BLOCK", "") == "1"
WIN = os.name == "nt" or sys.platform.startswith(("cygwin", "msys"))


class Invalid(Exception):
    """The contract exists but is not the documented shape (docs/CONTRACTS-GUIDE.md)."""


def emit(text):
    # WHY bytes: on Windows a piped stdout is cp1252, which cannot encode most paths, and -I
    # ignores PYTHONIOENCODING. Lone surrogates become "?", never an exception.
    sys.stdout.buffer.write(text.encode("utf-8", "replace"))
    sys.stdout.buffer.flush()


def deny(reason):
    # WHY ensure_ascii (json.dumps' default): the object stays pure ASCII whatever the path holds.
    emit(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse",
                                            "permissionDecision": "deny",
                                            "permissionDecisionReason": reason}}) + "\n")


def one_line(s):
    return " ".join(str(s).splitlines())


def load_contract():
    """None when there is no contract file; else (status, expires, task, files). Raises Invalid."""
    try:
        with open(CONTRACT, "rb") as f:
            raw = f.read()
    except FileNotFoundError:
        return None
    except OSError as e:
        raise Invalid("unreadable: %s" % e.__class__.__name__)
    try:
        # WHY utf-8-sig: Windows editors and PowerShell 5 write a BOM; a BOM is not a bad contract.
        data = json.loads(raw.decode("utf-8-sig"))
    except (UnicodeDecodeError, ValueError):
        raise Invalid("not valid UTF-8 JSON")
    if not isinstance(data, dict):
        raise Invalid("the top level is not an object")
    status = data.get("status")
    if status not in ("active", "complete", "cancelled"):
        raise Invalid('"status" is not "active", "complete" or "cancelled"')
    task = data.get("task", "")
    if not isinstance(task, str):
        raise Invalid('"task" is not a string')
    expires = None
    if "expires_at" in data:
        exp = data["expires_at"]
        if not isinstance(exp, str):
            raise Invalid('"expires_at" is not a string')
        try:
            expires = datetime.fromisoformat(exp.replace("Z", "+00:00"))
        except ValueError:
            raise Invalid('"expires_at" is not an ISO 8601 time')
        if expires.tzinfo is None:
            # WHY: a naive time cannot be compared with now; guessing a zone shifts expiry by hours.
            raise Invalid('"expires_at" has no timezone')
    scope = data.get("scope", [])
    if not isinstance(scope, list):
        raise Invalid('"scope" is not an array')
    files = []
    for entry in scope:
        if not isinstance(entry, dict) or not isinstance(entry.get("file"), str) or not entry["file"]:
            raise Invalid('a "scope" entry is not an object with a non-empty "file" string')
        files.append(entry["file"])
    return status, expires, task, files


def norm(p):
    """(normalized path or None for '..', is_absolute). See docs/CONTRACTS-GUIDE.md."""
    p = p.replace("\\", "/")
    m = re.match(r"^/([A-Za-z])(?:/|\Z)", p)
    if m and WIN:
        p = m.group(1) + ":/" + p[3:]
    if re.match(r"^[A-Za-z]:", p):
        p = p[0].upper() + p[1:]
    absolute = p.startswith("/") or bool(re.match(r"^[A-Za-z]:/", p))
    segs = [s for s in p.split("/") if s not in ("", ".")]
    if ".." in segs:
        return None, absolute
    out = ("/" if p.startswith("/") else "") + "/".join(segs)
    # WHY A-Z only: full Unicode lower-casing maps U+0130 to two characters, so a non-ASCII case
    # variant is left unmatched, which denies (the safe direction).
    return (re.sub("[A-Z]", lambda c: c.group().lower(), out) if WIN else out), absolute


def glob(pat):
    # WHY not fnmatch: "*" is any run (including "/"), "?" one character, all else literal --
    # the dialect docs/CONTRACTS-GUIDE.md documents.
    return re.compile("".join(".*" if c == "*" else "." if c == "?" else re.escape(c) for c in pat), re.S)


def repo_top():
    try:
        r = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, timeout=10)
        top = r.stdout.decode("utf-8", "replace").strip()
        if r.returncode == 0 and top:
            return top
    except (OSError, subprocess.SubprocessError):
        pass
    return os.getcwd()


def in_scope(target, files):
    t, absolute = norm(target)
    top, _ = norm(repo_top())
    if t is None or not top:
        return False
    if absolute:
        base = top.rstrip("/") + "/"
        if not t.startswith(base):
            return False  # another repo, a sibling worktree, or outside any repo
        t = t[len(base):]
    if t == CONTRACT:
        return True  # so the task can always be closed under hard-block
    for raw in files:
        pat, _ = norm(raw)
        if pat is None:
            continue
        is_dir = raw.replace("\\", "/").endswith("/")
        if t == pat or (is_dir and t.startswith(pat + "/")) or glob(pat).fullmatch(t):
            return True
    return False


def main():
    try:
        contract = load_contract()
    except Invalid as e:
        msg = "The active task contract (%s) is invalid: %s." % (CONTRACT, e)
        if HARD:
            deny(msg + " Hard-block active (PMB_CONTRACT_HARD_BLOCK=1): fix or remove the contract.")
        else:
            emit("⚠️  CONTRACT INVALID: %s\n    Fix it, or propose a new contract.\n" % msg)
        return
    if contract is None:
        return
    status, expires, task, files = contract
    if status != "active":
        return
    if expires is not None and datetime.now(timezone.utc) > expires:
        emit("⚠️  CONTRACT EXPIRED: The active task contract has expired.\n"
             "    Task: %s\n    Propose a new contract before continuing.\n" % one_line(task))
        return
    try:
        payload = json.loads(sys.stdin.buffer.read().decode("utf-8", "replace"))
        target = payload.get("tool_input", {}).get("file_path", "")
    except (ValueError, AttributeError):
        return  # not a Write/Edit payload: nothing to check
    if not isinstance(target, str) or not target:
        return
    if in_scope(target, files):
        return
    shown = one_line(target)
    if HARD:
        deny("Writing to '%s' is outside the active contract (task: %s). Hard-block active "
             "(PMB_CONTRACT_HARD_BLOCK=1)." % (shown, one_line(task)))
        return
    emit("⚠️  CONTRACT SCOPE: Writing to '%s' is outside the active contract.\n"
         "    Task: %s\n    Declared scope: %s\n    Pause and confirm with user before proceeding.\n"
         % (shown, one_line(task), ", ".join(one_line(f) for f in files)))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa: BLE001
        # WHY deny under hard-block: an unexpected error is not evidence the write is in scope.
        if HARD:
            deny("The contract scope check failed (%s). Hard-block active (PMB_CONTRACT_HARD_BLOCK=1)."
                 % e.__class__.__name__)
    sys.exit(0)
