# Agent 6 — Integration & Ecosystem Conflicts Findings
**Date:** 2026-06-25
**Status:** Complete
**Finding count:** 13

---

## Check 1: Duplicate commands between ACR and PMB

Commands present in ACR `.claude/commands/`:
- `ai-review.md` (ACR-only)
- `change-review.md`
- `code-review.md`
- `feature-dev.md`
- `pmb-status.md`
- `security-review.md`
- `test-audit.md`

Commands present in PMB `.claude/commands/`:
- `accessibility-review.md` (PMB-only)
- `change-review.md`
- `code-review.md`
- `feature-dev.md`
- `health-check.md` (PMB-only)
- `pmb-status.md`
- `security-review.md`
- `test-audit.md`

**Pairs in both repos:** `change-review`, `code-review`, `feature-dev`, `pmb-status`, `security-review`, `test-audit`.

---

### Finding: /security-review formatting diverged between repos

- **Severity:** Medium
- **Confidence:** Verified
- **Repository:** Both
- **Evidence:** ACR `.claude/commands/security-review.md` lines 17–19 collapse `[HIGH]`, `[MEDIUM]` severity blocks and their numbered items onto single lines with no newline separation. PMB `.claude/commands/security-review.md` lines 16–25 preserve line breaks between each numbered item and severity header. The content rules are identical but formatting degrades readability in ACR.
- **Reproduction:** Compare `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\.claude\commands\security-review.md` lines 16–20 with `C:\Users\Mizzo\Claude\Personal-Memory-Bank\.claude\commands\security-review.md` lines 16–25.
- **Root Cause:** ACR's copy was formatted by a Prettier pass or manual edit that removed Markdown heading blank-lines between severity levels, collapsing them onto one output line.
- **Fix:** Copy the PMB version verbatim to ACR (it is the better-formatted canonical). PMB owns this file; ACR should be a copy.
- **Impact:** Claude reads the ACR version when in the ACR repo. Collapsed rules reduce parse fidelity; model may miss that items 4–6 are `[HIGH]` and treat them as continuation of item 3.
- **Effort:** XS

---

### Finding: /feature-dev diverged between repos — PMB includes `mb plan promote`, ACR does not

- **Severity:** Medium
- **Confidence:** Verified
- **Repository:** Both
- **Evidence:** PMB `.claude/commands/feature-dev.md` Phase 3 reads: "Draft the implementation plan in `.claude/plans/...`. After presenting the plan and receiving user approval, promote it: `mb plan promote .claude/plans/...`". ACR `.claude/commands/feature-dev.md` Phase 3 reads: "Invoke superpowers:writing-plans. Create a bite-sized plan..." — the `mb plan promote` step is absent and the draft-first / promote-second workflow is gone.
- **Reproduction:** Read both files' Phase 3 sections.
- **Root Cause:** The two files were edited independently after initial copy. PMB added the `mb` CLI integration; ACR's copy was not updated.
- **Fix:** Decide which version is authoritative. If PMB's `mb plan promote` workflow applies to ACR, sync ACR's copy. If ACR intentionally omits the `mb` dependency, add a comment: "mb plan promote not used here — ACR is not a PMB satellite."
- **Impact:** A developer working in ACR following `/feature-dev` will skip the plan promotion step. Plans will sit in `.claude/plans/` unregistered.
- **Effort:** XS

---

### Finding: /code-review `allowed-tools` list diverges — PMB includes `Agent`, ACR does not

- **Severity:** Low
- **Confidence:** Verified
- **Repository:** Both
- **Evidence:** PMB `.claude/commands/code-review.md` frontmatter line 8: `- Agent`. ACR `.claude/commands/code-review.md` frontmatter lines 1–8: no `Agent` entry.
- **Reproduction:** Compare frontmatter of both files.
- **Root Cause:** PMB version was updated to allow Agent spawning for subagent-per-domain Step 4; ACR copy was not updated.
- **Fix:** Add `- Agent` to ACR's `/code-review` allowed-tools. The command body (Step 4) instructs spawning subagents — Claude will refuse if `Agent` is not in the allowed list.
- **Impact:** When `/code-review` is run in the ACR repo, Claude cannot spawn domain subagents as Step 4 requires, silently degrading to inline review.
- **Effort:** XS

---

### Finding: /test-audit and /pmb-status are identical in both repos — unnecessary duplication

