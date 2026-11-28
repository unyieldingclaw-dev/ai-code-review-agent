---
allowed-tools:
  - Agent
  - Bash(bash scripts/baseline-health.sh*)
  - Bash(git diff *)
  - Bash(gh pr diff *)
  - Bash(which *)
  - Bash(grep *)
  - Bash(find *)
  - Bash(ai-review-agent *)
---

# /change-review

Review the current branch, PR, or diff as a complete change package using 9 parallel review jobs.

## Usage

```
/change-review
/change-review --diff path/to/change.diff
/change-review --base <ref>
/change-review --pr <number>
```

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
reviewer or Opposition, refuse to start if the `change` marker already exists. Leave it
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
if [ -e "$review_root/.claude/.change-review-ok" ] || [ -L "$review_root/.claude/.change-review-ok" ]; then
    printf '%s\n' 'Existing review marker: stop and coordinate ownership; leave it untouched.' >&2
    exit 1
fi
. "$review_root/scripts/_review-gate-lib.sh" || exit 1
review_packet=$(mktemp) || exit 1
review_fingerprint=$(push_review_fingerprint "$review_root") || exit 1
invocation=$("$review_root/scripts/review-evidence-check.sh" start change-review 'committed branch and ordered content patches' "$review_fingerprint") || exit 1
git -C "$review_root" add -- "$invocation" || exit 1
review_head=$(git rev-parse --verify HEAD) || exit 1
review_base=$(git merge-base origin/main "$review_head") || exit 1
_canonical_product_patch "$review_base" "$review_head" > "$review_packet" || exit 1
# Review ordered content commit patches, including intermediate changes hidden by the net diff.
review_commits=$(git rev-list --reverse "$review_base..$review_head") || exit 1
for reviewed_commit in $review_commits; do
    printf '\ncommit %s\n' "$reviewed_commit" >> "$review_packet"
    _canonical_product_patch "$reviewed_commit^" "$reviewed_commit" >> "$review_packet" || exit 1
