# Agent 5 — New Security & Reliability Surface

**Date:** 2026-06-26
**Status:** Complete
**Finding count:** 7 (6 actionable findings + 1 advisory + 1 null result)

---

### Finding: OllamaProvider constructor throws unhandled TypeError on malformed URLs

- **Tag:** [NEW]
- **Severity:** Medium
- **Confidence:** Verified
- **Repository:** ACR
- **Evidence:** `src/core/llm/ollamaProvider.ts:10` — `const { hostname } = new URL(baseUrl)` with no surrounding try/catch
- **Reproduction:**
  1. Pass any input that is not a valid WHATWG URL, e.g. `new OllamaProvider('not-a-url', 'devstral:latest')`
  2. `new URL('not-a-url')` throws `TypeError: Invalid URL`
  3. No catch block exists — the TypeError propagates out of the constructor with no context-specific message; the CLI error handler receives a raw `TypeError` with no hint about which parameter was wrong or what a valid value looks like
- **Root Cause:** The URL parsing on line 10 has no try/catch. The allowlist check that follows it is the intended security gate, but any input that isn't parseable at all bypasses the allowlist entirely and surfaces as an opaque TypeError to the caller.
- **Fix:**
  ```ts
  let parsed: URL
  try {
    parsed = new URL(baseUrl)
  } catch {
    throw new Error(`Invalid Ollama URL "${baseUrl}". Expected e.g. http://localhost:11434`)
  }
  const { hostname } = parsed
  ```
- **Impact:** Users who pass a malformed URL (typo in config, wrong env var) get a clear error message instead of a raw stack trace. Also prevents the TypeError from being misread as an LLM connectivity failure by upstream error handlers.
- **Effort:** XS

---

### Finding: 0.0.0.0 in Ollama allowlist permits externally-bound Ollama instances

- **Tag:** [NEW]
- **Severity:** High
- **Confidence:** Strong Evidence
- **Repository:** ACR
- **Evidence:** `src/core/llm/ollamaProvider.ts:11` — `['localhost', '127.0.0.1', '::1', '0.0.0.0'].includes(hostname)`
- **Reproduction:**
  1. On Linux or in a container, start Ollama with `OLLAMA_HOST=0.0.0.0:11434` (common deployment pattern for shared dev boxes or Docker)
  2. Ollama is now reachable from any network interface, including external ones
  3. Set `ollamaUrl: "http://0.0.0.0:11434"` in `ai-review.config.json` or pass `--url http://0.0.0.0:11434`
  4. The hostname `0.0.0.0` passes the allowlist; the constructor does not throw
  5. Diff content — which may contain proprietary source code — is transmitted to `0.0.0.0:11434` on Linux, which routes to the first non-loopback interface when used as a destination address
  6. On a machine with external network access, this can mean sending diff content to an externally-reachable service
