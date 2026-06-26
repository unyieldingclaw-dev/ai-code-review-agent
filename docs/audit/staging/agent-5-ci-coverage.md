# Agent 5 — CI/CD & Test Coverage Findings
**Date:** 2026-06-25
**Status:** Complete
**Finding count:** 10

---

## Check 1: Full Suite (`npm run check`)

**Command run:** `npm run check` (= `npm test && npm run typecheck && npm run build && npm run format:check && npm run lint:eslint`)

**Result:** EXIT 1 — format check failed.

```
[warn] docs/superpowers/plans/2026-06-24-pre-production-audit.md
[warn] Code style issues found in the above file. Run Prettier with --write to fix.
```

Tests: 276 passed (36 files). Typecheck: clean. Build: clean. ESLint: clean. Format: 1 file fails.

---

### Finding: Prettier format check fails on audit plan file

- **Severity:** Low
- **Confidence:** Verified
- **Repository:** ACR
- **Evidence:** `docs/superpowers/plans/2026-06-24-pre-production-audit.md` — `npm run check` exits 1 due to this file
- **Reproduction:** `cd "C:/Users/Mizzo/Claude/AI-Code-Review-Agent" && npm run check`
- **Root Cause:** The audit plan markdown file was written without running Prettier. The `check` script runs `format:check` which covers all files including `docs/`.
- **Fix:** `cd "C:/Users/Mizzo/Claude/AI-Code-Review-Agent" && npx prettier --write "docs/superpowers/plans/2026-06-24-pre-production-audit.md"` — or add `docs/superpowers/plans/` to `.prettierignore` if plan files intentionally bypass formatting.
- **Impact:** `npm run check` — the canonical gate before committing — fails on a clean repo. Any CI that runs `npm run check` (vs. `npm test` alone) would block all PRs.
- **Effort:** XS

---

## Check 2: Test Coverage

**Command run:** `npm run test:coverage`

**Overall coverage:**

| Metric     | %     |
|------------|-------|
| Statements | 72.99 |
| Branches   | 85.31 |
| Functions  | 93.63 |
| Lines      | 72.99 |

**Ten files with lowest branch coverage (ascending):**

| File                          | Branch % | Uncovered lines / notes       |
|-------------------------------|----------|-------------------------------|
| `cli/index.ts`                | 0%       | All 280 lines uncovered       |
| `core/llm/provider.ts`        | 0%       | Interface/type-only, no runtime code |
| `mcp/server.ts`               | 0%       | All 81 lines uncovered        |
| `utils/shell.ts`              | 100% (stmt 8%) | Branches trivially covered but body not exercised |
| `cli/formatters/sarif.ts`     | 71.42%   | Line 65                       |
| `core/agents/coverageAnalyst.ts` | 71.42% | Lines 101-128, 133-139     |
| `core/agents/testGen.ts`      | 76.47%   | Lines 76-88                   |
| `core/agents/base.ts`         | 75.47%   | Lines 100, 102-104, 112       |
| `core/runner.ts`              | 76.53%   | Lines 261-386, 417-424 (error paths) |
| `core/llm/ollamaProvider.ts`  | 72.22%   | Lines 49-53                   |

**Source files with 0% statement coverage:**

- `src/cli/index.ts` — 0% (280 lines): the CLI entry point is never exercised by unit tests
- `src/mcp/server.ts` — 0% (81 lines): the MCP server bootstrap is never exercised by unit tests

> CHECK 2 (agent file coverage gap): No agent source file lacks a corresponding test file. All 15 agents in `src/core/agents/` have a matching `tests/unit/*Agent.test.ts`. No finding on this sub-check.

---

### Finding: CLI entry point has 0% test coverage

- **Severity:** High
- **Confidence:** Verified
- **Repository:** ACR
- **Evidence:** `src/cli/index.ts` — 0% stmts, 0% branches, 0% funcs, 0% lines (all 280 lines); `npm run test:coverage` output
- **Reproduction:** `npm run test:coverage` → see `cli/index.ts | 0 | 0 | 0 | 0 | 1-280`
- **Root Cause:** Unit test suite runs `tests/unit/` only. The CLI entry point (`commander` argument parsing, `--format`, `--fail-on`, `--agents`, `--profile`, `--context`, `--fail-fast`, `--aiignore`, etc.) is tested nowhere except optionally in the integration suite (which requires a live Ollama and `INTEGRATION=1`).
- **Fix:** Add unit tests that import `src/cli/index.ts` against a mocked `SwarmRunner` and exercise: argument parsing for each flag, exit-code behavior, output format switching, `--fail-on` threshold evaluation, `--fail-fast` early exit, `--aiignore` path injection, error path when diff is missing.
- **Impact:** Regressions in CLI flag parsing or exit-code logic are invisible to CI. Flag additions go untested by default.
- **Effort:** M

