# Durable review evidence

Only invocation JSON and completion Markdown matching these paths are evidence:

- `docs/review-log/invocations/<13-digit-epoch-ms>-<nonce>.json`
- `docs/review-log/<YYYY-MM-DD>-<7-lowercase-hex>-(code|change)-review.md`

`README.md` is ordinary product content: it needs review and changes the canonical
fingerprint. Every other unrecognized path under this directory is rejected.
Records must be regular files and append-only. Keep prior outcomes; use a new
review identity for a new review. Duplicate identities, covered commits, JSON
keys, or findings IDs are errors. No record is cryptographic proof of reasoning.

## Invocation

Capture the canonical typed fingerprint first, then run the shared helper before domain review or Opposition, from the anchored root:

```bash
invocation=$(scripts/review-evidence-check.sh start code-review 'staged product patch' "$review_fingerprint") || exit 1
git add -- "$invocation" || exit 1
```

For branch review use `change-review` and scope `committed branch and ordered
content patches`. PowerShell has the same positional `start REVIEW SCOPE`
interface, with the frozen fingerprint as its final argument. The helper writes a unique UTF-8 record with exactly `type`, `review`,
`started_at` (timezone required), `scope`, and `fingerprint`. Legacy invocation-only records without a fingerprint remain audit data and can never link to a completion. An invocation never counts as a
completed review and cannot satisfy CI by itself.

## Completion schema

After the actual Opposition pass completes, it supplies its verdict and a JSON
payload file with exactly these fields (replace the example values):

```json
{
  "verdict": "Approve",
  "review_id": "unique-review-identity",
  "invocation": "docs/review-log/invocations/1758762000000-actual-nonce.json",
  "scope": "staged product patch",
  "reviewer": "claude-opposition:model-and-run-identity",
  "completed_at": "2026-09-25T01:00:00Z",
  "covered": [],
  "findings": [],
  "rationale": "All required domains and Opposition completed against the frozen packet."
}
```

`findings` is an array of objects with exactly `id`, `severity`, `location`,
`evidence`, `recommendation` (nonempty strings), and `blocking` (JSON boolean).
Copy every final Opposition finding, including nonblockers; an empty list means
no findings. `blocking: true` defeats `Approve`. Accepted verdicts are `Approve`,
`Request Changes`, and `Needs Discussion`; only completed Approve records cover
content in CI. Completed failed reviews remain append-only audit records, grant no coverage, and never authorize markers. A later fresh invocation and exact final approval can cover fixed content. Any non-Approve verdict, even with no blocking findings, conflicts with an Approve at the same fingerprint in either order; changing content requires a new complete review. This structural rule cannot adjudicate false-positive withdrawals at an unchanged fingerprint, and an unrelated edit is not semantic proof of fixing a finding.

For code review, `covered` is empty: the future commit SHA does not exist yet.
The frozen `v2 commit <parent> <patch-sha256>` fingerprint binds the proposed
product patch. CI accepts it only inside the content commit with that exact
parent and canonical patch. For an unborn initial commit, the local zero-parent
fingerprint remains supported, but PR containment requires a real merge-base.

For change review, `covered` contains every product commit in oldest-first order,
with exactly `commit`, `parent`, and `patch` (full Git IDs and canonical patch
SHA-256). Obtain these rows with the same canonical Git options as the review
packet; the shared Python helper's `content_history(base, head)` returns them.
Include the actual patches in the frozen review packet, not only their hashes.
The `v2 push <merge-base> <product-diff-sha256> <ordered-content-digest>` fingerprint
must match that history. No raw HEAD binding is used, so adding the completion in
an evidence-only commit terminates the protocol.

Only the completed Opposition may perform completion creation before marker
publication, using its frozen fingerprint and actual result:

```bash
completion=$(scripts/review-evidence-check.sh complete "$review_fingerprint" "$opposition_payload") || exit 1
git add -- "$completion" || exit 1
scripts/review-evidence-check.sh index --allow-mixed || exit 1
```

PowerShell: `& scripts/review-evidence-check.ps1 complete $reviewFingerprint
$oppositionPayload`; stage the returned path and run `index -AllowMixed`. On any
error, publish no marker. Recompute the original fingerprint before publication.
The checker resolves `invocation` from the Git index or the containing commit, never a working-tree substitute. It must name an existing regular invocation record with identical review type, exact scope and fingerprint, and a timezone-aware start no later than completion. One invocation may complete only once; duplicate linkage and review identity are denied.

The helper exclusively creates a date/identity-named Markdown file, with scalar
frontmatter `type`, `fingerprint`, `verdict` and one fenced `json` block containing
the eight remaining payload fields. Additional text, unknown fields, missing rows,
invalid dates, duplicate keys, symlinks, and truncated bodies are rejected.

## Finite sequence and CI

1. Stage product content; start invocation; complete staged code review.
2. Stage its completion and commit content plus evidence under the code marker.
3. Review committed branch history and all ordered content patches.
4. Stage the completed change review, commit evidence only, then mint the push
   marker against unchanged product content/history and push actual HEAD.

The evidence-only exception is structural; mixed product/evidence still requires
a code marker. CI reads blobs from each historical commit, validates records,
checks every product commit's own code record or later whole-branch coverage,
and requires at least one completed record plus a final exact change review.
It rejects shallow/ambiguous history and every merge commit except a sync merge: a
two-parent commit whose first parent is the PR side and whose second parent is reachable
from the base, with exactly one merge base, whose tree equals a fresh
`git merge-tree --write-tree` of its parents with renames off and attributes empty (Git
2.40 or newer). Any conflict resolution or hand edit therefore fails. A sync merge adds no
content row; content commits are taken in first-parent order, each change review is
checked at its own commit's merge base, and trailing sync merges are skipped when finding
the final change review. Content after a sync still needs its own review. Rebase or squash changes
commit/parent identities and requires fresh branch evidence. CI checks the actual
PR head with full history, never GitHub's synthetic merge commit. The checker must execute from a trusted base, while PR objects are read only as data; executing the PR copy of the checker would let a PR bypass its own check.

Run `bash scripts/ci-review-containment-check.sh BASE_REF ACTUAL_HEAD` for a local check. The trusted remote workflow is a draft pending separate scope/rollout approval; no active CI containment job is installed by this change. Its proposed job name is `Review Containment`. Requiring its status in branch protection is a
separate user-approved rollout action. Local hooks can be absent or bypassed;
CI is a remote backstop only after that required status is configured. Python 3
is required, with no added third-party dependencies; missing runtime fails closed.
