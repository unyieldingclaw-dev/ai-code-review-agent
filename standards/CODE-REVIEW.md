# Code Review Standard

Purpose: define what constitutes a complete review.
This standard does not mandate agent topology, model, or phase count.

## Required Domains
- Security
- Correctness
- Maintainability
- Testing
- Architecture Drift — changes that contradict patterns in systemPatterns.md or introduce abstractions not established elsewhere in the project.

## Conditional Domains
- Performance — activate for runtime-sensitive changes (tight loops, DB queries, I/O paths)
- Accessibility — activate for UI file changes (HTML/JSX/TSX/Vue/Svelte)

## Severity Levels
Critical → High → Medium → Low → Info

## Required Finding Fields
Domain, Severity, Location, Evidence, Basis, Impact, Recommendation, Blocking

Field value scales: Severity uses `Critical | High | Medium | Low | Info`. Blocking uses `true | false`. Basis uses `VERIFIED | INFERRED | SPECULATIVE`.

## Basis Classification

The `Basis` field classifies the epistemic origin of a finding — how the agent arrived at it.

| Basis | Meaning |
|---|---|
| `VERIFIED` | Agent directly observed the defect at the cited location |
| `INFERRED` | Agent reasoned from a code pattern; behavior not directly confirmed |
| `SPECULATIVE` | Suspected risk; consequence is uncertain |

## Evidence Requirements

Evidence must include a `file:line` reference. Prose alone ("this may cause...") is not valid evidence.

**VERIFIED** — must include `file:line` + code excerpt or precise behavioral description.

**INFERRED** — must include `file:line` + reasoning chain explaining the inference.

**SPECULATIVE** — must include `file:line` + observed trigger (the specific code pattern that raised the concern) + explicit uncertainty statement (why the consequence cannot be confirmed). The uncertainty is about the consequence, not the existence of the code.

## Blocking Semantics

`Blocking: true` requires `Severity >= High AND Basis != SPECULATIVE`.

- Critical/High + VERIFIED or INFERRED → may be `Blocking: true`
- Any Severity + SPECULATIVE → must be `Blocking: false`
- Medium/Low/Info → `Blocking: false` by default

High findings default to `Blocking: true` unless the reviewer has specific evidence that risk is contained.

## Required Report Sections
Scope, Files reviewed, Domain coverage, Supported Findings, Predicted Risks (omit if empty), Testing gaps, Opposition review, Verdict

The orchestrator sorts findings into report sections after collecting all domain agent output. Domain agents do not decide section placement.

**Supported Findings** — VERIFIED and INFERRED findings. Each row prefixed `[VERIFIED]` or `[INFERRED]` in the Basis column.

**Predicted Risks** — SPECULATIVE findings. Omit this section entirely if no SPECULATIVE findings exist.

## Opposition Review
Not a summary pass. The reviewer must explicitly answer:
- Is any Critical/High finding overstated? Provide counter-evidence.
- What was not reviewed that could matter?
- Which findings might be false positives in this codebase's context?
- What cross-domain risk did no single domain agent catch?
A passing opposition review requires answers to all four. A general statement that none apply is a failure.

## Failure Criteria
- Skipped required domain
- Missing `file:line` reference on any finding
- Missing Evidence field on any finding
- Evidence does not materially support the finding claim
- `SPECULATIVE` finding marked `Blocking: true`
- No Testing assessment
- No Opposition review
- Repo mutation during review without explicit user request

## Remediation
Review identifies and recommends by default. Remediation (editing files, generating tests,
applying fixes) requires explicit user request after findings are presented.

## Compatibility Note
`Basis` replaces `Confidence` (removed). Any tooling that parses review output must be updated from `Confidence` → `Basis`.
