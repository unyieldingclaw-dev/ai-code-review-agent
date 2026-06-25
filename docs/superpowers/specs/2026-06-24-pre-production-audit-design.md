# Pre-Production Readiness Audit — Design Spec

**Date:** 2026-06-24
**Status:** Approved
**Scope:** Personal-Memory-Bank (PMB v1.2.0) + AI-Code-Review-Agent (ACR v1.0.1)
**Goal:** Determine whether both projects are genuinely production-ready, not merely apparently so.

---

## Mission

Aggressively evaluate both repositories as a pre-production readiness assessment. Do not validate assumptions. Attempt to prove the software is not production-ready. Assume nothing works until verified empirically.

---

## Architecture

Seven agents. Six domain agents run in parallel; one consolidation agent runs after all six complete.

```
┌──────────────────────────────────────────────────────┐
│              PARALLEL (Agents 1–6)                   │
│  Agent 1: Security & Secrets                         │
│  Agent 2: Reliability & Failure Modes                │
│  Agent 3: Architecture & Technical Debt              │
│  Agent 4: Documentation & Developer Experience       │
│  Agent 5: CI/CD & Test Coverage                      │
│  Agent 6: Integration & Ecosystem Conflicts          │
└──────────────────────────┬───────────────────────────┘
                           │ all findings
                           ▼
              Agent 7: Consolidation
              → 20-section report
```

---

## Agent Definitions

### Agent 1 — Security & Secrets

**Repositories:** Both.

**Empirical tasks:**
- Grep for credential patterns; check `.gitleaks.toml` for allow-list abuse
- Read `.claude/settings.json` permissions in both repos — check for over-permissive blocks
- Verify secret scanning exists in CI workflows
- Check `.gitignore` coverage for secrets files
- Read `standards/SECRETS.md` vs enforcement hooks — verify alignment
- Trace trust boundaries: what does `mb.sh` execute; does it sanitize shell inputs?
- Review `src/core/sanitizer.ts` — test all 9 injection patterns; check for missed vectors
- Verify Ollama endpoint is not hardcoded or injectable via env
- Inspect `src/adapters/github.ts` — token handling, logging risks, token exposure in error output
- Check if `--no-sanitize` flag is appropriately guarded

**Output:** Findings tagged `security` with Verified/Strong/Likely/Speculative confidence.

---

### Agent 2 — Reliability & Failure Modes

**Repositories:** Both.

**Empirical tasks:**
- Trace Ollama-down failure path: does ACR hang, timeout, or fail gracefully?
- Read `src/core/runner.ts` — retry logic, timeout propagation, partial-failure handling
- Check `.aiignore` malformed input handling
- Read all PMB hook scripts — verify shell exit code propagation (`set -e`, `$?` checks)
- Read `pre-push-check.sh` and `.ps1` — test edge cases: no staged files, empty diff, binary files, CRLF issues
- Trace `contracts/active-task.json` corruption path — what fails, how visibly?
- Verify `mb init` idempotency — safe to run twice?
- Verify `mb upgrade` handles missing template files gracefully
- Examine `src/core/agents/base.ts` parse-failure path — what's logged, what's swallowed?
- Verify `SwarmRunner` exit codes propagate to CLI process exit code
- Check for race conditions in sequential agent execution loop
- Verify `--fail-fast` exits cleanly without corrupting output

**Output:** Findings tagged `reliability`.

---

### Agent 3 — Architecture & Technical Debt

**Repositories:** Both.

**Empirical tasks:**
- Map the full ACR call graph: `CLI → SwarmRunner → agents → OllamaProvider`
- Count abstraction layers; flag unnecessary indirection
- Evaluate `BaseAgent` scope — does it do too much (parse + validate + prompt + retry)?
- Check for dead code: removed Anthropic provider — are there residual references, types, imports?
- Read `src/core/contextLoader.ts` — how is context selected? Is `nomic-embed-text` actually invoked?
- Read `src/core/policyFilter.ts` — is it tested? Does it add measurable value?
- Evaluate PMB governance complexity: count hooks × scripts × rules × contracts — is overhead proportionate?
- Identify duplicated PMB concepts: `mb doctor` vs `health-check` vs `pmb-status` — what's the actual distinction?
- Flag governance creep: rules that add friction without verified benefit
- Read `src/core/agents/orchestrator.ts` — dedup logic complexity vs simpler alternatives
- Identify files that violate single-responsibility (too many concerns per file)
- Check for `any` types, disabled lint rules, `@ts-ignore` suppressions

**Output:** Findings tagged `architecture`, `tech-debt`, `overengineering`.

---

### Agent 4 — Documentation & Developer Experience

**Repositories:** Both.

**Empirical tasks:**
- Follow `install.sh` / `init-memory-bank.sh` from scratch — does it work exactly as documented?
- Follow ACR README install steps exactly — note every gap or assumption
- Verify every CLI flag in `--help` matches documentation
- Measure onboarding time against PMB's stated SLA (< 10 minutes)
- Verify `CLAUDE.md` in ACR is accurate and non-contradictory with PMB canonical
- Audit all memory bank files in both repos for staleness vs current observable state
- Run `mb status`, `mb doctor`, `mb query` with no prior state — check error messages
- Verify error messages are actionable (not "Error: undefined" or silent failures)
- Check for missing troubleshooting sections in all docs
- Read `/ai-review` Claude command — accurate, complete, correct flag names?
- Verify `CHANGELOG.md` version history matches git tags and package.json versions

