---
authority: accumulating
review-cycle: 30d
retention: archive-after-6m
staleness-threshold: 90d
tags:
  - work/completed
  - work/in-progress
  - work/backlog
last-reviewed: 2026-06-26
compaction_generation: 0
source_type: canonical
confidence: high
lineage: []
---

# Progress Tracker

**Last Updated**: 2026-08-12

## ✅ Completed (2026-08-12)

### Evidence-Grounding Verification Pass — branch `feature/evidence-grounding-verification`, merged into `fix/full-codebase-audit-findings` (`a227cdb`)

Resolves item 4 of the "ACR reliability findings" entry below (the reasoning-vs-evidence gap:
findings whose own cited evidence contradicts the claim, or whose severity ignores the agent's
stated criteria, with no existing defense checking a claim against the evidence it quotes).

- [x] Design spec + 13-task implementation plan written via `superpowers:writing-plans`; executed
      via `superpowers:subagent-driven-development` (fresh implementer subagent per task, controller
      runs genuine `/code-review` before every commit, implementers never commit).
- [x] Schema (`EvidenceCheckFinding`/`EvidenceCheckFilterMetadata` on `ReviewResult`), config
      (`verifyEvidence`/`verifierModel`, default `qwen3:latest`), `src/core/evidenceVerifier.ts`
      (`verifyEvidence`/`runEvidenceChecks`), wired into `runner.ts` (optional third
      `verifierProvider` param), `--verify-evidence` CLI flag, forced off for MCP callers, markdown
      + SARIF formatter blocks, README/CHANGELOG, permanent `calibration/evidenceVerifierCalibration.ts`
      script (`npm run calibrate:evidence`).
- [x] Stage 1 is deliberately report-only — flags via `evidenceCheckFilter`, never drops a finding
      from `findings`. A deterministic regex pre-filter runs as a second signal (`preFilterAgreed`)
      alongside the LLM verdict but never overrides or skips it — diff-derived evidence can carry
      deletion/comment context a naive text match can't distinguish from live code.
- [x] Validated against 13 unique synthetic cases (evidence-contradicts-claim + genuinely-correct
      controls); `qwen3:latest` scored 13/13, confirmed live twice — once during design validation,
      once via the permanent calibration script against real Ollama.
- [x] Final holistic review (pre-merge) caught a real trust-boundary gap: this is the first place in
      the codebase where one agent's LLM *output* becomes a second LLM call's *input* — the existing
      `sanitizeDiff`/`sanitizeText` defense was only ever applied once, at diff-ingestion. Fixed by
      reapplying `sanitizeText()` to claim/evidence before they reach the verifier prompt (`c0fe693`),
      with a regression test confirming injection strings are stripped first.
- [x] Regex bug found by the Task 4 implementer subagent: the `not-logged` pre-filter pattern
      required a trailing `(` after `echo`, which shell `echo` invocations never have — fixed to
      `/\b(log|logger|console\.\w+)\s*\(|\becho\b/i`; a self-contradictory test assertion sharing the
      same fixture was corrected alongside it; the same bug was retroactively fixed in the design
      spec and plan documents, which had been committed with the original text.
- [x] `??` → `||` bug in `cli/index.ts`'s `verifierModel` fallback, caught by a review lens (`??`
      doesn't catch an empty-string config value).
- [x] Post-merge: `npx vitest run` (no path arg) from the main checkout showed 5 failed test
      files/3 failed tests, all traced to `.worktrees/evidence-grounding-verification/...` paths —
      the worktree (gitignored but still on disk) was picked up by vitest's default glob and run
      concurrently with the real suite, racing on shared absolute temp paths. `vitest.config.ts`
      already excluded `.claude/worktrees/**` (2026-08-10, for the native `EnterWorktree` tool's
      convention) but not `.worktrees/**` (the `using-git-worktrees` skill's manual-fallback
      convention actually used this session). Added the missing exclude entry (`a713684`), reviewed
      (spawned reviewer independently confirmed glob correctness, re-ran the suite itself, checked
      prettier/eslint/tsc/CI for the same exposure — none found), verified: 44 test files (43 run +
      1 skipped), 500 tests (496 passing, 4 skipped), 0 unexpected failures.
- [x] Worktree (`.worktrees/evidence-grounding-verification`) and its now-fully-merged branch
      removed post-verification — nothing uncommitted in either.
- Branch `fix/full-codebase-audit-findings` intentionally not pushed yet — local only, pending
  explicit go-ahead.

## 🚧 In Progress

### Full-Codebase Audit Fix Effort — started 2026-08-10, branch `fix/full-codebase-audit-findings`

- [x] License/complexity/orchestrator fixes from prior handoff — merged PR #18, published npm
      `v1.9.0`
- [x] `review.yml` fork-origin-PR guard (self-hosted runner security gap) — merged in PR #18
- [x] Full 6-lens `src/` audit (security, performance, hallucination-risk, dead code,
      docs/logging, architecture) against this project's own `standards/*.md` — see
      `activeContext.md` for full findings and the one lens claim that was independently
      re-verified and corrected before reporting
- [x] Batch 1/5: path traversal (`--write-tests`), `base.ts` Stage 2+3 parsing gap, MCP
      `repo_path` scoping — commit `85e3e1c`, 461 tests passing
