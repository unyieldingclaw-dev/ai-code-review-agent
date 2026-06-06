---
description: Run the full structured feature development workflow
---

Run the 7-phase feature development workflow in order. Do not skip phases. Do not move to the next phase until the current phase is complete and approved.

**Phase 1 — Brainstorm**
Invoke superpowers:brainstorming. Explore the codebase, ask clarifying questions one at a time, propose 2–3 approaches with trade-offs, get design approved before writing any code.

**Phase 2 — Spec**
Write the validated design to `docs/specs/YYYY-MM-DD-<topic>.md`. Self-review for TBDs, contradictions, and ambiguity. Get user approval.

**Phase 3 — Plan**
Invoke superpowers:writing-plans. Create a bite-sized plan with exact file paths, complete code in every step, and exact verification commands. No placeholders.

**Phase 4 — Implement**
Execute the plan using superpowers:subagent-driven-development (preferred) or superpowers:executing-plans. TDD: write failing test → implement → verify passing → commit after each unit.

**Phase 5 — Simplify**
Invoke code-simplifier on all changed files. Improve clarity and consistency without changing behavior.

**Phase 6 — Security Review**
Run /security-review on the current diff. Resolve all [CRITICAL] and [HIGH] findings before proceeding.

**Phase 7 — Commit**
```bash
git add <specific changed files>
git commit -m "feat: <what was built and why>"
```
