---
description: "Deep code review covering security, correctness, maintainability, testing, and architecture drift. Uses Claude (cloud API) â€” sends diff content to Anthropic. Some environments may have a personal, machine-local /ai-review command (Ollama-based, not shipped by this repo) as an offline alternative; if unavailable, this cloud-based review is the supported path. Spawns separate subagents per domain so findings don't bias each other."
allowed-tools:
  - Bash(bash scripts/baseline-health.sh*)
  - Bash(git diff *)
  - Bash(git rev-parse *)
  - Bash(git hash-object *)
  - Bash(git log *)
  - Bash(git status *)
  - Bash(git grep *)
  - Bash(git cat-file *)
  - Bash(git ls-tree *)
  - Bash(find *)
  - Bash(grep *)
  - Bash(wc *)
  - Bash(awk *)
  - Read
  - Agent
---

# Code Review

You are a senior engineer orchestrating a thorough code review. Follow every step below in order. Do not skip any section. The review contract (domains, severity levels, finding schema, report sections, opposition review requirements, and failure criteria) is defined in `standards/CODE-REVIEW.md` â€” read it at Step 1 and apply it throughout.

## Authority policy: human authorization before publication

ACR is supplemental evidence only, never a verdict. PMB Opposition supplies a recommendation
from the complete authoritative changed-path inventory, regardless of ACR omissions. Review every
changed path and ordered content patch, including unsupported languages, binary/deleted files,
and files filtered out by ACR. PMB full-scope review is mandatory even if ACR fields look clean.
Same-client reviewer independence is procedural: it is not a protected issuer. There is no
protected issuer or finalizer here, and a local marker is not unforgeable. Evidence validation
checks native content/index/history consistency, not who actually performed semantic review.

Before jobs, freeze a canonical manifest as UTF-8 JSON with sorted keys, compact separators,
no BOM and no trailing newline; record SHA-256 of those exact bytes. Include schema version,
operation (`code-review` or `change-review`), absolute review_root, original typed fingerprint,
resolved full base and HEAD IDs, index patch SHA-256, packet SHA-256, full changed paths with
status (both names for renames), and ordered history rows `{commit,parent,patch}` with full IDs
and SHA-256 canonical patches. A staged-only review has empty history. Include destination
repository/ref and expected destination revision when applicable; otherwise explicitly record
`destination: null` and why it is inapplicable. Resolve the base before capture; unavailable or
ambiguous base/history cannot authorize publication. Derive inventory from Git, never ACR output.
Freeze reviewer/run identity, required domains and coverage assignment; give the same manifest
and packet to every job. Preserve all existing native content/index/history checks.

Record an ACR receipt (or explicit not-run reason) in the manifest: resolved executable, version,
source/build identity if established, mutable-build caveat if not, profile, process exit status,
exact diff SHA-256 before/after, coverage, config and ignore provenance with trusted-base commit,
paths and byte hashes. Save raw output/stderr hashes. Missing provenance is a limitation, never
an authorization claim. Freeze these inputs before launch; finalize the manifest with the actual
receipt, then give Opposition that exact manifest for its completed recommendation.
If any frozen input changes, restart; do not replace the original fingerprint to bless new state.

**Human authorization receipt:** after the full completed recommendation and all findings are
available, present the exact canonical manifest SHA-256, original typed fingerprint, operation,
current revision, destination applicability and SHA-256 of the exact Opposition JSON result.
Wait for explicit HUMAN authorization referencing that exact manifest/fingerprint and result.
A general earlier "approved", policy approval, task approval, tool escalation, or ACR exit status
is not future authorization. Record the human's identity, exact message reference/text and UTC
completion time in a separate JSON receipt with `decision: "authorize-marker"`,
`manifest_sha256`, `result_sha256`, `fingerprint`, `operation`, `human`, `message_ref`, and
`authorized_at`. Do not fabricate a receipt or infer consent. The receipt is an auditable local
record, not cryptographic proof of a human issuer. Opposition returns its result and NEVER mints
a marker itself. The orchestrator may execute the guarded publication recipe only after that
specific human authorization; no marker while awaiting it. Merge consent is separate and must
identify the exact revision and destination; marker authorization never implies merge consent.

