# Agent 5 — vscode-extension Subprocess Timeout

**Date:** 2026-06-27
**Status:** Complete
**Items fixed:** 1 ([FIXED])
**Commit:** c82db0b90261f930bc63a8076f3398c920603632

---

### Finding: vscode-extension subprocess has no wall-clock timeout

- **Tag:** [FIXED]
- **Severity:** High
- **Confidence:** Verified
- **Repository:** ACR
- **Evidence:** `vscode-extension/src/runner.ts::spawnCli()` — resolves only on `child.on('close')`; no setTimeout guard
- **Reproduction:** Start a review with Ollama stalled — VS Code progress spinner runs indefinitely
- **Root Cause:** `spawnCli` relied solely on the child process closing naturally
- **Fix:** Added `setTimeout` (default 5 min) that kills the child and rejects with clear message — commit c82db0b90261f930bc63a8076f3398c920603632
- **Impact:** Extension times out gracefully; users see actionable error instead of frozen UI
- **Effort:** S