done
[ "$review_fingerprint" = "$(push_review_fingerprint "$review_root")" ] || exit 1
review_packet_hash=$(sha256_file "$review_packet") || exit 1
```

PowerShell preparation (PowerShell 7.4+ preserves native redirected bytes):
```powershell
$ErrorActionPreference = 'Stop'
$reviewRoot = git rev-parse --show-toplevel
if ($LASTEXITCODE -ne 0 -or -not $reviewRoot) { throw 'No review root' }
Set-Location -LiteralPath $reviewRoot
[System.IO.Directory]::CreateDirectory((Join-Path $reviewRoot '.claude')) > $null
$priorMarker = Join-Path $reviewRoot '.claude/.change-review-ok'
try {
    $null = Get-Item -LiteralPath $priorMarker -Force -ErrorAction Stop
    throw 'Existing review marker: stop and coordinate ownership; leave it untouched.'
} catch [System.Management.Automation.ItemNotFoundException] {
    # No prior marker: this review may begin without claiming another review's authorization.
}
. (Join-Path $reviewRoot 'scripts/_review-gate-lib.ps1')
$reviewPacket = [System.IO.Path]::GetTempFileName()
$reviewFingerprint = Get-PushReviewFingerprint $reviewRoot
$invocation = & (Join-Path $reviewRoot 'scripts/review-evidence-check.ps1') start change-review 'committed branch and ordered content patches' $reviewFingerprint
if ($LASTEXITCODE -ne 0) { throw 'Invocation record failed' }
git -C $reviewRoot add -- $invocation
if ($LASTEXITCODE -ne 0) { throw 'Invocation staging failed' }
$patchArgs = @('-c', 'diff.relative=false', 'diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--binary', '--full-index', '--ignore-submodules=none', '--submodule=short')
$paths = @('--', ':(top)**', ':(exclude,top)docs/review-log/invocations/*.json', ':(exclude,top)docs/review-log/*-code-review.md', ':(exclude,top)docs/review-log/*-change-review.md')
$reviewHead = git rev-parse --verify HEAD
if ($LASTEXITCODE -ne 0) { throw 'No frozen head' }
$reviewBase = git merge-base origin/main $reviewHead
if ($LASTEXITCODE -ne 0 -or -not $reviewBase) { throw 'No push base' }
& git @patchArgs $reviewBase $reviewHead @paths > $reviewPacket
if ($LASTEXITCODE -ne 0) { throw 'Packet capture failed' }
$reviewCommits = @(git rev-list --reverse "$reviewBase..$reviewHead")
if ($LASTEXITCODE -ne 0) { throw 'History capture failed' }
foreach ($reviewedCommit in $reviewCommits) {
    $patch = [System.IO.Path]::GetTempFileName()
    try {
        & git @patchArgs "$reviewedCommit^" $reviewedCommit @paths > $patch
        if ($LASTEXITCODE -ne 0) { throw 'Commit patch capture failed' }
        $stream = [System.IO.File]::Open($reviewPacket, [System.IO.FileMode]::Append)
        try {
            $label = [System.Text.Encoding]::UTF8.GetBytes("`ncommit $reviewedCommit`n")
            $stream.Write($label, 0, $label.Length)
            $bytes = [System.IO.File]::ReadAllBytes($patch)
            $stream.Write($bytes, 0, $bytes.Length)
        } finally { $stream.Dispose() }
    } finally { Remove-Item -LiteralPath $patch -Force }
}
if ($reviewFingerprint -cne (Get-PushReviewFingerprint $reviewRoot)) { throw 'Review state changed during capture' }
$reviewPacketHash = (Get-FileHash -LiteralPath $reviewPacket -Algorithm SHA256).Hash
```

If `origin/main` or the merge base is missing, or history/evidence validation fails,
continue **findings-only**, state why, and write no marker. A local diff may inform findings;
it never replaces the missing push fingerprint. Explicit `--diff`, `--base`, and `--pr`
targets are findings-only unless independently proven identical to the complete frozen
local canonical packet, including ordered content commit patches. A narrowed scope cannot
authorize a push.

## Step 1: Determine the diff

**Default (no flags):** Use Step 0's frozen canonical branch packet and ordered content commit patches. Never substitute staged or working-tree content for push authorization.

**`--diff <path>`:** Load the diff from the specified file.

**`--base <ref>`:** Run `git diff <ref>...HEAD`.

**`--pr <number>`:** Run `gh pr diff <number>` to fetch the PR diff. If `gh` is not installed, report it and fall back to local diff.

If no diff can be obtained, stop and tell the user.

## Step 2: Check for ACR

Run `which ai-review-agent 2>/dev/null` (bash) or `Get-Command ai-review-agent -ErrorAction SilentlyContinue` (PowerShell).

- **Found:** Note it for use in job 7 (security).
- **Not found:** Print exactly:
  > ACR not found in PATH. Skipping local LLM swarm. Continuing with PMB-native review.

## Step 3: Load context (if available)

Look for an active plan at `docs/plans/*.md` with `status: active`. If found, note its path — it informs claim mapping in job 2. Do not load all plans.

## Step 3.5: Baseline Repo Health (informational — not a review job)

**Why this step exists:** every job in this skill reasons over the diff only (Step 1's `git diff`). That's deliberate — this repo's own `docs/HOOKS-GUIDE.md` assigns "codebase invariants" to CI and says the reviewer layer should not duplicate CI's mechanical pattern-matching. But a purely diff-scoped review can silently approve a change sitting on top of a base branch that's already failing repo-wide CI checks — the diff looks clean, CI still goes red, and it's not obvious why. This step closes that visibility gap without duplicating CI's authority: it's a cheap, local, informational spot-check, not a tenth review job, and it never blocks.

Run only checks that are **fully local and offline** (no registry fetch, no module install, no network call) against the **whole working tree**, not the diff:

- The 3 greps from `.github/workflows/pmb-health.yml`'s Fast Checks job (formerly the "Rules-File Integrity" job) (invisible Unicode, hidden HTML comments, LLM bypass phrases) against `standards/`, `CLAUDE.md`, `templates/CLAUDE.md`
- The credential grep and the placeholder (`TBD`/`TODO`) grep from the same job (formerly "Forbidden Patterns") against the same file sets those steps cover
- The Template Integrity step's check that hook scripts referenced in `templates/.claude/settings.json` exist under `templates/`

**Run them with `bash scripts/baseline-health.sh --no-fetch` rather than by hand.** That script contains no copy of any check — it locates each one by name in `.github/workflows/pmb-health.yml`, lifts the body of its `run:` block and executes it verbatim under CI's own shell flags, so a ratcheted cap takes effect here with no edit anywhere. It covers the three greps, the credential and placeholder greps, Template Integrity, and the **whole** File Size step including the relocation-destination byte cap that hand-written lists forget. **Read its exit code and do not collapse the four:** `0` all passed; `1` a real check failed; `2` the workflow is absent, so every row is **Skipped** and nothing was verified — do not substitute remembered thresholds and do not report a pass, since this command ships to repositories that do not receive `pmb-health.yml`; `3` step extraction is unsafe or incomplete — the workflow was renamed or re-indented, a step name was ambiguous/duplicate, or flow-style steps could not be verified — either way **not** a passing tree. `--no-fetch` is what makes the "offline" rule above actually true: without it, the File Size step's startup-context ratchet makes one shallow `git fetch --depth=1 origin main`; the flag neutralizes that line before the body runs, so the ratchet compares against whatever `origin/main` is already resolvable locally — understating growth on a stale baseline, never overstating it — instead of reaching the network.

Do **not** attempt to replicate Semgrep (registry fetch), PSScriptAnalyzer (`Install-Module` fetch), or gitleaks (network action) — those are correctly CI-only per this repo's own layering rule, and this skill can't reliably or quickly reproduce a network-dependent tool.

Report results in their own section (see Step 5's report template) with a one-line pass/fail per check. If a check fails, note whether the offending file(s) are touched by the current diff or pre-existing — this is the detail that would have flagged PR #7's situation immediately. This section never sets `Blocking: Yes` and never factors into the Verdict.

**A check *result* never sets the Verdict; a *discrepancy* between reported and actual results does.** The sentence above is about results, and it holds without exception — a cap failure here is informational however serious it is, because enforcing those caps is CI's job. But Job 9's opposition subagent re-runs these checks and is given this section's reported results to compare against. If what was reported is not what the checks produce, that is not a Step 3.5 result at all: it is evidence this review's own reporting is unreliable, it is a finding on the ordinary Severity/Basis rules, and it is eligible to block. Reporting honestly costs nothing; the rule exists so that misreporting is not free.

**The diff-caused vs pre-existing distinction carries more weight for the size caps than for the greps above, so state it explicitly for them.** A grep hit is usually a pre-existing repo condition and often a judgement call. A cap breach in a file this diff edits is neither: it is arithmetic, and it is caused by the change under review. Reporting it as one more undifferentiated informational line understates it — say plainly which file, at what count, and that the File Size step will fail on it. Per the rule above this still does not set the Verdict, and that is not a contradiction to paper over: **this review's Verdict and CI's gate are separate answers.** A report may legitimately read "Verdict: Approve" beside "the File Size step will fail" — the review found nothing wrong with the change's substance, and CI independently enforces a limit the author must still clear. Say both, rather than muting one to make them agree.

## Step 4: Run 9 review jobs

Work through all 9 jobs. For each finding, use this schema:

| Field              | Description                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------------ |
| **Domain**         | Security / Correctness / Performance / Testing / Maintainability / Architecture / Accessibility / Scope / Coverage |
| **Severity**       | Critical / High / Medium / Low / Info                                                                              |
| **Location**       | `file:line` or `file:line–line`                                                                                    |
| **Evidence**       | Specific lines or patterns. For an ABSENCE claim ("no test covers X", "referenced nowhere") or an ATTRIBUTION claim ("X cost Y bytes"), the scope actually searched, **stated as the command**, in the finding itself — the conclusion alone is not evidence, and the command's reach must match the assertion. See NOTE below. |
| **Basis**          | `llm` / `heuristic` / `policy` / `semgrep` / `acr`                                                                 |
| **Impact**         | What breaks or degrades if not addressed                                                                           |
| **Recommendation** | Concrete fix — not "consider improving"                                                                            |
| **Blocking**       | Yes / No — should this block merge?                                                                                |
| **Confidence**     | High / Medium / Low                                                                                                |

> **NOTE on absence and attribution claims.** The Evidence rule above is the operative form here of
> `standards/CODE-REVIEW.md`'s "Absence and attribution claims" subsection; read it there for the
> full statement and worked example. It is restated in the schema rather than imported wholesale
> because **this command's `Basis` field is not that document's `Basis` field.** Here `Basis` records
> which detector produced a finding (`llm`/`heuristic`/`policy`/`semgrep`/`acr`); there it records
> evidentiary strength (`VERIFIED`/`INFERRED`/`SPECULATIVE`). Same name, orthogonal axes — do not
> substitute one vocabulary for the other, and do not report a `VERIFIED` in this command's Basis
> column. Use the **Confidence** column for strength.

---

### Job 1 — Scope Sanity

Check: Is the diff size proportionate to the stated change? Are there unrelated files, generated files that should be gitignored, or bulk reformatting mixed with logic changes?

Flag:

- Diff touches files that appear unrelated to the stated purpose
- Generated files (lock files, build artifacts, minified output) committed without explicit reason
- Unexplained large deletions or file renames

---

### Job 2 — Claim Mapping

Read the PR description, commit message, or plan (if loaded). Check:

- Every claim in the description maps to at least one changed file
- Every major changed file maps to at least one claim
- New public API surface has documentation or a comment explaining its contract

Flag when a claim has no corresponding change, or a significant file change has no stated justification.

---

### Job 3 — Seam Integrity

Check architectural boundaries:

- Layer violations (e.g., UI code importing from data layer directly, domain logic in a controller)
- Dependency injection broken (hardcoded singletons, global state introduced)
- API/service/data seam contracts — are inputs validated at the seam, not deep inside?
- Cross-module coupling introduced without abstraction

---

### Job 4 — Runtime Semantics

Check behavior at runtime:

- Changed defaults or env var handling — what is the effect when the env var is absent?
- Async patterns — unhandled promise rejections, missing `await`, incorrect error propagation
- Startup/shutdown ordering affected by the change
- Rollback safety — can this change be reverted without data loss or downtime?
- Race conditions or time-of-check/time-of-use issues

---

### Job 5 — Test Assertion Strength

For each new or modified test:

- Does it assert observable behavior, not just types or truthiness?
- Does it assert the _right_ thing (not a side effect that could pass even if the feature is broken)?
- Snapshot tests — is the snapshot actually meaningful, or is it testing the wrong thing?
- Mocks — are they verifed? Could they pass even if the real implementation regresses?

---

### Job 6 — Claim-to-Test Coverage

Cross-reference job 2 claims against the test changes:

- Every behavioral claim has either a test or an explicit waiver comment (`// not tested: <reason>`)
- New code paths (branches, error handlers, edge cases) have test coverage or a noted gap
- Deleted tests — were they covering something that still needs coverage elsewhere?

---

### Job 7 — Security

**PMB deterministic secret scan (independent of ACR availability).** For a frozen Git-backed
scope, resolve the trusted base commit using the independent review policy. In a fresh private
directory outside the reviewed worktree, extract the four `scripts/` blobs listed in the hook
guide from that exact trusted commit with `git cat-file blob`, preserving their bytes. Verify
the extracted bytes against the trusted objects before invoking either wrapper. Use a new
absolute receipt filename outside the reviewed worktree and the helper's temporary directory.
An older trusted base that lacks the helper yields unavailable deterministic evidence.

The operator must independently select a trusted installed Python 3.9+ executable outside the
reviewed worktree and set `PMB_SNAPSHOT_PYTHON` to its absolute path. Use a trusted host shell
and its external system `realpath` utility. The PowerShell wrapper on Windows uses the standard
Git for Windows installation under Program Files. Missing bootstrap prerequisites leave the
deterministic lane unavailable. For Bash, `trusted_bash` is the absolute independently vetted
shell path. Verify the wrapper and its siblings before launch.

For the branch packet prepared above, invoke the matching wrapper from that trusted directory:

```bash
"$trusted_bash" "$trusted_scripts/secret-snapshot.sh" branch --repo "$review_root" --trusted-base "$trusted_base_oid" \
    --base "$review_base" --head "$review_head" --receipt "$snapshot_receipt"
snapshot_exit=$?
```

```powershell
& (Join-Path $trustedScripts 'secret-snapshot.ps1') branch --repo $reviewRoot --trusted-base $trustedBaseOid `
    --base $reviewBase --head $reviewHead --receipt $snapshotReceipt
$snapshotExit = $LASTEXITCODE
```

For an independently frozen staged packet use `index` with its original repository and typed
commit fingerprint, omitting `--base` and `--head`. Custom or unverifiable patches stay
findings-only. Record their missing deterministic coverage explicitly.

Before attaching the receipt, compare its `fingerprint` and `manifest.fingerprint` exactly
to the packet's **original** typed fingerprint. For a branch, also compare both manifest base
and head OIDs with the frozen packet's original base and head. Hash its canonical UTF-8 manifest (sorted keys,
compact separators, literal Unicode) and compare with `manifest_sha256`. Record exit, status,
cleanup, receipt SHA-256 and the complete version/path ledger as separate PMB evidence in the
existing bundle. Exit 0 may contain findings. Exit 2 requires the partial/unavailable reason.
Exit 3, missing correspondence or failed cleanup invalidates the scan evidence. If the frozen
review input changed, stop publication and start a fresh review. Preserve ACR's original
`toolAvailability` and all existing full-scope, Opposition and human authorization checks.


**If ACR is available:**

1. Pass the frozen Step 0 packet as ACR's `--diff` file. Do not rerun Git or fetch a newer PR diff. For findings-only custom targets, freeze the supplied target before jobs and give that same file to every job.
2. **Preflight the version — `--chunk` requires ACR >= 1.10.0, and nothing else in this workflow pins it.** Run `ai-review-agent --version`. If it is below 1.10.0, ACR **cannot** run this job: `--chunk` is mandatory (below), and an older build rejects the flag with a usage error — exit 1 and no report. **`--chunk` was introduced in ACR `CHANGELOG.md` `[1.10.0]`, 2026-08-17**, which is the source of the pin. **If `--version` errors, times out, or its output cannot be parsed as a version, treat ACR as unavailable too** — the safe direction, stated rather than assumed. Treat ACR as **unavailable**, go straight to the inline `/security-review` logic, and record `basis: llm` in the Coverage Footer — `too old (<version>)` when a version parsed, `version unreadable` when none did. **Do not fall back to a non-chunked run** — that reintroduces the silent truncation this job exists to prevent.
3. Before running, create an isolated temporary working directory outside the reviewed tree.
   Resolve a trusted base commit independently of reviewed content. Copy only its pinned config
   and ignore bytes into that directory, preserving their hashes/provenance; use explicit config
   selection supported by the observed ACR version and disable ambient/project configuration.
   Run only from this directory with the frozen external diff patch. The reviewed tree cannot
   configure the reviewer. If isolation/config precedence cannot be established, skip ACR and
   record that limitation. Hash the patch and config/ignore bytes before and after every attempt;
   changes invalidate the attempt. Do not run the following command from the reviewed-tree cwd.
   Run `ai-review-agent --profile security --chunk --format json --diff "$review_packet"` (Bash), or use `--diff $reviewPacket` in PowerShell and read its exit code. **Neither `--chunk` nor `--format json` is optional here.** `--chunk` prevents silent truncation (note below). `--format json` is what makes row `0`'s signals READABLE: `formatJson()` is a raw `JSON.stringify(result)`, so every signal below is a field on the result object. **One run yields all four** — an earlier draft of this step omitted `--format json`, which made row `0` instruct a check the procedure could not produce.
   Require nonempty all-ok evidence for agents planned versus agents reported, every chunk,
   every authoritative changed path versus filtered files, tool availability, early exit and
   truncation. Missing/empty fields are inconclusive; check per-chunk evidence rather than trusting
   a merged summary. Even affirmative coverage never replaces mandatory PMB full-scope review.
4. **Map the exit code. Do NOT collapse to zero/non-zero, and do NOT assume this list is complete — treat any code not listed as `2`:**

   | Exit | Meaning | What to do |
   |------|---------|-----------|
   | `0` | Nothing met the threshold — **`0` does NOT establish that coverage was complete** | **Never record an unqualified clean pass from exit `0`.** Inspect the JSON for any indication of reduced coverage (`filteredFiles`, an `agentStatus` entry that is not `ok`, `earlyExit`, `truncation`). **That list is INDICATIVE, not exhaustive, and individual fields are unreliable to a degree that varies by ACR build** — under the mandatory `--chunk` the merge has been observed to drop some fields and union others, and which is which has changed between builds. **Do not rely on a remembered per-field verdict; treat any field's absence as inconclusive rather than as evidence of clean coverage.** (The prior version of this row named two specific fields as unreliable. One of those verdicts was falsified within a day by an upstream change — which is this row's own thesis demonstrated against itself, and the reason the enumeration is gone rather than corrected.) Any indication, **or any inability to establish coverage**, → fall through per item 5. Otherwise record `basis: acr` **with an explicit coverage caveat** in the footer. See **Why this row stopped enumerating signals** below. |
   | `1` | Something met `--fail-on` (default `high`) — **or the invocation was rejected** | **Check a findings object exists BEFORE reading this as findings.** **With findings:** use them, `basis: acr`, and apply the `0` row's coverage caveat — exit `1` says nothing about coverage. **With none:** this is a usage error — measured 2026-09-01, an unknown flag, a bad `--fail-on` value and an unknown profile each exit `1` with one stderr line and no report (a missing diff file exits `4`, not `1`). Read the stderr line, fix the invocation, and fall through per item 5 as `basis: llm`. **Do not retry** — these are deterministic. |
   | `2` | An agent failed internally (takes priority over `1`) | Not a clean pass. Fall through to the inline logic below. |
   | `3` | The diff was TRUNCATED — coverage was partial | Not a clean pass. **`--chunk` is already mandatory above, so there is nothing to re-run differently** — fall through. (This row previously said "re-run with `--chunk`", which became dead advice once `--chunk` was made mandatory.) |
   | `4` | Startup failure — no review ran at all (Ollama unreachable, model missing, diff file absent) | **Retry once with the same frozen inputs, then fall back; do not triage.** This is infrastructure, not a finding about the code. On stderr with no report produced, so there is no empty findings list to misread. If it recurs, fall through. |
   | any other | Unknown | Treat as `2`. An earlier version of this step said "if the exit code is non-zero" and was replaced by an explicit table; the table then omitted `4`, which was hit in practice on 2026-08-30 when a server restart killed a run mid-chunk. Enumerating without a catch-all reintroduced the gap the enumeration was meant to close. |

> **Why this row stopped enumerating signals.** Four review rounds were spent trying to state precisely which field
> of ACR's output proves coverage. Every version of that list was correct when written and wrong within a day, and the
> corrections kept introducing new contradictions — first a signal the invocation could not produce, then one the chunk
> merge silently drops. **The cause is structural: `ai-review-agent` here is an `npm link` into another session's
> working tree, on an arbitrary branch, rebuilt without warning — its behaviour changed at least three times during a
> single session, and `--version` does not identify what ran.** A precise static description of a moving target cannot
> converge. So this table states an INVARIANT (exit `0` never earns an unqualified clean pass) and treats the field
> list as indicative. Before relying on any specific field, re-derive it against `npm pack ai-review-agent@<version>`,
> not against the linked build.
>
> **KNOWN GAP this row does NOT detect reliably — do not read the table as reassurance.** ACR's `security` and
> `adversarial` agents carry `exclude: ['**/*.md']`, and the "skipped by agentPolicy" line renders only when EVERY
> changed file matches. On a mostly-markdown diff they review only the non-markdown files and the rendered report says
> nothing. Measured 2026-09-01 on a 6-`.md`-plus-1-`.sh` diff: **all six markdown files were excluded**, leaving one
> file reviewed — including both copies of this command file, i.e. the definition of the gate itself.
>
> **Do NOT "fix" that by deleting the exclude.** ACR's source records those two agents as having zero file-type
> awareness with a REPRODUCED failure: misreading a `.md` file's prose description of a vulnerability as executable
> code. This repo's `standards/` and `memory-bank/` are exactly that content, so a blanket removal is worse than the
> gap. The real axis is inert prose vs executable instruction, and a file extension is a failing proxy for it here.
> Note `loadConfig` does a SHALLOW merge — setting `agentPolicy` for any agent replaces the whole default object.
> Tracked as `[NS-48]`; NOT applied.