- [x] Batch 2/5: silent-failure observability — commits `caa5368`/`e650a8b`, pushed, 473 tests
      passing. `shell.ts` logs stderr when a tool exits nonzero with empty stdout (distinguishes
      "not installed" from "installed but broken", previously both resolved `null` identically).
      `config.ts` logs before falling back to defaults on malformed `ai-review.config.json`.
      `gitleaksParser.ts`/`npmAuditParser.ts` log on malformed tool JSON — previously silently
      reported "0 findings, tool used", a false sense of security specifically dangerous for the
      secrets scanner since `SecretsAgent`/`DependenciesAgent` set `toolAvailability: 'used'` on
      any non-null output regardless of parse success. `TestGenAgent` now checks generated content
      for actual test-framework structure (`describe(`/`it(`/`test(` with a quoted title, or
      `def test_` for pytest), not just a length threshold — a long refusal/explanation from the
      model would previously pass the length check and get written to disk as real tests. Also
      excluded `.claude/worktrees/**` from `vitest.config.ts`'s test glob — a leftover isolated-
      agent worktree (`fervent-kalam-3c236c`, detached HEAD at a stale July 25 commit) was being
      picked up and run in parallel with the real suite, racing on shared absolute temp paths and
      producing spurious failures unrelated to any code change; investigated via `git worktree
list` before excluding rather than deleting it (may still be someone's reference).
      Went through full `/code-review` (5 lenses + opponent check): caught and fixed one real
      issue before commit — the `testGen.ts` structural check's first regex could
      false-positive-accept prose containing "it (" as a parenthetical (e.g. "explain it (the
      reasoning) here"), defeating the check's own purpose; tightened to require a quoted title
      immediately after the call, verified independently by the opponent-check agent against both
      the false-positive case and real test code. Also ran full `/change-review` (9 jobs) before
      push: flagged 2 Low test-coverage gaps (gitleaks clean-scan and config valid-merge didn't
      assert non-logging, unlike the equivalent npm-audit/shell.ts cases from the same batch) —
      fixed in the immediate follow-up commit `e650a8b` per explicit user instruction ("fix all
      found issues, new + pre existing"). Job 7 (security) ran ACR's security profile
      (npm-installed `v1.9.0`) against the branch diff and flagged `resolveWriteTestPath` (Batch
      1's own path-traversal fix) as introducing path traversal — independently verified false
      positive by reading the actual containment-check code (`resolve()` + `isPathWithin()`,
      returns `null` on escape, caller correctly refuses to write). This became the first concrete
      example for a separate, not-yet-scoped conversation about ACR's own reliability — see "ACR
      reliability findings" note below.
- [x] Batch 3/5: dead code / config cleanup.
  - `complexity.ts` now imports the canonical `extractChangedFiles` helper instead of a local
    reimplementation that (unlike the canonical version) didn't exclude `/dev/null` deletion
    markers or dedupe -- added a regression test confirming deleted files no longer reach lizard.
  - Deleted the unused GitHub PR-comment adapter and its test (270 lines total, zero live import
    references -- confirmed via `git show` on `review.yml`'s first commit that the inline
    `actions/github-script` implementation was there from day one, never wired up).
  - Removed the dead `ContextMetadata` interface from `contextLoader.ts` (declared, zero
    references).
  - Removed `preferredSecretsScanner` from `ReviewConfig` (README/CHANGELOG documented it as
    shipped; functionally always a no-op -- briefly read in `SecretsAgent.run()` for one day
    (commit `ac280cc`) before being removed same-day (`1708687`) once every branch under it turned
    out to call the identical fallback regardless of its value, then left orphaned in `config.ts`
    for ~2 months. Would need a whole new trufflehog integration with unverified output format and
    no evidence of demand, so removed rather than implemented).
  - Wired up `complexityThreshold` for real: `ComplexityAgent.run()` now passes a `-C` threshold
    flag to lizard when the config field is set (verified lizard's actual CLI flag directly rather
    than trusting the README's stale "default: 10" claim -- lizard's own real default is 15,
    corrected the docs to say so).
  - Named the line-proximity magic number (copy-pasted 4x across the hallucination-corroboration
    and cross-reference logic) as `SAME_LOCATION_LINE_PROXIMITY`.
  - Removed `OrchestratorAgent`'s unused LLM provider constructor param (100% deterministic
    synthesis, no LLM calls) -- required updating roughly 40 call sites across the runner,
    calibration script, and 3 test files; removed now-dead provider-mock helpers and imports left
    over in those test files once the arg was gone.
  - README's config example JSON updated to match (dropped `preferredSecretsScanner`, corrected
    `complexityThreshold`'s documented default).
- [x] Batch 4/5: drift-prevention.
  - `cli/formatter.ts`'s `TOOL_LABELS` used to be keyed by an independently hand-typed literal
    union (`'gitleaks' | 'npmAudit' | 'lizard'`), and `degradedTools` re-typed the same 3 keys a
    second time as a literal array -- two places that could silently drift apart if a new tool
    integration were added to the schema and one site forgot to update. `TOOL_LABELS` is now typed
    `Record<keyof ToolAvailabilityMetadata, string>` (schema.ts's own type), so adding a key to the
    schema now forces a compile error here until a label is added; `degradedTools` derives its
    iteration list from `Object.keys(TOOL_LABELS)` instead of a second literal array.
  - `mcp/server.ts`'s tool description hardcoded "Uses 15 specialist agents (security,
    performance, ... complexity)" as a separate string -- found it had already silently drifted
    from `DEFAULT_CONFIG.agents`'s real order (same 15 agents, but `coverage` had moved position).
    Initially just inlined the derivation directly in `server.ts`, but the architecture-review
    lens correctly pushed back: `server.ts` has top-level side effects (connects a real stdio
    transport on import via `await server.connect(transport)`), making it untestable without
    triggering those effects -- so the new derivation logic itself would have shipped with zero
    coverage, in a batch specifically about preventing silent drift. Extracted the string builder
    into a new exported `buildToolDescription()` in `mcp/tool.ts` (the existing pure, side-effect-free
    logic layer) instead, which `server.ts` now imports and calls. Added
    `tests/unit/mcp/toolDescription.test.ts` as a separate file from the existing `tool.test.ts` --
    that file globally mocks `core/config.js` (providing only `loadConfig`, not `DEFAULT_CONFIG`),
    which would have broken `buildToolDescription`'s real `DEFAULT_CONFIG` import if tested there.
  - 466 unit tests passing (up from 464): new `tests/unit/mcp/toolDescription.test.ts`.
- [x] Batch 5/5: previously-approved-but-unimplemented performance/waste items.
  - `contextLoader.ts`'s `loadAgentContextSemantic` takes no `agentName` param -- its result
    depends only on `projectPath`/`diff`/`ollamaUrl`/`contextBudgetChars`, identical across every
    agent in one run. `runner.ts`'s `withContext` closure (called once per agent, up to ~16x)
    recomputed it from scratch every time -- redundant Ollama embedding calls (1 diff embed + 1
    per memory-bank file) with an identical result, every single call. Fixed by caching the
    `Promise<ContextResult>` in a `let` scoped to the same closure, assigned via `??=` before
    awaiting -- this correctly deduplicates concurrent calls under `--parallel` too, not just
    sequential ones, since the assignment happens synchronously before any agent's `await`. Added
    a real regression test (`tests/unit/runner.test.ts`, "computes the semantic embedding once per
    run, not once per agent") -- verified it actually catches the regression by temporarily
    reverting the fix and confirming the test fails (6 calls instead of 2 with 3 agents
    configured), not just written-and-assumed-correct. The bug-scan review lens then caught a real
    bug in the caching itself before commit: `??=` only reassigns when the variable is `null`, but
    a _rejected_ promise isn't `null` -- so a single transient embedding failure would have stayed
    cached forever, permanently failing every later agent and every retry for the rest of the run
    with the same error, defeating `retryAttempts` entirely for this failure mode. Fixed with a
    `.catch()` that resets the cache variable to `null` before rethrowing, so a later
    agent/retry gets a fresh attempt instead of the poisoned cache. Added a second regression test
    and verified the same way (confirmed it fails without the reset: both agents fail off one
    cached rejection instead of the second getting its own attempt).
  - `complexity.ts`/`observability.ts` both instructed the model to generate `severity: "low"`
    findings that `orchestrator.ts`'s `applyPublicationFilter` unconditionally discards before
    publication -- pure wasted generation time. Removed the `severity: "low"` line from both
    prompts and added `- Only report severity >= medium` to each, matching the exact phrasing
    convention `dependencies.ts` already established for this same class of instruction. Verified
    no test or calibration fixture depended on a "low" finding from either agent before removing.
  - 468 unit tests passing (up from 466).

### ACR reliability findings — reported 2026-08-10, items 4/5 resolved 2026-08-12, item 3 open

User forwarded a consolidated report from two independent ACR runs against an identical real-world
diff (Personal-Memory-Bank's concurrent-session-claims feature, ~8000 lines) — a dogfooding
reliability test of this tool's own output quality, not a review of this repo. Five items, checked
individually against this codebase rather than accepted at face value:

1. **Nondeterminism across runs on identical input** (9 vs 10 findings, one run had a coverage
   timeout + dependencies retry-exhaustion). Known, accepted category — inherent to local-LLM
   inference reliability, already has partial mitigation (`retryAttempts`, `timeoutScalingEnabled`,
   `agentStatus` visibility so failures are reported, not silently clean). Not a target for any
   current or planned batch.
2. **Item 5 (schema "nothing to report" gap) does not hold once checked.** There IS a tested clean
   `[]` path — `dependencies-clean`/`license-clean` calibration cases (`expectEmpty: true`) confirm
   it works when the model complies. The described "rejected nothing-here response" means the model
   returned something other than `[]` despite the prompt saying to — model non-compliance, not a
   schema gap. Loosening the schema to accept it was explicitly considered and rejected on
   2026-08-03 (reverts a deliberate anti-hallucination safety property tested in
   `tests/unit/baseAgent.test.ts`).
3. **Item 2's specific "fabricated GPL/mongodb license finding" traces to a real, already-fixed bug**
   — commit `a906515` (2026-08-09) removed the exact "package.json:14"+"MongoDB" bait from
   `licenseCompliance.ts`'s prompt in response to this same pattern, shipped in npm `v1.9.0`. But it
   was prompt-only (license has no deterministic-tool replacement, unlike dependencies' npm-audit)
   — prompt-tightening alone is documented as NOT reliably eliminating hallucination (adversarial:
   3/3→3/3, no measurable improvement, 2026-08-06 entry). `orchestrator.ts`'s
   `filterNonexistentFiles` (live since 2026-08-03, agent-agnostic) should catch a finding citing a
   file genuinely absent from the diff — if this specific finding survived to final output despite
   that, it's either a stale-build artifact or a real regression. **Unresolved**: needs the raw
   finding's exact file/line/text and `ai-review-agent --version` used to tell which.
4. **Items 2, 3 ("quotes-own-disproof": findings citing evidence that directly contradicts the
   claim, e.g. flagging a `shift`-based fix as the unbound-variable bug it fixes) and 4 (severity
   miscalibration: "new hook added" labeled Critical/Blocking) collapse into ONE real, currently
   unaddressed architectural gap.** Verified directly: `breakingChange.ts`'s prompt already
   correctly scopes to real incompatibilities (removed exports, signature changes, renames) —
   "new hook added" matches none of its 9 criteria, so the mislabel isn't a missing prompt rule,
   it's the model not checking its own conclusion against its own stated criteria or the evidence
   it quotes. **No existing defense checks this** — `filterNonexistentFiles` checks file existence,
   `hallucinationCrossCheck` checks cross-agent corroboration; neither verifies reasoning against
   evidence. Not touched by Batch 1, Batch 2, or anything currently planned.
   **RESOLVED 2026-08-12** — see the "Evidence-Grounding Verification Pass" entry above.
   `evidenceVerifier.ts` now checks each Critical/High finding's claim against its own cited
   evidence via a second model. Scoped as Stage 1 (report-only, `--verify-evidence`, off by
   default) rather than auto-filtering — visibility first, not yet wired to drop or downgrade
   findings automatically.
5. **Live first-party confirmation of the same failure mode**, caught during this session's own
   `/change-review` Job 7: ACR's security profile (npm `v1.9.0`) flagged `resolveWriteTestPath`
   (Batch 1's own path-traversal fix) as introducing path traversal, citing the exact containment
   check that prevents it. Verified false positive by reading `resolve()`+`isPathWithin()` directly.
   **Same root cause as item 4, resolved by the same fix.**

**Status**: items 1 and 2 were investigated and don't need code changes (accepted limitation /
confirmed non-issue, respectively). Items 4 and 5 resolved 2026-08-12 via evidence-grounding
verification (see above). **Item 3 remains open** — the specific fabricated GPL/mongodb finding
the user originally reported was never traced to a specific run; still needs the raw finding's
exact file/line/text and the `ai-review-agent --version` used, to tell a stale-build artifact from
a live regression.

## ✅ Completed (Tasks 1–16)

### Secrets/Dependencies Deterministic-Tool Integration — 2026-08-06

- [x] Root cause (two independent, compounding causes, both empirically proven): (1)
      `parseFindings` Stage 4 mislabeled a complete bare `{...}` object as "response appears
      truncated"; (2) genuine LLM content hallucination in `secrets`/`adversarial`/`dependencies`,
      reproduced 9/9 via direct `provider.chat()` calls against real Ollama.
- [x] Fix A (Stage 4 bug): new Stage 2b in `base.ts` recognizes a single finding-shaped bare
      object and wraps it with an accurate log message instead of the misleading truncation one.
- [x] Fix B (secrets/dependencies): `SecretsAgent`/`DependenciesAgent` override `run()` to call
      gitleaks/`npm audit --json` directly, skipping the LLM entirely when available — chosen over
      augmenting the LLM with tool output since the real problem is untrustworthy LLM judgment,
      not missing signal. `gitleaksParser.ts`/`npmAuditParser.ts` map real tool JSON to `Finding`
      (severity vocabularies don't match either tool's own scheme, explicit mapping needed; npm
      audit is full-tree, not diff-scoped, by design). New `ToolAvailability`/
      `ToolAvailabilityMetadata` schema types surface degraded-mode fallback on `ReviewResult`,
      markdown, and SARIF.
- [x] Fix C (adversarial/secrets prompt-tightening): negative examples added to `secrets.ts`'s
      LLM-fallback prompt (marker paths, hash invocations); a threat-boundary rule added to
      `adversarial.ts` (attacker framing only for real external untrusted-input boundaries).
      Explicitly framed as rate-reduction, not guaranteed — matches PR #17 precedent.
- [x] Found and rejected a redundant orchestrator mechanism during design: the existing
      hallucination cross-check already downgrades solo High findings from non-deterministic
      sources (verified via a real-pipeline repro script, not assumed) — a planned new
      adversarial-specific downgrade would have been dead code. Deeper investigation (at the
      user's explicit request to "look deeper and verify") found a real gap in that _existing_
      mechanism instead: an unrelated nearby finding from a different agent defeats the
      corroboration check. Documented as a deliberately deferred Non-Goal (an exact-line-match fix
      breaks a legitimate existing test) rather than patched in this pass.
- [x] Honest before/after measurement (3 runs each, real diff, prompt isolated via direct
      `provider.chat()` calls bypassing `run()`): `secrets` 3/3 → 2/3 hallucinated (real, partial
      improvement); `adversarial` 3/3 → 3/3, **no measurable improvement** — confirmed the patched
      prompt text was actually in the built `dist/` before concluding the model just ignores the
      rule. Reported as-is rather than spun positively.
- [x] Found and fixed a real Windows-only bug independent of the plan: `runTool('npm', ...)`
      threw `ENOENT` on Windows (npm resolves to `npm.cmd`; Node hard-blocks spawning `.cmd`/`.bat`
      files without `shell: true`, a security fix, not configurable another way) — silently broke
      the entire npm-audit integration on Windows until live calibration surfaced it (confirmed via
      direct `child_process.spawn` reproduction). Fixed with an explicit `shell` parameter on
      `runTool`, defaulting to `false` (gitleaks' `--source <file>` can carry diff-derived paths
      from an untrusted PR — enabling a shell there would reopen command injection); only the npm
      call site opts in, since its args are always the hardcoded literal `['audit', '--json']`.
- [x] Found and fixed two latent test-infrastructure gaps before they caused false
      failures/regressions: pre-existing calibration cases sharing a fixture with the new
      deterministic-tool paths needed their expected/bait keywords updated once `projectPath` was
      added to the harness (real npm audit output doesn't mention the diff's own fabricated bait
      text); a `runner.test.ts` mock `beforeEach` only reset the mock's resolved value, not its
      call history, letting one test's calls bleed into another's assertions.
- [x] Process correction: an implementer subagent was mistakenly instructed to bypass the
      review-gate hook by writing the marker directly without a real review — caught by the
      harness's own security-warning mechanism, verified the actual committed content was safe,
      permanently corrected to controller-only marker-writing/committing for the rest of the
      session.
- [x] 427 unit tests passing (up from 393 baseline), 18/18 calibration cases passing (up from 16).
      Files: `base.ts`, `schema.ts`, `secrets.ts`, `dependencies.ts`, `adversarial.ts`, `runner.ts`,
      `cli/formatter.ts`, `cli/formatters/sarif.ts`, `utils/shell.ts`, new `gitleaksParser.ts`/
      `npmAuditParser.ts`, `calibration/calibrate.ts` + new fixtures, plus matching test files. Full
      spec at `docs/superpowers/specs/2026-08-04-secrets-dependencies-deterministic-tools-design.md`.

### Hallucination-Filter Visibility Follow-Up — 2026-08-04

- [x] Self-flagged gap in the fix below: dropped findings were only `console.error`'d, invisible
      to `ReviewResult` — same anti-pattern already fixed once for sanitizer/context redactions
      (2026-07-26). Risky because the filter itself can false-positive.
- [x] `OrchestratorAgent.synthesize()`/`filterNonexistentFiles` take an optional
      `dropped?: DroppedHallucinatedFinding[]` sink (no-op when omitted); `runner.ts` surfaces it
      as `ReviewResult.hallucinationFilter: { droppedCount, dropped }`.
- [x] Found a second pre-existing gap while wiring the markdown formatter: the
      `findings.length === 0` early return skips the entire sanitizer/context/policy footer —
      would have hidden the new note in exactly the case it matters most. Placed the note near
      the top with the truncation warning instead of the bottom footer.
- [x] Added to `sarif.ts` run-level properties for parity; `formatJson`/`mcp/formatter.ts`
      needed no change.
- [x] 392 unit tests passing (up from 385). Files: `schema.ts`, `orchestrator.ts`, `runner.ts`,
      `cli/formatter.ts`, `cli/formatters/sarif.ts`, plus matching test files.

### Dependencies-Agent Hallucination Fix — 2026-08-03

- [x] Root cause: `dependencies.ts`'s prompt carried a concrete "lodash wildcard" example as its
      REQUIRED OUTPUT FORMAT (every other agent uses a placeholder) — model reproduced it
      near-verbatim on a diff with nothing dependency-related to report, after `validateFindings`
      forced a retry on a legitimate empty response lacking file/line.
- [x] Rejected loosening `BaseAgent.parseFindings` to accept a no-file/line "empty" shape —
      `baseAgent.test.ts` has a deliberate test asserting bare `{}` must throw
      `ParseFailureError`, a prior fix for a silent-clean-pass bug; would have reverted a correct
      safety property.
- [x] Fix A: replaced the concrete example with a placeholder (`dependencies.ts`).
- [x] Fix D: new `OrchestratorAgent.filterNonexistentFiles` synthesis stage drops any finding
      whose `file` isn't among the diff's actual changed files (`extractChangedFiles`, threaded
      through from `runner.ts` as an optional `changedFiles` param on `synthesize()`, no-op when
      omitted, fails open when empty/undetermined). Live verification showed Fix A alone did not
      stop fabrication — Fix D turned out to be the load-bearing defense, not just a backstop.
- [x] Found and fixed two self-introduced bugs before considering this done: `calibrate.ts`
      wasn't passing `changedFiles` into `synthesize()` (Fix D never activated during
      calibration); `filterNonexistentFiles`'s path `normalize()` didn't strip a leading `a/`/`b/`
      git-diff-header prefix, which a full calibration run showed causing two genuinely real
      findings (`correctness`, `migration-safety`) to be wrongly dropped as hallucinated when the
      model echoed the diff's own `--- a/path`/`+++ b/path` convention into `file`. Fixed by
      trying both the normalized and prefix-stripped form before rejecting.
- [x] New calibration case `dependencies-clean` (clean-diff fixture, `expectEmpty: true`) as a
      permanent regression guard.
- [x] Final calibration: 16/16 passed except `adversarial` — same single failure as the original
      pre-change baseline (unrelated keyword-match flakiness on that fixture), confirmed not a
      regression.
- [x] 385 unit tests passing (up from 358). Files: `dependencies.ts`, `orchestrator.ts`,
      `runner.ts`, `calibration/calibrate.ts` + new fixture, `orchestrator.test.ts`,
      `runner.test.ts`.

### Calibration CI Shell-Default Fix — 2026-08-03

- [x] `.github/workflows/calibrate.yml`'s "Check Ollama availability" step is bash `if/then/fi`
      syntax with no `shell:` declared — silently defaulted to PowerShell on the self-hosted
      Windows runner and hit a `ParserError`, same bug class as `review.yml`'s earlier fix.
      `continue-on-error: true` at the job level masked every failure as workflow-level
      "success," so this had been failing on 100% of runs for at least a month (confirmed via
      `gh run view`'s job-level `conclusion` on the last 4 runs, back to 2026-07-06) with nobody
      noticing.
- [x] Fixed by porting `review.yml`'s proven two-part fix verbatim: job-level
      `defaults: run: shell: bash`, plus a bootstrap step (explicit `shell: pwsh`) prepending
      Git's real bash to `$GITHUB_PATH` ahead of the broken WSL stub a bare `bash` lookup
      otherwise resolves to on this runner.
- [x] Full 5-domain `/code-review` — no Blocking findings. Fixed two non-blocking ones inline: a
      comment overstating "every step below is bash syntax" (only one step is), and this file's
      own stale `activeContext.md` line still describing Calibration CI as healthy.
- [x] `/code-review`'s Testing domain flagged that `review.yml`'s own fix took 3 iterations to
      actually work in practice — ran manual `workflow_dispatch` verification runs on the branch
      rather than trusting the next weekly cron:
  - **Run 1** (`timeout-minutes: 10`, pre-existing value): shell fix confirmed working — bash
    steps executed correctly, Ollama detected, real calibration cases ran with real PASS/FAIL
    results. Got cancelled mid-suite (case 13 of 16) purely from hitting the old 10min budget,
    which had never actually been validated against real suite runtime (the job never got past
    the shell bug far enough to reach it before).
  - [x] Raised `timeout-minutes` to 20, with a comment explaining why (own commit).
  - **Run 2** (`timeout-minutes: 20`): also got cancelled mid-suite (case 15 of 16) — but cases
    5+ ran 3-5x slower than the same cases in run 1 (e.g. "coverage": 72s in run 1 vs. 248s in
    run 2). Investigated directly on the runner machine rather than guessing: Ollama's
    `server.log` showed the model loaded exactly once and stayed loaded (ruled out reload
    cycling); Windows System event log had no `nvlddmkm` driver-reset events (ruled out a GPU
    crash); no WARN/ERROR in Ollama's log during the run window. Root cause not conclusively
    provable after the fact — no retroactive GPU utilization time-series existed to check — but
    the leading, evidence-consistent hypothesis is transient resource contention on this shared,
    personal-use machine (this session's own concurrent activity during that window is a
    plausible contributor), not a defect in the shell fix or the calibration code.
  - **Run 3** (`timeout-minutes: 20`, monitored): ran `nvidia-smi --query-gpu=...` sampled every
    5s for the full duration in parallel. Completed the entire 16-case suite + testgen suite in
    ~13-14min with consistent ~30-70s/case pacing (no degradation) — 15/16 passed, 1 genuine
    miss ("adversarial" missed 'empty', a real calibration result, not an error).
    `clocks_event_reasons.active` was `0x0` (no thermal/power/software throttling) for the
    entire run; VRAM stayed stable (~7.3-7.5GB); utilization showed normal inference-burst
    pattern. Confirms the same code/hardware/budget runs consistently within real margin when
    nothing else is contending — `timeout-minutes: 20` is empirically validated, not a guess.
- [x] No test-suite changes (CI YAML only, no vitest-covered code touched).

### Code Review Follow-Up, Part 2: Remaining Findings — 2026-07-26

User said "fix it all" after the CoverageAnalyst parity fix below landed — closed every
remaining open item from the `/code-review` gate rather than leaving them as tracked follow-ups:

- [x] Sanitizer's "act as a/an ..." pattern required an AI/assistant/bot/model word directly
      adjacent, which fixed the earlier false positive but missed real jailbreak framings without
      one — "act as a Linux terminal", "act as DAN" — confirmed by the opposition reviewer testing
      both strings directly. Broadened to also match `terminal`, `hacker`, `unrestricted`,
      `unfiltered`, `jailbroken` without reopening the original false positive (verified: "acts as
      a validator"/"acts as a gatekeeper" still don't match).
- [x] Fixed the SRI-hash base64 false positive for real this time. The earlier attempt (a
      negative lookbehind) was correctly deferred after empirical testing showed the regex engine
      could find an alternate match-start position that bypassed it. Real fix: `INJECTION_PATTERNS`
      entries can now carry an `isFalsePositive(line, matchOffset)` check applied in code, after a
      match is found via `String.replace`'s callback — not vulnerable to the same bypass since
      there's no alternate-start-position escape hatch when you're checking actual match context
      directly.
- [x] Memory-bank sanitizer redactions were `console.warn`-only, invisible to any consumer of the
      structured JSON/markdown report. `sanitizerMeta` is now mutated (not just read) inside
      `withContext`, merging `applied`/`redactedLines`/`warnings` from every agent's context
      sanitization into the same object the diff's own sanitization already populates.
- [x] `--no-sanitize`'s CLI help, README, and runtime warning only described disabling diff
      sanitization. Updated all three to mention it also disables memory-bank context
      sanitization when `--context memory-bank` is set.
- [x] Hardened `OllamaProvider.stripThinkTags` against the SPECULATIVE finding from the
      opposition review: a `<think>` block truncated before it closes now has itself and
      everything after it dropped entirely, instead of leaving raw reasoning prose in the
      response where Stage 4's object scanner could mistake a coincidentally schema-shaped
      object inside it for a real finding the model never asserted. Confirmed this risk is inert
      under the current `devstral` default (`supportsThinking()` excludes it) — hardened anyway
      since it was cheap and protects against a future model switch.
- [x] 378 unit tests passing (up from 371), typecheck/lint/build/format clean.

### Code Review Follow-Up, Part 1: CoverageAnalyst Truncation Parity — 2026-07-26

- [x] Ran the full `/code-review` gate (5 domain subagents + opposition review) on the
      structured-JSON-output/truncation-recovery/sanitization diff below before committing. Four
      of five domain reviewers independently converged on the same finding: `coverageAnalyst.ts`
      picked up `format:'json'` (which the diff's own calibration data shows raises truncation
      frequency) without the Stage 4 recovery that made it safe in `base.ts` — Correctness and
      Testing rated it High/Blocking.
- [x] Opposition review downgraded the Blocking rating after reading `runner.ts:263-275` and
      `cli/exitCode.ts`: a coverage parse failure is caught, classified into `agentStatus`, and
      surfaces as exit code 2 — it fails loudly, not silently. Still recommended fixing it in this
      PR rather than deferring, since the diff's own stated goal is truncation resilience and the
      fix was cheap with a repro already in hand.
- [x] Also caught during review and fixed in the same pass: `extractCompleteObjects`'s depth
      counter could go negative on a stray leading `}`, permanently breaking recovery for the rest
      of the response (reproduced by direct execution during Correctness review).
- [x] Extracted `extractBalancedSpan` and `extractCompleteObjects` into `src/core/parsing.ts` as
      shared helpers — replaces three near-identical hand-rolled bracket scanners (`base.ts` had
      two, `coverageAnalyst.ts` had one) with two, fixing the depth bug in one place instead of
      three (this was also an independent Maintainability finding). `extractCompleteObjects` now
      recovers objects at any nesting depth via a stack of open-brace positions, not just
      top-level ones — required for `coverageAnalyst`'s schema, where findings/gaps sit one level
      inside an outer wrapper object that's exactly what's truncated.
- [x] Gave `CoverageAnalystAgent.parseCoverageResult` a Stage 3: when the outer object never
      closes, scan the raw text for complete finding/gap objects and salvage them, splitting
      recovered objects by which required-field shape they match (a Finding and a CoverageGap
      share no required fields besides `file`, so no cross-contamination risk).
- [x] Added regression tests: `extractCompleteObjects` negative-depth case (`parsing.test.ts`),
      `extractBalancedSpan`/`extractCompleteObjects` direct unit coverage (braces-in-strings,
      escaped quotes, empty input), and `coverageAnalyst`'s new Stage 3 recovery + a corrected test
      for `{}` (which is a legitimate "fully covered" response for coverage's object-shaped
      schema, unlike `base.ts`'s array-shaped one — an earlier draft of this test incorrectly
      asserted it should throw).
- [x] 371 unit tests passing (up from 358), typecheck/lint/build/format clean.
- Remaining findings from the review were not addressed in this pass — all fixed in the Part 2
  entry above, in a follow-up commit the same day.

### Structured JSON Output, Truncation Recovery, Memory-Bank Context Sanitization — 2026-07-25

- [x] `format: 'json'` (Ollama's structured-output mode) now requested by `base.ts`'s `run()` and
      `coverageAnalyst.ts`'s `runForCoverage()`. `ChatOptions.format` existed end-to-end but
      nothing ever passed it. Not applied to `TestGenAgent` (outputs raw test code, not JSON).
- [x] **Real result, not the expected one**: re-running calibration afterward showed
      `format: 'json'` alone increases truncation frequency (11/16 cases vs. 1/16 before) rather
      than reducing it — strict schema compliance appears to remove whatever slack let the model
      wrap up more tersely before.
- [x] Added a Stage 4 recovery path to `BaseAgent.parseFindings`:
      `extractCompleteObjects()` scans for complete `{...}` objects regardless of whether the
      enclosing array ever closes, salvaging whatever the model finished. This is what actually
      carried the reliability improvement — all 11 truncated cases in the calibration re-run were
      successfully salvaged.
- [x] Caught and fixed a real regression in the recovery stage during implementation: a trivially
      parseable garbage response (`"{}"`) was passing through as a successful "0 findings"
      recovery instead of throwing `ParseFailureError` — exactly the silent-clean-pass anti-pattern
      this project exists to prevent. Fixed by requiring at least one recovered object to actually
      pass schema validation, not just parse.
- [x] Full calibration re-run on `devstral:latest`: 15/16 passed (same as baseline), but with the
      recovery stage doing real work instead of the truncation rate staying low on its own.
- [x] Answered "are there any guardrails we are missing": `contextLoader.ts`'s comment falsely
      claimed memory-bank context was already sanitized ("sanitizer applies separately") — it
      wasn't; `sanitizeDiff()` was only ever called on the diff. Added `sanitizeText()` (scans
      every line, since `sanitizeDiff`'s `+`-prefix convention is diff-specific) and wired it into
      `runner.ts`'s `withContext`, respecting `--no-sanitize`.
- [x] Dogfooding the above against this repo's own real memory-bank files caught a live false
      positive: the sanitizer's "act as a" pattern fired on `activeContext.md`/`progress.md`'s own
      prose describing that same bug. Tightened to require the phrase target an
      AI/assistant/bot/model role (matching the existing "you are now" pattern) — confirmed real
      injection attempts still match, this repo's memory-bank no longer false-positives.
- [x] Attempted a fix for the SRI-hash base64 false positive found in the earlier architecture
      review; a naive negative-lookbehind doesn't work (the regex engine finds an alternate
      match-start position that bypasses it). Needs a proper code-level fix — deferred, not
      implemented this pass.
- [x] 358 unit tests passing, typecheck/lint/build/format clean. v1.8.0.
- Open follow-up, not yet decided: add an explicit `num_predict` to directly counteract
  `format: 'json'`'s higher truncation rate, now that there's concrete evidence it's needed,
  rather than relying solely on the recovery stage.

### Actionable Truncation Warning; Parallel-by-Default Investigated and Rejected — 2026-07-25

- [x] Strengthened the pre-flight diff-truncation stderr warning (`runner.ts`) to state the
      excluded line count and suggest `--max-lines`/splitting the diff.
- [x] Fixed a stale `README.md` CLI options table: `--timeout` default still said `60000`
      (pre-dating the 60s→180s fix).
- [x] `--fail-fast` now warns on stderr when combined with `--parallel` (its early-exit check
      only runs in the sequential code path).
- [x] **Investigated and reverted** a `parallel`-by-default change. Initial 4-concurrent-request,
      trivial-prompt test showed a promising ~1.63x speedup; a deeper test at the real default
      scale (14 concurrent requests, realistic ~30KB diff prompt) showed near-linear
      serialization instead (completions at 58.7s/91.5s/120.6s/172.7s/235.0s/305.7s, then a
      header-timeout past 300s), reproduced with `curl` directly to rule out a client-side
      artifact. Defaulting to parallel would have caused most of the default 14-agent swarm to
      spuriously time out from queue wait alone. Also confirmed the tool has zero Anthropic/Claude
      API usage (100% local Ollama), so there was no token-cost pressure to justify the risk.
      Reverted `DEFAULT_CONFIG.parallel` to `false`, `--no-parallel` back to opt-in `--parallel`,
      and restored `memory-bank/systemPatterns.md`'s original rationale (updated with the
      investigation's data rather than struck through as superseded).
- [x] 348 unit tests passing, typecheck/lint/build/format clean. v1.7.0.
- Deferred to follow-up PRs (same bug report, user-selected): retry with a shrunk prompt on
  timeout, and parse-failure fallback extraction.

### Model Configuration Verification — 2026-07-25

- [x] Confirmed `DEFAULT_CONFIG.model: 'devstral:latest'` is consistently referenced everywhere
      (including `calibration/calibrate.ts`) — no drift after more Ollama models were downloaded.
- [x] Measured actual GPU/CPU split (not on-disk size) for every locally-downloaded model at the
      real 32k context: `devstral:latest` 30% GPU, `deepseek-r1:14b` 38% GPU, `gemma3:12b` 49%
      GPU, `qwen3:latest` 59% GPU, `gemma3:4b` **100% GPU** (only fully-resident option).
- [x] Recommended not switching yet — no calibration evidence any alternative matches devstral's
      review quality, and `gemma3:4b` is a large capability step down (4B vs 23.6B params).
- Next (agreed, not started): add a model override to `calibration/calibrate.ts` (currently
  hardcoded to `DEFAULT_CONFIG.model`, no env var/flag), then bake-off `qwen3:latest` and
  `gemma3:12b` against the existing 16-case calibration suite.

### Architecture Deep-Dive — 2026-07-25

Prompted by an explicit "true design suggestions, not made up" request — verified findings only,
no speculation. User approved items 1, 2, 4 for implementation (not yet started):

1. `ChatOptions.format?: 'json'` (Ollama's structured-output mode) is fully plumbed end-to-end
   but never called anywhere. Empirically confirmed it makes `devstral:latest` reliably emit
   valid JSON — should reduce the `ParseFailureError` class of bug fought since v1.4.0.
2. `--context-mode semantic`'s `loadAgentContextSemantic` has zero caching and is called once per
   agent in `runner.ts`'s `withContext` closure — ~14x redundant Ollama embedding calls per run.
3. `orchestrator.ts`'s `applyPublicationFilter` unconditionally discards all `severity: 'low'`
   findings with no override, yet `complexity.ts`/`observability.ts` explicitly prompt the model
   to generate them — wasted generation time, guaranteed to be thrown away.
4. `sanitizer.ts`'s regexes false-positive on ordinary code, empirically reproduced: SRI
   integrity hashes and comments like "act as a validator" get silently redacted. Zero test
   coverage for this.
5. `base.ts` unconditionally sends `think: true`, but it's only actually forwarded to Ollama for
   `qwen`/`deepseek-r1` models, never `devstral` (the real default) — `systemPatterns.md`'s
   "reasoning depth matters" claim doesn't describe what's actually running.
6. `OrchestratorAgent` takes an unused `LLMProvider` constructor param (pure dead dependency).

### Truncation-Aware Timeout Scaling — 2026-07-18

- [x] `scaleAgentTimeout(base, diffLines, maxDiffLines)` pure function in `runner.ts` — linear
      scale from `base` up to `base * 2` as diff size approaches `maxDiffLines`, clamped.
- [x] `ReviewConfig.timeoutScalingEnabled` (default `true`); `--timeout` passed explicitly sets
      it to `false` so an explicit override always wins.
- [x] Threaded through as a new parameter to all 4 agent-running call sites in `runner.ts`,
      computed once in `run()` from `truncationMeta.keptLines`.
- [x] Fixed stale `--timeout` help text (still said "default: 60000", pre-dating the earlier
      60s→180s default change).
- [x] Also fixed a pre-existing test-isolation bug in `cli.test.ts`'s `loadConfig` mock
      (`mockReturnValue` shared one object across tests; `cli/index.ts` mutates config in
      place, so earlier tests' `--timeout` leaked into later tests — switched to
      `mockImplementation` returning a fresh object per call).
- [x] v1.6.0.

### Diff-Truncation Visibility — 2026-07-18

- [x] `ReviewResult.truncation` field (`{ truncated, originalLines, keptLines }`) added,
      populated by `preprocessDiff()` in `runner.ts`, mirroring the existing `SanitizerMetadata`
      pattern.
- [x] All 4 output formats surface it — markdown gets a prominent warning near the top (not
      buried at the bottom), SARIF gets run-level properties, github-annotations gets a
      `::warning::` line even with zero findings, JSON is free.
- [x] Deliberately not wired into exit code 2 — scoped as visibility-only per explicit decision.
- [x] v1.5.0.

### Silent Agent Failure Reporting — 2026-07-17

- [x] `ParseFailureError` thrown by `parseFindings`/`parseCoverageResult` instead of silently
      returning `[]` on total parse failure.
- [x] `agentStatus` field added to `ReviewResult`, populated across all 4 `runner.ts`
      catch-block sites (sequential, parallel, coverage, testgen) plus their success paths.
- [x] All 4 output formats (markdown, json, sarif, github-annotations) surface agent failures
      clearly instead of an indistinguishable clean checkmark.
- [x] New exit code 2 for agent failures, independent of and taking priority over `--fail-on`.
- [x] 16 existing agent test files updated from asserting a silent `[]` return to asserting
      `ParseFailureError` is thrown; new dedicated tests for the runner-level classification,
      formatter output, exit code priority, and an end-to-end regression test for the original
      bug report scenario.
- [x] v1.4.0.

### `/ai-review` Distribution + Update-Notifier — 2026-07-14

- [x] `scripts/postinstall.mjs` (plain JS, not compiled TS -- must survive running before
      `dist/` exists) copies `.claude/commands/ai-review.md` to `~/.claude/commands/` on every
      `npm install -g`/`npm update -g`. Fails open on any error. Resolves the invoking user's
      real home directory even under `sudo npm install -g` (via `SUDO_USER`).
- [x] `package.json`'s `files` array now ships `.claude/commands/` and `scripts/postinstall.mjs`.
- [x] `update-notifier` wired into `src/cli/index.ts`: 7-day cached check, non-blocking, TTY-only
      notification, never auto-installs.
- [x] Verified end-to-end via `npm pack` + global install into a throwaway prefix/fake HOME.
- [x] v1.3.0.

### AbortSignal/Timeout-Cancellation Fix — 2026-07-14

- [x] Root cause: `withTimeout` (`runner.ts`) raced a timer against each agent's LLM call via
      `Promise.race`, which never cancels the losing side — a timed-out agent's in-flight fetch
      to Ollama kept running server-side for up to 5 minutes after the runner gave up, and each
      retry piled another live, uncancelled request on top instead of replacing the abandoned
      one, compounding contention under load.
- [x] Fix: threaded an `AbortController`'s signal from `withTimeout` through
      `agent.run()`/`runForCoverage()`/`runWithGaps()` (`base.ts`, `complexity.ts`,
      `coverageAnalyst.ts`, `testGen.ts`) down to `OllamaProvider.chat()`'s `fetch` call
      (`ollamaProvider.ts`, `provider.ts`), so a timeout now actually cancels the request.
- [x] Found and fixed during review: the fix itself left `withTimeout`'s `setTimeout` handle
      uncaptured, so even a _successful_ call left a dangling timer that fired a pointless
      `controller.abort()` afterward — closed with `.finally(() => clearTimeout(timer))`.
- [x] Full `/code-review` (5 subagents + confidence scoring + opponent check) — no other issues
      found; all call sites verified complete (only `ComplexityAgent`/`CoverageAnalystAgent`
      override `run()`, both correctly threaded).
- [x] New regression tests: proves the signal actually aborts on timeout, and proves the timer
      is cleared (no dangling abort) on success. 297 unit tests passing (up from 295).
- [x] Unrelated CI fix bundled in the same working session, landed as a separate commit:
      `.github/workflows/review.yml`'s "Write Step Summary" step used bash-only escaping with no
      `shell:` declared, silently defaulting to PowerShell on the self-hosted Windows runner and
      failing every PR with `ParserError`/`SyntaxError`. Fixed with a job-level `shell: bash`
      default so every step in the job is consistent.
- [x] `/change-review` dogfooding (9-job review + ACR invocation) surfaced that ACR's security
      profile timed out on all 4 agents against `devstral:latest` — reproduced directly with a
      realistic diff-sized prompt (~24KB) taking over 100s with no response. Root cause: this
      machine's 8GB-VRAM GPU only fits ~6.1GB of the 23.6B-param model, the rest runs on CPU.
      `DEFAULT_CONFIG.agentTimeoutMs` (`src/core/config.ts:60`) was 60000ms, far tighter than
      `OllamaProvider`'s own `DEFAULT_TIMEOUT_MS` (300000ms) already assumed. Raised to 180000ms
      to close the gap. Config-only change; 297 tests still pass, typecheck clean.

### CI Gate Added — 2026-07-06

- [x] `.github/workflows/ci.yml` created — first real push/PR quality gate (previously only
      `release.yml` ran the full check suite, at release-tag time only). Runs typecheck, format:check,
      lint:eslint, test, build each as an independent `continue-on-error` step, gated by a final
      "Gate on all checks" step that fails the job on any non-success outcome.
- [x] Fixed pre-existing `format:check` drift on 6 files (`.claude/commands/change-review.md`,
      `.claude/commands/code-review.md`, 4 files under `docs/superpowers/`) via `prettier --write` so
      the new gate starts green.

### Core Infrastructure

- [x] **Task 1**: Project scaffolding — package.json, tsconfig, vitest.config.ts (`d21e3c7`)
- [x] **Task 2**: Core types — Finding schema, LLMProvider interface (`d9b31bd`)
- [x] **Task 3**: Config loading — ReviewConfig + loadConfig() with project override (`c510e03`)
- [x] **Task 4**: OllamaProvider — HTTP client, think-tag stripping, ping (`91cac35`)
- [x] **Task 5**: BaseAgent — abstract class with 3-stage JSON parse (`fbc8713`)

### Specialist Agents

- [x] **Task 6**: SecurityAgent, PerformanceAgent, CorrectnessAgent (`37ea95c`)
- [x] **Task 7**: DesignAgent, DependenciesAgent, AdversarialAgent, IntegrationScoutAgent (`6eb735b`)
- [x] **Task 8**: CoverageAnalystAgent (gaps + findings) + TestGenAgent (`ccd09d5`)

### Orchestration

- [x] **Task 9**: OrchestratorAgent — dedup, cross-reference escalation, publication filter, cap (`c9b7835`, `46b3585`)
- [x] **Task 10**: SwarmRunner — sequential orchestration with coverage-first ordering (`0634500`)

### Distribution

- [x] **Task 11**: CLI — Commander entry point + markdown/json formatters (`c26fab1`)
- [x] **Task 12**: GitHub Actions adapter + workflow (PR comment upsert, Step Summary) (`4bc5298`)
- [x] **Task 13**: Claude Code slash command `.claude/commands/ai-review.md` (`9c7db4a`)

### Quality & Verification

- [x] **Task 14**: Calibration suite — 9 fixture diffs + calibrate.ts runner (`c90d63b`)
- [x] **Task 15**: Integration test — E2E against live Ollama, skippable via INTEGRATION=1 (`46e0d7a`)
- [x] **Task 16**: Final wiring + verification — build clean, 19 unit tests pass, CLI --help, typecheck 0 errors (`945217d`)

## ✅ Guardrails (G1–G6, 2026-06-06)

- [x] **G1**: Hallucination cross-check — Critical/High requires ≥2 agents at same file+line (±5)
- [x] **G2**: Diff size guard — `maxDiffLines` (default 2000) + `--max-diff-lines` CLI flag
- [x] **G3**: Finding merge dedup — `corroboratingAgents` field on Finding schema
- [x] **G4**: Per-agent timeouts — `agentTimeoutMs` (default 180 s, raised from 60 s on 2026-07-14) + `--timeout` CLI flag
- [x] **G5**: Severity gating — `--fail-on` flag (critical|high|medium|any|never; default: high)
- [x] **G6**: Path exclusions — `.aiignore` + `--ignore-path` + `ignorePaths` config
- [x] **G8**: Configurable retry — `retryAttempts`/`retryDelayMs` config + `--retry-attempts`/`--retry-delay` CLI flags (`c2d2387`)

## 📊 Metrics

### Test Coverage

- **Unit Tests**: 295 passing across 37 test files (run `npm test` for current count)
- **Integration Tests**: 1 file, 5 tests — skip without INTEGRATION=1, run with live Ollama
- **Total**: 295

### Implementation Progress

- **Tasks complete**: 16 / 16 (100%) ✅ + Phase 2 (8 tasks) ✅ + v0.8.0 (5 new agents) ✅
- **Agents implemented**: 17 / 17 (16 specialists + orchestrator) ✅
- **TypeScript errors**: 0
- **GitHub**: https://github.com/unyieldingclaw-dev/ai-code-review-agent

## ✅ Phase 2 Improvements (2026-06-06)

- [x] **P2-1**: CLI consolidation — flatten review subcommand; --path→--dir, --max-diff-lines→--max-lines, --ignore-path→--ignore; add --no-sanitize
- [x] **P2-2**: Schema extensions — confidence field on Finding, sanitize on ReviewConfig, breaking-change/license AgentNames
- [x] **P2-3**: Prompt injection sanitizer — 9 unit tests
- [x] **P2-4**: BreakingChangeAgent — detects removed exports, signature changes, renamed APIs — 5 unit tests
- [x] **P2-5**: LicenseComplianceAgent — flags GPL/AGPL/SSPL/Commons Clause — 5 unit tests
- [x] **P2-6**: Confidence scoring — self-reported 0–100, confidence-aware hallucination check, shown in formatter — 6 unit tests
- [x] **P2-7**: Calibration CI — weekly + release schedule, self-hosted runner, graceful skip
- [x] **P2-8**: Documentation — README v0.2.0, CHANGELOG, slash command, memory-bank

## ✅ v0.5.0 Cursor/VS Code Extension (Complete)

- [x] **V5-1**: `vscode-extension/` scaffold — `package.json` (type: `extensionKind: ["workspace"]`), `tsconfig.json`, `esbuild` bundler config
- [x] **V5-2**: Core subprocess runner — spawn `ai-review-agent --format json`, capture stdout, parse `Finding[]`
- [x] **V5-3**: DiagnosticCollection adapter — map `Finding` → `vscode.Diagnostic`, push to collection
- [x] **V5-4**: OutputChannel renderer — format findings as markdown in "AI Review" output channel
- [x] **V5-5**: Command registration — `aiReview.reviewStagedChanges`, progress notification during run
- [x] **V5-6**: Bundling — bundle `ai-review-agent` into `.vsix` via esbuild/webpack, verify size
- [x] **V5-7**: README + publish — marketplace metadata, `vsce package`, smoke test in Cursor

## 🎯 Milestones

### Phase 1: Core Infrastructure (Complete)

- ✅ Project scaffold, type system, config, LLM provider, BaseAgent
- **Completed**: 2026-06-04

### Phase 2: Agents + Orchestration (Complete)

- ✅ 9 specialist agents (Tasks 6–8)
- ✅ Orchestrator (Task 9)
- ✅ SwarmRunner (Task 10)
- **Completed**: 2026-06-05

### Phase 3: CLI + Distribution (Complete)

- ✅ CLI + formatters (Task 11)
- ✅ GitHub Actions adapter + workflow (Task 12)
- ✅ Slash command (Task 13)
- ✅ Calibration suite (Task 14)
- ✅ Integration test — E2E (Task 15)
- ✅ Final wiring + verification (Task 16)
- **Completed**: 2026-06-06

## 📈 Version History

| Version         | Date          | Changes                                                                                                                                                                                                                                                                       |
| --------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.1.0-dev       | 2026-06-04    | Tasks 1–5: scaffolding, types, config, Ollama, BaseAgent                                                                                                                                                                                                                      |
| 0.1.0-dev       | 2026-06-05    | Tasks 6–10: all 10 agents, orchestrator, SwarmRunner (19 tests)                                                                                                                                                                                                               |
| 0.1.0           | 2026-06-06    | Tasks 11–16: CLI, GitHub Actions, slash command, calibration, e2e test, final verification                                                                                                                                                                                    |
| 0.1.1           | 2026-06-06    | Guardrails G1–G6: hallucination check, diff size guard, dedup merge, timeouts, severity gate, path exclusions (37 tests)                                                                                                                                                      |
| 0.2.0           | 2026-06-06    | Phase 2: CLI consolidation, sanitizer, BreakingChangeAgent, LicenseComplianceAgent, confidence scoring, calibration CI (62 tests)                                                                                                                                             |
| 0.3.0           | 2026-06-10    | npm distribution: package renamed `ai-review-agent`, release workflow, Node.js 24, published to npm                                                                                                                                                                           |
| 0.4.0           | 2026-06-11    | prompt tuning + calibration expansion: `confidence` on all 10 agents, calibrate.ts covers all 11, new breaking-change + license fixtures                                                                                                                                      |
| 0.5.0           | 2026-06-11    | Cursor/VS Code extension: subprocess architecture, bundled install, command palette trigger, DiagnosticCollection + OutputChannel (V5-1–V5-7)                                                                                                                                 |
| 0.5.0 (cleanup) | 2026-06-12    | vscode-extension dep → `^0.4.0` (npm), tarball removed from repo, `.gitignore` stale exception removed                                                                                                                                                                        |
| 0.6.0           | 2026-06-12    | MCP server: `ai-review-mcp` binary, `review_diff` tool, stdio transport, A+C hybrid output, 10 agents (no testgen), `.cursor/mcp.json`, 77 unit tests                                                                                                                         |
| 0.7.0           | 2026-06-13    | Configurable retry logic: `withRetryTimeout` wrapper, `retryAttempts`/`retryDelayMs` config fields, `--retry-attempts`/`--retry-delay` CLI flags, 3 new retry tests (80 total)                                                                                                |
| 0.8.0           | 2026-06-15    | 5 new specialist agents: ErrorHandlingAgent, ObservabilityAgent, MigrationSafetyAgent, SecretsAgent, ComplexityAgent; shell.ts runTool(); conditional MigrationSafety skip; 32 new unit tests (112 total); 5 calibration fixtures; README + config updated                    |
| 0.9.0–0.9.4     | 2026-06-18–19 | --fail-fast, progress events, calibration tuning, --parallel flag; 120 unit tests                                                                                                                                                                                             |
| 1.0.0           | 2026-06-24    | --profile (6 presets), --context memory-bank, --format sarif/github-annotations, policy layer (agentPolicy), extended Finding schema (domain/evidence/impact/recommendation/blocking/source), 15 agent prompts updated, 16/16 calibration, 248 tests                          |
| 1.0.1           | 2026-06-24    | Audit remediation: sanitizer multi-pattern fix, BaseAgent defaults tests, GitHub adapter tests, vitest coverage fix, CHANGELOG, JSDoc, contextBudgetChars, lineEnd clamp, AGENT_PRIORITY docs; 264 tests                                                                      |
| 1.1.0           | 2026-06-25    | --no-emoji, --context-mode semantic (nomic-embed-text), --context-budget, .aiignore negation, ESLint (0 warnings), coverage parser fixed, orchestrator breaking-change escalation, vscode-extension v0.6.0 (profiles + context), migration-safety fixture expanded; 276 tests |
| 1.2.0           | 2026-06-26    | SRP: parsing.ts extraction; semantic context warning; vscode-extension timeout; OllamaProvider SSRF hardening; MCP shutdown handlers; 295 tests; all 3-round audit findings resolved                                                                                          |