---

### Finding: MCP server has 0% test coverage

- **Severity:** Medium
- **Confidence:** Verified
- **Repository:** ACR
- **Evidence:** `src/mcp/server.ts` — 0% across all metrics; `npm run test:coverage` output
- **Reproduction:** `npm run test:coverage` → see `mcp/server.ts | 0 | 0 | 0 | 0 | 1-81`
- **Root Cause:** `mcp/server.ts` registers MCP tools and starts the stdio server; no unit test exercises this file. `mcp/tool.ts` is partially tested (90.69%) and `mcp/formatter.ts` is at 100%, but the server bootstrap is untouched.
- **Fix:** Add a unit test that imports and mocks the MCP SDK transport, calls `startMcpServer()`, verifies the review tool is registered and returns a valid response shape.
- **Impact:** Breaking changes to the MCP integration surface go undetected.
- **Effort:** S

---

## Check 3: release.yml — publish-before-test risk

**Full workflow read:** `.github/workflows/release.yml`

**Findings:**

- Jobs: single job named `release` — there is no separate `test` job with a `needs:` clause
- Sequence within the job: `npm ci` → `npm run typecheck` → `npm test` → `npm run build` → `npm publish`
- Tests DO run before publish (steps are sequential in one job)
- Node.js version in CI: `'24'`; package.json `engines`: `>=18`
- `npm run format:check` and `npm run lint:eslint` are NOT run before publish — only `typecheck`, `test`, and `build`

> CHECK 3 (publish-before-test): No finding — tests run before publish within the single sequential job. Publish cannot execute if tests fail.

---

### Finding: Format check and ESLint not gated before npm publish

- **Severity:** Low
- **Confidence:** Verified
- **Repository:** ACR
- **Evidence:** `.github/workflows/release.yml` lines 28-38 — steps are: `typecheck`, `test`, `build`, then `npm publish`. `format:check` and `lint:eslint` are absent.
- **Reproduction:** Push a `v*.*.*` tag; Prettier and ESLint are not run; release proceeds even with style violations or lint errors.
- **Root Cause:** `release.yml` runs a subset of the `check` script (which is `npm test && typecheck && build && format:check && lint:eslint`), not the full `check` command.
- **Fix:** Replace the two separate `typecheck` + `test` steps with a single `npm run check` step, or add explicit `format:check` and `lint:eslint` steps before the publish step.
- **Impact:** Code with formatting violations or lint errors can be published to npm. The canonical gate (`npm run check`) that developers run locally does not match CI's release gate.
- **Effort:** XS

---

## Check 4: Secret exposure in CI workflows

All three workflow files read. Secret usages found:

| Workflow         | Secret reference                   | Usage pattern                  | Safe? |
|------------------|------------------------------------|--------------------------------|-------|
| `release.yml:40` | `${{ secrets.NPM_TOKEN }}`         | `env: NODE_AUTH_TOKEN: ...`    | Safe  |
| `release.yml:45` | `${{ github.token }}`              | `env: GH_TOKEN: ...`           | Safe  |
| `calibrate.yml`  | None                               | N/A                            | N/A   |
| `review.yml`     | None (uses `github.token` via action) | Passed via `actions/github-script@v7` | Safe |

> CHECK 4 (secret injection): No finding — all secret references use the safe `env:` block pattern. No direct shell-string interpolation of secrets found.

---

## Check 5: calibrate.yml Ollama-absent handling

**Full workflow read:** `.github/workflows/calibrate.yml`

- `continue-on-error: true` at the job level (line 14) — the workflow non-blocking
- Step `Check Ollama availability` (lines 27-34) sets `available=true/false` output and emits a `::warning::` annotation if Ollama absent
- All subsequent steps (`Install dependencies`, `Build`, `Run calibration`) have `if: steps.ollama.outputs.available == 'true'` — they are skipped entirely when Ollama is absent
- Runner is `self-hosted` — only runs on a machine with a self-hosted runner configured