5. **On exit 2, 3, 4, any unlisted code, or an exit `0`/`1` whose BODY declares the run incomplete:** never read an empty findings list as clean — that reports "reviewed, nothing found" when it means "did not review all of it." Record the exit code verbatim in this job's output, then fall through to the inline `/security-review` logic as the actual coverage, attributed `basis: llm` (not `basis: acr`, since ACR did not genuinely complete). State the reduced coverage in the Coverage Footer.
6. **Never pass `--allow-truncation` in this workflow.** It converts exit 3 into exit 0, which is precisely the signal this step exists to preserve.

> **Why:** Without `--diff`, ACR defaults to `git diff --cached` (staged changes), which is a different surface than the PR or branch diff computed in Step 1.
>
> **Why `--chunk`, measured not assumed:** `--max-lines` defaults to **2000**. On 2026-08-30 a
> 6,578-line branch diff was truncated to 2,000 lines — four agents returned **0 findings in 13.6s**
> and exited 3. The same diff with `--chunk` (4 full-coverage passes, 200s) returned **15 findings
> including 2 High**. Any diff over 2,000 lines is affected, which is most branch diffs.
>
> **ACR was NOT silent about it — the reader was.** An earlier draft of this note claimed the report
> body gave no signal and that only the exit code showed truncation. That was false, and the
> correction matters more than the original point. The run announced it THREE times: a `[ai-review]
> Diff truncated: 4579 of 6579 lines were excluded` line as the **first line of output**, a
> `⚠️ Diff truncated: reviewed 2000/6579 lines` banner in the report, and — because the finding count
> was zero — an `⚠️ INCOMPLETE` headline replacing the usual clean checkmark. The reviewer missed all
> three by running `tail` and a grep for agent lines instead of reading the report.
>
> So the real hazard this step guards is not a silent tool; it is a reviewer who greps a report
> instead of reading it. `--chunk` is mandatory because it removes the situation rather than relying
> on anyone noticing a banner — a control that depends on attention is not a control.
>
> **Why the exit codes are enumerated rather than tested as non-zero:** an earlier version of this
> step said "if the exit code is non-zero ... do not treat an empty findings list as a clean pass."
> That rule is right for 2 and 3 and **wrong for 1**, which means the run succeeded and found
> something at or above the fail threshold. Under that rule a run that correctly surfaced two High
> findings would have been discarded as "did not actually run" and replaced with weaker inline
> coverage — throwing away the tool's most valuable output at exactly the moment it mattered.
>
> **Why check the exit code, not just presence:** a presence-only check (`which ai-review-agent`, Step 2) can't distinguish "ACR ran and found nothing" from "ACR was invoked but every agent inside it failed or timed out" — the latter also produces zero findings, and without an exit-code check both look identical: a clean security review. That's a silently skipped security check reading as a pass.

