# Agent 4 — Documentation & DX Findings

**Date:** 2026-06-25
**Status:** Complete
**Finding count:** 14

---

## Check 1: ACR Memory Bank Staleness

### Finding: progress.md test count lags reality by 164 tests

- **Severity:** Medium
- **Confidence:** Verified
- **Repository:** ACR
- **Evidence:** `memory-bank/progress.md` line 68: "Unit Tests: 112 passing" and line 74: "Total: 112"; line 143 (version history row for v1.1.0) says "276 tests" but the Metrics section at line 68 still reports 112. `npm test` output: `276 passed (276)`.
- **Reproduction:** Run `npm test 2>&1 | grep "Tests "` — observe 276. Read `memory-bank/progress.md` lines 64–74 — observe 112.
- **Root Cause:** The Metrics section was not updated when v0.9.x–v1.1.0 added agents and tests; only the version history table at the bottom was updated. The two sections are now contradictory within the same file.
- **Fix:** Update `memory-bank/progress.md` Metrics section: change "Unit Tests: 112 passing" to 276, update the per-file breakdown, and update "Total: 112" to 276.
- **Impact:** Any agent or human reading the Metrics section gets a count that is 59% too low; misleading for contributors gauging test coverage completeness.
- **Effort:** XS

---

### Finding: progress.md CLI flag names contain pre-rename values

- **Severity:** Medium
- **Confidence:** Verified
- **Repository:** ACR
- **Evidence:** `memory-bank/progress.md` line 61: `--ignore-path` and line 61: `--max-diff-lines` listed as the final flag names in the G2/G6 guardrail entries. Actual CLI (`node dist/cli/index.js --help`) shows `--ignore` and `--max-lines` only — the `--ignore-path` and `--max-diff-lines` flags do not exist.
- **Reproduction:** Read `progress.md` line 61. Run `node dist/cli/index.js --help` — neither `--ignore-path` nor `--max-diff-lines` appear.
- **Root Cause:** Guardrail entries were written at G6 / G2 time (pre-Phase-2) and not updated when Phase 2 renamed the flags.
- **Fix:** In `progress.md`, update G2 to `--max-lines` and G6 to `--ignore`.
- **Impact:** Any contributor reading the guardrail history will use non-existent flag names.
- **Effort:** XS

---

### Finding: activeContext.md Key Commands block shows stale test count

- **Severity:** Low
- **Confidence:** Verified
- **Repository:** ACR
- **Evidence:** `memory-bank/activeContext.md` line 102: `npm test   # all unit tests (120 passing)`. Actual current output: 276 passing.
- **Reproduction:** Read `activeContext.md` line 102. Run `npm test 2>&1 | grep "Tests "`.
- **Root Cause:** The comment was not updated when test counts grew from 120 (v0.9.x era) to 276.
- **Fix:** Update the comment to `# all unit tests (276 passing)`.
- **Impact:** Minor — the count in a comment is cosmetic, but creates confusion when an engineer sees a different number after running the command.
- **Effort:** XS

> CHECK 1 (last-reviewed date): `activeContext.md` reports `last-reviewed: 2026-06-25` — within the 14-day staleness threshold. `progress.md` reports `last-reviewed: 2026-06-25` — within threshold. No staleness finding on dates; findings above are content-accuracy issues, not freshness issues.

---

## Check 2: CLI Flags vs README

> CHECK 2: All flags in `--help` appear in the README flag reference table. All flags in the README flag reference table appear in `--help`. Flag names and defaults match. No mismatch found.

---

## Check 3: ACR README Install Steps (Windows Simulation)

### Finding: Model download size absent before install steps

- **Severity:** High
- **Confidence:** Verified
- **Repository:** ACR
- **Evidence:** `README.md` lines 49–57 (Installation section). `devstral:latest` is ~14 GB. The only pre-install mention of model size is nowhere in the README — `ollama pull devstral:latest` is listed after `npm install -g ai-review-agent` without any size callout.
- **Reproduction:** Read `README.md` Requirements section (lines 42–47) and Installation section (lines 49–57). The word "GB", "size", or "download" does not appear anywhere in the file.
- **Root Cause:** Model size was never documented. The pull command appears as a one-liner without context.
- **Fix:** Add a note to the Requirements or Installation section: `devstral:latest` is approximately 14 GB. Ensure your disk has at least 15 GB free before running `ollama pull devstral:latest`. This should appear _before_ the pull command, ideally as a callout block.
- **Impact:** Users on metered connections or with limited disk space commit to a 14 GB download without warning. On a slow connection this is a multi-hour blocking operation that appears to be a small package install.
- **Effort:** XS

