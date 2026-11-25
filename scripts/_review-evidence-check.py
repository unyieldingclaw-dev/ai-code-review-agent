#!/usr/bin/env python3
"""Validate review evidence from Git index or commit blobs, never the worktree."""
import hashlib
import datetime
import json
import os
import re
import subprocess
import sys
import uuid

INVOCATION = re.compile(r"docs/review-log/invocations/[0-9]{13}-[A-Za-z0-9_-]+\.json\Z")
COMPLETION = re.compile(r"docs/review-log/([0-9]{4}-[0-9]{2}-[0-9]{2})-[0-9a-f]{7}-(code|change)-review\.md\Z")
FINGERPRINT = re.compile(rf"v2 (?:commit (?:[0-9a-f]{{40}}|[0-9a-f]{{64}}) [0-9a-f]{{64}}|push (?:[0-9a-f]{{40}}|[0-9a-f]{{64}}) [0-9a-f]{{64}} [0-9a-f]{{64}})\Z")
REPO_ROOT = None


def git(*args):
    return subprocess.run(["git", *args], cwd=REPO_ROOT, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE).stdout


def unique_pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON key")
        result[key] = value
    return result


def validate(path, blob):
    text = blob.decode("utf-8", "strict")
    if INVOCATION.fullmatch(path):
        filename_ms = int(path.rsplit("/", 1)[1].split("-", 1)[0])
        if filename_ms <= 0:
            raise ValueError("invocation timestamp in filename")
        data = json.loads(text, object_pairs_hook=unique_pairs)
        if not isinstance(data, dict) or set(data) not in ({"type", "review", "started_at", "scope"}, {"type", "review", "started_at", "scope", "fingerprint"}):
            raise ValueError("invocation fields")
        if data["type"] != "invocation" or data["review"] not in ("code-review", "change-review"):
            raise ValueError("invocation type")
        if not isinstance(data["started_at"], str) or not data["started_at"] or not isinstance(data["scope"], str) or not data["scope"].strip():
            raise ValueError("invocation values")
        started_at = datetime.datetime.fromisoformat(data["started_at"].replace("Z", "+00:00"))
        if started_at.tzinfo is None or started_at.utcoffset() is None:
            raise ValueError("invocation timestamp must include a timezone")
        if "fingerprint" in data:
            validate_fingerprint(data["fingerprint"], data["review"])
        return None
    match = COMPLETION.fullmatch(path)
    if not match:
        raise ValueError("evidence path")
    datetime.date.fromisoformat(match.group(1))
    lines = text.splitlines()
    if not lines or lines[0] != "---":
        raise ValueError("frontmatter")
    try:
        end = lines.index("---", 1)
    except ValueError as exc:
        raise ValueError("frontmatter closing delimiter") from exc
    if not "\n".join(lines[end + 1:]).strip():
        raise ValueError("incomplete record")
    fields = {}
    for line in lines[1:end]:
        key, sep, value = line.partition(": ")
        if not sep or not value.strip() or key in fields:
            raise ValueError("frontmatter field")
        fields[key] = value.strip()
    if set(fields) != {"type", "fingerprint", "verdict"}:
        raise ValueError("completion fields")
    if fields["type"] != match.group(2) + "-review" or fields["verdict"] not in ("Approve", "Request Changes", "Needs Discussion"):
        raise ValueError("completion type or verdict")
    if not FINGERPRINT.fullmatch(fields["fingerprint"]) or fields["fingerprint"].split()[1] != match.group(2).replace("code", "commit").replace("change", "push"):
        raise ValueError("completion fingerprint")

    body = "\n".join(lines[end + 1:]).strip().splitlines()
    if len(body) < 3 or body[0] != "```json" or body[-1] != "```":
        raise ValueError("completion requires one JSON body")
    data = json.loads("\n".join(body[1:-1]), object_pairs_hook=unique_pairs)
    if not isinstance(data, dict) or set(data) != {"review_id", "reviewer", "completed_at", "covered", "findings", "rationale", "invocation", "scope"}:
        raise ValueError("completion payload fields")
    for key in ("review_id", "reviewer", "rationale", "scope"):
        if not isinstance(data[key], str) or not data[key].strip():
            raise ValueError("completion identity or rationale")
    if not isinstance(data["invocation"], str) or not INVOCATION.fullmatch(data["invocation"]):
        raise ValueError("completion invocation identity")
    if not isinstance(data["completed_at"], str):
        raise ValueError("completion timestamp")
    completed = datetime.datetime.fromisoformat(data["completed_at"].replace("Z", "+00:00"))
    if completed.tzinfo is None or completed.utcoffset() is None or completed.date().isoformat() != match.group(1):
        raise ValueError("completion date or timezone")
    if not isinstance(data["covered"], list) or not isinstance(data["findings"], list):
        raise ValueError("completion rows must be arrays")
    seen = set()
    for row in data["covered"]:
        if not isinstance(row, dict) or set(row) != {"commit", "parent", "patch"}:
            raise ValueError("covered row fields")
        if not all(isinstance(v, str) for v in row.values()):
            raise ValueError("covered row values")
        if not re.fullmatch(r"[0-9a-f]{40}|[0-9a-f]{64}", row["commit"]) or not re.fullmatch(r"[0-9a-f]{40}|[0-9a-f]{64}", row["parent"]) or not re.fullmatch(r"[0-9a-f]{64}", row["patch"]):
            raise ValueError("covered row hashes")
        if row["commit"] in seen:
            raise ValueError("duplicate covered commit")
        seen.add(row["commit"])
    if fields["type"] == "code-review" and data["covered"]:
        raise ValueError("code review binds proposed patch, not future commit IDs")
    ids = set()
    for row in data["findings"]:
        if not isinstance(row, dict) or set(row) != {"id", "severity", "location", "evidence", "recommendation", "blocking"}:
            raise ValueError("finding row fields")
        if not all(isinstance(row[k], str) and row[k].strip() for k in ("id", "severity", "location", "evidence", "recommendation")) or type(row["blocking"]) is not bool:
            raise ValueError("finding row values")
        if row["id"] in ids:
            raise ValueError("duplicate finding")
        ids.add(row["id"])
    if fields["verdict"] == "Approve" and any(row["blocking"] for row in data["findings"]):
        raise ValueError("blocker defeats Approve")
    return dict(fields, **data)