> CHECK 5 (Ollama-absent handling): No finding — `calibrate.yml` gracefully skips all Ollama-dependent steps when Ollama is unavailable. The job is `continue-on-error: true` so a missing self-hosted runner (24h timeout on GitHub's side) does not block releases.

---

## Check 6: vscode-extension tests in CI

**Extension test script:** `"test": "vitest run"` in `vscode-extension/package.json`

**Extension test files found:** `vscode-extension/tests/config.test.ts`, `diagnostics.test.ts`, `runner.test.ts` — real test suite exists.

**Root package.json** has `"test:extension": "npm --prefix vscode-extension test"`.

**CI check:** grepped all three workflow files for `test:extension`, `vscode-extension.*test`, `prefix vscode-extension` — **zero matches**.

---

### Finding: vscode-extension test suite never runs in CI

- **Severity:** High
- **Confidence:** Verified
- **Repository:** ACR
- **Evidence:** No workflow file in `.github/workflows/` references `test:extension`, `vscode-extension`, or `npm --prefix`. The `test:extension` script exists in `package.json:47` but is not invoked anywhere in CI.
- **Reproduction:** Inspect `.github/workflows/release.yml`, `review.yml`, `calibrate.yml` — none contain `vscode-extension` or `test:extension`. The extension tests in `vscode-extension/tests/` (config, diagnostics, runner) are never automatically verified.
- **Root Cause:** The extension test script was added to `package.json` as a convenience shortcut but was not wired into any CI job.
- **Fix:** Add a step to `release.yml` (or a separate `extension-tests` CI job) before the publish step: `npm --prefix vscode-extension ci && npm run test:extension`. Alternatively add it to `npm run check`.
- **Impact:** Regressions in the VS Code extension (config parsing, CLI arg assembly, runner behavior) are invisible to CI. An extension release could ship broken behavior that only manifests in VS Code.
- **Effort:** S

---

## Check 7: npm pack output verification

**Command run:** `npm pack --dry-run`

**Included in tarball (159 files, 260.4 kB unpacked):** `dist/` tree, `README.md`, `LICENSE`, `package.json` (always included by npm).

**Verification against `"files": ["dist/", "README.md", "LICENSE"]`:**

| Directory / File     | In pack? | Expected? |
|----------------------|----------|-----------|
| `dist/`              | Yes      | Yes       |
| `README.md`          | Yes      | Yes       |
| `LICENSE`            | Yes      | Yes       |
| `tests/`             | No       | Correct — excluded |
| `calibration/`       | No       | Correct — excluded |
| `.claude/`           | No       | Correct — excluded |
| `vscode-extension/`  | No       | Correct — excluded |
| `docs/`              | No       | Correct — excluded |
| `src/`               | No       | Correct — excluded |

> CHECK 7 (npm pack): No finding — pack output matches the declared `"files"` field exactly. No sensitive or unnecessary content included.

---

## Check 8: Agents with no negative-path tests

Checked each agent test file for test cases covering malformed/empty/unexpected LLM output.

| Agent test file                  | Has negative-path test? |
|----------------------------------|------------------------|
| `securityAgent.test.ts`          | Yes                    |
| `correctnessAgent.test.ts`       | Yes                    |
| `performanceAgent.test.ts`       | Yes                    |
| `designAgent.test.ts`            | Yes                    |
| `dependenciesAgent.test.ts`      | Yes                    |
| `adversarialAgent.test.ts`       | Yes                    |
| `coverageAnalystAgent.test.ts`   | Yes                    |
| `testGenAgent.test.ts`           | Yes (too-short response) |
| `breakingChangeAgent.test.ts`    | Yes                    |
| `licenseComplianceAgent.test.ts` | Yes                    |
| `errorHandlingAgent.test.ts`     | Yes                    |
| `observabilityAgent.test.ts`     | Yes                    |
| `migrationSafetyAgent.test.ts`   | Yes                    |
| `secretsAgent.test.ts`           | Yes                    |
| `complexityAgent.test.ts`        | No — see below         |

---

### Finding: complexityAgent has no malformed-input / parse-failure test

- **Severity:** Medium
- **Confidence:** Verified
- **Repository:** ACR
- **Evidence:** `tests/unit/complexityAgent.test.ts` — 5 tests, none exercise the LLM returning invalid JSON, null, empty string, or `{}`. Contrast with every other agent test file which includes a "returns empty array on parse failure" case. The `ComplexityAgent` relies on `BaseAgent.parseFindings()` for JSON parsing (inherited), so the failure path exists but is untested at the `ComplexityAgent` level.
- **Reproduction:** Read `tests/unit/complexityAgent.test.ts` — no test case passes malformed LLM output and asserts `findings === []`.
- **Root Cause:** The test was written with 5 cases covering the lizard-tool integration path and valid/invalid LLM responses for the happy path, but the parse-failure scenario was not added.
- **Fix:** Add one test: `makeProvider('not json')` → `agent.run(input)` → `expect(findings).toEqual([])`. Mirror the pattern in `securityAgent.test.ts`.
- **Impact:** If `BaseAgent.parseFindings()` ever regresses on bad input specifically for the complexity path (e.g., lizard output confuses the parser), the failure would be silent.
- **Effort:** XS

---

## Check 9: Integration test coverage

**File read:** `tests/integration/e2e.test.ts`, `tests/helpers/requireOllama.ts`

**Distinct scenarios covered:**
1. Produces at least one finding from a deliberately bad diff
2. Summary counters are consistent with findings array
3. Every finding conforms to the `Finding` schema (severity, basis, title, detail, suggestion)
4. Security agent flags at least one issue

**Flag coverage assessment:**

| Flag / Feature     | Tested in e2e? |
|--------------------|---------------|
| `--format json`    | Implicitly — `SwarmRunner` is called directly, not via CLI; JSON shape validated | Partially |
| `--fail-on`        | No            |
| `.aiignore` exclusion | No         |
| `--fail-fast`      | No            |
| `--agents` selection | Yes (hardcoded to `['security', 'correctness']`) |
| Multiple agents    | Yes (2 agents) |

---

### Finding: Integration e2e test covers only one scenario and misses CLI-flag behaviors

- **Severity:** Medium
- **Confidence:** Verified
- **Repository:** ACR
- **Evidence:** `tests/integration/e2e.test.ts` — 4 `it()` blocks, all within a single `describe` covering one diff with two agents. `--fail-on`, `--fail-fast`, `.aiignore` exclusion, and `--format json` CLI output are not tested at the integration layer.
- **Reproduction:** Read `tests/integration/e2e.test.ts` — the only `describe` block uses `SwarmRunner` directly (not the CLI binary), so CLI flag parsing is untested end-to-end.
- **Root Cause:** The integration test was designed to validate core pipeline correctness (LLM → findings → schema) rather than CLI surface. The CLI entry point has 0% unit coverage (see Check 2), so neither layer covers CLI behavior.
- **Fix:** Add integration test scenarios: (a) invoke CLI binary via `execa` with `--format json` and assert parseable JSON output; (b) test `--fail-on high` returns exit code 1 when findings above threshold; (c) test `.aiignore` causes filtered file to produce no findings; (d) test `--fail-fast` stops after first finding.
- **Impact:** CLI regressions that break `--fail-on`, `--fail-fast`, or `.aiignore` in production are not caught by any automated test.
- **Effort:** M

---

## Check 10: Node.js version matrix in CI

**Node versions in CI:** All three workflows (`release.yml:21`, `review.yml:25`, `calibrate.yml:22`) specify `node-version: '24'`.

**package.json engines:** `"node": ">=18"`

---

### Finding: CI tests only on Node 24, not on the declared minimum (Node 18)

- **Severity:** Medium
- **Confidence:** Verified
- **Repository:** ACR
- **Evidence:** All three workflow files use `node-version: '24'`; `package.json` declares `engines: { "node": ">=18" }`
- **Reproduction:** Inspect `.github/workflows/release.yml:21`, `review.yml:25`, `calibrate.yml:22` — all `node-version: '24'`
- **Root Cause:** Node 24 was chosen for FORCE_JAVASCRIPT_ACTIONS_TO_NODE24 compatibility but the minimum supported version (18) is never validated.
- **Fix:** Add a matrix job to `release.yml` (or a separate `compat` workflow):
  ```yaml
  strategy:
    matrix:
      node: ['18', '20', '24']
  ```
  Run at minimum `npm test` on each version. Node 18 is the declared minimum and currently in LTS maintenance — users on Node 18 could hit regressions that Node 24 silently masks (e.g., differences in ESM `fetch` availability, `--experimental-vm-modules` behavior).
- **Impact:** A user on the minimum-supported Node 18 may encounter runtime failures that never surfaced in CI. Publishing to npm while only testing on Node 24 is a silent compatibility risk.
- **Effort:** S

---

## Check 11: NPM_TOKEN expiry — no automated warning

**Token expiry:** `github-actions-publish` expires 2026-09-08 (documented in `memory-bank/activeContext.md`).

**Scheduled workflows:** Only `calibrate.yml` has a `cron:` schedule (`0 6 * * 1` — Mondays). It does not check token expiry.

**Token rotation documentation:** Mentioned in `memory-bank/activeContext.md` as a manual reminder only. No runbook file, no CI gate, no `CONTRIBUTING.md` entry.

---

### Finding: NPM_TOKEN expiry has no automated warning — silent release failure in ~75 days

- **Severity:** Medium
- **Confidence:** Verified
- **Repository:** ACR
- **Evidence:** `memory-bank/activeContext.md` — "NPM token renewal: `github-actions-publish` token expires Sep 8 2026". No `cron:` job in any workflow checks expiry. `calibrate.yml` runs weekly but only verifies Ollama calibration.
- **Reproduction:** On 2026-09-09, push a `v*.*.*` tag → `release.yml` `npm publish` step fails with `401 Unauthorized` — no prior warning anywhere in CI.
- **Root Cause:** npmjs.com automation tokens have configurable expiry but do not proactively notify. The only record of the expiry date is a memory-bank note, which is not machine-readable.
- **Fix (Option A — cheap):** Add a dedicated step at the top of `release.yml`:
  ```yaml
  - name: Check token expiry reminder
    run: |
      EXPIRY="2026-09-08"
      DAYS=$(( ($(date -d "$EXPIRY" +%s) - $(date +%s)) / 86400 ))
      if [ "$DAYS" -lt 30 ]; then
        echo "::warning::NPM_TOKEN expires in $DAYS days ($EXPIRY). Renew at npmjs.com."
      fi
  ```
  **Fix (Option B — robust):** Add a monthly `cron:` workflow that computes days-to-expiry and opens a GitHub issue if `< 30 days`.
- **Impact:** All future npm releases silently fail starting 2026-09-09 with no advance warning. The package becomes unpublishable until the token is rotated — which only requires knowing the expiry date exists, which is only in a memory-bank note.
- **Effort:** XS (Option A) / S (Option B)

---

## Check 12: PMB has no CI

**PMB `.github/workflows/` contents:** `pmb-health.yml` — PMB **does have CI**.

**CI jobs in `pmb-health.yml`:**

- `file-size` — enforces per-file line limits on memory-bank files
- `forbidden-patterns` — credential grep, spec placeholder grep, shellcheck on scripts/
- `secret-scan` — gitleaks scan
- `sast` — Semgrep on shell scripts
- `rules-file-integrity` — invisible Unicode, hidden HTML comments, LLM bypass phrases in CLAUDE.md
- `template-integrity` — validates hook script references in `templates/.claude/settings.json`
- `mb-command-tests` — `bash tests/run.sh` (confirmed: PMB has `tests/` with 12 test scripts)
- `powershell-lint` — PSScriptAnalyzer on `.ps1` files
- `mb-doctor-self-check` — runs `mb doctor` on the repo itself

> CHECK 12 (PMB has no CI): No finding — PMB has comprehensive CI (`pmb-health.yml`) including actual command tests (`tests/run.sh`), SAST, secret scanning, rules-file integrity, and PowerShell linting. The premise in the assignment is incorrect.

---

## Summary Table

| # | Finding                                           | Severity | Confidence | Effort |
|---|---------------------------------------------------|----------|------------|--------|
| 1 | Prettier fails on audit plan — `npm run check` broken | Low  | Verified   | XS     |
| 2 | CLI entry point (`src/cli/index.ts`) at 0% coverage | High   | Verified   | M      |
| 3 | MCP server (`src/mcp/server.ts`) at 0% coverage   | Medium   | Verified   | S      |
| 4 | `format:check` + ESLint not gated before npm publish | Low   | Verified   | XS     |
| 5 | vscode-extension tests never run in CI            | High     | Verified   | S      |
| 6 | `complexityAgent` missing parse-failure test      | Medium   | Verified   | XS     |
| 7 | Integration e2e: single scenario, CLI flags untested | Medium | Verified   | M      |
| 8 | CI only tests Node 24, not minimum Node 18        | Medium   | Verified   | S      |
| 9 | NPM_TOKEN expires 2026-09-08 with no automated warning | Medium | Verified | XS–S  |
| — | *No finding* — secret injection in CI             | —        | Verified   | —      |
| — | *No finding* — calibrate.yml Ollama handling      | —        | Verified   | —      |
| — | *No finding* — npm pack includes unwanted files   | —        | Verified   | —      |
| — | *No finding* — PMB lacks CI                       | —        | Verified   | —      |
| — | *No finding* — publish-before-test race           | —        | Verified   | —      |