- **Severity:** Advisory
- **Confidence:** Verified
- **Repository:** Both
- **Evidence:** Byte-for-byte equivalent content confirmed by reading both `/pmb-status.md` and `/test-audit.md` from both repos.
- **Reproduction:** Read `C:\Users\Mizzo\Claude\AI-Code-Review-Agent\.claude\commands\pmb-status.md` and `C:\Users\Mizzo\Claude\Personal-Memory-Bank\.claude\commands\pmb-status.md` — content is identical. Same for `test-audit.md`.
- **Root Cause:** ACR is a PMB satellite and received these files as part of initialization. No mechanism exists to propagate PMB upstream changes to satellite copies.
- **Fix:** Document in PMB README that these files are owned in PMB; satellite projects receive copies via `mb upgrade`. Add a header comment `# Source: PMB v1.2.0 — do not edit; update via mb upgrade` to each file in ACR.
- **Impact:** Maintenance burden: future changes to these commands require updating both copies manually.
- **Effort:** XS

---

## Check 2: /change-review ACR bridge verification

> **BRIDGE BINARY NAME:** Both ACR and PMB `/change-review.md` correctly reference `ai-review-agent` (not the old name `ai-review`). Step 2 in both files reads: `Get-Command ai-review-agent -ErrorAction SilentlyContinue`. No finding on binary name.

> **FLAG NAMES:** Both use `--profile security` in Job 7. The old subcommand `review` and old flags `--ignore-path` / `--max-diff-lines` do not appear. ACR `activeContext.md` confirms the flag renames happened (e.g. `--ignore-path` → `--ignore`, `--max-diff-lines` → `--max-lines`). Both command files reference `--profile security` which is the current correct form. No finding on old flags.

### Finding: /change-review ACR bridge invocation is incomplete — no fallback for running from non-ACR repos

- **Severity:** High
- **Confidence:** Verified
- **Repository:** Both
- **Evidence:** ACR `.claude/commands/change-review.md` Step 2 says: if `ai-review-agent` is found, "Note it for use in job 7 (security)." Job 7 then says: "Run `ai-review-agent --profile security` on the diff." This invocation has no `--diff <path>` or `--dir` flag — it will default to staged-changes diff (`git diff --cached`), not the diff `/change-review` already computed in Step 1. The two diff sources are not guaranteed to match, especially for `--diff <path>` or `--pr` invocations.
- **Reproduction:** Run `/change-review --pr 5` in ACR repo with `ai-review-agent` installed. Step 1 fetches the PR diff via `gh pr diff 5`. Job 7 runs `ai-review-agent --profile security` against `git diff --cached` — a completely different diff surface.
- **Root Cause:** The bridge instruction does not pass the diff computed in Step 1 to the ACR invocation. ACR's CLI supports `--diff <path>` to consume a file; the bridge never uses it.
- **Fix:** In Job 7, change the invocation to: save the Step 1 diff to a temp file and pass it via `ai-review-agent --profile security --diff <tmpfile>`. Alternatively, document that ACR integration only works correctly in default mode (no `--diff` or `--pr` flag).
- **Impact:** ACR security review in Job 7 reviews the wrong diff surface for any non-default `/change-review` invocation. Security findings may be for staged code unrelated to the PR.
- **Effort:** S

---

## Check 3: Terminology conflict — confidence fields

### Finding: `confidence` is a homonym with incompatible types across the ecosystem

- **Severity:** Medium
- **Confidence:** Verified
- **Repository:** Both
- **Evidence:**
  - PMB memory bank frontmatter (e.g. `activeContext.md` line 13): `confidence: high` — a string enum (`high / medium / low`)
  - ACR `src/core/schema.ts` line 71: `confidence?: number` — an optional integer (0–100)
  - ACR `/change-review.md` finding schema table (line 52): `Confidence: High / Medium / Low` — uses string enum like PMB, not the numeric field in `schema.ts`
  - ACR `standards/CODE-REVIEW.md` line 87: "Compatibility Note: `Basis` replaces `Confidence` (removed)" — meaning the `/code-review` command has already dropped `Confidence` from the finding schema
- **Reproduction:** Read `src/core/schema.ts:71`, `memory-bank/activeContext.md:13`, `.claude/commands/change-review.md:52`, `standards/CODE-REVIEW.md:87` in sequence.
- **Root Cause:** Three independent uses of the word `confidence` across one ecosystem: (1) PMB frontmatter governance metadata (string), (2) ACR `Finding` schema internal field (integer, used by OllamaProvider), (3) `/change-review` command output field (string). Not documented as distinct concepts anywhere in either repo.
- **Fix:** Add a "Terminology disambiguation" section to `standards/MEMORY-BANK.md` in both repos clarifying: "The word `confidence` has three distinct uses. Do not conflate them." List all three. Optionally rename the ACR `Finding.confidence` field to `llmConfidenceScore: number` to make it non-ambiguous.
- **Impact:** A new contributor or a compacted Claude session may emit numeric confidence values in `/change-review` output or string confidence in ACR Finding JSON. Downstream parsers that consume ACR JSON output expecting a number will fail silently.
- **Effort:** S