**Always, including when ACR appears complete:** Run the PMB `/security-review` logic inline:

- Hardcoded secrets, credentials, API keys, tokens
- Injection vectors: SQL, shell, path traversal, template injection
- Auth bypass or privilege escalation
- Unsafe deserialization, prototype pollution
- Dependency changes — are new deps audited?
- Secrets in logs, error messages, or stack traces

---

### Job 8 — Accessibility (conditional)

**Skip this job if no UI files are touched** (no `.html`, `.jsx`, `.tsx`, `.vue`, `.svelte`, `.css` in the diff). Note in the coverage footer: `Accessibility: skipped — no UI files`.

**If UI files are present:**

- Interactive elements have accessible labels (aria-label, aria-labelledby, or visible text)
- Color is not the sole conveyor of information
- Focus management correct for new modals, dialogs, or route changes
- Keyboard navigation works for new interactive components
- Images have alt text

---

### Job 9 — Opposition Recommendation and Human Authorization

Spawn one subagent using `subagent_type: opposition` (`.claude/agents/opposition.md`) **and** passing
an explicit `model` of **`opus`**, matching that agent's frontmatter pin — NOT `sonnet`, which as an
explicit parameter would override the pin and silently downgrade the gate (this file's wording until
2026-08-27). Never a cost-optimized model, since this subagent
is the required semantic recommendation owner; the human authorizes marker publication.