Set `review_manifest` / `$reviewManifest` and `human_receipt` / `$humanReceipt` to those frozen
files only after receiving the exact authorization. The recipe checks receipt/result/manifest
binding, then rechecks the original native fingerprint and packet immediately before publication.
Any missing receipt, changed result, input, history, index, destination or revision requires a
fresh review/authorization. Independently re-read the receipt against the actual human message;
local JSON checks cannot authenticate the person. Do not execute publication as Opposition.

## Step 0: Anchor and freeze the review before any jobs

Resolve the worktree root with `git rev-parse --show-toplevel` from the invocation directory,
including when invoked in a nested directory. Keep that absolute `review_root` throughout;
never resolve a different root in a subagent. Before loading context or starting any domain
reviewer or Opposition, refuse to start if the `code` marker already exists. Leave it
untouched and coordinate ownership with the review that created it before another attempt;
never silently remove or overwrite a pre-existing peer marker. If this review starts with
no marker, a failed, interrupted, narrowed, or findings-only run must create none.

The preparation recipes capture the typed fingerprint, then create and explicitly stage
an invocation bound to that fingerprint before review starts. Interrupted invocations remain audit records; they
never count as completed reviews. See `docs/review-log/README.md` for the schema.

Use one shell's preparation below. These variables and absolute packet path must be handed
to **every** review job and Opposition. Reviewers read the frozen packet rather than gathering
a newer diff. Capture the typed fingerprint **before** producing the packet, then recompute
it after capture; a mismatch aborts authorization and requires a fresh review. Do not refresh
the original fingerprint to make a changed tree pass.

Bash preparation (the shared helper supplies the canonical Git options and evidence exclusion):
```bash
review_root=$(git rev-parse --show-toplevel) || exit 1
cd "$review_root" || exit 1
mkdir -p "$review_root/.claude"
if [ -e "$review_root/.claude/.code-review-ok" ] || [ -L "$review_root/.claude/.code-review-ok" ]; then
    printf '%s\n' 'Existing review marker: stop and coordinate ownership; leave it untouched.' >&2
    exit 1
fi
. "$review_root/scripts/_review-gate-lib.sh" || exit 1
review_packet=$(mktemp) || exit 1
review_fingerprint=$(commit_review_fingerprint "$review_root") || exit 1
invocation=$("$review_root/scripts/review-evidence-check.sh" start code-review 'staged product patch' "$review_fingerprint") || exit 1
git -C "$review_root" add -- "$invocation" || exit 1
_canonical_product_patch --cached > "$review_packet" || exit 1
[ "$review_fingerprint" = "$(commit_review_fingerprint "$review_root")" ] || exit 1
review_packet_hash=$(sha256_file "$review_packet") || exit 1
```

PowerShell preparation (PowerShell 7.4+ preserves native redirected bytes):
```powershell
$ErrorActionPreference = 'Stop'
$reviewRoot = git rev-parse --show-toplevel
if ($LASTEXITCODE -ne 0 -or -not $reviewRoot) { throw 'No review root' }
Set-Location -LiteralPath $reviewRoot
[System.IO.Directory]::CreateDirectory((Join-Path $reviewRoot '.claude')) > $null
$priorMarker = Join-Path $reviewRoot '.claude/.code-review-ok'
try {
    $null = Get-Item -LiteralPath $priorMarker -Force -ErrorAction Stop
    throw 'Existing review marker: stop and coordinate ownership; leave it untouched.'
} catch [System.Management.Automation.ItemNotFoundException] {
    # No prior marker: this review may begin without claiming another review's authorization.
}
. (Join-Path $reviewRoot 'scripts/_review-gate-lib.ps1')
$reviewPacket = [System.IO.Path]::GetTempFileName()
$reviewFingerprint = Get-CommitReviewFingerprint $reviewRoot
$invocation = & (Join-Path $reviewRoot 'scripts/review-evidence-check.ps1') start code-review 'staged product patch' $reviewFingerprint
if ($LASTEXITCODE -ne 0) { throw 'Invocation record failed' }
git -C $reviewRoot add -- $invocation
if ($LASTEXITCODE -ne 0) { throw 'Invocation staging failed' }
$patchArgs = @('-c', 'diff.relative=false', 'diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--binary', '--full-index', '--ignore-submodules=none', '--submodule=short')
$paths = @('--', ':(top)**', ':(exclude,top)docs/review-log/invocations/*.json', ':(exclude,top)docs/review-log/*-code-review.md', ':(exclude,top)docs/review-log/*-change-review.md')
& git @patchArgs --cached @paths > $reviewPacket
if ($LASTEXITCODE -ne 0) { throw 'Packet capture failed' }
if ($reviewFingerprint -cne (Get-CommitReviewFingerprint $reviewRoot)) { throw 'Review state changed during capture' }
$reviewPacketHash = (Get-FileHash -LiteralPath $reviewPacket -Algorithm SHA256).Hash
```

