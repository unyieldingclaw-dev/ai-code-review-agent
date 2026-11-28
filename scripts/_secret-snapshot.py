"""PMB supplemental secret-scan evidence. Execute only from a trusted installation."""
import argparse
from contextlib import contextmanager
import ctypes
from ctypes import wintypes
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import signal
import stat
import subprocess
import sys
import tempfile
import threading
import time
import unicodedata

SUBDIRS = ("acr-policy", "scanner-policy", "payload", "results")
MIB = 1 << 20
LIMITS = dict(inputs=256, roots=64, blob=2*MIB, payload=32*MIB, git_seconds=10,
              inventory=16*MIB, scan_seconds=10, scan_total=60, report=4*MIB, output=MIB)
POLICY = "secret-snapshot.gitleaks.toml"
HELPERS = ("_secret-snapshot.py", "secret-snapshot.sh", "secret-snapshot.ps1", POLICY)


class Invalid(ValueError):
    """Messages are trusted classifications, never Git/scanner stderr or source bytes."""


class Limited(Exception):
    pass


def need(condition, reason):
    if not condition:
        raise Invalid(reason)


def canonical(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def sha(data):
    return hashlib.sha256(data).hexdigest()


def file_hash(path):
    with path.open("rb") as stream:
        digest = hashlib.sha256()
        for chunk in iter(lambda: stream.read(65536), b""):
            digest.update(chunk)
        return digest.hexdigest()


def linked(info):
    return stat.S_ISLNK(info.st_mode) or getattr(info, "st_file_attributes", 0) & 0x400


def restrict(root):
    if os.name != "nt":
        root.chmod(0o700)
        need(stat.S_IMODE(root.stat().st_mode) == 0o700, "privacy unavailable")
        return
    # D:P protects the ACL from inheritance. OI/CI propagates both ACEs to all children.
    adv, kernel = ctypes.windll.advapi32, ctypes.windll.kernel32
    handle, sid_text, descriptor = wintypes.HANDLE(), wintypes.LPWSTR(), ctypes.c_void_p()
    def check(success):
        need(success, "private DACL unavailable")
    check(adv.OpenProcessToken(wintypes.HANDLE(-1), 8, ctypes.byref(handle)))
    try:
        length = wintypes.DWORD()
        adv.GetTokenInformation(handle, 1, None, 0, ctypes.byref(length))
        user = ctypes.create_string_buffer(length.value)
        check(adv.GetTokenInformation(handle, 1, user, length, ctypes.byref(length)))
        sid = ctypes.cast(user, ctypes.POINTER(ctypes.c_void_p))[0]
        check(adv.ConvertSidToStringSidW(ctypes.c_void_p(sid), ctypes.byref(sid_text)))
        sddl = "D:P(A;OICI;FA;;;" + sid_text.value + ")(A;OICI;FA;;;SY)"
        check(adv.ConvertStringSecurityDescriptorToSecurityDescriptorW(
            sddl, 1, ctypes.byref(descriptor), None))
        present, defaulted, acl = wintypes.BOOL(), wintypes.BOOL(), ctypes.c_void_p()
        check(adv.GetSecurityDescriptorDacl(descriptor, ctypes.byref(present),
                                            ctypes.byref(acl), ctypes.byref(defaulted)))
        check(present and acl and adv.SetNamedSecurityInfoW(
            str(root), 1, 0x80000004, None, None, acl, None) == 0)
    finally:
        kernel.CloseHandle(handle)
        if descriptor:
            kernel.LocalFree(descriptor)
        if sid_text:
            kernel.LocalFree(sid_text)


def validate_root(root, token):
    temp = Path(tempfile.gettempdir()).resolve(strict=True)
    need(root.is_absolute() and root.parent == temp and re.fullmatch("[a-f0-9]{64}", token)
         and root.name == "pmb-secret-" + sha(token.encode()), "unverified recovery root")
    info = root.lstat()
    need(stat.S_ISDIR(info.st_mode) and not linked(info) and root.resolve() == root,
         "unverified recovery directory")
    return info


def remove_tree(path):
    # A junction may report S_ISDIR on Windows. Remove the junction itself before descent.
    pending = [(path, False)]
    while pending:
        child, visited = pending.pop()
        info = child.lstat()
        if stat.S_ISDIR(info.st_mode) and not linked(info):
            if visited:
                child.rmdir()
            else:
                pending.append((child, True))
                pending.extend((item, False) for item in child.iterdir())
        elif getattr(info, "st_file_attributes", 0) & 0x10:
            child.rmdir()
        else:
            if os.name == "nt" and not linked(info) and info.st_file_attributes & 1:
                need(info.st_nlink == 1, "read-only multiply linked file requires inspection")
                child.chmod(stat.S_IWRITE)
            child.unlink()


def cleanup_owned(root, owner_token):
    info = validate_root(root, owner_token)
    journal = root / "owner.json"
    meta = journal.lstat()
    need(stat.S_ISREG(meta.st_mode) and not linked(meta) and meta.st_size <= 4096,
         "unverified recovery journal")
    expected = dict(schema=1, root=str(root), token=owner_token, inode=info.st_ino,
                    device=info.st_dev, children=list(SUBDIRS))
    need(json.loads(journal.read_bytes()) == expected, "unverified recovery ownership")
    for child in root.iterdir():
        if child != journal:
            remove_tree(child)
    try:
        journal.unlink()
        root.rmdir()
    except BaseException:
        # rmdir requires an empty directory. Restore the journal if the final removal
        # failed after unlink, but only in the same verified directory.
        if os.path.lexists(root) and not os.path.lexists(journal):
            current = validate_root(root, owner_token)
            need((current.st_dev, current.st_ino) == (info.st_dev, info.st_ino), "recovery root changed")
            with journal.open("xb") as stream:
                stream.write(canonical(expected))
        raise


@contextmanager
def private_run(cleanup_result=None):
    token = secrets.token_hex(32)
    root = Path(tempfile.gettempdir()).resolve() / ("pmb-secret-" + sha(token.encode()))
    root.mkdir(mode=0o700)
    journal = root / "owner.json"
    try:
        info = validate_root(root, token)
        restrict(root)
        with journal.open("xb") as stream:
            stream.write(canonical(dict(schema=1, root=str(root), token=token,
                                        inode=info.st_ino, device=info.st_dev, children=list(SUBDIRS))))
    except BaseException:
        # Only the empty, freshly created root and our journal can exist at this point.
        validate_root(root, token)
        journal.unlink(missing_ok=True)
        root.rmdir()
        raise
    if cleanup_result is not None:
        cleanup_result["cleanup"] = "pending"
    try:
        for name in SUBDIRS:
            (root / name).mkdir(mode=0o700)
        yield root, token
    finally:
        if cleanup_result is not None:
            cleanup_result["cleanup"] = "failed"
        try:
            cleanup_owned(root, token)
            need(not os.path.lexists(root), "private root still present")
        except BaseException as error:
            print("Snapshot cleanup requires human attention:", root, file=sys.stderr)
            raise Invalid("cleanup failed") from error
        if cleanup_result is not None:
            cleanup_result["cleanup"] = "complete"


def receipt_path(repo, dest):
    need(repo.is_absolute() and dest.is_absolute() and dest.name not in ("", ".", ".."),
         "absolute repository and receipt paths required")
    final = dest.parent.resolve(strict=True) / dest.name
    need(not final.is_relative_to(repo.resolve()) and not os.path.lexists(final),
         "receipt must be new and outside repository")
    return final


def write_receipt(repo, dest, evidence):
    dest = receipt_path(repo, dest)
    with os.fdopen(os.open(dest, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as stream:
        stream.write(canonical(evidence) + b"\n")


def clean_env():
    # Preserve OS runtime necessities only. In particular no Git overrides, scanner config,
    # runtime injection options or shell startup files are forwarded.
    return {k: v for k, v in os.environ.items() if k.upper() in {
        "PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "TMPDIR", "HOME", "USERPROFILE",
        "LOCALAPPDATA", "PROGRAMFILES", "PROGRAMFILES(X86)", "SYSTEMDRIVE", "LANG", "LC_ALL"}}


def executable(name, forbidden):
    # shutil.which on older Windows may implicitly search the current directory.
    for item in os.get_exec_path():
        if not Path(item).is_absolute():
            continue
        candidate = (Path(item) / (name + ".exe" if os.name == "nt" else name)).resolve()
        if candidate.is_relative_to(forbidden) or not candidate.is_file() or not os.access(candidate, os.X_OK):
            continue
        if os.name == "nt" and candidate.with_suffix(".shim").exists():
            match = re.fullmatch(r'path = "([^"\r\n]+)"\s*',
                                 candidate.with_suffix(".shim").read_text(encoding="utf-8-sig"))
            need(match and Path(match[1]).is_absolute(), "unsupported tool launcher")
            candidate = Path(match[1]).resolve(strict=True)
            need(not candidate.is_relative_to(forbidden) and candidate.suffix.lower() == ".exe",
                 "untrusted executable")
        return candidate
    return None


def new_windows_job(kernel):
    # KILL_ON_JOB_CLOSE also handles abrupt interpreter termination. Native layout uses
    # pointer-sized fields for working sets, affinity and memory limits on both bitnesses.
    class Basic(ctypes.Structure):
        _fields_ = [("process_time", ctypes.c_int64), ("job_time", ctypes.c_int64),
                    ("flags", wintypes.DWORD), ("min_ws", ctypes.c_size_t), ("max_ws", ctypes.c_size_t),
                    ("active", wintypes.DWORD), ("affinity", ctypes.c_size_t),
                    ("priority", wintypes.DWORD), ("scheduling", wintypes.DWORD)]
    class Extended(ctypes.Structure):
        _fields_ = [("basic", Basic), ("io", ctypes.c_uint64 * 6), ("memory", ctypes.c_size_t * 4)]
    kernel.CreateJobObjectW.restype = wintypes.HANDLE
    handle = wintypes.HANDLE(kernel.CreateJobObjectW(None, None))
    need(handle, "owned job unavailable")
    limits = Extended()
    limits.basic.flags = 0x2000
    if not kernel.SetInformationJobObject(handle, 9, ctypes.byref(limits), ctypes.sizeof(limits)):
        kernel.CloseHandle(handle)
        raise Invalid("job termination guarantee unavailable")
    return handle


@contextmanager
def owned_process(args, cwd, env):
    win = os.name == "nt"
    job = None
    if win:
        kernel = ctypes.windll.kernel32
        job = new_windows_job(kernel)
    proc = None
    try:
        # Windows must assign the suspended process before it can spawn any children.
        proc = subprocess.Popen(args, cwd=cwd, env=env, stdin=subprocess.DEVNULL,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                start_new_session=not win, creationflags=0x08000004 if win else 0)
        if win:
            handle = wintypes.HANDLE(int(proc._handle))
            need(kernel.AssignProcessToJobObject(job, handle), "owned process assignment failed")
            need(ctypes.windll.ntdll.NtResumeProcess(handle) == 0, "owned process resume failed")
        yield proc
    finally:
        if win:
            if job:
                kernel.TerminateJobObject(job, 1)
                kernel.CloseHandle(job)
            if proc and proc.poll() is None:
                proc.kill()
        elif proc:
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        if proc:
            proc.wait()
            proc.stdout.close()
            proc.stderr.close()


def process(args, cwd, env, seconds, limit, report=None):
    deadline = time.monotonic() + seconds
    need(seconds > 0, "process deadline exhausted")
    overflow = threading.Event()
    results = [bytearray(), bytearray()]
    output_lock = threading.Lock()
    def drain(pipe, buf):
        while True:
            chunk = pipe.read1(65536)
            if not chunk:
                break
            with output_lock:
                if sum(map(len, results)) + len(chunk) > limit:
                    overflow.set()
                    break
                buf.extend(chunk)
    with owned_process(args, cwd, env) as proc:
        readers = [threading.Thread(target=drain, args=(pipe, buf), daemon=True)
                   for pipe, buf in zip((proc.stdout, proc.stderr), results)]
        for reader in readers:
            reader.start()
        while True:
            if overflow.is_set():
                raise Limited("process output limit")
            if report and report.exists() and report.lstat().st_size > LIMITS["report"]:
                raise Limited("report size limit")
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise Limited("process timeout")
            if proc.poll() is not None and not any(t.is_alive() for t in readers):
                break
            readers[0].join(min(remaining, 0.01))
            if not readers[0].is_alive():
                readers[1].join(min(remaining, 0.01))
        if overflow.is_set():
            raise Limited("process output limit")
        return proc.returncode, bytes(results[0])


class Git:
    def __init__(self, repo):
        self.repo = repo.resolve(strict=True)
        self.exe = executable("git", self.repo)
        need(self.exe, "Git unavailable")
        self.env = dict(clean_env(), GIT_NO_REPLACE_OBJECTS="1", GIT_NO_LAZY_FETCH="1",
                        GIT_TERMINAL_PROMPT="0", GIT_OPTIONAL_LOCKS="0")
        top = self.text("rev-parse", "--show-toplevel")
        need(Path(top).resolve() == self.repo, "repository root required")

    def run(self, *args, allowed=(0,), limit=None, cwd=None):
        options = ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=" + os.devnull,
                   "-c", "protocol.allow=never", "-c", "diff.relative=false",
                   "-c", "core.untrackedCache=false", "-c", "gc.auto=0"]
        try:
            rc, output = process([self.exe, *options, *args], self.repo if cwd is None else cwd, self.env,
                                 LIMITS["git_seconds"], LIMITS["inventory"] if limit is None else limit)
        except Limited as error:
            raise Invalid("Git capture exceeded limit") from error
        need(rc in allowed, "Git object or inventory unavailable")
        return output

    def text(self, *args, **kwargs):
        return self.run(*args, **kwargs).decode("utf-8", "strict").strip()


OID = re.compile(r"(?:[0-9a-f]{40}|[0-9a-f]{64})\Z")
DIFF = ["diff", "--no-ext-diff", "--no-textconv", "--no-renames", "--binary", "--full-index",
        "--ignore-submodules=none", "--submodule=short"]
PRODUCT = ["--", ":(top)**", ":(exclude,top)docs/review-log/invocations/*.json",
           ":(exclude,top)docs/review-log/*-code-review.md", ":(exclude,top)docs/review-log/*-change-review.md"]


class Manifest(dict):
    """repo is a locator for immutable objects, outside the serializable fingerprint."""

    def __init__(self, repo, operation):
        super().__init__(schema=1, operation=operation, entries=[], rows=[], limits=LIMITS.copy())
        self.repo = repo


def commit_oid(git, oid):
    need(isinstance(oid, str) and OID.fullmatch(oid) and
         git.text("rev-parse", "--verify", oid + "^{commit}") == oid, "full commit OID required")
    return oid


def parent_id(git):
    parent = git.text("rev-parse", "--verify", "-q", "HEAD", allowed=(0, 1))
    if parent:
        return commit_oid(git, parent)
    branch = git.text("symbolic-ref", "-q", "HEAD")
    need(branch.startswith("refs/heads/"), "invalid unborn branch")
    # --verify --quiet returns 1 specifically for an absent ref.
    git.run("show-ref", "--verify", "--quiet", branch, allowed=(1,))
    kind = git.text("rev-parse", "--show-object-format=storage")
    need(kind in ("sha1", "sha256"), "object format unavailable")
    return "0" * (40 if kind == "sha1" else 64)


def raw_inventory(git, rev, revisions):
    raw = git.run(*DIFF, "--no-patch", "--raw", "--no-abbrev", "-z", *revisions, *PRODUCT)
    fields = raw.split(b"\0")
    need(fields.pop() == b"" and len(fields) % 2 == 0, "invalid NUL inventory")
    entries = []
    for header, name in zip(fields[::2], fields[1::2]):
        match = re.fullmatch(rb":[0-7]{6} ([0-7]{6}) [a-f0-9]+ ([a-f0-9]+) ([ADMT])", header)
        need(match, "unsupported raw inventory")
        mode, blob, status = (field.decode("ascii") for field in match.groups())
        outcome = ("no-post-image" if status == "D" else
                   "scheduled" if mode in ("100644", "100755") else "unsupported")
        entries.append(dict(revision=rev, path=name.decode("utf-8", "strict"), mode=mode,
                            blob=None if status == "D" else blob, sha256=None, size=None,
                            materialized=None, outcome=outcome))
    return entries


def index_identity(path):
    info = path.lstat()
    need(stat.S_ISREG(info.st_mode) and not linked(info) and info.st_size <= LIMITS["inventory"],
         "unsupported index file")
    with path.open("rb") as stream:
        data = stream.read(LIMITS["inventory"] + 1)
    need(len(data) == info.st_size, "index changed during capture")
    return (info.st_dev, info.st_ino, info.st_mtime_ns, sha(data)), data


def verify_index(git, path, identity, parent):
    need(index_identity(path)[0] == identity and parent_id(git) == parent, "index or parent changed")


def capture_index(repo, owned_root=None):
    if owned_root is None:
        with private_run() as (root, _):
            return capture_index(repo, root)
    git = Git(repo)
    m = Manifest(repo, "index")
    parent = parent_id(git)
    source = Path(git.text("rev-parse", "--path-format=absolute", "--git-path", "index"))
    identity, data = index_identity(source)
    copied = owned_root / "results" / "captured-index"
    copied.write_bytes(data)
    git.env["GIT_INDEX_FILE"] = str(copied)
    need(not git.text("rev-parse", "--shared-index-path"), "split index unsupported")
    stage = git.run("ls-files", "--sparse", "--stage", "-z")
    need(not any(row.startswith(b"040000 ") for row in stage.split(b"\0")), "sparse index unsupported")
    need(git.text("config", "--bool", "--get", "index.sparse", allowed=(0, 1)) != "true",
         "sparse index unsupported")
    # write-tree may create a tree object. Direct those writes into the private run.
    objects = Path(git.text("rev-parse", "--path-format=absolute", "--git-path", "objects"))
    objdir = owned_root / "results" / "objects"
    objdir.mkdir()
    git.env.update(GIT_OBJECT_DIRECTORY=str(objdir), GIT_ALTERNATE_OBJECT_DIRECTORIES=str(objects))
    # A racy index entry can make write-tree recheck files relative to its process cwd.
    gitdir = git.run("rev-parse", "--absolute-git-dir").removesuffix(b"\n").decode("utf-8", "strict")
    empty = owned_root / "results" / "empty-worktree"
    empty.mkdir()
    tree = git.text("--git-dir=" + gitdir, "--work-tree=" + str(empty), "write-tree", cwd=empty)
    # stdin is empty. mktree writes only to the private object directory.
    revisions = ["--cached", parent if parent.strip("0") else git.text("mktree")]
    product = git.run(*DIFF, *revisions, *PRODUCT)
    need(product, "empty staged product")
    m.update(parent=parent, index_tree=tree, fingerprint="v2 commit " + parent + " " + sha(product),
             entries=raw_inventory(git, tree, revisions))
    verify_index(git, source, identity, parent)
    validate_paths(m, os.name)
    return m


def capture_branch(repo, base, head):
    git = Git(repo)
    need(git.text("rev-parse", "--is-shallow-repository") == "false", "full history required")
    base, head = commit_oid(git, base), commit_oid(git, head)
    need(git.text("merge-base", "--all", base, head) == base, "unique ancestor base required")
    m = Manifest(repo, "branch")
    product = git.run(*DIFF, base, head, *PRODUCT)
    need(product, "empty branch product")
    stream = bytearray()
    ledger_bytes = 0
    for commit in git.text("rev-list", "--reverse", base + ".." + head).split():
        parents = git.text("rev-list", "--parents", "-n", "1", commit).split()
        need(len(parents) == 2, "nonlinear or incomplete history")
        parent = parents[1]
        patch_bytes = git.run(*DIFF, parent, commit, *PRODUCT)
        if patch_bytes:
            digest = sha(patch_bytes)
            stream.extend(f"{commit} {parent} {digest}\n".encode("ascii"))
            m["rows"].append(dict(commit=commit, parent=parent, patch=digest))
            entries = raw_inventory(git, commit, [parent, commit])
            ledger_bytes += len(canonical(entries))
            need(ledger_bytes + len(stream) <= LIMITS["inventory"], "inventory exceeds limit")
            m["entries"].extend(entries)
    need(stream, "empty branch history")
    m.update(base=base, head=head, fingerprint=f"v2 push {base} {sha(product)} {sha(stream)}")
    validate_paths(m, os.name)
    return m


def validate_paths(manifest, platform):
    spellings = {}
    for entry in manifest["entries"]:
        parts = entry["path"].split("/")
        for i, component in enumerate(parts):
            name = unicodedata.normalize("NFC", component).casefold()
            device = name.partition(".")[0].rstrip(" ")
            need(component and name not in (".", "..", ".git", "git~1") and
                 not component.endswith((" ", ".")) and
                 not any(ch in '<>:"\\|?*' or unicodedata.category(ch) in ("Cc", "Cs") for ch in component) and
                 not re.fullmatch(r"con|prn|aux|nul|conin\$|conout\$|(?:com|lpt)[0-9¹²³]", device),
                 "unsafe or unrepresentable Git path")
            prefix = "/".join(parts[:i+1])
            folded = unicodedata.normalize("NFC", prefix).casefold()
            need(spellings.setdefault(folded, prefix) == prefix, "ambiguous destination spelling")


def root_ignore(path):
    return unicodedata.normalize("NFC", path).casefold() == ".gitleaksignore"


def materialize(manifest, owned_root):
    validate_paths(manifest, os.name)
    ledger = [entry.copy() for entry in manifest["entries"]]
    git = Git(manifest.repo)
    payload = owned_root / "payload"
    need(not linked(payload.lstat()) and payload.resolve() == payload, "untrusted payload root")
    groups, versions = [], {}
    used = 0
    for entry in ledger:
        if entry["outcome"] != "scheduled":
            continue
        key = entry["path"], entry["mode"], entry["blob"]
        if key in versions:
            entry.update(versions[key])
            continue
        path, _, blob = key
        size = int(git.text("cat-file", "-s", blob))
        need(size >= 0, "invalid blob length")
        entry["size"] = size
        def conflicts(existing):
            if root_ignore(path) or any(root_ignore(p) for p in existing):
                return True
            return any(path == p or path.startswith(p + "/") or p.startswith(path + "/") for p in existing)
        group = next((i for i, paths in enumerate(groups) if not conflicts(paths)), len(groups))
        if (len(versions) >= LIMITS["inputs"] or size > LIMITS["blob"] or
                used + size > LIMITS["payload"] or group >= LIMITS["roots"]):
            entry["outcome"] = "unattempted"
        else:
            if group == len(groups):
                groups.append(set())
                (payload / str(group)).mkdir(mode=0o700)
            root = payload / str(group)
            dest = root / path
            need(dest.resolve().is_relative_to(root) and not linked(root.lstat()), "payload escape")
            parent = root
            for part in path.split("/")[:-1]:
                parent = parent / part
                parent.mkdir(mode=0o700, exist_ok=True)
                need(not linked(parent.lstat()) and parent.is_dir(), "unsafe payload component")
            data = git.run("cat-file", "blob", blob, limit=LIMITS["blob"])
            digest = hashlib.new("sha1" if len(blob) == 40 else "sha256",
                                 f"blob {size}\0".encode() + data).hexdigest()
            need(len(data) == size and digest == blob, "Git object bytes changed")
            with os.fdopen(os.open(dest, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as stream:
                stream.write(data)
            groups[group].add(path)
            used += size
            entry.update(sha256=sha(data), materialized=f"{group}/{path}")
        versions[key] = {k: entry[k] for k in ("size", "sha256", "materialized", "outcome")}
    return dict(root=owned_root, manifest=manifest, groups=groups, ledger=ledger)


FINDINGS_EXIT = 10
REQUIRED_FLAGS = ("--config", "--gitleaks-ignore-path", "--ignore-gitleaks-allow",
                  "--redact", "--report-format", "--report-path", "--exit-code")
CAVEAT = ("A completed attempt records submission of the listed paths. Embedded rule exclusions, "
          "binary handling and scanner heuristics limit byte coverage. Human and Opposition review remain required.")


def payload_hashes(plan):
    root = plan["root"] / "payload"
    need(root.resolve(strict=True) == root and not linked(root.lstat()), "payload identity changed")
    expected = {e["materialized"]: e for e in plan["ledger"] if e["materialized"]}
    directories = {"/".join(key.split("/")[:i]) for key in expected for i in range(1, key.count("/")+1)}
    actual = {}
    def walk(folder):
        for child in folder.iterdir():
            key = child.relative_to(root).as_posix()
            info = child.lstat()
            need(not linked(info), "payload link detected")
            if stat.S_ISDIR(info.st_mode):
                need(key in directories, "unexpected payload directory")
                walk(child)
            else:
                need(key in expected and stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and
                     info.st_size == expected[key]["size"], "payload inventory changed")
                actual[key] = file_hash(child)
    walk(root)
    need(actual == {k: e["sha256"] for k, e in expected.items()}, "payload hash mismatch")
    return actual


def checked_file(path, max_size=None):
    meta = path.lstat()
    need(not linked(meta) and stat.S_ISREG(meta.st_mode) and
         (max_size is None or meta.st_size <= max_size), "invalid trusted file")
    return file_hash(path)


def scan_hashes(plan, tool, policy):
    return dict(payload=payload_hashes(plan), executable=checked_file(tool) if tool else None,
                policy=checked_file(policy, MIB), ignore=checked_file(policy.parent / ".gitleaksignore", 0))


def unique_fields(pairs):
    result = {}
    for key, value in pairs:
        need(key not in result, "duplicate report key")
        result[key] = value
    return result


def findings(report, root, paths, code):
    info = report.lstat()
    need(not linked(info) and stat.S_ISREG(info.st_mode) and info.st_size <= LIMITS["report"],
         "invalid report size or type")
    rows = json.loads(report.read_bytes(), object_pairs_hook=unique_fields)
    need(isinstance(rows, list) and bool(rows) == (code == FINDINGS_EXIT), "report and exit disagree")
    seen, retained = set(), []
    for row in rows:
        need(isinstance(row, dict), "invalid report entry")
        path, rule, line, end = (row.get(k) for k in ("File", "RuleID", "StartLine", "EndLine"))
        need(isinstance(path, str) and isinstance(rule, str) and 0 < len(rule) <= 256 and
             type(line) is int and type(end) is int and (line == end == 0 or 1 <= line <= end),
             "invalid finding fields")
        path = path.replace("\\", "/") if os.name == "nt" else path
        if Path(path).is_absolute():
            prefix = root.as_posix() + "/"
            need(path.startswith(prefix), "foreign finding root")
            path = path[len(prefix):]
        need(path in paths, "unknown finding path")
        column = row.get("StartColumn", 0)
        need(type(column) is int and column >= 0, "invalid finding column")
        identity = path, rule, line, end, column
        need(identity not in seen, "duplicate finding")
        seen.add(identity)
        # Scanner-controlled arbitrary strings cannot be echoed as rule IDs or diagnostics.
        retained.append(dict(path=path, rule_sha256=sha(rule.encode()), start=line, end=end,
                             column=column, root=root.name))
    return retained


def scan_source(root, paths):
    # The pinned scanner also looks in its source directory for an ignore file.
    if len(paths) == 1 and root_ignore(next(iter(paths))):
        return root / next(iter(paths))
    try:
        info = (root / ".gitleaksignore").lstat()
    except FileNotFoundError:
        return root
    need(stat.S_ISDIR(info.st_mode) and not linked(info), "untrusted scanner source policy")
    return root


def run_scans(plan, tool, policy):
    ledger = plan["ledger"]
    manifest = dict(plan["manifest"], entries=[entry.copy() for entry in ledger])
    receipt = dict(schema=1, manifest=manifest, manifest_sha256=sha(canonical(manifest)),
                   fingerprint=manifest.get("fingerprint"), status="unavailable", attempts=[],
                   scanner=dict(path=str(tool) if tool else None, version=None),
                   flags=list(REQUIRED_FLAGS), findings=[], ledger=ledger, limitations=[CAVEAT],
                   before=None, after=None)
    deadline = time.monotonic() + LIMITS["scan_total"]
    env = clean_env()
    env["PATH"] = str(tool.parent) if tool else ""
    def execute(args, report=None):
        seconds = min(LIMITS["scan_seconds"], deadline - time.monotonic())
        if seconds <= 0:
            raise Limited("overall scanner deadline")
        return process([str(tool), *args], policy.parent, env, seconds, LIMITS["output"], report)

    try:
        receipt["before"] = scan_hashes(plan, tool, policy)
        if tool is None:
            receipt["limitations"].append("gitleaks unavailable")
        else:
            rc, version = execute(["version"])
            need(rc == 0 and version.strip() == b"8.30.1", "untested scanner version")
            receipt["scanner"]["version"] = "8.30.1"
            rc, help_text = execute(["dir", "--help"])
            need(rc == 0 and all(re.search(rb"(?<![\w-])" + flag.encode() + rb"(?![\w-])", help_text)
                                 for flag in REQUIRED_FLAGS), "required scanner capabilities unavailable")
            receipt["status"] = "completed"
            for number, paths in enumerate(plan["groups"]):
                if time.monotonic() >= deadline:
                    receipt["limitations"].append("overall scanner deadline")
                    break
                root = plan["root"] / "payload" / str(number)
                report = plan["root"] / "results" / f"report-{number}.json"
                entries = [e for e in ledger if e["materialized"] and
                           e["materialized"].startswith(str(number) + "/")]
                attempt = dict(id=number, paths=sorted(paths), exit=None, report="failed")
                receipt["attempts"].append(attempt)
                args = ["dir", "--config", str(policy), "--gitleaks-ignore-path",
                        str(policy.parent / ".gitleaksignore"), "--ignore-gitleaks-allow",
                        "--redact=100", "--exit-code", str(FINDINGS_EXIT), "--report-format", "json",
                        "--report-path", str(report)]
                start = time.monotonic()
                try:
                    rc, _ = execute([*args, str(scan_source(root, paths))], report)
                    attempt["exit"] = rc
                    need(rc in (0, FINDINGS_EXIT), "unexpected scanner exit")
                    receipt["findings"].extend(findings(report, root, paths, rc))
                    attempt["report"] = "valid"
                except (OSError, ValueError, Limited, RecursionError):
                    receipt["limitations"].append("scanner failure or invalid report")
                attempt["duration_ms"] = round((time.monotonic()-start)*1000)
                for entry in entries:
                    entry["outcome"] = "attempted" if attempt["report"] == "valid" else "failed"
    except (OSError, ValueError, Limited):
        receipt["limitations"].append("scanner capability or input verification failed")
    try:
        receipt["after"] = scan_hashes(plan, tool, policy)
        need(receipt["before"] and receipt["before"] == receipt["after"], "frozen hashes changed")
    except (OSError, ValueError):
        receipt["status"] = "invalid"
        receipt["limitations"].append("frozen inputs changed or became unverifiable")
    for entry in ledger:
        if entry["outcome"] == "scheduled":
            entry["outcome"] = "unattempted"
    if receipt["status"] == "completed" and any(
            e["outcome"] not in ("attempted", "no-post-image") for e in ledger):
        receipt["status"] = "partial"
    return receipt


def trusted_sources(repo, oid):
    git = Git(repo)
    commit_oid(git, oid)
    folder = Path(__file__).resolve().parent
    need(not folder.is_relative_to(repo), "use an independently sourced helper outside the reviewed tree")
    hashes = {}
    for name in HELPERS:
        obj = git.run("ls-tree", "-z", oid, "--", "scripts/" + name)
        need(re.fullmatch(rb"100(?:644|755) blob [0-9a-f]+\tscripts/" + re.escape(name.encode()) + rb"\0", obj),
             "trusted base lacks helper or policy")
        data = git.run("cat-file", "blob", oid + ":scripts/" + name)
        hashes[name] = sha(data)
        need(checked_file(folder / name, LIMITS["inventory"]) == hashes[name], "trusted helper hash mismatch")
    return hashes


def execute_review(args):
    repo, dest = Path(args.repo), Path(args.receipt)
    dest = receipt_path(repo, dest)
    repo = repo.resolve(strict=True)
    receipt = dict(schema=1, status="invalid", limitations=[],
                   trusted_base=args.trusted_base if OID.fullmatch(args.trusted_base) else None,
                   cleanup="not-started")
    try:
        need((args.operation == "branch" and args.base and args.head) or
             (args.operation == "index" and args.base is None and args.head is None),
             "base and head required only for branch")
        need(not Path(tempfile.gettempdir()).resolve().is_relative_to(repo),
             "private temp directory must be outside repository")
        hashes = trusted_sources(repo, args.trusted_base)
        receipt["helpers"] = hashes
        with private_run(receipt) as (root, _):
            print("Private snapshot recovery location:", root, file=sys.stderr)
            need(not dest.is_relative_to(root), "receipt location in private run")
            m = (capture_branch(repo, args.base, args.head) if args.operation == "branch"
                 else capture_index(repo, root))
            plan = materialize(m, root)
            config = root / "scanner-policy" / POLICY
            config.write_bytes(Path(__file__).with_name(POLICY).read_bytes())
            need(checked_file(config) == hashes[POLICY], "policy provenance changed")
            (config.parent / ".gitleaksignore").write_bytes(b"")
            receipt.update(run_scans(plan, executable("gitleaks", repo), config))
            need(all(checked_file(Path(__file__).with_name(name)) == identity
                     for name, identity in hashes.items()), "helper changed during scan")
    except (Invalid, OSError, UnicodeError, ValueError, KeyboardInterrupt, RecursionError) as error:
        receipt["status"] = "invalid"
        receipt["limitations"].append(str(error) if isinstance(error, Invalid) else "capture failed or interrupted")
    write_receipt(repo, dest, receipt)
    return {"completed": 0, "partial": 2, "unavailable": 2, "invalid": 3}[receipt["status"]]


class Parser(argparse.ArgumentParser):
    def error(self, message):
        self.exit(3, "Invalid snapshot arguments\n")


def main():
    parser = Parser(allow_abbrev=False)
    parser.add_argument("operation", choices=["index", "branch"])
    for name in ("repo", "receipt", "trusted-base"):
        parser.add_argument("--" + name, required=True)
    parser.add_argument("--base")
    parser.add_argument("--head")
    args = parser.parse_args()
    def interrupt(*_):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, interrupt)
    try:
        return execute_review(args)
    except (ValueError, OSError, KeyboardInterrupt):
        print("Snapshot receipt destination unavailable or input invalid", file=sys.stderr)
        return 3


if __name__ == "__main__":
    sys.exit(main())