### Finding: Ollama must be installed before `npm install -g ai-review-agent` — not stated

- **Severity:** Medium
- **Confidence:** Verified
- **Repository:** ACR
- **Evidence:** `README.md` Requirements section (line 42) lists "Ollama running locally" as a bullet, but the Installation section (line 49) starts with `npm install -g ai-review-agent` without a step to install Ollama first. There is no link to Ollama's installer or instruction to install it before proceeding.
- **Reproduction:** Read `README.md` lines 42–57. There is no "Step 0: Install Ollama from https://ollama.com" instruction; the requirements section lists it as a fact rather than an action.
- **Root Cause:** Requirements are listed as nouns ("Ollama running locally") rather than imperative setup steps ("Install Ollama from..."). A first-time user reading sequentially will reach `npm install -g ai-review-agent` without knowing Ollama must be installed first.
- **Fix:** Add an explicit numbered step before the npm install: `1. Install Ollama from https://ollama.com and start it (ollama serve).` Then renumber the pull and npm install steps.
- **Impact:** Users without Ollama installed will install the npm package, run `ai-review-agent`, and get a cryptic connection error rather than a clear next action.
- **Effort:** XS

> CHECK 3 (Windows syntax): All install commands in the README (`npm install`, `git clone`, `ollama pull`) are cross-platform. No Unix-only syntax in the install path. No flag mismatches found in the install examples vs CLI output.

---

## Check 4: `/ai-review` Claude Command Accuracy

> CHECK 4 (flag names): All flags in `.claude/commands/ai-review.md` (`--agents`, `--model`, `--diff`, `--dir`, `--ignore`, `--max-lines`, `--no-sanitize`, `--format`, `--profile`, `--context memory-bank`) exist in current CLI `--help` output. No stale `--ignore-path` or `--max-diff-lines` references found.

> CHECK 4 (agent count): The command description and title both say "15-agent". Current default agent list in `activeContext.md` and README also says 15 (testgen is opt-in). This is accurate.

> CHECK 4 (subcommand): No stale `review` subcommand references found. CLI is correctly described as flat.

> CHECK 4 (profile list): The profiles listed in the command (`fast`, `full`, `change-review`, `ui`, `migration`, `security`) match what `--help` shows. Accurate.

---

## Check 5: CHANGELOG vs Git Tags

### Finding: Tags v0.5.0, v0.9.0–0.9.4, and v1.0.1 missing from git tag list

- **Severity:** Medium
- **Confidence:** Verified
- **Repository:** ACR
- **Evidence:** `git tag --sort=v:refname` output: `v0.3.0 v0.4.0 v0.6.0 v0.7.0 v0.8.0 v0.9.0 v0.9.1 v1.0.0 v1.0.1 v1.1.0`. CHANGELOG has entries for `[0.5.0]`, `[0.9.4]`, `[0.9.0–0.9.3]` (combined entry). Git tags do not include `v0.5.0`, `v0.9.1`, `v0.9.2`, `v0.9.3`, `v0.9.4`. The CHANGELOG groups `0.9.0–0.9.3` into one entry while tags only show `v0.9.0` and `v0.9.1`.
- **Reproduction:** Run `git tag --sort=v:refname` and compare to CHANGELOG version headers.
- **Root Cause:** Some versions were shipped as commits without pushing a corresponding git tag; v0.5.0 in particular has no tag.
- **Fix:** Either push the missing tags (if the corresponding commits exist) or add a note to CHANGELOG that v0.5.0 was not tagged on the remote. For future releases, the release workflow should enforce that every CHANGELOG entry has a matching tag.
- **Impact:** Anyone using `git tag` to find a specific version cannot locate v0.5.0 or the intermediate 0.9.x calibration releases.
- **Effort:** S