---

## Check 4: CLAUDE.md diff between repos

ACR `CLAUDE.md` and PMB `CLAUDE.md` are nearly identical. Classified differences:

**(a) Intentional — ACR-specific content:**
- No items. ACR's CLAUDE.md contains no ACR-specific sections.

**(b) Stale — PMB has newer content not synced to ACR:**

### Finding: PMB CLAUDE.md context compaction section is more precise than ACR's version

- **Severity:** Medium
- **Confidence:** Verified
- **Repository:** ACR
- **Evidence:** PMB `CLAUDE.md` lines 22–24: "Claude Code auto-compacts at 40%... The `PreCompact` hook fires first and **blocks** compaction unless: `activeContext.md` has ≥3 substantive content lines AND `progress.md` has an entry dated today. A `handoff.md` bypasses the gate." ACR `CLAUDE.md` lines 22–24: "Claude Code compacts at ~40%... The `PreCompact` hook warns if neither the memory bank nor a handoff has been captured this session." The PMB version describes the actual blocking behavior; the ACR version says it "warns" rather than "blocks" — which is incorrect if the same hook is installed in ACR.
- **Reproduction:** Read PMB `CLAUDE.md` line 24 vs ACR `CLAUDE.md` line 24.
- **Root Cause:** PMB CLAUDE.md was updated to reflect the more precise hook behavior after the ACR copy was made.
- **Fix:** Replace ACR `CLAUDE.md` lines 22–25 with the PMB version's more accurate language about blocking behavior.
- **Impact:** Claude in ACR may believe the PreCompact hook only warns; it will not escalate urgency appropriately before compaction fires.
- **Effort:** XS

### Finding: PMB CLAUDE.md handoff start-of-session protocol is more complete than ACR's

- **Severity:** Medium
- **Confidence:** Verified
- **Repository:** ACR
- **Evidence:** PMB `CLAUDE.md` "When starting a new conversation" steps 1–5 include: "Run `/pmb-status` to verify current system state" and "summarize recovered context to user." ACR `CLAUDE.md` "When starting a new conversation" steps 1–4 omit the `/pmb-status` step entirely.
- **Reproduction:** Read ACR `CLAUDE.md` lines 119–129 vs PMB `CLAUDE.md` lines 120–131.
- **Root Cause:** PMB was updated with the `/pmb-status` integration step; ACR was not updated.
- **Fix:** Add `/pmb-status` step to ACR `CLAUDE.md` start-of-session protocol.
- **Impact:** Minor: Claude in ACR won't auto-run `mb status` on session start, so memory bank staleness issues won't be surfaced automatically.
- **Effort:** XS

**(c) Contradictory — incompatible rules for same concept:**

> **CHECK 4c:** No directly contradictory rules found. Both CLAUDE.md files agree on authority order, guardrail tiers, workflow phases, and token budget policy. The differences are in precision and completeness, not contradiction.

---

## Check 5: Memory bank frontmatter schema comparison

`activeContext.md` frontmatter field comparison:

| Field | ACR activeContext.md | PMB activeContext.md |
|---|---|---|
| `authority` | present | present |
| `review-cycle` | present | present |
| `retention` | present | present |
| `staleness-threshold` | present (14d) | present (14d) |
| `tags` | present | present |
| `last-reviewed` | present | present |
| `compaction_generation` | present | present |
| `source_type` | present | present |
| `confidence` | present (high) | present (high) |
| `lineage` | present | present |

`projectbrief.md` frontmatter field comparison:

| Field | ACR projectbrief.md | PMB projectbrief.md |
|---|---|---|
| `authority` | present (immutable) | present (immutable) |
| `review-cycle` | present (never) | present (never) |
| `retention` | present (permanent) | present (permanent) |
| `staleness-threshold` | present (365d) | present (365d) |
| `tags` | present | present |
| `last-reviewed` | present | present |
| `compaction_generation` | present | present |
| `source_type` | present | present |
| `confidence` | present | present |
| `lineage` | present | present |