A file/folder target is findings-only and cannot authorize the full index. The default
review covers exactly the staged product patch; unstaged changes are context only.

## Step 1 â€” Load Review Contract

Read `standards/CODE-REVIEW.md` in full. This file defines:

- Required and conditional domains
- Severity levels and field value scales
- Required finding fields
- Required report sections
- Opposition review requirements
- Failure criteria
- Remediation policy

Do not proceed until you have read the standard. All subsequent steps must conform to it.

## Step 2 â€” Determine Scope

For the default review, use the frozen staged product packet from Step 0. Report the
scope as `canonical staged product patch`. If a path was explicitly requested, review it as
findings-only. If no product patch can be obtained, stop and leave the marker absent.

## Step 3 â€” Gather Context

```
git log --oneline -10
```

For each changed file run:

```
git log --oneline -5 -- <filename>
```

Use this to understand why the code exists and whether the change is consistent with past decisions.

Determine which conditional domains apply:

- Performance: does the diff touch tight loops, database queries, or I/O paths?
- Accessibility: does the diff touch HTML/JSX/TSX/Vue/Svelte files?

## Step 3.5 â€” Baseline Repo Health (deterministic; run BEFORE spawning anything)

**Why this step exists:** every domain in Step 4 reasons semantically over a diff. That is the
right instrument for "is this claim true" and the wrong one for "does this violate a mechanical
limit." On 2026-09-07 a change that would have pushed `CHANGELOG.md` past the markdown line cap in
`.github/workflows/pmb-health.yml`'s File Size job reached the commit point after seven adversarial
review rounds, and was caught only because the user asked for one more look. The committed file
stood at 792 lines against an 800-line cap â€” `git show 9890758~1:CHANGELOG.md | wc -l` â€” so it had
never breached in any commit; the pending addition was what would have taken it over. No amount of
semantic review finds that; `wc -l` finds it in milliseconds.