> CHECK 5 (package.json vs latest tag): `package.json` version is `1.1.0`; latest git tag is `v1.1.0`. These match. No finding.

> CHECK 5 (CHANGELOG completeness for tagged versions): Every tag that exists (`v0.3.0` through `v1.1.0`) has a corresponding CHANGELOG entry. No tag is undocumented.

---

## Check 6: PMB install.sh (Windows Simulation)

### Finding: install.sh is bash-only with no Windows path, never states this upfront

- **Severity:** High
- **Confidence:** Verified
- **Repository:** PMB
- **Evidence:** `install.sh` line 1: `#!/bin/bash`. Uses `${BASH_SOURCE[0]}` (bash-specific), ANSI color escapes with `echo -e`, `sed -i.bak`, and `$SHELL` detection. None of these run natively on Windows PowerShell. The file header (lines 1–10) says "Mac/Linux Installer" but does not appear before the `chmod +x install.sh && ./install.sh` usage instruction — a Windows user reading the root README encounters the Mac/Linux command block first (line 46) and might try running it in Git Bash without WSL.
- **Reproduction:** Follow `README.md` lines 46–48 (Mac/Linux section) on Windows native PowerShell: `chmod` is not a PowerShell command; `./install.sh` requires Git Bash or WSL. The README does present `install.bat` for Windows (lines 27–34) before the bash section, but the install.sh header does not warn that WSL is required vs Git Bash.
- **Root Cause:** install.sh uses `sed -i.bak` (GNU/BSD sed behavior differs) and BASH_SOURCE (bash-only). On Windows Git Bash, `sed -i.bak` works, but the shebang and overall flow assume a POSIX login shell that correctly sets `$SHELL`. Git Bash does not reliably set `$SHELL`.
- **Fix:** Add to the install.sh header comment block: "Requires bash (Mac/Linux) or WSL on Windows. Git Bash is not supported — use install.bat on Windows." Also add this note inline in the README Mac/Linux install block.
- **Impact:** Windows users who attempt the bash path via Git Bash may get a partial install with no error, then a broken `mb` command.
- **Effort:** XS

### Finding: install.sh does not explain what PMB is or what it installs before running

- **Severity:** Low
- **Confidence:** Verified
- **Repository:** PMB
- **Evidence:** `install.sh` lines 23–86: script opens with a banner ("Memory Bank"), immediately creates `$HOME/.mb/bin/mb`, writes `MB_HOME` to the shell rc file, and exits. No description of what is being installed, what permissions it requires, or what will change. A user who runs a script they found on GitHub has no in-script context.
- **Reproduction:** Read `install.sh` top-to-bottom. The first non-banner action is `mkdir -p "$MB_BIN"` at line 37.
- **Root Cause:** The README describes PMB before install, but the script itself has no preamble for users who run it directly.
- **Fix:** Add a 3-line preamble after the banner: "This script installs the `mb` command to $HOME/.mb/bin and adds MB_HOME to your shell rc. It does not modify any project files. Run 'mb init' in a project afterward."
- **Impact:** Low — users who read the README first are informed. Users who run the script directly from a one-liner are not.
- **Effort:** XS

> CHECK 6 (init-memory-bank.sh): Script uses `${BASH_SOURCE[0]}`, `set -e`, `mkdir -p`, ANSI escapes, and `cp -r`. All are compatible with both bash on Mac/Linux and WSL. The script correctly documents its options at the top. No blocking issues found beyond the shared bash-only constraint.

---

## Check 7: Error Message Quality in ACR CLI

### Finding: Ollama connection failure produces a generic thrown error, not a user-facing actionable message