**WHY the named agent:** `.claude/settings.json` sets `CLAUDE_CODE_SUBAGENT_MODEL=haiku`. Until
2026-08-26 the "capable model" requirement was prose in this file, addressed to whichever model
happened to be orchestrating — and an orchestrator that skipped the sentence got a haiku opposition
pass shaped exactly like a real one (verdict, findings table, confidence column), with nothing
anywhere recording that the gate had run cheap. `.claude/agents/opposition.md` pins `model: opus`,
moving the requirement from the advisory layer into config.

**Frontmatter beats the environment variable — verified 2026-08-26**, by spawning `opposition` with
no `model` parameter while `CLAUDE_CODE_SUBAGENT_MODEL=haiku` was set; it reported `claude-opus-5`.
So the pin alone is sufficient. Passing `model` explicitly is retained as cheap defence in depth
against the frontmatter being edited or lost, not because precedence is in doubt.

**If `subagent_type: opposition` errors with "agent type not found":** a newly created agent file is
picked up after a short refresh lag, not instantly (observed 2026-08-26: not found on first call,
available minutes later in the same session — so this is a lag, NOT a session boundary). The error is
loud rather than a silent downgrade. Retry; if it persists, fall back to
`subagent_type: general-purpose` **with `model` passed explicitly**, pasting the body of
`.claude/agents/opposition.md` in as the prompt. Never fall back to a default model.

