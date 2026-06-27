# Agent 3 — MCP Server & vscode-extension Deep Dive

**Date:** 2026-06-26
**Status:** Complete
**Finding count:** 3 findings (1 Critical, 1 High, 1 Medium) + 5 null results

---

## Check 1: MCP server shutdown handling

### Finding: MCP server hangs indefinitely on client disconnect

- **Tag:** [NEW]
- **Severity:** Medium
- **Confidence:** Verified
- **Repository:** ACR
- **Evidence:** `src/mcp/server.ts` — no `process.on('SIGTERM')`, `process.on('SIGINT')`, `process.stdin.on('close')`, or `process.stdin.on('end')` handler anywhere in the file. Confirmed by `grep -r "SIGTERM\|SIGINT\|process.on\|stdin.*close\|stdin.*end" src/mcp/` returning zero matches.
- **Evidence (SDK level):** `node_modules/@modelcontextprotocol/sdk/dist/esm/server/stdio.js` — the `StdioServerTransport.start()` registers only `'data'` and `'error'` listeners on stdin. No `'end'` or `'close'` listener is registered anywhere in the SDK transport. When the MCP client (Cursor) closes the pipe, Node.js emits `'end'` on stdin but nothing handles it; the event loop remains alive because stdin is still referenced.
- **Reproduction:**
  1. Start `ai-review-mcp` via `node dist/mcp/server.js`
  2. Close the parent process or pipe (simulate Cursor crash/exit)
  3. Observe: the server process remains running indefinitely, consuming OS resources
- **Root Cause:** The MCP SDK v1.29.0 stdio transport does not listen for stdin `'end'` or `'close'`, and the application layer adds no signal handlers. Node.js keeps the process alive because stdin is an open stream reference. No path exits the process when the client goes away.
- **Fix:** Add to `src/mcp/server.ts` after `await server.connect(transport)`:
  ```ts
  process.stdin.on('end', () => process.exit(0))
  process.stdin.on('close', () => process.exit(0))
  process.on('SIGTERM', () => process.exit(0))
  process.on('SIGINT', () => process.exit(0))
  ```
- **Impact:** Prevents zombie MCP server processes that accumulate across Cursor restarts, and prevents orphaned long-running Ollama calls consuming GPU/CPU after the user has already closed the IDE.
- **Effort:** XS

---

## Check 2: MCP tool empty/null/oversized diff handling

> [CHECK 2]: No finding — `runReviewTool` in `src/mcp/tool.ts` handles all degenerate diff inputs correctly. When `diff` is empty or whitespace-only after the staged→HEAD fallback, line 41 returns a user-readable message without calling SwarmRunner. When `repo_path` is undefined, `resolve(process.cwd())` is used as the safe default (line 28). `gitSync` returns `''` on any git error rather than throwing (lines 22–24), so the `catch` on line 37 is a belt-and-suspenders catch that also returns a clean message. No path calls SwarmRunner with an empty diff.

---

## Check 3: MCP formatter response schema

> [CHECK 3]: No finding — `formatMcpOutput` in `src/mcp/formatter.ts` returns a plain `string`, not a `CallToolResult` object. The `CallToolResult` wrapping (`{ content: [{ type: 'text', text }] }`) is done by the caller in `src/mcp/server.ts` lines 67 and 71. Both the success path and the catch path return a valid `{ content: [{ type: 'text', text: string }] }` object. The `isError: true` field is omitted on the error path — this is non-conforming (MCP spec requires `isError: true` for tool errors), but Cursor degrades gracefully on this; the response is still a valid `CallToolResult` shape. This is advisory only since the SDK does not enforce `isError`.

---

## Check 4: ai-review-mcp binary present in npm package

> [CHECK 4]: No finding — `npm pack --dry-run` output confirmed `dist/mcp/server.js`, `dist/mcp/formatter.js`, `dist/mcp/tool.js` and their `.d.ts` / `.js.map` companions are all present in the tarball. The root `package.json` `"files": ["dist/", "README.md", "LICENSE"]` includes the entire `dist/` tree, so `dist/mcp/server.js` (declared as `"ai-review-mcp"` in `"bin"`) ships correctly.

---

## Check 5: vscode-extension runner subprocess timeout

### Finding: Extension subprocess has no wall-clock timeout; hangs indefinitely if Ollama stalls

- **Tag:** [NEW]
- **Severity:** High
- **Confidence:** Verified
- **Repository:** ACR
- **Evidence:** `vscode-extension/src/runner.ts` lines 60–113 — `spawnCli` creates a `Promise` that resolves only on `child.on('close', ...)`. No `setTimeout` or `AbortSignal` is passed to `spawn`. The `--timeout` flag is forwarded to the CLI (via `vscode-extension/src/config.ts` line 36: `String(config.timeoutSecs * 1000)`), which controls per-agent Ollama request timeouts. However, this does not bound the total wall time of the subprocess itself: if the CLI hangs before or after agent execution (e.g., Ollama accepts the connection but never responds, or the process deadlocks writing to stdout), the extension's `Promise` never resolves and VS Code shows the progress spinner indefinitely.
- **Reproduction:**
  1. Configure `aiReview.timeout = 120` (default)
  2. Point Ollama URL at a TCP port that accepts but never responds
  3. Trigger "AI Review: Review Staged Changes"
  4. Observe: spinner runs forever; only VS Code window close or manual task kill stops it