def validate_fingerprint(fingerprint, review):
    expected = "commit" if review == "code-review" else "push"
    if not isinstance(fingerprint, str) or not FINGERPRINT.fullmatch(fingerprint) or fingerprint.split()[1] != expected:
        raise ValueError("invocation fingerprint or review type")


def linked_invocation(record, source):
    path = record["invocation"]
    if source == "index":
        mode = git("ls-files", "--stage", "--", path).split(b" ", 1)[0]
        blob = git("show", ":" + path)
    else:
        mode = git("ls-tree", source, "--", path).split(b" ", 1)[0]
        blob = git("show", source + ":" + path)
    if mode not in (b"100644", b"100755"):
        raise ValueError("linked invocation must be a regular file")
    validate(path, blob)
    invocation = json.loads(blob.decode("utf-8"), object_pairs_hook=unique_pairs)
    if (invocation["review"] != record["type"] or invocation["scope"] != record["scope"]
            or invocation.get("fingerprint") != record["fingerprint"]):
        raise ValueError("invocation type, scope or fingerprint mismatch")
    started = datetime.datetime.fromisoformat(invocation["started_at"].replace("Z", "+00:00"))
    completed = datetime.datetime.fromisoformat(record["completed_at"].replace("Z", "+00:00"))
    if started > completed:
        raise ValueError("completion precedes invocation start")


def check_links(records, source):
    if not records:
        return
    names = (git("ls-files", "-z") if source == "index" else git("ls-tree", "-rz", "--name-only", source))
    linked = set()
    identities = set()
    for raw_path in names.split(b"\0"):
        path = raw_path.decode("utf-8", "strict")
        if not COMPLETION.fullmatch(path):
            continue
        blob = git("show", (":" if source == "index" else source + ":") + path)
        record = validate(path, blob)
        linked_invocation(record, source)
        if record["invocation"] in linked or record["review_id"] in identities:
            raise ValueError("duplicate invocation linkage or review identity")
        linked.add(record["invocation"])
        identities.add(record["review_id"])