Give it:
- The absolute Step 0 root, frozen packet path, original typed fingerprint and packet hash. Review that packet; do not gather a newer diff.
- The full findings tables from Jobs 1–8. **Not** the Step 3.5 Baseline Repo Health results as
  findings to weigh — that section is informational only and never affects Blocking.
- **This orchestrator's Step 3.5 Baseline Repo Health results, verbatim — as claims to re-run, not
  as findings to weigh.** The distinction carries the whole design: a Step 3.5 *result* never
  affects Blocking however bad it is, because enforcing those caps is CI's job and not this
  review's. But a *discrepancy* between what this orchestrator reported and what the checks actually
  produce is not a Step 3.5 result at all — it is evidence that this review's own reporting is
  unreliable, which is a different category of thing and is a finding on the ordinary rules.
  Without these in the payload the section is entirely self-attested, with nothing anywhere
  verifying it.
- The finding schema (Domain, Severity, Location, Evidence, Basis, Impact, Recommendation, Blocking,
  Confidence)
- The diff being reviewed (same scope as Step 1) — needed to produce genuine counter-evidence when
  answering the opposition questions, not just react to the findings tables
- Read and Bash tool access

Instruct it to, in order:

1. Re-run Step 3.5's Baseline Repo Health checks yourself: `bash scripts/baseline-health.sh
   --no-fetch`. Pass `--no-fetch` — you must not perform a repository write, and the flag neutralizes
   the one `git fetch` an extracted body would otherwise run without disabling the check that fetch
   feeds. Do not decline the run or fall back to hand-deriving the checks from
   `.github/workflows/pmb-health.yml` instead — that is exactly the unreliable reimplementation Step
   3.5 exists to avoid. Compare against the results handed over above. A **result** that differs from
   CI is informational, exactly as Step 3.5 says. A **discrepancy between what was reported and what
   the checks actually produce** is not: report it as a finding on the ordinary Severity/Basis rules.
   **If this orchestrator did not supply its Step 3.5 results at all, report that omission as a
   finding**, and apply the same rule to any other item the `Give it:` list requires that you did
   not receive — a disagreement is loud, a missing payload item is silent, and the report looks
   equally complete either way.

2. Play devil's advocate against the entire change:
   - What assumptions does this change make that could be wrong?
   - What edge cases does it not handle?
   - Are there performance implications at scale that the change doesn't address?
   - Are any findings from jobs 1–8 overstated — flag false positives explicitly, with specific
     counter-evidence from the diff
   - Cross-domain risks: a correctness issue that also has security implications, or a test gap
     that also affects a claim

3. Before scanning, revise the `Blocking` field on any finding from Jobs 1–8 you conclude above is
   overstated or a false positive, backed by specific counter-evidence from the diff — specific
   evidence that risk is contained downgrades it to `Blocking: No`. Then scan every finding —
   Jobs 1–8's findings (with any revisions from this step
   applied) plus anything you surface yourself during the opposition pass — for any `Blocking: Yes`.
   This determines whether the change package is clean.

4. For every completed verdict over the complete authorized scope, record the outcome below. Marker publication additionally requires **Approve** with no surviving `Blocking: Yes` findings:
   independently recompute `push_review_fingerprint(review_root)` / `Get-PushReviewFingerprint $reviewRoot`
   from the frozen absolute root. Require exact equality with the **original Step 0**
   fingerprint and verify the frozen packet hash is unchanged. If the index, parent HEAD,
   branch history, or packet changed, leave the marker absent and require a fresh review.
   Never bless newly changed state by replacing the original fingerprint. Opposition returns the completed recommendation without publishing a marker. After exact
   human authorization, the orchestrator publishes using the recomputed value and exact LF bytes:

   Before publishing the marker, persist the actual completed Opposition verdict,
   reviewer/run identity, completion timestamp, rationale, and **all final findings**
   using the exact schema in `docs/review-log/README.md`. Set `invocation` to the exact `$invocation` path from preparation and `scope` to `committed branch and ordered content patches`; never invent or reuse a start identity. The checker binds type, scope, fingerprint and timezone-aware start/completion ordering. This is Opposition's own
   result; the orchestrator must not invent an Approve or omit a blocker. Set
   `covered` to every committed product patch in oldest-first order, as `{commit,parent,patch}` rows from the frozen review input; verify their full commit IDs, parents, and SHA-256 patch hashes. Preserve Request Changes/Needs Discussion as failed
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
   "$python_cmd" -c 'import hashlib,json,pathlib,sys; mpath,rpath,fp,result,operation,packet_hash=sys.argv[1:]; mb=pathlib.Path(mpath).read_bytes(); m=json.loads(mb); r=json.loads(pathlib.Path(rpath).read_bytes()); digest=lambda b:hashlib.sha256(b).hexdigest(); (mb == json.dumps(m,sort_keys=True,separators=(",",":"),ensure_ascii=False).encode("utf-8")) or sys.exit("Noncanonical manifest"); (r["decision"] == "authorize-marker" and r["manifest_sha256"] == digest(mb) and r["result_sha256"] == digest(pathlib.Path(result).read_bytes()) and r["fingerprint"] == fp == m["fingerprint"] and r["operation"] == m["operation"] == operation and m["packet_sha256"] == packet_hash.lower() and all(isinstance(r.get(k),str) and r[k].strip() for k in ("human","message_ref","authorized_at"))) or sys.exit("Missing or mismatched human authorization")' "$review_manifest" "$human_receipt" "$review_fingerprint" "$opposition_payload" change-review "$review_packet_hash" || exit 1
   current=$(push_review_fingerprint "$review_root") || exit 1
   [ "$current" = "$review_fingerprint" ] || exit 1
   [ "$(sha256_file "$review_packet")" = "$review_packet_hash" ] || exit 1
   marker="$review_root/.claude/.change-review-ok"
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
   & $pythonCmd -c 'import hashlib,json,pathlib,sys; mpath,rpath,fp,result,operation,packet_hash=sys.argv[1:]; mb=pathlib.Path(mpath).read_bytes(); m=json.loads(mb); r=json.loads(pathlib.Path(rpath).read_bytes()); digest=lambda b:hashlib.sha256(b).hexdigest(); (mb == json.dumps(m,sort_keys=True,separators=(",",":"),ensure_ascii=False).encode("utf-8")) or sys.exit("Noncanonical manifest"); (r["decision"] == "authorize-marker" and r["manifest_sha256"] == digest(mb) and r["result_sha256"] == digest(pathlib.Path(result).read_bytes()) and r["fingerprint"] == fp == m["fingerprint"] and r["operation"] == m["operation"] == operation and m["packet_sha256"] == packet_hash.lower() and all(isinstance(r.get(k),str) and r[k].strip() for k in ("human","message_ref","authorized_at"))) or sys.exit("Missing or mismatched human authorization")' $reviewManifest $humanReceipt $reviewFingerprint $oppositionPayload change-review $reviewPacketHash
   if ($LASTEXITCODE -ne 0) { throw 'Invalid human authorization binding' }
   $current = Get-PushReviewFingerprint $reviewRoot
   if ($current -cne $reviewFingerprint) { throw 'Review state changed; review again' }
   if ((Get-FileHash -LiteralPath $reviewPacket -Algorithm SHA256).Hash -cne $reviewPacketHash) { throw 'Frozen packet changed' }
   # Preserve exact UTF-8/LF bytes; Set-Content adds a platform newline.
   $marker = Join-Path $reviewRoot '.claude/.change-review-ok'
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

5. Return to the orchestrator: its opposition answers; its own Step 3.5 re-run results from
   instruction 1, including any discrepancy or missing-payload finding; the full findings list with
   any `Blocking` revisions from instruction 3 applied (for each revised finding, note the original
   value, the new value, and the counter-evidence that justified the change) plus any findings it
   surfaced itself during the opposition pass; and confirmation that it did not write a marker.

---

## Step 5: Output the report

```markdown
# Change Review