**Output:** Findings tagged `docs`, `dx`, `onboarding`.

---

### Agent 5 — CI/CD & Test Coverage

**Repository:** ACR (PMB has no CI pipeline).

**Empirical tasks:**
- Read all three workflows: `release.yml`, `review.yml`, `calibrate.yml` — check logic, missing steps, secret exposure
- Run `npm run check` — verify full check suite passes
- Run `npm run test:coverage` — identify untested files and uncovered code paths
- Identify agents with zero negative-path tests
- Read calibration fixtures — do they cover the claimed failure modes?
- Verify `release.yml` runs tests before publish; check for accidental publish on broken build
- Check `calibrate.yml` graceful Ollama-absent handling — does it skip or fail?
- Identify missing integration tests (coverage beyond the single `e2e.test.ts`)
- Check vscode-extension test suite — does it run in CI?
- Run `npm pack --dry-run` — verify package includes only declared files
- Check Node.js version matrix — does CI test on the minimum supported version (>=18)?
- Verify `NPM_TOKEN` expiry warning is actionable (noted as expiring Sep 8 2026)

**Output:** Findings tagged `ci`, `test-coverage`, `test-quality`.

---

### Agent 6 — Integration & Ecosystem Conflicts

**Repositories:** Both together.

**Empirical tasks:**
- Map all duplicated commands between ACR and PMB (`/code-review`, `/security-review`, etc.)
- Read PMB's `/change-review` — does the ACR bridge section actually work? What's the exact integration point?
- Identify conflicting terminology (PMB `authority`/`confidence: high/medium/low` vs ACR `confidence` 0–100)
- Verify ACR's `CLAUDE.md` is in sync with PMB's canonical template
- Diff `standards/` files in ACR vs PMB — identify divergence
- Verify "governed assistance" model is consistently described across both repos
- Compare memory bank file structure and frontmatter schema between the two projects
- Identify PMB governance rules that contradict actual ACR behavior
- Test: running both `/code-review` (PMB) and `/ai-review` (ACR) on the same diff — do outputs conflict or complement?
- Check if ACR version referenced anywhere in PMB matches actual ACR version
- Verify PMB's `active-task.json` contract schema matches ACR's

**Output:** Findings tagged `integration`, `ecosystem`, `consistency`.

---

### Agent 7 — Consolidation

Receives all findings from Agents 1–6. Performs:
- Deduplication: merge findings that refer to the same root cause
- Cross-referencing: link related findings across domains
- Severity ranking: Critical → High → Medium → Low → Advisory
- Fill the 20-section report template (see below)
- Write Executive Summary (≤ 400 words)
- Write Production Readiness Verdict

---

## Report Structure (20 Sections)

1. Executive Summary
2. Overall Readiness Assessment
3. Critical Issues (Must Fix)
4. High Priority Issues
5. Medium Priority Issues
6. Low Priority Issues
7. Missing Features
8. Missing Guardrails
9. Incorrect Guardrails
10. Security Concerns
11. Reliability Concerns
12. Performance Concerns
13. Documentation Issues
14. Developer Experience Issues
15. Integration Problems
16. Architecture Critique
17. Technical Debt
18. Quick Wins
19. Long-Term Recommendations
20. Production Readiness Verdict

---

## Finding Format

Every finding includes:

| Field | Content |
|---|---|
| Title | Short imperative phrase |
| Severity | Critical / High / Medium / Low / Advisory |
| Confidence | Verified / Strong Evidence / Likely / Speculative |
| Repository | PMB / ACR / Both |
| Evidence | What was observed (file path, line, output) |
| Reproduction Steps | Exact steps to trigger |
| Root Cause | Why it happens |
| Recommended Fix | Specific, actionable |
| Expected Impact | What improves when fixed |
| Estimated Effort | XS / S / M / L / XL |

---

## Confidence Definitions

| Label | Meaning |
|---|---|
| Verified | Command executed, output observed, defect confirmed |
| Strong Evidence | Code read; behavior clearly implied by implementation |
| Likely | Pattern matches known failure mode; not directly tested |
| Speculative | Reasonable inference; unverified |

---

## Known Execution Constraints

The following cannot be empirically tested in this session. Findings in these areas will be labeled accordingly:

- Ollama-live integration (Ollama not confirmed running)
- Cross-platform Linux/macOS shell behavior
- GitHub Actions execution (requires remote CI)
- npm publish dry-run to real registry
- Fresh clone on a clean machine

---

## Repositories

- **PMB:** `C:\Users\Mizzo\Claude\Personal-Memory-Bank` (v1.2.0)
- **ACR:** `C:\Users\Mizzo\Claude\AI-Code-Review-Agent` (v1.0.1, 264 tests passing)

---

## Pre-Audit Known Findings (Seed for Agents)

The following was observed during context exploration and should be verified/expanded by the relevant agent:

- **ACR memory bank staleness (Agent 4):** `activeContext.md` reports 120 tests; `npm test` shows 264. Significant drift.
- **PMB `.claude/commands/` not visible to Bash glob (Agent 4):** Windows path quoting issue or `.claude` hidden-dir exclusion — affects tooling that relies on glob discovery.
- **NPM_TOKEN expiry (Agent 5):** Documented in activeContext.md as expiring 2026-09-08. No automated reminder or rotation process.