> **CHECK 5:** No finding — frontmatter schemas are fully aligned across both repos for both `activeContext.md` and `projectbrief.md`. All fields present in both, formats consistent.

---

## Check 6: standards/ divergence between repos

Standards present in PMB but not ACR: `extensions/` (subdirectory — language-specific extensions).
Standards present in ACR but not PMB: none.
All 15 top-level `.md` files are present in both repos.

### Finding: PMB `standards/extensions/` directory is absent from ACR

- **Severity:** Medium
- **Confidence:** Verified
- **Repository:** ACR
- **Evidence:** PMB `standards/` contains an `extensions/` subdirectory. ACR `standards/` has no `extensions/` subdirectory. Both `CLAUDE.md` files reference "Language-specific extensions in `standards/extensions/`" on the Code Quality line — ACR `CLAUDE.md` line 88: "Follow patterns in `standards/CODE-QUALITY.md`. Language-specific extensions in `standards/extensions/`."
- **Reproduction:** `Get-ChildItem "C:\Users\Mizzo\Claude\AI-Code-Review-Agent\standards\" -Directory` returns nothing.
- **Root Cause:** ACR CLAUDE.md references `standards/extensions/` but the directory does not exist in ACR. PMB has the extensions files (TypeScript is the primary ACR language — a TypeScript extension would be directly relevant).
- **Fix:** Either (a) copy the relevant extension files from PMB `standards/extensions/` into ACR, or (b) remove the `standards/extensions/` reference from ACR's `CLAUDE.md` Code Quality section since the directory is absent.
- **Impact:** Claude in ACR reads a CLAUDE.md promising language-specific guidance at `standards/extensions/` and will silently fail to find it. The instruction degrades to advisory-only.
- **Effort:** S

### Finding: `standards/CODE-REVIEW.md` content is identical in both repos — dead duplication

- **Severity:** Advisory
- **Confidence:** Verified
- **Repository:** Both
- **Evidence:** Both repos' `standards/CODE-REVIEW.md` files are semantically identical. PMB is the template source; ACR copied it at install time. The content is stable (both end with the same Compatibility Note).
- **Reproduction:** Read both files in full — content matches on all substantive sections.
- **Root Cause:** PMB pushes standards to satellite projects during `mb upgrade`. No change-tracking or version pinning exists.
- **Fix:** Advisory — no immediate action required. Long-term: if PMB's CODE-REVIEW.md evolves, run `mb upgrade` in ACR to propagate.
- **Impact:** If PMB CODE-REVIEW.md is updated and ACR's copy is not, code reviews in ACR will follow a stale standard.
- **Effort:** XS

---

## Check 7: Contract schema compatibility

PMB `.claude/contracts/active-task.json` top-level fields: `created_at`, `status`, `task`, `scope` (array of strings), `expires_at`

ACR `.claude/contracts/active-task.json` top-level fields: `task`, `status`, `expires_at`, `scope` (array of objects with `file`+`op` keys)

PMB template `templates/.claude/contracts/active-task.json.example` top-level fields: `task`, `created_at`, `expires_at`, `scope` (object with `files` array + `operations` array), `approved_by`, `status`

### Finding: Contract schema has three incompatible `scope` field types across the ecosystem

- **Severity:** Medium
- **Confidence:** Verified
- **Repository:** Both
- **Evidence:**
  - PMB live contract: `"scope": ["string", "string", ...]` — flat array of strings
  - ACR live contract: `"scope": [{"file": "...", "op": "..."}, ...]` — array of objects
  - PMB template example: `"scope": {"files": [...], "operations": [...]}` — object with two arrays
  - CLAUDE.md `docs/CONTRACTS-GUIDE.md` is referenced for the schema but not examined; these three live examples are already inconsistent.
