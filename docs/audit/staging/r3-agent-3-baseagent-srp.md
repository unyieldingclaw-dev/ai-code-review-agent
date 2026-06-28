# Agent 3 — BaseAgent SRP Refactor

**Date:** 2026-06-26
**Status:** Complete
**Items fixed:** 1 ([FIXED])
**Commit:** d64712f06e91f7bf5062edf531e8d31a98588767

---

### Finding: BaseAgent carries 19 distinct concerns in one class

- **Tag:** [FIXED]
- **Severity:** High
- **Confidence:** Verified
- **Repository:** ACR
- **Evidence:** `src/core/agents/base.ts` — `validateFindings()` alone does 10 sub-tasks; entire class has 19 distinct responsibilities
- **Reproduction:** Read `validateFindings()` in base.ts — filter, aliasing, clamping, defaulting, stamping, logging are all in one method
- **Root Cause:** Finding normalization accumulated in BaseAgent without extraction
- **Fix:** Extracted to `src/core/parsing.ts::validateAndNormalizeFindings()` — commit d64712f06e91f7bf5062edf531e8d31a98588767
- **Impact:** BaseAgent focuses on LLM call + parse pipeline; normalization is independently testable
- **Effort:** M