def canonical_patch(*args):
    return git("-c", "diff.relative=false", "diff", "--no-ext-diff", "--no-textconv", "--no-renames", "--binary", "--full-index", "--ignore-submodules=none", "--submodule=short", *args, "--", ":(top)**", ":(exclude,top)docs/review-log/invocations/*.json", ":(exclude,top)docs/review-log/*-code-review.md", ":(exclude,top)docs/review-log/*-change-review.md")


def changed_records(source, allow_mixed=False):
    if source == "index":
        names = git("diff", "--cached", "--name-only", "-z", "--no-renames", "--")
        blob_spec = lambda path: ":" + path
    else:
        parents = git("rev-list", "--parents", "-n", "1", source).decode().split()
        if len(parents) != 2:
            raise ValueError("commit must have exactly one parent")
        names = git("diff", "--name-only", "-z", "--no-renames", parents[1], source, "--")
        blob_spec = lambda path: source + ":" + path
    paths = [p.decode("utf-8", "strict") for p in names.split(b"\0") if p]
    if not paths:
        raise ValueError("no changed paths")
    records = []
    count = 0
    for path in paths:
        if path.startswith("docs/review-log/") and path != "docs/review-log/README.md":
            if not (INVOCATION.fullmatch(path) or COMPLETION.fullmatch(path)):
                raise ValueError("invalid evidence path")
            # Records are append-only: editing one can silently replace a prior verdict.
            old = "HEAD:" + path if source == "index" else parents[1] + ":" + path
            exists = subprocess.run(["git", "cat-file", "-e", old], cwd=REPO_ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if exists.returncode == 0:
                raise ValueError("evidence records are append-only")
            if git("ls-files", "--stage", "--", path).split(b" ", 1)[0] not in (b"100644", b"100755") and source == "index":
                raise ValueError("evidence must be a regular file")
            if source != "index" and git("ls-tree", source, "--", path).split(b" ", 1)[0] not in (b"100644", b"100755"):
                raise ValueError("evidence must be a regular file")
            data = validate(path, git("show", blob_spec(path)))
            if data is not None:
                records.append(data)
            count += 1
        elif not allow_mixed:
            raise ValueError("mixed product and evidence changes")
    if not count and not allow_mixed:
        raise ValueError("no evidence")
    check_links(records, source)
    return records


def empty_tree():
    # The empty tree id depends on the object format: a SHA-1 id is silently ignored as attr.tree
    # in a SHA-256 repository, which would let PR .gitattributes merge drivers back in.
    return subprocess.run(["git", "hash-object", "-t", "tree", "--stdin"], cwd=REPO_ROOT, check=True, input=b"", stdout=subprocess.PIPE, stderr=subprocess.PIPE).stdout.decode().strip()


def is_ancestor(ancestor, descendant):
    result = subprocess.run(["git", "merge-base", "--is-ancestor", ancestor, descendant], cwd=REPO_ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if result.returncode not in (0, 1):
        raise ValueError("ancestry check failed")
    return result.returncode == 0


def merge_tree_supported():
    # attr.tree arrived in Git 2.40; older Git ignores the setting, which would let the PR's own
    # .gitattributes merge drivers steer the recompute, so refuse instead of degrading.
    version = re.match(rb"git version (\d+)\.(\d+)", git("version"))
    return version is not None and (int(version.group(1)), int(version.group(2))) >= (2, 40)


def is_sync_merge(commit, trusted):
    """A merge that only brings trusted base content into the PR side, provably unedited."""
    parents = git("rev-list", "--parents", "-n", "1", commit).decode().split()[1:]
    if len(parents) != 2:
        return False
    ours, theirs = parents
    if not is_ancestor(theirs, trusted) or is_ancestor(ours, trusted):
        return False
    if len(git("merge-base", "--all", ours, theirs).split()) != 1 or not merge_tree_supported():
        return False
    # Recompute the merge mechanically: any conflict resolution or hand edit changes the tree.
    # Renames and attribute-selected merge drivers are pinned off so PR content cannot steer it.
    result = subprocess.run(["git", "-c", "merge.renames=false", "-c", "attr.tree=" + empty_tree(), "merge-tree", "--write-tree", "--no-messages", ours, theirs], cwd=REPO_ROOT, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    if result.returncode != 0 or not result.stdout.split():
        return False
    return result.stdout.split()[0].decode() == git("rev-parse", commit + "^{tree}").decode().strip()


def branch_commits(base, head):
    """First-parent order of base..head, which committer dates cannot reorder."""
    commits = git("rev-list", "--first-parent", "--reverse", base + ".." + head).decode().split()
    if set(commits) != set(git("rev-list", base + ".." + head).decode().split()):
        raise ValueError("history outside the first-parent chain")
    return commits


def content_history(base, head):
    if git("rev-parse", "--is-shallow-repository").strip() != b"false":
        raise ValueError("full history required")
    rows = []
    for commit in branch_commits(base, head):
        parents = git("rev-list", "--parents", "-n", "1", commit).decode().split()
        if len(parents) == 3 and is_sync_merge(commit, base):
            continue
        if len(parents) != 2:
            raise ValueError("unsupported merge or root commit")
        changed_records(commit, allow_mixed=True)
        patch = canonical_patch(parents[1], commit)
        if patch:
            rows.append({"commit": commit, "parent": parents[1], "patch": hashlib.sha256(patch).hexdigest()})
    return rows


def branch_fingerprint(base, head, rows):
    patch = canonical_patch(base, head)
    if not patch or not rows:
        raise ValueError("empty product history or final diff")
    stream = "".join(row["commit"] + " " + row["parent"] + " " + row["patch"] + "\n" for row in rows).encode("ascii")
    return "v2 push " + base + " " + hashlib.sha256(patch).hexdigest() + " " + hashlib.sha256(stream).hexdigest()


def unique_base(base_tip, head):
    bases = git("merge-base", "--all", base_tip, head).decode().split()
    if len(bases) != 1:
        raise ValueError("missing or ambiguous merge base")
    return bases[0]


def contain(base_ref, head_ref):
    if git("rev-parse", "--is-shallow-repository").strip() != b"false":
        raise ValueError("full history required")
    base_tip = git("rev-parse", "--verify", base_ref + "^{commit}").decode().strip()
    head = git("rev-parse", "--verify", head_ref + "^{commit}").decode().strip()
    base = unique_base(base_tip, head)
    rows = content_history(base, head)
    commits = branch_commits(base, head)
    # Trailing sync merges add only verified base content, so the final review stays the one
    # taken before them, at that commit's own merge base.
    final_head = head
    while final_head != base and len(git("rev-list", "--parents", "-n", "1", final_head).split()) == 3:
        final_head = git("rev-parse", final_head + "^1").decode().strip()
    final_rows = [row for row in rows if is_ancestor(row["commit"], final_head)]
    expected = branch_fingerprint(unique_base(base_tip, final_head), final_head, final_rows)
    row_by_commit = {row["commit"]: row for row in rows}
    positions = {commit: i for i, commit in enumerate(commits)}
    covered = set()
    ids = set()
    invocations = set()
    blocked = set()
    approved = set()
    final = False
    count = 0
    for commit in commits:
        if len(git("rev-list", "--parents", "-n", "1", commit).split()) == 3:
            continue
        for record in changed_records(commit, allow_mixed=True):
            if record["review_id"] in ids:
                raise ValueError("duplicate or conflicting review identity")
            ids.add(record["review_id"])
            if record["invocation"] in invocations:
                raise ValueError("duplicate invocation linkage")
            invocations.add(record["invocation"])
            if record["verdict"] != "Approve":
                blocked.add(record["fingerprint"])
                continue
            if record["fingerprint"] in blocked:
                raise ValueError("unchanged fingerprint retains an unresolved non-Approve verdict")
            approved.add(record["fingerprint"])
            count += 1
            if record["type"] == "code-review":
                row = row_by_commit.get(commit)
                if row is None or record["fingerprint"] != "v2 commit " + row["parent"] + " " + row["patch"]:
                    raise ValueError("code review does not match containing content commit")
                covered.add(commit)
            else:
                prior_rows = [row for row in rows if positions[row["commit"]] < positions[commit]]
                if record["covered"] != prior_rows:
                    raise ValueError("whole-branch covered content differs from actual ordered history")
                if record["fingerprint"] != branch_fingerprint(unique_base(base_tip, commit), commit, prior_rows):
                    raise ValueError("change review content fingerprint mismatch")
                covered.update(row["commit"] for row in prior_rows)
                if record["fingerprint"] == expected:
                    final = True
    if approved & blocked:
        raise ValueError("conflicting verdicts for the same fingerprint")
    if count <= 0 or covered != set(row_by_commit) or not final or expected in blocked:
        raise ValueError("missing completion, uncovered product commit, or final change review")
    return count


def write_record(path, blob):
    validate(path, blob)
    target = os.path.join(REPO_ROOT, *path.split("/"))
    os.makedirs(os.path.dirname(target), exist_ok=True)
    # Exclusive create preserves peer records and makes collisions a visible failure.
    with open(target, "xb") as handle:
        handle.write(blob)
    print(path)


def start_record(review, scope, fingerprint):
    if review not in ("code-review", "change-review") or not scope.strip():
        raise ValueError("invocation review or scope")
    validate_fingerprint(fingerprint, review)
    now = datetime.datetime.now(datetime.timezone.utc)
    path = f"docs/review-log/invocations/{int(now.timestamp() * 1000):013d}-{uuid.uuid4().hex}.json"
    data = {"type": "invocation", "review": review, "started_at": now.isoformat(), "scope": scope, "fingerprint": fingerprint}
    write_record(path, (json.dumps(data, indent=2) + "\n").encode("utf-8"))


def complete_record(fingerprint, payload_file):
    if not FINGERPRINT.fullmatch(fingerprint):
        raise ValueError("completion fingerprint")
    with open(payload_file, encoding="utf-8") as handle:
        payload = json.load(handle, object_pairs_hook=unique_pairs)
    if not isinstance(payload, dict) or "verdict" not in payload:
        raise ValueError("completed Opposition payload required")
    verdict = payload.pop("verdict")
    kind = "code-review" if fingerprint.split()[1] == "commit" else "change-review"
    date = payload.get("completed_at", "")[:10]
    identity = hashlib.sha256(str(payload.get("review_id", "")).encode("utf-8")).hexdigest()[:7]
    path = f"docs/review-log/{date}-{identity}-{kind}.md"
    text = f"---\ntype: {kind}\nfingerprint: {fingerprint}\nverdict: {verdict}\n---\n```json\n" + json.dumps(payload, indent=2) + "\n```\n"
    record = validate(path, text.encode("utf-8"))
    linked_invocation(record, "index")
    for raw_path in git("ls-files", "-z").split(b"\0"):
        prior_path = raw_path.decode("utf-8", "strict")
        if COMPLETION.fullmatch(prior_path):
            prior = validate(prior_path, git("show", ":" + prior_path))
            if prior["invocation"] == record["invocation"] or prior["review_id"] == record["review_id"]:
                raise ValueError("duplicate invocation linkage or review identity")
    write_record(path, text.encode("utf-8"))


def main():
    global REPO_ROOT
    REPO_ROOT = os.fsdecode(subprocess.run(["git", "rev-parse", "--show-toplevel"], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE).stdout.strip())
    if len(sys.argv) == 5 and sys.argv[1] == "start":
        start_record(sys.argv[2], sys.argv[3], sys.argv[4])
        return
    if len(sys.argv) == 4 and sys.argv[1] == "complete":
        complete_record(sys.argv[2], sys.argv[3])
        return
    if len(sys.argv) == 4 and sys.argv[1] == "contain":
        count = contain(sys.argv[2], sys.argv[3])
        print(f"OK: checked {count} valid completion records; all content and final fingerprint covered")
        return
    if len(sys.argv) not in (2, 3) or (len(sys.argv) == 3 and sys.argv[2] != "--allow-mixed"):
        raise ValueError("usage: review-evidence-check index|COMMIT [--allow-mixed] | contain BASE ACTUAL_HEAD")
    changed_records(sys.argv[1], allow_mixed=len(sys.argv) == 3)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, UnicodeError, OSError, subprocess.CalledProcessError, json.JSONDecodeError) as exc:
        print(f"review evidence invalid: {exc}", file=sys.stderr)
        sys.exit(1)