## Findings

| Domain | Severity | Location | Evidence | Basis | Impact | Recommendation | Blocking | Confidence   |
| ------ | -------- | -------- | -------- | ----- | ------ | -------------- | -------- | ------------ |
| ...    | ...      | ...      | ...      | ...   | ...    | ...            | Yes/No   | High/Med/Low |

_(If no findings: "No findings. Change package looks clean.")_

## Baseline Repo Health (informational — not scoped to this diff)

| Check | Status | Notes |
| ----- | ------ | ----- |
| Invisible Unicode characters | ✅ Pass / ❌ Fail | ... |
| Hidden HTML comments | ✅ Pass / ❌ Fail | ... |
| LLM bypass phrases | ✅ Pass / ❌ Fail | ... |
| Credential grep | ✅ Pass / ❌ Fail | ... |
| Spec placeholder grep | ✅ Pass / ❌ Fail | ... |
| Template Integrity | ✅ Pass / ❌ Fail | ... |
| File Size step (markdown cap, memory-bank caps, relocation destinations) | ✅ Pass / ❌ Fail | ... |

_(This section is informational only — it never sets `Blocking: Yes` and never affects the Verdict. If any check fails, state whether the affected file(s) are touched by this diff or pre-existing on the base branch.)_

## Job Summary