- **Root Cause:** `0.0.0.0` as a bind address means "accept on all interfaces". As a destination address, its behavior is OS-defined: on Linux it resolves to the loopback or first available interface, making it functionally equivalent to an external address. The error message in the constructor states "Remote Ollama instances are not supported (SSRF risk)" — `0.0.0.0` in the allowlist contradicts this intent.
- **Fix:** Remove `'0.0.0.0'` from the allowlist. Update the error message to guide users who have Ollama bound to `0.0.0.0`:
  ```
  `Use http://localhost:11434 or http://127.0.0.1:11434 instead. ` +
  `(If Ollama is bound to 0.0.0.0, connect via http://127.0.0.1:11434 — do not use 0.0.0.0 as the destination address.)`
  ```
- **Impact:** Closes the path where diff content containing proprietary source code is transmitted to an externally-accessible Ollama instance while the allowlist check falsely signals "localhost only". This is a one-line fix.
- **Effort:** XS

---

### Finding: --no-sanitize warning is silently discarded when stderr is redirected

- **Tag:** [NEW]
- **Severity:** Low
- **Confidence:** Verified
- **Repository:** ACR
- **Evidence:** `src/core/runner.ts:151-154` — `process.stderr.write('[ai-review] WARNING: --no-sanitize is active...\n')`; `README.md:167-168` — `--no-sanitize` described only as "use if sanitizer causes false positives" with no security callout
- **Reproduction:**
  ```bash
  ai-review-agent --no-sanitize --format json > report.json 2>/dev/null
  ```
  This is a standard CI pattern for capturing structured output while suppressing noise. The security warning is fully discarded. The operator receives a clean JSON report with `"sanitizer": {"enabled": false}` in the metadata but no visible alert. There is no mechanism to force the warning through when stderr is suppressed.
- **Root Cause:** Stderr is the correct channel for warnings, but there is no fallback path when stderr is closed. The README documents `--no-sanitize` without a security risk callout, which means operators may enable it routinely without understanding the implication (diff content from a PR can contain `IGNORE PREVIOUS INSTRUCTIONS`-style injections that reach the LLM unfiltered).
- **Fix (two parts):**
  1. Add a security warning to the README flag reference table entry for `--no-sanitize`:
     > **Security risk:** disables prompt injection protection. Diff content is passed to the LLM unfiltered. Do not use in automated pipelines that process untrusted diffs (e.g., public PR review bots).
  2. Optionally, promote the sanitizer-disabled state into the JSON report's top-level output as a `warnings` array entry so consumers can gate on it without relying on stderr:
     ```json
     "warnings": ["--no-sanitize active: prompt injection protection disabled"]
     ```
- **Impact:** Operators using `--no-sanitize` in CI without understanding the risk receive no indication. A README callout is the minimum acceptable fix; the JSON warnings field makes it machine-enforceable.
- **Effort:** XS

---

### Finding: gitleaks-action pinned to floating @v2 tag with contents:write and id-token:write

- **Tag:** [REGRESSION]
- **Severity:** High
- **Confidence:** Verified
- **Repository:** ACR
- **Evidence:** `.github/workflows/release.yml:44` — `uses: gitleaks/gitleaks-action@v2` (floating tag); `.github/workflows/release.yml:14-16` — `permissions: contents: write` and `id-token: write`
- **Reproduction:**
  1. The `v2` tag in the `gitleaks/gitleaks-action` GitHub repository is a mutable pointer — maintainers routinely update it to point to new commits as part of normal v2 release maintenance (this is standard GitHub Actions practice, not an attack; but it creates the attack surface)
  2. If the gitleaks repo is compromised, or if a maintainer account is taken over, a malicious commit can be pushed and the `v2` tag moved to it
  3. The next push of a `v*.*.*` tag to this repository triggers the release workflow, which runs the foreign code with:
     - `contents: write` — can push commits, create/delete branches, modify release assets
     - `id-token: write` — can request an OIDC token to authenticate as this repository for npm provenance signing and other OIDC-aware services
  4. A compromised action could exfiltrate `NPM_TOKEN` from the environment, push a backdoored commit to main, or create a provenance attestation for a tampered npm package
- **Root Cause:** Round 1 added the `gitleaks/gitleaks-action@v2` step during remediation without SHA-pinning. Floating version tags are the canonical GitHub Actions supply chain attack vector (documented in SLSA, GitHub's hardening guide, and multiple public CVEs). The combination of a third-party floating action with `id-token: write` is specifically called out as high-risk in the OpenSSF Scorecard checks.
- **Fix:**
  1. Pin to the current commit SHA. Get it with:
     ```bash
     gh api repos/gitleaks/gitleaks-action/git/ref/tags/v2 --jq '.object.sha'
     ```
     Then update the workflow:
     ```yaml
     uses: gitleaks/gitleaks-action@c8e9898f4698c1e8b7a2e87b5ad3c68e00b5af59 # v2.3.8 (verify current)
     ```
  2. Add Dependabot to receive automated SHA-pinning PRs when gitleaks releases updates:
     ```yaml
     # .github/dependabot.yml
     version: 2
     updates:
       - package-ecosystem: github-actions
         directory: /
         schedule:
           interval: weekly
     ```
- **Impact:** Prevents a supply chain compromise from gaining `contents: write` + `id-token: write` in the release pipeline, which could result in a backdoored npm package published under this project's provenance attestation. This is the highest-impact finding in this audit.
- **Effort:** XS

---

### Finding: VS Code extension test step has no timeout — release can hang for 6 hours

- **Tag:** [REGRESSION]
- **Severity:** High
- **Confidence:** Verified
- **Repository:** ACR
- **Evidence:** `.github/workflows/release.yml:40-41` — `name: VS Code extension tests` / `run: npm run test:extension` — no `timeout-minutes:` on the step; no job-level `timeout-minutes:` either
- **Reproduction:**
  1. Push a release tag (`v*.*.*`) to trigger the release workflow
  2. `npm run test:extension` invokes `@vscode/test-cli`, which spawns an Electron/VS Code process that requires a display server
  3. On `ubuntu-latest`, if `DISPLAY` is not set or Xvfb is not initialized, the VS Code process may hang waiting for a display connection — it does not always time out or exit with an error
  4. GitHub Actions applies a 360-minute (6-hour) default job timeout before killing the workflow
  5. The release hangs for up to 6 hours, blocking the npm publish and GitHub Release creation steps that follow this step
- **Root Cause:** The VS Code extension test step was added in Round 1 remediation without a `timeout-minutes:` guard. VS Code's test runner has known hang behavior in headless environments where Xvfb is not explicitly initialized. The step should either have a tight timeout or use `xvfb-run` to guarantee a display is available.
- **Fix:**
  ```yaml
  - name: VS Code extension tests
    timeout-minutes: 5
    run: xvfb-run --auto-servernum npm run test:extension
  ```
  If `xvfb-run` is already invoked inside the npm script, remove it from the workflow line but keep the `timeout-minutes: 5` guard. Five minutes is generous for a unit-style extension test suite; use 3 if tests are fast.
- **Impact:** A 6-hour release hang blocking npm publish is converted to a 5-minute failure with a clear timeout error, allowing rapid triage and re-release without burning the full GitHub Actions job quota.
- **Effort:** XS

---

### Finding: Null scope field in contract produces spurious out-of-scope warning on every file write

- **Tag:** [NEW]
- **Severity:** Medium
- **Confidence:** Verified
- **Repository:** PMB
- **Evidence:** `scripts/check-contract.ps1:38-45` — scope extraction falls to `else` branch for `$null`, setting `$scopeFiles = $null`; `scripts/check-contract.ps1:87-107` — `foreach ($pattern in $null)` iterates zero times, leaving `$inScope = $false`, triggering the warning block
- **Reproduction:**
  1. Create `.claude/contracts/active-task.json`:
     ```json
     { "status": "active", "task": "Fix typo in docs", "expires_at": "2099-01-01T00:00:00Z" }
     ```
     (Note: no `scope` field — a valid pattern for tasks that don't involve file writes, or an incomplete contract draft)
  2. Trigger any Write or Edit tool call via Claude Code
  3. Hook fires: `$rawScope = $contract.scope` → `$null`
  4. `$null -is [System.Array]` → `$false`; `$null -is [PSCustomObject]` → `$false`
  5. Falls to `else`: `$scopeFiles = $null`
  6. `foreach ($pattern in $null)` → zero iterations; `$inScope` stays `$false`
  7. Warning fires: "Writing to 'X' is outside the active contract. Declared scope: " (empty string after join)
  8. If `PMB_CONTRACT_HARD_BLOCK=1`, the write is **blocked entirely** — a contract with no scope field prevents all file writes
- **Root Cause:** The Round 1 scope extraction handles `[System.Array]` (ACR canonical format) and `[PSCustomObject]` (PMB template with `.files`) but has no explicit `$null` branch. A contract omitting `scope` entirely (e.g., for a non-file task, or an incomplete draft) causes false "out of scope" warnings or hard blocks on all writes.
- **Fix:** Add a null guard immediately after the scope extraction block (after line 45, before the `foreach` loop):
  ```powershell
  # If no scope is declared, skip scope enforcement entirely
  if (-not $scopeFiles) {
      exit 0
  }
  ```
  This is a 3-line addition. It treats a missing `scope` field as "no restriction declared" rather than "all paths blocked".
- **Impact:** Eliminates false warnings and hard blocks for contracts that legitimately declare no file scope. Currently, an incomplete contract draft or a task-only contract is more restrictive than intended, and repeated false warnings train users to dismiss them — undermining the hook's value for real scope drift.
- **Effort:** XS

---

> [CHECK 2 — Sanitization/truncation order]: No finding — The actual order in `preprocessDiff` is: (1) ignore filter, (2) sanitize, (3) truncate. The sanitizer runs on the full diff before truncation. This is the safe order: injection attempts at any line position are caught regardless of where they fall relative to the truncation boundary. Truncating after sanitization means no additional injection surface is created by the truncation cut point.

> [CHECK 7 — .pem WARN redundancy after gitignore addition]: Advisory — The `warn ".pem"` entry in `scripts/dangerous-commands.sh:83` is NOT redundant after adding `*.pem` to `.gitignore`. The gitignore prevents committing a `.pem` file; the WARN fires when Claude runs a shell command accessing the file's content at runtime (e.g., `cat server.pem`, `openssl x509 -in cert.pem`). These are distinct threat surfaces: commit-time vs. runtime exfiltration. However, `.pem` is a broad pattern that matches non-sensitive files (e.g., public CA bundles like `ca-bundle.pem`). The WARN fires on accessing a harmless public CA bundle, potentially training users to ignore it. No immediate code change required, but consider narrowing to `*key.pem`, `*private*.pem`, or pairing the pattern with `private` to reduce false-positive rate without losing coverage of actual private key access.

---

## Summary Table

| #   | Title                                                                   | Severity      | Tag        | Repo | Effort |
| --- | ----------------------------------------------------------------------- | ------------- | ---------- | ---- | ------ |
| 1   | OllamaProvider throws unhandled TypeError on malformed URL              | Medium        | NEW        | ACR  | XS     |
| 2   | `0.0.0.0` in Ollama allowlist permits externally-bound instances        | High          | NEW        | ACR  | XS     |
| 3   | `--no-sanitize` warning silently discarded via `2>/dev/null`            | Low           | NEW        | ACR  | XS     |
| 4   | gitleaks-action floating `@v2` with `contents:write` + `id-token:write` | High          | REGRESSION | ACR  | XS     |
| 5   | VS Code extension test step has no timeout — 6-hour hang risk           | High          | REGRESSION | ACR  | XS     |
| 6   | Null `scope` field in contract causes spurious warning/hard block       | Medium        | NEW        | PMB  | XS     |
| —   | `.pem` WARN redundancy advisory                                         | Advisory      | NEW        | PMB  | —      |
| —   | Sanitization/truncation order                                           | (null result) | —          | ACR  | —      |