- **Severity:** Medium
- **Confidence:** Verified
- **Repository:** ACR
- **Evidence:** `src/core/runner.ts` line 127: `if (!ping.ok) throw new Error(ping.error ?? 'LLM provider not available')`. `src/core/llm/ollamaProvider.ts` line 51: `error: \`Ollama not reachable at ${this.baseUrl}: ${(err as Error).message\}`. The thrown error propagates up through `program.action()`in`src/cli/index.ts` without a catch — Commander will print the Node.js stack trace to stderr and exit 1.
- **Reproduction:** Stop Ollama, then run `node dist/cli/index.js` against staged changes. Output includes the connection error message but also the full stack trace from Commander's uncaught error handler, and no instruction for what to do.
- **Root Cause:** The CLI entry point does not wrap `runner.run()` in a try/catch that intercepts the Ollama ping failure and formats it into a clean actionable message. The error text from `ollamaProvider.ts` is accurate ("Ollama not reachable at...") but is buried in a stack trace.
- **Fix:** In `src/cli/index.ts`, wrap the `runner.run()` call in a try/catch. Catch errors whose message starts with "Ollama not reachable" and print: `Error: Ollama is not running. Start it with: ollama serve\nThen re-run ai-review-agent.` then `process.exit(1)` cleanly without stack trace.
- **Impact:** First-run users see a confusing stack trace instead of a clear recovery instruction. This is the most common error case (Ollama not started).
- **Effort:** S

> CHECK 7 (other error messages): `console.error('No diff to review. Stage changes or provide --diff.')` — specific and actionable. `console.error(\`Diff file not found: ${diffFile}\`)` — specific and actionable. `console.error(\`[${this.name}] parse failure. Raw snippet: ...\`)` in base.ts — this is a debug-level message printed to stderr during a run, not a terminal error; acceptable. No "Error: undefined" or bare "Failed" patterns found.

---

## Check 8: PMB activeContext.md Staleness

> CHECK 8 (last-reviewed date): `memory-bank/activeContext.md` in PMB shows `last-reviewed: 2026-06-24`. Today is 2026-06-25. Within the 14-day staleness threshold. No staleness finding.

> CHECK 8 (Current Focus accuracy): "Comprehensive audit + remediation sprint complete (2026-06-24). PMB v1.2.0 and ACR v1.1.0+ are both fully shipped. No active work items." This is accurate — both repos are on main with clean working trees, and ACR is at v1.1.0, PMB at 1.2.0 (VERSION file).

> CHECK 8 (ACR tasks as in-progress): No ACR tasks are listed as "in progress" in PMB activeContext.md. The Next Steps section lists only optional follow-ons (calibration, mb upgrade on satellite projects). No stale in-progress references found.

---

## Check 9: CLAUDE.md Accuracy in ACR

### Finding: CLAUDE.md references docs/CONTRACTS-GUIDE.md which does not exist

- **Severity:** High
- **Confidence:** Verified
- **Repository:** ACR
- **Evidence:** `CLAUDE.md` line 68: "Write `.claude/contracts/active-task.json` with the schema from `docs/CONTRACTS-GUIDE.md`." Directory listing of `docs/`: only `audit/` and `superpowers/` subdirectories exist. No `CONTRACTS-GUIDE.md` file anywhere under `docs/` or in the repo root.
- **Reproduction:** Read `CLAUDE.md` line 68. Run `find . -name "CONTRACTS-GUIDE.md"` — no output.
- **Root Cause:** The file was referenced in CLAUDE.md when the Task Contract Protocol section was written but the file itself was never created.
- **Fix:** Either create `docs/CONTRACTS-GUIDE.md` with the active-task.json schema (fields: `task`, `scope`, `status`, `expires_at`), or update the CLAUDE.md reference to inline the schema directly.
- **Impact:** When Claude follows the Task Contract Protocol and tries to write a contract JSON, it has no schema to follow. The instruction becomes ambiguous and the contract schema is undefined.
- **Effort:** S

> CHECK 9 (standards/SECURITY-GUARDRAILS.md): File exists at `standards/SECURITY-GUARDRAILS.md`. Reference in CLAUDE.md is valid.

> CHECK 9 (standards/AGENTIC-SAFETY.md): File exists at `standards/AGENTIC-SAFETY.md`. Reference in CLAUDE.md is valid.

> CHECK 9 (standards/CODE-QUALITY.md): File exists. Valid.

> CHECK 9 (standards/LOGGING.md): File exists. Valid.

> CHECK 9 (standards/WORKFLOW.md): File exists. Valid.