| Job                       | Status                              | Notes |
| ------------------------- | ----------------------------------- | ----- |
| 1 Scope Sanity            | ✅ Clean / ⚠️ N findings            | ...   |
| 2 Claim Mapping           | ...                                 | ...   |
| 3 Seam Integrity          | ...                                 | ...   |
| 4 Runtime Semantics       | ...                                 | ...   |
| 5 Test Assertion Strength | ...                                 | ...   |
| 6 Claim-to-Test Coverage  | ...                                 | ...   |
| 7 Security                | ...                                 | ...   |
| 8 Accessibility           | ✅ Clean / ⏭ Skipped — no UI files | ...   |
| 9 Opposition              | ...                                 | ...   |

## Coverage Footer

- **Review target:** local diff | branch (`<name>`) | PR #<number>
- **Base ref:** `<ref>` or unavailable
- **Files changed:** <count>
- **Plan/spec loaded:** none | `<path>`
- **Security review:** reviewed (PMB-native) | reviewed (ACR) | skipped
- **Accessibility:** reviewed | skipped — no UI files
- **ACR backend:** used | not installed | too old (`<version>`, needs >= 1.10.0) | version unreadable | disabled
- **Baseline repo health:** all checks pass | N check(s) failing (pre-existing)
```

_(Render the Findings table above using the findings list returned by Job 9's subagent — which
reflects any `Blocking` revisions made during its opposition pass — do not use the original,
unrevised Jobs 1–8 output. Job 9 returns a recommendation without a marker. Await exact human authorization under the
policy above before the orchestrator executes publication; never overwrite a peer marker.)_

## Final instruction

Stop after displaying the report. Do NOT edit files, push commits, or post PR comments unless the
user explicitly asks — invocation/completion evidence is audit data; marker publication requires the separate exact Human authorization receipt above.