**Why it runs before Step 4 specifically:** Steps 4 and 5 together spawn six to eight subagents,
each reading the diff in full, and they are what this command spends its budget on. Running the
mechanical checks first avoids spending any of that on a change CI will reject regardless of what
the round concludes. (This is a cost argument, not a sequencing one â€” `/change-review`'s Step 3.5
also precedes its own subagent spawn. No ordering is claimed between Step 4's domain passes and
Step 5's single opposition pass; the models differ and the comparison has not been measured.)

Run it:

```
bash scripts/baseline-health.sh --no-fetch
```

**Do not reimplement these checks by hand, and do not copy thresholds into your report as if you had
derived them.** The script contains no copy of any check: it locates each one by name in
`.github/workflows/pmb-health.yml`, lifts the body of its `run:` block, and executes that verbatim
under CI's own shell flags. So a cap ratcheted in the workflow takes effect here on the next run
with no edit to anything â€” which is why no thresholds, path lists or patterns appear in this file.
Reproducing them by hand is not merely redundant, it is unreliable: the spec placeholder scan alone
needs a 20-line `awk` function with a fence-parity and a per-line backtick-parity guard, and a naive
`grep` substitute reports false hits on a clean tree.

**Read the exit code. The four are distinct on purpose â€” do not collapse them.**

| Code | Meaning | What to report |
|---|---|---|
| `0` | every check passed | Pass, per check |
| `1` | a check **failed** | A real CI failure, on the same bodies the workflow runs. Name the check and the offending file. |
| `2` | the workflow is **absent** | Every row **Skipped**. Nothing was verified. Do **not** substitute remembered thresholds and do **not** report a pass â€” this command ships to repositories that do not receive `pmb-health.yml`. |
| `3` | step extraction is **unsafe or incomplete** | The workflow was renamed or re-indented, a step name was ambiguous/duplicate, or flow-style steps could not be verified. Nothing ran. **This is not a passing tree.** Report it as a finding against the tooling. |

**`--no-fetch` is mandatory here, not just for the Step 5 subagent re-run.** Without it, the File
Size job's startup-context ratchet makes one shallow `git fetch --depth=1 origin main`, which
re-shallows an already-shallow clone. **`--no-fetch` prevents that re-shallowing, but does not
repair a clone that is already shallow** â€” `git merge-base`/ancestry checks (`git merge-base
--is-ancestor`, three-dot `git diff A...B`) can still falsely report "not an ancestor" for content
genuinely on `main`, reproduced directly in this repo even with `--no-fetch` already in force
(`[NS-13]`/`[NS-55]` in `Personal-Memory-Bank`'s own memory bank track this failure mode). If an
ancestry check's result must be trusted, run `git fetch --unshallow` first; otherwise prefer
content-diffing (two-dot `git diff <ref> <ref>`) over ancestry as the default check in a shallow
clone â€” it does not depend on shallow history at all. Pass `--no-fetch` on every invocation of this
script in this workflow, orchestrator and subagent alike, to stop the ratchet's own fetch from
making the clone shallower than it already is â€” never rely on it to make an ancestry check
trustworthy mid-review. Semgrep, PSScriptAnalyzer and gitleaks are deliberately absent from the
script â€” each needs a registry fetch, module install or network action, and per this repo's
layering rule they are correctly CI-only.

**Report the results; do not act on them.** List each check as a one-line pass/fail in the Step 6
report, marking each failure diff-caused or pre-existing. If a cap fails on a file this diff
touches, say so before spawning Step 4 and tell the user the change cannot pass CI as written â€”
they decide whether to spend the round. **Do not fix it yourself.** Editing during a review is a
Failure Criterion in `standards/CODE-REVIEW.md` ("Repo mutation during review without explicit user
request") and is forbidden by this file's own closing rule; remediation needs an explicit request
after findings are presented.

**A check *result* never sets the Verdict; a *discrepancy* between reported and actual results
does.** Enforcement of these caps belongs to CI, and this step exists to make CI's answer visible
early rather than to duplicate its authority â€” so a genuine FAIL here, however serious, is
informational. But if Step 5's re-run finds this step reported a result the workflow does not
produce, that is not a cap finding at all: it is evidence the review's own reporting is unreliable,
it is eligible for `Blocking: true` on the ordinary Severity/Basis rules, and it must be reported
as a finding rather than reconciled quietly.

## Step 4 â€” Spawn Independent Domain Subagents

Spawn one subagent per required domain from the standard, plus any conditional domains that apply. Each subagent sees only the code and its own domain lens â€” not other subagents' findings.

For each subagent, provide:

- The absolute Step 0 root, frozen packet, original typed fingerprint and packet hash; review this captured scope
- Pass the full text of the Severity, Blocking, and Basis field definitions from `standards/CODE-REVIEW.md` verbatim in each subagent prompt â€” do not paraphrase
- Instruction to populate all required finding fields: Domain, Severity, Location, Evidence, Basis, Impact, Recommendation, Blocking
- Instruction to return structured findings only â€” no remediation

Domains to spawn (always): Security, Correctness, Maintainability, Testing, Architecture Drift
Domains to spawn (if applicable): Performance, Accessibility

## Step 5 â€” Opposition Review, Recommendation, and Human Authorization

Spawn one final subagent as the opposition reviewer, using `subagent_type: opposition`
(`.claude/agents/opposition.md`). Pass an explicit `model` of **`opus`** â€” matching the pin in that
agent's frontmatter. Do NOT pass `sonnet`: an explicit `model` parameter OVERRIDES frontmatter, so
"sonnet or higher" (this file's wording until 2026-08-27) let a compliant orchestrator silently
downgrade the very pin added to stop exactly that. Never a cost-optimized model â€” this subagent is
the required semantic recommendation owner; the human authorizes marker publication.

**WHY the named agent:** `.claude/settings.json` sets `CLAUDE_CODE_SUBAGENT_MODEL=haiku`. Until
2026-08-26 the "capable model" requirement was prose in this file, addressed to whichever model
happened to be orchestrating â€” and an orchestrator that skipped the sentence got a haiku opposition
pass shaped exactly like a real one (verdict, findings table, confidence column), with nothing
anywhere recording that the gate had run cheap. `.claude/agents/opposition.md` pins `model: opus`,
moving the requirement from the advisory layer into config.

**Frontmatter beats the environment variable â€” verified 2026-08-26**, by spawning `opposition` with
no `model` parameter while `CLAUDE_CODE_SUBAGENT_MODEL=haiku` was set; it reported `claude-opus-5`.
So the pin alone is sufficient. Passing `model` explicitly is retained as cheap defence in depth
against the frontmatter being edited or lost, not because precedence is in doubt.

**If `subagent_type: opposition` errors with "agent type not found":** a newly created agent file is
picked up after a short refresh lag, not instantly (observed 2026-08-26: not found on first call,
available minutes later in the same session â€” so this is a lag, NOT a session boundary). The error is
loud rather than a silent downgrade. Retry; if it persists, fall back to
`subagent_type: general-purpose` **with `model` passed explicitly**, pasting the body of
`.claude/agents/opposition.md` in as the prompt. Never fall back to a default model.

Give it:
- The absolute Step 0 root and frozen packet path, original typed fingerprint, and packet hash. Review that packet; do not gather a newer diff.
- All domain findings collected in Step 4 â€” **if Step 4 returned no findings, or was not run, say
  so explicitly rather than omitting this item.** An absent item and an empty one are
  indistinguishable to the subagent, and only one of them is legitimate.
- The diff being reviewed (same scope as Step 4) â€” needed to produce genuine counter-evidence when
  answering the opposition questions, not just react to the findings table
- The full text of the Severity, Blocking, and Basis field definitions from `standards/CODE-REVIEW.md`, verbatim
- **This orchestrator's Step 3.5 results, verbatim** â€” every check with the pass/fail you recorded
  and the figures you measured. Instruction 1 below asks the subagent to report any disagreement
  with these, and Step 3.5 makes such a disagreement `Blocking: true`-eligible; without them in the
  payload it can only re-run the checks independently, never detect that you *misreported* them.
  Handing over your own claim so it can be contradicted is the whole point; withholding it leaves
  the subagent checking the repository instead of checking you.
- Read and Bash tool access

Instruct it to, in order:

1. Re-run Step 3.5's deterministic checks yourself: `bash scripts/baseline-health.sh --no-fetch`.
   Pass `--no-fetch` â€” you must not perform a repository write, and the flag neutralizes the one
   `git fetch` an extracted body would otherwise run (see Step 3.5's `--no-fetch` paragraph) without disabling
   the check that fetch feeds. Do not decline the run or fall back to hand-deriving the checks from
   `.github/workflows/pmb-health.yml` instead â€” that is exactly the unreliable reimplementation Step
   3.5 exists to avoid. The orchestrator reporting PASS is a claim like any other, and this command's
   premise is that claims get checked rather than believed â€” an orchestrator's claim about its own
   work least of all. Re-running costs seconds. Report any disagreement with the orchestrator's Step
   3.5 results as a finding.

   **If this orchestrator did not supply its Step 3.5 results at all, report that omission as a
   finding too**, and apply the same rule to any other item the `Give it:` list requires that you
   did not receive. A disagreement is loud; a missing payload item is silent, and your report looks
   equally complete either way â€” which is why the omission has to be the thing you report. This is
   not hypothetical: during the review that added this instruction, the orchestrator omitted the
   Step 4 findings item entirely and no one noticed until the opposition agent said so.

2. Answer all four questions from the standard's Opposition Review section:
   - Is any Critical/High finding overstated? Provide counter-evidence.
   - What was not reviewed that could matter?
   - Which findings might be false positives in this codebase's context?
   - What cross-domain risk did no single domain agent catch?
   A general statement that none apply is a failure â€” all four must be explicitly answered.

3. Determine the final verdict: before scanning, revise the `Blocking` field on any finding you
   concluded above is overstated or a false positive with specific counter-evidence â€” per the
   standard's exception, evidence that risk is contained downgrades it to `Blocking: false`. Then
   scan every finding â€” the Step 4 domain findings (with any revisions from this step applied) plus
   anything you surfaced yourself while answering the opposition questions â€” for any `Blocking:
   true`. If none survive, the verdict is **Approve**. Otherwise the verdict is **Request Changes**
   (if concrete fixes were identified) or **Needs Discussion** (if the disagreement itself needs a
   human call).

4. For every completed verdict over the complete authorized scope, record the outcome below. Marker publication additionally requires **Approve** with no surviving blockers:
   independently recompute `commit_review_fingerprint(review_root)` / `Get-CommitReviewFingerprint $reviewRoot`
   from the frozen absolute root. Require exact equality with the **original Step 0**
   fingerprint and verify the frozen packet hash is unchanged. If the index, parent HEAD,
   branch history, or packet changed, leave the marker absent and require a fresh review.
   Never bless newly changed state by replacing the original fingerprint. Opposition returns the completed recommendation without publishing a marker. After exact
   human authorization, the orchestrator publishes using the recomputed value and exact LF bytes:

   Before publishing the marker, persist the actual completed Opposition verdict,
   reviewer/run identity, completion timestamp, rationale, and **all final findings**
   using the exact schema in `docs/review-log/README.md`. Set `invocation` to the exact `$invocation` path from preparation and `scope` to `staged product patch`; never invent or reuse a start identity. The checker binds type, scope, fingerprint and timezone-aware start/completion ordering. This is Opposition's own
   result; the orchestrator must not invent an Approve or omit a blocker. Set
   `covered` to an empty array for the proposed staged patch. Preserve Request Changes/Needs Discussion as failed
   records, with no marker. A missing, skipped, narrowed, or interrupted Opposition
   has no completion and no marker. For any completed full-scope verdict, Opposition writes
   its JSON payload to `opposition_payload` / `$oppositionPayload`, then executes:

   ```bash
   completion=$("$review_root/scripts/review-evidence-check.sh" complete "$review_fingerprint" "$opposition_payload") || exit 1
   git -C "$review_root" add -- "$completion" || exit 1
   (cd "$review_root" && "$review_root/scripts/review-evidence-check.sh" index --allow-mixed) || exit 1
   ```

   ```powershell
   $completion = & (Join-Path $reviewRoot 'scripts/review-evidence-check.ps1') complete $reviewFingerprint $oppositionPayload
   if ($LASTEXITCODE -ne 0) { throw 'Completion record failed' }
   git -C $reviewRoot add -- $completion
   if ($LASTEXITCODE -ne 0) { throw 'Completion staging failed' }
   & (Join-Path $reviewRoot 'scripts/review-evidence-check.ps1') index -AllowMixed
   if ($LASTEXITCODE -ne 0) { throw 'Invalid evidence' }
   ```

   Request Changes/Needs Discussion stops here after staging the audit record; publish no marker. Any record/staging error also stops publication. Only completed Approve with no blocker AND an exact Human authorization receipt may run the publication recipes below; recompute the original fingerprint after staging.

   ```bash
   cd "$review_root" || exit 1
   . "$review_root/scripts/_review-gate-lib.sh" || exit 1
   python_cmd=$(command -v python3 || command -v python) || exit 1
   "$python_cmd" -c 'import json,sys; p=json.load(open(sys.argv[1], encoding="utf-8")); sys.exit(0 if p["verdict"] == "Approve" and not any(f["blocking"] for f in p["findings"]) else 1)' "$opposition_payload" || exit 1
   # Human authorization receipt: never synthesize this from an agent decision.
   [ -n "${review_manifest:-}" ] && [ -n "${human_receipt:-}" ] || exit 1
   "$python_cmd" -c 'import hashlib,json,pathlib,sys; mpath,rpath,fp,result,operation,packet_hash=sys.argv[1:]; mb=pathlib.Path(mpath).read_bytes(); m=json.loads(mb); r=json.loads(pathlib.Path(rpath).read_bytes()); digest=lambda b:hashlib.sha256(b).hexdigest(); (mb == json.dumps(m,sort_keys=True,separators=(",",":"),ensure_ascii=False).encode("utf-8")) or sys.exit("Noncanonical manifest"); (r["decision"] == "authorize-marker" and r["manifest_sha256"] == digest(mb) and r["result_sha256"] == digest(pathlib.Path(result).read_bytes()) and r["fingerprint"] == fp == m["fingerprint"] and r["operation"] == m["operation"] == operation and m["packet_sha256"] == packet_hash.lower() and all(isinstance(r.get(k),str) and r[k].strip() for k in ("human","message_ref","authorized_at"))) or sys.exit("Missing or mismatched human authorization")' "$review_manifest" "$human_receipt" "$review_fingerprint" "$opposition_payload" code-review "$review_packet_hash" || exit 1
   current=$(commit_review_fingerprint "$review_root") || exit 1
   [ "$current" = "$review_fingerprint" ] || exit 1
   [ "$(sha256_file "$review_packet")" = "$review_packet_hash" ] || exit 1
   marker="$review_root/.claude/.code-review-ok"
   temporary=$(mktemp "$review_root/.claude/.review-marker.XXXXXX") || exit 1
   if ! printf '%s\n' "$current" > "$temporary"; then rm -f "$temporary"; exit 1; fi
   # Atomic publication without replacing another review's marker; fail closed if unsupported.
   python_cmd=$(command -v python3 || command -v python) || { rm -f "$temporary"; exit 1; }
   "$python_cmd" -c 'import os, sys; os.link(sys.argv[1], sys.argv[2])' "$temporary" "$marker"
   published=$?
   rm -f "$temporary"
   [ "$published" -eq 0 ] || exit 1
   ```

   ```powershell
   $ErrorActionPreference = 'Stop'
   Set-Location -LiteralPath $reviewRoot
   . (Join-Path $reviewRoot 'scripts/_review-gate-lib.ps1')
   $completedResult = Get-Content -LiteralPath $oppositionPayload -Raw | ConvertFrom-Json
   if ($completedResult.verdict -cne 'Approve' -or @($completedResult.findings | Where-Object { $_.blocking }).Count -gt 0) { throw 'Completed review did not approve without blockers' }
   # Human authorization receipt: never synthesize this from an agent decision.
   if (-not $reviewManifest -or -not $humanReceipt) { throw 'Exact human authorization required' }
   $pythonCmd = (Get-Command python3, python -ErrorAction SilentlyContinue | Select-Object -First 1).Source
   if (-not $pythonCmd) { throw 'Python required for authorization binding' }
   & $pythonCmd -c 'import hashlib,json,pathlib,sys; mpath,rpath,fp,result,operation,packet_hash=sys.argv[1:]; mb=pathlib.Path(mpath).read_bytes(); m=json.loads(mb); r=json.loads(pathlib.Path(rpath).read_bytes()); digest=lambda b:hashlib.sha256(b).hexdigest(); (mb == json.dumps(m,sort_keys=True,separators=(",",":"),ensure_ascii=False).encode("utf-8")) or sys.exit("Noncanonical manifest"); (r["decision"] == "authorize-marker" and r["manifest_sha256"] == digest(mb) and r["result_sha256"] == digest(pathlib.Path(result).read_bytes()) and r["fingerprint"] == fp == m["fingerprint"] and r["operation"] == m["operation"] == operation and m["packet_sha256"] == packet_hash.lower() and all(isinstance(r.get(k),str) and r[k].strip() for k in ("human","message_ref","authorized_at"))) or sys.exit("Missing or mismatched human authorization")' $reviewManifest $humanReceipt $reviewFingerprint $oppositionPayload code-review $reviewPacketHash
   if ($LASTEXITCODE -ne 0) { throw 'Invalid human authorization binding' }
   $current = Get-CommitReviewFingerprint $reviewRoot
   if ($current -cne $reviewFingerprint) { throw 'Review state changed; review again' }
   if ((Get-FileHash -LiteralPath $reviewPacket -Algorithm SHA256).Hash -cne $reviewPacketHash) { throw 'Frozen packet changed' }
   # Preserve exact UTF-8/LF bytes; Set-Content adds a platform newline.
   $marker = Join-Path $reviewRoot '.claude/.code-review-ok'
   $temporary = Join-Path (Split-Path -Parent $marker) ([System.IO.Path]::GetRandomFileName())
   try {
       [System.IO.File]::WriteAllBytes($temporary, [System.Text.Encoding]::UTF8.GetBytes("$current`n"))
       [System.IO.File]::Move($temporary, $marker)
   } finally {
       if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
   }
   ```

   Missing input, interrupted review, Request Changes, Needs Discussion, findings-only scope,
   or any capture/fingerprint error writes no marker. Never remove a peer marker that appears during review. Clean up the temporary packet after
   Opposition finishes. Do not write a raw diff hash, BOM, CRLF, blank line, or whitespace.

5. Return to the orchestrator: its answers to the four opposition questions, the verdict, confirmation that it did not write a marker, and the full findings list with any `Blocking` revisions from instruction 3 applied
   (for each revised finding, note the original value, the new value, and the counter-evidence that
   justified the change), and its own Step 3.5 re-run results from instruction 1.

## Step 6 â€” Assemble Report

**Pre-escalation gate â€” satisfy every condition below before presenting this report or asking for
any approval.** These are falsifiable checks, not a confidence judgement: "I am satisfied this is
complete" is the state that preceded each failure they exist to catch, so it cannot be the test.

1. **Every deterministic gate in Step 3.5 has been run against the working tree** â€” actually
   executed, not reasoned about, and not taken from a subagent's report.
2. **Every number, line citation and `file:function` attribution *you* originate carries the
   command that produced it**, run by you against the current tree. Not "I derived this myself" â€”
   the command, in the report, so a second reader can re-run it. This is deliberate: the standard's
   own Evidence Integrity rule is that "a self-attested completion counts as UNMET", so a claim
   about your own diligence cannot discharge this condition, only a re-runnable command can.
   This applies to figures you introduce â€” scope counts, sizes, gate results, anything in your own
   prose â€” and **not** to the domain findings' own Evidence fields, which you relay unaltered and
   which instruction 1 of Step 5 exists to re-derive. Relaying a subagent's figure *into your own
   prose* without re-deriving it is the single most reliable predictor of a false statement in this
   repo's review history â€” a function name that does not exist, a line list stale by a fixed
   offset, a count no stated method reproduces: each entered the record by being copied.
3. **Every claim about a file has been checked against that file in its current state**, including
   claims inherited from a handoff, an earlier session, or your own earlier turn.
4. **The full diff has been read once end to end**, not only the hunks you edited.
5. **Any number written into a file under active edit was re-derived after the last edit to that
   file.** Line numbers and counts decay silently; a figure that was correct when measured can be
   wrong by the time it is committed.

If a condition cannot be met, say which one and why, in the report, rather than presenting the work
as complete. An acknowledged gap is a finding; an unacknowledged one is a false certificate.

Using the findings list returned by Step 5's subagent (which reflects any `Blocking` revisions made
during its opposition review â€” do not use the original, unrevised Step 4 output) and the opposition
answers/verdict it also returned, produce the report using the required sections from the standard.
The recommendation and Opposition Review answers are Step 5's subagent's determination â€” do not recompute or
override them here, and do not write or overwrite `.claude/.code-review-ok` in this step; it remains
absent until the orchestrator receives exact human authorization; Opposition never publishes it.

**Scope:** [canonical staged product patch or findings-only filename]
**Files reviewed:** N
**Step 4 disposition:** N domains spawned, M findings returned â€” state zero explicitly if that is
the number, so a silent Step 4 is distinguishable from a clean one.

**Baseline Repo Health (Step 3.5 â€” informational, never sets the Verdict):**
| Check | Status | Diff-caused or pre-existing |
|---|---|---|
| ... | Pass / Fail / Skipped | ... |

**Domain Coverage:**
| Domain | Status |
|---|---|
| Security | Reviewed |
| Correctness | Reviewed |
| Maintainability | Reviewed |
| Testing | Reviewed |
| Architecture Drift | Reviewed |
| Performance | Reviewed / Skipped (not applicable) |
| Accessibility | Reviewed / Skipped (not applicable) |

## Supported Findings

_(VERIFIED and INFERRED findings. Omit rows that belong in Predicted Risks.)_

| Domain | Severity | Location | Evidence | Basis      | Impact | Recommendation | Blocking   |
| ------ | -------- | -------- | -------- | ---------- | ------ | -------------- | ---------- |
| ...    | ...      | ...      | ...      | [VERIFIED] | ...    | ...            | true/false |

## Predicted Risks

_(SPECULATIVE findings only. Omit this entire section if none exist.)_

| Domain | Severity | Location | Evidence | Basis         | Impact | Recommendation | Blocking |
| ------ | -------- | -------- | -------- | ------------- | ------ | -------------- | -------- |
| ...    | ...      | ...      | ...      | [SPECULATIVE] | ...    | ...            | false    |

**Testing Gaps:**
List any missing tests identified by the Testing domain subagent.

**Opposition Review:**
[Step 5 subagent's answers to all four opposition review questions]

**Verdict:** [Step 5 subagent's verdict â€” Approve / Request Changes / Needs Discussion]

One paragraph summary of the most important confirmed findings.

---

Do NOT edit product files, generate tests, or apply fixes during review. Opposition returns
its recommendation only. The orchestrator may publish evidence and a marker only under the
Human authorization receipt policy above; absent exact consent, report and stop with no marker.

---

## Usage

```
/code-review                     # reviews staged product patch
/code-review src/auth/login.py   # reviews a specific file
/code-review src/api/            # reviews a whole folder
```