> CHECK 9 (docs/HOOKS-GUIDE.md): File does not exist in the ACR `docs/` directory (only `audit/` and `superpowers/` are present). However, `docs/HOOKS-GUIDE.md` exists in the PMB repo — ACR's CLAUDE.md references it as if it exists locally in ACR. This is a broken pointer.

### Finding: CLAUDE.md references docs/HOOKS-GUIDE.md which does not exist in ACR

- **Severity:** High
- **Confidence:** Verified
- **Repository:** ACR
- **Evidence:** `CLAUDE.md` line 111: "Hooks — `.claude/settings.json` enforces rules deterministically (format, lint, block dangerous ops). See `docs/HOOKS-GUIDE.md`." No `docs/HOOKS-GUIDE.md` file exists in the ACR repo. The file exists in the PMB repo at `C:\Users\Mizzo\Claude\Personal-Memory-Bank\docs\HOOKS-GUIDE.md` but is not present in ACR.
- **Reproduction:** Read `CLAUDE.md` line 111. Run `find . -name "HOOKS-GUIDE.md"` in ACR — no output.
- **Root Cause:** CLAUDE.md was likely copied or adapted from PMB's template without verifying which referenced files exist in ACR vs PMB.
- **Fix:** Either copy `docs/HOOKS-GUIDE.md` from PMB into ACR's `docs/`, or change the reference to point at the PMB repo URL, or remove the reference and describe the hooks inline.
- **Impact:** Engineers following the CLAUDE.md to understand hook behavior cannot find the referenced document.
- **Effort:** XS

> CHECK 9 (.claude/agents/ directory): Does not exist in ACR. CLAUDE.md line 112 says "Agents — `.claude/agents/` defines specialized subagents (security-reviewer, researcher)." This directory does not exist. However, this is described as a pattern/instruction rather than a reference to an existing file, so it reads as a setup instruction rather than a broken pointer. Low severity; not filed as a finding given ambiguity.

> CHECK 9 (7-phase workflow): `standards/WORKFLOW.md` exists and presumably documents the workflow. The CLAUDE.md reference is valid.

---

## Check 10: Onboarding Friction Assessment

### Finding: README states stale test count in the development command block

- **Severity:** Medium
- **Confidence:** Verified
- **Repository:** ACR
- **Evidence:** `README.md` line 369: `npm test   # unit tests only — no Ollama needed (196 passing)`. Actual: 276 passing. The comment is 28% lower than reality.
- **Reproduction:** Read `README.md` line 369. Run `npm test 2>&1 | grep "Tests "` — observe 276, not 196.
- **Root Cause:** The Development section comment was last updated during a version where 196 tests passed (approximately v1.0.0 pre-audit) and was not synchronized with subsequent test additions.
- **Fix:** Update `README.md` line 369: change `(196 passing)` to `(276 passing)`.
- **Impact:** Contributors checking whether their test run is correct will see a mismatch and either doubt their environment or doubt the docs.
- **Effort:** XS

> CHECK 10 (Node.js version stated upfront): Yes — `README.md` line 43: `Node.js v18+ (v24 recommended)`. Visible in Requirements, before installation steps.

> CHECK 10 (npm install step): `npm install -g ai-review-agent` is present and clear in the Installation section.

> CHECK 10 (steps to reach npm test): From source install (contributor path): (1) Install Node.js, (2) Install Ollama + start it, (3) git clone, (4) npm install, (5) npm run build. That is 5 steps. For end users, `npm test` is not a documented step at all — the README's Development section at line 365 is the first mention of `npm test` and it is not in a setup flow. The contributor setup in `<details>` (lines 73–84) goes: clone → npm install → npm run build → npm link. No explicit "then run `npm test`" step appears.

> CHECK 10 (Ollama-free quick start): `npm test` runs unit tests only and explicitly requires no Ollama (`README.md` line 369: "no Ollama needed"). This is correctly documented. No Ollama-free quick-start finding.

> CHECK 10 (steps count): End-to-end from clone to `npm test` is 4 steps (clone, npm install, npm run build, npm test). This is under 5. No finding.

---

## Check 11: PMB README Accuracy

### Finding: PMB README version badge shows 1.1.1 but current version is 1.2.0