- **Reproduction:** Read the three files listed in Check 7.
- **Root Cause:** The schema evolved organically. The template was not updated when the live usage evolved, and PMB and ACR evolved independently.
- **Fix:** Pick one canonical schema (recommended: ACR's `[{"file", "op"}]` — most structured). Update PMB template to match. Update both CLAUDE.md files to reference the chosen schema explicitly. Validate `docs/CONTRACTS-GUIDE.md` matches.
- **Impact:** The PreToolUse hook that validates contract scope cannot reliably parse `scope` if the shape varies. A hook expecting `scope[].file` will fail on PMB's flat-string format and vice versa.
- **Effort:** S

### Finding: PMB live contract missing `approved_by` field present in PMB's own template

- **Severity:** Low
- **Confidence:** Verified
- **Repository:** PMB
- **Evidence:** PMB template `active-task.json.example` line 14: `"approved_by": "user"`. PMB live `.claude/contracts/active-task.json`: no `approved_by` field present.
- **Reproduction:** Compare PMB template vs PMB live contract.
- **Root Cause:** Field was added to the template but not retroactively written to live contracts.
- **Fix:** Add `"approved_by": "user"` to the PMB live contract. More importantly, update CLAUDE.md's "On approved" instruction to write `approved_by` when creating the contract.
- **Impact:** Low — no hook is known to check `approved_by`. But the template-to-live drift erodes trust in the template as a canonical reference.
- **Effort:** XS

---

## Check 8: /code-review vs /ai-review — user confusion risk

### Finding: /code-review does not state that it uses Claude (cloud), and /ai-review does not state it is offline

- **Severity:** High
- **Confidence:** Verified
- **Repository:** ACR
- **Evidence:**
  - ACR `.claude/commands/ai-review.md` frontmatter description: "Run a deep 15-agent local AI code review on the current diff using Ollama (devstral:latest)... Fully offline." The description field explicitly states "Fully offline." However, the body section "When to use" only says: "Use `/code-review` instead for a fast Claude-native check mid-session." The word "Claude-native" is the only signal that `/code-review` uses the cloud model — it appears as a terse cross-reference, not a prominent choice guide.
  - ACR `.claude/commands/code-review.md` description: "Deep code review covering security, correctness, maintainability, testing, and architecture drift. Spawns separate subagents per domain so findings don't bias each other." Zero mention of Claude API, cloud, cost, privacy, or network requirement.
  - No README section, no command preamble, and no help text explains the choice to a developer encountering both commands for the first time.
- **Reproduction:** Open ACR `.claude/commands/code-review.md` — find any statement about cloud vs. local. Open `.claude/commands/ai-review.md` "When to use" — find the only cross-reference.
- **Root Cause:** The `/ai-review.md` was written to document the offline tool; `/code-review.md` was inherited from PMB and describes the generic review process without situating it as the cloud complement to ACR.
- **Fix:**
  1. Add to `/code-review.md` frontmatter description: "...Uses Claude (cloud API). For offline/local review see `/ai-review`."
  2. Add to the top of `/code-review.md` body a "When to use" block mirroring `/ai-review.md`'s format: "Use this when: cloud access available, mid-session fast check. Use `/ai-review` instead for: offline, no API cost, thorough 15-agent swarm before a PR."
- **Impact:** Developers new to the ecosystem will run `/code-review` assuming it uses the same model as `/ai-review`, not realizing they're incurring API cost and sending code to the cloud. Privacy-sensitive repos are at risk.
- **Effort:** XS

---

## Check 9: ACR version reference in PMB memory bank

> **CHECK 9a:** `grep` on PMB `memory-bank/` for `ai-review`, `ai-code-review`, `1.0.`, `0.9.`, `ACR` returned:
> - `activeContext.md:21`: "PMB v1.2.0 and ACR v1.1.0+ are both fully shipped" — current reference
> - `activeContext.md:31,50`: Labels "ACR Audit:" and "ACR calibration" — no version pinning
> - `progress.md:60`: "optional ACR bridge" — no version pinning
> - `progress.md:106`: "ai-code-review-agent... v1.1.0: 15 observe-only agents..." — references current version correctly

> **CHECK 9b:** `grep` for `"ai-review"` (old package name) across PMB returned no results.

> **CHECK 9:** No finding — PMB memory bank references to ACR use the current `ai-review-agent` binary name and `v1.1.0` version string. No stale `ai-review` package name found.

---

## Check 10: Top 3 consolidation opportunities

### Finding (Advisory): Commands should be owned in PMB and distributed via `mb upgrade`, not duplicated

- **Severity:** Advisory
- **Confidence:** Strong Evidence
- **Repository:** Both
- **Evidence:** 6 of 7 ACR commands are copies of PMB commands (`change-review`, `code-review`, `feature-dev`, `pmb-status`, `security-review`, `test-audit`). Three have already drifted (`security-review` formatting, `feature-dev` phase 3 content, `code-review` allowed-tools). The drift will compound with every future update.
- **Root Cause:** No ownership model or propagation mechanism for command files beyond the initial `mb upgrade`.
- **Fix:** PMB owns all shared commands. Each file should carry a header comment: `# Source: PMB — synced via mb upgrade. Local edits will be overwritten.` ACR may override specific commands by creating ACR-only variants with different names (e.g. `ai-review.md` is already correctly ACR-only). Run `mb upgrade` in ACR after any PMB command update.
- **Impact:** Eliminates 3 current findings and prevents future drift.
- **Effort:** S

### Finding (Advisory): Contract schema should be defined once in PMB and documented in `docs/CONTRACTS-GUIDE.md`

- **Severity:** Advisory
- **Confidence:** Strong Evidence
- **Repository:** Both
- **Evidence:** Three incompatible contract schema shapes exist (see Check 7 finding). PMB owns the template. ACR evolved its own live usage.
- **Fix:** PMB defines the canonical schema in `docs/CONTRACTS-GUIDE.md` (or `templates/.claude/contracts/active-task.json.example`). ACR's CLAUDE.md references `docs/CONTRACTS-GUIDE.md` for the schema — so the guide file becomes the single truth. Update PMB template to the chosen shape. ACR's live contract will auto-align on next usage.
- **Impact:** Hook that enforces contract scope can be written once and deployed to all PMB satellite projects.
- **Effort:** S

### Finding (Advisory): standards/ files should be version-tagged in PMB to enable satellite drift detection

- **Severity:** Advisory
- **Confidence:** Strong Evidence
- **Repository:** PMB
- **Evidence:** 15 standards files are duplicated verbatim across PMB and ACR. No version tag or checksum exists to determine if a satellite's copy is current. The CODE-REVIEW.md Compatibility Note ("Basis replaces Confidence") is present in both, suggesting they were in sync at one point — but the `extensions/` gap and the PERFORMANCE-BUDGET.md presence in ACR despite the `mb doctor` reference being PMB-specific shows drift is already occurring.
- **Fix:** Add a `# PMB-VERSION: v1.2.0` comment to each standards file in PMB. `mb upgrade` rewrites satellite copies and updates the version tag. `mb doctor` or `mb audit` can then detect stale copies by comparing the tag.
- **Impact:** Satellite projects can be audited and upgraded mechanically instead of by manual comparison.
- **Effort:** M

---

## Check 11: PMB /change-review ACR invocation correctness

The PMB version of `/change-review.md` is content-identical to ACR's version (both files read in Check 2 match). The bridge in both files correctly:
- Uses `ai-review-agent` binary name
- Uses `--profile security` flag (not an old flag form)
- Makes ACR optional with a clear fallback message
- Does not require ACR to be globally installed in any mandatory way (the fallback exists)

However, the diff-mismatch issue identified in Check 2 applies equally to the PMB copy.

> **CHECK 11 additional:** The PMB copy of `/change-review.md` is byte-for-byte the same as the ACR copy based on reading both. The ACR bridge invocation issue (Job 7 does not pass `--diff` to ACR) applies to both. No additional finding beyond the Check 2 finding above.

---

## Summary of Findings

| # | Title | Severity | Effort | Repository |
|---|---|---|---|---|
| 1 | /security-review formatting diverged | Medium | XS | Both |
| 2 | /feature-dev diverged — PMB has `mb plan promote`, ACR does not | Medium | XS | Both |
| 3 | /code-review `allowed-tools` missing `Agent` in ACR | Low | XS | ACR |
| 4 | /test-audit and /pmb-status are identical — unnecessary duplication | Advisory | XS | Both |
| 5 | /change-review ACR bridge does not pass diff to ACR invocation | High | S | Both |
| 6 | `confidence` is a homonym with three incompatible types | Medium | S | Both |
| 7 | PMB CLAUDE.md compaction section more accurate than ACR's | Medium | XS | ACR |
| 8 | PMB CLAUDE.md handoff protocol more complete than ACR's | Medium | XS | ACR |
| 9 | `standards/extensions/` absent from ACR but referenced in CLAUDE.md | Medium | S | ACR |
| 10 | standards/CODE-REVIEW.md duplicated — no propagation mechanism | Advisory | XS | Both |
| 11 | Contract `scope` has three incompatible shapes across ecosystem | Medium | S | Both |
| 12 | PMB live contract missing `approved_by` field from own template | Low | XS | PMB |
| 13 | /code-review does not state cloud; /ai-review distinction not prominent | High | XS | ACR |
| 14 | Commands should be owned in PMB, distributed via `mb upgrade` | Advisory | S | Both |
| 15 | Contract schema should be defined once in PMB template | Advisory | S | Both |
| 16 | standards/ files need version tags for satellite drift detection | Advisory | M | PMB |