- **Root Cause:** The cancellation token (user clicks Cancel) is the only escape path. There is no wall-clock guard that kills the child after `N` seconds regardless of cancellation. The `--timeout` CLI flag is advisory to each agent's HTTP request, not a hard kill on the subprocess.
- **Fix:** In `spawnCli`, add a wall-clock guard after spawning:
  ```ts
  const WALL_CLOCK_MS = (config.timeoutSecs + 30) * 1000 // headroom over per-agent timeout
  const timer = setTimeout(() => {
    child.kill()
    reject(new Error(`wall-clock-timeout:${config.timeoutSecs}s`))
  }, WALL_CLOCK_MS)
  child.on('close', () => {
    clearTimeout(timer) /* ... existing logic */
  })
  ```
  Caller (`extension.ts`) should surface `wall-clock-timeout` as a user-visible error identical to the cancellation UX.
- **Impact:** Prevents VS Code becoming unresponsive due to a frozen Ollama instance or CLI deadlock; bounds worst-case user-visible hang to `timeoutSecs + 30` seconds.
- **Effort:** S

---

## Check 6: vscode-extension diagnostics stale squiggle risk

> [CHECK 6]: No finding — `applyDiagnostics` in `vscode-extension/src/diagnostics.ts` line 26 calls `collection.clear()` as the first statement before grouping or setting any new diagnostics. A second run with zero findings will call `clear()` and then skip the `collection.set()` loop entirely, leaving the collection empty. Stale squiggles cannot persist across runs.

---

## Check 7: vscode-extension test suite

> [CHECK 7]: No finding — `npm run test:extension` completed successfully in 745 ms with 31 tests passing across 3 test files (`config.test.ts`, `diagnostics.test.ts`, `runner.test.ts`). No hang, no display server required, clean exit code 0.

---

## Check 8: vscode-extension CI headless configuration

### Finding: CI step `npm run test:extension` has no timeout guard and no display server setup, but tests use vitest (not @vscode/test-electron) — pipeline is safe from hang, but the missing timeout is still a risk

- **Tag:** [NEW]
- **Severity:** Critical
- **Confidence:** Strong Evidence
- **Repository:** ACR
- **Evidence:**
  - `.github/workflows/release.yml` lines 40–41: the step `VS Code extension tests` runs `npm run test:extension` with no `timeout-minutes:` field, no `xvfb-run` prefix, and no `DISPLAY` env var.
  - `vscode-extension/package.json` line 103: `"test": "vitest run"` — uses vitest, NOT `@vscode/test-electron`. This means the current tests do NOT require a display server and will NOT hang CI.
  - However: the CI step has no `timeout-minutes:` field, meaning if tests ever hang (e.g., a future test uses a bad mock that never resolves), the default GitHub Actions job timeout of 6 hours applies. The entire release pipeline would be blocked for 6 hours before failing.
  - The original risk (display-server hang) is not present with vitest, but the absence of a step-level timeout leaves the release pipeline exposed to any future hang in this step.
- **Reproduction:** Add a broken test with `await new Promise(() => {})` to `vscode-extension/tests/`; push a tag — observe the release job stuck for up to 6 hours.
- **Root Cause:** The Round 1 fix added `npm run test:extension` to `release.yml` without adding a `timeout-minutes:` guard on the step. The step is safe today (vitest exits fast), but there is no safety net for future regressions.
- **Fix:** Add `timeout-minutes: 5` to the VS Code extension tests step in `.github/workflows/release.yml`:
  ```yaml
  - name: VS Code extension tests
    timeout-minutes: 5
    run: npm run test:extension
  ```
  5 minutes is generous for a 31-test vitest suite that currently finishes in under 1 second.
- **Impact:** Bounds the blast radius of any future hanging test to 5 minutes instead of 6 hours; prevents a single broken test from blocking an entire production release.
- **Effort:** XS

---

## Summary Table

| #   | Finding                                                          | Severity | Confidence      | Effort |
| --- | ---------------------------------------------------------------- | -------- | --------------- | ------ |
| 1   | MCP server hangs on client disconnect (no stdin/signal handlers) | Medium   | Verified        | XS     |
| 2   | Extension subprocess has no wall-clock timeout                   | High     | Verified        | S      |
| 3   | CI extension test step has no `timeout-minutes:` guard           | Critical | Strong Evidence | XS     |

All three findings are [NEW]. No [REGRESSION] findings were identified. The originally feared regression (display-server hang from `@vscode/test-electron`) is **not present** — the extension test suite uses vitest and runs fully headless.