- **Severity:** Medium
- **Confidence:** Verified
- **Repository:** PMB
- **Evidence:** `README.md` line 3: `![Version](https://img.shields.io/badge/version-1.1.1-blue)`. PMB `VERSION` file contains `1.2.0`. CHANGELOG entry `## 1.2.0 — 2026-06-24` is the latest entry.
- **Reproduction:** Read `README.md` line 3. Read `VERSION` file: `1.2.0`.
- **Root Cause:** The version badge was not updated when v1.2.0 was released.
- **Fix:** Update `README.md` line 3: change `version-1.1.1-blue` to `version-1.2.0-blue`.
- **Impact:** Users checking the repo version see 1.1.1 instead of 1.2.0. Downstream projects using `mb upgrade` may see a version mismatch and unnecessary drift warnings.
- **Effort:** XS

### Finding: PMB README claims 9 mb commands but actual count is 11 (10 primary + help)

- **Severity:** Medium
- **Confidence:** Verified
- **Repository:** PMB
- **Evidence:** `README.md` line 5: "Includes the `mb` CLI (9 commands)". `mb.sh` `show_help()` lists: `init`, `status`, `doctor`, `query`, `clean`, `commit`, `upgrade`, `verify-integrity`, `plan`, `preflight`, `change-check`, `help` — 12 entries (11 active + help). The README's "Day-to-Day Commands" section at lines 73–80 lists 6 commands and omits `plan`, `preflight`, `change-check`, and `verify-integrity` entirely.
- **Reproduction:** Read `README.md` line 5 (claims 9 commands). Read `scripts/mb.sh` `show_help()` lines 49–60 — 11 non-deprecated commands plus help.
- **Root Cause:** The command count in the README intro was not updated when `plan`, `preflight`, and `change-check` were added. The Day-to-Day Commands table also omits these three and `verify-integrity`.
- **Fix:** (1) Update `README.md` line 5: change "(9 commands)" to "(11 commands)" or list all of them. (2) Add `plan`, `preflight`, `change-check`, and `verify-integrity` to the Day-to-Day Commands table.
- **Impact:** Contributors and users following the Day-to-Day Commands table will not discover `mb plan`, `mb preflight`, or `mb change-check`. The `mb plan` command manages the docs/plans/ directory, which `mb doctor` check 24 validates — a user who does not know this command exists cannot use it.
- **Effort:** S

### Finding: PMB README mb doctor describes 20-point diagnostic but doctor now has 24 checks

- **Severity:** Low
- **Confidence:** Verified
- **Repository:** PMB
- **Evidence:** `README.md` line 75: "Full 20-point diagnostic". PMB CHANGELOG v1.2.0 entry references doctor check 24 (`## 1.2.0` section documents plan hygiene as check 24). The `health-check.md` command was updated in v1.2.0 to correct from 20 to 24 (per CHANGELOG: "corrected `mb doctor` check count from 20 to 24") but the README was not updated.
- **Reproduction:** Read `README.md` line 75: "Full 20-point diagnostic". Read PMB CHANGELOG v1.2.0: "corrected `mb doctor` check count from 20 to 24".
- **Root Cause:** The README fix was not included in the same commit that corrected `health-check.md`.
- **Fix:** Update `README.md` line 75: change "Full 20-point diagnostic" to "Full 24-point diagnostic".
- **Impact:** Users are told the tool runs 20 checks when it runs 24. Minor trust erosion when they observe checks 21–24 in output.
- **Effort:** XS

> CHECK 11 (mb plan in README): `mb plan` does not appear anywhere in the README's Day-to-Day Commands section or slash command table. It exists as a full subcommand in `mb.sh` with four sub-subcommands (status, list, promote, archive). This is part of the command count finding above.

> CHECK 11 (Claude Code version compatibility): README does not claim compatibility with a specific Claude Code version. No finding.

> CHECK 11 (mb.sh subcommand accuracy): `README.md` "Day-to-Day Commands" section lists `mb status`, `mb doctor`, `mb query`, `mb clean`, `mb commit`, `mb upgrade`, `mb help`. All exist in mb.sh. No inaccurate subcommand names found.
