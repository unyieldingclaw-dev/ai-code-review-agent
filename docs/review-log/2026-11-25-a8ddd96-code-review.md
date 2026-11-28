---
type: code-review
fingerprint: v2 commit ba7677b624f64ed09e788e744ba625f62d4bb457 a3e486336b7ae405f5415715192daba1debe74bac8230938c51f2a3fab9b4cfd
verdict: Approve
---
```json
{
  "review_id": "acr-cr-20261125-pmb130-1",
  "invocation": "docs/review-log/invocations/1795636338856-ba5d69e7d7384c48880621108edd91af.json",
  "scope": "staged product patch",
  "reviewer": "claude-opposition:opus:claude-opus-5-5/0cf6609c-3f6a-4c57-b28b-b2e758be3ffd",
  "completed_at": "2026-11-25T20:04:35Z",
  "covered": [],
  "findings": [
    {
      "id": "S1",
      "severity": "High",
      "location": ".claude/settings.json:16-84 (staged hook commands)",
      "evidence": "Hooks use relative scripts/ paths with 2>/dev/null || true; a non-root cwd makes every guard exit 0 silently. HEAD settings.json:36,49,62 has identical exposure. Containment via .githooks is partial: pre-push-check.sh has no force-push rule and Bash(git *) is allowed, so dangerous-commands is the sole force-push guard. Not widened by this change (deny 8->16, none removed).",
      "recommendation": "Pre-existing floor-High fail-open in merged code: report to user at once (CODE-REVIEW.md:102); disposition Fix only, anchor with \"$CLAUDE_PROJECT_DIR\" upstream in PMB template or locally by user decision.",
      "blocking": false
    },
    {
      "id": "S2",
      "severity": "High",
      "location": "scripts/dangerous-commands.sh / scripts/dangerous-commands.ps1 CONFIRM rows; .claude/settings.json deny",
      "evidence": "Probe through both twins: 'git commit -n -m x' allow/allow; 'git -c core.hooksPath=/dev/null commit' allow/allow; 'git commit -m x --no-verify' ask/ask. Short-form evasion of a CONFIRM row is floor-High. Pre-existing (HEAD twins had 1 matching pattern line; staged 24/11) and recorded at standards/SECURITY-GUARDRAILS.md:270-272.",
      "recommendation": "Report to user with S1; add -n CONFIRM row upstream or record explicit user acceptance of the documented limit.",
      "blocking": false
    },
    {
      "id": "S3",
      "severity": "Medium",
      "location": ".github/workflows/memory-bank-size.yml:33",
      "evidence": "No permissions block; actions/checkout@v6.0.2 vs @v7 elsewhere; advisory read-only job.",
      "recommendation": "Add permissions: contents: read and align checkout, preferably upstream.",
      "blocking": false
    },
    {
      "id": "S4",
      "severity": "Medium",
      "location": "scripts/pre-commit-check.sh:140; scripts/_review-evidence-check.py:171-209",
      "evidence": "Evidence-only index commits pass without marker; records self-attested per docs/review-log/README.md. Product commits still need marker (mixed index returns 'mixed product and evidence changes', verified).",
      "recommendation": "Accept as design caveat; consider CI containment job.",
      "blocking": false
    },
    {
      "id": "S5",
      "severity": "Low",
      "location": "scripts/pre-commit-check.sh:151; scripts/pre-push-check.sh:301; .gitignore",
      "evidence": "Retained claim files .claude/.code-review-claim.XXXXXX and .push-consume.XXXXXX not ignored by .gitignore.",
      "recommendation": "Drop unless a reachable defect is named; otherwise ignore pattern upstream.",
      "blocking": false
    },
    {
      "id": "S6",
      "severity": "Low",
      "location": ".claude/settings.json:71; scripts/check-contract.sh",
      "evidence": "check-contract now bash-only; exits 0 without python3. Advisory guard.",
      "recommendation": "Drop; advisory by design.",
      "blocking": false
    },
    {
      "id": "C1",
      "severity": "Medium",
      "location": ".github/workflows/memory-bank-size.yml:89,113,117",
      "evidence": "find memory-bank -name '*.md' includes archive (287932 bytes measured); aggregate always over 25600; ENFORCE=false so exit 0 with misleading OVER output.",
      "recommendation": "Exclude memory-bank/archive in both finds or record as accepted upstream quirk.",
      "blocking": false
    },
    {
      "id": "C2",
      "severity": "Low",
      "location": ".github/workflows/ci.yml:56-77",
      "evidence": "ci.yml size step untouched and passes; new workflow is redundant.",
      "recommendation": "Drop.",
      "blocking": false
    },
    {
      "id": "C3",
      "severity": "Low",
      "location": ".gitignore (.claude/contracts/*.json)",
      "evidence": "Tracked active-task.json stays tracked; new contract JSONs ignored.",
      "recommendation": "Confirm intent; add !.claude/contracts/active-task.json if it should stay tracked.",
      "blocking": false
    },
    {
      "id": "C4",
      "severity": "Low",
      "location": ".claude/commands/change-review.md:210,523; code-review.md:191",
      "evidence": "References absent pmb-health.yml, templates/, merge-gate.json; all invoked hook scripts present.",
      "recommendation": "Drop or note in pmb-integration.md.",
      "blocking": false
    },
    {
      "id": "C5",
      "severity": "Info",
      "location": ".prettierignore; .pmb-source; .pmb-version",
      "evidence": "Prettier negation works; .pmb-source lacks trailing newline; settings.json valid JSON.",
      "recommendation": "Drop.",
      "blocking": false
    },
    {
      "id": "M1",
      "severity": "Low",
      "location": ".claude/contracts/active-task.json:3 (unstaged, not in packet)",
      "evidence": "Revised from High/true: file absent from paths.txt and from byte-identical canonical patch; HEAD status 'complete' is valid per check-contract-core.py:64; hook exits 0 and PMB_CONTRACT_HARD_BLOCK unset; commit/push gates do not read the contract.",
      "recommendation": "Set status to a schema value or add on-hold to schema/CONTRACTS-GUIDE upstream.",
      "blocking": false
    },
    {
      "id": "M2",
      "severity": "Medium",
      "location": "docs/HOOKS-GUIDE.md:145-167; memory-bank/systemPatterns.md:106-123",
      "evidence": "Docs describe raw sha256 marker; gate now uses 'v2 commit <parent> <patch-sha>'.",
      "recommendation": "Update docs in this PR or immediate follow-up.",
      "blocking": false
    },
    {
      "id": "M3",
      "severity": "Medium",
      "location": "CLAUDE.md Task Contract Protocol; docs/CONTRACTS-GUIDE.md:36,71-95",
      "evidence": "Docs drift from check-contract-core.py schema.",
      "recommendation": "Reconcile docs with core schema.",
      "blocking": false
    },
    {
      "id": "M4",
      "severity": "Medium",
      "location": ".github/workflows/memory-bank-size.yml:47-56 vs ci.yml:56-66",
      "evidence": "Two size gates with different caps (progress 600 vs 400).",
      "recommendation": "Keep one authoritative gate; update pmb-integration.md.",
      "blocking": false
    },
    {
      "id": "M5",
      "severity": "Low",
      "location": ".prettierignore:7-14",
      "evidence": "Future ACR commands silently unformatted unless added as ! exceptions.",
      "recommendation": "Drop or add comment naming the rule.",
      "blocking": false
    },
    {
      "id": "M6",
      "severity": "Low",
      "location": ".claude/contracts/active-task.json task text; .pmb-source",
      "evidence": "Task text says b6ca0aa; later amendment and .pmb-source record c9859c8.",
      "recommendation": "Drop; amendment already records target.",
      "blocking": false
    },
    {
      "id": "T-A",
      "severity": "Low",
      "location": ".github/workflows/memory-bank-size.yml:117",
      "evidence": "Duplicate of C1: CLAUDE.md plus memory-bank/*.md measured 87595 bytes, permanently over 25600, always exit 0.",
      "recommendation": "Resolve with C1.",
      "blocking": false
    },
    {
      "id": "T-B",
      "severity": "Medium",
      "location": "scripts/pre-commit-check.sh:146-152",
      "evidence": "No test or observed run of valid-marker commit success or stale-marker refusal; fingerprint recomputation matches typed fingerprint but marker path never exercised end to end.",
      "recommendation": "Record the real commit of this change as the exit-0 evidence and one stale-marker refusal.",
      "blocking": false
    },
    {
      "id": "A1",
      "severity": "Medium",
      "location": ".github/workflows/memory-bank-size.yml:62-137",
      "evidence": "Second gate caps disagree with ci.yml; remediation text says docs/archive/ (line 127) vs ACR memory-bank/archive/.",
      "recommendation": "Delete and record, or align and mark authoritative.",
      "blocking": false
    },
    {
      "id": "A2",
      "severity": "Medium",
      "location": ".github/workflows/memory-bank-size.yml:113",
      "evidence": "Duplicate of C1: aggregate counts archive (287932 bytes) against 25600.",
      "recommendation": "Resolve with C1.",
      "blocking": false
    },
    {
      "id": "A3",
      "severity": "Low",
      "location": ".gitignore",
      "evidence": "Duplicate of C3.",
      "recommendation": "Resolve with C3.",
      "blocking": false
    },
    {
      "id": "O1",
      "severity": "Low",
      "location": "package.json:27-33",
      "evidence": "files includes .claude/commands/; npm pack --dry-run lists 11 command files, 10 PMB governance commands (4 new from this upgrade); postinstall.mjs copies only ai-review.md, so no consumer behaviour change.",
      "recommendation": "Narrow files to .claude/commands/ai-review.md in a separate ACR change if the package surface matters.",
      "blocking": false
    },
    {
      "id": "O2",
      "severity": "Info",
      "location": "scripts/baseline-health.sh; manifest.json acr_receipt",
      "evidence": "baseline-health exit 2, nothing verified; ACR covered 2000/15960 lines with 13 files withheld; standards/ (15 files) and _review-gate-classify/merge, _secret-snapshot.py not reported reviewed by any domain.",
      "recommendation": "State coverage limits in the report; no defect claimed.",
      "blocking": false
    }
  ],
  "rationale": "Packet recomputed byte-identical to the gate's canonical patch and fingerprint verified via commit_review_fingerprint. M1 revised to Low/non-blocking (not in packet; HEAD contract valid; advisory hook). S1 and S2 are floor-High but pre-existing in merged code and not widened (deny 8->16, none removed; twin parity matched on 9 probes after retracting a WSL-bash probe artifact); non-blocking per CODE-REVIEW.md:102 and must be reported to the user at once with Fix as the only disposition. No finding remains blocking."
}
```
